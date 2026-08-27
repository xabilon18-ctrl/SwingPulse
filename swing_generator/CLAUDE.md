# SwingPulse — System Context

> Auto-generated from codebase — reflects actual current file state.
> Update this file whenever the architecture, profile, versions, or instruments count changes.

## What is SwingPulse?
A personal swing-trading signal dashboard that scans a watchlist of instruments (indices, commodities, crypto, currencies, US/global equities — the currency pairs were removed 2026-07-11 for worst-class backtest expectancy and RESTORED 2026-08-25 at the user's request, 57 pairs, #742-798). **Vocabulary: the asset class is called `Currency` everywhere** — group, sector, asset_class, Class chip and radar spoke all use that one word (renamed 2026-08-26; it had been a mix of Forex/FX/Currency/Currencies). The only `FX` left is TradingView's `FX:`/`FX_IDC:` exchange prefixes, which are their identifiers, not ours. using a Gann-inspired MA-ribbon system. Results are served as a mobile-first web app.

**Single active profile: MA500** (25, 50, 75 … 500 — step 25, 20 MAs)

| Item | Value |
|------|-------|
| Live URL | https://swingpulse200.pages.dev |
| R2 data prefix | `ma500/` |
| Instruments | **793** (parsed from `../Instruments.txt`) — 736 + 57 currency pairs restored 2026-08-25 |
| MA ribbon | MA25–MA500 (step 25, 20 MAs) |
| History years | 13 (`HISTORY_YEARS` in config.py — daily MA500 warmup + the backtest window since 2016; the 45 that used to be here only served the removed monthly timeframe) |

---

## Stack at a Glance

| Layer | Technology |
|-------|------------|
| Signal engine | Python (`main.py`) |
| Web server (local dev) | Flask (`webapp/server.py`, port 5050) |
| Frontend | Vanilla JS + Chart.js 4.5.1 (exact pin + SRI hash). *Lightweight Charts is NOT used — see Important Rule 2.* |
| Utility helpers | *(none — `utils.js` was deleted in cfe4013; its helpers live in `app.js`)* |
| Deploy | Cloudflare Pages (UI) + Cloudflare R2 (data files) |
| CI pipeline | GitHub Actions (`publish.yml`) — cron **3×/day weekdays** (01:35, 09:35, 14:35 UTC — land ~05:00/13:00/18:00 SAST after GitHub's 1.5–3h queue) + 1×/day weekends (08 UTC, crypto) + manual. Restored to three runs 2026-07-31. |
| Repo | https://github.com/xabilon18-ctrl/SwingPulse — **the only one.** `xabilon18/SwingPulse` was the original prod repo until 2026-06-01 and is now retired: its publish workflow is disabled, it holds no commits this one lacks, and the local `prod` remote was removed 2026-08-27. Manual run: `gh workflow run publish.yml --repo xabilon18-ctrl/SwingPulse --ref main` |

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
│   ├── templates/index.html   # SPA shell (app.js?v=236, style.css?v=214)
│   └── static/
│       ├── js/app.js          # All frontend logic (v236)
│       └── css/style.css      # All styles (v214; single dark theme)
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
SMALL_MA_RANGE       = [p for p in MA_PERIODS if p <= 250]  # BP2/SP2 fast side
MA_MIDPOINT          = MA_PERIODS[10]              # MA275
HISTORY_YEARS        = 13
CACHE_DIR            = 'cache_ma500/'
OUTPUT_DIR           = 'output_ma500/'
RIBBON_COMPRESSION_THRESHOLD = 5.0                 # wider than MA200 (step 25 vs 10)
```

---

## Signal System

### Timeframes
`D` (Daily) · `4H` (4-Hour)

**4H bar geometry (2026-07-30).** A 4H bar is only as fast as its session. yfinance 1h is
regular-session only for a cash index, so `^NDX` gave 2 four-hour bars/session vs the 24h
contract's 6 — MA500 spanned ~305 days instead of ~83, and the 4H could not report a
breakdown until price gave up a year of average. All 20 cash indices carried a wrong 4H
trend label and 5 missed a fire (US100 S1 07-24, SOX S1 07-27, NI225 S1 07-28, NQTW S1
07-28, CHINAH B1). Fixed two ways, both in `config.py`:
- `H4_SOURCE` — US100/US500/US30/RUSSELL/NI225 take their **4H feed** from
  `NQ=F`/`ES=F`/`YM=F`/`RTY=F`/`NKD=F` (`data_fetcher.h4_ticker()`). Cache is keyed by the
  SOURCE ticker; `main.py` and `backtest.py` both resolve the mapping.
- `H4_SESSION_NORMALIZE` — the other 15 indices scale the ribbon by bars/session instead
  (`main._h4_ma_periods()`): MA12–MA250 for EU, MA8–MA167 for 2/session.
**Daily is untouched** and individual equities are deliberately left alone — a US stock
really does trade 6.5h, so its 4H is ~2 bars/session everywhere. See SIGNAL_RULES.md §1.

### Column Prefix Convention
| Timeframe | Prefix |
|-----------|--------|
| Daily     | *(none)* — e.g. `primary_signal` |
| 4-Hour    | `h4_`  — e.g. `h4_primary_signal` |

In `app.js` the `f(field)` helper applies the active prefix.  
**Exception (corrected 2026-08-17):** pass the UNPREFIXED name — `f('volume_spike_flag')` —
and let f() pick the timeframe, exactly as for any other column. Only an already-prefixed
name is forbidden: `f('h4_volume_spike_flag')` double-prefixes and silently reads
undefined. See Important Rule 1 for the measurement behind this.

### Signal Types (B = buy, S = sell — see signals.py, full rules in SIGNAL_RULES.md)
- **B1/S1** — Trend reversal: price crosses above (B1) / below (S1) **all** MAs from a non-trending state (anchor-gated); re-fires near MA500 within `refire_pct` for 10 days
- **B2/S2** — Pullback recovery: dipped below MA25 in-trend, closed back above (mirror for S2)
- **B3/S3** — Mid-ribbon bounce/rejection: wick touched MA250, close confirmed
- **B4/S4** — Anchor bounce/rejection: wick touched MA500, close confirmed

### Signal confidence — backtest-driven (2026-07-09)
`signal_confidence` (high/standard/low) is the measured backtest expectancy of that signal code
on that timeframe + asset class — looked up from `confidence_map.json` (generated by
`backtest.py --since 2016-01-01`). high = avg ≥ +0.05R, low = negative expectancy.
Re-run the backtest after any signal-rule change so the map stays honest.

**Context modifiers (edge-audit phase 3a, 2026-07-15):** after the base tier, `main.py
apply_context_confidence()` shifts it ±1 per matching `config.CONTEXT_RULES` entry (D B1
overbought/disordered −1, D B2 chasing −1 / weakness +1, D S3/S4 rollover-stage-2 +1).
Reason written to `confidence_context`. Rules mined by `edge_audit.py`; see `SIGNAL_RULES.md`
§4a and `EDGE_AUDIT_PHASE3.md`. Phase 3b (ATR/volatility rules, 4H alignment) deferred.

### Key Computed Fields (per timeframe, via `_tf_signal_columns`)
`primary_signal`, `secondary_signal`, `confirmation_status`, `signal_confidence` (high/standard/low), `confidence_context`,  
`trend_direction` (UPTREND/DOWNTREND/NEUTRAL), `established_trend`, `trend_run_days`,  
`tf_alignment`, `tf_alignment_score`, `ma_order_score`,  
`ribbon_compression`, `ribbon_spread`, `ribbon_slope_pct`,  
`volume_spike_flag`, `roc`, `rsi`,  
`last_signal_type`, `last_signal_date`, `last_signal_days_ago`,  
`watch_flag`, `potential_turning_point_flag`,  
`rollover_score`, `rollover_max`, `rollover_dir`, `rollover_stage`

### Intraday-only Fields
`h4_datetime` — the exact 4H bar timestamp (2026-07-27). `h4_date` alone is ambiguous:
a date holds 2–6 four-hour bars, and the ledger resolved a 4H fire to the LAST bar of
that date, which (runs land midday) is typically 1–5 bars after the bar that fired — so
every graded 4H trade was entered up to a session late. Emitted only when a prefix is
set (`main.py _extract_row`); daily bars are unique by date.

### Daily-only Fields
`ma25_cross_count`, `neutral_oscillation`, `new_trend_flag`,  
`pct_1d`, `pct_1y`,  
`key_level_price`, `key_level_type`, `key_level_date`, `key_level_touch_count`, `key_level_touched_today`, `key_levels_all` (live since 2026-07-09 — computed by key_levels.py on the last 1500 daily bars)

### Dead columns (kept for payload compatibility, always empty)
`watch_flag`, `potential_turning_point_flag` — their UI (Analyzed alert tabs, counters) was removed 2026-07-09.

---

## Frontend App Tabs
1. **Dashboard** — Market gauge, stat cards, signal feed, alignment summary
2. **Scanner** — Instrument grid with filters: group, sector, trend, alignment, confidence, signal codes, key levels, vol spikes
3. **Analyzed** — Instruments the user has technically analyzed (star = "I analyzed this") + alert sub-tabs (turning points, watch flags, key levels, vol). Pane id is still `pane-watchlist` and storage key is still `swingpulse-starred` — only the UI label changed.
4. **Trends** — Trend history per instrument (timeline, stats, maturity)

> Note: **Portfolio** tab was in the old CLAUDE.md but is not present in the current `index.html` nav. XM positions are fetched via `/api/portfolio` but rendered within the Dashboard.
> A **Flow** section (`window._renderFlow`) renders inside the Dashboard pane via `initFlowTab()` — it is not a top-level nav tab.

---

## API Endpoints (served by `server.py` locally and as static JSON by `publish.py`)

| Endpoint | Returns |
|----------|---------|
| `/api/signals` | `{ date, data: [...] }` — full instrument data |
| `/api/summary` | Aggregate counts (buy/sell/watch/vol_spikes etc.) |
| `/api/trends` | `{ instrument_name: [{direction, start, end, days, pct_move}] }` |
| `/api/history/{name}` | `{ ticker, data: [{date, open, high, low, close, volume, ma_25...ma_500}] }` — 600 bars |
| `/api/tv-map` | `{ instrument_name: "EXCHANGE:SYMBOL" }` for TradingView links |
| `/api/ticker-map` | `{ display_name: ticker }` |
| `/api/names` | `{ display_name: full company name }` — keyed by display name since 2026-07-19 (was yf ticker, which never matched `instName()` lookups) |
| `/api/ai-instruments` | List of AI-sector instrument names |
| `/api/explanations` | Signal explanation text map |
| `/api/flow` | Capital flow data for a group/region/period |
| `/api/backtest` | Latest backtest results (overall, by_signal, by_tf, by_class, by_instrument, equity_curve, params) |
| `/api/refresh` | POST — triggers a fresh data reload on the server |

---

## Cloudflare Config
- **R2 bucket public URL:** `https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev`
- **R2 data path:** `https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev/ma500/`
- **Pages URL:** `https://swingpulse200.pages.dev` (Cloudflare Pages project: `swingpulse200`)
- UI (index.html + static assets) deployed to Pages; data files uploaded to R2 `ma500/` prefix

---

## Current Versions
- `app.js` — **v237** (v237 — **one card vocabulary, three densities.** The Signals card, Analyzed row and Trends card describe the same instrument and each said it differently: three spellings of the identity block (`.scanner-name`/`.wl-card-name` etc.), two hand-copies of the action buttons, and `verdictOf()` — the app's headline judgement — rendered on exactly ONE of the three. New shared `cardIdentityHtml()` / `cardActionsHtml()` / `verdictChipHtml()`; the four old per-card classes collapse to `.card-name`/`.card-group` (css v215) and their dead rules are deleted. **Deliberately NOT one identical card** — the tabs answer different questions (what to look at / what I've studied / how long this has run), so density SHOULD differ; what must not differ is that a given fact renders as the same element everywhere. Trends KEEPS its run-days hero for that reason. Analyzed and Trends gain the verdict at chip density (same `verdictOf()`, same `.sc-v-*` tone classes — the tone selectors were widened rather than restated, so 'a buy verdict looks like this' has one definition). Verified: scanner 100/100 cards on the shared classes with zero old-class hits, Analyzed 33 cards / 28 chips, Trends 717 cards / 366 chips / 717 run-day heroes intact; no horizontal scroll and 0 overflowing elements at 390px on all three tabs. v236 — **Trends cards show their signal again.** `buildTrendsCards()` read `d[f('signal_type')] || d[f('signal')]` — NEITHER is a column, and never has been (the payload carries `primary_signal` and `last_signal_type`). Both reads returned undefined on every row, so every Trends card's badge printed a muted **"No signal" for all 736 instruments** regardless of what fired. The badge then tested that empty value for the words 'buy'/'sell'/'watch', which could never have matched even once populated, since the field holds CODES. Now `d[f('primary_signal')]` + a B/S prefix test, matching publish.py/server.py's buy_mask — verified live: 38 badges (B1x5 B2x14 B3x1 B4x2 S1x1 S2x3 S3x8 S4x4), exactly the 38 signalled rows in the payload. The 'watch' branch is gone (no such code; watch_flag is dead). THIRD instance of this family after the gauge (v225) and shareCard (v235) — **found by the reinstated ghost-read check in tools/shape_audit.py**. v235 — **share card shows its direction again.** `shareCard()` built its buy/sell label with `conf.toLowerCase().includes('buy')` where `conf` is `confirmation_status` — a field whose 18 phrasings ("Uptrend — above all MAs", "Trend breakout — B1: …") contain neither 'buy' nor 'sell'. `dirLabel` was therefore `''` on every instrument that has ever fired, so `if (sig && dirLabel)` could never fire: the shared card lost its direction + signal-code line AND printed the trend line twice (once from the `else if (trend)` branch, once from the later `if (sig && trend)`). This is the SAME bug v225 fixed in `computeSummary()` — there were two call sites and only one was fixed. Now `sig.startsWith('B')/('S')`, matching publish.py/server.py's `buy_mask` exactly, so there is one definition of buy/sell rather than three. Measured on the live payload: all 38 signalled instruments produced an empty label before, all 38 resolve after; verified in-app via `window.SP.shareCard` (GOOGL B3 → "🟢 Buy · B3", CDNS S1 → "🔴 Sell · S1", trend line once). Dead local `conf` removed with it. **Found by `tools/shape_audit.py`, not by hand** — see that file and the Common Tasks entry below. v234 — **week and month returns surfaced; Move filter added to the Signals tab.** `pct_1w`/`pct_1m` have shipped from the pipeline since the performance columns were added (indicators.add_performance_pct → config.OUTPUT_COLUMNS → signals.json) and were present in every published payload — nothing read them. The scanner card's stat row goes 1D/1Y/VOL → **1D/1W/1M/1Y/VOL**, and the Sort pill and advanced-sheet `<select>` gain Week/Month in both directions; the four `pct_*` sort branches collapsed into one regex branch rather than becoming eight hand-copies. NEW **Move pill** (`scannerMovePeriod`/`scannerMoveDir`/`scannerMoveMin`) filters by period return on three independent axes — period 1D/1W/1M/1Y × direction Either/Up/Down × size Any/2/5/10/25/50% — which is 9 chips instead of the 12+ a flat up2/up5/down2/… list would have needed for the same reach. Applied OUTSIDE the `if (!search)` chip block, alongside Class and Mood, so typing a name narrows the move filter instead of silently switching it off (the v229 class-chip collision). Rows with no return for the chosen period are excluded, not passed through. Verified against the raw payload: 1M ▲ 10%+ → 166, matching a direct count over `/api/signals`; composes with search (crypto + 1W ▲ 5%+ → 3, min 6.1%). Note the returns are DAILY-close based on both timeframes — there is no `h4_pct_*`, so they never go through `f()`. v231 — **stale banner stopped reconstructing the CI schedule.** It held `RUN_HOURS_WEEKDAY=[11,15]` as expected LANDING hours + 2.5h grace and warned whenever data predated the run that 'should' have finished — a number that had to be hand-synced with publish.yml and that assumed a queue delay GitHub does not honour. Crons are queued 1.5-3h: on 2026-07-27 the 10:35 run started 13:26 and landed ~13:32, two minutes past the 13:30 cutoff, so a healthy pipeline was reported late; the weekend margin was 25 min (cron 08:00, observed start 10:00). Now freshness is just `now - summary.fetched_at` (stamped on every SUCCESSFUL publish) against `STALE_AFTER_H = 32`, set from MEASURED gaps — largest real gap over 30 runs was 27.4h (Sun 10:00 -> Mon 13:26); a first cut at 26h would have false-alarmed every Monday. No schedule knowledge, nothing to keep in sync. A FAILED run is now surfaced immediately via NEW `/api/status` -> status.json (`state:'failed'`), which only sw.js used to read. Banner also **clears itself**: `scheduleStaleRetry()` re-loads every 10 min while it is showing instead of leaving the warning up until the next 4-hourly refresh. v230 — **trend_direction is now authoritative for the trend badge.** `effectiveTrend()` had a `confirmation_status` keyword fallback written for the old "Neutral — transitioning (rising/declining ribbon)" statuses, which signals.py no longer emits. The only strings it still caught were "Pullback below MA500 — uptrend intact" and "Rally above MA500 — downtrend intact" — 57 rows on the 07-28 run — both produced by the in_uptrend/in_downtrend LATCH, which clears only on a full-ribbon B1/S1 cross. So the fallback was overriding the corrected ribbon-position read with a regime flag that can be months stale. Removed; the pipeline-side fix is in indicators.add_trend + main._compute_tf_alignment (see SIGNAL_RULES.md §1). v229 — audit items 5/7/8 + 22/24 + CDN pin: **one definition of "today"** (`firedOnLatestBar()`, shared with `moodApplies`) — the Today chip compared the fire date against the DEVICE's midnight while the cards compared against the data's newest bar, so on a weekend or any lagging feed the chip returned 0 while the cards below it read "Today" (verified: local data dated the 28th on a device set to the 29th → chip 0 before, 114 after, every card reading "Latest bar"). Per-instrument on purpose — feeds lag at different rates. **`asset_class` now ships from the pipeline** (`main.py` row build + OUTPUT_COLUMNS) and `assetClassOf()` reads it, keeping its old body only as a fallback for pre-column payloads — app.js had a hand-copy of `instruments.py asset_class_of()`, and two implementations of one rule in two languages is exactly how the buy/sell bug survived a year. **User picker is dismissible** — `hideUserPicker()` + a "Not now — just browsing" button, backdrop tap and Escape; it opened on first load with no way out, so a new device was stuck on it before seeing a single signal. Also removed five full passes over the filtered list computing buy/sell/squeeze/keylvl/today tallies for the `#scannerSummary` pills that v226 deleted. v228: **live Track Record now counts only MATURED fires.** `signal_ledger.py` writes a trade the moment it resolves, and a 1R stop resolves far sooner than a 2R target — so averaging every resolved fire samples the fast losers. On Daily (30-bar window, ledger 4 weeks old) NOT ONE fire had matured, yet the card printed B1 −1.078R / 7.9% win beside the backtest's +0.066R as if comparable; D|B4 read 0% off 1 of 69 fires while its unbiased +20-bar mark was strongly positive. Grading now sets `matured` once the fire's full window (`TIME_STOP_BARS` D 30 / 4H 60 bars) has elapsed — `grade_open_records` revisits resolved-but-immature records so they can become eligible — and `_bucket_stats` averages `counted` (resolved AND matured) only, reporting `counted`/`maturing`/`approx` + an unbiased `h20_avg_pct`/`h20_n` alongside. A code needs 10 counted fires before the card shows a row at all; the rest render as a plain "still maturing B1 2/10 · …" line. On the 801-fire ledger: 348 resolved → **40 counted**, and the only code with a shippable sample is S2 (25/164, 32% win, −0.274R vs BT −0.098R). A pre-gate payload (`totals.counted === undefined`) renders "grades are being recomputed" rather than the old biased numbers. ALSO in v226 (front-end consistency pass, audit items 14-18): **confidence tier stated once per card** — `setupPanelHtml(item, {showConf:false})` on the scanner card, where `.sc-verdict` right above already says "standard edge"; the modal (no verdict bar) still passes the default `true`. **`#scannerSummary` strip emptied** — it repeated the header's own count one line below it; its delegated `[data-sum-filter]` handler removed with it ("clear filters" is the All button in the pill row). **Timeframe switch no longer sits dead on Trends** — `TF_LOCKED_TABS` + `syncTfLock()` swap the two buttons for `#tfSwitchNote` ("Daily · trend history is daily-only") inside the same `.tf-switch` box; the note's 12px/14px box is deliberately identical to `.tf-switch-btn` so the topbar-stack stays exactly 119px on desktop and `.bottom-nav{top:119px}` still lines up (verified 119/119 on both tabs). v225: **Market Pulse gauge signal component un-frozen** — `computeSummary()` counted buys/sells with `confirmation_status.includes('buy'/'sell')`, but that field's vocabulary is "Uptrend — above all MAs" / "Above MA500 — watching for pullback entry" and contains neither word, so `buy_count`/`sell_count` were structurally 0 on every run. `computeStrengthScore()`'s signal-direction term (`buy/(buy+sell)*30`) therefore always hit its no-signals fallback of **15**, pinning a third of the gauge formula to a constant since it shipped. Now counted by code prefix, matching publish.py/server.py's `buy_mask = primary_signal.startswith('B')` exactly (verified: client 13/11 == server 13/11). Effect: Daily 71→72, 4H 69→63 — the term now actually tracks buy/sell balance and differs per timeframe. NB deliberately NOT `isBuy()/isSell()`, which fall back to trend when no signal fired and would count every uptrending instrument as a buy. This was audit backlog item (f) "two buy/sell definitions"; the note undersold it as cosmetic. The `#buyCount`/`#sellCount`/`#gbBuy`/`#gbSell` spans are `display:none` — the gauge was the only live consumer. v224 — review fixes on the v222 conviction layer: (1) **age is measured against the DATA's latest bar, not the wall clock** — new `daysBetween()` (UTC-parsed, timezone-proof) feeds `signalAge(dateStr, asOfStr)` + `signalPerf`; a fire on the newest bar reads "Today" (or "Latest bar" when the feed is behind) instead of "1d ago", and the structurally-meaningless "+0.0% since" is suppressed at 0 days. Was: 35 of 76 cards read "1d · +0.0%" when zero bars had closed. (2) **mood terms removed from free-text search** (`MOOD_SEARCH`/`matchesMoodSearch` deleted) — prefix matching meant "cal"→calm returned 661 of 741 instruments, "act"→active 102; search must narrow, the Mood pill is the way to filter by mood. (3) **verdict scoring is now ADDITIVE, not override** — base confidence tier ±1 sector delta, clamped 0–4 (`VERDICT_TIERS`); a high-tier buy in a fighting sector lands at BUY SETUP (3−1) instead of erasing the tier to a bare "⚠ FIGHTING SECTOR"; new floor tier `⚠ AVOID`. Phase 0 measured mood as a delta vs baseline, so it must adjust the base, not replace it. (4) **mood layer gated to what was tested** — `moodApplies()`: daily only (Phase 0 ran TF='D') AND only for a fire on the item's latest bar (the flavours file carries one mood — today's; Phase 0 scored each fire against its OWN fire-day mood). (5) **card decluttered** — `.sc-mood-chip` + `.sc-conv` pip row removed (on a normal day they said "calm/no opinion" 60+ times a screen); the sector now speaks only via `.sc-v-note` inside the verdict bar, which renders only when the mood actually moved the score. (6) new `unknown` flavour + "No sector read" Mood option — an unjudgeable sector no longer reads as a calm all-clear. NOTE: ★ HIGH-CONVICTION remains reachable via the sector-confirmed bump only, which today exists for SELLs — no buy-side promotion has cleared the evidence bar (buy_thrust t=+1.5; market-wide buy +0.24R held back as regime-suspect). v222: top-of-card `.sc-verdict` bar — `verdictOf()` fuses signal + backtest confidence tier + sector mood into one plain-language call [★ HIGH-CONVICTION / STRONG / SETUP / ⚠ LOW-EDGE / ⚠ FIGHTING SECTOR / ⚠ LIKELY TRAP]; the 18 flat Signals chips consolidated into 3 `<details>` dropdown pills [Class/Mood/Filters] in `.sig-filter-pills` (existing `#scannerCatChips` + `.sig-ctx-row` moved inside, handlers untouched; `updateFilterPills()` syncs `.has-active`); NEW Mood filter (`scannerMoodFilter` + `#scannerMoodOpts`) and mood terms added to `matchesSearch` via `matchesMoodSearch`. v221: banner copy fix. v220: sector-mood conviction layer, Phase 0 VALIDATED on real R 2026-07-22: scanner cards get a `.sc-mood-chip` (sector flavour today) + a `.sc-conv` grade row (pips + label); SELL+sell_thrust = confirmed/glow, BUY into sinking/churn or SELL on a market-wide day = fighting/dim; `convictionOf()`/`moodChipHtml()` read `instrument_flavours.json` (per-instrument, keyed by name). New "Conviction ↓" scanner sort + Dashboard `#marketStateBanner` (sit-out day on market-wide churn). Grade is DISPLAY-ONLY — does NOT touch `signal_confidence`. Real-R backtest (research/flavour_phase0_R.py, 14.5k trades) confirmed all 3 rules [SELL+sell_thrust +0.15R, BUY-into-fighting −0.16R, SELL+market_wide −0.23R] → "provisional" label dropped (caveat: one up-market regime). v217: sector radar interactive; clickable `.sr-spoke`/`.sr-chip`s → `srGoToSector()`)
- `style.css` — **v214** (v214: five-tile `.sc-stats` + Move pill. The stats row went flex→**grid** (`repeat(5,1fr)`): five `flex:1` children left ~24px of text per tile and wrapped every value. Tile width tracks the CARD, not the viewport — 1280px lays the scanner out in 4 columns of 297px (44px per tile), TIGHTER than a 375px phone's one full-width card (52px), and 320px is tighter still — so the narrow case is a **`@container (max-width:290px)`** query on `.scanner-card` reclaiming gap/padding, not a media query, which would have tightened the wrong case in both directions. Verified 0 clipped tiles at 320/375/768/1280; app.js drops the decimal past ±100% to match. **Move pop is anchored to the pill ROW** (`.sig-filter-pills{position:relative}` + `#pillMove{position:static}`) — it is wider than the other pops and its pill sits mid-row, so left-anchored it ran ~30px off a 375px screen, and the `:last-of-type` right-anchor trick only moves the overflow to the left edge when the pill wraps to the start of a row. v213: `.up-skip` user-picker escape; v212: sector radar sized up for phones — see v228 note; v211: **one selected-state colour across every toggle** — `.sig-dir-btn.active` was a leftover blue `rgba(79,158,255,.15)`, `.gp-view-toggle.gp-view-active` indigo, `.vp-mode-btn.vp-active` violet; all three are now `--accent-glow` bg + `--accent` text (+ `--accent` border on the two card-header toggles, which also now share one box: 4/10 padding, 8px radius). `--volume` violet stays on Volume Pulse's DATA, where it means volume rather than "selected"; `.sig-dir-buy/-sell` keep green/red, which carry meaning. `.sig-view-btn.active` ink `#fff`→`#0a0a0b` to match `.tf-switch-btn.active` (white on amber was barely legible). **Sector Radar de-monospaced** — `#sectorRadarBody`/`.sr-badge` dropped `ui-monospace` (kept `font-variant-numeric: tabular-nums` so the z-scores don't jitter); same for the `.ms-prov` chip in the market-state banner. It was the one card that read like a different application. NEW `.tf-switch-note` + `body.tf-locked` rules, and a desktop `.tf-switch{max-width:460px;margin:0 auto}` — the toggle previously spanned the full 1600px window, the largest element on screen. v210: **all three filter pills present identically** — Class and Filters were wrapped chip clouds, Mood was a vertical option list; now one shared rule set styles `.mood-opt`, `.filter-pop .s-cat-chip` and `.filter-pop .sig-ctx-chip` as the same full-width row (9px radius, 8/11 padding, .8rem/600, 190px wide) in a single column. Presentation only and scoped to `.filter-pop` — `#scannerCatChips`/`.sig-ctx-row` keep their markup, ids and handlers, and keep the old chip-row look anywhere outside a pill. Per-category `[data-cat]` colour tints are overridden at rest; selection is the same amber in all three (Mood's own `.mo-confirmed`/`.mo-fighting` reds, `.sig-chip-best.active` violet and the radar `.prime`/`.strong` tier colours are re-asserted so stateful feedback survives). `.filter-pop` gained `max-height:min(58vh,430px)` + `overflow-y:auto` so a long list can't run off-screen, and `.filter-pill:last-of-type .filter-pop` right-aligns — left-anchored the Filters list ended at x=396 on a 390px viewport. v209: `.sc-v-note` sector line inside the verdict bar; dead rules removed — `.sig-dir-row` (wrapper div gone since v222), all `.sc-mood-chip`/`.mood-dot`/`.m-*` and `.sc-conv`/`.sc-pip*` rules. `.scanner-card.sc-confirmed`/`.sc-fighting` glow+dim KEPT.) (v208: `.sc-verdict` top-of-card bar + `.sig-filter-pills`/`.filter-pill` `<details>` dropdowns + `.filter-pop`/`.mood-opts`; v207 `.sc-mood-chip`/`.sc-conv`/`.sc-pip` + `.scanner-card.sc-confirmed`/`.sc-fighting` + `.market-state` banner)
- `index.html` — bump all three `?v=` query strings when deploying UI changes
- `Instruments.txt` — **793 instruments** (2026-07-28: 11 dead Yahoo tickers re-pointed, 3 taken-over names removed, 2 parked — see the audit entry)

---

## Deploy Commands

```bash
# Run signal generation
cd swing_generator && python3 main.py --profile ma500

# Deploy data only (uploads to R2 ma500/ prefix, ~740+ files)
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
| `publish.yml` | ma500 | `35 1/9/14 * * 1-5` + `0 8 * * 6,0` (weekday **3×**, weekend 1× UTC; :35 dodges GitHub's top-of-hour queue) + manual | `cache_ma500/` |

- Runs `python3 main.py --profile ma500` → uploads data to R2 → sends push notification with `X-Profile: ma500`
- No UI deploy in CI — deploy UI manually with `--ui-only`

---

## Important Rules When Editing

1. **Never pass an ALREADY-PREFIXED name through `f()`** — `f('h4_volume_spike_flag')`
   resolves to `h4_h4_volume_spike_flag` on the 4H timeframe, which is undefined on every
   row and fails silently. **Corrected 2026-08-17:** this rule used to read "never pass
   cross-TF volume columns through `f()` — use `item.volume_spike_flag`", which is too
   broad and contradicts the code. `f('volume_spike_flag')` is CORRECT and is used 17
   times in app.js: both `volume_spike_flag` and `h4_volume_spike_flag` ship on every row
   and they genuinely differ (measured 2026-08-17: 208 daily spikes vs 138 4H, disagreeing
   on 224 of 736 rows), so f() picks the right one per timeframe. Following the old wording
   would have shown DAILY volume spikes while the user was looking at the 4H board.
   Deliberate daily-only readers are fine unprefixed — `renderNotifPanel()` reads
   `item.primary_signal`/`item.volume_spike_flag` directly because the whole panel is daily.
   NB `app.js:5006` hand-rolls f()'s job as `timeframe === '4H' ? item.h4_… : item.…` —
   correct, but a second implementation of the prefix rule.
2. ~~**Lightweight Charts is pinned to v4**~~ — **STALE, removed 2026-08-17.** The library
   is not in the codebase: `lightweight`/`LightweightCharts`/`createChart` return zero hits
   across every `.html`/`.js`/`.py` outside this file. The live rule is the one that
   replaced it — **chart.js is pinned to an EXACT version with an SRI hash**
   (`chart.js@4.5.1` + `integrity=` in index.html, since 2026-07-29). It was a floating
   `chart.js@4` before that, silently following every upstream release. Upgrading means
   changing the version AND regenerating the integrity hash in the same edit.
3. **Chart.js stays in `<head>`** — `rebuildCharts()` is called synchronously in `loadAll()` and needs `Chart` available immediately
4. ~~**Modal chart panels start hidden**~~ / 5. ~~**`autoSize: true`**~~ — **STALE, same cause
   as rule 2 (2026-08-17).** Both describe Lightweight Charts, which is no longer used.
   Nothing in the codebase calls `createChart()`. Left visible rather than deleted so the
   next person searching for why modal charts render blank finds the answer — that
   subsystem is gone — instead of a rule with no code behind it.
6. **`formatPrice(val)`** lives in `app.js:1243` (was `utils.js`/SP_UTILS until cfe4013 deleted that file — the tag, the file and every SP_UTILS reference are all gone) — ≥$1000 → 2dp+commas | $10–$999 → 2dp | $1–$9.99 → 4dp | <$1 → 6dp
7. **Search uses `matchesSearch(item, query)`** — checks instrument_name, display name, group, sector, industry — use this, not inline `.includes()`
8. **Profile imports:** all Python modules use `from _active_config import ...` — never `from config import` directly
9. **`<body data-profile="__APP_PROFILE__">`** is patched to `ma500` by `build_ui()` in publish.py — use CSS `body[data-profile="ma500"] #id { display:none }` to hide profile-irrelevant cards
10. **Finished sessions only (2026-08-04).** The pipeline never computes on a bar whose session is still open. `drop_unfinished_daily` (a daily bar is final once the UTC day after its date has begun) is applied in `main._process_worker` — the read that feeds the indicators, NOT in `fetch_all`, whose frames are used for their keys alone. `drop_unfinished_4h` (a bucket is final 4h after it opens) is applied in `main._resample_4h`. One UTC rule, no per-exchange timetable: every venue closes before midnight UTC on its own bar date. **The cache deliberately keeps the raw bar** so a late-settling volume can still be healed. Why: the 20h freshness gate means only the FIRST of the three daily CI runs downloads, so the whole day is built from one 03:00 UTC snapshot — taken while Tokyo, Hong Kong, Sydney and crypto are mid-session (measured: ASX200 held 28% of its volume, Asian indices 0%, closes off 0.5–1.3%).
11. **Volume baselines exclude unreported bars** — `indicators._reported_volume` masks zero-volume bars to NaN before the rolling mean. A zero drags the 25-bar average down so the NEXT ordinary bar reads as a spike (cocoa: 60 radar V-events/250d vs AAPL's 7). Never roll your own average off raw `df['Volume']`; read `volume_average`.
12. **`fetch()` re-requests the last cached date** rather than starting the day after it. A run landing mid-session used to freeze that bar forever (41% of cached last bars held short volume). `_append_new_bars` dedupes `keep='last'`, so the corrected bar overwrites the stale one.

---

## Common Tasks

**Add a new instrument:** Edit `../Instruments.txt` (pipe-delimited format), re-run `main.py --profile ma500`

**Add a new signal column:** Add to `config.py` OUTPUT_COLUMNS + `_tf_signal_columns()`, compute in `main.py` `process_instrument()`, handle in `app.js`

**Change signal thresholds:** Edit constants in `config.py`

**Audit the shape of a payload:** `python3 tools/shape_audit.py` — the layer above
`health_check.py`. health_check asks "did the file move?", the golden test asks "did the
engine change?"; this asks "does the payload have the shape of a working one?" Catches the
failure class that has cost the most here — a green run that publishes a wrong number.
Checks: no-data flood, phantom predicate (front end compares a field against a value that
never occurs), constant/dead column, orphan column, distribution drift.
- `--only data` runs in `publish.yml` and **gates the publish** (today's numbers can break
  at 03:00 with nobody touching the repo).
- `--only code` runs in `test.yml` on a code push. Deliberately NOT in publish.yml: these
  cannot change between two runs of the same commit, so gating the daily data publish on
  them would let a cosmetic front-end slip block a day of market data.
- `--snapshot output_ma500/signals_YYYY-MM-DD.csv [--baseline <older>]` audits a local
  snapshot; drift needs the baseline.
Thresholds are MEASURED, not picked — 'No data' is 0.0–1.9% on healthy days and was 51.6%
on the 2026-07-25 outage (fail at 5%); the largest legitimate one-day trend shift is
16.2pts (the 07-30 4H geometry fix) against 37/46pts on the outage (warn at 25pts).

**Re-prove the auditor after changing a check:** `python3 tools/shape_audit_replay.py` —
replays the checks against bugs that already happened (07-25 priceless bars, the gauge
pinned at 15, unread `pct_1w`) and asserts BOTH that each is caught AND that 7 healthy days
stay quiet. A monitor written while looking at the incidents it claims to catch is not
evidence until replayed. Local only — it needs `output_ma500/` (gitignored) and real git
history, so it cannot run in CI.

**Run/refresh the backtest:** `cd swing_generator && python3 backtest.py --since 2016-01-01` —
production-parity replay off the parquet cache (no network). Writes `output_ma500/backtest_<date>.json`
(published to R2 as `backtest.json` on the next data publish) and regenerates `confidence_map.json`.
Run it after ANY change to signals.py/config.py signal logic.

**Debug blank chart in modal:** ~~autoSize / requestAnimationFrame~~ — stale, see Important
Rules 2/4/5. Lightweight Charts is gone; modal charts are Chart.js now.

**Data not updating:** CI cron runs 3×/day weekdays (01:35/09:35/14:35 UTC, landing ~1.5h later due to GitHub queue → ~05:00/13:00/18:00 SAST) + 1×/day weekends (08 UTC → 10:00 SAST); ad-hoc runs are manual from the GitHub Actions tab. Stale banner is schedule-agnostic since app.js v231 — it flags `now - summary.fetched_at > 32h`, so publish.yml cron changes need no front-end sync. A FAILED run flips `status.json` on R2 to `state:'failed'` and pushes a failure notification (sw.js checks status.json on every push).

**Update version numbers:** After any UI change, bump `?v=NNN` on `app.js` and/or `style.css` in
`index.html` — there are only TWO now, `utils.js` is gone. A Stop hook
(`.claude/hooks/check_version_bump.py`) warns when one is missed, because the query string is
the only cache-buster: installed phones keep serving the old file until it changes, so a
forgotten bump ships a fix nobody receives while looking deployed from this end.
