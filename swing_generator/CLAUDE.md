# SwingPulse — System Context

> Auto-generated from codebase — reflects actual current file state.
> Update this file whenever the architecture, profile, rules or instruments count changes.
> History (dated feature notes, per-version notes) goes in `CHANGE_NOTES.md`, not here.

**TIME ZONE: SAST (user, 2026-10-28: "Please always use my time zone").** Give every
time in SAST (Africa/Johannesburg, UTC+2, no daylight saving). GitHub, Actions logs,
R2 and cron are UTC: add 2 hours before saying a time, and label UTC wherever it
has to be quoted as the code's own value.

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

**This file holds only what is true now.** If something here disagrees with
the code, the code wins: fix this file in the same PR. The previous 684-line
version (mostly superseded history) is kept verbatim in `CHANGE_NOTES.md`,
entry "2026-11-11 (later) CLAUDE.md REWRITTEN TO CURRENT STATE".
Do not quote version numbers or counts here that a command can give you;
give the command instead.

## What SwingPulse is

A personal swing-trading dashboard. It scans the instruments in
`../Instruments.txt` (indices, commodities, crypto, Currency pairs and
indices, Rates, US/global equities) with a Gann-inspired MA ribbon and serves
the result as a mobile-first web app at https://swingpulse200.pages.dev.

- **One profile, `ma500`**: MA50 · MA250 · MA500. `config.py` is the single
  source of constants; Python modules import them through `_active_config.py`
  (`from _active_config import ...`, never `from config import ...`).
- **Vocabulary:** the asset class is `Currency` everywhere. The only `FX` left
  is TradingView's own `FX:`/`FX_IDC:` exchange prefixes.
- Instrument count: `python3 -c "import instruments as i; print(len(i.load_instruments(include_retired=True)))"`
  (821 on 2026-11-11).

## Timeframes (current)

| Code | Signals | Prefix | Where it is built |
|------|---------|--------|-------------------|
| `1H` | B1/S1, primary crosses, 24-hour signal lifetime, standard confidence | `h1_` | `main._compute_1h_state` / `data_fetcher.load_1h`; chart `chart_feed.build_1h` |
| `D`  | full B1–S4 set | *(none)* | `main.py`; chart `chart_feed.build_daily` |
| `W`  | none (chart only) | — | `tools/publish_htf.py` (`publish-htf.yml`, Mondays) |
| `M`  | none (chart only) | — | `tools/publish_htf.py` (`publish-htf.yml`, 3rd–5th of the month) |

- The tables: `config.TIMEFRAMES` (signal timeframes the run computes),
  `chart_feed.CHART_BUILDERS` (charts the hourly run builds) and `TIMEFRAMES`
  at the top of `app.js` (what the app shows). Loop the tables; never write
  `timeframe === 'X' ? a : b`.
- Hourly entries are NOT added to the Daily performance ledger.
- **Removed, and not to be brought back unless the user asks by name:**
  5m/10m/15m/30m/2H/4H/12H/3D charts and 30m/4H signals. The 5m download
  stays for `quotes.json` and the currency indices. Their old R2 folders are
  deleted by `publish.prune_retired_chart_folders`.
- **Finished bars only.** No timeframe is computed on a bar whose session is
  still open: `data_fetcher.drop_unfinished_daily` / `drop_unfinished_1h`
  and the resamplers drop the bar in progress (a daily bar is final once the
  UTC day after its date has begun). Weekly/Monthly show the last CLOSED
  week/month. The cache keeps the raw bar so a late volume can still heal.

## Signals

- **B1/S1** trend reversal: price crosses above/below all MAs from a
  non-trending state (anchor-gated); re-fires near MA500 within `refire_pct`.
- **B2/S2** pullback recovery through MA50 · **B3/S3** wick at MA250 ·
  **B4/S4** wick at MA500, close confirmed.
- Full rules: `SIGNAL_RULES.md`.
- `signal_confidence` (high/standard/low) is the backtest expectancy of that
  code × timeframe × asset class from `confidence_map.json`, written by
  `python3 backtest.py --since 2016-01-01`, then shifted ±1 by
  `config.CONTEXT_RULES` in `main.apply_context_confidence` (reason in
  `confidence_context`). **Re-run the backtest after any signal-rule change.**
- Column prefix: Daily has none, 1H is `h1_`. In `app.js`, `f(field)` adds the
  active prefix: pass the UNPREFIXED name (`f('volume_spike_flag')`); an
  already-prefixed name double-prefixes and silently reads `undefined`.

## Pipeline and schedule (times UTC as in code; SAST = UTC+2)

- **Hourly data run:** the Cloudflare Cron Worker (`webapp/cron-worker`,
  crons `5 * * * *` and `35 * * * *`) dispatches `publish.yml` at :05 every
  hour, 24/7. The :35 run is a backup that dispatches only when no run was
  created in the last 45 minutes or the latest one finished without success.
  `publish.yml` has no cron of its own. It runs `main.py --profile ma500`
  (with `FETCH_MAX_AGE_HOURS=1`), publishes to R2, then runs `health_check.py`
  and the shape audit.
