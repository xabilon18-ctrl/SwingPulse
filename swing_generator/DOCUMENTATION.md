# SwingPulse Signal Generator — Technical Documentation

## Overview

The SwingPulse Signal Generator is an automated trading signal engine that processes 220 financial instruments across commodities, crypto, indices, stocks, and forex. It applies a Moving Average (MA) ribbon strategy across four timeframes — **4-Hour, Daily, Weekly, and Monthly** — to detect trend direction and generate actionable buy/sell signals with confidence scoring and multi-timeframe alignment.

**Live Dashboard:** https://swingpulse.pages.dev
**Google Sheet:** "Swing Trading Signals" (auto-updated on each run)

---

## Architecture

```
220_Instruments.txt
        |
   instruments.py        Parse instrument list
        |
   data_fetcher.py       Fetch daily (13yr) + hourly (2yr) from Yahoo Finance
        |
   main.py               Orchestrate per-instrument processing
   |   |   |   |
   |   |   |   +-- _resample_4h()    Hourly -> 4H bars
   |   |   +------ _resample('W')    Daily -> Weekly bars
   |   +---------- _resample('ME')   Daily -> Monthly bars
   +-------------- (Daily bars used directly)
        |
   For each timeframe:
   |-- indicators.py     MA ribbon + volume + trend + ribbon analytics + ROC
   |-- signals.py        P1/P2/P3/P4/secondary/watch + confidence scoring
   +-- key_levels.py     Pivot-based support/resistance (daily only)
        |
   Multi-TF alignment    Score how many timeframes agree on direction
        |
   sheets_writer.py      Output -> CSV + Excel + Google Sheets
   trends JSON            Trend segment history -> JSON
        |
   webapp/publish.py     Build static site -> Deploy to Cloudflare Pages
```

---

## Module Reference

### config.py

Central configuration. All thresholds, file paths, and column definitions.

| Constant | Value | Purpose |
|----------|-------|---------|
| `MA_PERIODS` | `[38, 45, 52, ..., 143, 150]` | 17 SMAs forming the ribbon |
| `SMALL_MA_RANGE` | `[38, 45, 52, 59, 66, 73, 80]` | MAs used for P3/P4 signals |
| `HISTORY_YEARS` | `13` | Years of daily data from Yahoo Finance |
| `MIN_ROWS_REQUIRED` | `200` | Minimum daily bars to process an instrument |
| `MA_TOUCH_TOLERANCE` | `0.001` (0.1%) | How close a wick must be to an MA to count as "touch" |
| `TREND_DURATION_THRESHOLD` | `200` days | Trend length before "potential turning point" alert |
| `WATCH_APPROACH_PCT` | `0.015` (1.5%) | Distance from 150 MA to trigger "watch" |
| `VOLUME_LOOKBACK` | `25` days | Rolling window for average volume calculation |

**Max penetration per timeframe** (rejects wick > this % past MA):

| Timeframe | Constant | Value |
|-----------|----------|-------|
| 4H | `MAX_PENETRATION_4H` | `0.020` (2.0%) |
| Daily | `MAX_PENETRATION_DAILY` | `0.015` (1.5%) |
| Weekly | `MAX_PENETRATION_WEEKLY` | `0.025` (2.5%) |
| Monthly | `MAX_PENETRATION_MONTHLY` | `0.030` (3.0%) |

**Signal lookback per timeframe** (how far back to find last signal):

| Timeframe | Constant | Value |
|-----------|----------|-------|
| 4H | `SIGNAL_LOOKBACK_4H` | `60` bars |
| Daily | `SIGNAL_LOOKBACK_DAILY` | `20` bars |
| Weekly | `SIGNAL_LOOKBACK_WEEKLY` | `12` bars |
| Monthly | `SIGNAL_LOOKBACK_MONTHLY` | `6` bars |

**Signal tuning:**

| Constant | Value | Purpose |
|----------|-------|---------|
| `P3P4_DEDUP_WINDOW` | `3` | Only suppress P3/P4 if same signal within last 3 bars |
| `TTP_COOLDOWN_BARS` | `30` | Suppress repeated turning-point alerts for 30 bars |
| `RIBBON_COMPRESSION_THRESHOLD` | `2.0` (%) | Ribbon spread < 2% triggers squeeze alert |
| `ROC_PERIOD` | `5` | Rate of change lookback (5 bars) |

### data_fetcher.py

Yahoo Finance data retrieval with disk-based parquet caching.

**Daily data** (`fetch()` / `fetch_all()`):
- Downloads 13 years of daily OHLCV via `yfinance`
- Cached as `cache/{TICKER}.parquet`
- Cache is fresh if < 20 hours old; stale cache used on network failure

