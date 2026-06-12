# SwingPulse — System Context

> Auto-generated from codebase — reflects actual current file state.
> Update this file whenever the architecture, profile, versions, or instruments count changes.

## What is SwingPulse?
A personal swing-trading signal dashboard that scans a watchlist of instruments (forex, indices, commodities, crypto, US/global equities) using a Gann-inspired MA-ribbon system. Results are served as a mobile-first web app.

**Single active profile: MA500** (25, 50, 75 … 500 — step 25, 20 MAs + macro MAs 1000/2000/3000)

| Item | Value |
|------|-------|
| Live URL | https://swingpulse200.pages.dev |
| R2 data prefix | `ma500/` |
| Instruments | **745** (parsed from `../Instruments.txt`) |
| MA ribbon | MA25–MA500 (step 25, 20 MAs) |
| Macro S/R MAs | MA1000, MA2000, MA3000 (daily only) |
| History years | 45 (covers monthly MA500 ≈ 41.7 yr) |

---

## Stack at a Glance

| Layer | Technology |
|-------|------------|
| Signal engine | Python (`main.py`) |
| Web server (local dev) | Flask (`webapp/server.py`, port 5050) |
| Frontend | Vanilla JS + Chart.js 4 + Lightweight Charts v4 (pinned) |
| Utility helpers | `static/js/utils.js` (loaded before app.js, exposes `window.SP_UTILS`) |
| Deploy | Cloudflare Pages (UI) + Cloudflare R2 (data files) |
| CI pipeline | GitHub Actions (`publish.yml`) — **cron disabled, manual trigger only** |
| Repo | https://github.com/xabilon18/SwingPulse |

---

## Key Files

```
swing_generator/
├── main.py                    # Signal generator (always runs --profile ma500)
├── config.py                  # MA500 profile: MA25–500, thresholds, OUTPUT_COLUMNS
├── _active_config.py          # Thin re-export shim from config.py; ACTIVE_PROFILE='ma500'
├── instruments.py             # Parses ../Instruments.txt → list of {num,ticker,name,group,sector,industry}
├── output_ma500/              # CSV output files (gitignored)
├── cache_ma500/               # Parquet price cache (gitignored)
├── webapp/
│   ├── server.py              # Local Flask dev server → http://localhost:5050
│   │                          # MA_PERIODS imported from _active_config (MA25–500)
│   ├── publish.py             # Build + deploy to R2/Pages (PROFILE='ma500', PAGES_PROJECT='swingpulse200')
│   ├── templates/index.html   # SPA shell (app.js?v=152, style.css?v=159, utils.js?v=1)
│   └── static/
│       ├── js/app.js          # All frontend logic (~5600 lines, v152)
│       ├── js/utils.js        # Shared helpers: formatPrice, debounce, etc. (v1)
│       └── css/style.css      # All styles (7424 lines, v153)
└── .github/workflows/
    └── publish.yml            # CI: python3 main.py --profile ma500 → R2 upload → push notify
```

---

## Config / Profile System

There is now **one profile** — `ma500`. The multi-profile system is gone.

- `config.py` — single source of truth for all constants
- `_active_config.py` — a thin shim that re-exports everything from `config.py`; `ACTIVE_PROFILE = 'ma500'`
- All Python modules do `from _active_config import ...` — never `from config import` directly

Key constants (from `config.py`):
```python
MA_PERIODS           = list(range(25, 501, 25))   # [25,50,...,500] — 20 MAs
MACRO_MA_PERIODS     = [1000, 2000, 3000]          # daily long-term S/R only
SMALL_MA_RANGE       = [p for p in MA_PERIODS if p <= 250]  # BP2/SP2 fast side
MA_MIDPOINT          = MA_PERIODS[10]              # MA275
HISTORY_YEARS        = 45
CACHE_DIR            = 'cache_ma500/'
OUTPUT_DIR           = 'output_ma500/'
RIBBON_COMPRESSION_THRESHOLD = 5.0                 # wider than MA200 (step 25 vs 10)
```

