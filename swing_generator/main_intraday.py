"""
SwingPulse Intraday Signal Generator — hourly runner.

Timeframes: 1H · 2H · 4H · Daily
Updates every hour via GitHub Actions (07:00–22:00 UTC, Mon–Fri).

Usage:
    python main_intraday.py                # normal hourly run (uses fresh hourly cache)
    python main_intraday.py --refresh      # force re-download all data from Yahoo Finance
    python main_intraday.py --date 2026-04-22  # backfill a specific date
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
    MA_PERIODS, SMALL_MA_RANGE, OUTPUT_COLUMNS_INTRADAY,
    MAX_PENETRATION_1H, MAX_PENETRATION_2H,
    MAX_PENETRATION_4H, MAX_PENETRATION_DAILY,
    SIGNAL_LOOKBACK_1H, SIGNAL_LOOKBACK_2H,
    SIGNAL_LOOKBACK_4H, SIGNAL_LOOKBACK_DAILY,
)
from instruments   import load_instruments, instruments_by_ticker
from data_fetcher  import fetch_all, fetch_all_hourly
from indicators    import add_all_indicators
from signals       import add_signals
from key_levels    import find_key_levels, today_level_summary
from sheets_writer import write_output

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'output_intraday')

# ---------------------------------------------------------------------------
# Resampling
# ---------------------------------------------------------------------------

def _resample_1h(df_hourly: pd.DataFrame) -> pd.DataFrame:
    """Prepare 1H bars — strip timezone, keep standard OHLCV columns."""
    ohlcv_cols = ['Open', 'High', 'Low', 'Close', 'Volume']
    available = [c for c in ohlcv_cols if c in df_hourly.columns]
    df_h = df_hourly[available].copy()
    if df_h.index.tz is not None:
        df_h.index = df_h.index.tz_localize(None)
    return df_h.dropna(subset=['Close'])


def _resample_2h(df_hourly: pd.DataFrame) -> pd.DataFrame:
    """Resample hourly OHLCV to 2-hour bars."""
    ohlcv_cols = ['Open', 'High', 'Low', 'Close', 'Volume']
    available = [c for c in ohlcv_cols if c in df_hourly.columns]
    df_h = df_hourly[available].copy()
    if df_h.index.tz is not None:
        df_h.index = df_h.index.tz_localize(None)
    return df_h.resample('2h').agg({
        'Open': 'first',
        'High': 'max',
        'Low': 'min',
        'Close': 'last',
        'Volume': 'sum',
    }).dropna(subset=['Close'])


def _resample_4h(df_hourly: pd.DataFrame) -> pd.DataFrame:
    """Resample hourly OHLCV to 4-hour bars."""
    ohlcv_cols = ['Open', 'High', 'Low', 'Close', 'Volume']
    available = [c for c in ohlcv_cols if c in df_hourly.columns]
    df_h = df_hourly[available].copy()
    if df_h.index.tz is not None:
        df_h.index = df_h.index.tz_localize(None)
    return df_h.resample('4h').agg({
        'Open': 'first',
        'High': 'max',
        'Low': 'min',
        'Close': 'last',
        'Volume': 'sum',
    }).dropna(subset=['Close'])


# ---------------------------------------------------------------------------
# Row extraction helpers (identical to main.py)
# ---------------------------------------------------------------------------

def _fmt(value, decimals: int = 6) -> str:
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


def _find_last_signal(target: pd.DataFrame, lookback: int = 20) -> dict:
    empty = {'last_signal_type': '', 'last_signal_date': '', 'last_signal_days_ago': ''}
    if target.empty:
        return empty
    today_trend = target.iloc[-1].get('trend_direction', '')
    end_idx = len(target) - 1
    start_idx = max(0, end_idx - lookback)
    for i in range(end_idx, start_idx - 1, -1):
        row = target.iloc[i]
        row_trend = row.get('trend_direction', '')
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


def _extract_row(df_processed, run_date, prefix='', ma_periods=None,
                 signal_lookback=None):
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
        f'{prefix}ribbon_spread':                 _fmt(row.get('ribbon_spread'), decimals=2),
        f'{prefix}ribbon_compression':            'yes' if row.get('ribbon_compression') else 'no',
        f'{prefix}ma_order_score':                _fmt(row.get('ma_order_score'), decimals=0),
        f'{prefix}roc':                           _fmt(row.get('roc'), decimals=2),
    }
    return result, row


# ---------------------------------------------------------------------------
# Multi-timeframe alignment  (1H · 2H · 4H · Daily)
# ---------------------------------------------------------------------------

def _compute_tf_alignment(row: dict) -> tuple[str, int]:
    """Score alignment across 1H · 2H · 4H · Daily."""
    trends = []
    for prefix in ('', 'h4_', 'h2_', 'h1_'):
        key = f'{prefix}established_trend' if prefix else 'established_trend'
        t = row.get(key, '')
        if t == 'UPTREND':
            trends.append(1)
        elif t == 'DOWNTREND':
            trends.append(-1)
        else:
            trends.append(0)

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


# ---------------------------------------------------------------------------
# Per-instrument processor
# ---------------------------------------------------------------------------

def process_instrument(ticker: str, df: pd.DataFrame, inst_meta: dict,
                       run_date: date, hourly_df: pd.DataFrame = None) -> Optional[dict]:
    """
    Run the intraday pipeline for one instrument: Daily + 4H + 2H + 1H.
    Returns (row_dict, None) or (None, []) on error.
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
            return None, []

        kl = today_level_summary(
            levels_df,
            today_high  = float(today_row['High']),
            today_low   = float(today_row['Low']),
            today_close = float(today_row['Close']),
        )

        h4_data = {}
        h2_data = {}
        h1_data = {}

        if hourly_df is not None and len(hourly_df) >= 200:
            # ── 4-HOUR ──
            h4 = _resample_4h(hourly_df)
            h4_ma_periods = [p for p in MA_PERIODS if p <= len(h4)]
            if len(h4_ma_periods) >= 3:
                h4_small = [p for p in SMALL_MA_RANGE if p in h4_ma_periods] or h4_ma_periods[:min(7, len(h4_ma_periods))]
                h4 = add_all_indicators(h4, ma_periods=h4_ma_periods)
                h4 = add_signals(h4, ma_periods=h4_ma_periods, small_ma_range=h4_small,
                                 max_penetration=MAX_PENETRATION_4H)
                h4_data, _ = _extract_row(
                    h4, run_date, prefix='h4_',
                    ma_periods=h4_ma_periods,
                    signal_lookback=SIGNAL_LOOKBACK_4H,
                ) or ({}, None)
                if h4_data is None:
                    h4_data = {}

            # ── 2-HOUR ──
            h2 = _resample_2h(hourly_df)
            h2_ma_periods = [p for p in MA_PERIODS if p <= len(h2)]
            if len(h2_ma_periods) >= 3:
                h2_small = [p for p in SMALL_MA_RANGE if p in h2_ma_periods] or h2_ma_periods[:min(7, len(h2_ma_periods))]
                h2 = add_all_indicators(h2, ma_periods=h2_ma_periods)
                h2 = add_signals(h2, ma_periods=h2_ma_periods, small_ma_range=h2_small,
                                 max_penetration=MAX_PENETRATION_2H)
                h2_data, _ = _extract_row(
                    h2, run_date, prefix='h2_',
                    ma_periods=h2_ma_periods,
                    signal_lookback=SIGNAL_LOOKBACK_2H,
                ) or ({}, None)
                if h2_data is None:
                    h2_data = {}

            # ── 1-HOUR ──
            h1 = _resample_1h(hourly_df)
            h1_ma_periods = [p for p in MA_PERIODS if p <= len(h1)]
            if len(h1_ma_periods) >= 3:
                h1_small = [p for p in SMALL_MA_RANGE if p in h1_ma_periods] or h1_ma_periods[:min(7, len(h1_ma_periods))]
                h1 = add_all_indicators(h1, ma_periods=h1_ma_periods)
                h1 = add_signals(h1, ma_periods=h1_ma_periods, small_ma_range=h1_small,
                                 max_penetration=MAX_PENETRATION_1H)
                h1_data, _ = _extract_row(
                    h1, run_date, prefix='h1_',
                    ma_periods=h1_ma_periods,
                    signal_lookback=SIGNAL_LOOKBACK_1H,
                ) or ({}, None)
                if h1_data is None:
                    h1_data = {}

        row = {
            'instrument_name': inst_meta['name'],
            'group':           inst_meta.get('group', ''),
            'sector':          inst_meta.get('sector', ''),
            'industry':        inst_meta.get('industry', ''),
            **daily_data,
            **kl,
            **(h4_data or {}),
            **(h2_data or {}),
            **(h1_data or {}),
        }

        tf_label, tf_score = _compute_tf_alignment(row)
        row['tf_alignment'] = tf_label
        row['tf_alignment_score'] = tf_score

        return row, []

    except Exception:
        print(f'\n  ERROR processing {ticker}:')
        traceback.print_exc()
        return None, []


