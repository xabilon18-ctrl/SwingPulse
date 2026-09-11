"""
SwingPulse — MA500 Profile Configuration
=========================================
MA ribbon: 50, 250, 500 (3 MAs).

Data requirements:
    Daily   : 500 bars min → 45 yr history covers ~11,340 bars ✓
    4H      : 500 bars     → Yahoo provides ~729 days of hourly (~2,919 4H bars ✓)
    Note: instruments with less than 45 yr history get MA periods clipped automatically.
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)

# ---------------------------------------------------------------------------
# MA Ribbon  — 50, 250, 500  (3 MAs)
# ---------------------------------------------------------------------------
# Cut from the 20-line ribbon (25, 50, 75 ... 500) to the three lines the
# signal rules actually name, 2026-09-09:
#     MA50   fast edge   — B2/S2 fire here   (was MA25)
#     MA250  mid-ribbon  — B3/S3 fire here
#     MA500  anchor      — B4/S4 fire here, and the B1/S1 gate
# The other seventeen lines were drawn and scored but never triggered anything;
# they only made the chart unreadable and let ribbon-fraction metrics claim a
# precision the rules did not have. The fast edge moves 25 -> 50: every B2/S2
# that used to fire on the MA25 cross now fires on the MA50 cross.
MA_PERIODS  = [50, 250, 500]

SMALL_MA_RANGE = [p for p in MA_PERIODS if p <= 250]   # BP2/SP2: fast MAs [50, 250]
MA_MIDPOINT    = MA_PERIODS[len(MA_PERIODS) // 2]       # MA250 — mid-ribbon line

# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
HISTORY_YEARS     = 13   # daily MA500 warmup (~2y) + backtest window since 2016
                         # (2016 signals need data from ~2014). Was 45 — that
                         # depth only served the removed monthly timeframe.
CACHE_DIR         = os.path.join(BASE_DIR, 'cache_ma500')
INSTRUMENTS_FILE  = os.path.join(ROOT_DIR, 'Instruments.txt')
MIN_ROWS_REQUIRED = 10    # min daily bars to LIST an instrument (price/volume only).
                          # MA ribbon & signals fill in automatically as history grows
                          # (MA500 needs 500+ bars). Recent IPOs (e.g. Cerebras) still
                          # appear with no signal until they accumulate enough bars.

# ---------------------------------------------------------------------------
# Volume
# ---------------------------------------------------------------------------
VOLUME_LOOKBACK = 25   # unchanged

# ---------------------------------------------------------------------------
# Key Levels
# ---------------------------------------------------------------------------
PIVOT_LOOKBACK            = 5
KEY_LEVEL_TOUCH_TOLERANCE = 0.002
KEY_LEVEL_CLUSTER_RANGE   = 0.005
KEY_LEVEL_WINDOW_BARS     = 1500   # detect levels on the last ~6y of daily bars
KEY_LEVEL_MAJOR_COUNT     = 8      # touched-today alerts consider only the N most-touched
                                   # levels — against ALL levels ~80% of instruments "touch"
                                   # one every day (levels blanket the range), vs ~8% for top-8

# ---------------------------------------------------------------------------
# Signal Detection
# ---------------------------------------------------------------------------
MA_TOUCH_TOLERANCE        = 0.001
TREND_DURATION_THRESHOLD  = 200   # trading days before "potential turning point"
WATCH_APPROACH_PCT        = 0.015
MIDPOINT_BOUNCE_PCT       = 0.015

# Wider MA spacing → slightly looser penetration tolerances
MAX_PENETRATION_4H    = 0.025  # 2.5%  (was 2.0%)
MAX_PENETRATION_DAILY = 0.020  # 2.0%  (was 1.5%)

# Signal lookback — same cadence as original
# 1H reports a SHORTER calendar window than 4H, deliberately. 4H's 60 bars is
# ~30 sessions on an equity; carrying that calendar across would need ~210 bars
# at 7 hourly bars a session, and an hourly signal from a month ago is not a
# thing anyone acts on. 120 bars is ~17 sessions on an equity and ~5 on a 24h
# contract — the same "recent enough to still matter" intent, read on the
# faster bar.
SIGNAL_LOOKBACK_1H     = 120
SIGNAL_LOOKBACK_4H     = 60
SIGNAL_LOOKBACK_DAILY  = 20
# Weekly bars are slow: 12 bars is a quarter, which is how long a weekly setup
# stays the thing you are watching. 4H/Daily both report ~1-1.5 months back.
SIGNAL_LOOKBACK_WEEKLY = 12
# 3-day sits between Daily and Weekly and its lookback does too: 10 bars is 30
# trading days (~6 weeks), against Daily's 20 bars (~1 month) and Weekly's 12
# (~3 months). Carrying Daily's 20 across would report a 3-month-old fire.
SIGNAL_LOOKBACK_3D     = 10

# Dedup windows
P3P4_DEDUP_WINDOW = 3
P2_DEDUP_WINDOW   = 5

# TTP cooldown
TTP_COOLDOWN_BARS = 30

# ---------------------------------------------------------------------------
# Ribbon Analytics
# ---------------------------------------------------------------------------
# MAs spaced 25 apart → wider natural spread → raise compression threshold
# Step 10 was 3.0%; step 25 scales by (25/10) = 2.5 → 7.5 → round to 5.0%
RIBBON_COMPRESSION_THRESHOLD = 5.0
ROC_PERIOD              = 5
SLOPE_LOOKBACK          = 10
NEUTRAL_SLOPE_THRESHOLD = 0.5

# ---------------------------------------------------------------------------
# Trend classification (indicators.add_trend)
# ---------------------------------------------------------------------------
# trend_direction is decided by how much of the RIBBON price holds, not by the
# MA500 anchor alone. The old rule was `UPTREND ⇔ Close > MA500` — one line, the
# other 19 ignored, and (because np.select takes the first true condition)
# DOWNTREND was unreachable while price sat above the anchor at all. On 4H that
# anchor spans ~305 calendar days for equities/indices (2 bars/session), so the
# "4-hour trend" was really a 10-month trend and could not report a 4H
# breakdown until price gave up a year's worth of average.
#
# Now: UPTREND needs price above TREND_UP_FRAC of the ribbon AND above the
# anchor; DOWNTREND needs price below all but TREND_DOWN_FRAC of it AND below
# MA50. Anything in between is NEUTRAL — price is inside the ribbon, which is
# the honest read for a pullback or a chop zone.
#
# RESCALED 2026-09-09 for the 3-line ribbon. On 20 MAs the fraction could take
# 21 values and 0.75/0.25 meant "15 of 20" / "5 of 20". On 3 MAs it can only be
# 0, 1/3, 2/3 or 1, so 0.75 would have silently hardened to "above ALL THREE"
# and 0.25 to "below all three" — which contradicts the rule this block exists
# to state: a shallow pullback below the FAST line must still read UPTREND, and
# it is the slow ribbon that has to break. 2/3 and 1/3 keep that meaning:
#   UPTREND   = above MA500 and at least 2 of the 3 lines (so a dip under MA50
#               while MA250 and MA500 still hold is still an uptrend)
#   DOWNTREND = below MA50 and at most 1 of the 3 lines held
TREND_UP_FRAC   = 0.65   # ≥2 of 3 MAs held → UPTREND
TREND_DOWN_FRAC = 0.35   # ≤1 of 3 MAs held → DOWNTREND

# ---------------------------------------------------------------------------
# 4H bar geometry  (fixed 2026-07-30)
# ---------------------------------------------------------------------------
# A "4H bar" is only as fast as the session it comes from. yfinance 1h returns
# REGULAR SESSION ONLY for a cash index — ^NDX gives 13:00–19:00 UTC, which
# _resample_4h buckets into 2 bars a session. A 24h contract gives 6. Same
# label, three times the bar count, so MA500 spanned ~305 calendar days instead
# of ~83 and the 4H was a 10-month read wearing a 4H badge. Measured cost on the
# 07-28 cache: all 20 cash indices carried a 4H trend label that disagreed with
# a true-4H read, and 5 produced NO fire while a true 4H fired — US100 S1
# (07-24), SOX S1 (07-27), NI225 S1 (07-28), NQTW S1 (07-28), CHINAH B1.
#
# NB this is NOT a universal problem. A US equity really does trade 6.5h, so its
# 4H chart is ~2 bars/session everywhere, TradingView included — our ribbon
# already matches. Only instruments CHARTED as 24h contracts are affected.
#
# Two fixes, in order of preference:
#   1. H4_SOURCE — pull the 4H timeframe from the 24h contract. Exact: real 24h
#      bars, so wick-touch setups (B3/B4) are right too. Daily is untouched and
#      still comes from the cash index — the timeframes are independent.
#   2. H4_SESSION_NORMALIZE — where no 24h feed exists, scale the ribbon by the
#      instrument's bars/session so it spans the calendar window a 24h chart
#      would. Approximate (the BARS are still session bars) but far closer than
#      a ribbon reaching 3x too far back.
H4_BARS_PER_SESSION_TARGET = 6      # what a ~23h-session 4H chart delivers

# Cash index → 24h contract, for the 4H TIMEFRAME ONLY. Verified 2026-07-30:
# each returns 1h bars across 0–23 UTC → 6.0 four-hour bars/session.
H4_SOURCE = {
    '^NDX':  'NQ=F',    # US100
    '^GSPC': 'ES=F',    # US500
    '^DJI':  'YM=F',    # US30
    '^RUT':  'RTY=F',   # RUSSELL
    '^N225': 'NKD=F',   # NI225
}

# Charted as 24h contracts but with no usable yfinance future — scale the
# ribbon instead. Every remaining cash index in the book.
H4_SESSION_NORMALIZE = {
    '^SOX', '^FTSE', '^GDAXI', '^FCHI', '^IBEX', '^AEX', '^STOXX50E', '^SSMI',
    '^GSPTSE', '^TWII', '^HSI', '^HSCE', '^STI', '^AXJO', '^J200.JO',
}

# ---------------------------------------------------------------------------
# 1H bar geometry  (added 2026-09-03)
# ---------------------------------------------------------------------------
# The 1H timeframe reads the SAME hourly parquet cache the 4H timeframe is
# resampled from — no new download, no new feed. It therefore inherits both 4H
# geometry fixes unchanged: H4_SOURCE already redirects the hourly cache of a
# cash index to its 24h contract (data_fetcher.h4_ticker), and the instruments
# with no usable future still need their ribbon scaled.
#
# The scale problem is SHARPER at 1H than at 4H, because the divisor is bigger:
# measured over the cache on 2026-09-03, an equity returns 7 hourly bars a
# session and a 24h contract returns 23-24. So an unscaled MA500 spans
#   equity        500 / 7  = 71 sessions  (~3.4 months)
#   24h contract  500 / 24 = 21 sessions  (~1 month)
# — the same label reaching 3.4x further back on one instrument than another,
# which is exactly the bug the 4H timeframe shipped with for four months.
H1_BARS_PER_SESSION_TARGET = 24     # what a 24h-session 1H chart delivers

# Same set as the 4H case, and for the same reason: charted as a 24h contract,
# no usable yfinance future, so scale the ribbon instead of switching the feed.
H1_SESSION_NORMALIZE = H4_SESSION_NORMALIZE

# ---------------------------------------------------------------------------
# Weekly bar geometry  (added 2026-09-02)
# ---------------------------------------------------------------------------
# The weekly timeframe runs the SAME MA50-MA500 ribbon on weekly bars, exactly
# as Daily and 4H each run it on theirs. No scaling: unlike the 4H case there is
# no session ambiguity — a week is a week on every venue in the book, and one
# weekly bar is one weekly bar whether the instrument trades 6.5h or 24h.
#
# What that ribbon spans, and why it is worth having:
#   4H    MA500 ~ 12 months (2 bars/session on an equity)
#   Daily MA500 ~ 24 months
#   Weekly MA500 ~ 9.6 years,  MA50 ~ 1 year
# So Weekly is a genuinely different scale, where 4H is a half-length Daily
# (measured 2026-09-01: D/4H trend labels agree on 71.7% of instruments and
# oppose on 8 of 717). Adding a SLOWER timeframe is the direction the evidence
# supports; adding a faster one is not.
#
# History: 82.1% of the 808 cached instruments carry >= 500 weekly bars
# (median 1052, ~20 years). The rest clip the ribbon through the same
# `p <= len(df)` rule the daily side already uses for short-history names.
WEEKLY_RESAMPLE_RULE = 'W-FRI'      # weeks END Friday; label is the week-ending date

# UNTUNED starting values — chosen by scaling Daily by sqrt(5) (a weekly bar
# holds 5 daily bars, so its moves are ~2.2x). Sweep these with backtest.py
# before treating either as measured.
REFIRE_PCT_WEEKLY    = 0.08
NEW_TREND_PCT_WEEKLY = 0.05

# ---------------------------------------------------------------------------
# 3-Day bar geometry  (added 2026-09-08)
# ---------------------------------------------------------------------------
# The 3-day timeframe runs the SAME MA50-MA500 ribbon on 3-day bars. It exists
# to fill the gap between Daily and Weekly:
#   Daily  MA500 ~ 2.0 years
#   3-Day  MA500 ~ 6.0 years      <- measured over the cache 2026-09-08
#   Weekly MA500 ~ 9.6 years
# Right now the app jumps from a 2-year view straight to a 9.6-year one with
# nothing in between.
#
# What it is NOT: an independent read. Measured over 183 instruments and 270,371
# bars, the 3D trend label agrees with Daily 66.5% of the time and opposes it on
# 0.9% (Weekly: 54.3% / 2.3%; 4H: 71.7%). So it is more distinct than 4H, which
# was demoted to confirmation for exactly this reason, and markedly less distinct
# than Weekly. Ship it for the 6-year middle view, not for disagreement. It is
# a calmer feed either way: 42 fires per instrument against Daily's 187.
#
# GROUPING — 3 BUSINESS DAYS FROM A FIXED EPOCH, not `resample('3D')` and not
# "every 3 rows". Both of those alternatives repaint:
#   * resample('3D') bins on CALENDAR days, so the 3-day window rotates through
#     the week and a bar holds 1, 2 or 3 sessions depending on where the weekend
#     falls.
#   * "every 3 rows from the start of the frame" re-phases every historical bar
#     the moment the cache start moves — and it does move (see the truncation
#     rule in data_fetcher). Every 3D bar in the app would silently change.
# Counting business days from a fixed epoch is independent of what history is
# loaded, so bar N is the same bar on every run and after any refetch.
THREE_DAY_EPOCH = '1970-01-05'   # a Monday; never change it (it re-phases every bar)
THREE_DAY_SIZE  = 3              # business days per bar

# UNTUNED starting values, interpolated between Daily (0.05 / 0.05) and Weekly
# (0.08 / 0.05). Sweep with backtest.py before treating either as measured.
REFIRE_PCT_3D    = 0.065
NEW_TREND_PCT_3D = 0.05

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
OUTPUT_DIR = os.path.join(BASE_DIR, 'output_ma500')

# Prefixes whose bars are NOT unique by date, and therefore carry an extra
# `{p}datetime` column naming the exact bar. A 4H date holds 2-6 bars, so the
# date alone cannot identify which one fired (see main.py _extract_row). Daily
# and Weekly are both unique by date — a weekly bar IS its week-ending date —
# so neither gets one. This used to be `if prefix`, which was the same thing
# while 4H was the only prefixed timeframe and stopped being true the moment
# Weekly arrived.
INTRADAY_PREFIXES = {'h4_'}

# The timeframe table — ONE definition, ordered fast to slow. Every consumer
# that loops over timeframes (column emission, tf_alignment, context modifiers,
# the ledger, the backtest) reads this rather than restating ('', 'h4_') in its
# own words; the pair was hand-copied in four places before Weekly, which is
# how a new timeframe reaches production wired into three of them.
#
# 1H is NOT in this table (removed 2026-09-11). Its signals never beat a random
# entry taken the same day in other instruments (-0.031R before Jul 2025,
# -0.006R since, n=13,309), it was the costliest timeframe to compute (~32% of
# signal time), and the hourly feed is only ~2 years deep, so it can never be
# tested across a full cycle. The 1H CHART is unaffected: webapp/chart_feed.py
# builds it from the hourly cache on its own, and _h1_frame/_h1_ma_periods stay
# in main.py for it and for backtest.py research runs.
TIMEFRAMES = (
    ('4H', 'h4_'),
    ('D',  ''),
    ('3D', 'd3_'),
    ('W',  'w_'),
)
TF_PREFIXES = tuple(p for _, p in TIMEFRAMES)
TF_CODE_BY_PREFIX = {p: c for c, p in TIMEFRAMES}

# Which timeframes VOTE in tf_alignment. Not the same question as "which
# timeframes exist", which is why this is its own tuple rather than TF_PREFIXES.
#
# 1H is deliberately excluded (2026-09-03). Two reasons, both measured:
#   1. It would double-count the intraday read. Daily and 4H already agree on
#      71.7% of instruments (2026-09-01), and 1H — resampled from the same
#      hourly bars 4H is built from — agrees with 4H by more than that. Letting
#      both vote makes "every timeframe agrees" mostly a statement about one
#      feed sampled twice.
#   2. It would silently widen the score from -3..+3 to -4..+4. Every consumer
#      that draws a bar from tf_alignment_score would then under-fill it, and
#      the failure is invisible — the bar just never reaches the end.
# Add 'h1_' here only alongside a rescale of every consumer.
#
# 3D is excluded for the SAME TWO REASONS, measured 2026-09-08:
#   1. It would double-count the daily read. 3D agrees with Daily on 66.5% of
#      bars and is built by aggregating the very same daily bars, so letting
#      both vote makes "every timeframe agrees" largely a statement about the
#      daily frame sampled twice.
#   2. It would widen the score from -3..+3 to -4..+4 with nothing to catch it,
#      which is precisely the trap documented for 1H above.
ALIGNMENT_PREFIXES = tuple(p for _, p in TIMEFRAMES if p not in ('h1_', 'd3_'))

# Helper: per-timeframe signal/indicator columns
def _tf_signal_columns(prefix, ma_periods=None):
    """Return signal-related column names for a timeframe prefix."""
    if ma_periods is None:
        ma_periods = MA_PERIODS
    p = prefix
    return [
        f'{p}date', *([f'{p}datetime'] if p in INTRADAY_PREFIXES else []),
        f'{p}open', f'{p}high', f'{p}low', f'{p}close', f'{p}volume',
        f'{p}volume_average', f'{p}volume_spike_flag', f'{p}pvo', f'{p}pvo_signal',
        *[f'{p}ma_{per}' for per in ma_periods],
        f'{p}trend_direction', f'{p}established_trend', f'{p}trend_run_days',
        f'{p}confirmation_status',
        f'{p}primary_signal',
        f'{p}signal_confidence',
        f'{p}last_signal_type', f'{p}last_signal_date', f'{p}last_signal_days_ago', f'{p}last_signal_price',
        f'{p}confidence_context',
        f'{p}watch_flag', f'{p}potential_turning_point_flag',
        f'{p}ribbon_spread', f'{p}ribbon_compression', f'{p}ribbon_slope_pct', f'{p}ma_order_score', f'{p}roc', f'{p}rsi',
        f'{p}rollover_score', f'{p}rollover_max', f'{p}rollover_dir', f'{p}rollover_stage',
        # MA stack — where the 50, 250 and 500 sit relative to each other.
        # DISPLAY ONLY: measured 2026-09-03 over 40,476 cross events, the
        # 50x250 cross has no edge as an entry (47-53% win, below buy-and-hold
        # on every timeframe) and none as an exit either (a control that simply
        # held longer with no cross matched it). These four fields feed a card
        # strip and a filter; nothing in signals.py reads them.
        f'{p}stack_state', f'{p}stack_pair', f'{p}stack_gap_pct', f'{p}stack_flip_bars',
        # ATR(14) as % of close (main._atr_pct) — the card's "worth the cost?" line.
        f'{p}atr_pct',
    ]

# ---------------------------------------------------------------------------
# Context confidence modifiers — edge-audit phase 3a (2026-07-15)
# ---------------------------------------------------------------------------
# Each rule nudges signal_confidence one tier (high > standard > low) when its
# condition holds at fire. Deltas stack; the result is clamped at the ends.
# Provenance = measured edge in R vs the signal's blind baseline + trade count n
# from the 120k-trade context backtest (edge_audit.py / EDGE_AUDIT_PHASE3.md).
# R1 (4H counter-to-daily-trend) was REJECTED in 3a: after the look-ahead fix its
# edge attenuated (B2 -0.061 robust, B3/B4 directional) below the ship bar.
CONTEXT_RULES = [
    # R2a  D B1 overbought entry — edge -0.099 R, n=1862, robust
    {'id': 'R2a', 'tf': 'D', 'signals': ('B1',), 'field': 'rsi',
     'op': 'ge', 'value': 70, 'delta': -1, 'reason': 'RSI 70+'},
    # R2b  D B1 ribbon not yet ordered — edge -0.134 R, n=718, robust
    {'id': 'R2b', 'tf': 'D', 'signals': ('B1',), 'field': 'ma_order_score',
     'op': 'le', 'value': 5, 'delta': -1, 'reason': 'ribbon disordered'},
    # R3a  D B2 chasing strength — edge -0.059 R, n=5826, robust
    {'id': 'R3a', 'tf': 'D', 'signals': ('B2',), 'field': 'roc',
     'op': 'ge', 'value': 3, 'delta': -1, 'reason': 'chasing (ROC 3%+)'},
    # R3b  D B2 buying into weakness — edge +0.082 R, n=829, robust
    {'id': 'R3b', 'tf': 'D', 'signals': ('B2',), 'field': 'roc',
     'op': 'le', 'value': -3, 'delta': 1, 'reason': 'buying weakness (ROC -3%+)'},
    # R4   D S3/S4 topping structure present — edge S3 +0.114 (n713), S4 +0.136 (n1240), robust
    {'id': 'R4', 'tf': 'D', 'signals': ('S3', 'S4'), 'field': 'rollover_stage',
     'op': 'eq', 'value': 2, 'delta': 1, 'reason': 'rollover stage 2'},
]

CONF_TIER_ORDER = ['low', 'standard', 'high']

# Column order for output
OUTPUT_COLUMNS = [
    'instrument_name', 'group', 'sector', 'industry', 'asset_class',
    # ── Multi-timeframe alignment ──
    'tf_alignment', 'tf_alignment_score',
    # ── Daily (full signals + indicators — unprefixed, same engine as 4H) ──
    *_tf_signal_columns(''),
    'pct_1d', 'pct_1w', 'pct_1m', 'pct_1y',
    'neutral_oscillation', 'ma_fast_cross_count', 'new_trend_flag',
    'key_level_price', 'key_level_type', 'key_level_date',
    'key_level_touch_count', 'key_level_touched_today', 'key_levels_all',
    # ── 4-Hour (signals + indicators) ──
    *_tf_signal_columns('h4_'),
    # ── 3-Day (signals + indicators) ──
    *_tf_signal_columns('d3_'),
    # ── Weekly (signals + indicators) ──
    *_tf_signal_columns('w_'),
]