---

## Signal System

### Timeframes
`D` (Daily) · `4H` (4-Hour) · `W` (Weekly) · `M` (Monthly)

### Column Prefix Convention
| Timeframe | Prefix |
|-----------|--------|
| Daily     | *(none)* — e.g. `primary_signal` |
| 4-Hour    | `h4_`  — e.g. `h4_primary_signal` |
| Weekly    | `w_`   — e.g. `w_primary_signal` |
| Monthly   | `m_`   — e.g. `m_primary_signal` |

In `app.js` the `f(field)` helper applies the active prefix.  
**Exception:** cross-timeframe volume columns (`volume_spike_flag`, `h4_volume_spike_flag`, etc.) are absolute names — never pass them through `f()`.

### Signal Types (B = buy, S = sell — see signals.py)
- **B1/S1** — Trend reversal: price crosses above (B1) / below (S1) **all** MAs; re-fires near MA500 within `refire_pct`
- **B2–B6 / S2–S6** — Pullback bounce / rally rejection at the watch MA: 25→B2, 100→B3, 200→B4, 300→B5, 400→B6 (S mirror)
- **B7/S7** — Deep pullback bounce / rally rejection at the anchor MA500 — always high confidence

### Key Computed Fields (per timeframe, via `_tf_signal_columns`)
`primary_signal`, `secondary_signal`, `confirmation_status`, `signal_confidence` (high/standard/low),  
`trend_direction` (UPTREND/DOWNTREND/NEUTRAL), `established_trend`, `trend_run_days`,  
`tf_alignment`, `tf_alignment_score`, `ma_order_score`,  
`ribbon_compression`, `ribbon_spread`, `ribbon_slope_pct`,  
`volume_spike_flag`, `roc`, `rsi`,  
`last_signal_type`, `last_signal_date`, `last_signal_days_ago`,  
`watch_flag`, `potential_turning_point_flag`,  
`rollover_score`, `rollover_max`, `rollover_dir`, `rollover_stage`

### Daily-only Fields
`ma25_cross_count`, `neutral_oscillation`, `new_trend_flag`,  
`pct_1d`, `pct_1w`, `pct_1m`, `pct_1y`,  
`key_level_price`, `key_level_type`, `key_level_touch_count`, `key_level_touched_today`, `key_levels_all`,  
`macro_sr_signal`, `macro_sr_level`, `macro_sr_strength`

---

## Frontend App Tabs
1. **Dashboard** — Market gauge, stat cards, signal feed, alignment summary, macro S/R touches
2. **Scanner** — Instrument grid with filters: group, sector, trend, alignment, confidence, signal codes, key levels, vol spikes, macro S/R filter
3. **Watchlist** — Starred instruments + alert sub-tabs (turning points, watch flags, key levels, vol)
4. **Trends** — Trend history per instrument (timeline, stats, maturity)

> Note: **Portfolio** tab was in the old CLAUDE.md but is not present in the current `index.html` nav. XM positions are fetched via `/api/portfolio` but rendered within the Dashboard.
> A **Flow** section (`window._renderFlow`) renders inside the Dashboard pane via `initFlowTab()` — it is not a top-level nav tab.

---

## API Endpoints (served by `server.py` locally and as static JSON by `publish.py`)

| Endpoint | Returns |
|----------|---------|
| `/api/signals` | `{ date, data: [...] }` — full instrument data |
| `/api/summary` | Aggregate counts (buy/sell/watch/vol_spikes/macro_sr etc.) |
| `/api/trends` | `{ instrument_name: [{direction, start, end, days, pct_move}] }` |
| `/api/history/{name}` | `{ ticker, data: [{date, open, high, low, close, volume, ma_25...ma_500}] }` — 600 bars |
| `/api/tv-map` | `{ instrument_name: "EXCHANGE:SYMBOL" }` for TradingView links |
| `/api/ticker-map` | `{ display_name: ticker }` |
| `/api/ai-instruments` | List of AI-sector instrument names |
| `/api/explanations` | Signal explanation text map |
| `/api/portfolio` | XM broker positions (parsed from Gmail) |
| `/api/flow` | Capital flow data for a group/region/period |
| `/api/refresh` | POST — triggers a fresh data reload on the server |

