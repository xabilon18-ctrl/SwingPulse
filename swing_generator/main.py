"""
Swing Trading Signal Generator — daily runner.

Usage:
    python main.py                 # normal daily run (uses cache if fresh)
    python main.py --refresh       # force re-download all data from Yahoo Finance
    python main.py --date 2026-03-28  # backfill a specific date (uses cached data)

Cron (runs at 23:00 SAST / 21:00 UTC every weekday):
    0 21 * * 1-5 cd /path/to/swing_generator && /usr/bin/python3 main.py >> logs/cron.log 2>&1
"""

from __future__ import annotations

import argparse
import concurrent.futures
import os
import sys
import traceback
from datetime import date, datetime
from typing import Optional

import pandas as pd

import config
from config import (
    MA_PERIODS, SMALL_MA_RANGE, OUTPUT_COLUMNS,
    MAX_PENETRATION_4H, MAX_PENETRATION_DAILY,
    MAX_PENETRATION_3D,
    MAX_PENETRATION_WEEKLY, MAX_PENETRATION_MONTHLY,
    TOUCH_TOLERANCE_MONTHLY,
    SIGNAL_LOOKBACK_4H, SIGNAL_LOOKBACK_DAILY,
    SIGNAL_LOOKBACK_3D,
    SIGNAL_LOOKBACK_WEEKLY, SIGNAL_LOOKBACK_MONTHLY,
)
from instruments   import load_instruments, instruments_by_ticker
from data_fetcher  import fetch_all, fetch_all_hourly
from indicators    import add_all_indicators
from signals       import add_signals
from key_levels    import find_key_levels, today_level_summary
from sheets_writer import write_output

# ---------------------------------------------------------------------------
# Per-instrument processor
# ---------------------------------------------------------------------------

def _resample(df: pd.DataFrame, freq: str) -> pd.DataFrame:
    """Resample daily OHLCV data to weekly ('W') or monthly ('ME') bars."""
    resampled = df.resample(freq).agg({
        'Open': 'first',
        'High': 'max',
        'Low': 'min',
        'Close': 'last',
        'Volume': 'sum',
    }).dropna(subset=['Close'])
    return resampled


def _extract_row(df_processed, run_date, prefix='', ma_periods=None,
                 signal_lookback=None):
    """Extract the latest signal row from a processed DataFrame.
    If prefix is set (e.g. 'w_'), all keys are prefixed."""
    target = df_processed[df_processed.index.date <= run_date]
    if target.empty:
        return None, None

    row = target.iloc[-1]
    row_date = target.index[-1].date()

    periods = ma_periods or MA_PERIODS
    ma_values = {f'{prefix}ma_{p}': _fmt(row.get(f'ma_{p}')) for p in periods}
    lookback = signal_lookback or SIGNAL_LOOKBACK_DAILY
    last_sig = _find_last_signal(target, lookback=lookback)
    if prefix:
        last_sig = {f'{prefix}{k}': v for k, v in last_sig.items()}

    result = {
        f'{prefix}date':                          str(row_date),
        f'{prefix}open':                          _fmt(row.get('Open')),
        f'{prefix}high':                          _fmt(row.get('High')),
        f'{prefix}low':                           _fmt(row.get('Low')),
        f'{prefix}close':                         _fmt(row.get('Close')),
        f'{prefix}volume':                        _fmt(row.get('Volume'), decimals=0),
        f'{prefix}volume_average':                _fmt(row.get('volume_average'), decimals=0),
        f'{prefix}volume_spike_flag':             'yes' if row.get('volume_spike_flag') else 'no',
        **ma_values,
        f'{prefix}trend_direction':               row.get('trend_direction', ''),
        f'{prefix}established_trend':             row.get('established_trend', ''),
        f'{prefix}trend_run_days':                int(row.get('trend_run_days', 0)),
        f'{prefix}confirmation_status':           row.get('confirmation_status', ''),
        f'{prefix}primary_signal':                row.get('primary_signal', ''),
        f'{prefix}secondary_signal':              row.get('secondary_signal', ''),
        f'{prefix}signal_confidence':             row.get('signal_confidence', ''),
        **last_sig,
        f'{prefix}watch_flag':                    row.get('watch_flag', ''),
        f'{prefix}potential_turning_point_flag':   row.get('potential_turning_point_flag', ''),
        # New indicator fields
        f'{prefix}ribbon_spread':                 _fmt(row.get('ribbon_spread'), decimals=2),
        f'{prefix}ribbon_compression':            'yes' if row.get('ribbon_compression') else 'no',
        f'{prefix}ma_order_score':                _fmt(row.get('ma_order_score'), decimals=0),
        f'{prefix}roc':                           _fmt(row.get('roc'), decimals=2),
    }
    return result, row


