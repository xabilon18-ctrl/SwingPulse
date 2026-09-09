"""
Technical indicator calculations applied to a single instrument's DataFrame.

Functions here mutate df in-place (or return a copy with new columns) and
are designed to be called sequentially from main.py.
"""

import numpy as np
import pandas as pd

from _active_config import (MA_PERIODS, VOLUME_LOOKBACK, ROC_PERIOD, RIBBON_COMPRESSION_THRESHOLD,
                            SLOPE_LOOKBACK, MA_TOUCH_TOLERANCE, TREND_UP_FRAC, TREND_DOWN_FRAC)


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

def _reported_volume(df: pd.DataFrame) -> pd.Series:
    """Volume with UNREPORTED (zero) bars masked to NaN.

    Yahoo intermittently serves a bar with a perfectly good price and a volume
    of 0 — the mirror of the volume-but-no-price bar `_drop_priceless` catches
    in data_fetcher.py. It cannot be dropped the same way: the price is real
    and the ribbon needs it. It must only be kept out of the volume BASELINE.

    Left in the rolling mean it is corrosive in a way that is easy to miss,
    because the damage lands on the days AFTER it: a zero drags the 25-bar
    average down, so the next perfectly ordinary bar reads as a spike.
    Measured on the cache 2026-08-04 — 43 of 736 instruments carry at least one
    zero bar in 60 days, and the intermittent ones are the dangerous set:

        SPAIN35  ^IBEX  52/60 zero bars → 25d average 0.24x its true value
        HANGSENG ^HSI   22/60           → 0.28x
        NI225    ^N225  22/60           → 0.29x
        AUS200   ^AXJO  23/60           → 0.27x
        COCOA    CC=F   18/60           → 0.52x

    A 0.27x average means an ordinary bar prints ~3.7x RVOL, which clears
    sector_activity.VOL_SPIKE_RVOL (2.0) on nothing at all: cocoa generated 60
    volume-spike events in 250 days against AAPL's 7 and ^GSPC's 0, so the
    Commodities and Asia radar rows were substantially measuring Yahoo's data
    holes. The published 2026-07-31 payload showed whole groups at 0.0x RVOL
    (SPAIN35 all 19 names, UK100 median 0.00x).

    Instruments that never report volume at all (^SOX, DX-Y.NYB, ^J200.JO,
    ONE-USD — 60/60 zeros) are deliberately unaffected in EFFECT: masking every
    bar leaves an all-NaN series, whose rolling mean is NaN, so app.js `rvol()`
    still returns null and the UI still renders "—" for them.
    """
    return df['Volume'].astype('float64').replace(0.0, np.nan)


