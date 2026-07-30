"""
SwingPulse — MA500 Profile Configuration
=========================================
MA ribbon: 25, 50, 75 ... 500 (step 25, 20 MAs).

Data requirements:
    Daily   : 500 bars min → 45 yr history covers ~11,340 bars ✓
    4H      : 500 bars     → Yahoo provides ~729 days of hourly (~2,919 4H bars ✓)
    Note: instruments with less than 45 yr history get MA periods clipped automatically.
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)

# ---------------------------------------------------------------------------
# MA Ribbon  — 25, 50, 75 ... 500  (20 MAs)
# ---------------------------------------------------------------------------
MA_PERIODS  = list(range(25, 501, 25))
# [25, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400, 425, 450, 475, 500]

SMALL_MA_RANGE = [p for p in MA_PERIODS if p <= 250]   # BP2/SP2: fast MAs [25..250]
MA_MIDPOINT    = MA_PERIODS[len(MA_PERIODS) // 2]       # MA275 — midpoint of 20-MA ribbon

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
SIGNAL_LOOKBACK_4H    = 60
SIGNAL_LOOKBACK_DAILY = 20

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
# MA25. Anything in between is NEUTRAL — price is inside the ribbon, which is
# the honest read for a pullback or a chop zone.
TREND_UP_FRAC   = 0.75   # ≥15 of 20 MAs held → UPTREND
TREND_DOWN_FRAC = 0.25   # ≤5  of 20 MAs held → DOWNTREND

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
OUTPUT_DIR = os.path.join(BASE_DIR, 'output_ma500')

# Helper: per-timeframe signal/indicator columns
def _tf_signal_columns(prefix, ma_periods=None):
    """Return signal-related column names for a timeframe prefix.

    Intraday prefixes also carry `{p}datetime` — the exact bar timestamp. A 4H
    date holds 2-6 bars, so the date alone can't identify which bar fired
    (see main.py _extract_row). Daily needs no such column.
    """
    if ma_periods is None:
        ma_periods = MA_PERIODS
    p = prefix
    return [
        f'{p}date', *([f'{p}datetime'] if p else []),
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
    'neutral_oscillation', 'ma25_cross_count', 'new_trend_flag',
    'key_level_price', 'key_level_type', 'key_level_date',
    'key_level_touch_count', 'key_level_touched_today', 'key_levels_all',
    # ── 4-Hour (signals + indicators) ──
    *_tf_signal_columns('h4_'),
]
