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

P1 fires on THREE paths:
    A. Direct DOWNTREND → UPTREND  (no neutral in between)
    B. Direct UPTREND   → DOWNTREND
    C. DOWNTREND → NEUTRAL → UPTREND  (via neutral — most common for smooth instruments)
    D. UPTREND   → NEUTRAL → DOWNTREND

P2 dedup: same-direction P2 signals within P2_DEDUP_WINDOW bars are suppressed.
P3/P4 suppressed when ribbon_compression is True (direction unknown during squeeze).
P3/P4 confidence capped at 'low' when trend_run_days >= TREND_DURATION_THRESHOLD.
Compression breakout watch fires on first bar ribbon expands after a squeeze.
Exit labels appended when a signal closes the prior open position.
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
    P2_DEDUP_WINDOW,
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
    """
    tol = tolerance if tolerance is not None else MA_TOUCH_TOLERANCE
    result = []
    for p, v in ma_dict.items():
        if candle_low <= v * (1 + tol):
            if max_penetration is not None and candle_low < v * (1 - max_penetration):
                continue
            result.append((p, v))
    return result


def _touched_down(candle_high: float, ma_dict: dict,
                  tolerance=None, max_penetration=None) -> list[tuple[int, float]]:
    """
    Return (period, value) pairs where the candle's HIGH touched or pierced
    the MA from below — i.e. the wick reached the MA line (sell-side touch).
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
    """Watch flag: price approaching the longest MA (200) only."""
    max_period = max(ma_dict.keys()) if ma_dict else None
    if max_period is None:
        return False
    ma_val = ma_dict[max_period]

    if direction == 'UPTREND':
        if close >= prev_close or close <= ma_val:
            return False
        dist = (close - ma_val) / ma_val
        return dist < WATCH_APPROACH_PCT
    else:
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


def _signal_confidence(primary: str, volume_spike: bool, at_key_level: bool,
                       trend_run_days: int = 0) -> str:
    """
    Determine signal confidence based on confluence factors.

    P3/P4 are capped at 'low' when the trend is very mature
    (trend_run_days >= TREND_DURATION_THRESHOLD) — a long-running trend
    is more likely to reverse than to continue cleanly on a pullback.
    """
    if not primary:
        return ''

    # Mature-trend cap for pullback entries
    if primary in ('P3', 'P4') and trend_run_days >= TREND_DURATION_THRESHOLD:
        return 'low'

    if primary in ('P1', 'P2'):
        if volume_spike and at_key_level:
            return 'high'
        if volume_spike or at_key_level:
            return 'high'
        return 'standard'

    # P3 / P4
    if volume_spike and at_key_level:
        return 'high'
    if volume_spike:
        return 'standard'
    if at_key_level:
        return 'standard'
    return 'low'


def _is_p2_dupe(primary: str, status: str,
                primaries_so_far: list, statuses_so_far: list,
                window: int) -> bool:
    """
    Return True if a same-direction P2 already fired within the last
    `window` bars. A P1 anywhere in the window resets the dedup.
    """
    if primary != 'P2':
        return False
    curr_is_buy = 'buy' in status.lower()
    lookback_start = max(0, len(primaries_so_far) - window)
    for j in range(len(primaries_so_far) - 1, lookback_start - 1, -1):
        if primaries_so_far[j] == 'P1':
            return False
        if primaries_so_far[j] == 'P2':
            prev_is_buy = 'buy' in statuses_so_far[j].lower()
            return curr_is_buy == prev_is_buy
    return False


def _maybe_exit_label(status: str, primary: str, last_side: str | None) -> str:
    """Append [closes prior long/short] when the signal opposes the last primary."""
    if not primary or not last_side:
        return status
    curr_is_buy = 'buy' in status.lower()
    if last_side == 'BUY' and not curr_is_buy:
        return status + ' [closes prior long]'
    if last_side == 'SELL' and curr_is_buy:
        return status + ' [closes prior short]'
    return status


# ---------------------------------------------------------------------------
# Per-row classifiers
# ---------------------------------------------------------------------------