MIN_TREND_DAYS = 30  # trends shorter than this are not real trends


def _extract_trend_segments(df: pd.DataFrame) -> list[dict]:
    """Extract trend segments where NEUTRAL inherits the prior established direction.
    Trends shorter than MIN_TREND_DAYS are absorbed into neighbors.
    Returns a list of {direction, start, end, days, pct_move} dicts, most recent first."""
    segments = []
    established = None
    seg_start = None
    seg_start_idx = None
    last_date = None
    last_idx = None

    for idx in df.index:
        trend = df.at[idx, 'trend_direction'] if 'trend_direction' in df.columns else 'NEUTRAL'
        dt = idx.date() if hasattr(idx, 'date') else idx

        if trend != 'NEUTRAL':
            if established is None:
                established = trend
                seg_start = dt
                seg_start_idx = idx
            elif trend != established:
                # Compute % move for closing segment
                start_price = float(df.at[seg_start_idx, 'Close'])
                end_price = float(df.at[last_idx, 'Close'])
                pct = round((end_price - start_price) / start_price * 100, 1) if start_price else 0
                segments.append({
                    'direction': established,
                    'start': str(seg_start),
                    'end': str(last_date),
                    'days': (last_date - seg_start).days + 1,
                    'pct_move': pct,
                })
                established = trend
                seg_start = dt
                seg_start_idx = idx

        last_date = dt
        last_idx = idx

    # Close final segment
    if established is not None and seg_start_idx is not None and last_idx is not None:
        start_price = float(df.at[seg_start_idx, 'Close'])
        end_price = float(df.at[last_idx, 'Close'])
        pct = round((end_price - start_price) / start_price * 100, 1) if start_price else 0
        segments.append({
            'direction': established,
            'start': str(seg_start),
            'end': str(last_date),
            'days': (last_date - seg_start).days + 1,
            'pct_move': pct,
        })

    # Consolidate: absorb short trends into neighbors
    segments = _consolidate_short_trends(segments, df)

    segments.reverse()  # most recent first
    return segments


def _consolidate_short_trends(segments: list[dict], df: pd.DataFrame) -> list[dict]:
    """Remove trends shorter than MIN_TREND_DAYS by absorbing them into
    the previous segment, then merge consecutive same-direction segments.
    Recalculates pct_move from the DataFrame after merging."""
    if len(segments) <= 1:
        return segments

    def _recalc_pct(seg):
        """Recalculate pct_move from Close prices in the DataFrame."""
        try:
            start_rows = df[df.index.date >= date.fromisoformat(seg['start'])]
            end_rows = df[df.index.date <= date.fromisoformat(seg['end'])]
            if start_rows.empty or end_rows.empty:
                return seg
            sp = float(start_rows.iloc[0]['Close'])
            ep = float(end_rows.iloc[-1]['Close'])
            seg['pct_move'] = round((ep - sp) / sp * 100, 1) if sp else 0
        except Exception:
            pass
        return seg

    changed = True
    while changed:
        changed = False
        filtered = []
        carry_start = None

        for seg in segments:
            if seg['days'] < MIN_TREND_DAYS:
                if filtered:
                    filtered[-1]['end'] = seg['end']
                    filtered[-1]['days'] = (
                        date.fromisoformat(filtered[-1]['end'])
                        - date.fromisoformat(filtered[-1]['start'])
                    ).days + 1
                    _recalc_pct(filtered[-1])
                else:
                    carry_start = seg['start']
                changed = True
            else:
                if carry_start:
                    seg = dict(seg)
                    seg['start'] = carry_start
                    seg['days'] = (date.fromisoformat(seg['end']) - date.fromisoformat(seg['start'])).days + 1
                    _recalc_pct(seg)
                    carry_start = None
                filtered.append(seg)

        # Merge consecutive same-direction segments
        merged = []
        for seg in filtered:
            if merged and merged[-1]['direction'] == seg['direction']:
                merged[-1]['end'] = seg['end']
                merged[-1]['days'] = (
                    date.fromisoformat(merged[-1]['end'])
                    - date.fromisoformat(merged[-1]['start'])
                ).days + 1
                _recalc_pct(merged[-1])
                changed = True
            else:
                merged.append(seg)

        segments = merged

    return segments


