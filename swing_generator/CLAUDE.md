# SwingPulse — Project Context for Claude

## What is SwingPulse?
A personal swing-trading dashboard hosted at **https://swingpulse.pages.dev**.  
It scans a fixed watchlist of instruments (forex, indices, commodities, crypto), runs a
Gann-inspired MA-ribbon signal system, and presents the results as a mobile-first web app.

---

## Stack at a Glance

| Layer | Technology |
|-------|------------|
| Signal engine | Python (`main.py`) |
| Web server (local dev) | Flask (`webapp/server.py`, port 5050) |
| Frontend | Vanilla JS + Chart.js 4 + Lightweight Charts v4 (pinned) |
| Deploy | Cloudflare Pages (UI) + Cloudflare R2 (data files) |
| CI pipeline | GitHub Actions — runs `main.py` then `publish.py` at **05:30 SAST (03:30 UTC)** weekdays |
| Repo | https://github.com/xabilon18/SwingPulse |

---

## Key Files

```
swing_generator/
├── main.py                    # Signal generator — runs daily, writes output/
├── config.py                  # MA periods, signal thresholds, output column list
├── instruments.py             # Master watchlist (name, ticker, group, sector)
├── output/                    # CSV files produced by main.py (gitignored)
├── cache/                     # Parquet price cache (gitignored)
├── webapp/
│   ├── server.py              # Local Flask dev server (http://localhost:5050)
│   ├── publish.py             # Build + deploy to R2 / Cloudflare Pages
│   ├── templates/index.html   # Single-page app shell (CSS v44, JS v42)
│   └── static/
│       ├── js/app.js          # All frontend logic (~3100 lines, v45)
│       └── css/style.css      # All styles (v44)
└── .github/workflows/         # GitHub Actions CI
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

In `app.js` the `f(field)` helper applies the active prefix automatically.  
**Exception:** cross-timeframe volume columns (`volume_spike_flag`, `h4_volume_spike_flag`,
`w_volume_spike_flag`, `m_volume_spike_flag`) are absolute names — never pass them through `f()`.

### Signal Types
- **BP1/SP1** — Trend reversal (full ribbon cross + close past MA108) — highest priority
- **BP2/SP2** — Pullback bounce / rejection off fast MAs (10–66)
- **BP3/SP3** — Bounce / rejection off longest MA (MA108)
- **BP4/SP4** — Bounce / rejection at confirmed key level

### Key Computed Fields (per timeframe)
`primary_signal`, `confirmation_status`, `signal_confidence` (high/standard/low),
`trend_direction` (UPTREND/DOWNTREND/NEUTRAL), `established_trend`, `trend_run_days`,
`tf_alignment` (Triple Bull → Triple Bear), `ma_order_score` (0–13),
`ribbon_compression` (yes/no), `ribbon_spread`, `volume_spike_flag` (yes/no),
`roc` (5-day rate of change), `last_signal_date`, `last_signal_type`, `key_levels_all`

---

## Frontend App Tabs
1. **Dashboard** — Market gauge, stat cards, heatmap, signal feed, alignment summary
2. **Scanner** — Unified instrument grid (merged Signals + Scanner) with all filters: group, sector, trend, alignment, confidence, signal codes (BP1–SP4), key levels, vol spikes
3. **Watchlist** — Starred instruments + alert sub-tabs (turning points, watch flags, key levels, vol)
4. **Trends** — Trend history per instrument (timeline, stats, maturity)

---

## API Endpoints (served by both server.py and publish.py build)

| Endpoint | Returns |
|----------|---------|
| `/api/signals` | `{ date, data: [...] }` — full instrument data for active day |
| `/api/summary` | Aggregate counts (buy/sell/watch/volume_spikes etc.) |
| `/api/trends` | `{ instrument_name: [{direction, start, end, days, pct_move}] }` |
| `/api/events` | `{ events: [{instrument_name, event_types, date, ...}] }` |
| `/api/names` | `{ ticker: "Full Display Name" }` |
| `/api/tv-map` | `{ instrument_name: "EXCHANGE:SYMBOL" }` for TradingView links |
| `/api/history/{name}` | `{ ticker, data: [{date, open, high, low, close, volume, ma_10...ma_101}] }` — 600 bars |

---

## Deploy Commands

```bash
# Run signal generation (produces output/ files)
cd swing_generator && python3 main.py

# Deploy data only (after running signals) — ~60s, uploads ~224 files to R2
cd swing_generator && python3 webapp/publish.py

# Deploy UI only (after changing index.html / app.js / style.css)
cd swing_generator && python3 webapp/publish.py --ui-only

# Run local dev server
cd swing_generator/webapp && python3 server.py
# → http://localhost:5050
```

---

## Cloudflare Config
- **R2 bucket public URL:** `https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev`
- **Pages URL:** `https://swingpulse.pages.dev`
- Data files served from R2; UI (5 files) deployed to Pages separately

---

## Version History (current)
- `app.js` — **v81**
- `style.css` — **v63**
- `index.html` — bump JS/CSS version numbers when deploying UI changes

---

## Important Rules When Editing

1. **Never pass cross-TF volume column names through `f()`** — use `item.volume_spike_flag` not `item[f('volume_spike_flag')]`
2. **Lightweight Charts is pinned to v4** (`@4` in the CDN URL) — do not upgrade; v5 has breaking API changes
3. **Chart.js stays in `<head>`** — `rebuildCharts()` is called synchronously in `loadAll()` and needs `Chart` available immediately
4. **Modal chart panels start hidden (`display:none`)** — always `await new Promise(r => requestAnimationFrame(r))` before creating a Lightweight Chart inside a modal tab
5. **`autoSize: true`** must be set on Lightweight Charts created inside hidden panels
6. **`formatPrice(val):`** ≥$1000 → 2dp with commas | $10–$999 → 2dp | $1–$9.99 → 4dp | <$1 → 6dp
7. **Search uses `matchesSearch(item, query)`** which checks instrument_name, full display name (namesData), group, sector, industry — use this helper, not inline `.includes()`

---

## GitHub Actions Pipeline (`.github/workflows/`)
- Runs at **03:30 UTC = 05:30 SAST** Monday–Friday
- Steps: install deps → `python3 main.py` → `python3 webapp/publish.py`
- No UI deploy in CI — UI is deployed manually with `--ui-only` when frontend changes

---

## Common Tasks

**Add a new instrument:** Edit `instruments.py`, add entry with name/ticker/group/sector, re-run `main.py`

**Add a new timeframe column:** Add to `config.py` OUTPUT_COLUMNS, compute in `main.py` `process_instrument()`, add prefix to `f()` in `app.js` if it's a new timeframe

**Change signal thresholds:** Edit constants in `config.py` (e.g. `MAX_PENETRATION_3D`, `SIGNAL_LOOKBACK_3D`)

**Debug blank chart in modal:** Check that `autoSize: true` is set AND `await new Promise(r => requestAnimationFrame(r))` runs before `createChart()`

**Data not updating:** Check GitHub Actions tab for pipeline failures; stale banner appears on the site if data date ≠ today
