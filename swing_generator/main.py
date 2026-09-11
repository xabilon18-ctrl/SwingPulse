"""
Swing Trading Signal Generator — daily runner.

Usage:
    python main.py                # normal daily run (uses cache if fresh)
    python main.py --refresh      # force re-download all data from Yahoo Finance
    python main.py --date 2026-03-28  # backfill a specific date (uses cached data)

Cron (runs at 23:00 SAST / 21:00 UTC every weekday):
    0 21 * * 1-5 cd /path/to/swing_generator && /usr/bin/python3 main.py >> logs/cron.log 2>&1
"""

from __future__ import annotations

import argparse
import concurrent.futures
import math
import os
import sys
import traceback
from datetime import date, datetime
from typing import Optional

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Profile selection — _active_config reads --profile from sys.argv
# All other modules (indicators, signals, etc.) also import from _active_config
# so the whole pipeline automatically uses the same MA set.
# ---------------------------------------------------------------------------
import _active_config as config

from _active_config import (
    MA_PERIODS, OUTPUT_COLUMNS,
    SIGNAL_LOOKBACK_1H, SIGNAL_LOOKBACK_4H, SIGNAL_LOOKBACK_DAILY,
    SIGNAL_LOOKBACK_WEEKLY, SIGNAL_LOOKBACK_3D,
    ACTIVE_PROFILE,
    CONTEXT_RULES, CONF_TIER_ORDER,
    H4_SESSION_NORMALIZE, H4_BARS_PER_SESSION_TARGET,
    H1_SESSION_NORMALIZE, H1_BARS_PER_SESSION_TARGET,
    INTRADAY_PREFIXES, TIMEFRAMES, TF_PREFIXES, ALIGNMENT_PREFIXES,
    WEEKLY_RESAMPLE_RULE, REFIRE_PCT_WEEKLY, NEW_TREND_PCT_WEEKLY,
    THREE_DAY_EPOCH, THREE_DAY_SIZE, REFIRE_PCT_3D, NEW_TREND_PCT_3D,
)

PROFILE = ACTIVE_PROFILE
from instruments   import load_instruments, instruments_by_ticker, asset_class_of
from data_fetcher  import (fetch_all, fetch_all_hourly, h4_ticker,
                           drop_unfinished_1h, drop_unfinished_4h)
from indicators    import add_all_indicators
from key_levels    import find_key_levels, today_level_summary
from signals       import add_signals
from output_writer import write_output

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
    # Slice via searchsorted — index is sorted; avoids materializing .date
    # and copying the full frame on every call.
    cutoff = df_processed.index.searchsorted(
        pd.Timestamp(run_date) + pd.Timedelta(days=1), side='left')
    target = df_processed.iloc[:cutoff]
    if target.empty:
        return None, None

    row = target.iloc[-1]
    row_ts   = target.index[-1]
    row_date = row_ts.date()

    periods = ma_periods or MA_PERIODS
    ma_values = {f'{prefix}ma_{p}': _fmt(row.get(f'ma_{p}')) for p in periods}
    lookback = signal_lookback or SIGNAL_LOOKBACK_4H
    last_sig = _find_last_signal(target, lookback=lookback)
    if prefix:
        last_sig = {f'{prefix}{k}': v for k, v in last_sig.items()}

    # Intraday timeframes only: the exact bar timestamp. `date` alone is
    # ambiguous when a day holds 2-6 bars — the ledger used to resolve a 4H fire
    # to the LAST bar of that date, which (runs land midday) is typically 1-5
    # bars after the bar that actually fired, so every graded 4H trade was
    # entered up to a session late. Daily bars are uniquely identified by their
    # date already, so no column is emitted there — and so is a weekly bar,
    # which IS its week-ending date. Keyed off INTRADAY_PREFIXES rather than
    # `if prefix`, which meant the same thing only while 4H was the sole
    # prefixed timeframe.
    intraday_ts = ({f'{prefix}datetime': str(row_ts)}
                   if prefix in INTRADAY_PREFIXES else {})

    result = {
        f'{prefix}date':                          str(row_date),
        **intraday_ts,
        f'{prefix}open':                          _fmt(row.get('Open')),
        f'{prefix}high':                          _fmt(row.get('High')),
        f'{prefix}low':                           _fmt(row.get('Low')),
        f'{prefix}close':                         _fmt(row.get('Close')),
        f'{prefix}volume':                        _fmt(row.get('Volume'), decimals=0),
        f'{prefix}volume_average':                _fmt(row.get('volume_average'), decimals=0),
        f'{prefix}volume_spike_flag':             'yes' if row.get('volume_spike_flag') else 'no',
        f'{prefix}pvo':                           _fmt(row.get('pvo'), decimals=1),
        f'{prefix}pvo_signal':                    _fmt(row.get('pvo_signal'), decimals=1),
        **ma_values,
        f'{prefix}trend_direction':               row.get('trend_direction', ''),
        f'{prefix}established_trend':             row.get('established_trend', ''),
        f'{prefix}trend_run_days':                int(row.get('trend_run_days', 0)),
        f'{prefix}confirmation_status':           row.get('confirmation_status', ''),
        f'{prefix}primary_signal':                row.get('primary_signal', ''),
        f'{prefix}signal_confidence':             row.get('signal_confidence', ''),
        f'{prefix}confidence_context':            '',   # filled by apply_context_confidence()
        **last_sig,
        f'{prefix}watch_flag':                    row.get('watch_flag', ''),
        f'{prefix}potential_turning_point_flag':   row.get('potential_turning_point_flag', ''),
        # New indicator fields
        f'{prefix}ribbon_spread':                 _fmt(row.get('ribbon_spread'), decimals=2),
        f'{prefix}ribbon_compression':            'yes' if row.get('ribbon_compression') else 'no',
        f'{prefix}ribbon_slope_pct':              _fmt(row.get('ribbon_slope_pct'), decimals=2),
        f'{prefix}ma_order_score':                _fmt(row.get('ma_order_score'), decimals=0),
        f'{prefix}roc':                           _fmt(row.get('roc'), decimals=2),
        f'{prefix}rsi':                           _fmt(row.get('rsi'), decimals=1),
        f'{prefix}rollover_score':                _fmt(row.get('rollover_score'), decimals=0),
        f'{prefix}rollover_max':                  _fmt(row.get('rollover_max'), decimals=0),
        f'{prefix}rollover_dir':                  row.get('rollover_dir', 'none') or 'none',
        f'{prefix}rollover_stage':                _fmt(row.get('rollover_stage'), decimals=0),
        # Performance — was missing from extraction (NaN for all instruments)
        f'{prefix}pct_1d':                        _fmt(row.get('pct_1d'), decimals=2),
        f'{prefix}pct_1w':                        _fmt(row.get('pct_1w'), decimals=2),
        f'{prefix}pct_1m':                        _fmt(row.get('pct_1m'), decimals=2),
        f'{prefix}pct_1y':                        _fmt(row.get('pct_1y'), decimals=2),
        # MA stack (display only — see indicators.add_ma_stack). The pair label
        # carries the instrument's OWN period numbers, so a session-normalised
        # ribbon reads "8x167" rather than claiming a 250 and a 500 it does not
        # have.
        f'{prefix}stack_state':                   row.get('stack_state', '') or '',
        f'{prefix}stack_pair':                    row.get('stack_pair', '') or '',
        f'{prefix}stack_gap_pct':                 _fmt(row.get('stack_gap_pct'), decimals=2),
        f'{prefix}stack_flip_bars':               _fmt(row.get('stack_flip_bars'), decimals=0),
    }

    if not prefix:
        # Daily-only choppiness/trend flags — computed in indicators/signals but
        # previously never extracted into the output row (always blank).
        result['ma_fast_cross_count'] = int(row.get('ma_fast_cross_count', 0) or 0)
        result['neutral_oscillation'] = 'yes' if row.get('neutral_oscillation') else 'no'
        result['new_trend_flag']      = 'yes' if row.get('new_trend_flag') else 'no'

    return result, row