def _resample_4h(df_hourly: pd.DataFrame) -> pd.DataFrame:
    """Resample hourly OHLCV to 4-hour bars."""
    ohlcv_cols = ['Open', 'High', 'Low', 'Close', 'Volume']
    # Keep only standard columns
    available = [c for c in ohlcv_cols if c in df_hourly.columns]
    df_h = df_hourly[available].copy()
    # Strip timezone info for clean resampling
    if df_h.index.tz is not None:
        df_h.index = df_h.index.tz_localize(None)
    resampled = df_h.resample('4h').agg({
        'Open': 'first',
        'High': 'max',
        'Low': 'min',
        'Close': 'last',
        'Volume': 'sum',
    }).dropna(subset=['Close'])
    return resampled


# ---------------------------------------------------------------------------
# Multi-timeframe alignment
# ---------------------------------------------------------------------------

def _compute_tf_alignment(row: dict) -> tuple[str, int]:
    """
    Score how many timeframes agree on direction.

    Returns (label, score):
        score: -4 to +4  (positive = bullish alignment, negative = bearish)
        label: 'Triple Bull', 'Triple Bear', 'Aligned Bull', 'Aligned Bear',
               'Mixed', 'Counter-trend', etc.

    Uses established_trend (which persists through NEUTRAL) for each TF.
    """
    trends = []
    for prefix in ('', 'h4_', 'td_', 'w_', 'm_'):
        key = f'{prefix}established_trend' if prefix else 'established_trend'
        t = row.get(key, '')
        if t == 'UPTREND':
            trends.append(1)
        elif t == 'DOWNTREND':
            trends.append(-1)
        else:
            trends.append(0)

    # trends = [daily, h4, weekly, monthly]
    score = sum(trends)
    up_count = trends.count(1)
    down_count = trends.count(-1)

    if up_count >= 3:
        label = 'Triple Bull' if up_count == 4 else 'Aligned Bull'
    elif down_count >= 3:
        label = 'Triple Bear' if down_count == 4 else 'Aligned Bear'
    elif up_count >= 2 and down_count == 0:
        label = 'Leaning Bull'
    elif down_count >= 2 and up_count == 0:
        label = 'Leaning Bear'
    elif up_count > 0 and down_count > 0:
        label = 'Counter-trend'
    else:
        label = 'Mixed'

    return label, score