def _uptrend_signals(close, low, today_mas, prev_row, ttp,
                     small_ma_range=None, max_period=200,
                     tolerance=None, max_penetration=None, ma_periods=None,
                     ribbon_compression=False):
    """Classify signal state for a row confirmed UPTREND."""
    _small = small_ma_range or SMALL_MA_RANGE

    today_touched = _touched_up(low, today_mas, tolerance=tolerance, max_penetration=max_penetration)
    small_touched = [(p, v) for p, v in today_touched if p in _small]
    ma_top_touched = [(p, v) for p, v in today_touched if p == max_period]

    # P2: bounce off 200 MA — not suppressed by compression
    if ma_top_touched:
        _, vtop = ma_top_touched[0]
        if close > vtop:
            return ('Uptrend — primary buy signal confirmed [P2]', 'P2', '', '', ttp)
        return ('Uptrend — waiting for reversal confirmation', '', '', '', ttp)

    # P3: bounce off small MA — suppressed during ribbon compression
    if small_touched and not ribbon_compression:
        confirmed = [(p, v) for p, v in small_touched if close > v]
        if confirmed:
            return ('Uptrend — primary buy signal confirmed [P3]', 'P3', '', '', ttp)
        return ('Uptrend — waiting for reversal confirmation', '', '', '', ttp)

    # Secondary: bounce off any ribbon MA
    if today_touched:
        confirmed = [(p, v) for p, v in today_touched if close > v]
        if confirmed:
            return ('Uptrend — secondary buy signal confirmed', '', 'secondary', '', ttp)
        return ('Uptrend — waiting for reversal confirmation', '', '', '', ttp)

    # Check YESTERDAY for a pending touch that today resolves
    if prev_row is not None:
        prev_mas  = _ma_dict(prev_row, ma_periods=ma_periods)
        prev_low  = float(prev_row['Low'])
        prev_touched = _touched_up(prev_low, prev_mas, tolerance=tolerance,
                                   max_penetration=max_penetration)
        if prev_touched:
            for p, pv in prev_touched:
                curr_v = today_mas.get(p)
                if curr_v is not None and close > curr_v:
                    if p == max_period:
                        return ('Uptrend — primary buy signal confirmed [P2]', 'P2', '', '', ttp)
                    if p in _small and not ribbon_compression:
                        return ('Uptrend — primary buy signal confirmed [P3]', 'P3', '', '', ttp)
                    return ('Uptrend — secondary buy signal confirmed', '', 'secondary', '', ttp)
            return ('Uptrend — waiting for reversal confirmation', '', '', '', ttp)

    # Watch: approaching 200 MA
    if prev_row is not None:
        if _approaching_ma150(close, float(prev_row['Close']), today_mas, 'UPTREND'):
            return (
                'Uptrend — watch, approaching 200 MA', '', '',
                'Watch — approaching 200 MA, potential buy setup', ttp
            )

    return ('Uptrend — no signal', '', '', '', ttp)


def _downtrend_signals(close, high, today_mas, prev_row, ttp,
                       small_ma_range=None, max_period=200,
                       tolerance=None, max_penetration=None, ma_periods=None,
                       ribbon_compression=False):
    """Classify signal state for a row confirmed DOWNTREND."""
    _small = small_ma_range or SMALL_MA_RANGE

    today_touched = _touched_down(high, today_mas, tolerance=tolerance, max_penetration=max_penetration)
    small_touched = [(p, v) for p, v in today_touched if p in _small]
    ma_top_touched = [(p, v) for p, v in today_touched if p == max_period]

    # P2: rejection from 200 MA — not suppressed by compression
    if ma_top_touched:
        _, vtop = ma_top_touched[0]
        if close < vtop:
            return ('Downtrend — primary sell signal confirmed [P2]', 'P2', '', '', ttp)
        return ('Downtrend — waiting for reversal confirmation', '', '', '', ttp)

    # P4: rejection from small MA — suppressed during ribbon compression
    if small_touched and not ribbon_compression:
        confirmed = [(p, v) for p, v in small_touched if close < v]
        if confirmed:
            return ('Downtrend — primary sell signal confirmed [P4]', 'P4', '', '', ttp)
        return ('Downtrend — waiting for reversal confirmation', '', '', '', ttp)

    # Secondary: rejection from any ribbon MA
    if today_touched:
        confirmed = [(p, v) for p, v in today_touched if close < v]
        if confirmed:
            return ('Downtrend — secondary sell signal confirmed', '', 'secondary', '', ttp)
        return ('Downtrend — waiting for reversal confirmation', '', '', '', ttp)

    # Check YESTERDAY
    if prev_row is not None:
        prev_mas  = _ma_dict(prev_row, ma_periods=ma_periods)
        prev_high = float(prev_row['High'])
        prev_touched = _touched_down(prev_high, prev_mas, tolerance=tolerance,
                                     max_penetration=max_penetration)
        if prev_touched:
            for p, pv in prev_touched:
                curr_v = today_mas.get(p)
                if curr_v is not None and close < curr_v:
                    if p == max_period:
                        return ('Downtrend — primary sell signal confirmed [P2]', 'P2', '', '', ttp)
                    if p in _small and not ribbon_compression:
                        return ('Downtrend — primary sell signal confirmed [P4]', 'P4', '', '', ttp)
                    return ('Downtrend — secondary sell signal confirmed', '', 'secondary', '', ttp)
            return ('Downtrend — waiting for reversal confirmation', '', '', '', ttp)

    # Watch: approaching 200 MA
    if prev_row is not None:
        if _approaching_ma150(close, float(prev_row['Close']), today_mas, 'DOWNTREND'):
            return (
                'Downtrend — watch, approaching 200 MA', '', '',
                'Watch — approaching 200 MA, potential sell setup', ttp
            )

    return ('Downtrend — no signal', '', '', '', ttp)