**Hourly data** (`fetch_hourly()` / `fetch_all_hourly()`):
- Downloads up to 729 days of 1-hour OHLCV (Yahoo Finance maximum)
- Cached as `cache/{TICKER}_1h.parquet`
- Used to construct 4-hour bars via resampling

**Cache path encoding:** `=` -> `_EQ_`, `^` -> `_IDX_`, `.` -> `_DOT_`

### instruments.py

Parses `220_Instruments.txt` — a pipe-delimited file with columns:

```
# | Yahoo Ticker | Display Name | Group | Sector | Industry
```

Groups include: Commodity, Crypto, US Index, EU Index, Asia Index, US Stock, DAX Stock, Forex.

### indicators.py

Five stages applied to any OHLCV DataFrame:

1. **`add_ma_ribbon(df)`** — Adds `ma_38`, `ma_45`, ..., `ma_150` columns (17 simple moving averages).

2. **`add_volume_analysis(df)`** — Adds `volume_average` (25-day rolling mean) and `volume_spike_flag` (True if today's volume > average).

3. **`add_trend(df)`** — Classifies each row:
   - **UPTREND**: Close > all available MAs
   - **DOWNTREND**: Close < all available MAs
   - **NEUTRAL**: Close is between any two MAs, or insufficient data

4. **`add_ribbon_analytics(df)`** — Adds:
   - `ribbon_spread`: % width of ribbon — `(ma_38 - ma_150) / ma_150 * 100`. Positive = bullish fan, negative = bearish fan.
   - `ribbon_compression`: True when `|ribbon_spread| < 2%`. Indicates MAs converging — big move imminent (squeeze alert).
   - `ma_order_score`: Count of adjacent MA pairs in correct ascending order (0-16). 16/16 = perfect uptrend, 0/16 = perfect downtrend, 8/16 = tangled/chop.

5. **`add_roc(df)`** — Adds `roc`: Rate of change over 5 bars. `(close - close_5_ago) / close_5_ago * 100`. Measures momentum — sharp pullback vs slow drift.

### signals.py

The core signal engine. Processes the full instrument history row-by-row.

**Signal Priority (highest to lowest):**

| Signal | Name | Condition |
|--------|------|-----------|
| **P1** | Trend Reversal | trend_direction flips from UPTREND to DOWNTREND (or vice versa) |
| **P2** | 150 MA Bounce/Rejection | Candle wick touches the longest MA; close confirms the bounce |
| **P3** | Small MA Bounce (uptrend) | Candle wick touches a small MA (38-80); close confirms above it |
| **P4** | Small MA Rejection (downtrend) | Candle wick touches a small MA (38-80); close confirms below it |
| **Secondary** | Any MA Bounce/Rejection | Touch on any ribbon MA (not small, not 150) with close confirmation |
| **Watch** | Approaching 150 MA | Price approaching the 150 MA specifically (not any ribbon MA) |

**Touch Detection:**
- `_touched_up(low, ma_dict)`: Low <= MA x (1 + tolerance) — wick reached MA from above
- `_touched_down(high, ma_dict)`: High >= MA x (1 - tolerance) — wick reached MA from below
- `max_penetration` parameter: Rejects touches where the wick exceeds this % past the MA. Applied per timeframe (1.5% daily, 2% 4H, 2.5% weekly, 3% monthly).

**P3/P4 De-duplication:** Only suppresses if the same signal (P3 or P4) fired within the last 3 bars. Beyond 3 bars, a new touch is a fresh event (legitimate retest). Higher-priority signals (P1/P2) reset the dedup window.

**TTP Cooldown:** After a Potential Turning Point alert fires, it is suppressed for the next 30 bars to avoid constant noise during consolidation.

**Watch Flag:** Only triggers when price approaches **ma_150** (the key structural MA), not any MA in the ribbon. This eliminates the constant noise from short MAs in trending markets.

**NEUTRAL Zone:** Only P2 signals are allowed in NEUTRAL (inside the ribbon). Secondary signals are suppressed in chop zones to avoid false confidence.

**Signal Confidence Scoring:**

| Level | Conditions | Meaning |
|-------|------------|---------|
| **high** | P1/P2 with volume spike OR at key level | Strong institutional participation / confluence |
| **high** | P3/P4 with volume spike AND at key level | Double confluence |
| **standard** | Normal signal (default for P1/P2) | Standard conviction |
| **low** | P3/P4 on below-average volume | Weak bounce, likely to fail |

Key level confluence: if close is within 0.5% of a support/resistance level with 3+ historical touches, the signal gets a confidence boost.

**Yesterday confirmation:** If yesterday's candle touched an MA but today's close confirms the direction, the signal fires today.

**Established trend:** Tracks the last confirmed UP/DOWNTREND through NEUTRAL zones.

**Configurable parameters for `add_signals()`:**

| Parameter | Default | Monthly Override | Purpose |
|-----------|---------|-----------------|---------|
| `ma_periods` | `MA_PERIODS` | same | Which MAs to use |
| `small_ma_range` | `SMALL_MA_RANGE` | same | Which MAs count as "small" for P3/P4 |
| `touch_tolerance` | `0.001` | `0.005` | How close wick must be to MA |
| `max_penetration` | per TF config | `0.03` | Max wick depth past MA |
| `key_levels_df` | `None` | N/A | Key levels for confluence scoring (daily only) |

### key_levels.py

Detects historical support/resistance levels using pivot highs and lows.

**Algorithm:**
1. Find pivot highs/lows using a centered window (5 candles each side)
2. Cluster pivots within 0.5% of each other (keeps highest touch count)
3. Filter: only levels with >= 2 touches are kept
4. For today's output: find the most relevant level (touched today, or nearest to close)

**Output fields:** `key_level_price`, `key_level_type` (top/bottom), `key_level_date`, `key_level_touch_count`, `key_level_touched_today`, `key_levels_all`

**Key level confluence:** Levels with 3+ touches are passed to `add_signals()` for confidence scoring. When a signal fires at a price within 0.5% of such a level, confidence is boosted.

### main.py

The orchestrator. Handles CLI arguments, coordinates data fetching, instrument processing, and output.

**`process_instrument(ticker, df, inst_meta, run_date, hourly_df=None)`**

For each instrument, runs the pipeline across all timeframes:

| Timeframe | Source | Min Bars | Max Penetration | Touch Tolerance | Signal Lookback |
|-----------|--------|----------|-----------------|-----------------|-----------------|
| **4H** | Hourly resampled to 4H | 150 | 2.0% | 0.1% | 60 bars |
| **Daily** | Raw daily OHLCV | 200 | 1.5% | 0.1% | 20 bars |
| **Weekly** | Daily resampled to weekly | 38 | 2.5% | 0.1% | 12 bars |
| **Monthly** | Daily resampled to month-end | 150 | 3.0% | 0.5% | 6 bars |

**Multi-timeframe alignment** (`_compute_tf_alignment`): After all timeframes are processed, scores how many agree on direction:

| Label | Condition | Score Range |
|-------|-----------|-------------|
| Triple Bull | 4 TFs uptrend | +4 |
| Aligned Bull | 3 TFs uptrend | +3 |
| Leaning Bull | 2 TFs uptrend, 0 downtrend | +2 |
| Mixed | No clear direction | 0 |
| Counter-trend | Some up, some down | varies |
| Leaning Bear | 2 TFs downtrend, 0 uptrend | -2 |
| Aligned Bear | 3 TFs downtrend | -3 |
| Triple Bear | 4 TFs downtrend | -4 |

Uses `established_trend` (which persists through NEUTRAL) for each timeframe.

**Trend segments** (`_extract_trend_segments`): Groups consecutive same-direction periods into segments. NEUTRAL bars are absorbed into the prior trend. Segments shorter than 30 days are consolidated into neighbors. Each segment includes `pct_move` (% price change).

**CLI:**
```bash
python main.py                    # Normal run (uses cache if fresh)
python main.py --refresh          # Force re-download all data
python main.py --date 2026-03-28  # Process a specific date
```

**Cron:** `0 21 * * 1-5` (21:00 UTC / 23:00 SAST, weekdays)

### sheets_writer.py

Outputs to three formats:

1. **CSV** — `output/signals_YYYY-MM-DD.csv`
2. **Excel** — `output/signals_YYYY-MM-DD.xlsx` (styled with header freeze, conditional formatting)
3. **Google Sheets** — Tab named `YYYY-MM-DD` in the "Swing Trading Signals" spreadsheet

Requires `credentials/service_account.json` for Google Sheets access. Falls back gracefully if credentials are missing.

---

## Data Flow per Timeframe

### 4-Hour
```
Yahoo Finance (1h interval, 729 days)
  -> cache/{TICKER}_1h.parquet
  -> _resample_4h() [1H -> 4H bars]
  -> add_all_indicators() [MA ribbon + volume + trend + ribbon analytics + ROC]
  -> add_signals(max_penetration=0.02)
  -> _extract_row(prefix='h4_', signal_lookback=60)
```

### Daily
```
Yahoo Finance (1d interval, 13 years)
  -> cache/{TICKER}.parquet
  -> add_all_indicators()
  -> find_key_levels() -> key_levels_df
  -> add_signals(max_penetration=0.015, key_levels_df=key_levels_df)
  -> _extract_row(prefix='', signal_lookback=20)
```

### Weekly
```
Daily OHLCV -> _resample('W') [weekly bars]
  -> add_all_indicators()
  -> add_signals(max_penetration=0.025)
  -> _extract_row(prefix='w_', signal_lookback=12)
```

### Monthly
```
Daily OHLCV -> _resample('ME') [month-end bars]
  -> add_all_indicators()
  -> add_signals(touch_tolerance=0.005, max_penetration=0.03)
  -> _extract_row(prefix='m_', signal_lookback=6)
```

### Post-processing
```
All TF data assembled into single row
  -> _compute_tf_alignment() -> tf_alignment, tf_alignment_score
  -> Output row written
```

---

## Output Schema

Each row in the output represents one instrument. Columns are organized by timeframe:

**Core:** `instrument_name`, `group`, `sector`, `industry`

**Per-timeframe (prefixed h4_, w_, m_ — no prefix for daily):**
- Price: `date`, `open`, `high`, `low`, `close`, `volume`
- Volume: `volume_average`, `volume_spike_flag`
- MAs: `ma_10`, `ma_17`, `ma_24`, ..., `ma_108` (15 columns)
- Trend: `trend_direction`, `established_trend`, `trend_run_days`
- Signals: `confirmation_status`, `primary_signal`, `signal_confidence`
- Last signal: `last_signal_type`, `last_signal_date`, `last_signal_days_ago`
- Alerts: `watch_flag`, `potential_turning_point_flag`
- Ribbon analytics: `ribbon_spread`, `ribbon_compression`, `ma_order_score`, `roc`

**Daily-only:** `key_level_price`, `key_level_type`, `key_level_date`, `key_level_touch_count`, `key_level_touched_today`, `key_levels_all`

**Cross-timeframe:** `tf_alignment`, `tf_alignment_score`

---

## Trend Segments (trends JSON)

Saved as `output/trends_YYYY-MM-DD.json`. Structure:

```json
{
  "GOLD": [
    {"direction": "UPTREND", "start": "2023-10-18", "end": "2026-04-07", "days": 903, "pct_move": 147.6},
    {"direction": "DOWNTREND", "start": "2023-08-03", "end": "2023-10-17", "days": 76, "pct_move": -0.5}
  ]
}
```

Segments are ordered most-recent-first. Trends shorter than 30 days are absorbed into neighbors.

---

## Deployment

### Cloudflare Pages (Production)

`webapp/publish.py` builds a static site and deploys to Cloudflare Pages:

1. Copies HTML template, CSS, JS, icons to `publish/`
2. Generates JSON data files from latest CSV + trends
3. Rewrites API URLs in app.js to static paths (`'/api/signals'` -> `'data/signals.json'`)
4. Deploys via `npx wrangler pages deploy`

**Live URL:** https://swingpulse.pages.dev

### Flask Dev Server (Local)

`webapp/server.py` runs a Flask server on port 5050:

```bash
python3 swing_generator/webapp/server.py
```

Serves the same dashboard with live API endpoints instead of static JSON.

---

## Dependencies

```
yfinance>=0.2.40     # Yahoo Finance data
pandas>=2.0.0        # DataFrames
numpy>=1.24.0        # Numerics
pyarrow>=12.0.0      # Parquet I/O
gspread>=6.0.0       # Google Sheets API
google-auth>=2.0.0   # Google auth
flask>=3.0           # Web framework (dev server)
openpyxl             # Excel output
```

---

## Adding a New Instrument

1. Add a line to `220_Instruments.txt`:
   ```
   221 | TICKER | DISPLAY_NAME | Group | Sector | Industry
   ```
2. Run `python main.py --refresh`
3. The instrument appears in all outputs and the dashboard automatically.

## Adding a New Timeframe

1. Add a data source function in `data_fetcher.py`
2. Add `MAX_PENETRATION_*` and `SIGNAL_LOOKBACK_*` constants in `config.py`
3. Resample in `main.py` and call `add_all_indicators()` + `add_signals()`
4. Extract with `_extract_row(prefix='xx_', signal_lookback=N)`
5. Add columns to `OUTPUT_COLUMNS` in `config.py` using `_tf_signal_columns('xx_')`
6. Add the prefix mapping in `app.js` `f()` function
7. Add the toggle button in `index.html`
8. Add the TradingView interval in `tvUrl()` and `tvWidgetUrl()`