---

## Cloudflare Config
- **R2 bucket public URL:** `https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev`
- **R2 data path:** `https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev/ma500/`
- **Pages URL:** `https://swingpulse200.pages.dev` (Cloudflare Pages project: `swingpulse200`)
- UI (index.html + static assets) deployed to Pages; data files uploaded to R2 `ma500/` prefix

---

## Current Versions
- `app.js` — **v152** (~5600 lines)
- `style.css` — **v158** (~7460 lines)
- `utils.js` — **v1**
- `index.html` — bump all three `?v=` query strings when deploying UI changes
- `Instruments.txt` — **745 instruments**

---

## Deploy Commands

```bash
# Run signal generation
cd swing_generator && python3 main.py --profile ma500

# Deploy data only (uploads to R2 ma500/ prefix, ~745+ files)
cd swing_generator && python3 webapp/publish.py --profile ma500

# Deploy UI only (to swingpulse200.pages.dev)
cd swing_generator && python3 webapp/publish.py --profile ma500 --ui-only

# Local dev server
cd swing_generator/webapp && python3 server.py
# → http://localhost:5050
```

---

## GitHub Actions Pipeline

| File | Profile | Cron | Cache |
|------|---------|------|-------|
| `publish.yml` | ma500 | **disabled** (cron commented out) — manual only | `cache_ma500/` |

- Runs `python3 main.py --profile ma500` → uploads data to R2 → sends push notification with `X-Profile: ma500`
- No UI deploy in CI — deploy UI manually with `--ui-only`

---

## Important Rules When Editing

1. **Never pass cross-TF volume column names through `f()`** — use `item.volume_spike_flag` not `item[f('volume_spike_flag')]`
2. **Lightweight Charts is pinned to v4** (`@4` in CDN URL) — do not upgrade; v5 has breaking API changes
3. **Chart.js stays in `<head>`** — `rebuildCharts()` is called synchronously in `loadAll()` and needs `Chart` available immediately
4. **Modal chart panels start hidden (`display:none`)** — always `await new Promise(r => requestAnimationFrame(r))` before creating a Lightweight Chart inside a modal tab
5. **`autoSize: true`** must be set on Lightweight Charts created inside hidden panels
6. **`formatPrice(val)`** lives in `utils.js` (SP_UTILS) — ≥$1000 → 2dp+commas | $10–$999 → 2dp | $1–$9.99 → 4dp | <$1 → 6dp
7. **Search uses `matchesSearch(item, query)`** — checks instrument_name, display name, group, sector, industry — use this, not inline `.includes()`
8. **Profile imports:** all Python modules use `from _active_config import ...` — never `from config import` directly
9. **`<body data-profile="__APP_PROFILE__">`** is patched to `ma500` by `build_ui()` in publish.py — use CSS `body[data-profile="ma500"] #id { display:none }` to hide profile-irrelevant cards

---

## Common Tasks

**Add a new instrument:** Edit `../Instruments.txt` (pipe-delimited format), re-run `main.py --profile ma500`

**Add a new signal column:** Add to `config.py` OUTPUT_COLUMNS + `_tf_signal_columns()`, compute in `main.py` `process_instrument()`, handle in `app.js`

**Change signal thresholds:** Edit constants in `config.py`

**Debug blank chart in modal:** Ensure `autoSize: true` is set AND `await new Promise(r => requestAnimationFrame(r))` runs before `createChart()`

**Data not updating:** Run workflow manually from GitHub Actions tab; stale banner appears on the site if data date ≠ today

**Update version numbers:** After any UI change, bump `?v=NNN` on `app.js`, `style.css`, and/or `utils.js` in `index.html`
