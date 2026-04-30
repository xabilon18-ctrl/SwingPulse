import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)

# ---------------------------------------------------------------------------
# MA Ribbon
# ---------------------------------------------------------------------------
# range(10, 109, 7) produces 15 values: 10, 17, 24, 31, 38, 45, 52, 59, 66, 73, 80, 87, 94, 101, 108
MA_PERIODS = list(range(10, 109, 7))
# [10, 17, 24, 31, 38, 45, 52, 59, 66, 73, 80, 87, 94, 101, 108]

SMALL_MA_RANGE = [p for p in MA_PERIODS if p <= 60]   # P3 / P4: fast MAs [10, 17, 24, 31, 38, 45, 52, 59]
MA_MIDPOINT    = MA_PERIODS[len(MA_PERIODS) // 2]     # ma_66 — midpoint of 15-MA ribbon

# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
HISTORY_YEARS         = 16   # 16 years ≈ 192 monthly bars (covers ma_40–ma_190 monthly)
CACHE_DIR             = os.path.join(BASE_DIR, 'cache')
INSTRUMENTS_FILE      = os.path.join(ROOT_DIR, '220_Instruments.txt')
MIN_ROWS_REQUIRED     = 122   # need at least this many daily bars (longest MA is 108)

# ---------------------------------------------------------------------------
# Volume
# ---------------------------------------------------------------------------
VOLUME_LOOKBACK = 25   # midpoint of the 20–30 day range stated in spec

# ---------------------------------------------------------------------------
# Key Levels
# ---------------------------------------------------------------------------
PIVOT_LOOKBACK            = 5      # candles each side for pivot high/low detection
KEY_LEVEL_TOUCH_TOLERANCE = 0.002  # 0.2% price tolerance — level "touched"
KEY_LEVEL_CLUSTER_RANGE   = 0.005  # 0.5% — merge nearby pivots into one level

# ---------------------------------------------------------------------------
# Signal Detection
# ---------------------------------------------------------------------------
MA_TOUCH_TOLERANCE        = 0.001  # 0.1% — candle wick "touches" an MA line
TREND_DURATION_THRESHOLD  = 200    # trading days before "potential turning point"
WATCH_APPROACH_PCT        = 0.015  # 1.5% from nearest MA edge = "approaching"
MIDPOINT_BOUNCE_PCT       = 0.015  # 1.5% from ribbon midpoint = midpoint bounce

# Max wick penetration past MA before the touch is rejected (per timeframe)
MAX_PENETRATION_4H      = 0.020  # 2.0%
MAX_PENETRATION_DAILY   = 0.015  # 1.5%
MAX_PENETRATION_WEEKLY  = 0.025  # 2.5%
MAX_PENETRATION_MONTHLY = 0.030  # 3.0%

# Touch tolerance per timeframe (monthly needs wider band for wide wicks)
TOUCH_TOLERANCE_MONTHLY = 0.005  # 0.5% (vs 0.1% default)

# Signal lookback scaled per timeframe (how far back to find last signal)
SIGNAL_LOOKBACK_4H      = 60    # 60 4H bars ≈ 10 trading days
SIGNAL_LOOKBACK_DAILY   = 20    # 20 trading days
SIGNAL_LOOKBACK_WEEKLY  = 12    # 12 weeks ≈ 3 months
SIGNAL_LOOKBACK_MONTHLY = 6     # 6 months

# P3/P4 dedup: only suppress if last identical signal was within this many bars
P3P4_DEDUP_WINDOW = 3

# P2 dedup: suppress repeat 200 MA signals within this many bars (same direction)
P2_DEDUP_WINDOW = 5

# TTP cooldown: suppress repeated turning-point alerts for this many bars
TTP_COOLDOWN_BARS = 30

# ---------------------------------------------------------------------------
# Ribbon Analytics
# ---------------------------------------------------------------------------
RIBBON_COMPRESSION_THRESHOLD = 2.0  # |ribbon_spread| < 2% → compression (squeeze alert)
ROC_PERIOD = 5                      # Rate of change lookback (5 bars)
SLOPE_LOOKBACK          = 10        # bars used to measure median MA slope
NEUTRAL_SLOPE_THRESHOLD = 0.5       # if median MA slope > 0.5% over 10 bars → NOT sideways

# ---------------------------------------------------------------------------
# Google Sheets
# ---------------------------------------------------------------------------
CREDENTIALS_FILE  = os.path.join(BASE_DIR, 'credentials', 'service_account.json')
SPREADSHEET_NAME  = 'Swing Trading Signals'

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------
OUTPUT_DIR = os.path.join(BASE_DIR, 'output')

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
        f'{p}ribbon_spread', f'{p}ribbon_compression', f'{p}ribbon_slope_pct', f'{p}ma_order_score', f'{p}roc',
    ]

# Column order for the output sheet
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
    'ribbon_spread', 'ribbon_compression', 'ribbon_slope_pct', 'ma_order_score', 'roc',
    'pct_1d', 'pct_1w', 'pct_1m', 'pct_1y',
    'key_level_price', 'key_level_type', 'key_level_date',
    'key_level_touch_count', 'key_level_touched_today',
    'key_levels_all',
    # ── Multi-timeframe alignment (computed from all TFs) ──
    'tf_alignment', 'tf_alignment_score',
    # ── 4-Hour ──
    *_tf_signal_columns('h4_'),
    # ── Weekly ──
    *_tf_signal_columns('w_'),
    # ── Monthly ──
    *_tf_signal_columns('m_'),
]