def process_instrument(ticker: str, df: pd.DataFrame, inst_meta: dict,
                       run_date: date, hourly_df: pd.DataFrame = None) -> Optional[dict]:
    """
    Run the full pipeline for one instrument (4H + daily + weekly + monthly).
    Returns (row_dict, trend_segments) or (None, []) on error.
    """
    try:
        # ── DAILY ──
        df = add_all_indicators(df)
        levels_df = find_key_levels(df)
        df = add_signals(df, max_penetration=MAX_PENETRATION_DAILY,
                         key_levels_df=levels_df)

        daily_data, today_row = _extract_row(
            df, run_date, prefix='',
            signal_lookback=SIGNAL_LOOKBACK_DAILY,
        )
        if daily_data is None:
            return None

        kl = today_level_summary(
            levels_df,
            today_high  = float(today_row['High']),
            today_low   = float(today_row['Low']),
            today_close = float(today_row['Close']),
        )

        # ── TREND SEGMENTS (from full daily history) ──
        trend_segments = _extract_trend_segments(df)

        ohlcv = df[['Open', 'High', 'Low', 'Close', 'Volume']]

        # ── 4-HOUR (from hourly data) ──
        # Clip MA periods to what fits in the available 4H bar count (~2yr of hourly).
        h4_data = {}
        if hourly_df is not None and len(hourly_df) >= 200:
            h4 = _resample_4h(hourly_df)
            h4_ma_periods = [p for p in MA_PERIODS if p <= len(h4)]
            if len(h4_ma_periods) >= 3:
                h4_small = [p for p in SMALL_MA_RANGE if p in h4_ma_periods]
                if not h4_small:
                    h4_small = h4_ma_periods[:min(7, len(h4_ma_periods))]
                h4 = add_all_indicators(h4, ma_periods=h4_ma_periods)
                h4 = add_signals(h4, ma_periods=h4_ma_periods, small_ma_range=h4_small,
                                 max_penetration=MAX_PENETRATION_4H)
                h4_data, _ = _extract_row(
                    h4, run_date, prefix='h4_',
                    ma_periods=h4_ma_periods,
                    signal_lookback=SIGNAL_LOOKBACK_4H,
                )
                if h4_data is None:
                    h4_data = {}

        # ── 3-DAY ──
        # Resample daily bars to 3-day bars.  ~4,000 daily bars → ~1,333 3D bars.
        td = _resample(ohlcv, '3D')
        td_data = {}
        td_ma_periods = [p for p in MA_PERIODS if p <= len(td)]
        if len(td_ma_periods) >= 3:
            td_small = [p for p in SMALL_MA_RANGE if p in td_ma_periods]
            if not td_small:
                td_small = td_ma_periods[:min(7, len(td_ma_periods))]
            td = add_all_indicators(td, ma_periods=td_ma_periods)
            td = add_signals(td, ma_periods=td_ma_periods, small_ma_range=td_small,
                             max_penetration=MAX_PENETRATION_3D)
            td_data, _ = _extract_row(
                td, run_date, prefix='td_',
                ma_periods=td_ma_periods,
                signal_lookback=SIGNAL_LOOKBACK_3D,
            )
            if td_data is None:
                td_data = {}

        # ── WEEKLY ──
        # Clip MA periods to what fits in the weekly bar count.
        wk = _resample(ohlcv, 'W')
        weekly_data = {}
        weekly_ma_periods = [p for p in MA_PERIODS if p <= len(wk)]
        if len(weekly_ma_periods) >= 3:
            weekly_small = [p for p in SMALL_MA_RANGE if p in weekly_ma_periods]
            if not weekly_small:
                weekly_small = weekly_ma_periods[:min(7, len(weekly_ma_periods))]
            wk = add_all_indicators(wk, ma_periods=weekly_ma_periods)
            wk = add_signals(wk, ma_periods=weekly_ma_periods, small_ma_range=weekly_small,
                             max_penetration=MAX_PENETRATION_WEEKLY)
            weekly_data, _ = _extract_row(
                wk, run_date, prefix='w_',
                ma_periods=weekly_ma_periods,
                signal_lookback=SIGNAL_LOOKBACK_WEEKLY,
            )
            if weekly_data is None:
                weekly_data = {}

        # ── MONTHLY ──
        # Use only MA periods that fit within the available monthly bar count.
        # 16 years of daily data ≈ 192 monthly bars → covers ma_40–ma_190 fully.
        # ma_200 requires 200 bars so it's excluded; graceful clipping handles this.
        mo = _resample(ohlcv, 'ME')
        monthly_data = {}
        monthly_ma_periods = [p for p in MA_PERIODS if p <= len(mo)]
        if len(monthly_ma_periods) >= 3:
            monthly_small = [p for p in SMALL_MA_RANGE if p in monthly_ma_periods]
            if not monthly_small:
                monthly_small = monthly_ma_periods[:min(7, len(monthly_ma_periods))]
            mo = add_all_indicators(mo, ma_periods=monthly_ma_periods)
            mo = add_signals(
                mo,
                ma_periods=monthly_ma_periods,
                small_ma_range=monthly_small,
                touch_tolerance=TOUCH_TOLERANCE_MONTHLY,
                max_penetration=MAX_PENETRATION_MONTHLY,
            )
            monthly_data, _ = _extract_row(
                mo, run_date, prefix='m_',
                ma_periods=monthly_ma_periods,
                signal_lookback=SIGNAL_LOOKBACK_MONTHLY,
            )
            if monthly_data is None:
                monthly_data = {}

        row = {
            'instrument_name':  inst_meta['name'],
            'group':            inst_meta.get('group', ''),
            'sector':           inst_meta.get('sector', ''),
            'industry':         inst_meta.get('industry', ''),
            **daily_data,
            **kl,
            **(h4_data or {}),
            **(td_data or {}),
            **(weekly_data or {}),
            **(monthly_data or {}),
        }

        # ── Multi-timeframe alignment (computed after all TFs are assembled) ──
        tf_label, tf_score = _compute_tf_alignment(row)
        row['tf_alignment'] = tf_label
        row['tf_alignment_score'] = tf_score

        return row, trend_segments

    except Exception:
        print(f'\n  ERROR processing {ticker}:')
        traceback.print_exc()
        return None, []


