# SwingPulse — System Context

> Auto-generated from codebase — reflects actual current file state.
> Update this file whenever the architecture, profile, rules or instruments count changes.
> History (dated feature notes, per-version notes) goes in `CHANGE_NOTES.md`, not here.

**ALWAYS DEPLOY (user, 2026-10-19: "when we make changes just deploy always").**
Every change goes all the way to production without asking: push the branch,
open the PR, merge it once CI is green on the PR (golden AND "Validate and
deploy SwingPulse app", which runs the engine and mobile browser checks before
merge since 2026-10-21; it is skipped when the PR touches no
`swing_generator/` or deploy-app file), then follow the main
deploy-app run to green including "Verify the live app". If a change needs a
data job (e.g. tools/publish_htf.py), run it after the merge. Fix anything
that goes red. Report what is live when done.

**Except Claude's own setup and CI (2026-10-21).** A change to `CLAUDE.md`,
`.claude/` or `.github/workflows/` goes up as a PR for the user to review;
Claude does not merge it. Nothing in CI checks these files, and a wrong rule
here silently changes every later session.

**Change history lives in `CHANGE_NOTES.md`**, newest first: the dated feature
notes that used to open this file, and the per-version notes for app.js and
style.css. Read the entry for a feature before changing it, and add new entries
there. This file holds only what is true now. The entry goes in the SAME PR as
the change it describes and merges with it under ALWAYS DEPLOY (user,
2026-10-21): it is history, not a rule, so it needs no separate review PR.

## What is SwingPulse?

**Current production update (2026-10-07):** 30m, **1H with B1/S1 signals**, and
Daily are active. Hourly uses the existing `_compute_1h_state` / `load_1h` path:
exact MA50/250/500, completed hours only, primary crosses without re-fires,
24-hour signal lifetime, standard confidence (not the retired `1H|` backtest
tiers), no hourly entries in the Daily performance ledger. Hourly currency
indices use the same baskets and daily base as the 5m indices. Daily and 30m
signal rules are unchanged. App data refreshes every 30 minutes while visible
and on foregrounding after that interval; a changed data timestamp invalidates
the chart index and chunks too. UI JavaScript is v481.

`.github/workflows/deploy-app.yml` validates the engine, hourly payload and mobile
browser, then on `main` generates/validates data, uploads R2 and deploys the
existing Direct Upload Pages project `swingpulse200`. It shares the data workflow's
concurrency lock. Pull-request runs validate only (no secrets, no deploy) under
their own per-PR lock; pushes to the other listed branch deploy an isolated
Pages preview only.
Existing Cron Worker schedules are unchanged; no paid service is introduced.
The historical timeframe removals and schedules below are superseded by this note.
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
| Frontend modules | `static/js/modules/` — bounded requests, quote freshness/polling, per-user preferences, equal grid geometry, drawing icons/toolbar, saved-work backup UI |
| Deploy | Cloudflare Pages (UI) + Cloudflare R2 (data files) |
| CI pipeline | Cloudflare Cron Worker dispatches GitHub Actions `publish.yml`. Schedule: **hourly at :05, 24/7**, including weekends, plus a :35 backup that dispatches when no run was created in the last 45 min (2026-10-20) or the recent run has finished without success (2026-10-28); the Worker keeps its logs (`[observability]`, Workers & Pages → swingpulse-cron → Logs); manual runs remain available. See `webapp/cron-worker/wrangler.toml`. |
| Repo | https://github.com/xabilon18-ctrl/SwingPulse — **the only one.** `xabilon18/SwingPulse` was the original prod repo until 2026-06-01 and is now retired: its publish workflow is disabled, it holds no commits this one lacks, and the local `prod` remote was removed 2026-08-27. Manual run: `gh workflow run publish.yml --repo xabilon18-ctrl/SwingPulse --ref main` |

---

## Key Files

