"""
Technical indicator calculations applied to a single instrument's DataFrame.

Functions here mutate df in-place (or return a copy with new columns) and
are designed to be called sequentially from main.py.
"""

import numpy as np
import pandas as pd

from _active_config import MA_PERIODS, VOLUME_LOOKBACK, ROC_PERIOD, RIBBON_COMPRESSION_THRESHOLD, SLOPE_LOOKBACK, MA_TOUCH_TOLERANCE


# ---------------------------------------------------------------------------
# MA Ribbon
# ---------------------------------------------------------------------------

def add_ma_ribbon(df: pd.DataFrame, ma_periods=None) -> pd.DataFrame:
    """
    Add one SMA column per period in ma_periods.
    Columns named: ma_10, ma_17, ... ma_108 (or whatever periods are given).
    """
    periods = ma_periods or MA_PERIODS
    for period in periods:
        df[f'ma_{period}'] = df['Close'].rolling(period, min_periods=period).mean()
    return df


# ---------------------------------------------------------------------------
# Volume
# ---------------------------------------------------------------------------

def add_volume_analysis(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add:
        volume_average    – rolling mean over VOLUME_LOOKBACK days
        volume_spike_flag – True if today's volume > volume_average
        pvo               – Percentage Volume Oscillator: (EMA12 − EMA26) of
                            volume as a % of EMA26. >0 = volume expanding vs
                            its longer baseline, <0 = drying up.
        pvo_signal        – EMA9 of pvo (signal line)
    """
    df['volume_average']    = df['Volume'].rolling(VOLUME_LOOKBACK, min_periods=1).mean()
    df['volume_spike_flag'] = df['Volume'] > df['volume_average']

    vol      = df['Volume'].astype('float64')
    ema_fast = vol.ewm(span=12, adjust=False).mean()
    ema_slow = vol.ewm(span=26, adjust=False).mean()
    # Instruments with no reported volume (some indices/CFDs) have ema_slow == 0
    pvo = pd.Series(np.where(ema_slow > 0, (ema_fast - ema_slow) / ema_slow * 100.0, np.nan),
                    index=df.index)
    df['pvo']        = pvo
    df['pvo_signal'] = pvo.ewm(span=9, adjust=False).mean()
    return df


# ---------------------------------------------------------------------------
# Trend
# ---------------------------------------------------------------------------

def add_trend(df: pd.DataFrame, ma_periods=None) -> pd.DataFrame:
    """
    Classify each row as UPTREND, DOWNTREND, or NEUTRAL.

    Uses the ribbon's two anchor MAs (fastest = MA25, slowest = MA500) as
    boundaries — consistent with the signal engine in signals.py:

    UPTREND   : Close > MA500 (above the slow anchor — in uptrend zone, even during
                a short-term pullback below MA25)
    DOWNTREND : Close < MA25 AND Close ≤ MA500 (below fast MA and not above the anchor
                — genuine downtrend, not just a pullback)
    NEUTRAL   : Close between MA25 and MA500

    UPTREND takes priority so pullbacks (close < MA25 but > MA500) stay UPTREND,
    not DOWNTREND — avoids contradicting a bullish ribbon during normal retracements.

    Rows where MA25 or MA500 is NaN are marked NEUTRAL.
    """
    periods  = ma_periods or MA_PERIODS
    fast_col = f'ma_{min(periods)}'   # MA25
    slow_col = f'ma_{max(periods)}'   # MA500

    ma25  = df[fast_col]
    ma500 = df[slow_col]
    has_both = ma25.notna() & ma500.notna()

    # UPTREND checked first — above MA500 = in uptrend zone even during a pullback below MA25.
    # DOWNTREND only fires when price is below MA25 AND not above MA500 (genuine downtrend).
    conditions = [
        has_both & (df['Close'] > ma500),   # above slow anchor → UPTREND
        has_both & (df['Close'] < ma25),    # below fast MA (and not above MA500) → DOWNTREND
    ]
    choices = ['UPTREND', 'DOWNTREND']

    df['trend_direction'] = np.select(conditions, choices, default='NEUTRAL')
    return df


# ---------------------------------------------------------------------------
# Ribbon Analytics: spread, compression, MA order score
# ---------------------------------------------------------------------------

def add_ribbon_analytics(df: pd.DataFrame, ma_periods=None) -> pd.DataFrame:
    """
    Add ribbon-level metrics:
        ribbon_spread      – (ma_shortest - ma_longest) / ma_longest × 100
                             Positive = short MAs above long (bullish fan)
                             Negative = short MAs below long (bearish fan)
        ribbon_compression – True when |ribbon_spread| < RIBBON_COMPRESSION_THRESHOLD
                             Indicates MAs converging → big move imminent
        ma_order_score     – Count of MA pairs in correct ascending/descending order
                             16/16 = perfect uptrend (all short > all long)
                             0/16 = perfect downtrend
                             8/16 = tangled (chop zone)
    """
    periods = ma_periods or MA_PERIODS
    shortest = min(periods)
    longest = max(periods)
    short_col = f'ma_{shortest}'
    long_col = f'ma_{longest}'

    # Ribbon spread: % width
    has_both = df[short_col].notna() & df[long_col].notna()
    df['ribbon_spread'] = np.where(
        has_both & (df[long_col] != 0),
        (df[short_col] - df[long_col]) / df[long_col] * 100,
        np.nan,
    )

    # Ribbon compression flag
    df['ribbon_compression'] = has_both & (df['ribbon_spread'].abs() < RIBBON_COMPRESSION_THRESHOLD)

    # MA order score: count adjacent pairs where shorter MA > longer MA
    sorted_periods = sorted(periods)
    pair_count = len(sorted_periods) - 1  # 16 pairs for 17 MAs
    scores = pd.Series(0, index=df.index, dtype=int)
    valid = pd.Series(True, index=df.index)

    for j in range(pair_count):
        short_p = sorted_periods[j]
        long_p = sorted_periods[j + 1]
        sc = f'ma_{short_p}'
        lc = f'ma_{long_p}'
        pair_valid = df[sc].notna() & df[lc].notna()
        valid = valid & pair_valid
        scores = scores + (pair_valid & (df[sc] > df[lc])).astype(int)

    df['ma_order_score'] = np.where(valid, scores, np.nan)

    # Ribbon slope: median % change of all MAs over SLOPE_LOOKBACK bars.
    # Near-zero → ribbon is flat/sideways.  Positive → rising.  Negative → declining.
    slope_cols = []
    for p in sorted_periods:
        col = f'ma_{p}'
        ma_prev = df[col].shift(SLOPE_LOOKBACK)
        slope = np.where(
            df[col].notna() & ma_prev.notna() & (ma_prev != 0),
            (df[col] - ma_prev) / ma_prev * 100,
            np.nan,
        )
        slope_cols.append(pd.Series(slope, index=df.index, name=f'_slope_{p}'))
    slope_df = pd.concat(slope_cols, axis=1)
    df['ribbon_slope_pct'] = slope_df.median(axis=1)

    # ── Ribbon rollover: fast/medium MAs crossing the deep anchor MAs ──────────
    # Movers (25, 100, 200) progressively cross the anchors (300, 400, 500).
    # MA200 LAGS — MA25 & MA100 are the DRIVERS that lead the reversal, so they
    # carry more weight (2 each) than the lagging MA200 (1). A full driver cross
    # therefore reaches near-max BEFORE the slow MA200 catches up.
    # Bearish rollover (mover < anchor) confirms a downward reversal → S1.
    # Bullish rollover (mover > anchor) confirms an upward reversal   → B1.
    mover_weight = {25: 2, 100: 2, 200: 1}   # drivers lead, MA200 lags
    movers  = [p for p in (25, 100, 200) if p in periods]
    anchors = [p for p in (300, 400, 500) if p in periods]
    bull_w   = pd.Series(0, index=df.index, dtype=int)
    bear_w   = pd.Series(0, index=df.index, dtype=int)
    max_w    = pd.Series(0, index=df.index, dtype=int)
    for mp in movers:
        w = mover_weight[mp]
        for ap in anchors:
            mc, ac = f'ma_{mp}', f'ma_{ap}'
            if mc not in df.columns or ac not in df.columns:
                continue
            both = df[mc].notna() & df[ac].notna()
            max_w  = max_w  + both.astype(int) * w
            bull_w = bull_w + (both & (df[mc] > df[ac])).astype(int) * w
            bear_w = bear_w + (both & (df[mc] < df[ac])).astype(int) * w

    # Dominant direction by weighted score
    dom = np.where(bull_w > bear_w, bull_w,
                   np.where(bear_w > bull_w, bear_w, 0))
    df['rollover_score'] = dom.astype(int)            # weighted 0–15 (drivers emphasised)
    df['rollover_max']   = max_w.astype(int)          # achievable max (15 when all present)
    df['rollover_dir'] = np.where(bull_w > bear_w, 'bull',
                          np.where(bear_w > bull_w, 'bear', 'none'))

    # Stage is set by how deep the DRIVERS (MA25 & MA100) have cut — not the
    # lagging MA200. Stage 3 = both drivers through MA500, Stage 2 = +MA400,
    # Stage 1 = +MA300.
    drv = [p for p in (25, 100) if p in periods]
    def _both_drivers_past(anchor_p, bullish):
        if anchor_p not in anchors or not drv:
            return pd.Series(False, index=df.index)
        ac = f'ma_{anchor_p}'
        cond = pd.Series(True, index=df.index)
        for dp in drv:
            mc = f'ma_{dp}'
            both = df[mc].notna() & df[ac].notna()
            side = (df[mc] > df[ac]) if bullish else (df[mc] < df[ac])
            cond = cond & both & side
        return cond
    is_bull = df['rollover_dir'] == 'bull'
    stage = pd.Series(0, index=df.index, dtype=int)
    for anc, st in ((300, 1), (400, 2), (500, 3)):
        past = (_both_drivers_past(anc, True) & is_bull) | (_both_drivers_past(anc, False) & ~is_bull)
        stage = np.where(past, st, stage)
    df['rollover_stage'] = pd.Series(stage, index=df.index).astype(int)

    return df


# ---------------------------------------------------------------------------
# RSI — Relative Strength Index (Wilder, period=14)
# ---------------------------------------------------------------------------

def add_rsi(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    """
    Add RSI(14) using Wilder's smoothing (EWM alpha=1/period).
    Zones:
        >= 70  → overbought
        50–70  → bullish
        30–50  → bearish
        <  30  → oversold
    """
    delta    = df['Close'].diff()
    gain     = delta.clip(lower=0)
    loss     = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    rs       = avg_gain / avg_loss.replace(0.0, np.nan)
    df['rsi'] = 100.0 - (100.0 / (1.0 + rs))
    return df


# ---------------------------------------------------------------------------
# Rate of Change (momentum)
# ---------------------------------------------------------------------------

def add_roc(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add:
        roc – Rate of change over ROC_PERIOD bars.
              Formula: (close - close_N_ago) / close_N_ago × 100
    """
    df['roc'] = df['Close'].pct_change(periods=ROC_PERIOD) * 100
    return df


# ---------------------------------------------------------------------------
# Performance returns
# ---------------------------------------------------------------------------

def add_performance_pct(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add period-return columns based on daily close:
        pct_1d  – 1-bar  return  (today vs yesterday)
        pct_1w  – 5-bar  return  (~1 trading week)
        pct_1m  – 21-bar return  (~1 calendar month)
        pct_1y  – 252-bar return (~1 trading year)
    Values are percentage floats, e.g. 3.5 means +3.5%.
    """
    for col, periods in [('pct_1d', 1), ('pct_1w', 5), ('pct_1m', 21), ('pct_1y', 252)]:
        df[col] = df['Close'].pct_change(periods=periods) * 100
    return df


# ---------------------------------------------------------------------------
# Convenience: run all indicators in one call
# ---------------------------------------------------------------------------

def add_neutral_oscillation(df: pd.DataFrame, ma_periods=None,
                            lookback: int = 30,
                            cross_threshold: int = 3,
                            slope_threshold: float = 0.15) -> pd.DataFrame:
    """
    Detect neutral/topping-bottoming conditions via MA25 oscillation.

    Logic:
      - Count how many times price crossed MA25 in the last `lookback` bars.
        A cross = close went from one side of MA25 to the other.
      - Check if MA100 slope is flattening (|slope| < slope_threshold %).
      - If crosses >= cross_threshold AND MA100 is flat → neutral_oscillation = True.

    Adds columns:
      ma25_cross_count   – rolling count of MA25 crosses in last `lookback` bars
      neutral_oscillation – bool: MA25 oscillation + MA100 slowing = potential top/bottom
    """
    _ma_p = ma_periods or MA_PERIODS
    ma25  = min(_ma_p)   # fastest MA (25)
    ma100 = 100 if 100 in _ma_p else sorted(_ma_p)[min(3, len(_ma_p)-1)]

    ma25_col  = f'ma_{ma25}'
    ma100_col = f'ma_{ma100}'

    if ma25_col not in df.columns or ma100_col not in df.columns:
        df['ma25_cross_count']    = 0
        df['neutral_oscillation'] = False
        return df

    # 1. Detect crossings: price flips side relative to MA25
    above = (df['Close'] >= df[ma25_col]).astype(int)
    cross = above.diff().abs()   # 1 where a cross happened, 0 otherwise

    # Rolling count of crosses over the lookback window
    df['ma25_cross_count'] = cross.rolling(lookback, min_periods=lookback // 2).sum().fillna(0).astype(int)

    # 2. MA100 slope (% change over SLOPE_LOOKBACK bars)
    ma100_prev = df[ma100_col].shift(SLOPE_LOOKBACK)
    ma100_slope = np.where(
        df[ma100_col].notna() & ma100_prev.notna() & (ma100_prev != 0),
        (df[ma100_col] - ma100_prev) / ma100_prev * 100,
        np.nan,
    )
    ma100_slope_series = pd.Series(ma100_slope, index=df.index)

    # 3. Neutral oscillation flag
    df['neutral_oscillation'] = (
        (df['ma25_cross_count'] >= cross_threshold) &
        (ma100_slope_series.abs() < slope_threshold)
    )

    return df


def add_all_indicators(df: pd.DataFrame, ma_periods=None) -> pd.DataFrame:
    df = add_ma_ribbon(df, ma_periods=ma_periods)
    df = add_volume_analysis(df)
    df = add_trend(df, ma_periods=ma_periods)
    df = add_ribbon_analytics(df, ma_periods=ma_periods)
    df = add_roc(df)
    df = add_rsi(df)
    df = add_performance_pct(df)
    df = add_neutral_oscillation(df, ma_periods=ma_periods)
    return df
