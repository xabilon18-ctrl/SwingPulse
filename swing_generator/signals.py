"""
Signal detection engine — B1/S1 · B2–B7 · S2–S7 system.

B1 / S1  — Trend reversal.
    B1: instrument was trading below all MAs, crosses UP through all of them.
        Fires the bar that close clears the HIGHEST ribbon MA (strictly above
        every MA — in a mixed ribbon that is not necessarily MA500).
    S1: mirror — was above all MAs, crosses DOWN below the LOWEST ribbon MA.

    Re-fire: B1/S1 fires again while price stays within REFIRE_PCT of MA500
             (price bouncing near the last MA, confirming the level).

    NEW TREND zone: REFIRE_PCT < dist_from_MA500 ≤ NEW_TREND_PCT.
        No pullback signals fire here — trend is not yet established.

B2–B7 / S2–S7  — Pullback signals (active only once dist_from_MA500 > NEW_TREND_PCT).
    Key MA levels: 25, 100, 200, 300, 400, 500.
    Watch level is determined by where the current close sits:
        close ≥ MA25    → watch MA25  → B2 / S2
        close < MA25    → watch MA100 → B3 / S3
        close < MA100   → watch MA200 → B4 / S4
        close < MA200   → watch MA300 → B5 / S5
        close < MA300   → watch MA400 → B6 / S6
        close < MA400   → watch MA500 → B7 / S7
    Signal fires when candle WICK (low/high) touches the watch MA AND
    close confirms above (buy) / below (sell) that MA.

Per-timeframe thresholds (passed in by main.py):
    Timeframe  refire_pct  new_trend_pct
    4H         0.02        0.05
    Daily      0.05        0.10
    Weekly     0.08        0.15
    Monthly    0.12        0.20
"""

import pandas as pd

from _active_config import MA_PERIODS, MA_TOUCH_TOLERANCE, WATCH_APPROACH_PCT

# ---------------------------------------------------------------------------
# Pullback signal levels and their signal codes
# ---------------------------------------------------------------------------
PULLBACK_LEVELS = [25, 100, 200, 300, 400, 500]

_LEVEL_TO_SIGNAL = {
    25:  ('B2', 'S2'),
    100: ('B3', 'S3'),
    200: ('B4', 'S4'),
    300: ('B5', 'S5'),
    400: ('B6', 'S6'),
    500: ('B7', 'S7'),
}

# Default thresholds (daily)
_DEFAULT_REFIRE_PCT    = 0.05
_DEFAULT_NEW_TREND_PCT = 0.10

# B1/S1 re-fire dedup: suppress repeat fires within this many bars
_REFIRE_DEDUP_BARS = 5


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _watch_level_up(close: float, mas: dict) -> int | None:
    """
    Return the pullback MA level to watch for a buy signal.
    Lowest pullback level that close is currently AT OR ABOVE.
    e.g. close above MA25 → watch MA25 (B2)
         close below MA25 but above MA100 → watch MA100 (B3)
    """
    for p in PULLBACK_LEVELS:
        ma_val = mas.get(p)
        if ma_val is None:
            continue
        if close >= ma_val:
            return p
    return None


def _watch_level_down(close: float, mas: dict) -> int | None:
    """
    Return the rally MA level to watch for a sell signal.
    Lowest pullback level that close is AT OR BELOW.
    e.g. close below MA25 → watch MA25 (S2)
         close above MA25 but below MA100 → watch MA100 (S3)
    """
    for p in PULLBACK_LEVELS:
        ma_val = mas.get(p)
        if ma_val is None:
            continue
        if close <= ma_val:
            return p
    return None


def _signal_confidence(signal: str, vol_spike: bool, at_key_level: bool,
                       roll_dir: str = 'none', roll_stage: int = 0) -> str:
    if not signal:
        return ''
    # B1/S1 — crossed ALL MAs — always high conviction by definition
    if signal in ('B1', 'S1'):
        return 'high'
    # B7/S7 — bounced off anchor MA500 — always high conviction
    if signal in ('B7', 'S7'):
        return 'high'

    is_buy  = signal.startswith('B')

    # Ribbon-rollover confluence: a deep flip (drivers through the anchors) in
    # the signal's direction is structural confirmation of the reversal.
    roll_aligned = (is_buy and roll_dir == 'bull') or (not is_buy and roll_dir == 'bear')
    if roll_aligned and roll_stage >= 3:   # full driver flip → high on its own
        return 'high'

    # B2–B6 / S2–S6 — pullback entries, confluence upgrades confidence
    if vol_spike and at_key_level:
        return 'high'
    if (vol_spike or at_key_level) or (roll_aligned and roll_stage >= 2):  # stage 2 bump
        return 'standard'
    return 'low'


