"""
Technical indicator calculations applied to a single instrument's DataFrame.

Functions here mutate df in-place (or return a copy with new columns) and
are designed to be called sequentially from main.py.
"""

import numpy as np
import pandas as pd

from config import MA_PERIODS, VOLUME_LOOKBACK, ROC_PERIOD, RIBBON_COMPRESSION_THRESHOLD


# ---------------------------------------------------------------------------
# MA Ribbon
# ---------------------------------------------------------------------------

def add_ma_ribbon(df: pd.DataFrame, ma_periods=None) -> pd.DataFrame:
    """
    Add one SMA column per period in ma_periods.
    Columns named: ma_40, ma_50, ... ma_200 (or whatever periods are given).
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
    """
    df['volume_average']    = df['Volume'].rolling(VOLUME_LOOKBACK, min_periods=1).mean()
    df['volume_spike_flag'] = df['Volume'] > df['volume_average']
    return df


# ---------------------------------------------------------------------------
# Trend
# ---------------------------------------------------------------------------

def add_trend(df: pd.DataFrame, ma_periods=None) -> pd.DataFrame:
    """
    Classify each row as UPTREND, DOWNTREND, or NEUTRAL.

    UPTREND  : Close > all MAs  (above the full ribbon)
    DOWNTREND: Close < all MAs  (below the full ribbon)
    NEUTRAL  : Close is between any two MAs  (inside the ribbon)

    Rows where any MA is NaN (insufficient history) are marked NEUTRAL.
    """
    periods = ma_periods or MA_PERIODS
    ma_cols = [f'ma_{p}' for p in periods]
    ma_df   = df[ma_cols]

    any_nan  = ma_df.isna().any(axis=1)
    max_ma   = ma_df.max(axis=1)
    min_ma   = ma_df.min(axis=1)

    conditions = [
        (~any_nan) & (df['Close'] > max_ma),
        (~any_nan) & (df['Close'] < min_ma),
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
# Convenience: run all indicators in one call
# ---------------------------------------------------------------------------

def add_all_indicators(df: pd.DataFrame, ma_periods=None) -> pd.DataFrame:
    df = add_ma_ribbon(df, ma_periods=ma_periods)
    df = add_volume_analysis(df)
    df = add_trend(df, ma_periods=ma_periods)
    df = add_ribbon_analytics(df, ma_periods=ma_periods)
    df = add_roc(df)
    return df
