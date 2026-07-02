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
HISTORY_YEARS     = 45   # 45 yr → ample history for daily MA500
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
# Output
# ---------------------------------------------------------------------------
OUTPUT_DIR = os.path.join(BASE_DIR, 'output_ma500')

# Helper: per-timeframe signal/indicator columns
def _tf_signal_columns(prefix, ma_periods=None):
    """Return signal-related column names for a timeframe prefix."""
    if ma_periods is None:
        ma_periods = MA_PERIODS
    p = prefix
    return [
        f'{p}date', f'{p}open', f'{p}high', f'{p}low', f'{p}close', f'{p}volume',
        f'{p}volume_average', f'{p}volume_spike_flag',
        *[f'{p}ma_{per}' for per in ma_periods],
        f'{p}trend_direction', f'{p}established_trend', f'{p}trend_run_days',
        f'{p}confirmation_status',
        f'{p}primary_signal',
        f'{p}signal_confidence',
        f'{p}last_signal_type', f'{p}last_signal_date', f'{p}last_signal_days_ago',
        f'{p}watch_flag', f'{p}potential_turning_point_flag',
        f'{p}ribbon_spread', f'{p}ribbon_compression', f'{p}ribbon_slope_pct', f'{p}ma_order_score', f'{p}roc', f'{p}rsi',
        f'{p}rollover_score', f'{p}rollover_max', f'{p}rollover_dir', f'{p}rollover_stage',
    ]

# Column order for output
OUTPUT_COLUMNS = [
    'instrument_name', 'group', 'sector', 'industry',
    # ── Multi-timeframe alignment ──
    'tf_alignment', 'tf_alignment_score',
    # ── Daily (full signals + indicators — unprefixed, same engine as 4H) ──
    *_tf_signal_columns(''),
    'pct_1d', 'pct_1w', 'pct_1m', 'pct_1y',
    'neutral_oscillation', 'ma25_cross_count', 'new_trend_flag',
    # ── 4-Hour (signals + indicators) ──
    *_tf_signal_columns('h4_'),
]
