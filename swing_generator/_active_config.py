"""
_active_config.py — Profile resolver
======================================
Single source of truth for which config is active.
All other modules (indicators, signals, key_levels, etc.) import
from here instead of hardcoding "from config import ...".

Profile is determined by --profile in sys.argv so subprocess workers
that re-import this module automatically pick up the same settings.
"""
import sys

_profile = 'default'
if '--profile' in sys.argv:
    _idx = sys.argv.index('--profile')
    if _idx + 1 < len(sys.argv):
        _profile = sys.argv[_idx + 1].lower().strip()

if _profile == 'ma200':
    from config_ma200 import (
        MA_PERIODS, SMALL_MA_RANGE, MA_MIDPOINT,
        HISTORY_YEARS, CACHE_DIR, MIN_ROWS_REQUIRED,
        VOLUME_LOOKBACK,
        PIVOT_LOOKBACK, KEY_LEVEL_TOUCH_TOLERANCE, KEY_LEVEL_CLUSTER_RANGE,
        MA_TOUCH_TOLERANCE, TREND_DURATION_THRESHOLD,
        WATCH_APPROACH_PCT, MIDPOINT_BOUNCE_PCT,
        MAX_PENETRATION_4H, MAX_PENETRATION_DAILY,
        MAX_PENETRATION_WEEKLY, MAX_PENETRATION_MONTHLY,
        TOUCH_TOLERANCE_MONTHLY,
        SIGNAL_LOOKBACK_4H, SIGNAL_LOOKBACK_DAILY,
        SIGNAL_LOOKBACK_WEEKLY, SIGNAL_LOOKBACK_MONTHLY,
        P3P4_DEDUP_WINDOW, P2_DEDUP_WINDOW, TTP_COOLDOWN_BARS,
        RIBBON_COMPRESSION_THRESHOLD, ROC_PERIOD,
        SLOPE_LOOKBACK, NEUTRAL_SLOPE_THRESHOLD,
        CREDENTIALS_FILE, SPREADSHEET_NAME,
        OUTPUT_DIR, OUTPUT_COLUMNS,
        _tf_signal_columns,
    )
else:
    from config import (
        MA_PERIODS, SMALL_MA_RANGE, MA_MIDPOINT,
        HISTORY_YEARS, CACHE_DIR, MIN_ROWS_REQUIRED,
        VOLUME_LOOKBACK,
        PIVOT_LOOKBACK, KEY_LEVEL_TOUCH_TOLERANCE, KEY_LEVEL_CLUSTER_RANGE,
        MA_TOUCH_TOLERANCE, TREND_DURATION_THRESHOLD,
        WATCH_APPROACH_PCT, MIDPOINT_BOUNCE_PCT,
        MAX_PENETRATION_4H, MAX_PENETRATION_DAILY,
        MAX_PENETRATION_WEEKLY, MAX_PENETRATION_MONTHLY,
        TOUCH_TOLERANCE_MONTHLY,
        SIGNAL_LOOKBACK_4H, SIGNAL_LOOKBACK_DAILY,
        SIGNAL_LOOKBACK_WEEKLY, SIGNAL_LOOKBACK_MONTHLY,
        P3P4_DEDUP_WINDOW, P2_DEDUP_WINDOW, TTP_COOLDOWN_BARS,
        RIBBON_COMPRESSION_THRESHOLD, ROC_PERIOD,
        SLOPE_LOOKBACK, NEUTRAL_SLOPE_THRESHOLD,
        CREDENTIALS_FILE, SPREADSHEET_NAME,
        OUTPUT_DIR, OUTPUT_COLUMNS,
        _tf_signal_columns,
    )

ACTIVE_PROFILE = _profile