def _find_last_signal(target: pd.DataFrame, lookback: int = 20) -> dict:
    """
    Scan backwards from today's row to find the most recent primary or
    secondary signal while the trend direction hasn't changed.

    Returns dict with last_signal_type, last_signal_date, last_signal_days_ago.
    """
    empty = {'last_signal_type': '', 'last_signal_date': '', 'last_signal_days_ago': ''}

    if target.empty:
        return empty

    today_trend = target.iloc[-1].get('trend_direction', '')

    # Scan backwards (most recent first), up to lookback bars
    end_idx = len(target) - 1
    start_idx = max(0, end_idx - lookback)

    for i in range(end_idx, start_idx - 1, -1):
        row = target.iloc[i]
        row_trend = row.get('trend_direction', '')

        # For confirmed trends: stop if trend direction changed to opposite
        if today_trend in ('UPTREND', 'DOWNTREND') and row_trend not in (today_trend, 'NEUTRAL'):
            break

        sig = row.get('primary_signal', '')
        if not sig:
            sig = row.get('secondary_signal', '')
        if sig:
            sig_date = target.index[i].date()
            days_ago = end_idx - i
            return {
                'last_signal_type':     sig,
                'last_signal_date':     str(sig_date),
                'last_signal_days_ago': days_ago,
            }

    return empty


def _fmt(value, decimals: int = 6) -> str:
    """Format a numeric value as a string, handling NaN gracefully."""
    if value is None:
        return ''
    try:
        import math
        if math.isnan(float(value)):
            return ''
        if decimals == 0:
            return str(int(round(float(value))))
        return f'{float(value):.{decimals}f}'
    except (TypeError, ValueError):
        return str(value) if value is not None else ''


# ---------------------------------------------------------------------------
# Multiprocessing worker  (must be module-level for pickle)
# ---------------------------------------------------------------------------