```
swing_generator/
├── main.py                    # Signal generator (always runs --profile ma500)
├── config.py                  # MA500 profile: MA50/250/500, thresholds, OUTPUT_COLUMNS
├── _active_config.py          # Thin re-export shim from config.py; ACTIVE_PROFILE='ma500'
├── instruments.py             # Parses ../Instruments.txt → list of {num,ticker,name,group,sector,industry}
├── output_ma500/              # CSV output files (gitignored)
├── cache_ma500/               # Parquet price cache (gitignored)
├── webapp/
│   ├── server.py              # Local Flask dev server → http://localhost:5050
│   │                          # MA_PERIODS imported from _active_config (MA50/250/500)
│   ├── publish.py             # Build + deploy to R2/Pages (PROFILE='ma500', PAGES_PROJECT='swingpulse200')
│   ├── templates/index.html   # SPA shell — bump BOTH ?v= strings on any UI change
│   └── static/
│       ├── js/app.js          # App coordinator and chart renderer (v489)
│       ├── js/modules/        # Price, grids, drawing toolbar, saved work
│       └── css/style.css      # App/component styles (v361)
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
`5m` (5-minute — CHART ONLY, day grid lines, opens on a week) · `D` (Daily — the only signal timeframe)

**2026-09-24 (later): 10m and 3D charts REPLACED by 5m** (user). `chart_feed.build_5m` reads the 5m cache
as-is (`main._frame_5m`, ribbon via `main._m5_ma_periods` = the 10m normalisation at 2x density), carries
one calendar month. `build_10m`/`build_3d` stay for research; their R2 chunks are orphaned.

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
- **Published depth is the whole Yahoo history (since 2026-10-19).** `tools/publish_htf.py`
  (its own job, `publish-htf.yml`, the 3rd-5th of each month) downloads each instrument's
  `period='max'` daily history, not the 13-year Daily cache. Measured on R2 2026-10-28:
  783 of 805 instruments have a Monthly chart, median first bar 2000, 58% start in or
  before 2000, US500 from 1927, BTCUSD from 2015. The ~158-bar (from 2013-07) figure that
  stood here was the hourly feed's depth before that job existed.
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

**CURRENT (2026-09-27): Watchlist · Charts · Alerts · Market.** The list below it is HISTORY.
- **Alerts** (pane `#pane-scanner`, container `#alertsPane`) — every chart marker (30m/1H/4H/Daily
  B1-S1, Daily-MA touches/crosses) newest first, the user's lists first, plus price at/through
  lines they DREW (client-side, from `instChannels` + `wlQuote`). Data: `alerts.json` from
  `webapp/alerts_feed.py`, built inside `chart_feed.build_chart_feed` off the finished bundles.
  Alerts are timed at the bar they could first be KNOWN (a cross confirms `XM_HOLD` bars later)
  — stamping on the crossing bar put the hold hour into the 1h result (77% vs 49% baseline).
  The old scanner markup stays in the pane, hidden by CSS, so nothing that references it breaks.
- **Market** (pane `#pane-dashboard`, container `#marketToday`) — Likely 10-day range + quiet/normal/wild (`market.json` from
  `webapp/market_feed.py`, constants `EXPECTED_MOVE_*` in config.py fitted by
  `research/expected_move_fit.py`), then the kept Dashboard cards: movers, sector rotation,
  market ranking (+ "Open all in Charts"). Other old cards hidden by CSS, not deleted.
- Nothing on either tab asks the user to enter anything (user, 2026-09-27: no journal).

### History
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
| `/api/shape-similarity` | `{neighbours, families, family_of, window_bars}` — which charts look alike, from `shape_similarity.py`. Written GZIPPED under a plain `.json` name (43 KB vs 236 KB); `upload_to_r2` detects the magic bytes and sets `Content-Encoding` |
| `/api/flow` | Capital flow data for a group/region/period |
| `/api/backtest` | Latest backtest results (overall, by_signal, by_tf, by_class, by_instrument, equity_curve, params) |
| `/api/refresh` | POST — triggers a fresh data reload on the server |

---

## Event Calendar — REMOVED (2026-10-21)

User decision: the earnings dates and the rest were not useful and went unused.
Removed end to end: `events.py` (~625 yfinance calls on EVERY hourly run),
`macro_events.py` (FOMC page scraper + FRED), `events.json` / `events.ics`,
the Calendar segment and subscribe link in the bell panel (now just Alerts,
with a bell icon again), the dashboard event banner, card/modal event chips,
the scanner Event filter, Market's "Coming up" card, the service worker's
evening-before warnings, the shape-audit "event feed" gate, the ledger's
`event` tag on new fires (older records keep the field; nothing reads it),
and their tests/fixture/tool. The `FRED_API_KEY` secret is no longer used.
The old `events.json`/`events.ics` objects are left on R2, unreferenced.
The original design notes are in git history (the commit before this one).

---

## Auto-retired instruments (2026-10-17)

An instrument whose last finished daily bar is more than `STALE_INSTRUMENT_DAYS`
(10) behind the run's newest is dropped from that run — Yahoo has stopped
publishing it (EA, FERG.L, QRVO). `main._retire_stale` runs right after the
daily fetch, before the 5m/1h downloads, and writes
`output_ma500/retired_instruments.json` (`instruments`, `fresh`, `outage`).
`instruments.load_instruments()` leaves retired ones out by default, so the
board, summary `expected`, chart feed and sector series agree; `main.py`, the
signal ledger and `backtest.py` pass `include_retired=True`. Nothing is edited
and nothing persists: the file is rewritten every run, so recovered data
restores the instrument. Read it only through `instruments.load_retired()`.
- **Outage guard** (`find_stale`): more than `RETIRE_MAX_PER_RUN` crossing the
  limit within 3 days of each other, or more than `RETIRE_MAX_SHARE` of the
  board stale, is a feed outage — those stay on the board and `health_check`
  stays loud. Long-dead tickers are counted apart, so they never mask a new one.