# ---------------------------------------------------------------------------
# Neutral-zone P2 detection
# ---------------------------------------------------------------------------

def _neutral_p2_check(row, prev_row, prior_trend, max_period=200,
                      tolerance=None, ma_periods=None):
    """
    When price is in NEUTRAL (inside ribbon) from a prior established trend,
    check for a P2 — bounce/rejection off the longest MA.
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
        if low <= v_top * (1 + _tol) and close > v_top:
            return ('Neutral (prior uptrend) — P2 buy signal: 200 MA bounce', 'P2', '', '', '')
        prev_mas = _ma_dict(prev_row, ma_periods=ma_periods)
        if max_period in prev_mas:
            prev_low = float(prev_row['Low'])
            pv_top = prev_mas[max_period]
            if prev_low <= pv_top * (1 + _tol) and close > v_top:
                return ('Neutral (prior uptrend) — P2 buy signal: 200 MA bounce', 'P2', '', '', '')

    elif prior_trend == 'DOWNTREND':
        if high >= v_top * (1 - _tol) and close < v_top:
            return ('Neutral (prior downtrend) — P2 sell signal: 200 MA rejection', 'P2', '', '', '')
        prev_mas = _ma_dict(prev_row, ma_periods=ma_periods)
        if max_period in prev_mas:
            prev_high = float(prev_row['High'])
            pv_top = prev_mas[max_period]
            if prev_high >= pv_top * (1 - _tol) and close < v_top:
                return ('Neutral (prior downtrend) — P2 sell signal: 200 MA rejection', 'P2', '', '', '')

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
    """
    _ma_p   = ma_periods or MA_PERIODS
    _small  = small_ma_range or SMALL_MA_RANGE
    _max_p  = max(_ma_p)
    _tol    = touch_tolerance if touch_tolerance is not None else MA_TOUCH_TOLERANCE
    _max_pen = max_penetration

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
    prior_established_trend  = None
    prev_established_trend   = None   # saved before each bar updates prior_established_trend
    last_primary_side        = None   # 'BUY' or 'SELL' — for exit labels
    last_ttp_bar = -TTP_COOLDOWN_BARS - 1

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

        # Save established trend BEFORE this bar potentially changes it
        prev_established_trend = prior_established_trend

        if trend != 'NEUTRAL':
            prior_established_trend = trend
        last_trend = trend
        run_days.append(trend_run)
        established_trends.append(prior_established_trend or '')

        prev_row = rows.iloc[i - 1] if i >= 1 else None

        vol_spike    = bool(row.get('volume_spike_flag', False))
        ribbon_comp  = bool(row.get('ribbon_compression', False))

        close_val = float(row['Close']) if pd.notna(row.get('Close')) else 0
        at_key_level = any(
            kl_price > 0 and abs(close_val - kl_price) / kl_price < 0.005
            for kl_price, _ in key_level_prices
        )

        # ---- NEUTRAL -------------------------------------------------------
        if trend == 'NEUTRAL':
            p2_result = _neutral_p2_check(
                row, prev_row, prior_established_trend,
                max_period=_max_p, tolerance=_tol, ma_periods=_ma_p
            )
            if p2_result:
                status, primary, secondary, watch, ttp = p2_result

                # P2 dedup in neutral zone
                if _is_p2_dupe(primary, status, primaries, statuses, P2_DEDUP_WINDOW):
                    statuses.append('Neutral — no confirmed trend direction')
                    primaries.append('')
                    secondaries.append('')
                    confidences.append('')
                    watches.append('')
                    ttps.append('')
                    continue

                conf   = _signal_confidence(primary, vol_spike, at_key_level, trend_run)
                status = _maybe_exit_label(status, primary, last_primary_side)
                if primary:
                    last_primary_side = 'BUY' if 'buy' in status.lower() else 'SELL'
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

        if len(today_mas) < len(_ma_p) // 2:
            statuses.append('Neutral — no confirmed trend direction')
            primaries.append('')
            secondaries.append('')
            confidences.append('')
            watches.append('')
            ttps.append('')
            continue

        ttp = ''
        raw_ttp = _potential_turning_point(trend_run, close, today_mas)
        if raw_ttp and (i - last_ttp_bar) >= TTP_COOLDOWN_BARS:
            ttp = raw_ttp
            last_ttp_bar = i

        # ---- P1: trend reversal (highest priority) -------------------------
        if prev_row is not None:
            prev_trend = prev_row['trend_direction']

            # Path A: direct DOWNTREND → UPTREND
            if trend == 'UPTREND' and prev_trend == 'DOWNTREND':
                conf   = _signal_confidence('P1', vol_spike, at_key_level, trend_run)
                status = 'Uptrend — primary buy signal confirmed [P1]'
                status = _maybe_exit_label(status, 'P1', last_primary_side)
                last_primary_side = 'BUY'
                statuses.append(status); primaries.append('P1')
                secondaries.append(''); confidences.append(conf)
                watches.append(''); ttps.append(ttp)
                continue

            # Path B: direct UPTREND → DOWNTREND
            if trend == 'DOWNTREND' and prev_trend == 'UPTREND':
                conf   = _signal_confidence('P1', vol_spike, at_key_level, trend_run)
                status = 'Downtrend — primary sell signal confirmed [P1]'
                status = _maybe_exit_label(status, 'P1', last_primary_side)
                last_primary_side = 'SELL'
                statuses.append(status); primaries.append('P1')
                secondaries.append(''); confidences.append(conf)
                watches.append(''); ttps.append(ttp)
                continue

            # Path C: DOWNTREND → NEUTRAL → UPTREND
            if (trend == 'UPTREND' and prev_trend == 'NEUTRAL'
                    and prev_established_trend == 'DOWNTREND'):
                conf   = _signal_confidence('P1', vol_spike, at_key_level, trend_run)
                status = 'Uptrend — primary buy signal confirmed [P1] (via neutral)'
                status = _maybe_exit_label(status, 'P1', last_primary_side)
                last_primary_side = 'BUY'
                statuses.append(status); primaries.append('P1')
                secondaries.append(''); confidences.append(conf)
                watches.append(''); ttps.append(ttp)
                continue

            # Path D: UPTREND → NEUTRAL → DOWNTREND
            if (trend == 'DOWNTREND' and prev_trend == 'NEUTRAL'
                    and prev_established_trend == 'UPTREND'):
                conf   = _signal_confidence('P1', vol_spike, at_key_level, trend_run)
                status = 'Downtrend — primary sell signal confirmed [P1] (via neutral)'
                status = _maybe_exit_label(status, 'P1', last_primary_side)
                last_primary_side = 'SELL'
                statuses.append(status); primaries.append('P1')
                secondaries.append(''); confidences.append(conf)
                watches.append(''); ttps.append(ttp)
                continue

        # ---- P2 / P3 / P4 / secondary / watch ------------------------------
        if trend == 'UPTREND':
            status, primary, secondary, watch, ttp_out = _uptrend_signals(
                close, low, today_mas, prev_row, ttp,
                small_ma_range=_small, max_period=_max_p,
                tolerance=_tol, max_penetration=_max_pen, ma_periods=_ma_p,
                ribbon_compression=ribbon_comp,
            )
        else:
            status, primary, secondary, watch, ttp_out = _downtrend_signals(
                close, high, today_mas, prev_row, ttp,
                small_ma_range=_small, max_period=_max_p,
                tolerance=_tol, max_penetration=_max_pen, ma_periods=_ma_p,
                ribbon_compression=ribbon_comp,
            )

        # P3/P4 dedup (3-bar window, reset on P1/P2)
        if primary in ('P3', 'P4'):
            is_dupe = False
            lookback_start = max(0, len(primaries) - P3P4_DEDUP_WINDOW)
            for j in range(len(primaries) - 1, lookback_start - 1, -1):
                if primaries[j] == primary:
                    is_dupe = True
                    break
                if primaries[j] in ('P1', 'P2'):
                    break
            if is_dupe:
                primary = ''; secondary = ''; watch = ''
                status  = 'Uptrend — no signal' if trend == 'UPTREND' else 'Downtrend — no signal'
                ttp_out = ttp

        # P2 dedup (5-bar window, same direction, reset on P1)
        if primary == 'P2' and _is_p2_dupe(primary, status, primaries, statuses, P2_DEDUP_WINDOW):
            primary = ''; secondary = ''; watch = ''
            status  = 'Uptrend — no signal' if trend == 'UPTREND' else 'Downtrend — no signal'
            ttp_out = ttp

        # Compression breakout watch (first bar ribbon expands after a squeeze)
        if prev_row is not None and not watch:
            prev_comp = bool(prev_row.get('ribbon_compression', False))
            if prev_comp and not ribbon_comp and trend != 'NEUTRAL':
                direction = 'bullish' if trend == 'UPTREND' else 'bearish'
                watch = f'Ribbon expansion — {direction} breakout from squeeze'

        conf   = _signal_confidence(primary, vol_spike, at_key_level, trend_run)

        # Exit label
        if primary:
            status = _maybe_exit_label(status, primary, last_primary_side)
            last_primary_side = 'BUY' if 'buy' in status.lower() else 'SELL'

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
