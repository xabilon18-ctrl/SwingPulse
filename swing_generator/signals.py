"""
Signal detection engine.

Processes one instrument's full history DataFrame (which already has MA ribbon,
volume, trend_direction, ribbon_spread, ribbon_compression, ribbon_slope_pct,
ma_order_score, and roc columns) and adds:

    trend_run_days              – consecutive trading days in current trend
    confirmation_status         – one of the 12+ states from the spec
    primary_signal              – BP1/SP1/BP2/SP2/BP3/SP3/BP4/SP4  (or empty)
    secondary_signal            – 'secondary'  (or empty)
    signal_confidence           – 'high' / 'standard' / 'low' (or empty)
    watch_flag                  – watch description  (or empty)
    potential_turning_point_flag– alert text  (or empty)

Signal codes:
    BP1 / SP1 — full ribbon cross + close past MA108 (trend reversal)
    BP2 / SP2 — pullback / rejection on fast MAs (10–66)
    BP3 / SP3 — bounce / rejection on the longest MA (108)
    BP4 / SP4 — bounce / rejection at a confirmed key level (old top/bottom)

Priority per row: BP1/SP1 > BP3/SP3 > BP2/SP2 > BP4/SP4 > secondary > watch.

BP1/SP1 fires on FOUR paths:
    A. Direct DOWNTREND → UPTREND  (no neutral in between) → BP1
    B. Direct UPTREND   → DOWNTREND                          → SP1
    C. DOWNTREND → NEUTRAL → UPTREND  (via neutral)         → BP1
    D. UPTREND   → NEUTRAL → DOWNTREND                       → SP1

BP3/SP3 dedup: same-direction within P2_DEDUP_WINDOW bars suppressed (BP1/SP1 resets).
BP2/SP2 suppressed when ribbon_compression is True (direction unknown during squeeze).
BP2/SP2 confidence capped at 'low' when trend_run_days >= TREND_DURATION_THRESHOLD.
BP4/SP4 always 'high' confidence (signal is at a confirmed key level by definition).
Compression breakout watch fires on first bar ribbon expands after a squeeze.
Exit labels appended when a signal closes the prior open position.
"""

import pandas as pd

