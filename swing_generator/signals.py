"""
Signal detection engine — B1/S1 · B2/S2 · B3/S3 · B4/S4 system.

B1 — Trend breakout: close crosses above ALL MAs. Sets in_uptrend.
     Re-fire: pulls back within refire_pct of MA500, 5-bar dedup.
S1 — Mirror of B1 (below all MAs). Sets in_downtrend.

B2 — Pullback recovery (established uptrend): dips below MA25, crosses back above.
S2 — Mirror of B2 (established downtrend): rallies above MA25, crosses back below.

B3 — Mid-ribbon bounce (established uptrend): wick touches MA250, close above.
S3 — Mirror of B3 (established downtrend): wick touches MA250, close below.

B4 — Anchor bounce (established uptrend): wick touches MA500, close above.
S4 — Mirror of B4 (established downtrend): wick touches MA500, close below.

5-bar dedup per signal code prevents per-bar spam.

Per-bar evaluation priority (one signal per bar, deepest setup wins):
B1/S1 primary cross > active B1/S1 re-fire window > 4 > 3 > 2.
Setup families are gated by established trend (in_uptrend/in_downtrend),
not by which side of the MA500 anchor the close landed on.
"""

import json
import os

import pandas as pd

from _active_config import MA_PERIODS, MA_TOUCH_TOLERANCE

_DEFAULT_REFIRE_PCT = 0.02
_REFIRE_DEDUP_BARS = 5
_REFIRE_WINDOW_DAYS = 10   # B1/S1 re-fire allowed only within N calendar days of the original cross
_MA_MID = 250

# Backtest-derived confidence tiers, produced by backtest.py write_confidence_map().
# Keys: "TF|CODE|CLASS" (e.g. "D|B2|Equity") with "TF|CODE" fallbacks.
_CONF_MAP_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              'confidence_map.json')
_conf_tiers = None
_conf_loaded = False

# Fix 1.1/1.3 (signal-rules audit): the primary B1/S1 trigger is MA500-anchored.
# A fresh B1/S1 fires only when price clears the full ribbon FROM a non-uptrend /
# non-downtrend state (gated by in_uptrend/in_downtrend), not on the 1-bar all-MA
# edge. In an established trend the trend-state flag blocks fast-MA re-cross noise
# (min/max(all MAs) degrades to MA25 once the ribbon inverts). Set False to restore
# the old "strict all-MA, 1-bar edge" behavior.
B1S1_ANCHOR_GATE = True


def _load_conf_tiers():
    global _conf_tiers, _conf_loaded
    if not _conf_loaded:
        _conf_loaded = True
        try:
            with open(_CONF_MAP_PATH) as f:
                _conf_tiers = json.load(f).get('tiers') or None
        except Exception:
            _conf_tiers = None
    return _conf_tiers


def _signal_confidence(signal: str, tf: str, asset_class: str) -> str:
    """Confidence = measured backtest expectancy for this signal code on this
    timeframe/asset class (see backtest.py). Falls back tf|code → 'standard'
    when the cell has too few trades; 'high' everywhere if no map exists."""
    if not signal:
        return ''
    tiers = _load_conf_tiers()
    if tiers is None:
        return 'high'   # no confidence map — legacy behavior
    hit = tiers.get(f'{tf}|{signal}|{asset_class}') or tiers.get(f'{tf}|{signal}')
    return hit['tier'] if hit else 'standard'


