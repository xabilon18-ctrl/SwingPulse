"""
SwingPulse — MA200 Profile Configuration
=========================================
Second app profile: MAs 20, 30, 40 ... 200 (step 10).

Key mapping vs original profile:
    Original              →  MA200 Profile
    ─────────────────────────────────────────
    Fast ribbon MA10–66   →  MA20–120  (6 MAs)
    Ribbon MA10–108 (15)  →  MA20–200  (19 MAs)
    Anchor MA108          →  MA200
    SMALL_MA_RANGE ≤66    →  ≤120

Data requirements:
    Daily   : 200 bars min → 16 yr history covers ~4000 bars ✓
    Weekly  : 200 bars     → 200 weeks ≈ 3.9 yr (16 yr history gives ~830 weekly bars ✓)
    Monthly : 200 bars     → 200 months ≈ 16.7 yr → HISTORY_YEARS bumped to 18 yr
    4H      : 200 bars     → Yahoo provides 729 days of hourly (~2919 4H bars ✓)
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)

# ---------------------------------------------------------------------------
# MA Ribbon  — 20, 30, 40 ... 200  (19 MAs)
# ---------------------------------------------------------------------------
MA_PERIODS  = list(range(20, 201, 10))
# [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200]

SMALL_MA_RANGE = [p for p in MA_PERIODS if p <= 120]   # BP2/SP2: fast MAs [20..120]
MA_MIDPOINT    = MA_PERIODS[len(MA_PERIODS) // 2]       # MA110 — midpoint of 19-MA ribbon

# ---------------------------------------------------------------------------
# Data — need 18 yr to get 200+ monthly bars (200 mo ≈ 16.7 yr)
# ---------------------------------------------------------------------------
HISTORY_YEARS     = 18   # 18 yr ≈ 216 monthly bars (covers MA200 on monthly ✓)
CACHE_DIR         = os.path.join(BASE_DIR, 'cache_ma200')
INSTRUMENTS_FILE  = os.path.join(ROOT_DIR, 'Instruments.txt')
MIN_ROWS_REQUIRED = 220   # need at least 220 daily bars (longest MA is 200)

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
MAX_PENETRATION_4H      = 0.025  # 2.5%  (was 2.0%)
MAX_PENETRATION_DAILY   = 0.020  # 2.0%  (was 1.5%)
MAX_PENETRATION_WEEKLY  = 0.030  # 3.0%  (was 2.5%)
MAX_PENETRATION_MONTHLY = 0.035  # 3.5%  (was 3.0%)

TOUCH_TOLERANCE_MONTHLY = 0.007  # 0.7%  (was 0.5%)

# Signal lookback — same cadence as original
SIGNAL_LOOKBACK_4H      = 60
SIGNAL_LOOKBACK_DAILY   = 20
SIGNAL_LOOKBACK_WEEKLY  = 12
SIGNAL_LOOKBACK_MONTHLY = 6

# Dedup windows
P3P4_DEDUP_WINDOW = 3
P2_DEDUP_WINDOW   = 5

# TTP cooldown
TTP_COOLDOWN_BARS = 30

# ---------------------------------------------------------------------------
# Ribbon Analytics
# ---------------------------------------------------------------------------
# Wider MAs → wider natural spread → raise compression threshold proportionally
# Original threshold was 2.0 % for MAs spaced ~7 apart.
# New MAs spaced 10 apart → scale by (10/7) ≈ 1.43 → ~2.9 → round to 3.0 %
RIBBON_COMPRESSION_THRESHOLD = 3.0
ROC_PERIOD              = 5
SLOPE_LOOKBACK          = 10
NEUTRAL_SLOPE_THRESHOLD = 0.5

# ---------------------------------------------------------------------------
# Google Sheets (not used for second app but kept for compat)
# ---------------------------------------------------------------------------
CREDENTIALS_FILE  = os.path.join(BASE_DIR, 'credentials', 'service_account.json')
SPREADSHEET_NAME  = 'Swing Trading Signals MA200'

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
OUTPUT_DIR = os.path.join(BASE_DIR, 'output_ma200')

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
        f'{p}primary_signal', f'{p}secondary_signal',
        f'{p}signal_confidence',
        f'{p}last_signal_type', f'{p}last_signal_date', f'{p}last_signal_days_ago',
        f'{p}watch_flag', f'{p}potential_turning_point_flag',
        f'{p}ribbon_spread', f'{p}ribbon_compression', f'{p}ribbon_slope_pct', f'{p}ma_order_score', f'{p}roc', f'{p}rsi',
    ]

# Column order for output
OUTPUT_COLUMNS = [
    'instrument_name', 'group', 'sector', 'industry',
    # ── Daily ──
    'date', 'open', 'high', 'low', 'close', 'volume',
    'volume_average', 'volume_spike_flag',
    *[f'ma_{p}' for p in MA_PERIODS],
    'trend_direction', 'established_trend', 'trend_run_days', 'confirmation_status',
    'primary_signal', 'secondary_signal',
    'signal_confidence',
    'last_signal_type', 'last_signal_date', 'last_signal_days_ago',
    'watch_flag', 'potential_turning_point_flag',
    'ribbon_spread', 'ribbon_compression', 'ribbon_slope_pct', 'ma_order_score', 'roc', 'rsi',
    'pct_1d', 'pct_1w', 'pct_1m', 'pct_1y',
    'key_level_price', 'key_level_type', 'key_level_date',
    'key_level_touch_count', 'key_level_touched_today',
    'key_levels_all',
    # ── Multi-timeframe alignment ──
    'tf_alignment', 'tf_alignment_score',
    # ── 4-Hour ──
    *_tf_signal_columns('h4_'),
    # ── Weekly ──
    *_tf_signal_columns('w_'),
    # ── Monthly ──
    *_tf_signal_columns('m_'),
]
