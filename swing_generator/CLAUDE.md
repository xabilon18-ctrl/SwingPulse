# SwingPulse — System Context

> Auto-generated from codebase — reflects actual current file state.
> Update this file whenever the architecture, profile, versions, or instruments count changes.

## What is SwingPulse?
A personal swing-trading signal dashboard that scans a watchlist of instruments (indices, commodities, crypto, currencies, US/global equities — the currency pairs were removed 2026-07-11 for worst-class backtest expectancy and RESTORED 2026-08-25 at the user's request, 57 pairs, #742-798). **Vocabulary: the asset class is called `Currency` everywhere** — group, sector, asset_class, Class chip and radar spoke all use that one word (renamed 2026-08-26; it had been a mix of Forex/FX/Currency/Currencies). The only `FX` left is TradingView's `FX:`/`FX_IDC:` exchange prefixes, which are their identifiers, not ours. using a Gann-inspired MA-ribbon system. Results are served as a mobile-first web app.

**Single active profile: MA500** (50, 250, 500 — 3 MAs)

| Item | Value |
|------|-------|
| Live URL | https://swingpulse200.pages.dev |
| R2 data prefix | `ma500/` |
| Instruments | **798** (parsed from `../Instruments.txt`) — 736 + 57 currency pairs (2026-08-25) + 5 Rates (2026-08-29) |
| MA ribbon | MA50 · MA250 · MA500 (3 MAs) |
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
| CI pipeline | GitHub Actions (`publish.yml`) — cron **9×/day weekdays** (01:35, **07:05**, 09:35, 10:35, 13:05, 14:35, 15:35, 17:05, 18:05 UTC) + 1×/day weekends (08 UTC, crypto) + manual. Crons are set EARLY because GitHub queues them **2.8–4.9h** (measured 2026-09-15/16; later UTC hours queue less), so they land ~08:30, **~14:00**, 16:20, 17:10, 19:35, 20:20, 21:05, 22:05, 22:55 SAST. 3→8 runs on 2026-09-15, 9th (midday/European session) added 2026-09-17. |
| Repo | https://github.com/xabilon18-ctrl/SwingPulse — **the only one.** `xabilon18/SwingPulse` was the original prod repo until 2026-06-01 and is now retired: its publish workflow is disabled, it holds no commits this one lacks, and the local `prod` remote was removed 2026-08-27. Manual run: `gh workflow run publish.yml --repo xabilon18-ctrl/SwingPulse --ref main` |

---

## Key Files

```
swing_generator/
├── main.py                    # Signal generator (always runs --profile ma500)
├── config.py                  # MA500 profile: MA50/250/500, thresholds, OUTPUT_COLUMNS
├── _active_config.py          # Thin re-export shim from config.py; ACTIVE_PROFILE='ma500'
├── instruments.py             # Parses ../Instruments.txt → list of {num,ticker,name,group,sector,industry}
├── events.py                  # Scheduled events (earnings/ex-div from yfinance) → events.json
├── output_ma500/              # CSV output files (gitignored)
├── cache_ma500/               # Parquet price cache (gitignored)
├── webapp/
│   ├── server.py              # Local Flask dev server → http://localhost:5050
│   │                          # MA_PERIODS imported from _active_config (MA50/250/500)
│   ├── publish.py             # Build + deploy to R2/Pages (PROFILE='ma500', PAGES_PROJECT='swingpulse200')
│   ├── templates/index.html   # SPA shell — bump BOTH ?v= strings on any UI change
│   └── static/
│       ├── js/app.js          # All frontend logic (v256)
│       └── css/style.css      # All styles (v227; single dark theme)
├── macro_events.py            # FOMC (federalreserve.gov) + FRED release dates
├── tests/macro_events_test.py # Offline parser tests + tests/fixtures/fomc_calendar.html
└── tools/refresh_fomc_fixture.py
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
MA_PERIODS           = [50, 250, 500]            # fast (B2/S2) · mid (B3/S3) · anchor (B4/S4)
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
`10m` (10-minute — CHART ONLY) · `D` (Daily — the only signal timeframe) · `3D` (3-Day — CHART ONLY)

**CURRENT STATE — 4H and Weekly REMOVED, 3D CHART-ONLY (2026-09-24, user decision).** The app is
Daily + the 10m and 3D charts. `config.TIMEFRAMES` is `(('D', ''),)`, OUTPUT_COLUMNS has no `d3_`/`w_`
columns (143 → 59), `tf_alignment` is gone (nothing left to vote against Daily), the 3D/W
sector radars and shape groupings are gone, the ledger stops recording W fires (old records
stay and keep grading), and hourly prices are no longer downloaded. Why: GitHub Free's
2,000 Actions minutes/month — 9 weekday runs cost ~2,550 at ~11 min/run. The resample
helpers, `build_4h/3d/weekly` and the `*_3D/*_WEEKLY` constants stay for backtest.py
research. Drawings saved on the removed charts are kept in the sync store, just not shown.
Everything below about 4H/3D/Weekly/alignment is HISTORY.

**Monthly is a CHART, not a timeframe (2026-09-12).** It exists only in the chart feed
(`chart_feed.build_monthly` → `chart/M/<chunk>.json`) and on the Charts switch. It is NOT in
`config.TIMEFRAMES`, writes no `m_` column, and must never enter `ALIGNMENT_PREFIXES`.
- **One MA, and it has to be one.** `MONTHLY_MA_PERIODS = [50]`. Measured over 200 sampled
  instruments: 98% hold the 50 monthly bars MA50 needs; **0%** hold 250 or 500 (that is ~21
  and ~42 YEARS, against a cache whose median is 244 monthly bars). MA250/MA500 would be
  blank on every instrument, so this is a data limit, not a style choice.
- **Published depth is ~158 bars, not 244.** The 244-month figure above is a long-lived
  LOCAL cache; CI fetches `HISTORY_YEARS = 13`, so the live feed carries ~158 monthly bars
  (from 2013-07) and about 108 usable months — ~9 years of drawn chart once MA50 has warmed
  up. Verified on R2 2026-09-12. Don't quote the local number as what the app shows; it only
  strengthens the MA250/MA500 conclusion.
- **It is the one builder that ignores `MIN_RIBBON_LINES`** — that floor rejects a ribbon too
  short to be worth drawing, and would reject a deliberately single-line chart instead. An
  instrument without 50 monthly bars still gets no monthly chart.
- **The in-progress month is dropped** (`main._resample_monthly`, Important Rule 10 again),
  so mid-month the monthly chart shows the last CLOSED month and does not move. Verified:
  every bundle ends 2026-08-31 when built on 2026-09-12.
- **No signals, ever.** With one MA `add_signals` collapses (`_ma500`/`_ma250`/`_ma25` all
  become 50) so B2/B3/B4 and S2/S3/S4 are structurally dead, and the monthly MA50 state
  measured CONTRARIAN per-instrument (12m −4.60pp, only 36% of instruments positive). See
  the Monthly MA50 memory.

**The 4H CHART is back (2026-09-17, user request) — chart only.** It is the 10m
arrangement exactly: `chart_feed.build_4h` → `chart/4H/<chunk>.json`, a `chartOnly: true`
row in app.js `TIMEFRAMES`, a button on the Charts switch (10m · 4H · Daily · 3D · Weekly),
and **no signals** — 4H is still out of `config.TIMEFRAMES`, writes no `h4_` column, and
must never enter `ALIGNMENT_PREFIXES`. The 2026-09-11 finding that removed its signals
still stands (71.7% agreement with Daily, 82% of its fires unconfirmed and worth ~0); what
came back is the picture, not the edge.
- **`main.py` downloads hourly prices again**, under the same `--no-intraday` flag as the
  5m pull, at data_fetcher's default freshness gate (1h in CI — a 4-hour bar cannot move
  more than a 1h-stale cache already shows). The fetch is incremental, so the gap since
  2026-09-11 fills itself on the first run.
- **NOT restored with it:** the daily-vs-hourly cross-check (`data_checks.json`, its route
  and its publish entries), the crypto daily-gap fill from the hourly feed, the 1H chart
  (`build_1h` is still in the file, still unwired), and 4H in `SHAPE_TIMEFRAMES`.
- **Its calendar grid is HALF-YEARS since 2026-09-19** (was quarters; `REEL_TIME_GRID`, which kept the 4H entry through the
  removal), against years on Daily and administrations on 3D/W. The card opens on
  `REEL_DEFAULT_WINDOW_BARS` (520) as it always did — ~1 year on a 2-bars-per-session
  equity, ~1 quarter on a 6-bars-per-day 24h contract, which is why the quarter line is the
  sparse one on both.
- **Ribbon periods are per-instrument** (`_h4_ma_periods`, `H4_SESSION_NORMALIZE`) and the
  hourly cache is keyed by the SOURCE ticker (`h4_ticker`, `H4_SOURCE`) — see §4H bar
  geometry below. Both survived the removal untouched.

**1H and 4H REMOVED ENTIRELY (2026-09-11, user decision).** Not in `config.TIMEFRAMES`,
not in the chart feed, not on the Charts switch (D · 3D · W), and `main.py` no longer
downloads hourly prices — which also retired the daily-vs-hourly price check and the
crypto daily-gap fill from the hourly feed. The signal log stopped recording 4H fires
(old records stay). `tf_alignment` is now Daily + Weekly, scored -2..+2. The hourly
parquet files still sit in the caches (local research, e.g. the queued wave study).
The paragraph below is the earlier same-day step.

**Signals on Daily and Weekly only (2026-09-11).** 1H no longer runs the signal
engine — it is gone from `config.TIMEFRAMES` and OUTPUT_COLUMNS (its signals scored
−0.006R against random entries taken the same day, n=13,309, on only ~2 years of
hourly data). The 1H CHART still ships, from `chart_feed.build_1h`. 4H and 3D still
compute signals (ledger, research), but the app treats 1H/4H/3D as CHART VIEWS:
`SIGNAL_TFS` / `TAB_TFS` in app.js give Dashboard/Signals/Analyzed a Daily|Weekly
switch, Charts all five, Trends Daily (it used to relabel itself "Daily" while every
badge and price stayed 4H). Charts and the signal tabs remember their timeframe
separately (`swingpulse-chart-tf` / `swingpulse-tf`); the app opens on Daily; a sheet
opened from a chart view renders on the signal timeframe via `withSignalTf()`, which
is only safe around SYNCHRONOUS code.

The table lives in ONE place — `config.TIMEFRAMES` (Python) and `TIMEFRAMES` at the top of
`app.js` (browser). Both are ordered fast to slow and carry every per-timeframe fact:
prefix, label, TradingView interval, the word for one bar. Before Weekly landed
(2026-09-02) the pair `('', 'h4_')` was hand-copied in four Python places and ~12 JS
ternaries of the shape `timeframe === '4H' ? a : b` — a shape that silently answers
"Daily" for any third timeframe. Loop the table; never restate the pair.

**3-Day bar geometry (2026-09-08).** Same MA50-MA500 ribbon on 3-day bars, unscaled —
three business days are three business days on every venue. It exists to fill the gap
between Daily and Weekly:
- **MA500 spans ~6.0 years** (Daily ~2.0, Weekly ~9.6). The app used to jump from a
  2-year view straight to a 9.6-year one with nothing in between. A 520-bar chart card
  shows ~6 years.
- **It is NOT an independent read, and must not be sold as one.** Measured over 183
  instruments / 270,371 bars: the 3D trend label agrees with Daily **66.5%** of the time
  and opposes it on 0.9% (Weekly 54.3% / 2.3%; 4H 71.7%). More distinct than 4H — which
  was demoted to confirmation for exactly this reason — and markedly less distinct than
  Weekly. Ship it for the 6-year middle view, not for disagreement.
- **A calmer feed**: 42 fires per instrument against Daily's 187 (Weekly 17).
- **Bars are 3 BUSINESS DAYS FROM A FIXED EPOCH** (`config.THREE_DAY_EPOCH`), not
  `resample('3D')` and not "every 3 rows". Calendar binning rotates the window through the
  week; row-grouping re-phases every historical bar the moment the cache start moves, and
  it does move. Epoch-anchored counting is stable under any refetch — verified: shifting
  the frame start left 1,710 shared bars byte-identical. **Never change the epoch.**
- **The in-progress bar is dropped** (`main._resample_3d`), Important Rule 10 again. Bars
  are labelled by their group's closing business day, as a weekly bar is by its Friday.
- **3D does NOT vote in `tf_alignment`** — same two reasons as 1H: it is the daily frame
  sampled twice (66.5% agreement), and adding it would silently widen the score from
  -3..+3 to -4..+4 under every consumer that draws a bar from it.
- `REFIRE_PCT_3D = 0.065` / `SIGNAL_LOOKBACK_3D = 10` are **UNTUNED** — interpolated
  between Daily and Weekly. Sweep them.
- Radar: 3D has its own (`sector_radar_3d.json`, 20-period baseline). Like Weekly it does
  **not** write `instrument_flavours.json` — that layer was validated on Daily only.

**Weekly bar geometry (2026-09-02).** Same MA50-MA500 ribbon, run on weekly bars, unscaled
— a week is a week on every venue, so the 4H session problem has no weekly analogue. What
that buys, and what it costs:
- **MA500 spans ~9.6 years** (Daily's spans ~24 months, an equity's 4H ~12 months), so
  Weekly is a genuinely different scale where 4H is a half-length Daily.
- **Warmup eats half the history.** 500 weekly bars must exist before MA500 does. Median
  instrument holds 1052 weekly bars → ~552 usable (≈11 years); 82.1% of 808 reach 500 at
  all. BTC-USD has 621 weekly bars → ~122 usable.
- **Fires are rare, deliberately** — 6-31 per instrument over ~11 usable years (AAPL 6,
  ^GSPC 7, GC=F 31). 13,146 weekly trades in the full backtest vs 92,879 Daily.
- **The in-progress week is dropped** (`main._resample_weekly`), so mid-week the weekly
  timeframe shows the LAST CLOSED week and does not move. Without it a weekly B2 fired on
  Tuesday could be gone by Friday — the signal would repaint four days in five. This is
  Important Rule 10 applied to a third timeframe. Weeks end Friday (`W-FRI`) and are
  labelled by that Friday; `w_date` names the week being shown.
- `REFIRE_PCT_WEEKLY = 0.08` is **UNTUNED** — Daily's 0.05 scaled by sqrt(5). Sweep it.
- **Measured against a random-entry control** (52,334 weekly control trades): weekly longs
  +0.187R vs random +0.174R → **edge +0.013R**, where Daily longs score −0.021R. So Weekly
  is the first timeframe whose entries beat a dart at all — but the margin is small, and
  the 13-week hold costs ~0.09-0.135R in financing that the backtest still does not model.
  Weekly SELLS are worse than random (−0.063R). Best cells: `W|B3|Equity` +0.061 over
  random (n=2,315) and `W|B4|Equity` +0.111 (n=586) — deep pullbacks again.

**4H bars are anchored to the SESSION OPEN, not to the clock (2026-09-17).**
`_resample_4h` groups four hours forward from each session's own first bar. It used to
bucket from midnight UTC, which made the bar count per session depend on where the session
fell against the UTC grid — and a US session moves against that grid twice a year, so
14:30-21:00 (winter) straddled THREE buckets and 13:30-20:00 (summer) two. Measured on the
AAPL/AVGO caches: **2026Q1 held 166 four-hour bars against 2026Q2's 124**, a 34% swing with
no market event behind it, which on a bar-indexed x-axis drew Q1 34% wider than Q2 and made
the chart's calendar lines impossible to space evenly. It stretched the ribbon too — MA500
covered fewer calendar days across a winter than across a summer.
- **After: 2.00 bars/session year-round** for a US equity (EU indices 3.00, Tokyo ~2, crypto
  6.00 — all exact integers now, which is the tell that the geometry is uniform). Quarters
  come out 126 / 122 / 124 bars instead of 121 / 166 / 124.
- **A 24h instrument is unaffected in principle** — its session opens at 00:00, so the
  groups land on the same clock buckets. In practice a handful of week-open sessions differ
  (futures and forex open Sunday 22:00/23:00 UTC, not midnight): BTC 3 sessions of 816,
  NQ=F 123 of 645 relabelled, and **zero** close-price changes on shared bars.
- **Bucketing is by ELAPSED TIME from the open, not by counting bars into the session.**
  Counting re-phases the whole rest of a day when one hourly bar is missing — the first cut
  did exactly that and silently changed BTC's contents while keeping its bar count.
- **The golden snapshot was refreshed for this** (35 frames, 909 → 884 fires). Only `4H`
  frames moved; every Daily and Weekly frame is byte-identical, which is the check that the
  signal engine itself did not change. 4H carries no signals in production, so nothing the
  app reads depends on those fires.

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
  (`main._h4_ma_periods()`): MA25–MA250 for EU, MA17–MA167 for 2/session.
**Daily is untouched** and individual equities are deliberately left alone — a US stock
really does trade 6.5h, so its 4H is ~2 bars/session everywhere. See SIGNAL_RULES.md §1.

### Column Prefix Convention
| Timeframe | Prefix |
|-----------|--------|
| Daily     | *(none)* — e.g. `primary_signal` |
| 1-Hour    | `h1_`  — e.g. `h1_primary_signal` |
| 4-Hour    | `h4_`  — e.g. `h4_primary_signal` |
| 3-Day     | `d3_`  — e.g. `d3_primary_signal` |
| Weekly    | `w_`   — e.g. `w_primary_signal` |

In `app.js` the `f(field)` helper applies the active prefix.  
**Exception (corrected 2026-08-17):** pass the UNPREFIXED name — `f('volume_spike_flag')` —
and let f() pick the timeframe, exactly as for any other column. Only an already-prefixed
name is forbidden: `f('h4_volume_spike_flag')` double-prefixes and silently reads
undefined. See Important Rule 1 for the measurement behind this.

### Signal Types (B = buy, S = sell — see signals.py, full rules in SIGNAL_RULES.md)
- **B1/S1** — Trend reversal: price crosses above (B1) / below (S1) **all** MAs from a non-trending state (anchor-gated); re-fires near MA500 within `refire_pct` for 10 days
- **B2/S2** — Pullback recovery: dipped below MA50 in-trend, closed back above (mirror for S2)
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
Gated on `config.INTRADAY_PREFIXES`, **not** on "does it have a prefix" — those meant the
same thing only while 4H was the sole prefixed timeframe. A weekly bar IS its week-ending
date, so Weekly carries no `datetime`, exactly like Daily.

`h4_datetime` — the exact 4H bar timestamp (2026-07-27). `h4_date` alone is ambiguous:
a date holds 2–6 four-hour bars, and the ledger resolved a 4H fire to the LAST bar of
that date, which (runs land midday) is typically 1–5 bars after the bar that fired — so
every graded 4H trade was entered up to a session late. Emitted only when a prefix is
set (`main.py _extract_row`); daily bars are unique by date.

### Daily-only Fields
`ma_fast_cross_count`, `neutral_oscillation`, `new_trend_flag`,  
`pct_1d`, `pct_1y`,  
`key_level_price`, `key_level_type`, `key_level_date`, `key_level_touch_count`, `key_level_touched_today`, `key_levels_all` (live since 2026-07-09 — computed by key_levels.py on the last 1500 daily bars)

### Dead columns (kept for payload compatibility, always empty)
`watch_flag`, `potential_turning_point_flag` — their UI (Analyzed alert tabs, counters) was removed 2026-07-09.

---

## Frontend App Tabs
1. **Dashboard** — Market gauge, stat cards, signal feed, alignment summary
2. **Scanner** — Instrument grid with filters: class (incl. **Rates**, see `browseClassOf`), group, sector, trend, alignment, confidence, signal codes, key levels, vol spikes, **scheduled events** (`#eventChip`)
3. **Analyzed** — Instruments the user has technically analyzed (star = "I analyzed this") + alert sub-tabs (turning points, watch flags, key levels, vol). Pane id is still `pane-watchlist` and storage key is still `swingpulse-starred` — only the UI label changed.
4. **Trends** — Trend history per instrument (timeline, stats, maturity)

> Note: **Portfolio** tab was in the old CLAUDE.md but is not present in the current `index.html` nav. The `/api/portfolio` endpoint this file used to describe **does not exist** — there is no such route in `server.py` and no such call in `app.js` (checked 2026-08-30). Nothing fetches XM positions.
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
| `/api/events` | `{generated_at, window, sources, events:[…]}` — earnings/ex-dividend/macro dates. An **equity row** carries `instrument` (a name that resolves in signals.json); a **macro row** carries `title` and NO instrument. Consumers test for `instrument`, never for `type`. `sources` is `{earnings, fomc, fred, speeches}` — one flag per feed, each set by the fetcher that names it |
| `/events.ics` | The same feed as a subscribable calendar (`text/calendar`). Served locally since 2026-08-30; built by `publish.build_ics()`, which is the **only** place an event is given a calendar title |
| `/api/shape-similarity` | `{neighbours, families, family_of, window_bars}` — which charts look alike, from `shape_similarity.py`. Written GZIPPED under a plain `.json` name (43 KB vs 236 KB); `upload_to_r2` detects the magic bytes and sets `Content-Encoding` |
| `/api/flow` | Capital flow data for a group/region/period |
| `/api/backtest` | Latest backtest results (overall, by_signal, by_tf, by_class, by_instrument, equity_curve, params) |
| `/api/refresh` | POST — triggers a fresh data reload on the server |

---

## Event Calendar (2026-08-29)

`events.py` fetches earnings + ex-dividend dates for the **equity** rows only
(an index/currency/commodity/coin has none) via `yfinance Ticker.calendar`, one
metadata call per ticker at 8 workers (~0.1s each). Written to `events.json`,
windowed −7/+120 days, and turned into a subscribable `events.ics` by
`publish.build_ics()`. Both upload to R2; `_content_type_for()` serves the .ics
as `text/calendar` — as `application/json` iOS silently ignores a `webcal://`
subscription.

**No time-of-day on an earnings row, deliberately.** `Ticker.calendar` returns a
bare date for every ticker (measured: 0 of 542 carried a time). The endpoint that
does — `get_earnings_dates` — costs 0.42s/ticker vs 0.10s and populates it for US
listings only, so the field would render on some rows and not others.

**Macro dates DO ship (since 2026-08-29 / commit 3f0bfaf).** The old rule was
"empty on purpose, and if ever filled, fill it from a re-fetchable source, never
by hand" — that condition was met, not waived. `macro_events.py` carries two
feeds, both official and both re-fetchable:
- **FOMC** — federalreserve.gov's own calendar page. No key. Dated the LAST day
  of the meeting, because that is when the statement lands. Live.
- **FRED** (CPI / PCE / payrolls / GDP) — needs a free `FRED_API_KEY`. Wired into
  `publish.yml` as an optional secret; unset is supported (returns `[]`, prints
  why, FOMC still ships) and the calendar says so out loud.
- **Speeches** — still absent and probably permanently: the Fed's speech feed
  publishes at DELIVERY, not in advance.

**Each source reports on ITSELF.** `sources` is `{earnings, fomc, fred, speeches}`,
one flag per feed set by that feed's own fetcher. It used to be a single `macro`
flag derived from the combined list, so a FRED-only result (Fed page down, key
present) made `calGapNote()` announce "FOMC dates are included, from the Fed's own
calendar" over a month holding none. A flag derived from a different source than
the one it names is worse than no flag.

**A macro row carries `title`, not `instrument`** (2026-08-30). Everywhere else in
the payload `instrument` is a name that resolves in signals.json and opens a card;
a rate decision has no card. Putting the event name in that field forced every
consumer to branch on `type` before it could trust the value, and blocked the
calendar's day rows from being clickable. The rule now: **a row is clickable
exactly when `instrument` is set.**

**The FOMC parser is tested** — `tests/macro_events_test.py`, offline, against a
trimmed copy of the real page in `tests/fixtures/fomc_calendar.html`. It is
regexes over someone else's HTML and it fails SILENTLY (zero rows reads as "no
meetings scheduled"), so it runs in both `test.yml` and `publish.yml`. Refresh the
fixture with `tools/refresh_fomc_fixture.py` and READ THE DIFF — half the rows use
`fomc-meeting--shaded fomc-meeting__month`, i.e. the class is not first in the
attribute, and a capture that drops that variant tests half the page while looking
complete. `tools/shape_audit.py --only data` also gates the publish on the feed
being alive and on `sources` not claiming a feed the payload cannot show.

### Front end

The bell is a **calendar glyph** with two segments — `Today` (daily signal list)
and `Calendar` (month grid, ‹ › or swipe to a neighbouring month, tap a day for
its sheet). A `#eventBanner` sits between `#staleBanner` and
`#marketStateBanner`: the caveat stack reads "can I trust this data" → "what is
coming" → "what are conditions".

**The calendar is not a tab, it is a dimension** (2026-08-30). Until then
`eventsData` was read by the dropdown and the banner and by nothing else — 700
scheduled dates that the screen you actually decide on never mentioned. The
joins:

| Surface | What it shows |
|---------|---------------|
| Instrument modal | `modalEventHtml()` — this instrument's next event AND the next market-wide one, as sentences. Both open the calendar on that date |
| Scanner / Analyzed / Trends cards | `eventChipHtml()` — one chip definition. Instrument-specific only: a rate decision hits all 798 rows, so it belongs to the banner, not to 798 identical chips |
| Scanner filter | `#eventChip`, cycling off → **Event ≤7d** → **No event**. Both directions matter — "what is about to gap" and "what can I hold with nothing scheduled in it" |
| Dashboard banner | A rate decision gets a **Rates board →** action (`openRatesBoard`). "Rate-sensitive instruments first" was advice with nowhere to go |
| Push (`sw.js`) | `notifyUpcomingEvents()` warns the evening before, for starred names + every macro row. Before this the calendar could only warn you if you happened to open the app — the exact failure it was built to prevent |
| Ledger | `signal_ledger._event_in_window()` tags each fire with a scheduled event inside its holding window. **Recorded, not yet reported** — no split by it until a cohort matures, same rule as the Track Record |

Two counts on the bell, never one sum: `data-count` (gold, fired today) and
`data-events` (violet pip, scheduled inside `EVENT_BANNER_DAYS`). Summing them
produced "137" on a busy day and belonged to neither segment. The segment labels
carry the same two numbers. `upcomingEvents()` is **starred-scoped** once you
have a list, so an empty violet pip beside a full calendar is correct, not a bug.

**Days are TRADING days** — `tradingDaysUntil()`, weekends only (a per-exchange
holiday table would go stale silently, the same bar macro dates had to clear).
A Monday event is one session away on a Friday, not three. `sw.js` deliberately
does NOT copy this: it uses "today or tomorrow" in calendar days, because an
earnings or FOMC date never falls on a weekend and a second copy of the rule in
a file that cannot import from `app.js` is how duplicate definitions start.

Dates are formatted with `ymd()`, **not** `toISOString()` — the latter converts
to UTC first and lands a day early for SAST before 02:00.

**One .ics builder.** `publish.build_ics()` names every event; `app.js
downloadIcs()` FETCHES that feed and slices the day out of it rather than
composing its own. It used to compose, and the two drifted the moment macro rows
arrived — subscribing gave you "FOMC decision", the day download gave you "FOMC
decision — macro". No local fallback on a failed fetch, on purpose: a second
builder is the bug.

---

## Cost line and price-feed check (2026-09-11)

- **`{p}atr_pct`** ships for every timeframe: ATR(14) as % of close from `main._atr_pct`, which
  is `backtest._add_atr`'s definition exactly (checked to within 0.0005pp on AAPL, GC=F,
  BTC-USD, VOD.L, ^GSPC). The card doubles it into the 2×ATR stop.
- **RETIRED the same day with hourly data.** `data_checks.json` (main.py step 2b) flagged an
  instrument when its daily close and the last hourly close of the same date differ by >3% on
  10+ of the last 60 shared dates. Skips crypto, SPAIN35, futures (`=F` — the daily bar is the
  settlement; the first run flagged six futures and nothing else) and H4_SOURCE redirects.
  It does NOT catch unadjusted splits — both caches carry them alike; `_history_mismatch` does.
  In `health_check.py` TIMESTAMPED.

## Sector rotation wheel + market ranking (2026-09-11)

`rotation.py`, run by `main.py` step 5d-ter (isolated; a failure costs the card, not the
signals). Two files: **`rotation.json`** (rebuilt every run: wheel, ranking, thermometer)
and **`rotation_paper.json`** (ACCUMULATES; R2 is its source of truth — loaded from R2
first and NOT saved when R2 cannot be read, because a fresh file over an unreadable one
restarts the track record). Both are in `health_check.py` TIMESTAMPED.

- **Wheel** — 14 radar sectors (>=12 members, currencies/rates out), weekly on closed
  weeks: strength = relative line vs the average sector minus its 10-week average;
  direction = change in strength over 4 weeks; zones Leading/Weakening/Lagging/Improving.
  **Descriptive only — never labelled "next".** Tested before building: Improving reached
  Leading within 4 weeks 57% / 62% (before/after 2022) vs 38% / 42%, but the "next in
  line" pick trailed the average sector in 22 of 24 setting x period cells, and the order
  of leaders did not repeat (1 of 19).
- **Market ranking** — top 20 by 12-month-minus-last-month return / 1-year volatility,
  max 2 per radar sector; names with a >3x one-bar jump in the last year (unit changes,
  e.g. SBK.JO) sit out. The one ranking that beat an equal-weight basket before AND after
  2022 in testing (capped top 20: +23.5%/yr net vs +6.4% since 2022; lumpy).
- **Paper record** — those 20 at equal weight, re-ranked every 20 trading days, marked
  FORWARD only (never backfilled). Financing 0.02%/calendar day on it and the basket;
  spread on turnover. Idempotent per day: later runs recompute today's point.

## Sync: the starred list can no longer be wiped (2026-08-29)

`syncPushNow()` used to send `starred: [...userStarred]` with no empty-guard and
the Worker did a blind `USER_DATA.put(user, body)` — one KV key, no history. Any
device that came up with an empty list (evicted iOS PWA, fresh install, a pull
that had not landed) destroyed the list for every device the moment the user
starred one thing or edited one note. Three guards now:

1. **Client omits the key.** `syncPushNow(intentional)` includes `starred` only
   when the list is non-empty OR the user just tapped a star. A note edit never
   carries the starred list as collateral.
2. **Worker merges, not replaces.** An absent `starred` key keeps what is stored.
   An empty one over a populated list returns **409** unless `?allowEmpty=1`,
   which only a deliberate unstar sends.
3. **One generation of history.** The previous blob is copied to `<user>:prev`
   before every write; `GET /sync/backup?user=` reads it back.

`syncApplyRemote()` also refuses to replace a populated local list with an empty
remote one.

> The Worker must be deployed for guards 2 and 3 to exist:
> `cd swing_generator/webapp/sync-worker && npx wrangler deploy`

---

## Manual data run from the app (2026-08-30)

A **Run now** button starts the CI pipeline — the same `workflow_dispatch` as
the Actions tab. Two homes, one handler and one state (`[data-run-btn]`): on the
**stale banner**, where the complaint is, and in the **Alerts & calendar panel**,
for a run when the banner is not up.

Why it exists: `#refreshBtn` re-downloads what CI last PUBLISHED. When the stale
banner is up that is exactly the wrong thing — it fetches the same stale file and
looks like it worked.

**No GitHub token is in app.js and none can be.** The bundle is public; a
credential in it is readable by anyone who opens the site, which is the mistake
the old hard-coded `SYNC_SECRET` made. The browser proves only WHO it is, with
the same per-user bearer sync uses. The token is a Worker secret:

```bash
cd swing_generator/webapp/sync-worker && npx wrangler secret put GH_TOKEN
# fine-grained PAT, xabilon18-ctrl/SwingPulse ONLY, Actions: read and write
npx wrangler deploy
```

Worker routes (`sync-worker/src/index.js`): `POST /run` (authorize → cooldown →
already-running check → GitHub dispatch) and `GET /run/status` (latest run, for
the button's queued → running → done). Unset `GH_TOKEN` returns **501** and the
app names the missing thing rather than sending you to check your password.

**The outcome persists; the button state does not.** `#runStatusLine` in the
run row reads "✓ Manual run succeeded · 12 min ago" / "✕ Manual run failure ·
35 min ago", coloured `--buy`/`--sell` (semantic, not the accent). The button
alone could not answer "did it work" — it flashed "Done — loading" and returned
to idle, so ten minutes later the screen looked identical whether the run had
succeeded, failed, or never started, and a run is the one thing here you start
and walk away from. `event` distinguishes a manual run from a cron, which is
what you are actually asking when you ask whether YOUR run worked. Refreshed on
every panel open, not just page load.

**Signed out, the button opens the sign-in** rather than saying "Sign in first"
and sitting there — it named the problem and offered no way to act on it, which
is the same complaint as an affordance nobody can find. Straight to the password
step if a user is already chosen, the picker if not. NB the picker's "Who are
you?" step IS the sign-in; the only other way in is the name chip in the header
(`#syncUserBadge`).

**Two guards that matter.** `RUN_COOLDOWN_MS` (10 min, just over a run) plus a
409 when a run is already in flight — the pipeline is not re-entrant and two
runs would race on the same R2 keys and on the accumulating files (ledger,
sector activity). And on the client, `watchRun(since)`: GitHub's dispatch
returns 204 with no run id and the run does not appear immediately, so the first
poll returns the PREVIOUS run — completed, successful. Without the since-guard
the button flashed "Done — loading", reloaded, and reported the last cron's
result as if it were yours. Any run that began before we asked is somebody
else's.

**What it does NOT do, and the UI says so.** `data_fetcher._is_fresh()` gates
downloads at 20 hours, so a run started within 20h of the last download does not
re-fetch prices — it recomputes from cache and completes with identical signals.
Useful after a failed run or a code change; not a "get fresh prices now" button.
That gate is load-bearing for the finished-sessions rule (Important Rule 10), so
this works around it by being honest rather than by forcing a download.

---

## Cloudflare Config
- **R2 bucket public URL:** `https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev`
- **R2 data path:** `https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev/ma500/`
- **Pages URL:** `https://swingpulse200.pages.dev` (Cloudflare Pages project: `swingpulse200`)
- UI (index.html + static assets) deployed to Pages; data files uploaded to R2 `ma500/` prefix
- `signals.json`, `trends.json` and `backtest.json` are written **gzipped under their plain names** (2026-09-11: 4.59+1.47+1.81 MB → 0.61+0.26+0.26 MB); `upload_to_r2` sets `Content-Encoding: gzip`. Browsers and iOS decode it; a Python reader must gunzip (`tools/shape_audit.py` and `tools/health_check.py` do). `summary.json` is deliberately left plain — `publish-watchdog.yml` curls it. `summary.json` buy/sell counts and `explanations.json` are Daily-based since the same date (were 4H).

---

## Current Versions

> **This section had drifted 18 versions behind the code** (it said v237/v214
> while index.html served v255/v226) and the Event Calendar section above
> described a state the previous commit had already replaced. If you change the
> front end, change the number here in the same edit — this file is loaded into
> context at the start of every session, so a stale line here is a wrong premise
> for everything that follows.

- `app.js` — **v359** (v359 — the drawing batch's clock goes **30s → 4 HOURS** (`SYNC_DRAW_HOLD_MS`), user's call: they work phone-only, where `visibilitychange`→hidden fires on every swipe-away, so the FLUSHES are what save and the clock is only a backstop for a session left open for hours. A reload throws the pending timer away, so `channelSave` now sets a dirty marker (`sp-draw-dirty`, namespaced) and `syncCatchUpDrawings()` sends one catch-up push at start when it is set; any push clears it. Measured: 2 edits → 0 writes, 1 on swipe-away with keepalive, and a killed session pushes once on restart. v358 — **drawing saves are BATCHED** (`syncPushDrawings`, `SYNC_DRAW_HOLD_MS = 30000`). Cloudflare blocked KV writes on 2026-09-19: the free tier is 1,000 puts/day and every sync save costs TWO (the blob + its `:prev` backup), while `channelSave` fired on every finished drag, colour tap, lock, bold, add and delete — hundreds in a chart session. Drawings now ride a 30s THROTTLE (not a debounce: a debounce keeps slipping while you draw), flushed on leaving the Charts tab (`doTabSwitch`), on `visibilitychange`→hidden and on `pagehide`, the last two with `keepalive` and skipping the merge-read (`syncPushNow(intentional, quick)`) because a closing page kills an in-flight read. Stars and notes are unchanged at 800ms. Measured: 6 edits → 0 writes, one save at exactly 30s, one on tab switch. Nothing is at risk while the clock runs — `channelSave` writes localStorage synchronously; only the OTHER device waits. **Data runs never write KV** (the push fan-out only lists and reads), so cutting a cron does nothing for this limit. v357 — **vertical line drawing tool** (`kind: 'vline'`, stored `{t}` — a DATE, so it lands on the same moment on every timeframe; date printed at the top, one handle drags it bar by bar) and a **Bold switch on horizontal and vertical lines** (`DRAW_BOLDABLE` = entry/hline/vline; `.reel-ch-edge.is-bold` in style.css v289). Tool row fits 390px. v356 — **10m OPENS on one calendar month and 4H on one calendar year, on every switch** (user, 2026-09-19), via `reelDefaultBars` / `reelBarsInSpan`, measured off each bundle's timestamps. Reverses the 120-bar 10m window (v344) by the user's explicit call — a month of 10m is sub-pixel candles on 24h instruments; zoom in to read them. 10m zoom-out cap stays a month + 10 days. v355 — **10m zooms out to exactly ONE MONTH AND TEN DAYS** (`reelMaxBars`, `REEL_TEN_MIN_MAX_SPAN`), measured off the bundle's timestamps, and the zoom override is cleared at the timeframe's OWN default (`reelDefaultBars`) — it compared against 520 everywhere, so zooming 10m out past 520 bars snapped it back to 120. **4H carries up to 2,190 bars** (`chart_feed.BARS_BY_TF['4H']`, was 520 = the window, so there was nothing to pan back into); opens on 520 as before; an equity ships its whole ~1,120-bar hourly cache and its oldest ~500 bars carry no MA500. Data change — lands on the next CI run. v354 — **10m grid is MONTH lines only** (user call 2026-09-19, over the day lines of v344): lines on the first bar of each month plus two projected months ahead (`REEL_FUTURE_MONTHS`); the 120-bar window stays, so a month line shows when you pan or zoom to the 1st, and the axis end-stops carry weekday, day, month and time ("Thu 17 Sept 14:30"). **4H grid is the year cut into TWO equal parts** (`REEL_YEAR_PARTS`, mode `'half'`), labelled "Jan 2026" / "Jul 2026" — same bar-measured construction as the v351 quarters. v351 — three fixes to the 4H grid and the seeded channels, all from the user's own chart. (1) **The quarter grid is A YEAR CUT INTO FOUR EQUAL PARTS**, not the calendar's quarters: `reelTimeGrid` takes the two 1-January boundaries around each year, measures the gap IN BARS and drops three lines at its exact quarter points. Calendar quarters cannot land evenly however the bars are fixed — Q1 is 90 days with three US holidays in it, Q4 is 92 with two — and the eye reads that as a mistake. Measured after: gaps of 249.1 and 249.1 viewBox units, against 206/200/203 before. A line now sits within a day or two of the calendar quarter, which is why the labels name the MONTH rather than claiming a Q. The separate future-quarter projection and `REEL_FUTURE_QUARTERS` are gone — the year division emits its own projected lines. (2) **Seeded channels are BOUNDED to their leg** (`clipL`/`clipR` on the drawing, honoured by `reelChannelSvg`): two auto channels at full panel width put six long dotted lines across the price in the ribbon's own ink. The developing one still runs to the right edge — where a trend projects is the point of it. Hand-drawn channels carry neither flag and are unchanged. (3) **The rails hold the RIBBON as well as the bars** — highs and lows alone left MA500 outside the channel (measured: rail at 63.85 while MA500 ran near 55). The cost is stated: on ALL_AX 4H the up channel is 29.75 wide against a 22.74 visible range, because MA500 lags ~15 points behind price in that rally. v349 — **the two seeded channels are fitted to the SWING LEGS**, not to slices of the window: one on the developing trend, one on the trend before it, which is how the user draws them (read off their own ALL_AX 4H chart, 2026-09-18). `reelSwingLegs` takes the window's highest high and lowest low as the boundary and then asks ONE question — has the move since that last extreme given back **half** of the leg before it (`RETRACE_NEW_LEG`)? Measured on the bundles the user had drawn on: ALL_AX 30%, GOLD 44%, BTCUSD 21% → pullback, the leg still stands; US100 60% → a new leg, and it is the one running. A ZIGZAG WAS TRIED FIRST AND WAS WRONG: at any threshold tight enough to be useful it broke ALL_AX's rise in two at the August high, which is exactly what the user had not done. The daily trend regime was wrong for the opposite reason — BTCUSD reads DOWNTREND since Nov 2025 while its 4H window is a 22k rally (the established_trend latch). `reelChannelForLeg` fits each leg a least-squares spine through its closes and pushes the edges out to the furthest high above and low below, so the leg sits inside its own channel; anchors are stored at the leg's own ends and the renderer extends the lines across the panel. Verified on ALL_AX 4H: developing UP 18 Mar 44.65 → 5 Aug 66.60, previous DOWN 11 Nov 60.06 → 18 Mar — the user's two channels. v348 — **every chart opens with TWO channels, on every timeframe** (user request). `reelSeedChannels` fits one to the whole window and one to its last third — two built the same way would sit exactly on top of each other, one drawing wearing two outlines. They are NOT in the store: a chart you merely scrolled past must not write drawings, because that store syncs to every device and every write to it is an undo step. `channelSeeds` (in memory) holds them, `channelsFor` falls back to it, and they are COMMITTED BY REFERENCE the moment the chart is edited — `setActiveIdx` covers every drag and tap, and the props-row dispatcher commits on `DRAW_MUTATING_ACTS` before running the action. That second path is not belt-and-braces: without it Delete silently did nothing (`clearChannelFor` returns early on a chart with no stored list), a colour or lock was written to an object nothing saves, and adding a drawing built the stored list from scratch and took both seeded channels off the chart. **An empty stored list now means "deliberately cleared"** and no longer seeds — `clearChannelFor` leaves the key behind, `expandChannelStore` keeps empty arrays it used to drop, and the sync merge applies an empty remote list instead of deleting the key. Verified: 2 channels on every painted card on D/4H/W, `sp-channels` absent after scrolling the reel, a drag committing both, delete stepping 2→1→0 and surviving a reload. v347 — quarter grid labels are MONTHS, not Q-names: `reelQuarterLabel` prints "Jan 2026" where it printed "Q1 2026". The line marks one of the four equal parts of the calendar year and the month it starts on is what a date is read against; "Q1" also reads as a FISCAL quarter, which these are not. **NB the lines are not equally spaced on screen, and the grid is not why.** Measured on the AAPL/AVGO 4H bundle: 2025Q4 121 bars, 2026Q1 **166**, 2026Q2 124 — a 34% swing, because 4H buckets are anchored to midnight UTC while a US session moves with DST. 14:30-21:00 UTC (winter) straddles THREE buckets and 13:30-20:00 (summer) straddles two, so the same 6.5h session is 3 bars or 2 depending on the month. Equal gaps need session-anchored bars (a 4H bar = half a session), which would also stop those candles matching TradingView's 4H — not done, see the h4-bar-geometry note. v346 — **the 4H quarter grid projects into the blank space, the way Daily's year grid does.** `REEL_FUTURE_QUARTERS` (2) puts the next quarter lines out past the last bar, so a channel drawn into the empty right-hand side has a date against it — Q4 2026 and Q1 2027 on today's AVGO. Projected the DAY branch's way, off the whole bundle's average ms/bar, NOT through `reelBarIndexForDate`: that extrapolates from the last ten bars, which on a 4H frame are four hours apart, so it would project as though the market traded around the clock (the AAPL 2,343-bar trap in the v344 note). A 4H bar is ~14.9h of calendar time on a session-bound equity against 4.0h on a 24h contract, which is why an equity reaches two future quarters and BTC one — `REEL_FUTURE_FRAC` allows 0.9 of a window of blank, ~290 days there and ~86 here, and the x-clamp drops the rest. Also: the two axis END-STOPS can no longer print through each other. Panning forward moves the last bar into the middle of the panel, so on a window carrying one grid label both end-stops landed in the same centimetre ("2026-08-05" through "2026-09-09"); the last bar's date is placed first and joins `drawnLabels`, so the window-start label is dropped by the same overlap test the grid labels get. v345 — **the 4H chart is back, chart only.** One row in the `TIMEFRAMES` table (`chartOnly: true`, prefix `h4_` that nothing reads, TradingView interval 240) and one button in the switch bar; the Charts tab offers 10m · 4H · Daily · 3D · Weekly again. No signal path changed — `SIGNAL_TFS` is still D/W and no `h4_` column exists, so the trend and stack filters borrow the signal timeframe through `withRowTf` exactly as they do on 10m. `REEL_TIME_GRID['4H']` was never removed, so the calendar grid is QUARTERS on it; the window is the standard `REEL_DEFAULT_WINDOW_BARS` (520), NOT a calendar quarter — the 10m lesson in v344 was that holding calendar time constant across instruments is what makes a chart unreadable. v344 — **the 10m chart opens on 120 bars, not one calendar month.** `REEL_TEN_MIN_WINDOW_BARS` replaces `reelMonthWindowBars`. A month of ten-minute bars is 1,172 bars on A2A and 4,300 on BTCUSD against a ~345px plot — 0.29px and 0.08px per bar, which is not a candle, and a whole new session was 11px of change at the right edge of an otherwise identical picture. That is what "the 10m candles never change" was: the data was live to within 12 minutes of the publish the whole time. Now 2.88px/bar. The grid follows the window — `REEL_TIME_GRID['10m']` is `'day'`, not `'month'` (which reversed the user's 2026-09-14 call, made when the window really was a month and a month line really was the sparse one); `reelDayLabel` prints "Tue 16", `reelTradesWeekends` keeps projected lines off days an instrument does not trade, and `reelEndStopLabel` gives the axis end-stops a TIME on 10m, where a 120-bar window on a 24h instrument sits inside one date and both ends read "2026-09-16". The month grid path, `reelMonthLabel` and `REEL_FUTURE_MONTHS` went with it — no timeframe reached them. The bundle still carries two months for panning, and the Range pill still overrides. v322 — the footer button is **Drawing**, and it no longer places anything. `channelToggleEdit` used to drop a default CHANNEL on the chart on the first tap (`if (!channelsFor(name).length) addChannelFor(name, reelDefaultChannel(ctx.b))`), so asking to see the tools left you with a channel to delete — and the button picked one of the four tools for you. It now only opens the tool row (`[data-tools]`, which `reelSyncChannelButtons` shows while `reel.editing` is that card); a drawing is created when you tap the tool you want, which is `channelAdd`'s job. `reelDefaultChannel` is still live — `reelDefaultDrawing` calls it for the channel tool. v321 — **Monthly chart view (`M`, prefix `m_`), one MA: MA50.** Chart-only and marked `chartOnly: true` in the TIMEFRAMES table, which is the first timeframe carrying NO prefixed columns at all (3D and W both have their own). That flag is load-bearing: `effectiveTrend` ends in `item[f('trend_direction')] || ''`, so on Monthly every row would answer NEUTRAL and picking "Uptrend" would empty the reel — `reelFiltered` now runs the trend and stack filters through `withRowTf`, which borrows the signal timeframe on a chartOnly view exactly as the signal scopes already did. Measured after the fix: Monthly Uptrend 425 / Downtrend 212 / Neutral 161, identical to Daily and summing to 798. Why MA50 alone — over 200 sampled instruments, 98% hold the 50 monthly bars MA50 needs and **0%** hold the 250 or 500 MA250/MA500 would need (~21 and ~42 years against a cache whose median is 244 months), so those two would be blank lines on every instrument. `REEL_TIME_GRID` gives M the 'admin' grid like W. v320 — the full-screen chart list **WRAPS**: `chartFullStep` takes the index modulo the list length, so ‹ on chart 1 lands on chart 798 and counts down, and › on the last returns to 1. Both ‹ › buttons lost their `disabled` states with it — a dead button at each end read as broken rather than as "that is the end". The reel behind is now positioned BY CARD (`host.scrollTop = el.offsetTop - host.offsetTop`, the same idiom as `reelRebuildKeepingPlace`/`openChartFor`) instead of `reelStepBy(dir)`, which scrolls exactly one screen and would have scrolled off the top on a wrap, leaving the reel on the wrong instrument once full screen closed. v319 — **drawing tools you can point at.** The footer button is **Draw**, not Channel — it opens four tools and named one of them. Every drawing now carries an invisible fat tap line (`reelHitLine` → `.reel-ch-hit`, `data-di`), so TAPPING any part of a line makes it the active drawing and opens editing: Lock, Unlock and Clear act on the line you just touched instead of on whichever was added last, which is what they silently meant on a chart carrying three drawings. Selecting deliberately does not claim the gesture — no capture, no preventDefault — so a drag that starts on a line still pans. The tool strip is a **white horizontal bar above the trend strip and date row** (it was a dark vertical strip pinned over the price action at mid-height); it is a SIBLING of the chart, so its `bottom` is measured against the whole card and no CSS constant fits both a phone card and a wide desktop one — `reelChartSvg()` sets the exact offset from `L.stripY`, one viewBox unit being `clientWidth/1000` px. Drawings render **white** (`--reel-ch-color: #ffffff` on `.reel-chart`, so the full-screen chart inherits it from the same line; the 10-line ladder included). **Horizontal price gridlines removed** at the user's request: `reelTicks` re-picks its levels whenever the price window changes, so panning or zooming made lines appear and disappear under the price — movement that reads as the chart doing something when nothing happened. The numbers stay in the gutter, which is where a level is read. v318 — full-screen ‹ › and the n/total counter moved to the bottom-right of the footer (`.cf-steps`). v317 — deleted the hidden confidence breakdown and the confidence points in the unshown radar score: their comparisons against 'standard' failed the shape audit whenever a day's fires carried no standard tier, which turned test.yml red on a330e0b. v316 — full-screen chart keeps the trend sentence (`reelTrendlineHtml`, shared with the card) and steps to the previous/next chart in place (`chartFullStep`: ‹ › buttons with an n/total counter, Up/Down keys; the reel behind steps too). New drawing tool **10 price lines** (`kind: 'ladder'`, stored `{p1, p4}`): dotted like the calendar lines, always evenly spaced at p1 + k·(p4−p1)/3, handles on lines 1 and 4 (`l1`/`l4`), refuses a drag that collapses them. v315 — 1H and 4H removed from the timeframe table and the Charts switch; the price-feed warning retired with hourly data. v314 — the trend sentence moved onto chart cards (footer word gone) and a Daily-only **trend strip** under the price (`reelTrendStripSvg`: green/red by the Trends segments, lighter below MA50; `reelLayout` reserves `stripH`). v313 — **Phase 1 finished.** One trend sentence via `trendSentence()` on signal cards, Analyzed rows, the sheet and Trends cards ("▲ Uptrend 1,378 days · now below MA50"; on Daily the regime comes from the Trends segments so card and tab agree; amber when price is against the regime) — it replaced the "REACTION · watch B2/B3/B4" hint. "Worth the cost?" line (`costLineHtml`) on cards with a current signal: stop = 2×`atr_pct`; under 3.0% (D) / 6.8% (W) it reads tight with the measured −0.22R / −0.21R and dims the card. Price-feed warning (`dataWarnHtml`) on the sheet from `data_checks.json`. Modal price row wraps so TradingView is no longer clipped. Charts deliberately untouched — the user wants to see chart ideas first. v312 — **Sector Rotation card above the Radar and Market Ranking card below it**, both from `rotation.json` / `rotation_paper.json` (see the Rotation section); `srGoToSector` moved to top level so the wheel's chips reuse it. v311 — **truth pass.** Signal cards describe what fired (`verdictOf` → "B3 · touched MA250, closed above") instead of grading it; sells read as an amber WARNING for longs. Removed from view: STRONG/HIGH-CONVICTION/LOW-EDGE/AVOID verdicts, confidence chips/sorts/legend, MA ORDER gauges, the TF Alignment card + filter + Market Pulse row + Best chip, the Radar chip + Ranked tiers + modal radar score, the Mood pill + conviction sort + card glow/dim + market-state banner (`convictionOf` returns null), the red pulsing Extended (now "Long-running"), and the hard-coded "2% stop". Controls JS still reads are `hidden`, not deleted. A standing note on Signals says entries tested no better than random. v310 — 1H/4H/3D become chart views, signal tabs Daily/Weekly, Trends really Daily, opens on Daily; see Timeframes. v271 — **the lookalikes are charts now, not a list.** The modal's
  Looks-like block could only NAME the similar instruments, which is the wrong half of
  the idea: knowing SA40 looks like GOLD is worth nothing until the two charts are in
  front of you. `showSimilarCharts(name)` opens the Charts tab holding that instrument
  plus its lookalikes in similarity order, so the reel's up/down controls flick straight
  through the comparison; each card carries `95% alike` and the anchor says `this one`.
  `reel.similarTo` REPLACES the list rather than narrowing it — it is an explicit set in
  a deliberate order — so it gets its own `.reel-simbar` instead of a pill, and search,
  pills and sort are bypassed while it is on. Two fixes alongside: stepping now repaints
  on settle (`reelPaintVisible`) instead of trusting the IntersectionObserver alone, an
  unpainted chart being the one failure a reader cannot work around; and **Reset was
  clearing neither `reel.stack` nor the compare mode**, so pressing it left the list
  filtered. v269 — **step through the reel one chart at a time.** The Charts
  tab has always snap-scrolled on a flick (`scroll-snap-type: y mandatory`, cards at 100%
  height) and had nothing else to drive it: no buttons, no keyboard, so on a desktop the
  only way through 798 charts was a wheel fighting the snap. `.reel-nav` adds up/down
  buttons with an `n/total` counter, plus ArrowUp/Down, PageUp/Down and j/k. Stepping is
  done by SCROLLING one `clientHeight`, never by a tracked index — the scroll position is
  the single source of truth, so a flick, a wheel, a key and a tap all move the same
  thing and nothing can drift. Two bugs found while verifying: the keydown guard called
  `e.target.matches(...)` unguarded, but a key delivered with nothing focused targets
  `document`, which has no `.matches` — TypeError killed the whole handler silently; and
  the nav state was refreshed ONLY from the scroll event, which left `prev` stuck
  disabled after stepping down (one step forward, no way back) wherever those events are
  throttled, so `reelStepBy` now also syncs on a settle timer. v267 — concentration note reads "21 of these 64 move together"; it was "21 of these match move together", a template arg used as a noun. v266 — **chart lookalikes + a concentration warning.**
  `shape_similarity.py` measures which charts have MOVED ALIKE over 520 daily bars once
  the market's common drift is removed; the app reads it for two things. A **Looks like**
  block in the instrument modal lists the 6 closest charts (tap to open), and a
  **concentration note** above the Signals cards says when several of the things on screen
  are one bet wearing different tickers. Measured motivation: SA40 and GOLD run at +0.976
  raw / +0.94 de-drifted, because the JSE Top 40 is mining-heavy — hold GOLD, SA40 and
  FRES and you hold one position three times. The note's threshold is a SHARE of what is
  on screen (>=3 members AND >=20%), not a headcount: a headcount rule (>=6) fired on the
  full 798-instrument list where the biggest family is 26 names, i.e. 3.3%. Verified
  against real screens — everything/today's-fires stay silent, Crypto (32.8%) and
  Commodity (22.2%) fire. **Descriptive, never predictive**, and it never uses
  `--buy`/`--sell`: "these two look the same" says nothing about direction. v265 — the Charts Stack pill shows its selected value in `.fp-val` and counts toward the reel reset button, like every other pill. v264 — **1H timeframe + the MA stack strip.** Fourth
  timeframe `1H`/`h1_`, run on the hourly parquet cache 4H is resampled from — no new
  download, and it inherits both 4H geometry fixes (`H4_SOURCE` redirects the same file;
  `_h1_ma_periods` scales the ribbon for `H1_SESSION_NORMALIZE` against a 24-bar target).
  The scale gap is WIDER at 1H than 4H: an equity gives 7 hourly bars a session and a
  24h contract 23-24, so an unscaled MA500 would span 71 sessions on one and 21 on the
  other. **1H deliberately does NOT vote in `tf_alignment`** (`config.ALIGNMENT_PREFIXES`)
  — it would double-count the intraday read (1H and 4H come off one feed) and silently
  widen the score from -3..+3 to -4..+4, which every consumer drawing a bar from it would
  under-fill invisibly. NEW `.sc-stack` strip on the shared `setupPanelHtml()` (Signals
  cards, Analyzed rows, modal): a 3-rung glyph placed at the real heights of the fast/mid/
  anchor lines, the BULL/BEAR/MIXED order, the closest pair and its gap, and bars since
  that pair flipped. **Display only, and measured that way** — 40,476 cross events and
  29,479 matched signal trades on 2026-09-03: the 50x250 cross wins 47-53% as an entry
  and trails buy-and-hold on every timeframe, and as an exit a control that merely held
  longer with no cross in it matched it (+0.229R vs +0.236R on 4H), with financing
  turning every variant negative. So it never renders in --buy/--sell as a background or
  border. Filter `#scannerStackFilter` (Signals sheet) and `#reelStackOpts` (Charts pill)
  share ONE predicate, `matchesStackFilter()`. Also: the radar's tab-match test now reads
  `INTRADAY_TFS` rather than `timeframe !== '4H'`, a literal that silently answered
  "matches" for 1H. v263 — **the radar has a weekly twin, and says which one you
  are looking at.** `sectorRadarByTf` holds both payloads (3.4 KB each, both fetched at
  boot); `syncRadarTf()` re-points `sectorRadarData` on the timeframe switch and writes a
  `.sr-period` tag on the card — "Today" / "This week", amber when it cannot match. That
  tag is the point: the radar is the ONE dashboard card that does not follow the switch,
  4H has no radar at all (too little hourly history for a baseline), and before this the
  daily radar rendered unchanged on every tab — so on Weekly every number around it showed
  last Friday while the radar showed today, with nothing on screen saying so. The info-modal
  sparkline is cached per timeframe for the same reason: one shared slot would have drawn
  daily bars under a weekly z-score. **Weekly radar URLs are distinct PATHS
  (`/api/sector-radar-w`), never `?tf=W`** — publish.py rewrites API paths by literal
  string match, so a query-string variant matched nothing, shipped unrewritten and fetched
  a path that does not exist on a static host. It failed SOFT (null radar, silent fallback
  to daily), which is the worst way for it to fail; caught only by checking the deployed
  site rather than localhost. v261 — **Weekly, and one timeframe table instead of twelve
  ternaries.** Third timeframe `W`/`w_` alongside 4H and Daily, live on all five tabs.
  The per-timeframe facts (prefix, label, TradingView interval, the word for one bar) now
  sit in ONE `TIMEFRAMES` array at the top of the file, mirroring `config.TIMEFRAMES`;
  `f()` reads its prefix from there. They were ~12 separate `timeframe === '4H' ? a : b`
  ternaries — a shape that silently answers "Daily" for any third timeframe, so every one
  of them was a latent wrong-answer the moment Weekly existed. Also in v261:
  `effectiveTrend()` **gates `neutral_oscillation` to Daily**, which is the only timeframe
  it is computed on (`ma_fast_cross_count` over 30 DAILY bars + a flat daily MA250 slope —
  there is no `h4_`/`w_` counterpart). It was applied on every timeframe, so a fortnight of
  day-to-day chop overruled the ribbon read on the slower ones: measured on the 2026-09-02
  payload, 36 instruments carry the flag and it was forcing **23 Weekly rows and 25 4H
  rows** to NEUTRAL on top of its 16 legitimate Daily ones — the dashboard read 486 weekly
  uptrends against the payload's 508. On a ribbon whose anchor spans 9.6 years that is
  exactly backwards. Same discipline as `moodApplies()`: a read applies only on the
  timeframe it was measured on. Verified live at 375px and 320px — three 94.7px buttons,
  no clipping, no page-level horizontal scroll, and every element past the viewport edge
  sits inside an `overflow-x` scroller. v259 — **the run says whether it worked.** `renderRunStatus()`
  paints a persistent outcome line from the same /run/status payload the button polls:
  succeeded/failed/cancelled with a relative time, manual vs scheduled, plus queued and
  running states; "Sign in to see run status" and "Run status unavailable" are
  distinguished, because a blank line reads as "nothing has run". Verified against all
  eight shapes. v258 — **signed out, Run now opens the sign-in** instead of printing
  "Sign in first" and doing nothing; it lands on the password step when a user is already
  chosen. v257 — **Run now: start the pipeline from the app.** `#refreshBtn`
  re-downloads what CI last published, which when the stale banner is up fetches the same
  stale file and looks like it worked. `triggerRun()` dispatches `publish.yml` through the
  sync Worker (no token in this public bundle — see the Manual data run section) and
  `watchRun(since)` polls queued → running → done, then calls `loadAll()`. Every branch
  verified against stubbed responses: 501 names the missing secret, 429 shows the wait, 409
  watches the run already in flight, 502 fails visibly, and the full lifecycle
  old-run → ours-running → ours-done reloads the data exactly once. v256 — **the calendar stopped being an island.** It shipped
  reading 700-odd scheduled dates that only the dropdown and one banner could
  see; `eventsData` appeared 7 times in a 325 KB file and 6 of those were in one
  block. Now: `eventChipHtml()` on every card surface (scanner/Analyzed via
  `cardIdentityHtml`, Trends via its own header — it does NOT use the shared
  helper, contrary to the v237 note below), `modalEventHtml()` on the screen the
  decision is actually made on, an `#eventChip` scanner filter cycling
  Event ≤7d / No event, and `openRatesBoard()` so an FOMC banner can reach the
  five Rates instruments that landed the same week. Verified live: 121 chips on
  the Trends tab against 121 instruments independently computed to have an event
  inside 14 sessions. Also — `downloadIcs()` now SLICES the published feed
  instead of rebuilding it (it emitted `FOMC decision — macro` where
  `build_ics` emits `FOMC decision`; two builders, one fixed); the bell shows two
  counts instead of their sum; `tradingDaysUntil()` replaces calendar days so a
  Monday event reads "in 1 session" on a Friday; the delegated `data-act`
  dispatcher answers Enter/Space, so `role="button"` divs (the event banner, the
  day rows, the modal event rows) stop being focusable and dead; `browseClassOf()`
  gives Rates the Class chip Instruments.txt has claimed since the group was
  added, while `assetClassOf()` keeps mapping it to Index so the confidence map
  still resolves; the day sheet opens an instrument like every other place a name
  appears; a month past the feed horizon is dimmed and says so; the notif segment
  is remembered; two O(n) scans per row replaced with built-once indexes. v237 — **one card vocabulary, three densities.** The Signals card, Analyzed row and Trends card describe the same instrument and each said it differently: three spellings of the identity block (`.scanner-name`/`.wl-card-name` etc.), two hand-copies of the action buttons, and `verdictOf()` — the app's headline judgement — rendered on exactly ONE of the three. New shared `cardIdentityHtml()` / `cardActionsHtml()` / `verdictChipHtml()`; the four old per-card classes collapse to `.card-name`/`.card-group` (css v215) — **NB the Trends card does not actually call `cardIdentityHtml()`; it still builds `.tc-name`/`.tc-group` itself (verified 2026-08-30), so a fact added to the shared helper has to be added there too** and their dead rules are deleted. **Deliberately NOT one identical card** — the tabs answer different questions (what to look at / what I've studied / how long this has run), so density SHOULD differ; what must not differ is that a given fact renders as the same element everywhere. Trends KEEPS its run-days hero for that reason. Analyzed and Trends gain the verdict at chip density (same `verdictOf()`, same `.sc-v-*` tone classes — the tone selectors were widened rather than restated, so 'a buy verdict looks like this' has one definition). Verified: scanner 100/100 cards on the shared classes with zero old-class hits, Analyzed 33 cards / 28 chips, Trends 717 cards / 366 chips / 717 run-day heroes intact; no horizontal scroll and 0 overflowing elements at 390px on all three tabs. v236 — **Trends cards show their signal again.** `buildTrendsCards()` read `d[f('signal_type')] || d[f('signal')]` — NEITHER is a column, and never has been (the payload carries `primary_signal` and `last_signal_type`). Both reads returned undefined on every row, so every Trends card's badge printed a muted **"No signal" for all 736 instruments** regardless of what fired. The badge then tested that empty value for the words 'buy'/'sell'/'watch', which could never have matched even once populated, since the field holds CODES. Now `d[f('primary_signal')]` + a B/S prefix test, matching publish.py/server.py's buy_mask — verified live: 38 badges (B1x5 B2x14 B3x1 B4x2 S1x1 S2x3 S3x8 S4x4), exactly the 38 signalled rows in the payload. The 'watch' branch is gone (no such code; watch_flag is dead). THIRD instance of this family after the gauge (v225) and shareCard (v235) — **found by the reinstated ghost-read check in tools/shape_audit.py**. v235 — **share card shows its direction again.** `shareCard()` built its buy/sell label with `conf.toLowerCase().includes('buy')` where `conf` is `confirmation_status` — a field whose 18 phrasings ("Uptrend — above all MAs", "Trend breakout — B1: …") contain neither 'buy' nor 'sell'. `dirLabel` was therefore `''` on every instrument that has ever fired, so `if (sig && dirLabel)` could never fire: the shared card lost its direction + signal-code line AND printed the trend line twice (once from the `else if (trend)` branch, once from the later `if (sig && trend)`). This is the SAME bug v225 fixed in `computeSummary()` — there were two call sites and only one was fixed. Now `sig.startsWith('B')/('S')`, matching publish.py/server.py's `buy_mask` exactly, so there is one definition of buy/sell rather than three. Measured on the live payload: all 38 signalled instruments produced an empty label before, all 38 resolve after; verified in-app via `window.SP.shareCard` (GOOGL B3 → "🟢 Buy · B3", CDNS S1 → "🔴 Sell · S1", trend line once). Dead local `conf` removed with it. **Found by `tools/shape_audit.py`, not by hand** — see that file and the Common Tasks entry below. v234 — **week and month returns surfaced; Move filter added to the Signals tab.** `pct_1w`/`pct_1m` have shipped from the pipeline since the performance columns were added (indicators.add_performance_pct → config.OUTPUT_COLUMNS → signals.json) and were present in every published payload — nothing read them. The scanner card's stat row goes 1D/1Y/VOL → **1D/1W/1M/1Y/VOL**, and the Sort pill and advanced-sheet `<select>` gain Week/Month in both directions; the four `pct_*` sort branches collapsed into one regex branch rather than becoming eight hand-copies. NEW **Move pill** (`scannerMovePeriod`/`scannerMoveDir`/`scannerMoveMin`) filters by period return on three independent axes — period 1D/1W/1M/1Y × direction Either/Up/Down × size Any/2/5/10/25/50% — which is 9 chips instead of the 12+ a flat up2/up5/down2/… list would have needed for the same reach. Applied OUTSIDE the `if (!search)` chip block, alongside Class and Mood, so typing a name narrows the move filter instead of silently switching it off (the v229 class-chip collision). Rows with no return for the chosen period are excluded, not passed through. Verified against the raw payload: 1M ▲ 10%+ → 166, matching a direct count over `/api/signals`; composes with search (crypto + 1W ▲ 5%+ → 3, min 6.1%). Note the returns are DAILY-close based on both timeframes — there is no `h4_pct_*`, so they never go through `f()`. v231 — **stale banner stopped reconstructing the CI schedule.** It held `RUN_HOURS_WEEKDAY=[11,15]` as expected LANDING hours + 2.5h grace and warned whenever data predated the run that 'should' have finished — a number that had to be hand-synced with publish.yml and that assumed a queue delay GitHub does not honour. Crons are queued 1.5-3h: on 2026-07-27 the 10:35 run started 13:26 and landed ~13:32, two minutes past the 13:30 cutoff, so a healthy pipeline was reported late; the weekend margin was 25 min (cron 08:00, observed start 10:00). Now freshness is just `now - summary.fetched_at` (stamped on every SUCCESSFUL publish) against `STALE_AFTER_H = 32`, set from MEASURED gaps — largest real gap over 30 runs was 27.4h (Sun 10:00 -> Mon 13:26); a first cut at 26h would have false-alarmed every Monday. No schedule knowledge, nothing to keep in sync. A FAILED run is now surfaced immediately via NEW `/api/status` -> status.json (`state:'failed'`), which only sw.js used to read. Banner also **clears itself**: `scheduleStaleRetry()` re-loads every 10 min while it is showing instead of leaving the warning up until the next 4-hourly refresh. v230 — **trend_direction is now authoritative for the trend badge.** `effectiveTrend()` had a `confirmation_status` keyword fallback written for the old "Neutral — transitioning (rising/declining ribbon)" statuses, which signals.py no longer emits. The only strings it still caught were "Pullback below MA500 — uptrend intact" and "Rally above MA500 — downtrend intact" — 57 rows on the 07-28 run — both produced by the in_uptrend/in_downtrend LATCH, which clears only on a full-ribbon B1/S1 cross. So the fallback was overriding the corrected ribbon-position read with a regime flag that can be months stale. Removed; the pipeline-side fix is in indicators.add_trend + main._compute_tf_alignment (see SIGNAL_RULES.md §1). v229 — audit items 5/7/8 + 22/24 + CDN pin: **one definition of "today"** (`firedOnLatestBar()`, shared with `moodApplies`) — the Today chip compared the fire date against the DEVICE's midnight while the cards compared against the data's newest bar, so on a weekend or any lagging feed the chip returned 0 while the cards below it read "Today" (verified: local data dated the 28th on a device set to the 29th → chip 0 before, 114 after, every card reading "Latest bar"). Per-instrument on purpose — feeds lag at different rates. **`asset_class` now ships from the pipeline** (`main.py` row build + OUTPUT_COLUMNS) and `assetClassOf()` reads it, keeping its old body only as a fallback for pre-column payloads — app.js had a hand-copy of `instruments.py asset_class_of()`, and two implementations of one rule in two languages is exactly how the buy/sell bug survived a year. **User picker is dismissible** — `hideUserPicker()` + a "Not now — just browsing" button, backdrop tap and Escape; it opened on first load with no way out, so a new device was stuck on it before seeing a single signal. Also removed five full passes over the filtered list computing buy/sell/squeeze/keylvl/today tallies for the `#scannerSummary` pills that v226 deleted. v228: **live Track Record now counts only MATURED fires.** `signal_ledger.py` writes a trade the moment it resolves, and a 1R stop resolves far sooner than a 2R target — so averaging every resolved fire samples the fast losers. On Daily (30-bar window, ledger 4 weeks old) NOT ONE fire had matured, yet the card printed B1 −1.078R / 7.9% win beside the backtest's +0.066R as if comparable; D|B4 read 0% off 1 of 69 fires while its unbiased +20-bar mark was strongly positive. Grading now sets `matured` once the fire's full window (`TIME_STOP_BARS` D 30 / 4H 60 bars) has elapsed — `grade_open_records` revisits resolved-but-immature records so they can become eligible — and `_bucket_stats` averages `counted` (resolved AND matured) only, reporting `counted`/`maturing`/`approx` + an unbiased `h20_avg_pct`/`h20_n` alongside. A code needs 10 counted fires before the card shows a row at all; the rest render as a plain "still maturing B1 2/10 · …" line. On the 801-fire ledger: 348 resolved → **40 counted**, and the only code with a shippable sample is S2 (25/164, 32% win, −0.274R vs BT −0.098R). A pre-gate payload (`totals.counted === undefined`) renders "grades are being recomputed" rather than the old biased numbers. ALSO in v226 (front-end consistency pass, audit items 14-18): **confidence tier stated once per card** — `setupPanelHtml(item, {showConf:false})` on the scanner card, where `.sc-verdict` right above already says "standard edge"; the modal (no verdict bar) still passes the default `true`. **`#scannerSummary` strip emptied** — it repeated the header's own count one line below it; its delegated `[data-sum-filter]` handler removed with it ("clear filters" is the All button in the pill row). **Timeframe switch no longer sits dead on Trends** — `TF_LOCKED_TABS` + `syncTfLock()` swap the two buttons for `#tfSwitchNote` ("Daily · trend history is daily-only") inside the same `.tf-switch` box; the note's 12px/14px box is deliberately identical to `.tf-switch-btn` so the topbar-stack stays exactly 119px on desktop and `.bottom-nav{top:119px}` still lines up (verified 119/119 on both tabs). v225: **Market Pulse gauge signal component un-frozen** — `computeSummary()` counted buys/sells with `confirmation_status.includes('buy'/'sell')`, but that field's vocabulary is "Uptrend — above all MAs" / "Above MA500 — watching for pullback entry" and contains neither word, so `buy_count`/`sell_count` were structurally 0 on every run. `computeStrengthScore()`'s signal-direction term (`buy/(buy+sell)*30`) therefore always hit its no-signals fallback of **15**, pinning a third of the gauge formula to a constant since it shipped. Now counted by code prefix, matching publish.py/server.py's `buy_mask = primary_signal.startswith('B')` exactly (verified: client 13/11 == server 13/11). Effect: Daily 71→72, 4H 69→63 — the term now actually tracks buy/sell balance and differs per timeframe. NB deliberately NOT `isBuy()/isSell()`, which fall back to trend when no signal fired and would count every uptrending instrument as a buy. This was audit backlog item (f) "two buy/sell definitions"; the note undersold it as cosmetic. The `#buyCount`/`#sellCount`/`#gbBuy`/`#gbSell` spans are `display:none` — the gauge was the only live consumer. v224 — review fixes on the v222 conviction layer: (1) **age is measured against the DATA's latest bar, not the wall clock** — new `daysBetween()` (UTC-parsed, timezone-proof) feeds `signalAge(dateStr, asOfStr)` + `signalPerf`; a fire on the newest bar reads "Today" (or "Latest bar" when the feed is behind) instead of "1d ago", and the structurally-meaningless "+0.0% since" is suppressed at 0 days. Was: 35 of 76 cards read "1d · +0.0%" when zero bars had closed. (2) **mood terms removed from free-text search** (`MOOD_SEARCH`/`matchesMoodSearch` deleted) — prefix matching meant "cal"→calm returned 661 of 741 instruments, "act"→active 102; search must narrow, the Mood pill is the way to filter by mood. (3) **verdict scoring is now ADDITIVE, not override** — base confidence tier ±1 sector delta, clamped 0–4 (`VERDICT_TIERS`); a high-tier buy in a fighting sector lands at BUY SETUP (3−1) instead of erasing the tier to a bare "⚠ FIGHTING SECTOR"; new floor tier `⚠ AVOID`. Phase 0 measured mood as a delta vs baseline, so it must adjust the base, not replace it. (4) **mood layer gated to what was tested** — `moodApplies()`: daily only (Phase 0 ran TF='D') AND only for a fire on the item's latest bar (the flavours file carries one mood — today's; Phase 0 scored each fire against its OWN fire-day mood). (5) **card decluttered** — `.sc-mood-chip` + `.sc-conv` pip row removed (on a normal day they said "calm/no opinion" 60+ times a screen); the sector now speaks only via `.sc-v-note` inside the verdict bar, which renders only when the mood actually moved the score. (6) new `unknown` flavour + "No sector read" Mood option — an unjudgeable sector no longer reads as a calm all-clear. NOTE: ★ HIGH-CONVICTION remains reachable via the sector-confirmed bump only, which today exists for SELLs — no buy-side promotion has cleared the evidence bar (buy_thrust t=+1.5; market-wide buy +0.24R held back as regime-suspect). v222: top-of-card `.sc-verdict` bar — `verdictOf()` fuses signal + backtest confidence tier + sector mood into one plain-language call [★ HIGH-CONVICTION / STRONG / SETUP / ⚠ LOW-EDGE / ⚠ FIGHTING SECTOR / ⚠ LIKELY TRAP]; the 18 flat Signals chips consolidated into 3 `<details>` dropdown pills [Class/Mood/Filters] in `.sig-filter-pills` (existing `#scannerCatChips` + `.sig-ctx-row` moved inside, handlers untouched; `updateFilterPills()` syncs `.has-active`); NEW Mood filter (`scannerMoodFilter` + `#scannerMoodOpts`) and mood terms added to `matchesSearch` via `matchesMoodSearch`. v221: banner copy fix. v220: sector-mood conviction layer, Phase 0 VALIDATED on real R 2026-07-22: scanner cards get a `.sc-mood-chip` (sector flavour today) + a `.sc-conv` grade row (pips + label); SELL+sell_thrust = confirmed/glow, BUY into sinking/churn or SELL on a market-wide day = fighting/dim; `convictionOf()`/`moodChipHtml()` read `instrument_flavours.json` (per-instrument, keyed by name). New "Conviction ↓" scanner sort + Dashboard `#marketStateBanner` (sit-out day on market-wide churn). Grade is DISPLAY-ONLY — does NOT touch `signal_confidence`. Real-R backtest (research/flavour_phase0_R.py, 14.5k trades) confirmed all 3 rules [SELL+sell_thrust +0.15R, BUY-into-fighting −0.16R, SELL+market_wide −0.23R] → "provisional" label dropped (caveat: one up-market regime). v217: sector radar interactive; clickable `.sr-spoke`/`.sr-chip`s → `srGoToSector()`)
- `app.js` — **v325** (v325: **the share button stopped emitting plain black charts.** `chartToPngBlob` filled its canvas with `--bg-card` (#121211) and captioned in `--text-primary`, which was right while the plot was dark. Since the white plot ground (v271) the ground is a CSS `background` on the `.reel-chart` DIV — **not on the SVG** — so the serialized clone is transparent, while `inlineSvgStyles` correctly resolves the bars to the #14140f ink chosen FOR a white panel. Near-black ink painted onto a near-black canvas: the shared PNG was a black rectangle. Ground and ink now come from `getComputedStyle(host)` — the chart box's OWN computed `backgroundColor`, `--reel-bar`, `--text-secondary`, `--text-muted` — so the picture cannot drift from the chart again; whatever `.reel-chart` is set to is what gets shared. `cssVar()` had no callers left and is deleted. Verified by intercepting the real canvas: 2000x2586, ground rgb(255,255,255) across caption/plot/footer, 19 distinct colours in a plot row, 4.32% ink coverage. v324: (v324: **the 10m ribbon is normalised for round-the-clock markets, and the 10m chart carries two months.** Measured one instrument per group across all 37 groups, 10m bars per CALENDAR day is sharply bimodal — exchange-traded 23.3–36.7, round-the-clock 95.5–144.0, a gap 58.8 wide. So the SAME MA500 averaged over 18.5 days on a US equity and **3.5 days on BTC / 5.0 on forex / 3.9 on commodities**: the ribbon stopped being a trend reference and lay on the price. New `_m10_ma_periods` scales periods by measured bars/day above `TEN_MIN_NORMALIZE_ABOVE` (45.0 — just above the densest equity venue, which also catches ^VIX's 55.6 on its ~15h session; a mid-gap threshold would have left it the one chart reaching 9.0 days). After: every instrument reaches 13.7–21.5 days and **no exchange-traded chart is touched**, so those still match TradingView. Crypto ships [266,1328,2656], forex [187,936,1872], commodities [178,889,1778]. **Cost, stated:** a normalised crypto 10m chart no longer matches a stock TradingView MA500 — accepted, because a ribbon meaning a different length of market per instrument is not one ribbon. Also: `CARRY_MONTHS = 2` so panning left reaches the previous month, capped by a WARM-UP GUARD (`len(ten) - max(periods)`) — without it BTC's two months swallowed its entire 8,599-bar history and shipped 167 null MA500 points, a ribbon visibly starting partway into the window. The future month line does NOT use `reelBarIndexForDate`: that extrapolates from the last ten bars' spacing, which intraday is 10 minutes, putting 1 Oct **2,343 bars** past AAPL's last bar against a reachable 702 — a line that existed and could never be scrolled to. Whole-bundle average spacing (53.3 min/bar on AAPL, 10.0 on BTC) lands it at 440. v323: (v323: **10m chart timeframe added; Monthly removed.** Yahoo has NO 10m interval (verified: *"interval=10m is not supported"*), so the frame is resampled from **5m** — new `fetch_5m`/`fetch_all_5m` in data_fetcher, `_resample_10m` in main, `build_10m` in chart_feed. CHART ONLY (`chartOnly: true`, the flag Monthly used to hold): no m10_ columns, no signals, no alignment vote — intraday signals were measured worthless and removed on 2026-09-11 and nothing here reverses that. **Cut by CALENDAR, not bar count** — the only timeframe that is, at the user's request ("one month for all"): a ten-minute bar is 38.8/session on an equity and 143.3 on a 24h instrument, so a flat 1300 bars was 34 sessions of AAPL against 10 days of BTC. Now both read 2026-08-14 → 2026-09-14 at 780 and 4,461 bars. `reelWindowBars` OPENS 10m on its whole bundle for the same reason — a 520-bar default would undo the calendar cut unevenly. Grid is **month boundaries** (`REEL_TIME_GRID['10m']`), one line in the window; a session line (21 vs 31 lines) and a week line (4) were both tried first. Axis end-stops now survive a single grid label (`gridLabelCount >= 2`) — with one month line the old test blanked the axis down to "Sept". Coverage measured across all 37 instrument groups: 37/37. **Monthly is gone** — its chart/M R2 chunks are orphaned, not deleted, since the publisher has no sweep step; `main._resample_monthly` stays for backtest/research.)
- `style.css` — **v274** (v274: **the full-screen footer stopped reserving the home-bar inset twice.** `#chartFull` pads itself with `env(safe-area-inset-bottom)` and `#chartFull .reel-foot` then added `calc(6px + env(safe-area-inset-bottom))` on top of it, so on a 34pt-inset iPhone the 3D / Drawing / ‹ › row sat **34pt higher than it should** — 75px of dead white below the controls. Now a plain `6px`: the row drops to the safe-area edge (41px above the screen bottom, 7px clear of the inset) and `.reel-chart`, which is `flex: 1`, takes the 34pt back as chart height. **This is invisible on a desktop browser** — both `env()` terms compute to 0 there, so it was measured against a simulated 34px inset, the way every safe-area bug on this app has to be. v273: **the full-screen chart is white edge to edge, and the dashboard announcement card takes the `.card` geometry.** `#chartFull` drops `--bg-base` black for `#ffffff` — the plot ground went white in v271 but the overlay behind it did not, so the full-screen chart read as a white box on a black sheet, header, footer and safe-area inset all dark; `background` paints the padding box, so the notch and home-bar insets go white with it. The chrome's tokens are re-pointed on `#chartFull > .cf-head` and `#chartFull > .reel-foot` **only, never on the overlay** — `.reel-chart` is a child of it and every mark the chart draws reads `--buy`/`--sell`/`--accent`, so a higher override would repaint the chart itself and a falling MA must be the same red full screen as on the card (verified: inside `.reel-chart` the tokens still compute to #10b981/#ef4444/#fbbf24). Gold is 1.7:1 on white and the buy green 2.2:1, so the chrome takes the darker members of the same hues (#a16207/#047857/#b91c1c/#b45309). `.event-banner` goes radius-sm → **radius-lg**, 11px/12px → **18px** padding, `margin-bottom: 0` → **16px** and gains `.card`'s box-shadow: it is a card in the dashboard stack and at the old numbers it read as a strip welded to the Market Pulse card below it. Only the gold colour stays — that is what marks it as the thing coming up. v272: the vertical calendar lines go **black** — `.reel-tgrid` and `.reel-tgrid-admin` drop `var(--text-muted)`/`var(--text-secondary)` for a literal `#14140f`. Their old comment justified mid-grey against "a #121211 panel", which stopped existing in v271; that reasoning is deleted with it. The year line stays lighter than the administration line through **opacity, width and dash** (.75/1.6px/`3 9` vs 1/2px/`7 6`), never hue, so the hierarchy survives the colour change. The labels are deliberately NOT changed — they stay `--text-secondary` dark grey. v271: **white plot ground on the charts.** `.reel-chart` gets `background: #ffffff` plus a scoped token override, which is the whole re-colouring — every mark the SVG makes reads a token, descendants inherit, and the tool bar / header / footer sit OUTSIDE the box so the app's dark chrome is untouched. `--reel-bar` #f2f2f4 → **#14140f** and `--reel-ma-up` #b6bac6 → **#14140f** (near-white and pale grey were chosen for a dark panel and are invisible on a white one); a FALLING MA still takes `--sell` red, so the slope read is unchanged. `--reel-ch-color` #ffffff → **#14140f** — drawings were deliberately white on 2026-09-11 and white-on-white cannot be seen. `--text-secondary`/`--text-muted`/`--border` re-pointed inside the box for axis numbers, calendar lines, clip tags and strip labels; the grips' white drag-wash inverted to black. The horizontal price gridlines do NOT come back with it — they were removed on purpose. v270: the timeframe label sized up — `.reel-tf-tag` .62rem → **.82rem** (and **.95rem** under `#chartFull`, where there is room). At .62rem it was the smallest text in the footer, which is the wrong rank for the label that says what every other number on the chart means. v269: **chart text amber and bold** — `.reel-tf-tag`, `.tf-switch-btn` (D/3D/W), `.reel-nav-pos`, `.reel-nav-btn`, `.cf-step` and `.cf-pos` all take `--accent`, the three text items at weight 800. `.tf-switch-btn.active` deliberately KEEPS its dark ink on the amber pill — amber on amber is unreadable — and because the switch is one shared control this also amber-ises the Daily|Weekly buttons on the other tabs. v268: `.reel-ch-hit` — the invisible fat tap target over a drawing's own lines (`pointer-events: stroke` is what makes a transparent stroke clickable). `.reel-toolbar` turned white, horizontal and bottom-anchored, with `.reel-tool` ink darkened to `#1a1a19` — the amber accent was picked to read on a dark translucent panel and is close to invisible on white; the `bottom` in the file is a fallback that app.js overwrites with the measured gap. `--reel-ch-color: #ffffff` on `.reel-chart`, and `.reel-ladder`/`.reel-ladder-key` take it too. v267: `.cf-steps` + wrapping full-screen footer; bigger `.cf-step`. v266: `.reel-ladder*`, `.cf-step`, `.cf-pos`. v265: `.mh-data-warn` removed. v264: `.reel-trendline*`, `.reel-strip-lbl`. v263: `.sc-state-pull`, `.sc-cost*`, `.tc-now*`, `.mh-data-warn`; `.mh-price-row`/`.mh-price-meta` wrap. v262: `.rot-*` wheel and `.lead-*` ranking styles; zone colours avoid --buy/--sell. v261: `[hidden]` rules for retired controls, `.sig-honesty-note`, amber `.sc-sig-warn`. v260: `.tf-switch-btn[hidden]` for per-tab timeframe buttons. v234: `.reel-nav` — up/down controls anchored to the right edge
  of `#pane-charts` (already `position: fixed`, so it is the containing block). Held at
  .42 opacity and lifted on hover/focus: the chart is the point, these are controls. An
  end-of-list button stays PRESENT but spent rather than disappearing, which would shift
  the other one out from under the pointer. v233: `.shape-conc` concentration note (`--watch`, the caution
  axis, not a direction) and `.mh-shape`/`.ms-row` for the modal's Looks-like list.
  v232: `.sc-stack` — the MA stack strip. Context palette only
  (border, muted greys, `--watch` on a sub-0.5% gap and on a fresh-flip border); the one-
  word state is the only thing that takes `--buy`/`--sell`, at text weight, because on
  this card those colours mean "a signal fired" and the cross measurably is not one.
  A `@container (max-width:250px)` step drops the gap value and the age first — card
  width, not viewport, for the reason the v214 `.sc-stats` note gives. v231: `.sr-period` — the Sector Radar's period tag. Neutral
  when it matches the tab, `--accent` when it cannot (4H). `:empty` hides it, so a radar
  that failed to load shows no tag rather than an empty pill. v230: the timeframe switch
  takes a third button —
  `.tf-switch-btn` gains `min-width:0` so "Weekly" cannot push the row wider than its bar,
  and a `@media (max-width:360px)` step drops the label to 13px/.02em letter-spacing.
  Measured, not guessed: 320px leaves 94.7px per button against a ~60px label, so the
  narrow rule is headroom rather than a fix for an overflow that already happens.
  v229: `.nrr-status` + `.is-ok`/`.is-bad`/`.is-running` for the
  run outcome — `--buy`/`--sell`, semantic rather than the accent, since good/bad is a
  different axis from "selected". v228: `.stale-run` + `.notif-run-row`/`.notif-run-btn` for the
  manual data run, with `[data-run-btn].is-busy`/`.is-error` shared so a run started
  from one button reads the same on the other. v227: event-awareness styles — `.card-event`/`.card-event-near`
  (the chip, one definition for all three card surfaces), `.mh-events`/`.mh-ev-row`
  (the modal block), `.eb-act` (the Rates board action), `.sig-chip-event`,
  `.cal-ev-open` (day rows that open an instrument), `.cal-grid-out`/`.cal-out-note`
  (past the feed horizon), `.notif-tf-note`, and the bell badge split into
  `[data-count]::before` (gold, fired today) + `[data-events]::after` (violet pip,
  scheduled soon) — attribute-driven so each mark appears only when its own count
  is non-zero. Uses the existing `--volume-soft`/`--volume-glow`/`--border` tokens;
  a first cut invented `--border-subtle`, which does not exist. v214: five-tile `.sc-stats` + Move pill. The stats row went flex→**grid** (`repeat(5,1fr)`): five `flex:1` children left ~24px of text per tile and wrapped every value. Tile width tracks the CARD, not the viewport — 1280px lays the scanner out in 4 columns of 297px (44px per tile), TIGHTER than a 375px phone's one full-width card (52px), and 320px is tighter still — so the narrow case is a **`@container (max-width:290px)`** query on `.scanner-card` reclaiming gap/padding, not a media query, which would have tightened the wrong case in both directions. Verified 0 clipped tiles at 320/375/768/1280; app.js drops the decimal past ±100% to match. **Move pop is anchored to the pill ROW** (`.sig-filter-pills{position:relative}` + `#pillMove{position:static}`) — it is wider than the other pops and its pill sits mid-row, so left-anchored it ran ~30px off a 375px screen, and the `:last-of-type` right-anchor trick only moves the overflow to the left edge when the pill wraps to the start of a row. v213: `.up-skip` user-picker escape; v212: sector radar sized up for phones — see v228 note; v211: **one selected-state colour across every toggle** — `.sig-dir-btn.active` was a leftover blue `rgba(79,158,255,.15)`, `.gp-view-toggle.gp-view-active` indigo, `.vp-mode-btn.vp-active` violet; all three are now `--accent-glow` bg + `--accent` text (+ `--accent` border on the two card-header toggles, which also now share one box: 4/10 padding, 8px radius). `--volume` violet stays on Volume Pulse's DATA, where it means volume rather than "selected"; `.sig-dir-buy/-sell` keep green/red, which carry meaning. `.sig-view-btn.active` ink `#fff`→`#0a0a0b` to match `.tf-switch-btn.active` (white on amber was barely legible). **Sector Radar de-monospaced** — `#sectorRadarBody`/`.sr-badge` dropped `ui-monospace` (kept `font-variant-numeric: tabular-nums` so the z-scores don't jitter); same for the `.ms-prov` chip in the market-state banner. It was the one card that read like a different application. NEW `.tf-switch-note` + `body.tf-locked` rules, and a desktop `.tf-switch{max-width:460px;margin:0 auto}` — the toggle previously spanned the full 1600px window, the largest element on screen. v210: **all three filter pills present identically** — Class and Filters were wrapped chip clouds, Mood was a vertical option list; now one shared rule set styles `.mood-opt`, `.filter-pop .s-cat-chip` and `.filter-pop .sig-ctx-chip` as the same full-width row (9px radius, 8/11 padding, .8rem/600, 190px wide) in a single column. Presentation only and scoped to `.filter-pop` — `#scannerCatChips`/`.sig-ctx-row` keep their markup, ids and handlers, and keep the old chip-row look anywhere outside a pill. Per-category `[data-cat]` colour tints are overridden at rest; selection is the same amber in all three (Mood's own `.mo-confirmed`/`.mo-fighting` reds, `.sig-chip-best.active` violet and the radar `.prime`/`.strong` tier colours are re-asserted so stateful feedback survives). `.filter-pop` gained `max-height:min(58vh,430px)` + `overflow-y:auto` so a long list can't run off-screen, and `.filter-pill:last-of-type .filter-pop` right-aligns — left-anchored the Filters list ended at x=396 on a 390px viewport. v209: `.sc-v-note` sector line inside the verdict bar; dead rules removed — `.sig-dir-row` (wrapper div gone since v222), all `.sc-mood-chip`/`.mood-dot`/`.m-*` and `.sc-conv`/`.sc-pip*` rules. `.scanner-card.sc-confirmed`/`.sc-fighting` glow+dim KEPT.) (v208: `.sc-verdict` top-of-card bar + `.sig-filter-pills`/`.filter-pill` `<details>` dropdowns + `.filter-pop`/`.mood-opts`; v207 `.sc-mood-chip`/`.sc-conv`/`.sc-pip` + `.scanner-card.sc-confirmed`/`.sc-fighting` + `.market-state` banner)
- `index.html` — bump all three `?v=` query strings when deploying UI changes
- `Instruments.txt` — **798 instruments** (736 + 57 Currency 2026-08-25 + 5 Rates 2026-08-29; the "793" that stood here was two additions out of date)

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
   Deliberate daily-only readers are fine unprefixed — `notifItems()` /
   `renderNotifPanel()` read `item.primary_signal` directly because the whole panel is
   daily (it matches push, which is daily-only). **Since 2026-08-30 the panel SAYS so**
   on the 4H timeframe (`.notif-tf-note`): it was previously the one count on screen
   that silently did not move when you flipped timeframe, which is indistinguishable
   from a bug. The Trends tab solves the same problem the same way.
   NB `app.js:6034` still hand-rolls f()'s job as `timeframe === '4H' ? item.h4_… :
   item.…` — correct, but a second implementation of the prefix rule. (Line number
   re-checked 2026-08-30; it was cited as 5006, which is now inside the calendar block.)
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
10. **Finished sessions only (2026-08-04).** The pipeline never computes on a bar whose session is still open. `drop_unfinished_daily` (a daily bar is final once the UTC day after its date has begun) is applied in `main._process_worker` — the read that feeds the indicators, NOT in `fetch_all`, whose frames are used for their keys alone. `drop_unfinished_4h` (a bucket is final 4h after it opens) is applied in `main._resample_4h`. One UTC rule, no per-exchange timetable: every venue closes before midnight UTC on its own bar date. **The cache deliberately keeps the raw bar** so a late-settling volume can still be healed. Why: the 20h freshness gate means only the FIRST of the three daily CI runs downloads, so the whole day is built from one 03:00 UTC snapshot — taken while Tokyo, Hong Kong, Sydney and crypto are mid-session (measured: ASX200 held 28% of its volume, Asian indices 0%, closes off 0.5–1.3%). **Since 2026-09-11 CI sets `FETCH_MAX_AGE_HOURS=1`, so every run downloads** — under the 20h gate later runs finalised a mid-session snapshot as a closed bar (the US bar ~4% complete). Local runs keep the 20h default.
11. **Volume baselines exclude unreported bars** — `indicators._reported_volume` masks zero-volume bars to NaN before the rolling mean. A zero drags the 25-bar average down so the NEXT ordinary bar reads as a spike (cocoa: 60 radar V-events/250d vs AAPL's 7). Never roll your own average off raw `df['Volume']`; read `volume_average`.
12. **`fetch()` re-requests the last cached date** rather than starting the day after it. A run landing mid-session used to freeze that bar forever (41% of cached last bars held short volume). `_append_new_bars` dedupes `keep='last'`, so the corrected bar overwrites the stale one.
13. **An unadjusted split forces a full re-download** (`data_fetcher._unadjusted_split`, 2026-09-11). Appending never rewrites history, but Yahoo re-adjusts it after a split, so MNST (08-11) and APH (09-01) kept pre-split prices and each fired a false S1. Only real splits count (factor ≥1.5 or ≤1/1.5, with a matching one-bar move): Yahoo's split column also carries small corporate-action ratios, and a looser test flagged 80 of 812 caches. **Second check, `_history_mismatch`:** each incremental fetch also re-requests `PROBE_DAYS` (21) of already-cached bars and compares closes; a >25% disagreement means Yahoo re-adjusted history, so the whole history is re-downloaded. Needed because CI's APH cache never received Yahoo's split row, so the first check missed it there. Only bars from the last cached date on are appended — rewriting older bars would step their dividend adjustment. Zero false alarms on 79 tickers across every class (incl. .L pence names and SBK.JO).

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

**Data not updating:** CI cron runs 9×/day weekdays (01:35/07:05/09:35/10:35/13:05/14:35/15:35/17:05/18:05 UTC, landing 2.8–4.9h later due to the GitHub queue → ~08:30/14:00/16:20/17:10/19:35/20:20/21:05/22:05/22:55 SAST) + 1×/day weekends (08 UTC → ~10:00 SAST); ad-hoc runs are manual from the GitHub Actions tab. Stale banner is schedule-agnostic since app.js v231 — it flags `now - summary.fetched_at > 32h`, so publish.yml cron changes need no front-end sync. A FAILED run flips `status.json` on R2 to `state:'failed'` and pushes a failure notification (sw.js checks status.json on every push).

**Update version numbers:** After any UI change, bump `?v=NNN` on `app.js` and/or `style.css` in
`index.html` — there are only TWO now, `utils.js` is gone. A Stop hook
(`.claude/hooks/check_version_bump.py`) warns when one is missed, because the query string is
the only cache-buster: installed phones keep serving the old file until it changes, so a
forgotten bump ships a fix nobody receives while looking deployed from this end.