- **Notification**: `tools/retired_issues.py` (publish.yml step, issues: write,
  continue-on-error) opens a GitHub issue per stoppage, keyed by ticker + last
  bar in a hidden marker, so a hand-closed issue stays closed. It closes an
  open issue only on evidence: the ticker is `fresh` again, or it is gone from
  Instruments.txt. A failed fetch proves nothing and leaves the issue open.

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

## Manual data run from the app — REMOVED (2026-10-21)

The **Run now** button (Alerts & calendar panel + stale banner) and the sync
Worker's `POST /run` / `GET /run/status` routes are gone. User: "remove this
button since we have the 35m thing". Its fine-grained token had expired on
2026-09-29 and the button failed silently for three weeks; the hourly :05
dispatch plus the :35 backup (cron-worker) cover what it was for. The sync
Worker no longer reads `GH_TOKEN`. To start a run by hand, use the Actions tab
(publish.yml → Run workflow). The original design notes are in git history
(commit before this one, and app.js v257–v259).

---

## Cloudflare Config
- **R2 bucket public URL:** `https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev`
- **R2 data path:** `https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev/ma500/`
- **Pages URL:** `https://swingpulse200.pages.dev` (Cloudflare Pages project: `swingpulse200`)
- UI (index.html + static assets) deployed to Pages; data files uploaded to R2 `ma500/` prefix
- `signals.json`, `trends.json` and `backtest.json` are written **gzipped under their plain names** (2026-09-11: 4.59+1.47+1.81 MB → 0.61+0.26+0.26 MB); `upload_to_r2` sets `Content-Encoding: gzip`. Browsers and iOS decode it; a Python reader must gunzip (`tools/shape_audit.py` and `tools/health_check.py` do). `summary.json` is deliberately left plain — `publish-watchdog.yml` curls it. `summary.json` buy/sell counts and `explanations.json` are Daily-based since the same date (were 4H).

---

## Current Versions

> Version numbers are NOT tracked here any more. This section drifted twice: 18
> versions behind once, and by 2026-10-21 it listed two conflicting app.js
> versions (v359, v325) while index.html served v514. The `?v=` strings in
> index.html are the only source of truth:

```bash
grep -oE '[a-z-]+\.(js|css)\?v=[0-9]+' swing_generator/webapp/templates/index.html
```

- `index.html` — bump the `?v=` query strings when deploying UI changes (see Common Tasks)
- `Instruments.txt` — **798 instruments** (736 + 57 Currency 2026-08-25 + 5 Rates 2026-08-29; the "793" that stood here was two additions out of date)
- Per-version history: `CHANGE_NOTES.md`

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
10. **Finished sessions only (2026-08-04).** The pipeline never computes on a bar whose session is still open. `drop_unfinished_daily` (a daily bar is final once the UTC day after its date has begun) is applied in `main._process_worker` — the read that feeds the indicators, NOT in `fetch_all`. Its frames are not fed to the indicators, but `main._retire_stale` does read their last bars (through `drop_unfinished_daily` itself) to find instruments whose data stopped — so keep loading their contents. `drop_unfinished_4h` (a bucket is final 4h after it opens) is applied in `main._resample_4h`. One UTC rule, no per-exchange timetable: every venue closes before midnight UTC on its own bar date. **The cache deliberately keeps the raw bar** so a late-settling volume can still be healed. Why: the 20h freshness gate means only the FIRST of the three daily CI runs downloads, so the whole day is built from one 03:00 UTC snapshot — taken while Tokyo, Hong Kong, Sydney and crypto are mid-session (measured: ASX200 held 28% of its volume, Asian indices 0%, closes off 0.5–1.3%). **Since 2026-09-11 CI sets `FETCH_MAX_AGE_HOURS=1`, so every run downloads** — under the 20h gate later runs finalised a mid-session snapshot as a closed bar (the US bar ~4% complete). Local runs keep the 20h default.
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

**Update version numbers:** After any UI change, bump the `?v=NNN` of every file you changed in
`index.html` — app.js, style.css, each `modules/*.js`, icons, manifest (15 today). A Stop hook
(`.claude/hooks/check_version_bump.py`, which reads that list from index.html itself) warns when one is missed, because the query string is
the only cache-buster: installed phones keep serving the old file until it changes, so a
forgotten bump ships a fix nobody receives while looking deployed from this end.