def _to_float(s):
    try:
        f = float(s)
        return f if not math.isnan(f) else None
    except (TypeError, ValueError):
        return None


def _shift_tier(tier: str, delta: int) -> str:
    if tier not in CONF_TIER_ORDER:
        return tier
    idx = CONF_TIER_ORDER.index(tier) + delta
    idx = max(0, min(len(CONF_TIER_ORDER) - 1, idx))
    return CONF_TIER_ORDER[idx]


def _rule_hits(rule: dict, row: dict, prefix: str) -> bool:
    """Same-timeframe field test. (Cross-TF tests would branch on rule['test'].)"""
    val = _to_float(row.get(f"{prefix}{rule['field']}"))
    if val is None:
        return False
    op, thr = rule['op'], rule['value']
    if op == 'ge':
        return val >= thr
    if op == 'le':
        return val <= thr
    if op == 'eq':
        return val == thr
    return False


def apply_context_confidence(row: dict) -> None:
    """Nudge signal_confidence per config.CONTEXT_RULES (edge-audit phase 3a).
    Mutates row in place: adjusts {prefix}signal_confidence and writes a
    human-readable {prefix}confidence_context. Only fired signals are touched."""
    for tf, prefix in TIMEFRAMES:
        sig = row.get(f'{prefix}primary_signal', '')
        base = row.get(f'{prefix}signal_confidence', '')
        if not sig or base not in CONF_TIER_ORDER:
            continue
        total, reasons = 0, []
        for rule in CONTEXT_RULES:
            if rule['tf'] != tf:
                continue
            if rule['signals'] is not None and sig not in rule['signals']:
                continue
            if _rule_hits(rule, row, prefix):
                total += rule['delta']
                reasons.append(f"{rule['reason']} {'+' if rule['delta'] > 0 else ''}{rule['delta']}")
        if reasons:
            row[f'{prefix}signal_confidence'] = _shift_tier(base, total)
            row[f'{prefix}confidence_context'] = '; '.join(reasons)


MIN_TREND_DAYS = 30  # trends shorter than this are not real trends


def _extract_trend_segments(df: pd.DataFrame) -> list[dict]:
    """Extract trend segments as B1/S1 regimes (user decision 2026-07-13): a run
    starts/ends exactly where the signal engine latches established_trend, so the
    Trends tab tells the same story as every other trend badge in the app. Rows
    without a latched state ('' before the first primary) inherit.

    Fallback for short-history instruments where add_signals couldn't run:
    ribbon trend_direction + the MIN_TREND_DAYS noise absorber (the old
    behavior — which glued multi-year runs across brief real breaks, e.g.
    ZURN 'up since 2016' through COVID and the 2023 CS shock).

    Returns a list of {direction, start, end, days, pct_move} dicts, most recent first."""
    use_est = ('established_trend' in df.columns
               and df['established_trend'].isin(('UPTREND', 'DOWNTREND')).any())
    col = 'established_trend' if use_est else 'trend_direction'

    segments = []
    established = None
    seg_start = None
    seg_start_idx = None
    last_date = None
    last_idx = None

    for idx in df.index:
        trend = df.at[idx, col] if col in df.columns else 'NEUTRAL'
        if trend not in ('UPTREND', 'DOWNTREND'):
            trend = 'NEUTRAL'
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

    # B1/S1 regimes are already disciplined (anchor gate + dedup) — no absorber.
    # Only the ribbon fallback needs short-trend consolidation.
    if not use_est:
        segments = _consolidate_short_trends(segments, df)

    segments.reverse()  # most recent first
    return segments