def add_signals(df: pd.DataFrame, ma_periods=None,
                refire_pct=None, new_trend_pct=None,
                touch_tolerance=None,
                key_levels_df=None,
                tf='D', asset_class='') -> pd.DataFrame:
    _ma_p   = ma_periods or MA_PERIODS
    _ma500  = max(_ma_p)
    _ma25   = min(_ma_p)
    _ma250  = _MA_MID if _MA_MID in _ma_p else _ma_p[len(_ma_p) // 2]
    _tol    = touch_tolerance if touch_tolerance is not None else MA_TOUCH_TOLERANCE
    _refire = refire_pct if refire_pct is not None else _DEFAULT_REFIRE_PCT

    statuses        = []
    primaries       = []
    confidences     = []
    watches         = []
    ttps            = []
    run_days        = []
    established_trends = []
    new_trend_flags = []

    prev_above_all     = False
    prev_below_all     = False
    in_uptrend         = False
    in_downtrend       = False
    pulled_below_ma25  = False
    pushed_above_ma25  = False
    last_fired         = {c: -(_REFIRE_DEDUP_BARS + 1)
                          for c in ('B1', 'S1', 'B2', 'S2', 'B3', 'S3', 'B4', 'S4')}
    trend_run          = 0
    last_trend_dir     = None
    # B1/S1 re-fire window: timestamp of the most recent *primary* cross per code,
    # plus whether price sat inside the 2% re-fire band on the previous bar (so a
    # re-fire fires once on re-entry, not on every bar it lingers in the band).
    last_primary_ts    = {'B1': None, 'S1': None}
    prev_b1_band       = False
    prev_s1_band       = False

    n          = len(df)
    closes_arr = df['Close'].to_numpy(dtype=float)
    lows_arr   = df['Low'].to_numpy(dtype=float)
    highs_arr  = df['High'].to_numpy(dtype=float)
    ma_arrays  = {p: df[f'ma_{p}'].to_numpy(dtype=float)
                  for p in _ma_p if f'ma_{p}' in df.columns}

    import math

    for i in range(n):
        close = closes_arr[i]
        low   = lows_arr[i]
        high  = highs_arr[i]

        if math.isnan(close) or math.isnan(low) or math.isnan(high):
            run_days.append(trend_run)
            established_trends.append('')
            statuses.append('No data')
            primaries.append('')
            confidences.append('')
            watches.append('')
            ttps.append('')
            new_trend_flags.append(False)
            continue

        close = float(close)
        low   = float(low)
        high  = float(high)

        today_mas = {p: arr[i] for p, arr in ma_arrays.items()
                     if not math.isnan(arr[i])}
        ma500_val = today_mas.get(_ma500)
        ma25_val  = today_mas.get(_ma25)
        ma250_val = today_mas.get(_ma250)

        if ma500_val is None or ma25_val is None:
            run_days.append(trend_run)
            established_trends.append('')
            statuses.append('No data')
            primaries.append('')
            confidences.append('')
            watches.append('')
            ttps.append('')
            new_trend_flags.append(False)
            continue

        ma_max       = max(today_mas.values())
        ma_min       = min(today_mas.values())
        above_all    = close > ma_max
        below_all    = close < ma_min
        above_anchor = close > ma500_val
        above_ma25   = close > ma25_val
        dist         = (close - ma500_val) / ma500_val
        bar_ts       = df.index[i]
        # 2% re-fire bands around the MA500 anchor (above for B1, below for S1)
        b1_band      = above_anchor and dist <= _refire
        s1_band      = (not above_anchor) and (-dist) <= _refire

        # ── Trend run days ─────────────────────────────────────────────────
        trend_dir = 'UPTREND' if above_all else ('DOWNTREND' if below_all else 'NEUTRAL')
        if trend_dir != 'NEUTRAL' and trend_dir == last_trend_dir:
            trend_run += 1
        elif trend_dir != 'NEUTRAL':
            trend_run = 1
        else:
            trend_run = 0
        last_trend_dir = trend_dir
        run_days.append(trend_run)

        et = 'UPTREND' if in_uptrend else ('DOWNTREND' if in_downtrend else '')
        established_trends.append(et)

        # ── Arm B2/S2 ─────────────────────────────────────────────────────
        if in_uptrend and not above_ma25:
            pulled_below_ma25 = True
        if in_downtrend and above_ma25:
            pushed_above_ma25 = True

        def _can_fire(code):
            return (i - last_fired[code]) >= _REFIRE_DEDUP_BARS

        signal = ''
        status = ''

        # B1/S1 re-fire window state — days since the most recent primary
        # cross (bands are disjoint, so at most one side is computed per bar)
        _b1_days = _s1_days = None
        if b1_band and last_primary_ts['B1'] is not None:
            _b1_days = (bar_ts - last_primary_ts['B1']).days
        elif s1_band and last_primary_ts['S1'] is not None:
            _s1_days = (bar_ts - last_primary_ts['S1']).days
        b1_window = _b1_days is not None and _b1_days <= _REFIRE_WINDOW_DAYS
        s1_window = _s1_days is not None and _s1_days <= _REFIRE_WINDOW_DAYS

        # Fix 1.4 (signal-rules audit): explicit priority instead of a
        # close-vs-anchor position split. Trend-flip primaries first, then an
        # ACTIVE re-fire window, then in-trend setups gated by established
        # trend (deepest wins: anchor > mid-ribbon > MA25 recovery). An
        # expired anchor band no longer swallows B4/S4 with a status-only
        # branch, and S2/S3 (B2/B3) stay reachable on the far side of MA500.

        # ================================================================
        # B1 — close crossed above ALL MAs
        # ================================================================
        if above_all:
            _b1_edge = (not in_uptrend) if B1S1_ANCHOR_GATE else (not prev_above_all)
            if _b1_edge and _can_fire('B1'):
                signal = 'B1'
                status = f'Trend breakout — B1: price crossed above all MAs (MA{_ma25}–MA{_ma500})'
                last_fired['B1'] = i
                last_primary_ts['B1'] = bar_ts   # start the 10-day re-fire window
                last_primary_ts['S1'] = None      # opposite cross cancels its window
                in_uptrend        = True
                in_downtrend      = False
                pulled_below_ma25 = False
                pushed_above_ma25 = False
            else:
                status = 'Uptrend — above all MAs'

        # ================================================================
        # S1 — close crossed below ALL MAs
        # ================================================================
        elif below_all:
            _s1_edge = (not in_downtrend) if B1S1_ANCHOR_GATE else (not prev_below_all)
            if _s1_edge and _can_fire('S1'):
                signal = 'S1'
                status = f'Trend breakdown — S1: price crossed below all MAs (MA{_ma25}–MA{_ma500})'
                last_fired['S1'] = i
                last_primary_ts['S1'] = bar_ts   # start the 10-day re-fire window
                last_primary_ts['B1'] = None      # opposite cross cancels its window
                in_downtrend      = True
                in_uptrend        = False
                pulled_below_ma25 = False
                pushed_above_ma25 = False
            else:
                status = 'Downtrend — below all MAs'

        # ================================================================
        # B1 re-fire — pulled back within refire_pct of MA500 inside an
        # active 10-day window (the band only claims the bar while armed)
        # ================================================================
        elif b1_band and b1_window:
            if not prev_b1_band:
                signal = 'B1'
                status = (f'B1 re-fire — pulled back within {_refire*100:.0f}% of '
                          f'MA{_ma500} ({_b1_days}d after cross)')
            else:
                status = f'Near MA{_ma500} — watching for B1 re-fire'

        # ================================================================
        # S1 re-fire — rallied within refire_pct below MA500 inside an
        # active 10-day window
        # ================================================================
        elif s1_band and s1_window:
            if not prev_s1_band:
                signal = 'S1'
                status = (f'S1 re-fire — rallied within {_refire*100:.0f}% of '
                          f'MA{_ma500} ({_s1_days}d after cross)')
            else:
                status = f'Near MA{_ma500} — watching for S1 re-fire'

        # ================================================================
        # B4 — established uptrend, wick touched MA500, close above
        # ================================================================
        elif in_uptrend and above_anchor and low <= ma500_val * (1 + _tol):
            if _can_fire('B4'):
                signal = 'B4'
                status = f'Anchor bounce — B4: wick touched MA{_ma500}, close confirmed above'
                last_fired['B4'] = i
            else:
                status = f'Wick on MA{_ma500}, waiting for dedup window'

        # ================================================================
        # B3 — established uptrend, wick touched MA250, close above
        # ================================================================
        elif in_uptrend and ma250_val is not None and low <= ma250_val * (1 + _tol) and close > ma250_val:
            if _can_fire('B3'):
                signal = 'B3'
                status = f'Mid-ribbon bounce — B3: wick touched MA{_ma250}, close confirmed above'
                last_fired['B3'] = i
            else:
                status = f'Wick on MA{_ma250}, waiting for dedup window'

        # ================================================================
        # B2 — established uptrend, pulled below MA25, now crossed back above
        # ================================================================
        elif in_uptrend and pulled_below_ma25 and above_ma25:
            if _can_fire('B2'):
                signal = 'B2'
                status = f'Pullback recovery — B2: price crossed back above MA{_ma25}'
                last_fired['B2'] = i
                pulled_below_ma25 = False
            else:
                status = f'Crossed MA{_ma25} — waiting for dedup window'

        # ================================================================
        # S4 — established downtrend, wick touched MA500, close below
        # ================================================================
        elif in_downtrend and not above_anchor and high >= ma500_val * (1 - _tol):
            if _can_fire('S4'):
                signal = 'S4'
                status = f'Rally rejection — S4: wick touched MA{_ma500}, close confirmed below'
                last_fired['S4'] = i
            else:
                status = f'Wick on MA{_ma500}, waiting for dedup window'

        # ================================================================
        # S3 — established downtrend, wick touched MA250, close below
        # ================================================================
        elif in_downtrend and ma250_val is not None and high >= ma250_val * (1 - _tol) and close < ma250_val:
            if _can_fire('S3'):
                signal = 'S3'
                status = f'Mid-ribbon rejection — S3: wick touched MA{_ma250}, close confirmed below'
                last_fired['S3'] = i
            else:
                status = f'Wick on MA{_ma250}, waiting for dedup window'

        # ================================================================
        # S2 — established downtrend, pushed above MA25, now crossed back below
        # ================================================================
        elif in_downtrend and pushed_above_ma25 and not above_ma25:
            if _can_fire('S2'):
                signal = 'S2'
                status = f'Rally rejection — S2: price crossed back below MA{_ma25}'
                last_fired['S2'] = i
                pushed_above_ma25 = False
            else:
                status = f'Crossed MA{_ma25} — waiting for dedup window'

        # ================================================================
        # No setup — trend-aware watching status
        # ================================================================
        elif in_uptrend:
            status = (f'Above MA{_ma500} — watching for pullback entry'
                      if above_anchor else
                      f'Pullback below MA{_ma500} — uptrend intact, watching for recovery')
        elif in_downtrend:
            status = (f'Below MA{_ma500} — watching for rally rejection'
                      if not above_anchor else
                      f'Rally above MA{_ma500} — downtrend intact, watching for rejection')
        else:
            status = (f'Above MA{_ma500} — watching for pullback entry'
                      if above_anchor else
                      f'Below MA{_ma500} — watching for rally rejection')

        conf = _signal_confidence(signal, tf, asset_class)

        prev_above_all = above_all
        prev_below_all = below_all
        prev_b1_band   = b1_band
        prev_s1_band   = s1_band

        statuses.append(status)
        primaries.append(signal)
        confidences.append(conf)
        watches.append('')
        ttps.append('')
        new_trend_flags.append(False)

    df = df.copy()
    df['trend_run_days']               = run_days
    df['established_trend']            = established_trends
    df['confirmation_status']          = statuses
    df['primary_signal']               = primaries
    df['signal_confidence']            = confidences
    df['watch_flag']                   = watches
    df['potential_turning_point_flag'] = ttps
    df['new_trend_flag']               = new_trend_flags

    return df