- **App release:** `deploy-app.yml` on PRs validates only (no secrets). On
  `main` it validates, generates data, uploads R2, deploys the sync and cron
  Workers and the Pages project `swingpulse200`, then checks the live app.
- **Weekly/Monthly charts:** `publish-htf.yml`. **Watchdog:** `publish-watchdog.yml`.
- Stale banner: the app flags `now - summary.fetched_at > 32h`.
- A failed run sets `status.json` on R2 to `state: 'failed'` and pushes a
  failure notification.

## Cloudflare

- R2 data: `https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev/ma500/`
- `signals.json`, `trends.json`, `backtest.json`, `shape_similarity.json` and
  the chart feed are gzipped under plain `.json` names; `upload_to_r2` sets
  `Content-Encoding`. Python readers must gunzip. `summary.json` stays plain
  (`publish-watchdog.yml` curls it).
- Sync Worker (`webapp/sync-worker`): `/sync`, `/sync/auth`, `/sync/backup`,
  `/push/*`. A per-user password token (trust on first use); a blob is merged,
  not replaced; an empty starred list over a populated one is refused (409)
  unless `?allowEmpty=1`; the previous blob is kept at `<user>:prev`.

## App

- Tabs: **Watchlist · Charts · Alerts · Market** (`index.html` nav).
  - Alerts = pane `#pane-scanner`, container `#alertsPane`, data `alerts.json`
    from `webapp/alerts_feed.py`.
  - Market = pane `#pane-dashboard`, container `#marketToday`, data
    `market.json` (`webapp/market_feed.py`) plus movers, sector rotation
    (`rotation.py`) and market ranking.
  - Nothing asks the user to type anything in (no journal; user, 2026-09-27).
- Front end: vanilla JS. `static/js/app.js` is the coordinator and chart
  renderer; `static/js/modules/` holds the extracted pieces. `index.html` is
  the shell.
- **Chart.js is pinned to an exact version with an SRI hash** in
  `index.html`, loaded in `<head>`. Upgrading means changing the version AND
  the `integrity=` in the same edit.
- **Cache-busting:** after any UI change, bump the `?v=` of every changed
  file in `index.html`. The Stop hook `.claude/hooks/check_version_bump.py`
  warns about a missed one. Current versions:
  `grep -oE '[a-z-]+\.(js|css)\?v=[0-9]+' webapp/templates/index.html`
- Helpers to reuse: `formatPrice(val)` and `matchesSearch(item, query)` in
  `app.js`.
- `<body data-profile="__APP_PROFILE__">` is patched to `ma500` by
  `publish.build_ui()`.

## Data rules that have been bitten before

1. **Volume baselines exclude unreported bars:** read `volume_average`
   (`indicators._reported_volume` masks zeros). Never average raw `Volume`.
2. **`fetch()` re-requests the last cached date** and `_append_new_bars`
   dedupes `keep='last'`, so a bar fetched mid-session gets corrected.
3. **Split protection:** `data_fetcher._unadjusted_split` and
   `_history_mismatch` (re-checks `PROBE_DAYS` of cached closes) force a full
   re-download when Yahoo re-adjusts history.
4. **Auto-retired instruments:** an instrument whose last daily bar is more
   than `STALE_INSTRUMENT_DAYS` behind is dropped from that run
   (`main._retire_stale` → `output_ma500/retired_instruments.json`, read only
   via `instruments.load_retired()`), with an outage guard, and
   `tools/retired_issues.py` opens a GitHub issue per stoppage.
5. **`rotation_paper.json` accumulates**: R2 is its source of truth; it is
   not saved when R2 cannot be read.

## Before you push

- Unit and engine checks: the command list in `.github/workflows/test.yml`
  (golden snapshot first: `python3 tests/golden_test.py`).
- Browser checks: `python3 webapp/publish.py --ui-only --build-only &&
  python3 tests/browser_fixture.py`, serve `webapp/publish/ui` on port 8000,
  then `node tests/app_smoke.cjs` and `node tests/saved_work_browser.cjs`.
- Payload shape: `python3 tools/shape_audit.py` (`--only code` for front-end
  vocabulary). `tools/shape_audit_replay.py` re-proves the auditor locally.

## Common tasks

- **Add an instrument:** edit `../Instruments.txt` (pipe-delimited).
- **Add a signal column:** `config.py` `OUTPUT_COLUMNS` +
  `_tf_signal_columns()`, compute in `main.py`, read in `app.js`.
- **Change thresholds:** constants in `config.py`, then re-run the backtest.
- **Local run:** `python3 main.py --profile ma500`; local server
  `cd webapp && python3 server.py` → http://localhost:5050.
- **Manual data run:** Actions → `publish.yml` → Run workflow.