# ---------------------------------------------------------------------------
# Multiprocessing worker
# ---------------------------------------------------------------------------

def _process_worker(args: tuple) -> tuple:
    ticker, inst_meta, run_date = args
    try:
        _dir = os.path.dirname(os.path.abspath(__file__))
        if _dir not in sys.path:
            sys.path.insert(0, _dir)

        from data_fetcher import _cache_path

        path = _cache_path(ticker)
        if not os.path.exists(path):
            return ticker, None, [], 'no cache'
        df = pd.read_parquet(path)

        h_path = _cache_path(ticker, suffix='1h')
        h_df   = pd.read_parquet(h_path) if os.path.exists(h_path) else None

        row, _ = process_instrument(ticker, df.copy(), inst_meta, run_date, hourly_df=h_df)

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

        return ticker, row, [], status_str

    except Exception as exc:
        return ticker, None, [], f'ERROR: {exc}'


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='SwingPulse Intraday Signal Generator')
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
    print(f'  SwingPulse Intraday  [1H · 2H · 4H · D]  —  {run_date}')
    print('=' * 60)

    instruments  = load_instruments()
    inst_by_tick = instruments_by_ticker()
    print(f'\n  Instruments loaded: {len(instruments)}\n')

    print('  Fetching daily market data ...\n')
    data = fetch_all(instruments, force_refresh=args.refresh)
    if not data:
        print('\n  No data available. Exiting.')
        sys.exit(1)

    # Hourly cache freshness = 1 hour so every run picks up the latest bar
    print('  Fetching hourly market data (1H · 2H · 4H timeframes) ...\n')
    hourly_data = fetch_all_hourly(instruments, force_refresh=args.refresh,
                                   max_age_hours=1)

    n_workers = min(os.cpu_count() or 4, 8)
    print(f'  Computing signals ({n_workers} parallel workers) ...\n')

    worker_args = [
        (ticker, inst_by_tick.get(ticker, {'name': ticker}), run_date)
        for ticker in data.keys()
    ]

    rows  = []
    total = len(worker_args)
    done  = 0

    with concurrent.futures.ProcessPoolExecutor(max_workers=n_workers) as executor:
        futures = {executor.submit(_process_worker, args): args[0]
                   for args in worker_args}
        for future in concurrent.futures.as_completed(futures):
            ticker, row, _, status_str = future.result()
            done += 1
            print(f'  [{done:3d}/{total}] {ticker:<15}  {status_str}')
            if row:
                rows.append(row)

    if not rows:
        print('\n  No output rows generated.')
        sys.exit(1)

    output_df = pd.DataFrame(rows)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f'\n  Writing output for {len(output_df)} instruments ...\n')
    write_output(output_df, run_date, output_dir=OUTPUT_DIR,
                 output_columns=OUTPUT_COLUMNS_INTRADAY)

    print('\n  Signal summary:')
    _print_summary(output_df)

    print('\n  Uploading data to R2 ...\n')
    try:
        import subprocess
        result = subprocess.run(
            [sys.executable,
             os.path.join(os.path.dirname(__file__), 'webapp', 'publish.py'),
             '--intraday'],
            cwd=os.path.dirname(__file__),
            env={**os.environ, 'PATH': '/usr/local/bin:' + os.environ.get('PATH', '')},
            timeout=300,
        )
        if result.returncode == 0:
            print('\n  ✓ Intraday app updated! https://swingpulse-intraday.pages.dev')
        else:
            print('\n  [Publish] Warning: deploy may have failed.')
    except subprocess.TimeoutExpired:
        print('\n  [Publish] Timed out. Run manually: python3 webapp/publish.py --intraday')
    except Exception as e:
        print(f'\n  [Publish] Skipped: {e}')

    print(f'\n  Done — {run_date}\n')


def _print_summary(df: pd.DataFrame) -> None:
    if 'confirmation_status' not in df.columns:
        return
    counts = df['confirmation_status'].value_counts()
    for status, count in counts.items():
        print(f'    {count:3d}  {status}')
    if 'tf_alignment' in df.columns:
        print('\n  TIMEFRAME ALIGNMENT (1H · 2H · 4H · D):')
        for label, cnt in df['tf_alignment'].value_counts().items():
            print(f'    {cnt:3d}  {label}')


if __name__ == '__main__':
    main()
