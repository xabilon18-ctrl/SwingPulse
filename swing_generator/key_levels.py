"""
Historical key price level detection.

Algorithm:
    1. Find pivot highs and pivot lows across the full 6-year dataset using a
       symmetric lookback window (PIVOT_LOOKBACK candles each side).
    2. Cluster adjacent pivots that are within KEY_LEVEL_CLUSTER_RANGE of each
       other — keep the one with the highest touch count.
    3. Count how many times price has touched each level throughout history.
    4. For today: flag which levels the day's candle reached.

Output per instrument (used in the daily row):
    key_level_price        – price of the nearest relevant level
    key_level_type         – 'top' or 'bottom'
    key_level_date         – date the level was first established
    key_level_touch_count  – total historical touches
    key_level_touched_today– 'yes' or 'no'
    key_levels_all         – pipe-separated summary of ALL levels
"""

import pandas as pd

from _active_config import (
    PIVOT_LOOKBACK,
    KEY_LEVEL_TOUCH_TOLERANCE,
    KEY_LEVEL_CLUSTER_RANGE,
)


# ---------------------------------------------------------------------------
# Pivot detection
# ---------------------------------------------------------------------------

def _find_pivot_highs(series: pd.Series, lookback: int) -> pd.Series:
    """Boolean Series — True where series[i] is the max in [i-N, i+N]."""
    rolling_max = series.rolling(2 * lookback + 1, center=True).max()
    return (series == rolling_max) & series.notna()


def _find_pivot_lows(series: pd.Series, lookback: int) -> pd.Series:
    """Boolean Series — True where series[i] is the min in [i-N, i+N]."""
    rolling_min = series.rolling(2 * lookback + 1, center=True).min()
    return (series == rolling_min) & series.notna()


# ---------------------------------------------------------------------------
# Touch counting
# ---------------------------------------------------------------------------

def _count_touches(df: pd.DataFrame, price: float, tol: float) -> int:
    """
    Count candles where the price range [Low, High] overlaps the level band
    [price*(1-tol), price*(1+tol)].
    """
    upper = price * (1 + tol)
    lower = price * (1 - tol)
    mask  = (df['Low'] <= upper) & (df['High'] >= lower)
    return int(mask.sum())


# ---------------------------------------------------------------------------
# Clustering
# ---------------------------------------------------------------------------

def _cluster(levels_df: pd.DataFrame, cluster_range: float) -> pd.DataFrame:
    """
    Merge levels within cluster_range of each other.
    When merging, keep the representative with the highest touch_count.
    """
    if levels_df.empty:
        return levels_df

    sorted_df = levels_df.sort_values('key_level_price').reset_index(drop=True)
    used       = [False] * len(sorted_df)
    clustered  = []

    for i in range(len(sorted_df)):
        if used[i]:
            continue
        price = sorted_df.loc[i, 'key_level_price']
        lo    = price * (1 - cluster_range)
        hi    = price * (1 + cluster_range)

        group_mask = (sorted_df['key_level_price'] >= lo) & \
                     (sorted_df['key_level_price'] <= hi)
        group = sorted_df[group_mask]
        if group.empty:
            continue

        best_idx = group['key_level_touch_count'].idxmax()
        clustered.append(sorted_df.loc[best_idx].to_dict())

        for idx in group.index:
            used[idx] = True

    return pd.DataFrame(clustered).reset_index(drop=True)


# ---------------------------------------------------------------------------
# Main public function
# ---------------------------------------------------------------------------

def find_key_levels(df: pd.DataFrame) -> pd.DataFrame:
    """
    Find all significant pivot highs and lows in the instrument's history.

    Returns a DataFrame with columns:
        key_level_price, key_level_type, key_level_date, key_level_touch_count
    Sorted by price descending.
    """
    pivot_high_mask = _find_pivot_highs(df['High'], PIVOT_LOOKBACK)
    pivot_low_mask  = _find_pivot_lows(df['Low'],  PIVOT_LOOKBACK)

    records = []

    for date, row in df[pivot_high_mask].iterrows():
        price = float(row['High'])
        records.append({
            'key_level_price':       round(price, 8),
            'key_level_type':        'top',
            'key_level_date':        str(date.date()),
            'key_level_touch_count': _count_touches(df, price, KEY_LEVEL_TOUCH_TOLERANCE),
        })

    for date, row in df[pivot_low_mask].iterrows():
        price = float(row['Low'])
        records.append({
            'key_level_price':       round(price, 8),
            'key_level_type':        'bottom',
            'key_level_date':        str(date.date()),
            'key_level_touch_count': _count_touches(df, price, KEY_LEVEL_TOUCH_TOLERANCE),
        })

    if not records:
        return pd.DataFrame(columns=[
            'key_level_price', 'key_level_type',
            'key_level_date',  'key_level_touch_count',
        ])

    levels_df = pd.DataFrame(records)
    levels_df = _cluster(levels_df, KEY_LEVEL_CLUSTER_RANGE)
    # Only keep levels touched at least twice (once to form, once to confirm)
    levels_df = levels_df[levels_df['key_level_touch_count'] >= 2]
    return levels_df.sort_values('key_level_price', ascending=False).reset_index(drop=True)


# ---------------------------------------------------------------------------
# Today's level summary (used in daily output row)
# ---------------------------------------------------------------------------

def today_level_summary(
    levels_df: pd.DataFrame,
    today_high: float,
    today_low:  float,
    today_close: float,
) -> dict:
    """
    Given the instrument's full key-levels table and today's OHLC, return
    the fields that go into the daily output row.
    """
    empty = {
        'key_level_price':        '',
        'key_level_type':         '',
        'key_level_date':         '',
        'key_level_touch_count':  '',
        'key_level_touched_today': 'no',
        'key_levels_all':         '',
    }

    if levels_df.empty:
        return empty

    tol   = KEY_LEVEL_TOUCH_TOLERANCE
    upper = today_high * (1 + tol)
    lower = today_low  * (1 - tol)

    touched_today = levels_df[
        (levels_df['key_level_price'] <= upper) &
        (levels_df['key_level_price'] >= lower)
    ]

    # Primary level: prefer one touched today, else nearest to close
    if not touched_today.empty:
        # Pick the touched level with highest touch count
        primary = touched_today.loc[touched_today['key_level_touch_count'].idxmax()]
        touched_flag = 'yes'
    else:
        diffs   = (levels_df['key_level_price'] - today_close).abs()
        primary = levels_df.loc[diffs.idxmin()]
        touched_flag = 'no'

    # Summarise all levels as a readable string
    all_parts = []
    for _, lvl in levels_df.iterrows():
        all_parts.append(
            f"{lvl['key_level_type']}@{lvl['key_level_price']:.4f}"
            f"[x{lvl['key_level_touch_count']}|{lvl['key_level_date']}]"
        )
    all_str = ' | '.join(all_parts)

    return {
        'key_level_price':        round(float(primary['key_level_price']), 6),
        'key_level_type':         primary['key_level_type'],
        'key_level_date':         primary['key_level_date'],
        'key_level_touch_count':  int(primary['key_level_touch_count']),
        'key_level_touched_today': touched_flag,
        'key_levels_all':         all_str,
    }