def add_volume_analysis(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add:
        volume_average    – rolling mean over VOLUME_LOOKBACK days, computed
                            over REPORTED bars only (see _reported_volume)
        volume_spike_flag – True if today's volume > volume_average. A bar with
                            no reported volume is never a spike (NaN > x → False).
        pvo               – Percentage Volume Oscillator: (EMA12 − EMA26) of
                            volume as a % of EMA26. >0 = volume expanding vs
                            its longer baseline, <0 = drying up.
        pvo_signal        – EMA9 of pvo (signal line)
    """
    vol = _reported_volume(df)

    df['volume_average']    = vol.rolling(VOLUME_LOOKBACK, min_periods=1).mean()
    df['volume_spike_flag'] = vol > df['volume_average']

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
    Classify each row as UPTREND, DOWNTREND, or NEUTRAL from the position of
    price within the WHOLE ribbon.

    UPTREND   : price holds ≥ TREND_UP_FRAC of the ribbon (2 of 3) AND is above
                the MA500 anchor. A shallow pullback below MA50 still reads
                UPTREND — the slow ribbon is what has to break.
    DOWNTREND : price holds ≤ TREND_DOWN_FRAC of the ribbon (1 of 3) AND is
                below MA50.
    NEUTRAL   : anything else — price is inside the ribbon. This is the honest
                label for a deep pullback and for a chop zone.

    Rows without both a fast and a slow MA are NEUTRAL.

    HISTORY (fixed 2026-07-30). The rule used to be `UPTREND ⇔ Close > MA500`,
    with DOWNTREND checked second — so:
      • Every ribbon MA but the anchor had no vote. COHR read UPTREND on 4H
        with price below 19 of its 20 then-MAs and RSI 32; PLTR read UPTREND on
        Daily below 19 of 20 with a negative ribbon slope.
      • DOWNTREND was UNREACHABLE while price was above the anchor, because
        np.select takes the first true condition. Whatever happened to the
        faster lines, the label stayed UPTREND until price lost MA500 outright.
      • The 4H suffered worst. Equities/indices resample to ~2 four-hour bars a
        session, so 4H MA500 spans ~305 calendar days (US100: verified). The
        "4-hour trend" was a 10-month trend and could not report a 4H breakdown
        until price gave up a year of average.
    Re-classified 110 of 736 Daily rows and 113 of 735 4H rows on the
    2026-07-28 run; 17 4H rows moved UPTREND → DOWNTREND, a transition the old
    rule could not make at all.

    trend_direction is NOT the signal-firing gate (signals.py keeps its own
    strict above_all/below_all ribbon test and its in_uptrend/in_downtrend
    latch), so this does not change which signals fire.
    """
    periods  = ma_periods or MA_PERIODS
    ma_cols  = [f'ma_{p}' for p in periods if f'ma_{p}' in df.columns]
    fast_col = f'ma_{min(periods)}'   # MA50
    slow_col = f'ma_{max(periods)}'   # MA500

    if not ma_cols or fast_col not in df.columns or slow_col not in df.columns:
        df['trend_direction'] = 'NEUTRAL'
        return df

    ribbon = df[ma_cols]
    close  = df['Close']

    # Fraction of the AVAILABLE ribbon that price closes above. Counting only
    # non-NaN MAs keeps short-history instruments (where the deep MAs haven't
    # warmed up) on the same scale instead of scoring them as all-below.
    n_avail = ribbon.notna().sum(axis=1)
    held    = ribbon.lt(close, axis=0).sum(axis=1)
    frac    = held.divide(n_avail.where(n_avail > 0))

    has_both = df[fast_col].notna() & df[slow_col].notna()
    above_anchor = close > df[slow_col]
    above_fast   = close > df[fast_col]

    conditions = [
        has_both & (frac >= TREND_UP_FRAC)   & above_anchor,
        has_both & (frac <= TREND_DOWN_FRAC) & ~above_fast,
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
                             2/2 = perfect uptrend (50 > 250 > 500)
                             0/2 = perfect downtrend
                             1/2 = tangled (chop zone)
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
    pair_count = len(sorted_periods) - 1  # 2 pairs for the 3-MA ribbon
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

    # ── Ribbon rollover: faster MAs crossing the slower ones ──────────────────
    # Bearish rollover (mover < anchor) confirms a downward reversal → S1.
    # Bullish rollover (mover > anchor) confirms an upward reversal   → B1.
    #
    # REWRITTEN 2026-09-09 for the 3-line ribbon. This used to name periods
    # literally — movers (25, 100, 200) against anchors (300, 400, 500) — and
    # on a [50, 250, 500] ribbon NONE of those six periods exists, so every
    # instrument would have scored 0 / 'none' forever: rollover is the single
    # heaviest factor in the confluence score (35 of 100) and context rule R4
    # reads rollover_stage, so the failure would have been silent and total.
    #
    # Now it is positional: every (faster, slower) pair in whatever ribbon it is
    # handed. The FAST line is the driver that leads a reversal, so its pairs
    # carry double weight; the slower movers lag and carry 1. On [50, 250, 500]
    # the pairs are 50>250, 50>500, 250>500 for a max weight of 5.
    _p_sorted = sorted(periods)
    movers  = _p_sorted[:-1]                     # everything but the slowest
    anchors = _p_sorted[1:]                      # everything but the fastest
    mover_weight = {mp: (2 if i == 0 else 1) for i, mp in enumerate(movers)}
    bull_w   = pd.Series(0, index=df.index, dtype=int)
    bear_w   = pd.Series(0, index=df.index, dtype=int)
    max_w    = pd.Series(0, index=df.index, dtype=int)
    for mp in movers:
        w = mover_weight[mp]
        for ap in anchors:
            if ap <= mp:
                continue                          # a line never crosses itself
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
    df['rollover_score'] = dom.astype(int)            # weighted (fast line emphasised)
    df['rollover_max']   = max_w.astype(int)          # achievable max (5 on a 3-line ribbon)
    df['rollover_dir'] = np.where(bull_w > bear_w, 'bull',
                          np.where(bear_w > bull_w, 'bear', 'none'))

    # Stage = how DEEP the rollover has cut, 0-3. Also rewritten positionally
    # 2026-09-09: it used to ask whether the MA25/MA100 drivers had passed
    # MA300 / MA400 / MA500, and on a [50, 250, 500] ribbon none of those five
    # periods exists, so the stage would have been pinned at 0 and context rule
    # R4 (S3/S4 at rollover_stage 2, a measured +0.11/+0.14 R nudge) could
    # never have fired again.
    #
    # On the 3-line ribbon the depth ladder is the only one there is to climb:
    #   Stage 1 — the fast line (MA50) has crossed the mid line (MA250)
    #   Stage 2 — the fast line has also crossed the anchor (MA500)
    #   Stage 3 — the mid line has crossed the anchor too: a full flip, the
    #             whole ribbon re-stacked in the new direction
    # A longer ribbon walks the same ladder over its own (fast, mid, anchor)
    # positions, so this stays meaningful if the ribbon is ever widened again.
    _fast   = _p_sorted[0]
    _anchor = _p_sorted[-1]
    _mid    = _p_sorted[len(_p_sorted) // 2]
    if _mid in (_fast, _anchor) and len(_p_sorted) >= 3:
        _mid = _p_sorted[1]

    def _crossed(mover_p, anchor_p, bullish):
        # True where ma_mover sits on the `bullish` side of ma_anchor.
        mc, ac = f'ma_{mover_p}', f'ma_{anchor_p}'
        if mover_p == anchor_p or mc not in df.columns or ac not in df.columns:
            return pd.Series(False, index=df.index)
        both = df[mc].notna() & df[ac].notna()
        side = (df[mc] > df[ac]) if bullish else (df[mc] < df[ac])
        return both & side

    is_bull = df['rollover_dir'] == 'bull'
    stage = pd.Series(0, index=df.index, dtype=int)
    ladder = ((_fast, _mid, 1), (_fast, _anchor, 2), (_mid, _anchor, 3))
    for mv, an, st in ladder:
        past = (_crossed(mv, an, True) & is_bull) | (_crossed(mv, an, False) & ~is_bull)
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
    Detect neutral/topping-bottoming conditions via fast-MA oscillation.

    Logic:
      - Count how many times price crossed the FAST line (MA50) in the last
        `lookback` bars. A cross = close went from one side of it to the other.
      - Check if the MID line (MA250) slope is flattening (|slope| < threshold).
      - If crosses >= cross_threshold AND the mid line is flat
        → neutral_oscillation = True.

    Both lines are picked BY POSITION, not by number. Until 2026-09-09 the
    reference was a literal MA100 with a fallback to `sorted(periods)[3]`; on
    the [50, 250, 500] ribbon MA100 does not exist and index 3 is out of range,
    so the fallback would have landed on the MA500 ANCHOR — an anchor is flat
    almost by construction, which would have made this flag fire far too often
    instead of failing loudly.

    Adds columns:
      ma_fast_cross_count  – rolling count of MA50 crosses in last `lookback` bars
                             (renamed from ma25_cross_count when the fast edge
                             moved 25 -> 50)
      neutral_oscillation  – bool: fast-MA oscillation + mid-MA slowing =
                             potential top/bottom
    """
    _ma_p    = sorted(ma_periods or MA_PERIODS)
    fast_p   = _ma_p[0]                                  # fast edge  (MA50)
    mid_p    = _ma_p[len(_ma_p) // 2] if len(_ma_p) >= 3 else _ma_p[-1]
    if mid_p == fast_p and len(_ma_p) > 1:
        mid_p = _ma_p[1]

    fast_col = f'ma_{fast_p}'
    mid_col  = f'ma_{mid_p}'

    if fast_col not in df.columns or mid_col not in df.columns:
        df['ma_fast_cross_count'] = 0
        df['neutral_oscillation'] = False
        return df

    # 1. Detect crossings: price flips side relative to the fast line
    above = (df['Close'] >= df[fast_col]).astype(int)
    cross = above.diff().abs()   # 1 where a cross happened, 0 otherwise

    # Rolling count of crosses over the lookback window
    df['ma_fast_cross_count'] = cross.rolling(lookback, min_periods=lookback // 2).sum().fillna(0).astype(int)

    # 2. Mid-line slope (% change over SLOPE_LOOKBACK bars)
    mid_prev = df[mid_col].shift(SLOPE_LOOKBACK)
    mid_slope = np.where(
        df[mid_col].notna() & mid_prev.notna() & (mid_prev != 0),
        (df[mid_col] - mid_prev) / mid_prev * 100,
        np.nan,
    )
    mid_slope_series = pd.Series(mid_slope, index=df.index)

    # 3. Neutral oscillation flag
    df['neutral_oscillation'] = (
        (df['ma_fast_cross_count'] >= cross_threshold) &
        (mid_slope_series.abs() < slope_threshold)
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
    df = add_ma_stack(df, ma_periods=ma_periods)
    return df


# ---------------------------------------------------------------------------
# MA stack — where the fast / mid / anchor lines sit relative to each other
# ---------------------------------------------------------------------------
def stack_periods(ma_periods=None) -> 'tuple | None':
    """The three ribbon lines the stack reads, chosen BY POSITION not by value.

    Unscaled this is (50, 250, 500) — the whole ribbon. It must not be
    hard-coded to those numbers: a session-normalised instrument
    (config.H1_SESSION_NORMALIZE / H4_SESSION_NORMALIZE) carries a ribbon
    scaled by its bars-per-session — an EU index at 2 bars/session runs
    MA17-MA167 — so the 500 column is simply not on that frame, and a literal
    lookup would silently produce an empty stack on exactly the instruments the
    scaling exists to fix.

    On the 3-line ribbon these are simply its three lines. A short-history
    instrument whose ribbon was clipped by `p <= len(df)` has fewer than three
    and returns None.

    FIXED 2026-09-09. The old code took positions 1, 9 and last, which were 50,
    250 and 500 only because the ribbon then had twenty lines. Handed
    [50, 250, 500] it read p[1]=250 as the fast line and p[len//2]=250 as the
    mid, failed its own `fast < mid < anchor` sanity check, and returned None —
    so the whole MA-stack strip and its filter would have gone blank on every
    instrument without a single error. Pick fast/mid/anchor from the ENDS and
    the middle instead, which is right for any ribbon width.
    """
    p = sorted({int(x) for x in (ma_periods if ma_periods is not None else MA_PERIODS)})
    if len(p) < 3:
        return None
    fast   = p[0]
    mid    = p[len(p) // 2]
    anchor = p[-1]
    if mid in (fast, anchor):
        mid = p[1]
    if not (fast < mid < anchor):
        return None
    return fast, mid, anchor


def add_ma_stack(df: pd.DataFrame, ma_periods=None) -> pd.DataFrame:
    """Stack state, the closest pair, its gap, and bars since that pair flipped.

    DISPLAY ONLY. Measured 2026-09-03 over 40,476 cross events and 29,479
    matched signal trades: the 50x250 cross has no edge as an entry (47-53% win,
    below buy-and-hold on every timeframe) and none as an exit (a control that
    merely held longer, with no cross involved, matched it). Nothing in
    signals.py reads these columns and nothing should start.
    """
    df['stack_state']      = ''
    df['stack_pair']       = ''
    df['stack_gap_pct']    = np.nan
    df['stack_flip_bars']  = np.nan

    sel = stack_periods(ma_periods)
    if sel is None or df.empty:
        return df
    fast, mid, anchor = sel
    cols = {n: f'ma_{n}' for n in sel}
    if any(c not in df.columns for c in cols.values()):
        return df

    a, b, c = (df[cols[fast]], df[cols[mid]], df[cols[anchor]])
    close   = df['Close'].where(df['Close'] > 0)

    # State — the two clean orderings; everything else is honestly "mixed",
    # which is four of the six possible orders and the common case.
    df['stack_state'] = np.select(
        [(a > b) & (b > c), (a < b) & (b < c)],
        ['BULL', 'BEAR'],
        default='MIXED',
    )
    df.loc[a.isna() | b.isna() | c.isna(), 'stack_state'] = ''

    # Closest pair and its gap. Min over all three pairs equals min over the two
    # value-adjacent ones — the third pair spans the whole range by definition.
    pairs = ((fast, mid), (fast, anchor), (mid, anchor))
    gaps  = pd.DataFrame(
        {f'{x}x{y}': (df[cols[x]] - df[cols[y]]).abs() / close * 100 for x, y in pairs},
        index=df.index,
    )
    ok = gaps.notna().all(axis=1)
    df.loc[ok, 'stack_pair']    = gaps[ok].idxmin(axis=1)
    df.loc[ok, 'stack_gap_pct'] = gaps[ok].min(axis=1).round(3)

    # Bars since each pair last swapped places, then pick the chosen pair's.
    pos   = np.arange(len(df))
    since = {}
    for x, y in pairs:
        s = np.sign(df[cols[x]] - df[cols[y]]).replace(0, np.nan).ffill()
        changed = s.ne(s.shift(1)) & s.shift(1).notna() & s.notna()
        last = pd.Series(np.where(changed.to_numpy(), pos, np.nan),
                         index=df.index).ffill()
        since[f'{x}x{y}'] = pos - last
    flip = pd.DataFrame(since, index=df.index)
    picked = pd.Series(np.nan, index=df.index)
    for name in flip.columns:
        m = ok & (df['stack_pair'] == name)
        picked.loc[m] = flip.loc[m, name]
    df['stack_flip_bars'] = picked

    return df