def _consolidate_short_trends(segments: list[dict], df: pd.DataFrame) -> list[dict]:
    """Remove trends shorter than MIN_TREND_DAYS by absorbing them into
    the previous segment, then merge consecutive same-direction segments.
    Recalculates pct_move from the DataFrame after merging."""
    if len(segments) <= 1:
        return segments

    # Precompute once — df.index.date materialized per _recalc_pct call was
    # the hottest spot in the whole pipeline (~5s/instrument).
    idx    = df.index
    closes = df['Close'].to_numpy()

    def _recalc_pct(seg):
        """Recalculate pct_move from Close prices in the DataFrame."""
        try:
            # First bar with date >= start, last bar with date <= end
            i0 = idx.searchsorted(pd.Timestamp(seg['start']), side='left')
            i1 = idx.searchsorted(pd.Timestamp(seg['end']) + pd.Timedelta(days=1), side='left') - 1
            if i0 >= len(closes) or i1 < i0:
                return seg
            sp = float(closes[i0])
            ep = float(closes[i1])
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
    # Same rule as the daily timeframe: a bucket still being filled is not a
    # bar. Hourly caches are stored in UTC, so the window test needs no
    # per-exchange timetable. See data_fetcher §"Finished sessions only".
    return drop_unfinished_4h(resampled)


def _resample_weekly(df_daily: pd.DataFrame) -> pd.DataFrame:
    """Resample finished daily bars to weekly, dropping the week in progress.

    Two rules, both load-bearing:

    1. Weeks are labelled by their END (`W-FRI`), so a bar dated 2026-09-04 is
       the week that closed that Friday. This is what a weekly chart shows and
       what `w_date` means on the front end.

    2. **The current week is dropped.** A week is not a bar until it has ended,
       the same rule `drop_unfinished_daily` / `drop_unfinished_4h` apply to
       their own timeframes (Important Rule 10). Without it every run Monday
       through Thursday would compute the ribbon, the trend and the signals on a
       part-formed bar, and a weekly B2 fired on Tuesday could be gone by
       Friday — the signal would repaint for four days out of five. So during
       the week the weekly timeframe shows the LAST CLOSED week and does not
       move; that is correct, not stale, and the UI says which week it is.

    The daily frame arriving here has already been through drop_unfinished_daily
    in _process_worker, so the final week is judged on finished sessions only.
    """
    ohlcv = ['Open', 'High', 'Low', 'Close', 'Volume']
    cols  = [c for c in ohlcv if c in df_daily.columns]
    if not cols or df_daily.empty:
        return df_daily.iloc[0:0]

    d = df_daily[cols].copy()
    if getattr(d.index, 'tz', None) is not None:
        d.index = d.index.tz_localize(None)

    weekly = d.resample(WEEKLY_RESAMPLE_RULE).agg({
        'Open': 'first', 'High': 'max', 'Low': 'min',
        'Close': 'last', 'Volume': 'sum',
    }).dropna(subset=['Close'])

    if weekly.empty:
        return weekly

    # Drop the in-progress week: its label (the coming Friday) is still ahead of
    # the newest daily bar we hold. Compared on dates, so a Friday-dated bar
    # built from a finished Friday session is admitted.
    last_daily = pd.Timestamp(d.index.max()).normalize()
    return weekly[pd.DatetimeIndex(weekly.index).normalize() <= last_daily]


def _resample_3d(df_daily: pd.DataFrame) -> pd.DataFrame:
    """Resample finished daily bars to 3-day bars, dropping the one in progress.

    Bars are groups of THREE BUSINESS DAYS counted from a FIXED EPOCH
    (config.THREE_DAY_EPOCH), not `resample('3D')` and not "every 3 rows of the
    frame". That choice is the whole point of this function:

      * `resample('3D')` bins on calendar days, so the window rotates through
        the week and a bar holds 1-3 sessions depending on the weekend.
      * grouping every 3 rows from the start of the frame re-phases EVERY
        historical bar the moment the cache start moves — and it does move
        (data_fetcher truncates). Every 3D bar in the app would silently change
        from one run to the next, which is repainting.

    Counting business days from a fixed epoch is independent of how much history
    is loaded, so a given calendar date always lands in the same bar.

    The bar is labelled by its group's CLOSING business day, exactly as a weekly
    bar is labelled by its Friday, and the in-progress group is dropped by the
    same rule (Important Rule 10): a bar is not a bar until it has ended. A
    holiday closing day makes a bar wait one extra day for admission, which is
    the behaviour _resample_weekly already has when a Friday is a holiday.
    """
    ohlcv = ['Open', 'High', 'Low', 'Close', 'Volume']
    cols  = [c for c in ohlcv if c in df_daily.columns]
    if not cols or df_daily.empty:
        return df_daily.iloc[0:0]

    d = df_daily[cols].copy()
    if getattr(d.index, 'tz', None) is not None:
        d.index = d.index.tz_localize(None)

    days  = pd.DatetimeIndex(d.index).normalize().values.astype('datetime64[D]')
    epoch = np.datetime64(THREE_DAY_EPOCH, 'D')
    group = np.busday_count(epoch, days) // THREE_DAY_SIZE

    out = d.groupby(group).agg({
        'Open': 'first', 'High': 'max', 'Low': 'min',
        'Close': 'last', 'Volume': 'sum',
    }).dropna(subset=['Close'])
    if out.empty:
        return out

    # Label each bar with the last business day of its group.
    closing = np.busday_offset(epoch,
                               out.index.to_numpy() * THREE_DAY_SIZE + (THREE_DAY_SIZE - 1),
                               roll='forward')
    out.index = pd.DatetimeIndex(closing)

    last_daily = pd.Timestamp(d.index.max()).normalize()
    return out[pd.DatetimeIndex(out.index).normalize() <= last_daily]


