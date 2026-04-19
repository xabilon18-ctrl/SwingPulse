"""
Signal detection engine.

Processes one instrument's full history DataFrame (which already has MA ribbon,
volume, trend_direction, ribbon_spread, ribbon_compression, ma_order_score, and
roc columns) and adds:

    trend_run_days              – consecutive trading days in current trend
    confirmation_status         – one of the 12+ states from the spec
    primary_signal              – P1 / P2 / P3 / P4  (or empty)
    secondary_signal            – 'secondary'  (or empty)
    signal_confidence           – 'high' / 'standard' / 'low' (or empty)
    watch_flag                  – watch description  (or empty)
    potential_turning_point_flag– alert text  (or empty)

Signal priority per row: P1 > P2 > P3 / P4 > secondary > watch > no signal.

Confidence is determined by confluence of factors:
    - Volume spike on signal bar → boost
    - Key level touched at same price zone → boost
    - No volume on signal → downgrade
    - Counter-trend on higher timeframe → flag (handled in main.py)
"""

import pandas as pd

from config import (
    MA_PERIODS,
    SMALL_MA_RANGE,
    MA_TOUCH_TOLERANCE,
    TREND_DURATION_THRESHOLD,
    WATCH_APPROACH_PCT,
    MIDPOINT_BOUNCE_PCT,
    P3P4_DEDUP_WINDOW,
    TTP_COOLDOWN_BARS,
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _ma_dict(row, ma_periods=None) -> dict:
    """Return {period: ma_value} for the row, skipping NaN values."""
    periods = ma_periods or MA_PERIODS
    return {p: row[f'ma_{p}'] for p in periods
            if pd.notna(row.get(f'ma_{p}'))}


def _touched_up(candle_low: float, ma_dict: dict,
                tolerance=None, max_penetration=None) -> list[tuple[int, float]]:
    """
    Return (period, value) pairs where the candle's LOW touched or pierced
    the MA from above — i.e. the wick reached the MA line (buy-side touch).

    max_penetration: if set, reject touches where the low is more than this
    fraction below the MA (filters out gap-down crash-and-recover noise).
    """
    tol = tolerance if tolerance is not None else MA_TOUCH_TOLERANCE
    result = []
    for p, v in ma_dict.items():
        if candle_low <= v * (1 + tol):
            if max_penetration is not None and candle_low < v * (1 - max_penetration):
                continue  # low is too far below the MA — not a genuine touch
            result.append((p, v))
    return result


def _touched_down(candle_high: float, ma_dict: dict,
                  tolerance=None, max_penetration=None) -> list[tuple[int, float]]:
    """
    Return (period, value) pairs where the candle's HIGH touched or pierced
    the MA from below — i.e. the wick reached the MA line (sell-side touch).

    max_penetration: if set, reject touches where the high is more than this
    fraction above the MA.
    """
    tol = tolerance if tolerance is not None else MA_TOUCH_TOLERANCE
    result = []
    for p, v in ma_dict.items():
        if candle_high >= v * (1 - tol):
            if max_penetration is not None and candle_high > v * (1 + max_penetration):
                continue
            result.append((p, v))
    return result


def _approaching_ma150(close: float, prev_close: float, ma_dict: dict,
                       direction: str) -> bool:
    """
    Watch flag: only trigger when price approaches the LONGEST MA (200),
    not any MA in the ribbon. This avoids constant noise in trending markets
    where price oscillates near short MAs.
    """
    max_period = max(ma_dict.keys()) if ma_dict else None
    if max_period is None:
        return False
    ma_val = ma_dict[max_period]

    if direction == 'UPTREND':
        # Price falling toward ma_150 from above
        if close >= prev_close or close <= ma_val:
            return False
        dist = (close - ma_val) / ma_val
        return dist < WATCH_APPROACH_PCT
    else:
        # Price rising toward ma_150 from below
        if close <= prev_close or close >= ma_val:
            return False
        dist = (ma_val - close) / ma_val
        return dist < WATCH_APPROACH_PCT


def _potential_turning_point(trend_run: int, close: float, ma_dict: dict) -> str:
    """Return the alert string if a potential turning-point is detected, else ''."""
    if trend_run < TREND_DURATION_THRESHOLD or not ma_dict:
        return ''
    sorted_vals = sorted(ma_dict.values())
    mid = sorted_vals[len(sorted_vals) // 2]
    if abs(close - mid) / mid <= MIDPOINT_BOUNCE_PCT:
        return (
            f'Potential turning point — trend {trend_run} days, '
            'midpoint bounce detected. May take weeks or months to develop.'
        )
    return ''


def _signal_confidence(primary: str, volume_spike: bool, at_key_level: bool) -> str:
    """
    Determine signal confidence based on confluence factors.

    High:     Volume spike + signal (institutional participation)
              OR signal at key level with 3+ touches (confluence)
    Standard: Normal signal (default)
    Low:      P3/P4 on below-average volume (weak bounce, likely to fail)
    """
    if not primary:
        return ''

    if primary in ('P1', 'P2'):
        if volume_spike and at_key_level:
            return 'high'
        if volume_spike or at_key_level:
            return 'high'
        if not volume_spike:
            return 'standard'
        return 'standard'

    # P3 / P4
    if volume_spike and at_key_level:
        return 'high'
    if volume_spike:
        return 'standard'
    if at_key_level:
        return 'standard'
    if not volume_spike:
        return 'low'
    return 'standard'


# ---------------------------------------------------------------------------
# Per-row classifiers
# ---------------------------------------------------------------------------

def _uptrend_signals(close, low, today_mas, prev_row, ttp,
                     small_ma_range=None, max_period=200,
                     tolerance=None, max_penetration=None, ma_periods=None):
    """Classify signal state for a row that is already confirmed UPTREND."""
    _small = small_ma_range or SMALL_MA_RANGE

    today_touched = _touched_up(low, today_mas, tolerance=tolerance, max_penetration=max_penetration)
    small_touched = [(p, v) for p, v in today_touched if p in _small]
    ma_top_touched = [(p, v) for p, v in today_touched if p == max_period]

    # --- P2: bounce off longest MA (200) ---
    if ma_top_touched:
        _, vtop = ma_top_touched[0]
        if close > vtop:
            return ('Uptrend — primary buy signal confirmed [P2]', 'P2', '', '', ttp)
        return ('Uptrend — waiting for reversal confirmation', '', '', '', ttp)

    # --- P3: bounce off small MA (40–100 daily, or equivalent) ---
    if small_touched:
        confirmed = [(p, v) for p, v in small_touched if close > v]
        if confirmed:
            return ('Uptrend — primary buy signal confirmed [P3]', 'P3', '', '', ttp)
        return ('Uptrend — waiting for reversal confirmation', '', '', '', ttp)

    # --- Secondary: bounce off any MA in ribbon ---
    if today_touched:
        confirmed = [(p, v) for p, v in today_touched if close > v]
        if confirmed:
            return ('Uptrend — secondary buy signal confirmed', '', 'secondary', '', ttp)
        return ('Uptrend — waiting for reversal confirmation', '', '', '', ttp)

    # --- Check YESTERDAY for a pending touch that today resolves ---
    if prev_row is not None:
        prev_mas  = _ma_dict(prev_row, ma_periods=ma_periods)
        prev_low  = float(prev_row['Low'])
        prev_touched = _touched_up(prev_low, prev_mas, tolerance=tolerance, max_penetration=max_penetration)

        if prev_touched:
            for p, pv in prev_touched:
                curr_v = today_mas.get(p)
                if curr_v is not None and close > curr_v:
                    if p == max_period:
                        return ('Uptrend — primary buy signal confirmed [P2]', 'P2', '', '', ttp)
                    if p in _small:
                        return ('Uptrend — primary buy signal confirmed [P3]', 'P3', '', '', ttp)
                    return ('Uptrend — secondary buy signal confirmed', '', 'secondary', '', ttp)
            # Touch was yesterday but close still hasn't confirmed
            return ('Uptrend — waiting for reversal confirmation', '', '', '', ttp)

    # --- Watch: approaching ma_200 only (not any MA) ---
    if prev_row is not None:
        if _approaching_ma150(close, float(prev_row['Close']), today_mas, 'UPTREND'):
            return (
                'Uptrend — watch, approaching 200 MA', '', '',
                'Watch — approaching 200 MA, potential buy setup', ttp
            )

    return ('Uptrend — no signal', '', '', '', ttp)


def _downtrend_signals(close, high, today_mas, prev_row, ttp,
                       small_ma_range=None, max_period=200,
                       tolerance=None, max_penetration=None, ma_periods=None):
    """Classify signal state for a row that is already confirmed DOWNTREND."""
    _small = small_ma_range or SMALL_MA_RANGE

    today_touched = _touched_down(high, today_mas, tolerance=tolerance, max_penetration=max_penetration)
    small_touched = [(p, v) for p, v in today_touched if p in _small]
    ma_top_touched = [(p, v) for p, v in today_touched if p == max_period]

    # --- P2: rejection from longest MA ---
    if ma_top_touched:
        _, vtop = ma_top_touched[0]
        if close < vtop:
            return ('Downtrend — primary sell signal confirmed [P2]', 'P2', '', '', ttp)
        return ('Downtrend — waiting for reversal confirmation', '', '', '', ttp)

    # --- P4: rejection from small MA ---
    if small_touched:
        confirmed = [(p, v) for p, v in small_touched if close < v]
        if confirmed:
            return ('Downtrend — primary sell signal confirmed [P4]', 'P4', '', '', ttp)
        return ('Downtrend — waiting for reversal confirmation', '', '', '', ttp)

    # --- Secondary: rejection from any MA ---
    if today_touched:
        confirmed = [(p, v) for p, v in today_touched if close < v]
        if confirmed:
            return ('Downtrend — secondary sell signal confirmed', '', 'secondary', '', ttp)
        return ('Downtrend — waiting for reversal confirmation', '', '', '', ttp)

    # --- Check YESTERDAY for a pending touch ---
    if prev_row is not None:
        prev_mas  = _ma_dict(prev_row, ma_periods=ma_periods)
        prev_high = float(prev_row['High'])
        prev_touched = _touched_down(prev_high, prev_mas, tolerance=tolerance, max_penetration=max_penetration)

        if prev_touched:
            for p, pv in prev_touched:
                curr_v = today_mas.get(p)
                if curr_v is not None and close < curr_v:
                    if p == max_period:
                        return ('Downtrend — primary sell signal confirmed [P2]', 'P2', '', '', ttp)
                    if p in _small:
                        return ('Downtrend — primary sell signal confirmed [P4]', 'P4', '', '', ttp)
                    return ('Downtrend — secondary sell signal confirmed', '', 'secondary', '', ttp)
            return ('Downtrend — waiting for reversal confirmation', '', '', '', ttp)

    # --- Watch: approaching ma_200 only ---
    if prev_row is not None:
        if _approaching_ma150(close, float(prev_row['Close']), today_mas, 'DOWNTREND'):
            return (
                'Downtrend — watch, approaching 200 MA', '', '',
                'Watch — approaching 200 MA, potential sell setup', ttp
            )

    return ('Downtrend — no signal', '', '', '', ttp)


# ---------------------------------------------------------------------------
# Neutral-zone P2 detection (pullback into ribbon, longest MA bounce)
# ---------------------------------------------------------------------------

def _neutral_p2_check(row, prev_row, prior_trend, max_period=200,
                      tolerance=None, ma_periods=None):
    """
    When price enters the NEUTRAL zone (inside the ribbon) from a prior
    established trend, check for a P2 signal — bounce off the longest MA.
    Only P2 signals are allowed in NEUTRAL (secondaries suppressed in chop).
    """
    if prior_trend is None or prev_row is None:
        return None

    _tol = tolerance if tolerance is not None else MA_TOUCH_TOLERANCE
    close    = float(row['Close'])
    low      = float(row['Low'])
    high     = float(row['High'])
    today_mas = _ma_dict(row, ma_periods=ma_periods)

    if max_period not in today_mas:
        return None

    v_top = today_mas[max_period]

    if prior_trend == 'UPTREND':
        # Check: did the candle's low touch the longest MA from above?
        if low <= v_top * (1 + _tol) and close > v_top:
            return (
                'Neutral (prior uptrend) — P2 buy signal: 200 MA bounce',
                'P2', '', '', ''
            )
        # Also check yesterday's touch resolving today
        prev_mas = _ma_dict(prev_row, ma_periods=ma_periods)
        if max_period in prev_mas:
            prev_low = float(prev_row['Low'])
            pv_top = prev_mas[max_period]
            if prev_low <= pv_top * (1 + _tol) and close > v_top:
                return (
                    'Neutral (prior uptrend) — P2 buy signal: 200 MA bounce',
                    'P2', '', '', ''
                )

    elif prior_trend == 'DOWNTREND':
        # Check: did the candle's high touch the longest MA from below?
        if high >= v_top * (1 - _tol) and close < v_top:
            return (
                'Neutral (prior downtrend) — P2 sell signal: 200 MA rejection',
                'P2', '', '', ''
            )
        prev_mas = _ma_dict(prev_row, ma_periods=ma_periods)
        if max_period in prev_mas:
            prev_high = float(prev_row['High'])
            pv_top = prev_mas[max_period]
            if prev_high >= pv_top * (1 - _tol) and close < v_top:
                return (
                    'Neutral (prior downtrend) — P2 sell signal: 200 MA rejection',
                    'P2', '', '', ''
                )

    return None


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def add_signals(df: pd.DataFrame, ma_periods=None, small_ma_range=None,
                touch_tolerance=None, max_penetration=None,
                key_levels_df=None) -> pd.DataFrame:
    """
    Process the full instrument history and add signal columns.
    Iterates rows sequentially so each row can look at its predecessor.

    Parameters:
        ma_periods:       list of MA periods (default: config.MA_PERIODS)
        small_ma_range:   list of "small" MA periods for P3/P4 (default: config.SMALL_MA_RANGE)
        touch_tolerance:  fraction above/below MA to count as "touch" (default: 0.001)
        max_penetration:  max fraction the wick can penetrate past the MA —
                          if exceeded the touch is rejected (default: None = no limit).
        key_levels_df:    DataFrame of key levels for confluence scoring (optional).
                          Must have 'price' and 'touch_count' columns.
    """
    _ma_p   = ma_periods or MA_PERIODS
    _small  = small_ma_range or SMALL_MA_RANGE
    _max_p  = max(_ma_p)
    _tol    = touch_tolerance if touch_tolerance is not None else MA_TOUCH_TOLERANCE
    _max_pen = max_penetration

    # Pre-compute key level lookup for confluence scoring
    key_level_prices = []
    if key_levels_df is not None and not key_levels_df.empty:
        key_level_prices = [
            (float(r['price']), int(r['touch_count']))
            for _, r in key_levels_df.iterrows()
            if r.get('touch_count', 0) >= 3
        ]

    statuses  = []
    primaries = []
    secondaries = []
    confidences = []
    watches   = []
    ttps      = []
    run_days  = []
    established_trends = []

    trend_run  = 0
    last_trend = None
    prior_established_trend = None
    last_ttp_bar = -TTP_COOLDOWN_BARS - 1  # allow first TTP to fire

    rows = df.reset_index(drop=False)

    for i in range(len(rows)):
        row   = rows.iloc[i]
        trend = row['trend_direction']

        # Track consecutive trend-direction days
        if trend != 'NEUTRAL' and trend == last_trend:
            trend_run += 1
        elif trend != 'NEUTRAL':
            trend_run = 1
        else:
            trend_run = 0

        # Track what the established trend was before entering NEUTRAL
        if trend != 'NEUTRAL':
            prior_established_trend = trend
        last_trend = trend
        run_days.append(trend_run)
        established_trends.append(prior_established_trend or '')

        prev_row = rows.iloc[i - 1] if i >= 1 else None

        # Volume state for this bar
        vol_spike = bool(row.get('volume_spike_flag', False))

        # Check if price is at a key level (within 0.5% of a level with 3+ touches)
        close_val = float(row['Close']) if pd.notna(row.get('Close')) else 0
        at_key_level = False
        for kl_price, kl_touches in key_level_prices:
            if kl_price > 0 and abs(close_val - kl_price) / kl_price < 0.005:
                at_key_level = True
                break

        # ---- NEUTRAL -------------------------------------------------------
        if trend == 'NEUTRAL':
            p2_result = _neutral_p2_check(
                row, prev_row, prior_established_trend,
                max_period=_max_p, tolerance=_tol, ma_periods=_ma_p
            )
            if p2_result:
                status, primary, secondary, watch, ttp = p2_result
                conf = _signal_confidence(primary, vol_spike, at_key_level)
                statuses.append(status)
                primaries.append(primary)
                secondaries.append(secondary)
                confidences.append(conf)
                watches.append(watch)
                ttps.append(ttp)
                continue

            statuses.append('Neutral — no confirmed trend direction')
            primaries.append('')
            secondaries.append('')
            confidences.append('')
            watches.append('')
            ttps.append('')
            continue

        close     = float(row['Close'])
        low       = float(row['Low'])
        high      = float(row['High'])
        today_mas = _ma_dict(row, ma_periods=_ma_p)

        # Not enough MAs yet → treat as neutral
        if len(today_mas) < len(_ma_p) // 2:
            statuses.append('Neutral — no confirmed trend direction')
            primaries.append('')
            secondaries.append('')
            confidences.append('')
            watches.append('')
            ttps.append('')
            continue

        # Potential turning point with cooldown
        ttp = ''
        raw_ttp = _potential_turning_point(trend_run, close, today_mas)
        if raw_ttp and (i - last_ttp_bar) >= TTP_COOLDOWN_BARS:
            ttp = raw_ttp
            last_ttp_bar = i

        # ---- P1: trend reversal (highest priority) --------------------------
        if prev_row is not None:
            prev_trend = prev_row['trend_direction']
            if trend == 'UPTREND' and prev_trend == 'DOWNTREND':
                conf = _signal_confidence('P1', vol_spike, at_key_level)
                statuses.append('Uptrend — primary buy signal confirmed [P1]')
                primaries.append('P1')
                secondaries.append('')
                confidences.append(conf)
                watches.append('')
                ttps.append(ttp)
                continue
            if trend == 'DOWNTREND' and prev_trend == 'UPTREND':
                conf = _signal_confidence('P1', vol_spike, at_key_level)
                statuses.append('Downtrend — primary sell signal confirmed [P1]')
                primaries.append('P1')
                secondaries.append('')
                confidences.append(conf)
                watches.append('')
                ttps.append(ttp)
                continue

        # ---- P2 / P3 / P4 / secondary / watch ------------------------------
        if trend == 'UPTREND':
            status, primary, secondary, watch, ttp_out = _uptrend_signals(
                close, low, today_mas, prev_row, ttp,
                small_ma_range=_small, max_period=_max_p,
                tolerance=_tol, max_penetration=_max_pen, ma_periods=_ma_p
            )
        else:
            status, primary, secondary, watch, ttp_out = _downtrend_signals(
                close, high, today_mas, prev_row, ttp,
                small_ma_range=_small, max_period=_max_p,
                tolerance=_tol, max_penetration=_max_pen, ma_periods=_ma_p
            )

        # De-duplicate P3/P4 only within a short window (3 bars).
        # Beyond 3 bars, a new touch is a fresh event (legitimate retest).
        if primary in ('P3', 'P4'):
            # Look back up to P3P4_DEDUP_WINDOW bars for the same signal
            is_dupe = False
            lookback_start = max(0, len(primaries) - P3P4_DEDUP_WINDOW)
            for j in range(len(primaries) - 1, lookback_start - 1, -1):
                if primaries[j] == primary:
                    is_dupe = True
                    break
                if primaries[j] in ('P1', 'P2'):
                    break  # higher-priority signal resets the dedup window

            if is_dupe:
                primary = ''
                secondary = ''
                watch = ''
                if trend == 'UPTREND':
                    status = 'Uptrend — no signal'
                else:
                    status = 'Downtrend — no signal'
                ttp_out = ttp

        # Compute confidence
        conf = _signal_confidence(primary, vol_spike, at_key_level)

        statuses.append(status)
        primaries.append(primary)
        secondaries.append(secondary)
        confidences.append(conf)
        watches.append(watch)
        ttps.append(ttp_out)

    df = df.copy()
    df['trend_run_days']              = run_days
    df['established_trend']           = established_trends
    df['confirmation_status']         = statuses
    df['primary_signal']              = primaries
    df['secondary_signal']            = secondaries
    df['signal_confidence']           = confidences
    df['watch_flag']                  = watches
    df['potential_turning_point_flag'] = ttps

    return df
