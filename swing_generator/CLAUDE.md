# SwingPulse — Project Context for Claude

## What is SwingPulse?
A personal swing-trading dashboard with **two profiles** sharing the same codebase:

| Profile | URL | MA ribbon | R2 prefix |
|---------|-----|-----------|-----------|
| default | https://swingpulse.pages.dev | MA10–108 (step 7, 15 MAs) | *(root)* |
| ma200   | https://swingpulse200.pages.dev | MA20–200 (step 10, 19 MAs) | `ma200/` |

Both apps scan the same watchlist of instruments (forex, indices, commodities, crypto) with a
Gann-inspired MA-ribbon signal system and present results as a mobile-first web app.

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
├── main.py                    # Signal generator — profile-aware via --profile flag
├── config.py                  # Default profile: MA10–108, thresholds, output columns
├── config_ma200.py            # MA200 profile: MA20–200, wider thresholds, 18yr history
├── _active_config.py          # Profile resolver — re-exports from config or config_ma200
├── instruments.py             # Master watchlist (name, ticker, group, sector)
├── output/                    # CSV files produced by main.py default profile (gitignored)
├── output_ma200/              # CSV files produced by main.py --profile ma200 (gitignored)
├── cache/                     # Parquet price cache, default profile (gitignored)
├── cache_ma200/               # Parquet price cache, ma200 profile (gitignored)
├── webapp/
│   ├── server.py              # Local Flask dev server (http://localhost:5050)
│   ├── publish.py             # Build + deploy to R2 / Cloudflare Pages (profile-aware)
│   ├── templates/index.html   # Single-page app shell (CSS v65, JS v90)
│   └── static/
│       ├── js/app.js          # All frontend logic (~3400 lines, v90)
│       └── css/style.css      # All styles (v65)
└── .github/workflows/         # GitHub Actions CI
```

---

## Profile System

All Python modules import from `_active_config` instead of `config` directly.
`_active_config.py` reads `--profile` from `sys.argv` and re-exports from the right config.

```python
from _active_config import MA_PERIODS, HISTORY_YEARS, CACHE_DIR, ...
```

Profile detection works in subprocess workers (ProcessPoolExecutor) because they inherit sys.argv.

### MA200 profile differences
- `MA_PERIODS = list(range(20, 201, 10))` — 19 MAs instead of 15
- `HISTORY_YEARS = 18` — 18yr daily history to warm up MA200 monthly
- `CACHE_DIR = cache_ma200/`, `OUTPUT_DIR = output_ma200/`
- Wider penetration/compression thresholds (ribbon step 10 vs 7 ≈ 43% wider spacing)
- `RIBBON_COMPRESSION_THRESHOLD = 3.0` (was 2.0)

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
- **BP1/SP1** — Trend reversal (full ribbon cross + close past longest MA) — highest priority
- **BP2/SP2** — Pullback bounce / rejection off fast MAs
- **BP3/SP3** — Bounce / rejection off longest MA
- **BP4/SP4** — Bounce / rejection at confirmed key level

### Key Computed Fields (per timeframe)
`primary_signal`, `confirmation_status`, `signal_confidence` (high/standard/low),
`trend_direction` (UPTREND/DOWNTREND/NEUTRAL), `established_trend`, `trend_run_days`,
`tf_alignment` (Triple Bull → Triple Bear), `ma_order_score`,
`ribbon_compression` (yes/no), `ribbon_spread`, `volume_spike_flag` (yes/no),
`roc` (5-day rate of change), `last_signal_date`, `last_signal_type`, `key_levels_all`

---

## Frontend App Tabs
1. **Dashboard** — Market gauge, stat cards, heatmap, signal feed, alignment summary
2. **Scanner** — Unified instrument grid with filters: group, sector, trend, alignment, confidence, signal codes, key levels, vol spikes
3. **Watchlist** — Starred instruments + alert sub-tabs (turning points, watch flags, key levels, vol)
4. **Trends** — Trend history per instrument (timeline, stats, maturity)
5. **Portfolio** — XM broker positions (parsed from Gmail email confirmations) — no manual trade entry

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
| `/api/history/{name}` | `{ ticker, data: [{date, open, high, low, close, volume, ma_10...ma_N}] }` — 600 bars |

---

## Deploy Commands

```bash
# ── Default profile (swingpulse.pages.dev) ────────────────────────────────
# Run signal generation
cd swing_generator && python3 main.py

# Deploy data only (uploads ~224 files to R2 root)
cd swing_generator && python3 webapp/publish.py

# Deploy UI only
cd swing_generator && python3 webapp/publish.py --ui-only

# ── MA200 profile (swingpulse200.pages.dev) ───────────────────────────────
# Run signal generation
cd swing_generator && python3 main.py --profile ma200

# Deploy data only (uploads to R2 ma200/ prefix)
cd swing_generator && python3 webapp/publish.py --profile ma200

# Deploy UI only
cd swing_generator && python3 webapp/publish.py --profile ma200 --ui-only

# ── Local dev server ──────────────────────────────────────────────────────
cd swing_generator/webapp && python3 server.py
# → http://localhost:5050
```

---

## Cloudflare Config
- **R2 bucket public URL:** `https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev`
- **Default Pages URL:** `https://swingpulse.pages.dev` (Cloudflare Pages project: `swingpulse`)
- **MA200 Pages URL:** `https://swingpulse200.pages.dev` (Cloudflare Pages project: `swingpulse200`)
- Data files served from R2; UI (5 files) deployed to Pages separately

---

## Version History (current)
- `app.js` — **v90**
- `style.css` — **v65**
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
8. **Profile imports:** all Python modules use `from _active_config import ...` — never `from config import` directly

---

## GitHub Actions Pipeline (`.github/workflows/`)

| File | Profile | App | Cron (UTC) | Cache |
|------|---------|-----|-----------|-------|
| `publish.yml` | default (MA108) | swingpulse.pages.dev | 03:30, 07:30, 11:30, 15:30, 19:30 Mon–Fri | `cache/` |
| `publish_ma200.yml` | ma200 | swingpulse200.pages.dev | 04:00, 08:00, 12:00, 16:00, 20:00 Mon–Fri | `cache_ma200/` |

- Both workflows run `python3 main.py [--profile ma200]` which internally calls `publish.py` to upload data to R2
- Push notifications: `publish.yml` sends `X-Profile: default`, `publish_ma200.yml` sends `X-Profile: ma200`
- No UI deploy in CI — UI is deployed manually with `--ui-only` when frontend changes

---

## Common Tasks

**Add a new instrument:** Edit `instruments.py`, add entry with name/ticker/group/sector, re-run `main.py`

**Add a new timeframe column:** Add to `config.py` OUTPUT_COLUMNS, compute in `main.py` `process_instrument()`, add prefix to `f()` in `app.js` if it's a new timeframe

**Change signal thresholds:** Edit constants in `config.py` (default) or `config_ma200.py` (MA200 profile)

**Debug blank chart in modal:** Check that `autoSize: true` is set AND `await new Promise(r => requestAnimationFrame(r))` runs before `createChart()`

**Data not updating:** Check GitHub Actions tab for pipeline failures; stale banner appears on the site if data date ≠ today