def _h4_bars_per_session(h4: pd.DataFrame) -> float:
    """Median 4H bars per trading session. 6 = a ~23h contract, 2 = a US cash
    session, 3 = a European one."""
    if h4.empty:
        return 0.0
    return float(h4.groupby(h4.index.date).size().median() or 0.0)


def _h1_frame(hourly: pd.DataFrame) -> pd.DataFrame:
    """The 1H timeframe: the hourly cache itself, minus the bar still forming.

    No resampling — this IS the native feed 4H is built from, which is why the
    timeframe costs no extra download. Timezone is stripped to match every other
    frame in the pipeline.
    """
    cols = [c for c in ('Open', 'High', 'Low', 'Close', 'Volume') if c in hourly.columns]
    h1 = hourly[cols].copy()
    if h1.index.tz is not None:
        h1.index = h1.index.tz_localize(None)
    return drop_unfinished_1h(h1)


def _h1_bars_per_session(h1: pd.DataFrame) -> float:
    """Median hourly bars per trading session. ~24 = a 24h contract, ~7 = a US
    cash session, ~9 = a European one."""
    if h1.empty:
        return 0.0
    return float(h1.groupby(h1.index.date).size().median() or 0.0)


def _h1_ma_periods(h1: pd.DataFrame, ticker: str) -> list[int]:
    """Ribbon periods for the 1H timeframe — the 4H rule, one interval faster.

    The mismatch is bigger here than at 4H because the divisor is: measured over
    the cache 2026-09-03, an equity gives 7 hourly bars a session and a 24h
    contract gives 23-24, so an unscaled MA500 spans 71 sessions on one and 21
    on the other. Instruments already redirected to a 24h contract by H4_SOURCE
    arrive with ~24 bars/session and fall through unchanged, exactly as they do
    at 4H — they share this cache.

    A US equity is deliberately left alone: it really does trade 6.5h, so 7
    bars/session is what its 1H chart shows on TradingView too.
    """
    periods = MA_PERIODS
    if ticker in H1_SESSION_NORMALIZE:
        bps = _h1_bars_per_session(h1)
        if 0 < bps < H1_BARS_PER_SESSION_TARGET:
            scale   = bps / H1_BARS_PER_SESSION_TARGET
            periods = sorted({max(3, int(round(p * scale))) for p in MA_PERIODS})
    return [p for p in periods if p <= len(h1)]


def _h4_ma_periods(h4: pd.DataFrame, ticker: str) -> list[int]:
    """Ribbon periods for the 4H timeframe.

    For an instrument charted as a 24h contract but fed by a session-limited
    index (H4_SESSION_NORMALIZE — the cash indices with no usable yfinance
    future), the raw ribbon reaches ~3x too far back: 500 bars at 2/session is
    250 sessions, where a 24h chart's 500 bars is ~83. Scale the periods by
    bars-per-session so the ribbon spans the calendar window the chart shows.

    Everything else keeps MA_PERIODS untouched — a US equity really does trade
    6.5h, so 2 bars/session is what its 4H chart shows everywhere and the
    ribbon is already right. Instruments redirected via H4_SOURCE arrive with 6
    bars/session already, so they fall through here unchanged too.
    """
    periods = MA_PERIODS
    if ticker in H4_SESSION_NORMALIZE:
        bps = _h4_bars_per_session(h4)
        if 0 < bps < H4_BARS_PER_SESSION_TARGET:
            scale   = bps / H4_BARS_PER_SESSION_TARGET
            periods = sorted({max(3, int(round(p * scale))) for p in MA_PERIODS})
    return [p for p in periods if p <= len(h4)]


# ---------------------------------------------------------------------------
# Multi-timeframe alignment
# ---------------------------------------------------------------------------

def _compute_tf_alignment(row: dict) -> tuple[str, int]:
    """
    Score how many timeframes agree on direction (4H + Daily + Weekly).
    1H does NOT vote — see config.ALIGNMENT_PREFIXES for why.

    Returns (label, score):
        score: -3 to +3  (positive = bullish alignment, negative = bearish)
               Widened from -2..+2 when Weekly was added 2026-09-02; consumers
               that drew a bar from this must rescale, not clamp.
        label: 'Aligned Bull/Bear' — every timeframe with a ribbon agrees
               'Counter-trend'     — TFs in opposite directions
               'Mixed'             — no clear direction

    Reads trend_direction — where price sits in each timeframe's ribbon RIGHT
    NOW. It used to read established_trend and fall back to trend_direction,
    but established_trend is a latch: signals.py sets in_uptrend on B1 (close
    above all 20 MAs) and clears it only on S1 (close below all 20), so it
    survives any decline that stops short of the anchor. US100 on 2026-07-28
    was labelled 'Aligned Bull' while its 4H close sat below most of its ribbon with
    RSI 31, because a 4H B2 on 07-14 had latched in_uptrend and nothing since
    could un-latch it. Alignment is a question about now, so it takes the
    positional read; established_trend stays untouched for the Trends tab
    segments and the signal gates that legitimately want the latch.
    """
    # A timeframe that produced no ribbon at all (too little history for even a
    # clipped MA set) is ABSENT, and absent is not the same as NEUTRAL. NEUTRAL
    # is an opinion — price is inside the ribbon — and it has always blocked
    # alignment; that must not change. Absent should simply not vote, otherwise
    # the ~7 instruments with under 75 weekly bars could never read Aligned
    # again. Hence `present`, not a hard-coded count of 2 (which quietly
    # stopped meaning "all of them" the moment a third timeframe existed).
    trends  = []
    present = 0
    for prefix in ALIGNMENT_PREFIXES:
        t = row.get(f'{prefix}trend_direction', '')
        if not t:
            continue
        present += 1
        trends.append(1 if t == 'UPTREND' else -1 if t == 'DOWNTREND' else 0)

    score      = sum(trends)
    up_count   = trends.count(1)
    down_count = trends.count(-1)

    if present and up_count == present:
        label = 'Aligned Bull'
    elif present and down_count == present:
        label = 'Aligned Bear'
    elif up_count > 0 and down_count > 0:
        label = 'Counter-trend'
    else:
        label = 'Mixed'

    return label, score