def _process_worker(args: tuple) -> tuple:
    """
    Worker function run in a separate process for each instrument.
    Reads its own data from the cache to avoid pickling large DataFrames.
    Returns (ticker, row_dict, trend_segments, status_str).
    """
    ticker, inst_meta, run_date = args
    try:
        # Ensure the swing_generator directory is on the path
        _dir = os.path.dirname(os.path.abspath(__file__))
        if _dir not in sys.path:
            sys.path.insert(0, _dir)

        from data_fetcher import _cache_path

        # Read daily data from cache
        path = _cache_path(ticker)
        if not os.path.exists(path):
            return ticker, None, [], 'no cache'
        df = pd.read_parquet(path)

        # Read hourly data if available
        h_path = _cache_path(ticker, suffix='1h')
        h_df   = pd.read_parquet(h_path) if os.path.exists(h_path) else None

        row, trend_segs = process_instrument(
            ticker, df.copy(), inst_meta, run_date, hourly_df=h_df
        )

        if row:
            status   = row.get('confirmation_status', '')
            primary  = row.get('primary_signal', '')
            conf     = row.get('signal_confidence', '')
            tf_align = row.get('tf_alignment', '')
            tag        = f' [{primary}]'  if primary  else ''
            conf_tag   = f' ({conf})'     if conf     else ''
            align_tag  = f' <{tf_align}>' if tf_align else ''
            status_str = f'{status}{tag}{conf_tag}{align_tag}'.strip()
        else:
            status_str = 'skipped'

        return ticker, row, trend_segs, status_str

    except Exception as exc:
        return ticker, None, [], f'ERROR: {exc}'


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='Swing Trading Signal Generator')
    parser.add_argument('--refresh', action='store_true',
                        help='Force re-download all data from Yahoo Finance')
    parser.add_argument('--date', type=str, default=None,
                        help='Target date YYYY-MM-DD (default: today)')
    args = parser.parse_args()

    run_date = (
        datetime.strptime(args.date, '%Y-%m-%d').date()
        if args.date else date.today()
    )

    print('=' * 60)
    print(f'  Swing Signal Generator  —  {run_date}')
    print('=' * 60)

    # 1. Load instrument list
    instruments  = load_instruments()
    inst_by_tick = instruments_by_ticker()
    print(f'\n  Instruments loaded: {len(instruments)}\n')

    # 2. Fetch / load data
    print('  Fetching daily market data ...\n')
    data = fetch_all(instruments, force_refresh=args.refresh)

    if not data:
        print('\n  No data available. Exiting.')
        sys.exit(1)

    print('  Fetching hourly market data (for 4H timeframe) ...\n')
    hourly_data = fetch_all_hourly(instruments, force_refresh=args.refresh)

    # 3. Process each instrument (parallel across all CPU cores)
    n_workers = min(os.cpu_count() or 4, 8)
    print(f'  Computing signals ({n_workers} parallel workers) ...\n')

    worker_args = [
        (ticker, inst_by_tick.get(ticker, {'name': ticker}), run_date)
        for ticker in data.keys()
    ]

    rows      = []
    all_trends = {}
    total      = len(worker_args)
    done       = 0

    with concurrent.futures.ProcessPoolExecutor(max_workers=n_workers) as executor:
        futures = {executor.submit(_process_worker, args): args[0]
                   for args in worker_args}
        for future in concurrent.futures.as_completed(futures):
            ticker, row, trend_segs, status_str = future.result()
            done += 1
            print(f'  [{done:3d}/{total}] {ticker:<15}  {status_str}')
            if row:
                rows.append(row)
                all_trends[row['instrument_name']] = trend_segs

    if not rows:
        print('\n  No output rows generated.')
        sys.exit(1)

    # 4. Build output DataFrame
    output_df = pd.DataFrame(rows)

    # 5. Write output
    print(f'\n  Writing output for {len(output_df)} instruments ...\n')
    write_output(output_df, run_date)

    # 5b. Write trend segments JSON
    import json
    trends_path = os.path.join(os.path.dirname(__file__), 'output', f'trends_{run_date}.json')
    with open(trends_path, 'w') as tf:
        json.dump(all_trends, tf, separators=(',', ':'))
    print(f'  Trend history: {trends_path}')

    # 6. Summary to console
    print('\n  Signal summary:')
    _print_summary(output_df)

    # 7. Upload data to R2 + update live app
    print('\n  Uploading data to R2 ...\n')
    try:
        import subprocess
        result = subprocess.run(
            [sys.executable, os.path.join(os.path.dirname(__file__), 'webapp', 'publish.py')],
            cwd=os.path.dirname(__file__),
            env={**os.environ, 'PATH': '/usr/local/bin:' + os.environ.get('PATH', '')},
            timeout=300,
        )
        if result.returncode == 0:
            print('\n  ✓ App updated! https://swingpulse.pages.dev')
        else:
            print('\n  [Publish] Warning: deploy may have failed. Run manually:')
            print('           python3 webapp/publish.py')
    except subprocess.TimeoutExpired:
        print('\n  [Publish] Timed out after 5 min. Run manually: python3 webapp/publish.py')
    except Exception as e:
        print(f'\n  [Publish] Skipped: {e}')

    print(f'\n  Done — {run_date}\n')


def _print_summary(df: pd.DataFrame) -> None:
    """Print a compact signal count table to stdout."""
    if 'confirmation_status' not in df.columns:
        return

    counts = df['confirmation_status'].value_counts()
    for status, count in counts.items():
        print(f'    {count:3d}  {status}')

    # Highlight any primary signals
    primary_rows = df[df.get('primary_signal', pd.Series(dtype=str)).str.strip() != '']
    if not primary_rows.empty:
        print(f'\n  PRIMARY SIGNALS ({len(primary_rows)}):')
        for _, r in primary_rows.iterrows():
            conf = r.get('signal_confidence', '')
            align = r.get('tf_alignment', '')
            print(f'    {r.get("instrument_name",""):<15}  '
                  f'{r.get("primary_signal",""):<4}  '
                  f'{f"[{conf}]":<12}  '
                  f'{f"<{align}>":<16}  '
                  f'{r.get("confirmation_status","")}')

    # Alignment summary
    if 'tf_alignment' in df.columns:
        print('\n  TIMEFRAME ALIGNMENT:')
        align_counts = df['tf_alignment'].value_counts()
        for label, cnt in align_counts.items():
            print(f'    {cnt:3d}  {label}')

    # Compression alerts
    if 'ribbon_compression' in df.columns:
        compressed = df[df['ribbon_compression'] == 'yes']
        if not compressed.empty:
            print(f'\n  RIBBON COMPRESSION ({len(compressed)} instruments — squeeze alert):')
            for _, r in compressed.head(15).iterrows():
                print(f'    {r.get("instrument_name",""):<15}  '
                      f'spread: {r.get("ribbon_spread","")}%  '
                      f'order: {r.get("ma_order_score","")}/16')


if __name__ == '__main__':
    main()