def _append_empty(statuses, primaries, secondaries, confidences,
                  watches, ttps, new_trend_flags):
    statuses.append('No data')
    primaries.append('')
    secondaries.append('')
    confidences.append('')
    watches.append('')
    ttps.append('')
    new_trend_flags.append(False)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def add_signals(df: pd.DataFrame, ma_periods=None,
                refire_pct=None, new_trend_pct=None,
                touch_tolerance=None,
                key_levels_df=None) -> pd.DataFrame:
    """
    Process the full instrument history and add signal columns.
    Iterates rows sequentially — stateful B1/S1 tracking.

    Parameters
    ----------
    refire_pct    : float  Fraction from MA500 where B1/S1 can re-fire (default 0.05).
    new_trend_pct : float  Fraction from MA500 beyond which B2-B7 become active (default 0.10).
    """
    _ma_p   = ma_periods or MA_PERIODS
    _ma500  = max(_ma_p)   # MA500 — longest / anchor
    _ma25   = min(_ma_p)   # MA25  — shortest / fastest
    _tol    = touch_tolerance if touch_tolerance is not None else MA_TOUCH_TOLERANCE
    _refire = refire_pct    if refire_pct    is not None else _DEFAULT_REFIRE_PCT
    _new_tr = new_trend_pct if new_trend_pct is not None else _DEFAULT_NEW_TREND_PCT

    key_level_prices = []
    if key_levels_df is not None and not key_levels_df.empty:
        key_level_prices = [
            float(r['price'])
            for _, r in key_levels_df.iterrows()
            if r.get('touch_count', 0) >= 3
        ]

    statuses        = []
    primaries       = []
    secondaries     = []
    confidences     = []
    watches         = []
    ttps            = []
    run_days        = []
    established_trends = []
    new_trend_flags = []

    # Persistent state
    trend_run         = 0
    last_trend_dir    = None   # UPTREND / DOWNTREND / NEUTRAL  (for trend_run_days compat)
    in_uptrend        = False  # B1 has fired; we are in an uptrend
    in_downtrend      = False  # S1 has fired; we are in a downtrend
    was_below_all     = False  # price closed below every ribbon MA (arms B1)
    was_above_all     = False  # price closed above every ribbon MA (arms S1)
    last_b1_bar       = -(_REFIRE_DEDUP_BARS + 1)
    last_s1_bar       = -(_REFIRE_DEDUP_BARS + 1)

    # Pre-extract numpy arrays — per-row Series access (rows.iloc[i]) was a
    # major hot spot (~700k pandas __getitem__ calls per instrument).
    n          = len(df)
    closes_arr = df['Close'].to_numpy(dtype=float)
    lows_arr   = df['Low'].to_numpy(dtype=float)
    highs_arr  = df['High'].to_numpy(dtype=float)
    ma_arrays  = {p: df[f'ma_{p}'].to_numpy(dtype=float)
                  for p in _ma_p if f'ma_{p}' in df.columns}

    def _col(name, default):
        if name in df.columns:
            return df[name].to_numpy()
        import numpy as _np
        return _np.full(n, default, dtype=object)

    vol_spike_arr   = _col('volume_spike_flag', False)
    neutral_arr     = _col('neutral_oscillation', False)
    cross_count_arr = _col('ma25_cross_count', 0)
    roll_dir_arr    = _col('rollover_dir', 'none')
    roll_stage_arr  = _col('rollover_stage', 0)

    import math

    for i in range(n):
        close = closes_arr[i]
        low   = lows_arr[i]
        high  = highs_arr[i]

        if math.isnan(close) or math.isnan(low) or math.isnan(high):
            run_days.append(trend_run)
            established_trends.append('')
            _append_empty(statuses, primaries, secondaries,
                          confidences, watches, ttps, new_trend_flags)
            continue

        close = float(close)
        low   = float(low)
        high  = float(high)

        today_mas = {p: arr[i] for p, arr in ma_arrays.items()
                     if not math.isnan(arr[i])}
        ma500_val = today_mas.get(_ma500)
        ma25_val  = today_mas.get(_ma25)

        # Need anchor MAs to compute signals
        if ma500_val is None or ma25_val is None:
            run_days.append(trend_run)
            established_trends.append('')
            _append_empty(statuses, primaries, secondaries,
                          confidences, watches, ttps, new_trend_flags)
            continue

        # ── Positional flags ────────────────────────────────────────────────
        # Strict all-MA test: compare against the actual ribbon extremes — in a
        # mixed/transitional ribbon MA500 is not necessarily the highest MA and
        # MA25 not the lowest, so close > MA500 alone doesn't mean every MA
        # was crossed.
        ma_max = max(today_mas.values())
        ma_min = min(today_mas.values())
        above_anchor = close > ma500_val   # above the anchor MA500 (pullback territory)
        above_all    = close > ma_max      # above EVERY MA in ribbon
        below_all    = close < ma_min      # below EVERY MA in ribbon

        # Arm the reversal detectors
        if below_all:
            was_below_all = True
        if above_all:
            was_above_all = True

        # ── trend_direction for compat / display ────────────────────────────
        if above_all:
            trend_dir = 'UPTREND'
        elif below_all:
            trend_dir = 'DOWNTREND'
        else:
            trend_dir = 'NEUTRAL'

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

        # ── Confluence checks ───────────────────────────────────────────────
        vol_spike    = bool(vol_spike_arr[i])
        at_key_level = any(
            kl > 0 and abs(close - kl) / kl < 0.005
            for kl in key_level_prices
        )
        neutral_osc  = bool(neutral_arr[i])
        cross_count  = int(cross_count_arr[i])
        roll_dir     = roll_dir_arr[i]
        roll_stage   = int(roll_stage_arr[i] or 0)

        signal   = ''
        status   = ''
        watch    = ''
        new_trend = False

        # ── Distance from MA500 (positive = above, negative = below) ────────
        dist = (close - ma500_val) / ma500_val

        # ================================================================
        # B1 — Bullish trend reversal  /  B2–B7 — Bullish pullbacks
        # above_anchor (close > MA500) covers two sub-zones:
        #   a) above_all  : price above the ENTIRE ribbon → B1 territory
        #   b) otherwise  : price pulled back into ribbon → B2–B7 territory
        # ================================================================
        if above_anchor:
            in_ribbon = not above_all

            if not in_ribbon:
                # ── (a) Price above all MAs ──────────────────────────────
                if was_below_all and not in_uptrend:
                    # Initial B1: crossed all MAs from below
                    signal       = 'B1'
                    status       = f'Trend reversal — B1: price crossed above all MAs (MA{_ma25}–MA{_ma500})'
                    in_uptrend   = True
                    in_downtrend = False
                    was_below_all = False
                    last_b1_bar  = i

                elif in_uptrend and 0 <= dist <= _refire:
                    # Re-fire: price bouncing near MA500
                    if (i - last_b1_bar) >= _REFIRE_DEDUP_BARS:
                        signal      = 'B1'
                        status      = (f'B1 re-fire — price within {_refire*100:.0f}% '
                                       f'of MA{_ma500}, confirming support')
                        last_b1_bar = i

                if not signal and in_uptrend:
                    if _refire < dist <= _new_tr:
                        new_trend = True
                        status    = (f'New trend — B1 confirmed, consolidating '
                                     f'{dist*100:.1f}% above MA{_ma500}')
                    elif dist > _new_tr:
                        status = f'Uptrend established — {dist*100:.1f}% above MA{_ma500}'
                    elif not status:
                        status = f'Uptrend — above all MAs'

            else:
                # ── (b) Price pulled back into ribbon (above MA500, not above all MAs) ─
                # B7 special case: wick touched MA500, close confirmed above.
                # Must be checked before dist > _new_tr gate — B7 fires precisely
                # when price is near MA500, which is always inside the new-trend zone.
                if in_uptrend and low <= ma500_val * (1 + _tol):
                    signal = 'B7'
                    status = (f'Uptrend pullback — B7: wick touched MA{_ma500}, '
                              f'close confirmed above')
                elif in_uptrend and dist > _new_tr:
                    # Established uptrend pullback → B2–B6
                    watch_lvl = _watch_level_up(close, today_mas)
                    if watch_lvl is not None:
                        ma_val = today_mas.get(watch_lvl)
                        if ma_val is not None:
                            buy_sig, _ = _LEVEL_TO_SIGNAL.get(watch_lvl, ('', ''))
                            touched = low <= ma_val * (1 + _tol)
                            if touched and close > ma_val and buy_sig:
                                signal = buy_sig
                                status = (f'Uptrend pullback — {buy_sig}: '
                                          f'wick touched MA{watch_lvl}, close confirmed above')
                            elif touched:
                                status = (f'Uptrend — wick on MA{watch_lvl}, '
                                          f'waiting for close above to confirm')
                                watch  = (f'Wick touched MA{watch_lvl} — '
                                          f'waiting for close above to confirm')
                            else:
                                status = f'Uptrend — watching MA{watch_lvl} for pullback entry'
                                approach = (low - ma_val) / ma_val
                                if 0 < approach <= WATCH_APPROACH_PCT:
                                    watch = (f'Approaching MA{watch_lvl} — '
                                             f'{approach*100:.1f}% above')
                    else:
                        status = 'Uptrend — price below all pullback levels (deep pullback)'
                elif in_uptrend and _refire < dist <= _new_tr:
                    new_trend = True
                    status    = (f'New trend — B1 confirmed, consolidating '
                                 f'{dist*100:.1f}% above MA{_ma500}')
                elif in_uptrend:
                    status = f'Uptrend — pulling back into ribbon'
                else:
                    status = 'Neutral — price in ribbon, no established trend'

        # ================================================================
        # S1 — Bearish trend reversal
        # ================================================================
        elif below_all:
            dist_neg = -dist   # positive value = how far below MA500

            if was_above_all and not in_downtrend:
                # Initial S1
                signal        = 'S1'
                status        = f'Trend reversal — S1: price crossed below all MAs (MA{_ma25}–MA{_ma500})'
                in_downtrend  = True
                in_uptrend    = False
                was_above_all = False
                last_s1_bar   = i

            elif in_downtrend and 0 <= dist_neg <= _refire:
                if (i - last_s1_bar) >= _REFIRE_DEDUP_BARS:
                    signal      = 'S1'
                    status      = (f'S1 re-fire — price within {_refire*100:.0f}% '
                                   f'of MA{_ma500}, confirming resistance')
                    last_s1_bar = i

            if not signal and in_downtrend:
                if _refire < dist_neg <= _new_tr:
                    new_trend = True
                    status    = (f'New trend — S1 confirmed, consolidating '
                                 f'{dist_neg*100:.1f}% below MA{_ma500}')
                elif dist_neg > _new_tr:
                    status = f'Downtrend established — {dist_neg*100:.1f}% below MA{_ma500}'
                elif not status:
                    status = f'Downtrend — below all MAs'

        # ================================================================
        # S7 special case — wick touched MA500 in downtrend.
        # Checked before (-dist) > _new_tr gate for the same reason as B7:
        # S7 fires precisely near MA500, which is always inside the new-trend zone.
        # close confirmed below MA500 is guaranteed here (above_anchor=False).
        # ================================================================
        elif in_downtrend and high >= ma500_val * (1 - _tol):
            signal = 'S7'
            status = (f'Downtrend rally — S7: wick touched MA{_ma500}, '
                      f'close confirmed below')

        # ================================================================
        # S2–S6 — Bearish rallies (established downtrend, out of NEW TREND zone)
        # ================================================================
        elif in_downtrend and (-dist) > _new_tr:
            watch_lvl = _watch_level_down(close, today_mas)
            if watch_lvl is not None:
                ma_val = today_mas.get(watch_lvl)
                if ma_val is not None:
                    _, sell_sig = _LEVEL_TO_SIGNAL.get(watch_lvl, ('', ''))
                    touched = high >= ma_val * (1 - _tol)
                    if touched and close < ma_val and sell_sig:
                        signal = sell_sig
                        status = (f'Downtrend rally — {sell_sig}: '
                                  f'wick touched MA{watch_lvl}, close confirmed below')
                    elif touched:
                        status = (f'Downtrend — wick on MA{watch_lvl}, '
                                  f'waiting for close below to confirm')
                        watch  = (f'Wick touched MA{watch_lvl} — '
                                  f'waiting for close below to confirm')
                    else:
                        status = f'Downtrend — watching MA{watch_lvl} for rally entry'
                        approach = (ma_val - high) / ma_val
                        if 0 < approach <= WATCH_APPROACH_PCT:
                            watch = (f'Approaching MA{watch_lvl} — '
                                     f'{approach*100:.1f}% below')
            else:
                status = 'Downtrend — price above all rally levels (deep rally)'

        # ================================================================
        # Neutral / no established trend
        # ================================================================
        else:
            if in_uptrend and not new_trend:
                status = f'Uptrend — price in NEW TREND zone, {dist*100:.1f}% above MA{_ma500}'
            elif in_downtrend and not new_trend:
                status = f'Downtrend — price in NEW TREND zone, {(-dist)*100:.1f}% below MA{_ma500}'
            else:
                status = 'Neutral — no established trend direction'

        conf = _signal_confidence(signal, vol_spike, at_key_level,
                                  roll_dir=roll_dir, roll_stage=roll_stage)

        # ── Neutral oscillation → potential turning point flag ──────────────
        ttp = ''
        if neutral_osc:
            direction = 'top' if (in_uptrend or above_all) else 'bottom' if (in_downtrend or below_all) else 'reversal'
            ttp = (
                f'Potential {direction} — price crossed MA{_ma25} {cross_count}x '
                f'in last 30 bars with MA100 slope flattening'
            )

        statuses.append(status)
        primaries.append(signal)
        secondaries.append('')
        confidences.append(conf)
        watches.append(watch)
        ttps.append(ttp)
        new_trend_flags.append(new_trend)

    df = df.copy()
    df['trend_run_days']               = run_days
    df['established_trend']            = established_trends
    df['confirmation_status']          = statuses
    df['primary_signal']               = primaries
    df['secondary_signal']             = secondaries
    df['signal_confidence']            = confidences
    df['watch_flag']                   = watches
    df['potential_turning_point_flag'] = ttps
    df['new_trend_flag']               = new_trend_flags

    return df