def process_instrument(ticker: str, df: pd.DataFrame, inst_meta: dict,
                       run_date: date, hourly_df: pd.DataFrame = None) -> Optional[dict]:
    """
    Run the full pipeline for one instrument (daily + 4H).
    Returns (row_dict, trend_segments) or (None, []) on error.
    """
    try:
        # ── DAILY (indicators first — needed for trend segments + perf) ──
        df = add_all_indicators(df)

        # ── DAILY signals (same engine as 4H, unprefixed columns) ──
        # Clip the ribbon to available bars so the MA500 anchor isn't all-NaN on
        # short-history instruments (which would suppress every signal).
        d_ma_periods = [p for p in MA_PERIODS if p <= len(df)]
        _asset_cls = asset_class_of(inst_meta.get('group', ''))
        # RIBBON GATE, lowered 3 -> 2 on 2026-09-09 with the ribbon cut to three
        # lines. `p <= len(df)` clips the ribbon to available bars, so a
        # short-history frame keeps only the fast lines. Under the 20-MA ribbon
        # a frame with 300 bars still kept twelve periods and sailed past a
        # `>= 3` gate; under [50, 250, 500] it keeps exactly two and the gate
        # would have silently produced NO SIGNALS AT ALL. Measured over the
        # 812-instrument cache: 141 instruments (17%) would have lost every
        # Weekly signal and 53 every 3-Day signal. Two lines is a real, if
        # shallow, ribbon — max() still gives an anchor and min() a fast edge —
        # so it fires, exactly as a clipped 20-MA ribbon used to.
        if len(d_ma_periods) >= 2:
            df = add_signals(df, ma_periods=d_ma_periods,
                             refire_pct=0.05, new_trend_pct=0.05,
                             tf='D', asset_class=_asset_cls)

        # ── TREND SEGMENTS (B1/S1 established_trend regimes — needs add_signals
        # to have run; falls back to ribbon trend_direction when it couldn't) ──
        trend_segments = _extract_trend_segments(df)
        daily_data, d_row = _extract_row(
            df, run_date, prefix='',
            ma_periods=(d_ma_periods or None),
            signal_lookback=SIGNAL_LOOKBACK_DAILY,
        )
        if daily_data is None:
            return None, []

        # ── KEY LEVELS (daily) — historical pivots + today's touch status ──
        # A per-instrument failure must not drop the whole row; leave fields empty.
        daily_data.update({
            'key_level_price': '', 'key_level_type': '', 'key_level_date': '',
            'key_level_touch_count': '', 'key_level_touched_today': 'no',
            'key_levels_all': '',
        })
        try:
            levels = find_key_levels(df.tail(config.KEY_LEVEL_WINDOW_BARS))
            daily_data.update(today_level_summary(
                levels,
                float(d_row['High']), float(d_row['Low']), float(d_row['Close']),
            ))
        except Exception:
            pass

        # ── 1-HOUR: no signals since 2026-09-11 (see config.TIMEFRAMES). The
        # 1H chart is built separately by webapp/chart_feed.py. ──

        # ── 4-HOUR (from hourly data) ──
        h4_data = {}
        if hourly_df is not None and len(hourly_df) >= 200:
            h4 = _resample_4h(hourly_df)
            h4_ma_periods = _h4_ma_periods(h4, ticker)
            # Gate is 2, not 3 — see the ribbon-gate note at the Daily gate above.
            if len(h4_ma_periods) >= 2:
                h4 = add_all_indicators(h4, ma_periods=h4_ma_periods)
                h4 = add_signals(h4, ma_periods=h4_ma_periods,
                                 refire_pct=0.02, new_trend_pct=0.05,
                                 tf='4H', asset_class=_asset_cls)
                h4_data, _ = _extract_row(
                    h4, run_date, prefix='h4_',
                    ma_periods=h4_ma_periods,
                    signal_lookback=SIGNAL_LOOKBACK_4H,
                )
                if h4_data is None:
                    h4_data = {}

        # ── 3-DAY (grouped from the same finished daily bars) ──
        # Same engine, same MA50-MA500 ribbon, on 3-day bars. No session
        # scaling: three business days are three business days on every venue,
        # so the 4H geometry problem has no analogue here. Short-history names
        # clip the ribbon exactly as the daily side does.
        d3_data = {}
        three_day = _resample_3d(df)
        d3_ma_periods = [p for p in MA_PERIODS if p <= len(three_day)]
        # Gate is 2, not 3 — see the ribbon-gate note at the Daily gate above.
        if len(d3_ma_periods) >= 2:
            three_day = add_all_indicators(three_day, ma_periods=d3_ma_periods)
            three_day = add_signals(three_day, ma_periods=d3_ma_periods,
                                    refire_pct=REFIRE_PCT_3D,
                                    new_trend_pct=NEW_TREND_PCT_3D,
                                    tf='3D', asset_class=_asset_cls)
            d3_data, _ = _extract_row(
                three_day, run_date, prefix='d3_',
                ma_periods=d3_ma_periods,
                signal_lookback=SIGNAL_LOOKBACK_3D,
            )
            if d3_data is None:
                d3_data = {}

        # ── WEEKLY (resampled from the same finished daily bars) ──
        # Runs the identical engine and the identical MA50-MA500 ribbon on
        # weekly bars. No session scaling: a week is a week on every venue, so
        # the 4H geometry problem has no weekly analogue. Short-history names
        # clip the ribbon exactly as the daily side does.
        w_data = {}
        weekly = _resample_weekly(df)
        w_ma_periods = [p for p in MA_PERIODS if p <= len(weekly)]
        # Gate is 2, not 3 — see the ribbon-gate note at the Daily gate above.
        if len(w_ma_periods) >= 2:
            weekly = add_all_indicators(weekly, ma_periods=w_ma_periods)
            weekly = add_signals(weekly, ma_periods=w_ma_periods,
                                 refire_pct=REFIRE_PCT_WEEKLY,
                                 new_trend_pct=NEW_TREND_PCT_WEEKLY,
                                 tf='W', asset_class=_asset_cls)
            w_data, _ = _extract_row(
                weekly, run_date, prefix='w_',
                ma_periods=w_ma_periods,
                signal_lookback=SIGNAL_LOOKBACK_WEEKLY,
            )
            if w_data is None:
                w_data = {}

        row = {
            'instrument_name':  inst_meta['name'],
            'group':            inst_meta.get('group', ''),
            'sector':           inst_meta.get('sector', ''),
            'industry':         inst_meta.get('industry', ''),
            # Shipped rather than re-derived in the browser: app.js carried a
            # hand-copy of asset_class_of() to key the same confidence tiers.
            # Two implementations of one rule in two languages is how the
            # buy/sell counting bug survived a year — one source now.
            'asset_class':      _asset_cls,
            **(daily_data or {}),
            **(h4_data or {}),
            **(d3_data or {}),
            **(w_data or {}),
        }

        # ── Multi-timeframe alignment (computed after all TFs are assembled) ──
        tf_label, tf_score = _compute_tf_alignment(row)
        row['tf_alignment'] = tf_label
        row['tf_alignment_score'] = tf_score

        # ── Context confidence modifiers (edge-audit phase 3a) — needs the
        # assembled row so same-TF fields are present; deltas per CONTEXT_RULES.
        apply_context_confidence(row)

        return row, trend_segments

    except Exception:
        print(f'\n  ERROR processing {ticker}:')
        traceback.print_exc()
        return None, []