from _active_config import (
    MA_PERIODS,
    SMALL_MA_RANGE,
    MA_TOUCH_TOLERANCE,
    TREND_DURATION_THRESHOLD,
    WATCH_APPROACH_PCT,
    MIDPOINT_BOUNCE_PCT,
    P3P4_DEDUP_WINDOW,
    P2_DEDUP_WINDOW,
    TTP_COOLDOWN_BARS,
    NEUTRAL_SLOPE_THRESHOLD,
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
    """Watch flag: price approaching the longest MA only."""
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

    Confidence rules (NEW BP/SP system):
        BP4/SP4 (key-level bounce) → always 'high' (signal at level by definition)
        BP3/SP3 (longest-MA bounce) + volume + key level → 'high'
        BP1/SP1 (trend reversal)               → 'high' if vol or key level, else 'standard'
        Any signal + (volume or key level)     → at least 'standard'
        BP2/SP2 (fast-MA pullback) without vol AND without key → 'low'
        Mature-trend pullbacks (BP2/SP2 with run >= 200) capped at 'low'
    """
    if not primary:
        return ''

    # BP4/SP4 — bounce at a confirmed key level → already high-conviction
    if primary in ('BP4', 'SP4'):
        return 'high'

    # Mature-trend cap for fast-MA pullback entries
    if primary in ('BP2', 'SP2') and trend_run_days >= TREND_DURATION_THRESHOLD:
        return 'low'

    # Trend-reversal (BP1/SP1) and longest-MA bounce (BP3/SP3)
    if primary in ('BP1', 'SP1', 'BP3', 'SP3'):
        if volume_spike or at_key_level:
            return 'high'
        return 'standard'

    # BP2 / SP2 — fast-MA pullback
    if volume_spike and at_key_level:
        return 'high'
    if volume_spike or at_key_level:
        return 'standard'
    return 'low'


def _is_bp3_sp3_dupe(primary: str, status: str,
                     primaries_so_far: list, statuses_so_far: list,
                     window: int) -> bool:
    """
    Return True if a same-direction BP3/SP3 already fired within the last
    `window` bars. A BP1/SP1 anywhere in the window resets the dedup.
    """
    if primary not in ('BP3', 'SP3'):
        return False
    lookback_start = max(0, len(primaries_so_far) - window)
    for j in range(len(primaries_so_far) - 1, lookback_start - 1, -1):
        if primaries_so_far[j] in ('BP1', 'SP1'):
            return False
        if primaries_so_far[j] == primary:
            return True
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

    # P2: bounce off longest MA — not suppressed by compression
    if ma_top_touched:
        _, vtop = ma_top_touched[0]
        if close > vtop:
            return ('Uptrend — primary buy signal confirmed [BP3]', 'BP3', '', '', ttp)
        return ('Uptrend — waiting for reversal confirmation', '', '', '', ttp)

    # P3: bounce off small MA — suppressed during ribbon compression
    if small_touched and not ribbon_compression:
        confirmed = [(p, v) for p, v in small_touched if close > v]
        if confirmed:
            return ('Uptrend — primary buy signal confirmed [BP2]', 'BP2', '', '', ttp)
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
                        return ('Uptrend — primary buy signal confirmed [BP3]', 'BP3', '', '', ttp)
                    if p in _small and not ribbon_compression:
                        return ('Uptrend — primary buy signal confirmed [BP2]', 'BP2', '', '', ttp)
                    return ('Uptrend — secondary buy signal confirmed', '', 'secondary', '', ttp)
            return ('Uptrend — waiting for reversal confirmation', '', '', '', ttp)

    # Watch: approaching longest MA
    if prev_row is not None:
        if _approaching_ma150(close, float(prev_row['Close']), today_mas, 'UPTREND'):
            return (
                f'Uptrend — watch, approaching MA{max_period}', '', '',
                f'Watch — approaching MA{max_period}, potential buy setup', ttp
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

    # P2: rejection from longest MA — not suppressed by compression
    if ma_top_touched:
        _, vtop = ma_top_touched[0]
        if close < vtop:
            return ('Downtrend — primary sell signal confirmed [SP3]', 'SP3', '', '', ttp)
        return ('Downtrend — waiting for reversal confirmation', '', '', '', ttp)

    # P4: rejection from small MA — suppressed during ribbon compression
    if small_touched and not ribbon_compression:
        confirmed = [(p, v) for p, v in small_touched if close < v]
        if confirmed:
            return ('Downtrend — primary sell signal confirmed [SP2]', 'SP2', '', '', ttp)
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
                        return ('Downtrend — primary sell signal confirmed [SP3]', 'SP3', '', '', ttp)
                    if p in _small and not ribbon_compression:
                        return ('Downtrend — primary sell signal confirmed [SP2]', 'SP2', '', '', ttp)
                    return ('Downtrend — secondary sell signal confirmed', '', 'secondary', '', ttp)
            return ('Downtrend — waiting for reversal confirmation', '', '', '', ttp)

    # Watch: approaching longest MA
    if prev_row is not None:
        if _approaching_ma150(close, float(prev_row['Close']), today_mas, 'DOWNTREND'):
            return (
                f'Downtrend — watch, approaching MA{max_period}', '', '',
                f'Watch — approaching MA{max_period}, potential sell setup', ttp
            )

    return ('Downtrend — no signal', '', '', '', ttp)


# ---------------------------------------------------------------------------
# Neutral-zone P2 detection
# ---------------------------------------------------------------------------

def _neutral_p2_check(row, prev_row, prior_trend, max_period=200,
                      tolerance=None, ma_periods=None):
    """
    When price is in NEUTRAL (inside ribbon) from a prior established trend,
    check for a longest-MA bounce/rejection — emits BP3 (uptrend) or SP3 (downtrend).
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
            return (f'Neutral (prior uptrend) — BP3 buy signal: MA{max_period} bounce', 'BP3', '', '', '')
        prev_mas = _ma_dict(prev_row, ma_periods=ma_periods)
        if max_period in prev_mas:
            prev_low = float(prev_row['Low'])
            pv_top = prev_mas[max_period]
            if prev_low <= pv_top * (1 + _tol) and close > v_top:
                return (f'Neutral (prior uptrend) — BP3 buy signal: MA{max_period} bounce', 'BP3', '', '', '')

    elif prior_trend == 'DOWNTREND':
        if high >= v_top * (1 - _tol) and close < v_top:
            return (f'Neutral (prior downtrend) — SP3 sell signal: MA{max_period} rejection', 'SP3', '', '', '')
        prev_mas = _ma_dict(prev_row, ma_periods=ma_periods)
        if max_period in prev_mas:
            prev_high = float(prev_row['High'])
            pv_top = prev_mas[max_period]
            if prev_high >= pv_top * (1 - _tol) and close < v_top:
                return (f'Neutral (prior downtrend) — SP3 sell signal: MA{max_period} rejection', 'SP3', '', '', '')

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
            # Gate: ribbon must be flat/sideways before any P2 can fire.
            # If the MAs are still sloping meaningfully the instrument is
            # transitioning (not truly neutral) — suppress signals entirely.
            ribbon_slope = float(row.get('ribbon_slope_pct', 0) or 0)
            if abs(ribbon_slope) > NEUTRAL_SLOPE_THRESHOLD:
                slope_dir = 'rising' if ribbon_slope > 0 else 'declining'
                statuses.append(f'Neutral — transitioning ({slope_dir} ribbon)')
                primaries.append('')
                secondaries.append('')
                confidences.append('')
                watches.append('')
                ttps.append('')
                continue

            p2_result = _neutral_p2_check(
                row, prev_row, prior_established_trend,
                max_period=_max_p, tolerance=_tol, ma_periods=_ma_p
            )
            if p2_result:
                status, primary, secondary, watch, ttp = p2_result

                # BP3/SP3 dedup in neutral zone
                if _is_bp3_sp3_dupe(primary, status, primaries, statuses, P2_DEDUP_WINDOW):
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

            # Path A: direct DOWNTREND → UPTREND  (BP1)
            if trend == 'UPTREND' and prev_trend == 'DOWNTREND':
                conf   = _signal_confidence('BP1', vol_spike, at_key_level, trend_run)
                status = 'Uptrend — primary buy signal confirmed [BP1]'
                status = _maybe_exit_label(status, 'BP1', last_primary_side)
                last_primary_side = 'BUY'
                statuses.append(status); primaries.append('BP1')
                secondaries.append(''); confidences.append(conf)
                watches.append(''); ttps.append(ttp)
                continue

            # Path B: direct UPTREND → DOWNTREND  (SP1)
            if trend == 'DOWNTREND' and prev_trend == 'UPTREND':
                conf   = _signal_confidence('SP1', vol_spike, at_key_level, trend_run)
                status = 'Downtrend — primary sell signal confirmed [SP1]'
                status = _maybe_exit_label(status, 'SP1', last_primary_side)
                last_primary_side = 'SELL'
                statuses.append(status); primaries.append('SP1')
                secondaries.append(''); confidences.append(conf)
                watches.append(''); ttps.append(ttp)
                continue

            # Path C: DOWNTREND → NEUTRAL → UPTREND  (BP1)
            if (trend == 'UPTREND' and prev_trend == 'NEUTRAL'
                    and prev_established_trend == 'DOWNTREND'):
                conf   = _signal_confidence('BP1', vol_spike, at_key_level, trend_run)
                status = 'Uptrend — primary buy signal confirmed [BP1] (via neutral)'
                status = _maybe_exit_label(status, 'BP1', last_primary_side)
                last_primary_side = 'BUY'
                statuses.append(status); primaries.append('BP1')
                secondaries.append(''); confidences.append(conf)
                watches.append(''); ttps.append(ttp)
                continue

            # Path D: UPTREND → NEUTRAL → DOWNTREND  (SP1)
            if (trend == 'DOWNTREND' and prev_trend == 'NEUTRAL'
                    and prev_established_trend == 'UPTREND'):
                conf   = _signal_confidence('SP1', vol_spike, at_key_level, trend_run)
                status = 'Downtrend — primary sell signal confirmed [SP1] (via neutral)'
                status = _maybe_exit_label(status, 'SP1', last_primary_side)
                last_primary_side = 'SELL'
                statuses.append(status); primaries.append('SP1')
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

        # ---- BP4 / SP4: key-level bounce (price-action support/resistance) -
        # Fires only if no MA-based signal already fired this bar.
        if not primary and key_level_prices:
            tol = _tol if _tol else 0.005
            for kl_price, _kl_count in key_level_prices:
                if kl_price <= 0:
                    continue
                if trend == 'UPTREND':
                    # Pullback: wick low must touch the level, close must stay above it
                    if low <= kl_price * (1 + tol) and close > kl_price:
                        primary = 'BP4'
                        status  = f'Uptrend — primary buy signal confirmed [BP4] (key level {kl_price:.4g})'
                        break
                else:  # DOWNTREND
                    if high >= kl_price * (1 - tol) and close < kl_price:
                        primary = 'SP4'
                        status  = f'Downtrend — primary sell signal confirmed [SP4] (key level {kl_price:.4g})'
                        break

        # BP2/SP2 dedup (3-bar window, reset on BP1/SP1/BP3/SP3)
        if primary in ('BP2', 'SP2'):
            is_dupe = False
            lookback_start = max(0, len(primaries) - P3P4_DEDUP_WINDOW)
            for j in range(len(primaries) - 1, lookback_start - 1, -1):
                if primaries[j] == primary:
                    is_dupe = True
                    break
                if primaries[j] in ('BP1', 'SP1', 'BP3', 'SP3'):
                    break
            if is_dupe:
                primary = ''; secondary = ''; watch = ''
                status  = 'Uptrend — no signal' if trend == 'UPTREND' else 'Downtrend — no signal'
                ttp_out = ttp

        # BP3/SP3 dedup (5-bar window, same direction, reset on BP1/SP1)
        if primary in ('BP3', 'SP3') and _is_bp3_sp3_dupe(primary, status, primaries, statuses, P2_DEDUP_WINDOW):
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