def _find_last_signal(target: pd.DataFrame, lookback: int = 20) -> dict:
    """
    Scan backwards from today's row to find the most recent primary
    signal while the trend direction hasn't changed.

    Returns dict with last_signal_type, last_signal_date, last_signal_days_ago.
    """
    empty = {'last_signal_type': '', 'last_signal_date': '', 'last_signal_days_ago': '', 'last_signal_price': ''}

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
        if sig:
            sig_date = target.index[i].date()
            days_ago = end_idx - i
            return {
                'last_signal_type':     sig,
                'last_signal_date':     str(sig_date),
                'last_signal_days_ago': days_ago,
                'last_signal_price':    _fmt(row.get('Close')),
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

        from data_fetcher import (_cache_path, drop_unfinished_daily,
                                  heal_daily_gaps_from_hourly)

        # Read daily data from cache
        path = _cache_path(ticker)
        if not os.path.exists(path):
            return ticker, None, [], 'no cache'
        df = pd.read_parquet(path)

        # Read hourly data if available. The 4H feed may be redirected to a 24h
        # contract (H4_SOURCE) — that cache is keyed by the SOURCE ticker, so
        # resolve the same mapping fetch_all_hourly used. Daily above is
        # unaffected: it stays on `ticker`.
        h_path = _cache_path(h4_ticker(ticker), suffix='1h')
        h_df   = pd.read_parquet(h_path) if os.path.exists(h_path) else None

        # A 24/7 instrument's daily bar is just its UTC day, so an omission in
        # Yahoo's daily feed can be rebuilt exactly from the hourly one. Guarded
        # to crypto — a session-based instrument cannot be reconstructed this way.
        if inst_meta.get('sector') == 'Crypto' and h_df is not None:
            df = heal_daily_gaps_from_hourly(df, h_df)

        # Admit finished sessions only. Applied HERE rather than in fetch_all
        # because this is the read that feeds the indicators — fetch_all's
        # frames are used for their keys alone. The cache on disk deliberately
        # keeps the raw bar so a late-settling volume can still be healed by the
        # next run's re-request. See data_fetcher §"Finished sessions only".
        df = drop_unfinished_daily(df)

        row, trend_segs = process_instrument(
            ticker, df.copy(), inst_meta, run_date, hourly_df=h_df
        )

        if row:
            primary  = row.get('h4_primary_signal', '')
            d_primary = row.get('primary_signal', '')
            conf     = row.get('h4_signal_confidence', '')
            tf_align = row.get('tf_alignment', '')
            tag        = f' [{primary}]'  if primary  else ''
            d_tag      = f' D[{d_primary}]' if d_primary else ''
            conf_tag   = f' ({conf})'     if conf     else ''
            align_tag  = f' <{tf_align}>' if tf_align else ''
            status_str = f'4H{tag}{conf_tag}{d_tag}{align_tag}'.strip()
        else:
            status_str = 'skipped'

        return ticker, row, trend_segs, status_str

    except Exception as exc:
        return ticker, None, [], f'ERROR: {exc}'


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    import time as _time
    _t0 = _time.time()
    parser = argparse.ArgumentParser(description='Swing Trading Signal Generator')
    parser.add_argument('--refresh', action='store_true',
                        help='Force re-download all data from Yahoo Finance')
    parser.add_argument('--date', type=str, default=None,
                        help='Target date YYYY-MM-DD (default: today)')
    parser.add_argument('--profile', type=str, default='ma500',
                        help='Config profile (default: ma500)')
    args = parser.parse_args()

    run_date = (
        datetime.strptime(args.date, '%Y-%m-%d').date()
        if args.date else date.today()
    )

    profile_label = 'MA500 Profile' if PROFILE == 'ma500' else 'Default Profile'
    print('=' * 60)
    print(f'  Swing Signal Generator  —  {run_date}  [{profile_label}]')
    print('=' * 60)

    # 1. Load instrument list
    instruments  = load_instruments()
    inst_by_tick = instruments_by_ticker()
    print(f'\n  Instruments loaded: {len(instruments)}\n')

    # 2. Fetch / load data
    _t1 = _time.time()
    print('  Fetching daily market data ...\n')
    data = fetch_all(instruments, force_refresh=args.refresh)

    if not data:
        print('\n  No data available. Exiting.')
        sys.exit(1)

    _e1 = _time.time() - _t1
    print(f'  Daily data: {int(_e1 // 60)}m {int(_e1 % 60):02d}s\n')

    _t2 = _time.time()
    print('  Fetching hourly market data (for 4H timeframe) ...\n')
    # Populates the hourly parquet cache; workers re-read it per-ticker (no return used).
    fetch_all_hourly(instruments, force_refresh=args.refresh)
    _e2 = _time.time() - _t2
    print(f'  Hourly data: {int(_e2 // 60)}m {int(_e2 % 60):02d}s\n')

    # 3. Process each instrument (parallel across all CPU cores)
    _t3 = _time.time()
    n_workers = min(os.cpu_count() or 4, 8)
    print(f'  Computing signals ({n_workers} parallel workers) ...\n')

    worker_args = [
        (ticker, inst_by_tick.get(ticker, {'name': ticker}), run_date)
        for ticker in data.keys()
    ]

    rows      = []
    all_trends = {}
    no_row     = {}   # ticker → reason (processed but produced no output row)
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
            else:
                no_row[ticker] = status_str

    # ── Silent-rot guard: name every instrument that produced no output ──
    unfetched = [t for t in inst_by_tick if t not in data]
    if unfetched or no_row:
        print(f'\n  ⚠  {len(unfetched) + len(no_row)} of {len(instruments)} '
              f'instruments produced NO output:')
        for t in sorted(unfetched)[:20]:
            print(f'     {inst_by_tick[t]["name"]:<12} ({t}) — no data fetched')
        for t, reason in sorted(no_row.items())[:20]:
            print(f'     {inst_by_tick.get(t, {}).get("name", t):<12} ({t}) — {reason}')
        extra = len(unfetched) + len(no_row) - 40
        if extra > 0:
            print(f'     ... and {extra} more')

    if not rows:
        print('\n  No output rows generated.')
        sys.exit(1)

    _e3 = _time.time() - _t3
    print(f'\n  Signals: {int(_e3 // 60)}m {int(_e3 % 60):02d}s')

    # 4. Build output DataFrame
    output_df = pd.DataFrame(rows)

    # 5. Write output
    print(f'\n  Writing output for {len(output_df)} instruments ...\n')
    write_output(output_df, run_date)

    # 5b. Write trend segments JSON
    import json
    output_dir  = config.OUTPUT_DIR
    os.makedirs(output_dir, exist_ok=True)
    trends_path = os.path.join(output_dir, f'trends_{run_date}.json')
    with open(trends_path, 'w') as tf:
        json.dump(all_trends, tf, separators=(',', ':'))
    print(f'  Trend history: {trends_path}')

    # 5c. Live signal ledger — record today's fires, grade earlier ones
    from signal_ledger import update_ledger
    update_ledger(output_df)

    # 5d. Sector activity series — upsert today's per-sector rows + radar json
    from sector_activity import update_all_timeframes
    # Every radar timeframe (D + W), each isolated so one failing cannot stop
    # the other or the run. instrument_flavours.json stays DAILY-only — the
    # guard is in sector_activity.write_radar(), not here.
    update_all_timeframes(output_df)

    # 5d-bis. Chart shape similarity — which charts look like each other, and
    #         therefore which 'separate' positions are really one bet.
    #         Cross-instrument, so it runs here rather than per-instrument.
    from shape_similarity import write as write_shape_similarity
    write_shape_similarity(instruments)

    # 5d-ter. Sector rotation wheel + market ranking + its forward paper record.
    #         Isolated like the radar: a failure here must not cost the signals;
    #         tools/health_check.py flags the two files going stale instead.
    try:
        from rotation import update as update_rotation
        update_rotation(instruments)
    except Exception:
        import traceback
        print('\n  Rotation: FAILED')
        traceback.print_exc()

    # 5e. Scheduled events — earnings/ex-div dates for the calendar tab.
    #     Never fatal: a Yahoo metadata outage must not cost a day of signals.
    from events import write_events
    write_events(instruments)

    # 6. Summary to console
    print('\n  Signal summary:')
    _print_summary(output_df)

    # 6b. Flow volumes (aggregate index volume by region)
    compute_flow_volumes(output_df, run_date)

    # 7. Upload data to R2 + update live app
    #
    # If this step fails, the generated signals_*.csv are already on disk in
    # OUTPUT_DIR. publish.py reads those CSVs (it does NOT re-fetch market data
    # or recompute signals), so recovery is cheap — just re-run the upload alone:
    _RECOVER_MSG = ('           Data is generated and on disk — re-run the upload only '
                    '(no regeneration):\n'
                    f'           cd swing_generator && python3 webapp/publish.py --profile {PROFILE}')
    print('\n  Uploading data to R2 ...\n')
    try:
        import subprocess
        # Timeout 5400s (90 min) — uploads ~720+ files at 8x parallelism. R2 429s
        # are retried with exponential backoff (see publish.py), so a throttled run
        # can take far longer than the old 15-min cap allowed. Matches the CI step's
        # timeout-minutes: 90 so the workflow wall is the real guard, not this.
        publish_cmd = [sys.executable, os.path.join(os.path.dirname(__file__), 'webapp', 'publish.py'),
                       '--profile', PROFILE]
        result = subprocess.run(
            publish_cmd,
            cwd=os.path.dirname(__file__),
            env={**os.environ, 'PATH': '/usr/local/bin:' + os.environ.get('PATH', '')},
            timeout=5400,
        )
        if result.returncode == 0:
            print('\n  ✓ App updated! https://swingpulse200.pages.dev')
        else:
            print('\n  [Publish] R2 upload failed — CI run will be marked red.')
            print(_RECOVER_MSG)
            sys.exit(result.returncode)  # propagate failure so CI shows red
    except subprocess.TimeoutExpired:
        print('\n  [Publish] Timed out after 90 min.')
        print(_RECOVER_MSG)
        sys.exit(1)
    except Exception as e:
        print(f'\n  [Publish] Skipped: {e}')
        sys.exit(1)

    elapsed = _time.time() - _t0
    m, s = divmod(int(elapsed), 60)
    print(f'\n  Done — {run_date}  ⏱  {m}m {s:02d}s\n')


def compute_flow_volumes(output_df: pd.DataFrame, run_date: date) -> None:
    """
    Aggregate daily volume across Index instruments by region.
    Appends to output_ma500/flow_volumes.csv (append-only, one row per date/region).
    On first run, backfills from all existing signals_*.csv files.
    """
    import glob

    # Region mapping from group values in Instruments.txt
    REGION_MAP = {
        'US Index':   'US',
        'EU Index':   'EU',
        'Asia Index': 'Asian',
        'CA Index':   'Other',
    }
    INDEX_GROUPS = set(REGION_MAP.keys())
    FLOW_COLS = ['date', 'group', 'region', 'total_volume', 'instrument_count']
    FLOW_PATH = os.path.join(config.OUTPUT_DIR, 'flow_volumes.csv')

    # Load existing flow data
    if os.path.exists(FLOW_PATH):
        existing = pd.read_csv(FLOW_PATH, dtype=str)
        existing_dates = set(existing['date'].astype(str))
    else:
        existing = pd.DataFrame(columns=FLOW_COLS)
        existing_dates = set()

    def _aggregate(df: pd.DataFrame, date_str: str) -> list[dict]:
        """Return 5 rows (All + 4 regions) for one date's signals df."""
        idx = df[df['group'].isin(INDEX_GROUPS)].copy()
        if idx.empty:
            return []
        idx['_vol'] = pd.to_numeric(idx['volume'], errors='coerce').fillna(0)
        idx['_region'] = idx['group'].map(REGION_MAP)
        rows = []
        for region in ['All', 'US', 'EU', 'Asian', 'Other']:
            subset = idx if region == 'All' else idx[idx['_region'] == region]
            rows.append({
                'date':             date_str,
                'group':            'Indices',
                'region':           region,
                'total_volume':     int(subset['_vol'].sum()),
                'instrument_count': len(subset),
            })
        return rows

    new_rows: list[dict] = []

    # Backfill from existing signals CSVs (skips any already in the file)
    pattern = os.path.join(config.OUTPUT_DIR, 'signals_????-??-??.csv')
    for fpath in sorted(glob.glob(pattern)):
        date_str = os.path.basename(fpath).replace('signals_', '').replace('.csv', '')
        if date_str in existing_dates:
            continue
        try:
            hist_df = pd.read_csv(fpath, dtype=str)
            new_rows.extend(_aggregate(hist_df, date_str))
            existing_dates.add(date_str)
        except Exception as exc:
            print(f'  Flow: skipped {date_str} ({exc})')

    # Today's data from the already-computed output_df
    today_str = run_date.isoformat()
    if today_str not in existing_dates:
        new_rows.extend(_aggregate(output_df.astype(str), today_str))

    if new_rows:
        combined = pd.concat(
            [existing, pd.DataFrame(new_rows, columns=FLOW_COLS)],
            ignore_index=True,
        )
        combined = combined.drop_duplicates(subset=['date', 'group', 'region'], keep='last')
        combined = combined.sort_values('date').reset_index(drop=True)
        os.makedirs(os.path.dirname(FLOW_PATH), exist_ok=True)
        combined.to_csv(FLOW_PATH, index=False)
        n_dates = combined['date'].nunique()
        print(f'  Flow: wrote {len(combined)} rows ({n_dates} dates) → flow_volumes.csv')
    else:
        print(f'  Flow: already up to date')


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
                      f'order: {r.get("ma_order_score","")}/{len(MA_PERIODS) - 1}')


if __name__ == '__main__':
    main()
