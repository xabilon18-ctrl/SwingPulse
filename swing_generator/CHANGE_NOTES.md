# SwingPulse — Change Notes

History moved verbatim out of `CLAUDE.md` on 2026-10-21, so `CLAUDE.md` holds only
what is true now. Each entry describes the code AT THE TIME it was written:
versions, counts and file locations may have moved since. Check the code
before relying on one. Add new entries at the top of the first section.

## Dated notes (newest first)

2026-11-13 (19:45 SAST) FULL-SCREEN HEADER ICONS BIGGER, SAME LINE (user,
screenshot of ▲ ▼ bookmark grid ··· ✕: "Make these bigger and same line as
they are"). style.css v429, phone/tablet full screen only
(`#chartFull:not(.desktop-chart)`): buttons 32x34 → 36x38, glyphs ~15 →
21px (··· 24 → 30px), `.cf-main-row` min-height 36 → 40px. Ticker space
167 → 143px at 390px, 152 → 128px at 375px; a long name ellipsises, the
row does not wrap. Desktop header unchanged.

2026-11-13 (19:10 SAST) FULL-SCREEN FOOTER: PAGER LEFT, TIMEFRAME RIGHT
(user, screenshot of the phone full-screen footer: "Switch these buttons").
app.js v635, style.css v428. `chartFullHtml` footer order is now
‹ n/N › · Saved | Draw · ‹ 1H › (was the reverse). `.cf-steps` no longer
takes `margin-left: auto`; `#chartFull .cf-tf-steps` does, so the timeframe
group sits bottom-right. `#chartFull .reel-tf-menu` opens from the right
edge (`right: 0`) so it stays on screen. The card footer is unchanged (it has
no pager).

2026-11-13 (later) 29 JSE MINING / RESOURCES / METAL ETFS ADDED (#830-858)
(user asked which JSE mining and gold names could be added, "even ones
below R50 that might be on EasyEquities and also on Yahoo", then "Add").
Gold GFI HAR ANG SSW DRD PAN; PGM IMP NPH VAL ARI THA EPS WEZ; iron ore,
coal, chrome, diversified KIO EXX TGA S32 GLN AFT MRF MCZ; base metals ORN
CPR JBL_ZA (JBL is Jabil) HLM KP2; ETFs GLD_ZA NGPLT NGPLD. Yahoo was not
reachable from the dev sandbox: any ticker the first data run cannot fetch
shows as missing and must be removed. VAL (ex-AMS, renamed 2025-05-28) may
have short history on Yahoo. Total 823 -> 852.

2026-11-13 TWO JSE STOCKS ADDED: PURPLE GROUP (PPE.JO, #828) AND RAINBOW
CHICKEN (RBO.JO, #829) (user: "If we have purple group and rainbow chicken
in yahoo please add to list"). Instruments.txt only; JSE section 13 -> 15,
total 821 -> 823. Rainbow Chicken listed on the JSE in Oct 2024, so it has
only ~2 years of daily bars: MA500 has barely enough history.

2026-11-13 (08:05 SAST) MONTHLY LADDER ON 1H: TEN PARTS PER 10% (user:
"Let's do 1h by 10"; read as the Monthly ladder, told the user; Daily
ladders on 1H stay at five). app.js v634, sync Worker.
`LADDER_HOME_SUB.M['1H'] = [10]`, `HOME_SUB.M = [10]`: 1H lines and alerts
every 1% (101 a block). Tests: ladder_monthly_sub_checks (nine lines inside
each gap, at tenths), ladder_alerts_test.

2026-11-13 (06:30 SAST) FULL-SCREEN ‹ › TIMEFRAME STEPS (user: "the change
between time frames needs to have an option to screen through times by
clicking right or left like the instrument"). app.js v633, style.css v427.
On the full-screen chart the timeframe pill sits between ‹ and ›
(`data-act="chart-tf-step"`): previous / next chart timeframe in the switch's
order (1H, Daily, Weekly, Monthly), wrapping like the instrument steps, same
instrument, still full screen. The card footer is unchanged (no room). Pill
ellipsises before the footer wraps. Test: tests/chart_tf_step_checks.cjs
(from app_smoke): stepping, wrapping, one footer row at 375 and 390px.

2026-11-13 (06:05 SAST) MONTHLY LADDER: BOLD LABELS, NOT BOLD LINES (user:
"Not the lines bolder only labels"). app.js v632, style.css v426. The
Monthly ladder's own 10% lines go back to their normal weight on W / D / 1H;
their labels get `.reel-ladder-lbl-home` (font-weight 900, as the 0% / 100%
labels). Test: ladder_monthly_sub_checks.

2026-11-13 (05:45 SAST) MONTHLY LADDER ON WEEKLY, BOLD 10% LINES, ALL ON
(user: "make weekly by 2. Then make 10 20 40 bolder and make all active as a
default"). app.js v631.
- `LADDER_HOME_SUB.M.W = [2]`: on Weekly each Monthly 10% gap in two (5%).
- A new Monthly ladder shows on Monthly, Weekly, Daily and 1H;
  `ladderMonthlyAllOnce` (flag `sp-ladder-mw-2026-11-13`) adds the missing
  ones to Monthly ladders drawn before.
- Its own 10% lines are all `.reel-ladder-bold` wherever it is split (W, D,
  1H). "10 20 40" read as every 10% line (told the user).
- Alerts unchanged (1H eighths).
- Test: ladder_monthly_sub_checks (all four on, Weekly halves, bold 10% lines
  at least 1.5x the thirds on Daily).

2026-11-13 (morning, 05:00 SAST) MONTHLY LADDER ON 1H: EIGHT PARTS PER 10%
(user: "Make 1h 8 instead of 6"). app.js v630, sync Worker.
`LADDER_HOME_SUB.M['1H'] = [8]`: 1.25, 2.5, 3.75 ... 10%. Eight does not line
up with the Daily thirds, so 1H no longer shows them (told the user). Labels
and alert %s are exact to two decimals when they are (`ladderPctRound`,
`pctRound`): 1.25 not 1.3; thirds still read 3.3. Alerts `HOME_SUB.M = [8]`,
81 lines a block. Tests: ladder_monthly_sub_checks (seven lines inside each
gap, at eighths), ladder_alerts_test.

2026-11-13 (morning, later) OLD MONTHLY LADDERS DELETED (user, a BTC ladder
not split on 1H like GOLD's: "Has to be the same across", then "that why i
asked for all the old ladders to go"). app.js v629.
`ladderOldMonthlyDeleteOnce` (flag `sp-ladder-oldm-2026-11-13`), once per
device after the first sync pull: every ladder SHOWN on the Monthly chart without
`home` is deleted (shown, not stored: every linked drawing keeps a copy in
every timeframe's list, so a first version that read the M list alone
deleted every linked Daily ladder in the browser test, before release), with its linked copies on every chart. That includes a
Daily ladder whose Monthly chip was on (the user was told). A conversion
pass was built first and replaced before release. Cause on BTC not
confirmed (the sync store could not be read from the session). Test:
ladder_cleanup_checks.

2026-11-13 (morning) NEW LADDERS START WITH THEIR % LABELS (user: "as a
default include the % labels in"). app.js v628. `reelDefaultLadder` no
longer sets `hideLabels`; the % button still hides them; ladders already
drawn keep their setting. Reverses the 2026-11-01 default. In the same
message the user said "delete old ladder only"; asked which ladders, the
question was declined, so nothing was deleted automatically: a ladder on
Monthly and Daily drawn before `home` existed cannot be told from a Daily
ladder with its Monthly chip on. Tests: drawing_toolbar_checks (labels on
when placed, the button hides them), ladder_daily_sub / ladder_monthly_sub
(no longer click the button).

2026-11-13 (later still) MONTHLY LADDER ON 1H: SIX PARTS PER 10%, NOT 15
(user, shown GOLD 1H: "daily and monthly are right but 1h not. Make the 10%
month divided by 6 not 15"). app.js v627, sync Worker. On 1H each Daily
third of a Monthly ladder is halved, `LADDER_HOME_SUB.M['1H'] = [3, 2]`:
1.7, 3.3 (third), 5, 6.7 (third), 8.3, 10%. Alerts: `HOME_SUB.M = [3, 2]`,
61 lines a block. Daily (thirds) and Daily ladders on 1H (fives) unchanged.
Tests: ladder_monthly_sub_checks (one line inside each third on 1H),
ladder_alerts_test.

2026-11-13 (later) MONTHLY LADDER CHAINS DOWN TO 1H (user, after the first
build stopped at Daily: "You need to build on top of the original"). app.js
v626, style.css v425, sync Worker, sw.js.
- A ladder drawn on Monthly now shows on Monthly, Daily and 1H. On 1H it
  keeps its thirds (the Daily lines, `.reel-ladder-mid`, darker labels) and
  splits each third by the original Daily -> 1H five: 15 parts per Monthly
  10% gap, every 0.67%. `LADDER_HOME_SUB = { M: { D: [3], '1H': [3, 5] } }`
  holds tiers; `ladderSubTiers` replaces `ladderSubParts`. Each tier shows
  only while its own gaps are wide enough. Its Monthly 20% lines are not
  bold on 1H (that stays a Daily-ladder mark).
- `ladderMonthly1hOnce` (flag `sp-ladder-m1h-2026-11-13`): Monthly ladders
  drawn earlier the same day (Monthly + Daily only) get 1H added.
- Alerts follow the chain like a Daily ladder's (1H steps): 151 lines a
  block; titles "Monthly 10%", "Daily 3.3%", "1H 2.7%" by tier.
- The user was asked one-level vs all-the-way-down at the start and only
  answered the split; the first build chose one level without asking.
- Tests: ladder_monthly_sub_checks (fifths of each third on 1H),
  ladder_alerts_test (tiers, titles).

2026-11-13 MONTHLY LADDER SPLIT IN THREE ON DAILY (user, asked how to take
the Daily -> 1H ladder "up from daily to monthly", then: "Daily goes into
monthly 10% 3 times. Build it"). app.js v625, sync Worker, sw.js.
- A ladder drawn on Monthly is saved with `home: 'M'`, linked, and shown on
  Monthly and Daily (`channelAdd`). On Daily each Monthly 10% gap is split
  into three: small grey labels 3.3%, 6.7%, 13.3% ... under the big Monthly
  10% labels. `LADDER_HOME_SUB = { M: { D: 3 } }`; `ladderSubParts(d, tf)`
  replaces `ladderSubdivides` and still gives 5 for a Daily ladder on 1H.
- `home` is stored because "shows on Daily" is what makes a ladder a Daily
  one: `ladderIsDaily` is false for a ladder with a home, and the four
  once-per-device passes skip it (not deleted from 1H, not made Thick, not
  dashed). It keeps the new-ladder look (dotted, Thick), which tells it from
  the dashed Thin Daily ladders on the same Daily chart.
- Not on Weekly or 1H unless its chips turn them on; never split there.
  Weekly was asked about and not specified: nothing built for it.
- Ladders drawn on Monthly BEFORE this have no `home` and are unchanged.
- Alerts: `ladder-alerts.js` `HOME_SUB = { M: 3 }`; a Monthly ladder with its
  bell on alerts on its 10% lines ("Monthly 10%") and its thirds ("Daily
  3.3%"), still checked after every hourly run. sw.js opens M or D.
- Told the user beforehand, not acted on: 3 is finer than the sqrt-of-time
  rule of thumb would give (a month moves about 4.6x a day), their call.
- Tests: tests/ladder_monthly_sub_checks.cjs (from app_smoke),
  ladder_cleanup_checks (a Monthly ladder survives every pass),
  ladder_alerts_test (thirds, titles).

2026-11-12 (evening) IPHONE LOCK-SCREEN WIDGET (user: "iPhone widgets like
this on a lock screen ... option to load 8 instruments ... Just the % and
instrument symbol"). New `ios-widget/`: a Scriptable script, not part of the
web app or its deploy. Each lock-screen widget shows 4 instruments (its
Parameter) in a 2 x 2 grid of symbol + today's %; two widgets give 8. The %
is `app.js wlQuote`'s: newest of `/live` and `quotes.json` against `pc`.
Offline it shows the last figures for that Parameter. iOS sets the refresh
(often 15-60 min); it cannot refresh on lifting the phone, which the user
asked for and was told. Look chosen from mock-ups: "Before" (bold symbol,
regular %, frosted tile). Test: tests/lock_widget_test.cjs (not in CI).
ESLint now also lints `ios-widget/` with Scriptable's globals.

2026-11-12 (later still) SHARED CHART PICTURE IS 9:16, NOT 4:5 (user: "Looks
small ... the actual size was fine just need to look pleasant to the eye";
chose 9:16 over 2:3 and the old shape from a mock-up of each opened on a
phone). Opened full screen on a phone, a 4:5 picture filled only about half
the screen. `SHARE_FRAME` now targets 1000 x 1778, a 2000 x 3556 PNG; the
off-screen redraw (`shareStage`) is unchanged. The 4:5 mock-up was judged at
equal widths side by side, which hid this: judge a share shape as it looks
opened on a phone. app.js v624. Checks: app_smoke.cjs (9:16 from full screen
and card).

2026-11-12 (later) LIVE SMOKE WAITS FOR THIS BUILD'S FILES. The #188 deploy
went red after going live: `app_smoke.cjs` ran 9 seconds after the Pages
upload and the new share check got the old 2000 x 4932 picture, although
`validate_hourly_release.py --live` had already seen `app.js?v=623` in the
live index.html. Pages can serve the new index.html while a script still
comes from the previous deployment. The same job passed on its one re-run,
which is also what confirmed the 4:5 picture on the live app. New
`tests/live_release_wait.cjs`: in live mode the smoke test first compares
every .js/.css under the built `webapp/publish/ui/static` with the live
copy, byte for byte, every 5 s for up to 2 minutes, and fails naming the
files if the site never catches up. Any future live check of new behaviour
is covered, not just the share one. Lesson (already in CLAUDE.md under
"Checks that only run AFTER a deploy"): a new assertion in `app_smoke.cjs`
that is not inside `if (!live)` runs against production.

2026-11-12 SHARED CHART PICTURE IS ALWAYS 4:5 (user: "When I share the chart
with somebody, the screen is too long ... make that a standard screen size";
chose portrait 4:5 over square and 16:9 from a mock-up). The picture used to
take the shape of the chart on screen: from a full-screen phone chart it was
about 1 : 2.5, from a card 1 : 1.7. `shareStage(host)` now redraws the chart
off screen in a fixed box (REEL_PHONE_CARD_PX wide, so the 1000-unit phone
layout on every device; height from `SHARE_FRAME` so header + plot + footer
come to 1000 x 1250, a 2000 x 2500 PNG) and `chartToPngBlob` renders that.
Same bars, drawings and price window as on screen: the window is held by a
one-draw `reel.lockY` entry that is put back straight after, and it carries the
live scale's clipped flags so the "ribbon off" tag still prints (`reelScale`
reads them from a lock; real locks never have them). The stage is removed
before the first await. Not being `#chartFullHost`, it has no see-through
header/footer overlap, so the picture no longer has blank plot behind them.
The same price range in a shorter box makes moves look flatter than on a
full-screen chart; that is the cost of the shape. app.js v623.
Checks: app_smoke.cjs (4:5 from full screen and card, live chart unchanged).

2026-11-11 (later) SCROLL BACK PAST THE START OF A CHART (user: "just as i am
able to go forward in time in the charts for all time frames i want to be able
to move back even if it mean going back beyond a start of a chart equally
so"). A sideways drag or trackpad scroll used to stop with the oldest bar on
the left edge. It now carries on by the same share of the window that the
forward scroll has (REEL_FUTURE_FRAC, 90%), on 1H, Daily, Weekly and Monthly,
with at least two bars left on screen. How: `reelSlice(b, bars, offset, lead)`
puts `lead` empty slots (null prices, projected dates) in front of the bars and
lets `_from` go negative, so a slot's index is still its x and every
date-to-x mapping is unchanged; `_bars` is the same slice without them, for
placing a new drawing on real bars. `reelPanLimits` holds the limits;
`reelSetPan(..., free)` lets a scroll (and a saved view) pass the old stop,
while a zoom re-clamps to it as before, so zooming out still squeezes the bars
into the left of the panel. `reel.back` marks a chart scrolled past its start;
only such a chart keeps the blank through a zoom or draws it at all, so a
short-history chart opens exactly as it did. The time grid
(grid-geometry.js) adds the years before the data. A saved view keeps the
position (its `start` is then a projected date before the first bar).
Checks: tests/back_scroll_checks.cjs (run by app_smoke.cjs), time_grid_test.

2026-11-11 (later) LIVE CHECK FOLLOWS THE TIMEFRAME TABLE. The #185 deploy
went live but its "Verify the live app" step failed: `validate_hourly_release.py
--live` recognised the new build by `id="tfBtn1H"` in the page's raw HTML, and
since the timeframe table the buttons are created by app.js, so the string was
never there ("Live UI is still the previous build"). The check now reads the
injected `window.SP_TIMEFRAMES` table: 1H present, 30m and 4H absent. Missed
before merge because `--live` only runs after a deploy.

2026-11-11 (later) LINTERS. `swing_generator/ruff.toml` (E9 + pyflakes, no
style) and `swing_generator/eslint.config.mjs` (eslint:recommended; unused
names warn). ESLint found three undefined names that threw a ReferenceError
when their path ran, all older than this change: loadAll's stale-banner
fallback read an undefined `dateStr` (now summary.json's `date`);
toggleAIFilter called a non-existent computeAndRenderSummary (its button was
gone: deleted); the 'draw-alpha-set' handler used a non-existent DRAW_ALPHAS
(nothing emits that action: deleted). CI wiring is in test.yml (setup PR).

2026-11-11 (later) FAILURES ARE REPORTED, NOT SWALLOWED. app.js reportFailure
/ storeWork / renderSection / spNotice. Saving the user's own work on the
device (watchlists, drawings, saved views, chart layers) shows a one-time
notice if storage refuses it; a failed data load shows a notice (its message
used to go into the hidden Scanner grid); the Market summary and movers say
"Couldn't draw ..." instead of going blank; repaints, sync pushes, the price
refresh and ladder cleanups log "[SwingPulse] <what> failed". Preference
saves stay silent on purpose. 43 empty catches remain, all storage or
pointer-capture guards.

2026-11-11 (later) MINIFIED BUILD + format.js. publish.build_ui minifies
app.js, the modules and style.css as its last step (esbuild 0.25.12 pinned,
--target=esnext: no syntax rewritten). Gzipped app.js ~225 -> ~98 KB,
style.css ~89 -> ~51 KB. Falls back to readable files with a WARN if
esbuild cannot run; SP_NO_MINIFY=1 forces readable. Screenshots of every tab
were pixel-identical to the readable build. Eleven pure formatters moved
verbatim to static/js/modules/format.js.

2026-11-11 (later) DEPENDENCIES PINNED to what production installed (publish
run 1597): yfinance 1.8.0, pandas 3.1.1, numpy 2.4.6, pyarrow 26.0.1, flask
3.1.3. They had been `>=`, so any new release could move the signals with no
commit.

2026-11-11 (later) ONE TIMEFRAME TABLE. `config.TIMEFRAME_TABLE` holds one row
per timeframe with an `enabled` switch; `derive_timeframes()` produces
config.TIMEFRAMES, the hourly chart builders, publish_htf's builders, the R2
prune guard, the local server's routes and the app's list (injected into
index.html as window.SP_TIMEFRAMES; app.js builds TIMEFRAMES, SIGNAL_TFS,
INTRADAY_TFS and the header buttons from it). Daily cannot be switched off.
A deleted timeframe still needs its code restored from git first.
Hourly-specific behaviour (1H events, validators, backtest) still names 1H.

2026-11-11 (later) HIDDEN SCANNER/DASHBOARD, CHART.JS AND RETIRED BUILDERS
DELETED. The old Scanner and Dashboard (hidden by CSS since 2026-09-27) were
still built on every data refresh; renderAll and the tab switch no longer
build them and renderDashboard draws only rotation and ranking. 69 app.js
functions and 35 wiring statements that nothing could reach were deleted
(found with an acorn call graph), with their markup and the CSS that hid it:
app.js 15,273 -> 13,058 lines. Chart.js is no longer loaded: it was used only
to set two defaults for the hidden gauge, and a CDN failure made
Chart.defaults throw inside renderDashboard. Engine side: the chart builders
of retired timeframes (2H, 12H, 3D, 10m, 15m, 30m), their server routes and
helpers, and five other functions nothing called. Kept: fetch_all_hourly
(/refresh-data uses it), the resamplers the golden test exercises,
sectorMenuHtml (stock_view_test exercises it), main.OUTPUT_COLUMNS
(hourly_test reads it). Four instrument names put into innerHTML unescaped
(trend detail, timeframe menu, share preview) now go through escText
(CodeQL). app.js v617, style.css v423. PR #184.
2026-11-11 (later) CLAUDE.md REWRITTEN TO CURRENT STATE. The system-context
part of `CLAUDE.md` had grown to 684 lines of mostly superseded history and
contradicted itself (app.js v481 and v489 against v615 served; "Daily is the
only signal timeframe" while 1H signals were live; three run schedules; 798
instruments against 821 in Instruments.txt). The old text is kept below
VERBATIM (headings demoted two levels so they nest under this entry); do not
treat any of it as current.

<details><summary>Old CLAUDE.md system context, as of commit f353e5e</summary>

#### What is SwingPulse?

**Current production update (2026-11-11):** **1H with B1/S1 signals** and
Daily are the only timeframes the data run computes; Weekly and Monthly are
charts on their own schedule. 30m and 4H were removed from the run on
2026-11-11 (user: "30m and 4h must go"): no `m30_`/`h4_` columns, no 30m
chart chunks, no 4H ledger fires. The 5m download stays for quotes.json and
the currency indices. Do not bring 30m or 4H back without the user asking
for it by name. Hourly uses the existing `_compute_1h_state` / `load_1h` path:
exact MA50/250/500, completed hours only, primary crosses without re-fires,
24-hour signal lifetime, standard confidence (not the retired `1H|` backtest
tiers), no hourly entries in the Daily performance ledger. Hourly currency
indices use the same baskets and daily base as the 5m indices. Daily
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

#### Stack at a Glance

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

#### Key Files

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

#### Config / Profile System

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

#### Signal System

##### Timeframes
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

##### Column Prefix Convention
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

##### Signal Types (B = buy, S = sell — see signals.py, full rules in SIGNAL_RULES.md)
- **B1/S1** — Trend reversal: price crosses above (B1) / below (S1) **all** MAs from a non-trending state (anchor-gated); re-fires near MA500 within `refire_pct` for 10 days
- **B2/S2** — Pullback recovery: dipped below MA50 in-trend, closed back above (mirror for S2)
- **B3/S3** — Mid-ribbon bounce/rejection: wick touched MA250, close confirmed
- **B4/S4** — Anchor bounce/rejection: wick touched MA500, close confirmed

##### Signal confidence — backtest-driven (2026-07-09)
`signal_confidence` (high/standard/low) is the measured backtest expectancy of that signal code
on that timeframe + asset class — looked up from `confidence_map.json` (generated by
`backtest.py --since 2016-01-01`). high = avg ≥ +0.05R, low = negative expectancy.
Re-run the backtest after any signal-rule change so the map stays honest.

**Context modifiers (edge-audit phase 3a, 2026-07-15):** after the base tier, `main.py
apply_context_confidence()` shifts it ±1 per matching `config.CONTEXT_RULES` entry (D B1
overbought/disordered −1, D B2 chasing −1 / weakness +1, D S3/S4 rollover-stage-2 +1).
Reason written to `confidence_context`. Rules mined by `edge_audit.py`; see `SIGNAL_RULES.md`
§4a and `EDGE_AUDIT_PHASE3.md`. Phase 3b (ATR/volatility rules, 4H alignment) deferred.

##### Key Computed Fields (per timeframe, via `_tf_signal_columns`)
`primary_signal`, `secondary_signal`, `confirmation_status`, `signal_confidence` (high/standard/low), `confidence_context`,  
`trend_direction` (UPTREND/DOWNTREND/NEUTRAL), `established_trend`, `trend_run_days`,  
`tf_alignment`, `tf_alignment_score`, `ma_order_score`,  
`ribbon_compression`, `ribbon_spread`, `ribbon_slope_pct`,  
`volume_spike_flag`, `roc`, `rsi`,  
`last_signal_type`, `last_signal_date`, `last_signal_days_ago`,  
`watch_flag`, `potential_turning_point_flag`,  
`rollover_score`, `rollover_max`, `rollover_dir`, `rollover_stage`

##### Intraday-only Fields
Gated on `config.INTRADAY_PREFIXES`, **not** on "does it have a prefix" — those meant the
same thing only while 4H was the sole prefixed timeframe. A weekly bar IS its week-ending
date, so Weekly carries no `datetime`, exactly like Daily.

`h4_datetime` — the exact 4H bar timestamp (2026-07-27). `h4_date` alone is ambiguous:
a date holds 2–6 four-hour bars, and the ledger resolved a 4H fire to the LAST bar of
that date, which (runs land midday) is typically 1–5 bars after the bar that fired — so
every graded 4H trade was entered up to a session late. Emitted only when a prefix is
set (`main.py _extract_row`); daily bars are unique by date.

##### Daily-only Fields
`ma_fast_cross_count`, `neutral_oscillation`, `new_trend_flag`,  
`pct_1d`, `pct_1y`,  
`key_level_price`, `key_level_type`, `key_level_date`, `key_level_touch_count`, `key_level_touched_today`, `key_levels_all` (live since 2026-07-09 — computed by key_levels.py on the last 1500 daily bars)

##### Dead columns (kept for payload compatibility, always empty)
`watch_flag`, `potential_turning_point_flag` — their UI (Analyzed alert tabs, counters) was removed 2026-07-09.

---

#### Frontend App Tabs

**CURRENT (2026-09-27): Watchlist · Charts · Alerts · Market.** The list below it is HISTORY.
- **Alerts** (pane `#pane-scanner`, container `#alertsPane`) — 1H and Daily B1-S1 and pullback
  alerts newest first (the Daily-MA touch/cross alerts were read from 30m and went with it on
  2026-11-11; see `alerts_feed._events_for`), the user's lists first, plus price at/through
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

##### History
1. **Dashboard** — Market gauge, stat cards, signal feed, alignment summary
2. **Scanner** — Instrument grid with filters: class (incl. **Rates**, see `browseClassOf`), group, sector, trend, alignment, confidence, signal codes, key levels, vol spikes, **scheduled events** (`#eventChip`)
3. **Analyzed** — Instruments the user has technically analyzed (star = "I analyzed this") + alert sub-tabs (turning points, watch flags, key levels, vol). Pane id is still `pane-watchlist` and storage key is still `swingpulse-starred` — only the UI label changed.
4. **Trends** — Trend history per instrument (timeline, stats, maturity)

> Note: **Portfolio** tab was in the old CLAUDE.md but is not present in the current `index.html` nav. The `/api/portfolio` endpoint this file used to describe **does not exist** — there is no such route in `server.py` and no such call in `app.js` (checked 2026-08-30). Nothing fetches XM positions.
> A **Flow** section (`window._renderFlow`) renders inside the Dashboard pane via `initFlowTab()` — it is not a top-level nav tab.

---

#### API Endpoints (served by `server.py` locally and as static JSON by `publish.py`)

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

#### Event Calendar — REMOVED (2026-10-21)

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

#### Auto-retired instruments (2026-10-17)

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

#### Cost line and price-feed check (2026-09-11)

- **`{p}atr_pct`** ships for every timeframe: ATR(14) as % of close from `main._atr_pct`, which
  is `backtest._add_atr`'s definition exactly (checked to within 0.0005pp on AAPL, GC=F,
  BTC-USD, VOD.L, ^GSPC). The card doubles it into the 2×ATR stop.
- **RETIRED the same day with hourly data.** `data_checks.json` (main.py step 2b) flagged an
  instrument when its daily close and the last hourly close of the same date differ by >3% on
  10+ of the last 60 shared dates. Skips crypto, SPAIN35, futures (`=F` — the daily bar is the
  settlement; the first run flagged six futures and nothing else) and H4_SOURCE redirects.
  It does NOT catch unadjusted splits — both caches carry them alike; `_history_mismatch` does.
  In `health_check.py` TIMESTAMPED.

#### Sector rotation wheel + market ranking (2026-09-11)

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

#### Sync: the starred list can no longer be wiped (2026-08-29)

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

#### Manual data run from the app — REMOVED (2026-10-21)

The **Run now** button (Alerts & calendar panel + stale banner) and the sync
Worker's `POST /run` / `GET /run/status` routes are gone. User: "remove this
button since we have the 35m thing". Its fine-grained token had expired on
2026-09-29 and the button failed silently for three weeks; the hourly :05
dispatch plus the :35 backup (cron-worker) cover what it was for. The sync
Worker no longer reads `GH_TOKEN`. To start a run by hand, use the Actions tab
(publish.yml → Run workflow). The original design notes are in git history
(commit before this one, and app.js v257–v259).

---

#### Cloudflare Config
- **R2 bucket public URL:** `https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev`
- **R2 data path:** `https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev/ma500/`
- **Pages URL:** `https://swingpulse200.pages.dev` (Cloudflare Pages project: `swingpulse200`)
- UI (index.html + static assets) deployed to Pages; data files uploaded to R2 `ma500/` prefix
- `signals.json`, `trends.json` and `backtest.json` are written **gzipped under their plain names** (2026-09-11: 4.59+1.47+1.81 MB → 0.61+0.26+0.26 MB); `upload_to_r2` sets `Content-Encoding: gzip`. Browsers and iOS decode it; a Python reader must gunzip (`tools/shape_audit.py` and `tools/health_check.py` do). `summary.json` is deliberately left plain — `publish-watchdog.yml` curls it. `summary.json` buy/sell counts and `explanations.json` are Daily-based since the same date (were 4H).

---

#### Current Versions

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

#### Deploy Commands

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

#### GitHub Actions Pipeline

| File | Profile | Cron | Cache |
|------|---------|------|-------|
| `publish.yml` | ma500 | `35 1/9/14 * * 1-5` + `0 8 * * 6,0` (weekday **3×**, weekend 1× UTC; :35 dodges GitHub's top-of-hour queue) + manual | `cache_ma500/` |

- Runs `python3 main.py --profile ma500` → uploads data to R2 → sends push notification with `X-Profile: ma500`
- No UI deploy in CI — deploy UI manually with `--ui-only`

---

#### Important Rules When Editing

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

#### Common Tasks

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

</details>

2026-11-11 (later) RETIRED CHART FOLDERS DELETED FROM R2 (user: "Remove the
old chart folders on R2 too"). `publish.prune_retired_chart_folders` deletes
`ma500/chart/<tf>/` for every `RETIRED_CHART_TFS` (5m, 10m, 15m, 30m, 2H, 4H,
12H, 3D) after a successful hourly upload. It runs from the hourly publish
because that job holds the only Cloudflare token with R2 rights (the session
token answers "Authentication error" on R2). It refuses to touch 1H, D, W, M
or anything in `chart_feed.CHART_BUILDERS`; once every key is gone the R2
manifest records it (`retired_pruned`) and later runs make no R2 calls for
it. Never fatal: a failure leaves the files and retries next run. Saved
drawings are in the sync store, not on R2, so none are affected. Tests in
tests/htf_feed_test.py (RetiredChartPruneTests).

2026-11-11 (later) MOCKUPS AND THE OLD WIDGET SCRIPT DELETED (user: "Remove
the mockups and unused files too"). Removed `webapp/mockups/` (4 pages),
`webapp/v2-mockups.html`, `webapp/preview_charts.html` and
`webapp/SwingPulse_Widget.js` (a Scriptable home-screen widget that still
pointed at the retired swingpulse.pages.dev address): 4,291 lines. Nothing
in the build, the app, the local server, the tests or CI referenced any of
them; `publish.build_ui` copies only `static/` and `templates/index.html`.
KEPT: `proxy.js` at the repo root, which `.claude/launch.json` starts for the
local preview. Not touched: the hand-run scripts (`plot_*.py`,
`edge_audit.py`, `research/`, `tools/place_channels.py`, `tools/gen_icons.py`)
and the local-server shell scripts.

2026-11-11 30m AND 4H REMOVED FROM THE DATA RUN (user: "30m and 4h must
go"). The app had had no 30m or 4H button since 2026-11-07 and read none of
this; every hourly run still computed and uploaded it. Gone: `30m` and `4H`
from `config.TIMEFRAMES`; the `m30_` and `h4_` columns (signals.json 186 →
102 columns); the 30m chart chunks (`chart/30m/`, 164 files a run), their
markers, `events_by_tf['30m']` and `ev15` in chart/index.json; the `30m`
trend read and the `30m` currency-focus block in trend_channels.json;
`m30_fires.json`; 4H fires in the signal ledger (older 4H records stay and
open ones keep being graded). Deleted from main.py: `_compute_30m_state`,
`_compute_15m_state`, `_compute_4h_state`, `_h4_signal_frame`,
`_process_30m`, `_m4h_ma_periods`. The golden snapshot dropped its 12 4H
frames (36 → 24); every Daily and 1H frame is byte-identical. The stored
30m charts in the CI cache are deleted on the next run
(`Store.drop_other_timeframes`).
ALERTS: the Daily-MA cross / touch alerts (X / T) were read from the 30m
bundle and tagged `30m`. The Alerts tab has listed only 1H and Daily since
2026-11-04, so they were being built (783 of 1,439 events on 2026-11-11)
and never shown. They are no longer built; the visible Alerts tab is
unchanged. The 1H chart still draws its Daily-MA marks. alerts_feed.py
`_events_for` says how to list them from 1H if wanted.
KEPT: the 5m download (quotes.json and the currency indices read it);
`_frame_30m` / `build_30m` and `_frame_4h` / `_resample_4h` (local server,
backtest.py, ledger grading, research); the old `chart/30m/` and `chart/4H/`
objects on R2, unreferenced. The app is unchanged, so no `?v=` bump.
tools/validate_hourly_release.py and validate_workflow_release.py now fail
if a 30m trend read, 30m chart events or `m30_`/`h4_` columns come back.

2026-11-10 FULL-SCREEN HEADER AND FOOTER: NO BAND, BIGGER HEADER TEXT:
style.css v422. User: "Make the footer and the header not to have borders ...
let them be over the charts ... they must remain static and not move ...
they mustn't look like they have something holding them". On the phone's
full screen the 55% white strip behind the header and footer (2026-11-05) is
removed: its edge read as a line across the chart. The words, icons and
buttons sit straight on the chart with a stronger white halo (text-shadow on
letters, drop-shadow on icons) so they stay readable over candles and grid
lines. They were already fixed to the screen, outside the chart's pan layer;
nothing in reelLayout changed. Header text "a little bit bigger, but not out
of place": ticker 16 → 19px, timeframe 11 → 13px, full name 12.5 → 14.5px,
trend / Updated row 11 / 10 → 12.5 / 11.5px. Footer sizes unchanged (user:
"The footer is fine"); its button outlines are kept. Desktop unchanged.
app_smoke now asserts no background, no border and the 19px ticker.

2026-11-09 (later) LIVE CHECK: OVERLAY WIDTHS READ ONLY WHEN SETTLED.
tests/chart_readability_browser.cjs ("Verify released chart weights", main
only) failed "each overlay family changes width" on the #168 and #175
production releases, passing on a re-run. It clicked Thin/Medium/Thick and
read every overlay polyline's width at once, then compared by index: the
repaint could still be pending, or the Weekly/Monthly lines could land
between reads, so index i named different lines (the flaw the projection
check below it was already fixed for). It now waits for four identical reads
250 ms apart (and, after a width change, a read different from the last),
and asserts the three reads hold the same number of lines. The app is
unchanged.

2026-11-09 (later) BLUE BARS DEFAULT 2x: app.js v615. User, live on v614:
"Above average" made almost everything blue (39% of Daily bars, and on a
dense phone chart the blue drawn over black looks like more). Shown the
measured rates (2x: ~5% Daily, 3% Weekly, 2% Monthly; 1.5x: 12/10/7.5%), the
user picked "2x by default, 1.5x as the option". Above average is removed as
a choice; a stored 1 (or nothing) reads as 2.

2026-11-09 BLUE BARS ON HIGH VOLUME: app.js v614, style.css v421. User: "turning
the daily, weekly and monthly volume candles or bars blue whenever volume is
above average? But this must have switch for on and off".
- A price bar is drawn in --reel-bar-vol (blue; lighter blue on the dark
  theme) when its volume is above k x the mean of its own last 25 reported
  bars (VOLUME_LOOKBACK, the VOL SPIKE average; zero = unreported). Not the
  flat on-screen average the volume strip used: that marked most of BTC's
  last 5 years and all of GOLD's last month.
- Grid menu switch "Blue bars on high volume" on Daily/Weekly/Monthly, with
  Above average (k = 1, the user's spec, the default) or 1.5x average.
  Stored as tfOverlay.volBlue (0 off) with the other chart settings.
- Measured over every instrument's last 520 bars: above average marks ~39%
  of Daily bars (41% Weekly/Monthly); 1.5x marks ~12% Daily, 10% Weekly,
  7.5% Monthly. Shown to the user with both pictures.
- No blue on the `novol` futures (contract-switching volume) or on
  instruments without volume. The volume strip itself stays off.

2026-11-09 (latest) TREND MAs REMOVED: app.js v613, style.css v420. User:
"Remove it completely". The Trend MAs row and reelTrendBundle (v612, entry
below) are gone; 1H and Daily draw the published 50/250/500 again. app.js,
style.css and app_smoke.cjs are restored to their v610 content (only the
version strings move, so installed phones fetch them). A saved
`tfOverlay.trend` value is dropped on the next load (the loader no longer
keeps it). The overlay sets of v611 had already been removed in v612.

2026-11-09 (later still) LIVE CHECK: SHORT-CHANNEL TEST NO LONGER DRAGS ENDS
UNDER THE HEADER. "Verify the live app" failed on the #172 and #173 releases
at drawing_toolbar_checks "Short channel: end handle a can be touched"
(got ""). Reproduced locally against live R2 data: the first live chart
(SA40 1H) seeds its channel near the top of the plot, the CHANNEL ENDS step
dragged each end 40px UP, which put both ends under the chart header, so
the touch landed on the header. The ends are now dragged 40px toward the
middle of the plot. Test-only change; the app is unchanged.

2026-11-09 (later) TREND MAs 50/250/500, 200/400/600 OR 300/600/900: app.js
v612, style.css v419. The user's request was for the chart's OWN trend lines
("this feature is for the trend line MAs"), not the overlay, so the overlay
sets from v611 (entry below) are removed again and the overlay is back to
3 MA / 5 MA / 9 MA. A "Trend MAs" block under Overlay MAs sets the chart's
own three lines on 1H and Daily with one choice (user: "For daily and 1h.
Don't apply in weekly and monthly"; TREND_TFS), saved as `tfOverlay.trend`
with the overlay and the work backup. Weekly and Monthly keep 50/250/500.
- Lines only. Signals, trend labels, alerts, the ledger and the payload stay
  on the pipeline's 50/250/500; nothing in chart_feed changed.
- reelTrendBundle() swaps the bundle's ribbon at the top of reelChartSvg,
  so the ribbon, its shade and the price fit all follow it. The periods are
  rolled from the bundle's own closes at the ribbon's sample points (scaled
  by the bundle's fast period, so a normalised ribbon keeps its proportion),
  memoised per bundle in a WeakMap. A line starts once that many bars exist
  in the bundle: an MA900 covers the last ~400 Daily bars of 1,300. The forming bar carries the
  last value (its own MAs are for 50/250/500).
- v611's `trio` key was never kept by the overlay loader's whitelist; `trend`
  is added there.

2026-11-09 TWO MORE 3-LINE OVERLAY SETS: app.js v611, style.css v418.
User: "200, 400 and 600 and the second one is 300, 600 and 900 ... this
feature has to work across if i change it ... put them below the overlay
MAs". OV_SETS gains `t200` [200, 400, 600] and `t300` [300, 600, 900]. The
MA set row still reads 3 MA · 5 MA · 9 MA; a new "3 MA" row under it offers
50·250·500 · 200·400·600 · 300·600·900. A trio tap selects it (and lights
3 MA); the 3 MA button brings back the trio last chosen (`tfOverlay.trio`).
Like the other sets it is one choice for every chart timeframe and is saved
with the overlay (`sp-overlay`, work backup).
- Daily 600/900 are rolled from the Daily bundle's closes like 100/200/300
  (1,300 bars: a D900 covers the last ~400 days).
- No bundle ships W or M 600/900 (chart_feed.OVERLAY_MA_PERIODS stops at
  500, and a Weekly 900 is ~17 years, past the 13-year Daily cache). When
  the set needs one, the app loads the Weekly chart's chunk (~25 years) and
  rolls the Weekly lines from it, as it already did for Monthly from the
  Monthly chart (ovDeepMonthly generalised to ovDeepRoll; a week is labelled
  by its Friday). Monthly 600/900 (50/75 years) draw only where the Monthly
  history is that long (e.g. US500). No pipeline or data change; the Near MA
  filter still knows periods up to 500 only.

2026-11-08 (evening) SAVED VIEWS FOLLOW THE DEVICE, NOT THE WINDOW: app.js
v610. User: "the saved zoom for phone and laptop are independent... it
currently not working probably. Fix". v605 picked the phone or computer key
(NAME|TF vs NAME|TF|L) from desktopChartMedia, the WINDOW width, so a laptop
browser narrower than 1024 px read and wrote the PHONE's views, and resizing
across 1024 swapped the two sets mid-session. Reproduced on v609 in Chromium
(laptop screen 1470x956, window 900 wide: opened the phone's saved BTCUSD
frame). Now `viewOnComputer` is decided once from the SCREEN's short side
(< 600 px = phone; every iPad = computer), which no resize or rotation
changes; the same check on v610 opens the laptop's own frame, and the phone
still opens its own. Layout still follows the window. Views a narrow laptop
window saved before this are stored as the phone's and stay there.

2026-11-08 (evening) VOLUME STRIP OFF: app.js v609. User: "Let's turn it off
till I figure out a way to read it". REEL_VOLUME_ON = false: no strip is
drawn and no band is reserved (stripH 0), so the price plot gets the space
back on every timeframe. The trend strip is NOT restored (it was removed at
the user's request). All volume-strip code, the overflow cap and the `novol`
list in chart/index.json stay; set REEL_VOLUME_ON = true to bring it back.

2026-11-08 (later) NO VOLUME STRIP ON CONTRACT-SWITCHING FUTURES: app.js v608.
User, after the reason was shown: "Yes build it and deploy". chart_feed
volume_unreliable(): over the last 520 Daily bars, p90/p10 of reported
volume > 50 AND 10+ day-to-day swings of 10x either way. Measured on all 737
instruments with volume: median p90/p10 3.1; the ten metal/crop futures
126-2,848 with 15-94 swings; ZECUSDT 142 with 0 swings (real growth, kept);
everything else under 34. Live data lists exactly COCOA, COFFEE, CORN,
COTTON, GOLD, PALLADIUM, PLATINUM, SILVER, SOYBEANS, WHEAT; energy futures
(CL/BZ/NG/RB/HO, p90/p10 3-4) and copper (5) keep their strip.
- The list ships as `novol` in chart/index.json (built from the D bundles);
  the app leaves the strip empty for those names on D, W and M. Daily decides
  for all three because on 10-year Weekly bars fast-growing small caps (QUBT,
  WULF, OKLO...) trip the same rule on real growth.
- reelLoadChunk on W/M now also awaits the main index so `novol` is there.
- Self-healing: if a feed is fixed, the next hourly build drops the name.
- Tests: htf_feed_test VolumeQualityTest.

2026-11-08 (later) VOLUME OVERFLOW CAP: app.js v607. User on GOLD, live v606:
"Does not look ok... way to over". Bars may now rise at most REEL_VOL_OVER
(1) band height above the band, not to the frame top. Cause on GOLD (GC=F):
Yahoo reports the CURRENT front contract's volume, so the series swings from
~360 contracts/day (a thin delivery month; median over the last 1,400 bars)
to 120k-240k when the active month is front (every day since mid-Oct 2026).
Against the window's flat average, every recent bar was ~20x. The cap fixes
the drawing; the data itself is still not a real volume series for =F
futures (asked the user how to handle them).

2026-11-08 VOLUME STRIP REPLACES THE TREND STRIP: app.js v606, style.css v417.
User: "remove the trend line strip, then replace it with the volume at the
bottom ... daily volume, weekly volume, and monthly volume ... a dash ... in
black ... indicating the average for that instrument". reelTrendStripSvg is
gone; reelVolumeStripSvg draws in its band (reelLayout's stripY/stripH).
- One bar per price bar from the band floor; one dashed line across the band
  at the MEAN REPORTED VOLUME OF THE BARS ON SCREEN (zero = unreported, as in
  indicators._reported_volume), so it is straight, as asked, and moves with
  pan/zoom. It is NOT the 25-bar rolling average behind volume_spike_flag, so
  the two can disagree; on a 10-year Weekly the flat line mostly separates old
  low-volume years from recent ones (shown to the user, who chose it).
- Band top = REEL_VOL_CAP (3.2) x the average on every chart, so the line sits
  ~31% up with room above it ("give the volume room to breathe", then "a
  little bit of room of the average" on all of them). A bigger bar
  is not capped: it rises over the price chart (to the frame top at most), as
  the user asked, and the strip is drawn under bars/ribbon/drawings so it never
  covers a candle. Band height max(130, 14% of the viewBox height).
- Bars: --reel-bar at 80% opacity, width 45% of the bar slot (0.9-1.8 units);
  "not gray and not too black": on a 520-bar phone Daily a slot is under a
  pixel, so the tone is width x opacity and thinner/fainter reads grey.
- Daily, Weekly, Monthly only (REEL_VOL_TFS; their bundles already carry `v`).
  1H ships no volume and instruments without volume (currencies, some indices)
  leave the band empty; it stays reserved so the plot never jumps.
- reelSlice now carries `v`. The average's value sits in the price gutter.
- Today's still-open daily bar is drawn as is, so it reads short until close.

2026-11-08 SAVED VIEWS PER DEVICE: app.js v605. User: "make sure the computer
zooms do not affect the phone zooms and the other way round". A saved view
was one key per chart and timeframe (NAME|TF), synced to every device, so a
Save on the laptop replaced the phone's frame and the other way round.
- The laptop / iPad workspace (desktopChartMedia, the switch that picks that
  layout) now saves under NAME|TF|L; the phone layout keeps NAME|TF, so every
  view saved before this stays the phone's. Both still sync. New records carry
  `device: 'phone' | 'computer'`; research/read_views.py reads the suffix.
- Verified against live data: phone save SA40 Daily (403 bars from 21 May),
  laptop opened on its default view with Save off, laptop save went to
  SA40|D|L, phone reopened on its own 403-bar frame.
- The laptop starts with no saved views of its own; save once there.

2026-11-07 (evening) PHONE LINE WEIGHT EVERYWHERE, TRACKPAD GESTURES, ZOOM
OUT PAST THE DATA: app.js v604, style.css v416.
User: "this on the laptop and the tablet is not the same size line on the
phone please fix it"; "make my charts on the laptop responsive to the ...
mousepad gestures"; "compress ... all the way ... for all time frames" and
"allow me to compress further than what i am able to".
- Line weight: a viewBox unit is 0.36 CSS px on the user's iPhone 13 card
  (360 px) but 0.52 on every chart wider than REEL_PHONE_CARD_PX, so every
  line drew ~1.45x thicker on the iPad and laptop (measured live, SA40 Daily:
  MA 0.85 / 1.27 px, bars 0.52 / 0.78, grid 0.34 / 0.52). After each paint,
  reelMatchPhoneStrokes scales every visible stroke on a wide chart by 360/520,
  so the laptop now measures the phone's pixels (MA 0.88, bars 0.54, grid
  0.36, admin 0.72 at 1440 wide vs the 390-wide phone). Text, label halos,
  hit targets and the CSS-px dot spacing are untouched; phones (card and full
  screen) draw exactly as before. The desktop-only guide weights/opacities
  (`#chartFull.desktop-chart .reel-tgrid` etc.) are removed for the same reason.
- Trackpad / wheel, laptop workspace and full screen only (a phone-feed card
  keeps the wheel for scrolling): two fingers up (wheel down) compress time,
  down expand; sideways moves through history; pinch (ctrl+wheel, Safari
  gesture events) apart expands, together compresses; one axis per gesture.
  Press-and-hold then move was already the pointer pan; it now shows a grab
  cursor and stops on release (verified with a real mouse drag).
- Zoom out: reelMaxBars allows 3x the bars carried (REEL_ZOOM_OUT_PAST_DATA)
  on every timeframe; past the data the bars squeeze to the left with blank
  future after them. reelSetPan no longer has a dead zone there. The old 10m
  cap is gone with the 10m chart.
- Tests: chart_readability_browser expects Thick = 7 x 360/520 units at
  1366 wide (7 on phones); chart_refresh_test stubs the new helper.

2026-11-07 (later) DOTS: SPACING ONLY, THICKNESS BACK: app.js v603,
style.css v415. User, after #164: "I just asked for the spaces to be closed
in, and you just went and made them a little bit bigger and darker ... the
size is way too big on ours. Now you just went and made it even much more
bigger". #164 had also forced every dotted line to at least 1 CSS px thick,
solid black, and heavier still on Medium / Thick — not asked for.
- Removed: all thickness (`--dw-*`) and opacity overrides. Every dotted
  line is back to the exact thickness and colour it had before #164
  (measured, iPad 750: timeline 0.52 px, channel edge 0.73, midline 0.52,
  last-price 0.83 — the same as before #164).
- Kept: only the dot length and gap, in CSS px whatever the screen
  (`--dd-*`). The user then picked option C from four drawn side by side
  (original; 1.5 / 2.5 as TradingView; 1.2 / 2; 1 / 1.5): 1.2 / 2 on every
  dotted line, 1.6 / 2 for Medium channel edges, 2.4 / 2 for Thick channel
  edges and the 1H bold 20s (a heavy line with a short dot reads as bars).
  Square ends.
- Tests: dotted_lines_checks now asserts 1.2 / 2 AND the old thickness;
  ladder_dash_checks reads `--dd-s`; chart_readability_browser is back to
  its pre-#164 form.

2026-11-07 TRADINGVIEW-STYLE DOTS: app.js v602, style.css v414,
drawing-toolbar.js v13. User, TradingView and SwingPulse iPad screenshots
side by side: "The dots look properly close together and tiny ... mine ...
the spaces in between them is big ... Anything that's a dot, please make it
look like that" (percentage lines, channels, timelines ...).
- Measured on the screenshots (CSS px): TradingView dot 1 thick, 1.5 long,
  2.5 gap, solid black. Ours: 2 long, 5-5.5 gap, under 1 px thick (so it
  drew grey), and set in viewBox units, so the size changed with the screen
  (iPad 0.52 px per unit, phone 0.38).
- `reelLayout` returns `u` (viewBox units per CSS px); `reelDotVars` sets
  `--dw-<t>` / `--dd-<t>` on the chart svg for tiers (CSS px, thickness /
  dot / gap): x 0.75/1.5/2.5, s 1/1.5/2.5, m 1.5/2/2.5, l 2.25/2.5/3,
  b 3/3/3. Square dots (butt caps), solid.
- style.css "TradingView-style dots" (last, !important): timelines by Grid
  weight (s/m/l); dotted ladder 10% lines and channel edges by Thin / Medium
  / Thick (s/m/l; no weight saved: m); 1H bold 20s one up (m/l/b); 1H finer
  steps x (Thin) or s; channel midline s (Thick channel: m); last-price
  line s. Dashed lines (.is-dash, ladder ends, year / quarter / admin /
  month lines, zero line) are unchanged. MA ribbon dots unchanged.
- Measured after, iPad 750 and phone 390: fine dots 1 / 1.5 / 2.5 px on
  both. The toolbar's dotted icon follows.
- Tests: new `tests/dotted_lines_checks.cjs` (timeline and last-price line
  are 1 px / 1.5 / 2.5, square, solid, on the card and full screen);
  ladder_dash_checks reads the dotted pattern from `--dd-l`;
  chart_readability_browser compares the Thin ladder's VISIBLE width before
  and after the wide view (its viewBox width now changes with chart size).

2026-11-07 LADDER RESIZES AROUND ZERO: app.js v601. User: "I should be able
to take it down and take it up without it moving on the 0% level ... when I
try to make it big, it doesn't move because of the zero".
- Reproduced: a ladder with a block below 0% whose bottom line rests on price
  0 (how `ladderHoldZero` leaves it) would not grow from the 40% dot or the
  scale dot (step 5 -> 5: the bigger spacing pushed the block under zero and
  the hold refused it), and shrinking lifted it off zero (bottom 0 -> 35.9).
- Now, while the lowest line rests on zero, both dots resize around zero:
  zero stays, the dragged line follows the finger, every line (0% included)
  spreads out from zero or closes in on it. A ladder clear of zero still
  pivots on 0% until its bottom reaches zero, then on zero. Without a block
  below, 0% is the bottom line and nothing changes.
- Also seen, not changed: with the ladder on zero, the 0% and 40% dots can
  sit under the open drawing toolbar at the bottom of the screen; the scale
  dot near the price is the one to use there.
- Test: `tests/ladder_zero_scale_checks.cjs` (fails on the old code: "bigger
  works: 5 -> 5").

2026-11-07 (later) MA COLOUR READ OVER 10 BARS: app.js v600,
chart-readability.js v4. User: "the moving averages on all time frames, how
smooth can I make them? ... to avoid the small curves that are a little bit
insignificant", then "Do it". Each chart MA (MA50 / MA250 / MA500 on every
timeframe, and the slope-coloured Monthly overlay) is now red when it is
lower than 10 bars ago (`chartReadability.maFalling`, `MA_SLOPE_BARS`), not
when it is lower than the previous plotted point 3 bars back. 10 is the
engine's own trend lookback (`config.SLOPE_LOOKBACK`). The LINES are not
moved, and nothing the engine computes changes: only the colour.
Measured on the repo fixtures (11-12 instruments, 520-bar window): MA50
colour changes per chart about 16 -> 10 (NVDA Daily 25 -> 13, AAPL Daily
20 -> 10, gold 1H 13 -> 11); about half the old ones reversed within 15
bars. Cost: a genuine turn changes colour a median 3 bars later (75th pct
4). MA250 / MA500 barely change; they had 1-6 flips per chart. Smoothing
the line itself was measured and rejected: a 10-bar smoothing moves the
drawn MA50 up to 1.75% of price (95th pct, Daily) from the real one, so
price would sit on the wrong side of it on ~2% of bars and B2/S2 crosses
would be drawn where none fired.
- Test: chart_readability_test (dip inside a 10-bar rise stays the rising
  colour; a sustained fall turns red; no comparison across a gap).
2026-11-07 (later) 4H REMOVED PERMANENTLY: app.js v599, chart-preferences.js v11,
grid-geometry.js v15, trend-context.js v4, chart feed. User:
"Remove 4h permanently" (the 4H chart had come back on 2026-11-05, #152 /
#153). Reverses those two changes; do not bring 4H back unless the user asks
for it by name.
- Pipeline: `CHART_BUILDERS` has no '4H', so no `chart/4H/<chunk>.json` is
  written (old R2 chunks stay, unreferenced).
- Code deleted (user: "Even from the code"; chose "App + chart code", not the
  signal engine): `chart_feed.build_4h` / `build_4h_live` and their 4H bar
  ceilings, `tools/publish_four_hour.py`, the dev server's 4H builder and 4H
  fires, 4H in `alerts_feed`; in the app the 4H opening view, session-only
  frames and grid (`REEL_SESSION_*`, `reelSessionOnly`, `reelBarsPerDay`, the
  `M2` grid label), the 4H minute / overlay / projection entries, the 4H grid
  default, the 4H yearly-line case and the native 4H trend read. Kept: the
  one-time passes that strip saved 4H data, and the engine's `h4_` columns,
  `H4_SOURCE` (1H reads its hourly cache through it), `_resample_4h` (2H uses
  it) and backtest/ledger 4H history. `tests/four_hour_test.py` keeps its
  name (the workflows run it by name) but now checks the 1H forming bar and
  that the 4H builders are gone. The workflow's dead 4H restore step goes in a
  separate PR for review.
- App: no 4H row in `TIMEFRAMES` and no `#tfBtn4H`. A saved 4H chart choice
  opens on Daily; drawings saved on 4H stay in the store, not shown.
- Ladders: `LADDER_SUB_BY_TF = { '1H': 5 }` (4H's 5% steps gone), so new
  Daily ladders link Daily and 1H only. `ladderOn4hOnce` is deleted and
  `ladderNo4hOnce` is re-keyed (`sp-ladder-no4h-2026-11-07`) so it runs once
  more on every device and takes '4H' out of every Daily ladder, saved
  through `channelSave` for the other devices.
- Validators/tests: validate_hourly_release (no 4H chunk read; the live 4H
  button must be gone), app_smoke (no 4H button), ladder_daily_sub /
  ladder_moves / ladder_dash (1H only; no 4H in a new ladder),
  ladder_cleanup (no Daily ladder lists 4H after the passes).
  time_grid / stock_view / freshness / chart_framing checks moved from 4H to
  1H or Daily; browser_fixture and htf_feed_test no longer mock a 4H builder.

2026-11-07 (later) LADDER 0 / 100 / 200 / 300% LINES BOLDER: style.css v413.
User: "On the percentage line make 0 100 200 300 etc bolder". The block-edge
lines (`.reel-ladder-key`: 0%, 100%, every stack divider) are about 1.5-1.75x
heavier at every weight. Daily: Thin 2 -> 3.5, Medium 3.5 -> 5.5, Thick
6 -> 9, unweighted 6 -> 9. A Daily ladder on 1H / 4H: Thin 2.6 -> 4, Medium
4 -> 6, Thick 6 -> 9 (they shared one width with the bold 20s; now the ends
are heavier than the 20s, which keep 2.6 / 4 / 6). Desktop full screen
1.4px -> 2.2px. Dash, colour and labels unchanged. They no longer match the
quarter grid line's width (6), which they had copied since 2026-09-24.
- Test: ladder_dash_checks (Thin Daily ends 3.5; 1H / 4H Thin ends 4).

2026-11-07 (later) CHART MAs DOTTED AGAIN: app.js v598,
chart-readability.js v3. User, after #157 went live: "No the must not be
solid". The chart's MA ribbon is back to the exact pre-#157 rendering:
dotted, every key line 7 x `nativeScale` (Thin / Medium / Thick), the same
dash pattern and opacity. The weight-by-period widths (`nativeWidth`) went
with the solid lines. A code comment now says not to make them solid again.
Kept from #157: the green / red last-price tag and dotted line, bold round
levels, no strip caption, and the 28px full-screen footer.

2026-11-07 (later) FULL-SCREEN FOOTER ONE HEIGHT: style.css v412. User
(ETHUSD full-screen screenshot, footer circled): "Make the bottom same as
size as the one on the left daily one". On the phone's full screen, Saved |
Draw and the ‹ n/N › steps go from 36px to the timeframe pill's 28px, and the
pill is pinned at 28px so all three stay equal. Each button keeps a 36px tap
area through an invisible `::after` (inset -4px top and bottom). Desktop
(`.desktop-chart`) is unchanged.

2026-11-07 (later) CLEAN CHART, TRADINGVIEW-STYLE OPTION 1: app.js v597,
style.css v411, chart-readability.js v2. User sent a TradingView ETHUSD 1D
screenshot ("How clean is this look? Can we copy it? ... add a bit of our
touch"), saw three mock-ups and chose option 1.
- Chart MAs are SOLID (were dotted), still black rising / red falling. Weight
  rises with the period: MA50 3, MA250 4.5, MA500 6.5 viewBox units on Thin
  (the default); Medium x1.25, Thick x1.55 (`chartReadability.nativeWidth`).
  The weight order is "our touch": the lines are told apart without a legend.
  Overlay MAs from other timeframes keep their dashes, so they still read as
  overlays.
- Last-price tag and its line take the last bar's direction: green
  `--reel-last-up` #089981 when it closed at or above the bar before, red
  `--reel-last-dn` #e0262b below (were amber). The line is a 2/5 dotted 1.6
  stroke (was a 6/5 amber dash). The tag text is white; in full screen its
  halo takes the tag colour, because the white overlay halo smudged white text.
- Round price levels are bold (`majorStep` / `isMajor`: 5x a 1- or 2-step,
  2x a 2.5- or 5-step, so 90 / 100 / 110 bold between 95 / 105). Axis numbers
  are darker (#1a1a19).
- The trend-strip caption ("Uptrend since ... · lighter = below MA50") is no
  longer drawn on the plot; the strip itself stays.
- Unchanged: no horizontal price gridlines (removed on purpose 2026-09-11).
- Tests: chart_readability_test (weights rise MA50 < MA250 < MA500 and with
  Thin < Medium < Thick; bold levels), chart_readability_browser (Thick MA500
  width is `nativeWidth('anchor', 3)` instead of the dotted 7).

2026-11-07 EVERY DAILY LADDER DASHED AND THIN: app.js v596. User: "Replace
all daily chart percentages lines with dash lines"; then chose Thin for the
converted ladders and dashed for new Daily ladders too.
- `ladderDashOnce()` (flag `sp-ladder-dash-2026-11-07`, per user via `sk`),
  after `ladderThickOnce` on the first sync pull: every Daily ladder (on
  Daily and its linked 1H / 4H copies) that is not dashed turns dashed and
  Thin, saved through `channelSave` so other devices follow. Ladders drawn
  on their own on another timeframe are left alone.
- New ladders drawn on Daily open dashed and Thin (`channelAdd`). Ladders
  drawn on other charts keep the dotted / Thick default.
- Dotted stays available. Setting a ladder back to dotted stores `dashOff`,
  which `ladderDashOnce` skips, so a device that runs the pass later cannot
  re-dash it; tapping Dashed clears it.
- Tests: ladder_dash_checks (a new Daily ladder is dashed and Thin; dotted
  sets dashOff), ladder_cleanup_checks (every Daily ladder dashed and Thin
  after all passes; a dashOff ladder stays dotted; a 1H-only ladder is
  untouched).

2026-11-06 (later) DASHED LADDER OPTION: app.js v595, style.css v410,
drawing-toolbar.js v12. User: "add the dash lines as an option for the
percentage line with thin med and thick. With thin being default"; then
chose "Dashed starts Thin" and "1H / 4H follow my choice".
- The channel's dotted / dashed buttons now show on a ladder too (`d.dash`;
  the ÷10 switch stays channel-only). Dashed turns the 10% lines, the 1H bold
  20s and the 1H / 4H finer steps into dashes; the 0% / 100% ends keep their
  own longer dash and the drawing's colour.
- Tapping Dashed on a dotted ladder sets it to Thin (`strokeWeight: 1`);
  Medium / Thick work from there. Back to dotted keeps the weight. New
  ladders still open dotted and Thick (2026-11-05).
- 1H / 4H now follow Thin / Medium / Thick for every Daily ladder, in the
  same order (finer steps < 10% lines < bold 20s and ends): Thin 0.9 / 1.4 /
  2.6, Medium 1.4 / 2.2 / 4, Thick 2.2 / 3.2 / 6, so a Thick ladder looks as
  before. The old fixed widths remain only for a ladder saved without a
  weight.
- `ladderThickOnce` skips dashed ladders, so a device that has not run it yet
  cannot put a dashed Thin ladder back on Thick.
- Test: `tests/ladder_dash_checks.cjs` (from app_smoke).

2026-11-06 LADDER "MOVE %" SWITCH: app.js v594, style.css v409,
drawing-toolbar.js v11. User: "a switch on the percentage lines that measures
the equal ladders in actual percentage moves ... written in the middle of each
point 0-10 on daily all the way to over 100 and this must apply to the small
time frames".
- A ladder's lines are equal PRICE steps, so the real move per gap shrinks as
  price climbs (100 -> 110 is +10%, 200 -> 210 is +5%). New `Move %` button
  next to `%` (stored as `d.moves`, off by default): every gap between two
  Daily 10% lines, stacks above 100% and below 0% included, shows its actual
  % move in the middle of the gap at the right end of the plot, in teal with
  a white halo (`.reel-ladder-move`).
- Measured the way the ladder is numbered: up from the lower line ("+5.26%");
  on a reversed ladder (`%⇅`, 0% at the top) down from the upper line
  ("-5.00%").
- A linked Daily ladder carries the switch to 1H and 4H (`channelLinkSync`
  copies every field); there the same Daily gaps are labelled, not the finer
  2% / 5% steps. A gap starting at price 0 (no % move) and a gap thinner than
  `LADDER_MOVE_MIN` (34 units, zoomed far out) stay blank.
- Display only: alerts, storage of the lines and the sync Worker unchanged.
- Test: `tests/ladder_moves_checks.cjs` (from app_smoke): values match the
  saved anchors on D, 1H and 4H, shrink going up, sit mid-gap, run past 100%,
  and go negative when reversed.

2026-11-05 (later) 4H SPLITS EACH DAILY LADDER GAP IN TWO AGAIN: app.js v593.
User: "What would the division of 4h be since 1h is 5 per section", then
"2?" (two, every 5%, over three, every 3.33%). Square-root-of-time guide: a
4H bar moves about twice a 1H bar, so ~4% steps; 2.5 parts would miss the
10% lines, so 2 (5%) or 3 (3.33%), about equally off; 5% reads cleaner.
- `LADDER_SUB_BY_TF = { '1H': 5, '4H': 2 }`. A Daily ladder on 4H shows its
  Daily lines (big labels) plus 5, 15, 25% (small labels). The 4H steps do
  not nest in the 1H 2% steps (with five on 1H only 1 or 5 parts could);
  each timeframe shows only its own. Not bold on 4H (1H only).
- New Daily ladders link D, 1H and 4H again (`LADDER_SUB_TFS`).
- `ladderOn4hOnce()` (flag `sp-ladder-on4h-2026-11-05`), after
  `ladderNo4hOnce` on the first sync pull: every Daily ladder that shows on
  1H shows on 4H again, every copy, saved through `channelSave`. A Daily
  ladder on Daily alone is left alone.
- Alerts unchanged (sync-worker `LADDER_SUB` 5: Daily lines + 1H 2% steps);
  no 4H 5/15/25% line is a 1H step, so none alerts.
- Tests: ladder_daily_sub_checks (linked D + 1H + 4H; 4H small labels are
  the 5% steps), ladder_cleanup_checks (Daily ladders on 1H are on 4H again
  after all three passes; a Daily-only ladder stays Daily-only).

2026-11-05 4H CHART BACK, CHART ONLY: app.js v592, chart feed. User: "Bring
back the 4h chart" (the day after #145 removed 4H as a timeframe).
- Pipeline: `CHART_BUILDERS` has `'4H': 'build_4h_live'` again, so every
  publish writes `chart/4H/<chunk>.json` (chart cache applies as for 1H).
  Chart only, like Weekly/Monthly: no `sg` markers, no setup context, no
  `trend_channels.tf['4H']`, no `events_by_tf['4H']`.
- App: a `chartOnly` 4H row in `TIMEFRAMES` (prefix '' so a stale `h4_` CSV
  column is never read; the card shows the Daily main trend) and the
  `#tfBtn4H` button, shown on Charts only. A saved 4H chart choice opens on 4H
  again, and drawings saved on 4H show again.
- NOT changed: the 4H setup, workflow signals, MA clusters, filters and
  Alerts stay on 1H (#145). Daily ladders stay off 4H (`ladderNo4hOnce`); a
  ladder's 4H chip still turns it on there.
- Validators/tests: validate_hourly_release now requires the 4H chunk (no
  markers) and the live 4H button; app_smoke opens 4H and checks bars, no
  markers and no 4H relation; ladder_daily_sub_checks expects the button.

2026-11-05 FULL-SCREEN BARS MORE SEE-THROUGH: style.css v408. User: "A bit
more see through that shows the charts every[where] when I move them". The
header and footer go from 80% white with a 3px blur to 55% white with no
blur, so the chart stays sharp under them while panning; their words get a
soft white text-shadow so they stay readable over the lines.

2026-11-05 SEE-THROUGH HEADER AND FOOTER, FULL SCREEN: app.js v591,
style.css v407. User (BRENT Daily screenshot, header and footer circled):
"make these a little see through over the charts but not much that I am
unable to read. Just to give chart extra space".
- On the phone the full-screen chart now fills the screen, status bar to
  home bar; the header and footer float over it on 80% white with a 3px
  blur. Desktop keeps them in the flow (`:not(.desktop-chart)`).
- `reelLayout` measures how far the two bars overlap `#chartFullHost` and
  keeps the readable frame (py0..py1, so price fit, saved views and handles
  are unchanged), the date row (`L.dateY`) and the trend strip in the clear
  part between them. Candles, MAs, time grid, shading, the zero line, ladder
  lines and vertical lines carry on behind the bars (`gTop/gBot`,
  `clipTop/clipBot`). Cards overlap nothing and lay out as before.
- Dates and the strip note get a white halo (`.reel-svg.is-overlaid`), since
  lines now run behind them. Test: app_smoke (fills the screen, bars
  translucent, frame/dates clear), screenshot full-chart-see-through.png.

2026-11-05 DAILY PERCENTAGE LINES ON THICK: app.js v591. User: "As a
standard the daily percentage lines must always be on thick.... Apply it
across all charts where it's placed. And when I place a new one it must
always be on thick".
- A new ladder starts on Thick (`strokeWeight: 3` in `reelDefaultLadder`),
  on every timeframe. Thin / Medium still change it.
- `ladderThickOnce` (once per device, after the first sync pull, like the
  two ladder cleanups): every Daily ladder, on Daily and its linked copies,
  is set to Thick and saved, so other devices get it. Ladders drawn on their
  own on another timeframe are left alone. Tests: ladder_cleanup_checks,
  drawing_toolbar_checks.

2026-11-04 WEEKLY / MONTHLY OVERLAY: NO KINK AT THE RIGHT EDGE: app.js v590.
User (BTCUSD 1H screenshot, the Monthly MA bending up over the last day):
"The monthly 250ma has this funny bend on the one day overlap all chart have
it. Fix this".
- Cause: the overlay feed's last point is the week / month IN PROGRESS
  (`_htf_mas`, since 2026-09-28), valued as if it closed at today's price and
  dated today. Every other point sits at its period's close, so the whole
  period's MA step was drawn in the few days since the last close. Measured
  on live BTCUSD 1H: the Monthly's last segment sloped 8x its previous one
  (-1.73 vs -0.21 px/px); the Weekly lines 1.3-1.8x.
- Fix (client, no data change): that last point is drawn PRO RATA, the
  elapsed share of the period's step (4 Nov: 4/30 of November's), i.e. on
  the straight line to where the value belongs at the period's close. After:
  -0.23 vs -0.21 (Monthly), Weekly 1.0-1.3x. A closed last point (today is
  the period end) is drawn as it is. The projection starts from that same
  point and reaches the in-progress value at the period's close.
- The Daily overlay is not affected (its bundle ships closed days only).

2026-11-04 MONTHLY OVERLAY ALL ORANGE: app.js v589, style.css v406. User:
"The monthly make all orange". The Monthly MA overlay (on Daily, 1H and
Weekly) takes one colour, `--reel-ov-m` #ea580c, both directions, like the
Daily (blue) and Weekly (purple); it kept the slope colours (black up / red
down) until now. Its projection lines follow. The Monthly chart's own MA50
keeps black/red by slope. Note: Weekly was orange until 2026-10-28 and moved
to purple because orange read too close to the falling red; this orange is
darker (orange-600) and the overlay lines are dashed and thicker than the
native red ones.

2026-11-04 DAILY OVERLAY DRAWN LIKE THE WEEKLY, STILL BLUE: app.js v588.
User: "Make the daily over lay the same as the weekly but still blue". The
Daily MA overlay (on 1H) now uses the Weekly overlay's width (`wW`: 6 / 10 /
12.9 at Thin / Medium / Thick, was 2.5 / 4.2 / 7.1), its dash in proportion
to that width (`2.4w 1.1w`, was a fixed 14/9 or 18/10), the last closed value
carried flat to the newest bar (`hold`, was stopping at the last daily
close), and the Weekly projection width (10 x, was 4.2 x). Colour unchanged
(`--reel-ov-d`, blue); the Weekly stays purple. Tests: chart_readability
(each overlay family still widens with its weight), app_smoke.

2026-11-04 DAILY: SPLIT EACH TERM INTO 4: app.js v587, chart-preferences.js
v10, grid-geometry.js v14, sync Worker. User: "Just like we have a split for
a quarter by 3. Create one for daily by 4", then (asked what to split) "Each
term into 4".
- A switch in the Grid menu under the Term (T) grid, Daily only: three
  light, unlabelled lines in each four-year term, one on each year that is
  not a term year (2026, 2027, 2028 in the 2025 term). Outside the shading,
  like the quarter thirds; the term lines and their bold administration
  lines are unchanged.
- Stored as `fourths: true` on the grid row, per market, beside `thirds`;
  `chartPreferences.fourths` / `setFourths` (one `setSplit` behind both
  switches); both flags survive a division change. The sync Worker's
  saved-work-store keeps it (only `true`).
- Tests: time_grid_test (three lines a term on its years, no label or
  shading, off under Y, saved, Daily only, flag cleaning), saved_work_test.

2026-11-04 PHONE ALERTS BACK ON: sync Worker. User: "Turn phone alerts back
on". `wrangler.toml` `PUSH_PAUSED = "0"`: `/push/notify` checks the ladder
lines again (Daily 10% lines and the 1H 2% steps) and sends failed-run
pushes. The alert state was left untouched while paused, so the first run
compares with the last price checked BEFORE the pause: lines crossed during
the pause (about 13:15-14:00 UTC) can alert once then, capped at
MAX_PER_RUN (12) per user.

2026-11-04 4H REMOVED AS A TIMEFRAME; ITS SIGNALS MOVE TO 1H: app.js v586,
trend-context.js v3, chart feed. User: "Remove 4h as a time frame and take
all it's signals to 1h" (after the plan: Daily main trend, 1H setup + entry).
- Charts: no 4H button (`TIMEFRAMES`, index.html); a saved 4H choice opens on
  Daily. Drawings saved on 4H stay in the store, not shown.
- Pipeline (`chart_feed`): no 4H chart is built (`CHART_BUILDERS`); its chunks
  and `trend_channels.tf['4H']` are no longer written (old R2 chunks are left
  orphaned). `attach_setup_context` runs on the 1H bundle (1-hour bars):
  `setup` (levels, ATR, D50 crossings, interactions), `swingDirection`,
  `minorOpportunity`; `entries` = the same 1H interactions.
  `frame_context` runs the workflow signal engine on 1H (B1-S4, MA500 rule
  4H used); `workflow_context` / `workflow_alerts` are Daily + 1H, and 1H
  entries follow the 1H direction. `events_by_tf['1H'].s` is the latest
  workflow B1/S1 on the last two dates (was 4H's). The 1H chart's own `sg`
  markers (h1 fires) are unchanged.
- App: `SPTrendContext.context` returns `h1` / `h1Relation` only (no h4);
  1H's native direction includes `swingDirection`; clusters read the 1H
  setup. Everywhere "4H" was the setup it is 1H: Watchlist rows and Trend
  view, Signals "Minor 1H swings" and "1H B1 / S1 · 2 sessions", MA cluster
  labels, Market counts, Alerts (chips Daily / 1H setups, relation "1H",
  setup and level cards on 1H, entry cards follow the 1H direction).
  `SIGNAL_TFS = {1H, D}`; `workflowRowValues` writes the 1H workflow read to
  the `h1_` columns (as it did `h4_`). A saved Alerts 4H chip opens on 1H.
- NOT changed (step 2, its own PR when wanted): `main.py` still computes the
  `h4_` CSV columns and 4H ledger fires; `.github/workflows` still lists
  `publish_four_hour.py` / `four_hour_test.py` (workflow edits go to the user
  for review); the dev server keeps its 4H builder.
- Measured cost: frame_context on a 24h market's 1H history ~0.46 s vs 0.19 s
  on its 4H; equities less; unchanged markets come from the chart cache.
- Validators: validate_workflow_release (Daily/1H, no 4H context),
  validate_hourly_release (no 4H trend read, events or button live).
- Tests: trend_context_feed_test, workflow_setup_test, trend_context_test,
  ma_clusters_test, app_smoke (full-screen checks on 1H, Alerts without 4H;
  the 4H yearly-line check dropped: the fixture's 1H is under a year, and
  time_grid_test covers 1H years), saved_work_checks/browser, desktop_workspace,
  chart_framing_checks, ladder checks.

2026-11-04 1H SPLITS EACH DAILY LADDER GAP IN FIVE AGAIN: app.js v585, sync
Worker. User: "Bring back the old division of dividing daily ladder by 5 and
not 4". `LADDER_SUB_BY_TF = { '1H': 5 }`: small labels every 2% (2, 4, 6, 8,
12 ...) between the Daily 10% lines, as before #140. Alerts (still paused)
follow: `ladder-alerts.js` LADDER_SUB 5, 51 lines a block, every 2%. Tests:
ladder_daily_sub_checks (2% steps), ladder_alerts_test.

2026-11-04 DAILY LADDERS ON DAILY AND 1H ONLY (4H REMOVED): app.js v584.
User, after seeing a 12.5% version (never deployed): "Take it back to when it
was 1h and daily only with10 division and remove 4h". Ten divisions stay
(every 10%), 1H keeps its four parts (every 2.5%).
- `LADDER_SUB_BY_TF = { '1H': 4 }` (4H's two parts, every 5%, are gone), so
  a ladder drawn on Daily is linked to D and 1H only.
- `ladderNo4hOnce()` (flag `sp-ladder-no4h-2026-11-04`, per user), after the
  first sync pull of the visit, next to `ladderCleanupOnce`: takes '4H' out
  of every Daily ladder's `tfs` on every copy and saves through
  `channelSave`, so other devices follow. Ladders drawn on 4H itself are
  untouched; a Daily ladder's 4H chip still turns it back on there.
- `ladderCleanupOnce` (2026-11-03) keeps its own 1H/4H list for what it
  deletes, so a device that never ran it behaves as before.
- Alerts (paused since PR #142) unchanged: Daily 10% lines + 1H 2.5% steps.
- Tests: ladder_daily_sub_checks (linked D + 1H, nothing on 4H),
  ladder_cleanup_checks (no Daily ladder keeps 4H after both cleanups).

2026-11-04 PHONE ALERTS PAUSED: sync Worker. User: "Switch off all phone
alerts till we get this right" (while the ladder steps are reworked, 12.5%
Daily under discussion). `wrangler.toml` `[vars] PUSH_PAUSED = "1"`:
`/push/notify` answers `{paused: true}` after the secret check and does
nothing else, so no ladder line alert and no failed-run push reaches any
phone. Subscriptions, the ladders' bell settings and the alert state are
untouched. To resume: `PUSH_PAUSED = "0"` (or remove it) and redeploy; the
first run after that only alerts on lines crossed since the previous run.
Test: auth_test.mjs (paused notify still needs the secret, sends nothing).

2026-11-04 CHARTS FOLLOW THE WATCHLIST; CHART CARD MADE BIGGER: app.js
v583, style.css v405. User: remove the Charts drop-downs and lists, move the
ones the Watchlist lacks to it, keep only the instrument name, full name and
up/down on the chart card so the chart gets the room, make Charts work "hand
in hand" with the Watchlist (back to the sector or list you were in), an
option to reset to all instruments, and a count next to every list.
- Charts header is ONE row: the search (with its "N charts" count) and, when
  a set is in view, a bar naming it with its count and "Show all". The
  Show/Class/Sector/Trend/MA row, its view dropdown, Sort and reset are gone
  (`#reelMenus` too). `reel` keeps only gp/cls/trend (Market taps), search
  and the set.
- Moved to the Watchlist (only what it did not have): Class groups US100,
  US500, Banks, Energy, Tech, Semis, AI (`wlUi.grp`, a `matchesSearch` word as
  `reel.cat` was) after the classes; a Signals view (`wlUi.scope`: Everything,
  My Buy/Sell markers, Fired today, open signal, buys, sells, minor 4H, 4H
  B1/S1, 1H touched/crossed a Daily MA); the Clusters view is now MA:
  Clusters + Width, Order (`wlUi.stack`), Near MA + Within (`wlUi.near`,
  `wlUi.nearWithin`); Sort gains Signals first and Newest signal. All of them
  are list filters (off when another list opens). One pipeline,
  `wlApplyFilters`; Near MA and the intraday scopes wait for the chart index
  ("Loading…"). Ranked filters (markers newest, intraday newest, nearest MA)
  keep their order under By group.
- Counts: every chip in the row says how many the list in view would show
  with it picked (other filters as they are); All markets has its total; the
  line under the row starts "N instruments".
- Follow: the reel shows the Watchlist's view (`wlShownSet`, kind 'wl') when
  that view has changed since the reel last took it (`wlViewSig` vs
  `reelWlSig`): on opening a chart from it, or on tapping Charts in the tab
  bar. A set opened on purpose (Active sector, Market list, charts like X)
  holds until the Watchlist changes; a lone chart (alert, details) does not.
  "Show all" = every instrument, signals first, until the Watchlist changes.
  Charts never changes the Watchlist, and coming back from Charts scrolls the
  list to the chart last on screen (`reelLastSeen`).
- Search on Charts finds inside the set; with no hit there it searches every
  instrument (`reel.searchAll`, set bar hidden meanwhile).
- Card header: line 1 ticker + full name, line 2 `Main ▲ Up` (`reelTrendMini`)
  and the day's move (or the Watchlist's longer move period) with the chart
  buttons. Removed from the card: group, trend detail sentence, MA cluster
  badge, signal badge, "% alike", Near-MA badge and the bar/data time line.
  Full screen keeps all of it. On a 390x844 phone the plot went from ~330 to
  ~510 px tall.
- Desktop/iPad side panel: the set bar sits under the search.
- Tests: charts_row_checks.cjs rewritten for the above; app_smoke.cjs class
  chips with counts and groups, Active bar text, no bar-time line on cards.

2026-11-04 1H SPLITS EACH DAILY LADDER GAP IN FOUR: app.js v582, sync
Worker. User: the 1H steps (five per Daily gap, every 2%) look "too tight"
after drawing the Daily ladder; asked for four. `LADDER_SUB_BY_TF['1H']`
5 → 4: a Daily ladder on 1H now shows small labels at 2.5, 5, 7.5% (then
12.5, 15, 17.5…) between its Daily 10% lines. Daily (10% lines) and 4H (two
parts, every 5%) are unchanged.
- The steps now nest: every Daily line is a 4H line and every 4H line is a
  1H line (with five, the 4H 5/15/25% fell between the 1H 2% steps).
- Counting on 1H: two Daily gaps are 8 steps (0→20%, the bold lines), so
  10 steps end at Daily 25%, not on a Daily line. Discussed with the user
  before the change.
- Alerts follow: `sync-worker/src/ladder-alerts.js` `LADDER_SUB` 5 → 4, so
  the bell tests every 2.5% (41 lines a block, was 51) and never alerts on
  a 2/4/6% line the chart no longer draws. A 6-hour repeat key on an old 2%
  line simply expires.
- Tests: ladder_alerts_test.mjs (2.5% levels and crossings),
  ladder_daily_sub_checks.cjs (1H small labels on the 2.5% steps, at least
  one ".5%"; 4H still only the 5% ones).

2026-11-04 CIRCLE AND TOKENIZATION STOCKS: Instruments.txt 815 → 821. User:
"Add circle in the instrument list and other new add to xm tech and
tokenization related to the instrument list". New section after #821, group
`Blockchain` (so they sit with COIN/HOOD under the Crypto class and the
Blockchain filter; no app code change): #822 CIRCLE (CRCL), #823 GALAXY
(GLXY), #824 BULLISH (BLSH), #825 GEMINI (GEMI), #826 FIGURE (FIGR),
#827 ETORO (ETOR). XM's own list could not be read from the session (xm.com
outside the network allowlist), so the five besides Circle are the US-listed
stablecoin/tokenization names, NOT confirmed as XM symbols. All listed
2025 (May-Sep), so ~290-380 daily bars: MA50 and MA250 draw, MA500 does not
exist yet and B4/S4 cannot fire until it does (same as CEREBRAS). Industry
labels are placeholders; the weekly yahoo-industries job overwrites them.

2026-11-03 (late night) ONE-TIME LADDER CLEANUP: app.js v581. User: "I need
the old percentage that stood alone and not the 1h and the 4h divisions that
go together with the daily chart to be removed. The new ones remain", and
"Daily percentage lines must have 4 and 1 active, obviously with an option
to deactivate still available".
- `ladderCleanupOnce()`, once per device (flag
  `sp-ladder-cleanup-2026-11-03`, per user via `sk`), after the first sync
  pull of the visit (skipped if that pull fails, so an out-of-date copy is
  never stamped as the newer edit):
  - deletes every ladder on 1H/4H that is not a Daily ladder
    (`!ladderIsDaily`): drawn there alone, or linked 1H+4H only;
  - links every never-linked Daily ladder and shows it on D, 1H and 4H;
    a linked Daily ladder keeps its chips (a 1H/4H the user switched off
    stays off);
  - saves through `channelSave`, so the deletions sync to other devices as
    the newest edit of those charts.
- New ladders drawn on 1H/4H after this are left alone (it runs once), and
  new Daily ladders already open on D + 1H + 4H.
- Startup: `syncCatchUpDrawings` still starts alongside the pull; only the
  cleanup waits for it.
- Test: `tests/ladder_cleanup_checks.cjs` (run from app_smoke, own browser
  context with old drawings seeded).

2026-11-03 (night) LADDER SCALE DOT NEAR THE PRICE: app.js v580. User,
with USDX trading near its ladder's 200% line: "how can we move the
adjustable points ... only affecting the rest and not zero ... adjusting
from 0 it's a problem as candles look small" (to reach the 0% and 40% dots
they had to zoom far out).
- A third round dot (`data-h="ls:<k>"`, k = stored steps from 0%) on the
  ladder line nearest the last close, shown when that line is below 0% or at
  60% and up (the 40% dot already serves the lines near it). Dragging it
  sets the step so that line lands under the finger; 0% stays
  (`ladderHoldZero` treats it like the 40% dot). It refuses a drag through
  0% (the spacing would flip).
- `ladderScaleDrag` pins the dot to its line for the whole drag; without it
  the dot hopped to whichever line was now nearest the price. Cleared on
  release.
- Far from 0% it is also a fine control: the 200% line moved one point
  moves the 40% line a fifth of a point.
- Test: `tests/ladder_scale_dot_checks.cjs` (run from app_smoke): the dot
  shows, keeps its line mid-drag, 0% does not move, spacing widens, and the
  dragged line ends under the finger (within 2%).

2026-11-03 (latest) 4H SPLITS EACH DAILY LADDER GAP IN TWO: app.js v579.
User: on 4H, how should the Daily 0-10% sections be divided, "a little bit
bigger" than 1H's five; agreed on two after weighing 2.5 (a 4% step misses
the 10% lines; 2.5% is nearly 1H's 2%).
- `LADDER_SUB_BY_TF = { '1H': 5, '4H': 2 }` replaces `LADDER_SUB = 5`. A
  Daily ladder on 4H now shows its Daily lines (big labels) plus 5, 15, 25%
  (small labels); the 1H 2% steps no longer show on 4H, and 4H steps never
  show on 1H. Daily unchanged. Rough reasoning: typical move grows with the
  square root of time, so 24 one-hour bars a day ~ five parts, six 4-hour
  bars ~ two to 2.5.
- Alerts are unchanged: they still test every 2% (Daily lines + 1H steps),
  so a 4H 5/15/25% step alerts only where it is also a 1H step (never).
- Test: `ladder_daily_sub_checks.cjs` expects 5% small labels on 4H and none
  of the 2% ones, and now measures only the Daily ladder's own lines
  (`.reel-ladder-daily`): with wider 4H steps the sub-lines show before any
  zoom, and another test's thinner ladder on the same chart was being
  compared too.

2026-11-03 (later) LADDER LINE ALERTS ON THE PHONE: app.js v578,
drawing-toolbar.js v10, sw.js, sync Worker, chart_feed quotes. User: "I need
an option to set alerts on the percentage lines daily and hourly", then
chose phone notifications, on the Daily lines AND the 1H steps.
- **Switch**: a ladder's toolbar has a 🔔 Alert press/unpress button
  (`draw-alert`, stored `d.alert`, synced like any drawing). Turning it on
  also subscribes this phone to push if it is not yet (a note if that fails:
  sign in and allow notifications, on iPhone from the home-screen app).
- **Check**: CI already POSTs `/push/notify` after every data run. The Worker
  now reads quotes.json and each allowed user's blob, and for every ladder
  with `alert` (a linked copy once) tests its lines every 2% (Daily 10% lines
  + the 1H 2% steps, stacks included, none below 0) against the range since
  the previous run: [min(l, prev p, p), max(h, prev p, p)]. A market whose
  quote time did not change is skipped. The same line does not alert again
  for 6 hours; at most 12 alerts per user per run. State in KV
  `alerts:state` (one write per run), alerts in `inbox:<user>` (last 30).
  Pure logic in `sync-worker/src/ladder-alerts.js`.
- **Delivery**: an empty push to the OWNER's phones only. The service worker
  asks `/push/inbox?endpoint=` (the subscription endpoint is the credential)
  and shows the alerts from the last 20 minutes: "GOLD · 1H 22%", "Up to
  3,897, through your 1H 22% line at 3,896"; up to 4, the last saying
  "+N more". Tapping opens that chart on 1H or Daily (`OPEN_CHART` /
  `?chart=`). Every device of the owner gets them (nothing is cleared).
- **Behaviour change**: /push/notify used to push EVERY phone after EVERY
  run ("SwingPulse updated"). Now a phone hears only its owner's alerts, or
  a FAILED run (status.json `failed`), which still reaches everyone.
- **quotes.json** gains `h` / `l`: high and low of the finished 5m bars in
  the `QUOTE_RANGE_MIN` (70) minutes up to `p`, so a wick through a line
  between runs counts. Absent on a daily price.
- Known limit: alerts compare against the quote feed (`p`), which for
  futures-redirected indices (US100 etc.) is the futures contract; a ladder
  drawn on the cash Daily chart can be a basis away.
- Tests: sync-worker/test/ladder_alerts_test.mjs (run from
  saved_work_test.mjs, so CI runs it without a workflow change): levels,
  crossings, repeat guard, stale quotes, owner-only push, inbox for all of
  the owner's devices, failed-run fan-out. htf_feed_test.py QuoteRangeTests.
  ladder_daily_sub_checks.cjs: the bell toggles and is stored.

2026-11-03 (later) DAILY LADDER ON 1H/4H: DARKER FINER LINES: style.css v404.
User (US100 1H screenshot): "The lines too light". Cause: the line-weight
levels draw ladder lines 0.9 / 1.7 / 2.6 units wide, and under ~2.4 units
(1 CSS px on a phone) a line antialiases to grey whatever its colour (the
default level, 1, is 0.9). A Daily ladder on 1H/4H now gets FIXED widths
(`.reel-ladder-daily` on its main lines, selectors that outrank the weight
rules): finer steps 2.2 (opacity .9, was 1.4 @ .45) < Daily 10% lines 3.2 <
bold 20s and the 0%/100% ends 6. Daily itself still follows the drawing's
weight. Labels unchanged. app.js v577. Test: ladder_daily_sub_checks.cjs
(opacity >= .8, finer lines thinner than the Daily lines, bold thicker).

2026-11-03 (later) 1H: A DAILY LADDER'S 20/40/60/80% LINES ARE BOLD:
app.js v576, style.css v403. User: "On the 1h make 20, 40, 60 etc bold line
only on 1h… that is a nice touch". On 1H only (not 4H, not Daily), a Daily
ladder's lines on the 20% steps get `.reel-ladder-bold`: about twice the
ladder's own width at every line-weight level (own `!important` rules, since
the weight setting overrides plain ladder widths), black, dashed like the
other ladder lines so they do not read as the 0%/100% ends. Each main line
now carries `data-pct`. Test: ladder_daily_sub_checks.cjs (1H: bold exactly
on the 20% steps and thicker; 4H and Daily: none). The paused "black small
labels / bolder Daily" branch (feat/ladder-sub-contrast) is not in this.

2026-11-03 (later) DAILY LADDERS SUBDIVIDED ON 1H / 4H: app.js v575,
style.css v402. The user showed how they had built it by hand on PALLADIUM
(a Daily ladder, then on 1H a second ladder from Daily 20% to 40% splitting
each Daily gap into five, Daily labels still on top) and asked: "build it and
add the small labels for the small division but when i am on the 1h i should
be able to tell which are the daily one and which are the 1h from the labels".
- A ladder that shows on Daily (`ladderIsDaily`: linked, `tfs` includes D) is
  a Daily ladder. On 1H and 4H (`LADDER_SUB_TFS`) it keeps its Daily lines
  and their big black labels ("20%"; a "D " prefix was tried and dropped the
  same day: "the labels doesn't need to say D"), and each Daily gap gets
  `LADDER_SUB` = 5 parts: `.reel-ladder-sub` lines (finer, lighter) with
  `.reel-ladder-sublbl` labels ("22%", small grey). Drawing only: no tap
  target, glow or price alert on the sub-lines.
- Sub-lines are hidden when closer than `LADDER_SUB_LINE_MIN` (14 viewBox
  units) and their labels when closer than `LADDER_SUB_LBL_MIN` (30), so a
  zoomed-out chart is not a grey smear. The % button hides both label sets.
- A ladder drawn on Daily is now linked to D, 1H and 4H at creation
  (channelAdd); the timeframe chips still turn any of them off.
- Test: ladder_daily_sub_checks.cjs (from app_smoke): drawn on Daily it is
  linked to D/1H/4H, no sub-lines on Daily, on 1H and 4H the big labels are
  the Daily 10% lines, sub-lines present, small grey labels on the 2% steps,
  smaller and a different colour from the Daily ones. Fails on v574.
The user's hand-drawn 1H ladder on PALLADIUM now doubles the sub-lines; they
can delete it.

2026-11-03 (later) LADDER BACK TO 10 DIVISIONS EVERYWHERE: app.js v574.
User: "now i feel like the 10 divisions was better than the 8. Take
everything back to 10". `LADDER_DIVISIONS = 10` on every timeframe (v572 did
8 on 1H/4H, v573 on all). Resize dot back on the 40% line. Saved ladders
never moved through any of this: the block's 0% and 100% prices are stored.
`ladderLines` / `ladderDivs` stay, so another count is one edit.

2026-11-03 (later) LADDER: 8 DIVISIONS ON EVERY TIMEFRAME: app.js v573.
User: "Make all time frames 8 divisions instead of 10" (an hour after 1H/4H
only, v572). `LADDER_DIVISIONS = 8` for every timeframe: nine lines, 0, 12.5
... 100%; the resize dot sits on 37.5% everywhere. Storage is unchanged, so
ladders saved under ten divisions keep their 0% and 100% prices. Checked on
1H, 4H, D, W and M; drawing_toolbar_checks.cjs expects 9 lines everywhere.

2026-11-03 (later) LADDER: 8 DIVISIONS ON 1H AND 4H: app.js v572. User:
"make the percentage lines for the 1 hour to be 8 and not 10. Only for the
1h and 4h". On 1H and 4H a ladder block is cut into 8 (lines at 0, 12.5, 25
... 100%, nine lines); Daily, Weekly and Monthly keep 10 (eleven lines).
The block keeps its 0% and 100% prices, so one ladder reads the same range
on every timeframe. Storage is unchanged (p1 = 0%, p4 = 30% of the 10-step
block), as are stacks and the zero hold, which work in block edges.
`ladderLines(d, tf)` is the one place that lists a ladder's lines (drawing
and price alerts both use it; `ladderPct` is gone). The resize dot moves to
the 37.5% line on 1H/4H (`ladderDotSteps`: 3.75 stored steps; 40% = 4 on
ten divisions); the move handle stays on 50%. Tests:
drawing_toolbar_checks.cjs (9 lines and 0-12.5-...-100% labels on 1H/4H,
11 elsewhere; dot on its line). Checked by hand on 1H, 4H, D and W.

2026-11-03 (later) A SAVED VIEW NO LONGER "OPENS UP" WHEN MOVED: app.js
v571. User (GOLD 1H, then Daily, with screenshots): the saved view opened
right, but moving it left/right or up/down widened it to about the 1H
opening frame (previous + current quarter) while the price scale stayed as
saved. Reproduced on live data: full screen on a chart, save, a background
data refresh (every 30 min / on foregrounding), then a drag: 315 -> 399 bars
on 1H, 634 -> 802 on Daily.
- **Cause.** The refresh rebuilds the reel and re-observes every card, so
  `reel.backIo` (v568) ran reelBackToSaved for the chart open in full screen
  and cleared its reel.pan / tzoom / lockY without repainting full screen.
  The next touch-down wrote a provisional price lock, which blocks the
  saved-view seed, and the drag continued from the DEFAULT window.
- **Fix 1 (the guard).** `reelSyncGestureState` at every touch-down: when
  reel.tzoom / reel.pan are missing, restore the window and offset the chart
  was DRAWN with (`ctx.win` / `ctx.pan`, stored at paint). A gesture always
  starts from what is on screen, whatever reset ran in between. Alone it
  fixes the repro.
- **Fix 2.** `reel.backIo` never resets the chart open in full screen
  (`chartFullName`).
Test: chart_framing_checks.cjs (full screen, time zoom, save, 31-minute
clock jump, drag: window width unchanged). Fails on v570, passes on v571.

2026-11-03 (later) PROJECTION WEIGHT CHECK NO LONGER RANDOMLY RED: test
only (chart_readability_browser.cjs). "Verify released chart weights"
failed once on the #126 deploy at `projection[0]<projection[1]<projection[2]`
and passed on the re-run. The check read only the FIRST projection polyline
at each weight, and which line is first depends on which overlay families
are drawn at that instant: monthly (MA colours, 1.6x, thickest), weekly,
daily. A read with the monthly or weekly line missing compared a different
line, so the three numbers could go down. Now it waits until the set of
lines stops changing, keys widths by family (stroke), and asserts every
family present at all three weights grows. Simulated the race (monthly and
weekly lines removed at the second read): old check fails with the CI
error, new one passes; also passes normally on live data and the fixture.

2026-11-03 (later) LADDER GLOW STAYS ON, HALF AS THICK: app.js v570,
style.css v401. User: "The glow for the percentage lines must stay if turned
on and reduce the thickness by 1/2". The glow showed only while the ladder
was SELECTED in Draw mode (`has-glow` was gated on `sel`), and it was the
40-wide tap line (`.reel-ch-hit`) turned visible. Now each drawn % line gets
its own `.reel-ladder-glow` band under it, 20 wide (half), shown whenever
`d.glow` is on, selected or not, on the card and full screen. The tap lines
are transparent again for every drawing, so the tap target is unchanged.
Colour still from `--reel-glow` (`d.glowColor`, blue when unset). Tests:
drawing_toolbar_checks.cjs (glow width is half the tap line's, tap line stays
invisible, glow stays after the ladder is deselected, then reselected by a
tap); the glow checks now read `.reel-ladder-glow`. Passes on the fixture and
on live data; fails on v569.

2026-11-03 (later) SHORT CHANNEL: MOVE HANDLE NO LONGER COVERS THE ENDS;
LIVE TOOLBAR CHECK FIXED: app.js v569. Found when "Verify the live app"
failed on the v568 deploy (it failed the same way on v567: not that change).
- **App bug.** When a channel's two ends sat close together on screen, the
  move handle went halfway between them, on top of both, and took the touch
  meant for an end (live ALAB 4H: ends 76 units apart, grab radius 42). It
  only stepped aside when the channel was too NARROW (`tight`); it now also
  steps aside when it is within 90 of an end handle (`nearEnd`).
- **Test bug** (drawing_toolbar_checks.cjs). After "a block added below"
  the ladder's move handle (50% line) can sit above the price scale and is,
  correctly, not drawn (ALAB 4H: ~708 under a 519 top), so the next drag
  read a null box. The test now widens the price window with the axis grip
  until the handle is on screen, then turns "0" back on (a manual price zoom
  replaces the zero window) before the "0 again" check.
- New check: a SHORT channel (end b dragged next to end a) must have each
  end on top where it is drawn. Fails on v568 ("got m"), passes on v569.
Verified against live R2 data locally (app_smoke.cjs SMOKE_LIVE=1) and on
the fixture.

2026-11-03 COMING BACK TO A CHART SHOWS ITS SAVED VIEW: app.js v568. User:
"Why is it that the chart never stay on the saved view?", then "Yes fix it".
A saved view was applied only the FIRST time a chart opened in a session
(reelViewSeedTime skips any chart with pan / zoom / price lock in memory).
One drag or zoom and that in-memory position won until the app restarted,
which on an installed phone app is days. Reproduced in the browser: drag a
saved Daily chart, leave Charts and come back → still where it was dragged;
full screen the same; only a reload restored it. New candles did NOT move a
saved view (checked on 1H and Daily), so that was not the cause.
Now `reelBackToSaved(name)` drops the reader's in-session moves for a chart
WITH a saved view whenever they come back to it, and the next paint seeds
the saved view again: returning to the Charts tab (`reelAllBackToSaved` in
doTabSwitch), a card scrolled fully off screen (`reel.backIo`, no margin,
repainted while out of sight), full screen opening and closing. Moves still
hold while you stay on the chart. Charts without a saved view are unchanged.
Not changed: views stay per timeframe, and tapping Saved still forgets one.
Test: chart_framing_checks.cjs (drag a saved Daily chart, then tab away and
back, open full screen, close: each shows the saved first candle). It fails
on v567 at "back on Charts". The scroll-off path is not browser-tested: the
fixture has one instrument, so there is no second card to scroll to.

2026-11-02 QUARTER THIRDS SWITCH ON THE Q TIME GRID: app.js v567,
chart-preferences.js v9, grid-geometry.js v13, sync Worker. User: "just a
switch to turn on and off in the quarter time grid" (shown with screenshots
of a GOLD 1H Q chart with lines at the quarter's thirds). Grid menu → under
the Time grid row, only while Q is selected: "Split each quarter into 3".
On, each quarter gets two light unlabelled `reel-tgrid` lines at exactly 1/3
and 2/3 of the quarter on the same equal-year geometry (Q4 → ~1 Nov, ~1 Dec).
Nothing else changes: quarter lines, labels, bold year lines and the
alternating shading are identical (the thirds are `fixedOnly`, which the
shading skips). Saved as `thirds: true` on the market/timeframe grid row, so
it is per market and per timeframe like the division, survives switching to
M/H/Y and back, and syncs (the Worker's `grids()` now keeps the flag; it used
to drop unknown fields). Not drawn on a session-only 4H chart, which shows
half-years for Q (REEL_SESSION_GRID); the switch says so on 4H. The M grid
draws the same line positions with month shading and month labels; this
keeps Q's look.
2026-11-02 2H REMOVED AGAIN (same day): app.js v566, grid-geometry.js v12.
User: "remove 2h". Everything the morning's "2H CHART BACK, 4H KEPT" entry
(#119) added is taken out: the 2H button, its TIMEFRAMES row and
REEL_FRAME_VIEW entry, its yearly bold lines, `build_2h` in CHART_BUILDERS and
the 2H browser/unit tests. Kept from #119: the last-price line takes no
touches (`pointer-events="none"`), so a channel handle on the current price
stays grabbable. `build_2h` stays for research; the chart/2H R2 chunks are
orphaned as after the 2026-10-26 removal; a saved 2H chart choice opens on
Daily. 4H is unchanged.
2026-11-02 CASH INDICES READ "OPENS 10:00", NOT "NO RECENT QUOTE":
freshness.js v6. User, at 09:38 SAST: "The eu session is open and prices for
these not updating?" It was not open: since Europe's clocks went back on 25
Oct, the 09:00 CET / 08:00 GMT opens are 10:00 SAST. The Watchlist prices these
from the cash index, which prints only in regular hours, and `session()` knew
no index hours, so every one went red "No recent quote" an hour after the
close and stayed red all night. `INDEX_SESSIONS` now holds regular hours for
the 17 cash-priced indices (EU, SW20, UK100, SOX, CAN60, HK incl. its lunch
break, CHINA50's 2822.HK, NQTW, SG30SGD, AUS200, SA40). Outside them the tag is
grey "Opens 10:00" / "Opens Mon 10:00", in the device's time, DST-corrected
across a clock change; the tooltip says holidays are not known. Keyed by
ticker, not class (SOX is in the US100 group, class Equity). Futures-priced
indices (US500, US100, US30, RUSSELL, NI225) are deliberately absent: their
quote keeps printing out of cash hours. Why not futures for the rest: PR #120
(closed) listed every future Yahoo's lookup/search returns, 2,119 of them, and
found none for Eurex, ICE Europe, Euronext, HKFE, OSE or ASX; the SGX ones
trade 5-9 hours. Tests: freshness_test.cjs.

2026-11-02 2H CHART BACK, 4H KEPT: chart_feed.py + app.js v565,
grid-geometry.js v11. User: "Since the 4h is not used replace with 2h", then,
told that 4H also feeds the Watchlist's 4H aligned/minor tag, the relation
filter, MA clusters and the minor-opportunity alerts (the Daily → 4H → 1H
workflow, `daily500-4h-v1`): "Add 2h keep 4". Chart only, as on 2026-10-25:
no signals, markers, alerts, trend channels or setup context; header and
filters read the Daily row, as on Weekly/Monthly. 4H is unchanged.
- Data: `build_2h` is back in `CHART_BUILDERS` (chart/2H/<chunk>.json, a year
  of calendar, forming candle). No deep block. It goes through the chart cache
  like the others.
- App: a 2H button between 1H and 4H, its TIMEFRAMES row (chartOnly), and the
  opening frame REEL_FRAME_VIEW['2H'] restored: previous + current TWO-MONTH
  block round the clock, FOUR-MONTH blocks on session-only feeds, priced
  'centre' like 1H. Yearly bold lines as on 1H and 4H (new for 2H).
- Tests: stock_view_test.cjs (2H frames), time_grid_test.cjs (2H yearly
  lines), app_smoke.cjs (button order, 2H chunk drawn, no 2H markers or
  relation).
- Fixed with it: the last-price line takes no touches (`pointer-events`
  none). It is painted over the drawings, so a channel end handle sitting on
  the current price could not be grabbed through it. CI found it on
  2026-11-02, when the fixture's close fell exactly on the browser check's
  flat channel; main failed the same check that day.

2026-11-01 LADDER: GLOW COLOUR, ZERO HOLDS THE LADDER, "0" FRAMES FROM ZERO
(app.js v564, style.css v400, drawing-toolbar.js v9). User: "the glow can be
switched off and switched on only for the percentage lines, with also an
option to change color ... the percentage line not to go below [zero] ...
like that's a magnet ... on the US index I can't get to zero because price
is very high on 1 hour ... I also need to be able to get to zero."
- **Glow colour**: a colour row under the ladder bar while Glow is on
  (`draw-glow-color`, any-colour picker `draw-any-glow`, stored `d.glowColor`,
  drawn through `--reel-glow`). Blue when unset.
- **Zero holds the ladder** (`ladderHoldZero`): on a move, a 0% drag or a 40%
  drag, the lowest line (stacked blocks below included) stops on price 0 and
  snaps onto it from 18 viewBox units above. Lines under zero used to be
  dropped silently. **+▼ no longer refuses** a block that would sit under
  zero: the block is added and the ladder lifts so its bottom line is on 0.
- **"0" button** on the ladder bar (`chart-zero`): frames this chart's price
  scale from just below 0 to the top of the visible bars (`lockY._zero`);
  tap again for the normal fit. A view, not stored on the drawing.
- **Price zoom can always reach 0**: zoom-out limit is now the larger of 24x
  the visible range and 2.2x the visible high; a price pan may bring 0 just
  inside the bottom edge. Measured need: a 25,000 index with ~1,000 points of
  1H range stopped at 24x, well short of zero.
- Tests: drawing_toolbar_checks.cjs (glow colour, "0" on/off, move stops on
  0, +▼ lifts onto 0, drag keeps the bottom block on 0). The zero-stop check
  fails without `ladderHoldZero` (p1 -40.6).

2026-11-01 SELECTION SHOWS ON THE DOTS; GLOW IS A LADDER OPTION; LADDER
RESIZE DOT ON 40% (app.js v563, style.css v399, drawing-toolbar.js v8).
User: "that highlighted blue thing ... is a little bit too much ... don't take
it away ... add it as a feature that I can activate and deactivate, but only
for the percentage lines ... having their adjustment points highlighted in a
different color ... to adjust it, it's the third one. Maybe ... the fourth".
- A selected drawing's dots are solid blue with a white ring, whatever its
  colour. A LOCKED selected drawing now draws its dots too, hollow and with no
  `data-h` (`reelDrawLocked`, set around each render), so it shows it is
  selected without anything to grab.
- The blue glow (`.reel-ch-hit` halo) is off for every drawing; a selected
  ladder shows it, at half the strength, only when its **Glow** switch is on
  (`d.glow`, `draw-glow`, beside %).
- Ladder resize dot moved from the 30% line to the 40% line (the user counts
  10/20/30/40 up from 0%). `p4` is still the stored 30% anchor; the drag sets
  `p4 = p1 + (pointer - p1) * 3/4`.
- Tests: drawing_toolbar_checks.cjs (blue dots, hollow locked dots, no glow
  on a channel, ladder glow off/on/off, 40% dot position and drag).

2026-11-01 IPAD ALWAYS GETS THE LAPTOP WORKSPACE (app.js v562, style.css
v398). User: "make the iPad always use the laptop view". The Charts
workspace (chart left, Watchlist right) switched on at 1024px only, so an
iPad held portrait (744-834px wide on every model but the 13" Pro) got the
phone layout. app.js now detects an iPad (UA "iPad", or iPadOS's Mac UA with
navigator.maxTouchPoints > 1; real Macs report 0) and uses a 700px floor for
it; everything else keeps 1024px. The 700px floor leaves Slide Over and
narrow Split View (320-680px) on the phone layout, where the 260px+ list
would leave the chart almost no width. The style.css workspace block is
gated by classes app.js adds, so its media floor moved to 700px to match.
tests/ipad_workspace.cjs checks both UA kinds at 744/820/834/1024 portrait
and landscape, Slide Over/Split View switching back, and that a Mac window
and an iPhone below 1024px are unchanged. It is not wired into CI (that is a
workflow change for review). Seen while testing, NOT changed: an iPhone in
landscape (932x430) draws its chart card at 0 height, identically on v561.

2026-11-01 FOOTER CAPSULE: SAVE | DRAW, TWO EQUAL PRESS/UNPRESS SWITCHES
(app.js v561, style.css v397). User: "change the word edit to draw so that
they can equally be a pill that's split into two equal parts, and then make
both buttons pressable ... I don't want the long press to unpress. I just
want it press, unpress ... for press, saved, give it green. And maybe give
it an orange, but very light colors".
- The drawing half always reads **Draw** (was Drawing / Edit / Done); its
  pressed state is Draw mode open, shown by colour and `aria-pressed`.
- **Save toggles**: a tap saves, a tap on a saved view forgets it. The 700ms
  hold-to-forget (`VIEW_FORGET_HOLD_MS`) is removed. This reverses the
  2026-09 "a tap always saves" rule by the user's call; tapping Saved again
  "to make sure" now forgets the view, by design.
- Equal halves: `.reel-capsule` is a `1fr 1fr` grid; a hidden second label
  reserves "Saved"'s width so the pill never changes size.
- Colours: light green (Saved) and light orange (Draw on). The card footer is
  dark, so there they are faint tints with soft text; the full-screen footer
  is white, so there they are pale fills with darker text.
- Test: chart_framing_checks.cjs (second tap unsaves and forgets the stored
  view, third saves again).

2026-11-01 DRAWINGS: VISIBLE SELECTION, TAP-AWAY DESELECT, CHANNEL ENDS
ALWAYS GRABBABLE (app.js v561, style.css v397). User: "the channel to move
smoothly. Sometimes both ends, when I try to adjust the direction, it doesn't
move ... When I select, it doesn't give any indication that it has been
selected ... when I click away, I'd like for it not to be selected ... when I
click on the channel and it's locked, it doesn't even give an indication".
- **Selection shows.** `.reel-draw.is-sel .reel-ch-hit` turns the selected
  drawing's own tap lines into a soft blue halo. The old cue (a heavier edge
  stroke) was beaten by the `!important` line-weight levels, and a LOCKED
  drawing has no handles, so a selected locked drawing looked idle.
- **Tap away deselects.** A tap on empty chart in Draw mode stores -1 in
  `reel.activeCh` (`clearActiveIdx`); `activeIdx` returns -1 for it, so
  Lock/Duplicate/Delete grey out. Draw mode stays open. An absent entry still
  falls back to the newest drawing, and Delete still re-selects it.
- **Selected drawing painted last** (`reelChannelsSvg`). In list order a
  drawing added later (a ladder's eleven 40-unit tap lines) sat over the
  selected channel's end handles and took the touch, turning the drag into a
  pan. Every element carries its index, so the order is free.
- **End handles always on screen.** An end whose date was off the panel had
  no handle, so the direction could not be changed without panning to it.
  It now gets a handle at the panel edge on the midline (both on one edge:
  spread to 1/4 and 3/4); dragging it re-anchors that end there and the
  channel pivots on the other.
- Ends can no longer be dragged onto the same bar, and
  `reelDateForBarIndex` projects before the oldest bar (it clamped to bar 0,
  so an end dragged left of the data stuck).
- Tests: drawing_toolbar_checks.cjs (halo incl. locked, tap-away, ladder on
  top when selected, both ends drag, ends reachable zoomed past both). Each
  new check was run against the code without its fix and failed.

2026-11-01 PRICE LADDER STARTS WITHOUT % LABELS; 1H BOLD LINES ARE YEARS
(app.js v560, grid-geometry.js v10, drawing-toolbar.js v7). User: "As a
standard, let's make sure that the percentage lines on a default when you
place them do not have the percentage labels. Then on the 1 hour chart ...
the bolded vertical lines should be 1 year apart."
- A NEW price ladder is created with `hideLabels: true` (reelDefaultLadder),
  so its 0%-100% labels are off until the % button turns them on. Ladders
  already saved keep whatever they had: nothing rewrites stored drawings.
- 1H's permanent bold lines are now one per calendar year (the 4H branch,
  `annual`, labelled "2026"), replacing the bold quarter lines added
  2026-10-08. The selected M/Q/H/Y grid and its shading are unchanged.
  `.reel-tgrid-quarter` CSS is left in place, now unused.
- Tests: time_grid_test.cjs (1H yearly, equal, no quarters),
  drawing_toolbar_checks.cjs (a new ladder shows no % labels).

2026-11-01 CHART FEED CACHE + PROCESS POOL + UPLOAD ONLY CHANGED CHART FILES
(webapp/chart_cache.py, chart_feed.build_chart_feed, publish.upload_to_r2).
User: "it looks like will need more data in all time frames. how can we do this
without affecting the code run time?" Measured first, on 12 hourly runs: the
chart feed was 300-554s of 8-16 min runs (signals 10s, R2 upload ~75s), and it
rebuilt all 814 x 4 charts every run, including markets closed since the last
one. Profiled on 40 instruments: the builders are 64% of the feed and their
cost is frame_context re-running add_workflow_signals over the WHOLE history
(5.0 of 9.2s Daily, 2.3 of 5.4s 4H), not the bars shipped; the after-steps
(gzip, setup context, alerts, markers, channels) are the other 36%.
- A built chart is reused when the engine (every .py/.json in swing_generator/
  and webapp/), the UTC date, the resolved source tickers and every parquet the
  build read (or looked for and missed) are unchanged, AND every intraday bar it
  read had finished (4H from 1h files, 30m from 5m). The reads are recorded, not
  listed, so a builder that starts reading a new file is covered automatically.
  Entries: cache_ma500/chartcache/<tf>/<ticker>.pkl (zlib pickles, ~130 MB for
  the whole board), carried by actions/cache with the parquet files.
- Charts that do rebuild run in worker processes (the thread pool ran on one
  core: the builders hold the GIL). Builders are looked up by name so a test
  patching one is the one that runs; under 32 builds it stays in-process.
- Parity: old code, new cold cache and new warm cache produced byte-identical
  output on all 36 feed files (40 instruments). Warm run on a Sunday: 151 of 160
  charts reused, 15s -> 6s locally.
- R2: every chart chunk was re-uploaded every hour — ~500k of the free 1M
  Class A writes a month. publish.py's hourly upload now skips chart files whose
  bytes match cache_ma500/r2_manifest.json; every upload (deploy-app included)
  records what it sent; a full re-upload happens once 24h have passed since the
  last full one, which bounds any drift. Core data files always upload.
- tests/chart_cache_test.py covers reuse, invalidation (changed file, file that
  appears later, unfinished bar, new UTC day, new engine) and the manifest.
  NOT yet in the CI test lists — that is a workflow change for review.
DEEPER HISTORY, same change: builders return today's bundle UNCHANGED plus a
`deep` block of older bars (chart_feed.DEEP_BARS_BY_TF); _attach_deep stitches
it on in front only as the file is written, shifting mi/sg/xm. So the
after-steps (markers, alerts, setup context, activity, trend channels) see
exactly the window they always did — measured: deep vs current depth, all 36
feed files identical apart from the added prefix, alerts/trends/activity/index
byte for byte. Without the split, 2.5x the Daily bars cost the after-steps
+4s per 40 instruments and would have changed what alerts and the trend
channels compute.
- Daily: 1,300 bars (~5y) -> the whole 13-year cache (median +1,967 bars).
- 1H: 6 -> 12 months (median +974 bars).
- 4H: unchanged today (it already carries the whole ~2y hourly cache past
  MA500's warm-up); +2,200 bars of room as that never-trimmed cache grows.
- 30m: unchanged at 5 months — the 30m SIGNALS run over the whole 5m cache,
  so keeping more 5m history would slow every open-market run.
- `am` (full-precision Daily MAs) is no longer written: only cross_marks reads
  it, before the write; the app never did. That is why the Daily chunks grew
  only 32% (2,564 -> 3,376 KB on 40 instruments) for 2.5x the bars; 1H +89%.
- Opening views are calendar frames (Daily: 1 year back + 2 ahead), so every
  chart opens exactly as before; the extra history is behind it on zoom-out.
  Checked in the app on ADP: Daily zooms out past 2017 with the ribbon
  continuous across the join; 1H spans Q1-Q4.
- server.py (local dev) stitches the same way.
- A broken worker pool (worker killed, cannot start) falls back to building
  in-process instead of failing the feed.

2026-10-31 DAILY BARS REPAIRED FROM THE HOURLY FEED (data_fetcher.repair_daily,
applied inside scale_daily so signals, every chart, the ledger, the backtest and
Market all read the same bars). User, PALLADIUM Daily: "Why palladium platinum
and silver candles or bars look like they breaking up." Three causes, measured
on the live chart feed:
- Flat bars: Yahoo's PA=F / PL=F daily print open = high = low = close on 72% /
  59% of days since 2025 (USDCNH 73%, COCOA 25%, COTTON 17%, COFFEE 15%,
  OATMEAL 14%, SILVER 8%). A dot per day reads as a dashed line.
- Truncated metal futures: on their non-flat days the COMEX metals' daily bar
  is ~half the traded range (hourly/daily range 1.98x SILVER, 2.14x PALLADIUM,
  2.00x PLATINUM, 1.85x COPPER, 1.50x GC=F; median instrument 1.00x).
- Weekend stubs: 91 currency/futures instruments carry 5-19 Saturday/Sunday
  bars, all since 2026-08-29 (weekend runs capturing Yahoo's live snapshot).
Rule: weekend bars dropped unless they are >= 15% of the frame (crypto 29%);
flat bars get open/high/low from the instrument's OWN hourly file, grouped by
CME trade date (18:00 New York opens the next date) and scaled by the trailing
20-date median of daily/hourly close; futures whose hourly range is >= 1.3x the
daily (metals only) also get high/low widened to every hourly print. Closes are
never changed, bars are never narrowed, the cache on disk is not touched, and
bars older than the ~729-day hourly history stay as they were.
Simulated on the live feed since May: PALLADIUM flat bars 90 -> 2 and bars
that miss the previous close 88% -> 23%; PLATINUM 79 -> 3, 85% -> 26%; SILVER
66% -> 20%; COPPER 61% -> 24%. 25 instruments have a bar rebuilt; equities,
indices, CL=F, wheat and crypto unchanged apart from weekend stubs. Golden
snapshot identical (36 frames, 1,588 fires); new checks in golden_test
(_daily_repair_checks) fail if the repair is switched off or widens CL=F.
Daily signals on the affected instruments can change (B3/B4/S3/S4 need a wick).
The backtest/confidence map was NOT re-run: no CI job runs it and it needs
the local cache.

2026-10-31 UNIVERSAL READABILITY REVIEW: app.js v559, style.css v396.
Phone and laptop share Thin / Medium / Thick for native chart MAs, overlays,
projections, calendar guides and every drawing tool. Native Thick retains
7-unit dots; Thin and Medium use 35% and 60%. Explicit old channel weights,
bold drawings and overlay multipliers remain valid; new choices are saved
without changing drawing geometry, hit targets or saved chart frames.
The price axis uses actual plot height and nice 1/2/2.5/5/10 steps, omits
labels beneath the current-price badge, and preserves instrument precision.
No new horizontal grid lines or trading/data changes. The user approved
production release after implementation; both device suites and exact served
production assets are verified by the release workflow.

2026-10-31 DESKTOP WORKSPACE REVIEW: app.js v558, style.css v395. At widths
1024px and above, Charts embeds the existing white chart on the left and
moves its existing filters and instrument list to a collapsible right panel.
Expand uses the white viewing area; Restore/Escape returns to the prior panel
state. Chart rendering, data, saved views, drawing tools and timeframe rules
are reused. Guide strokes are thinner only in the desktop workspace. Below
1024px the existing phone/tablet UI is retained. A dedicated review workflow
checks phone regressions and desktop sizes/interactions, then publishes only
to a Pages preview branch with browser-local saves and production sync blocked.
This is a review build: production release requires the user's later approval.


2026-10-30 (later) 1H TWO-MONTH BLOCKS UNDONE: app.js v557. User: "Please
undo 108". The entry below is reverted in full: 1H opens on the previous +
current month and draws the market's grid choice on every chart again,
session-only or not (REEL_FRAME_VIEW['1H'] has no sessionUnit; reelTimeGrid
scales up on 4H only). It came after a screenshot of DAX 1H (2M grid,
candles in the left third, 21,000-32,000 price scale), which was a SAVED
VIEW, not the new opening frame: a saved view opens instead of the opening
frame, and that one's price range matched the old (pre-v553) card-saved view
opened full screen. v557, not back to v555, so phones fetch the reverted code.

2026-10-30 1H: SHORT-SESSION CHARTS IN TWO-MONTH BLOCKS: app.js v556. User:
"Separate the us indices from eu and other small ones ... we have us longer
than eu so month is good for 1h us but not good on eu and other small ones",
then "two months" for "all short-session charts". The US indices' 1H feed is
the futures (~23 bars a day), so a month held ~480 candles on US100 against
~190 on DAX, ~125 on an Asian index and ~140 on a US stock. A session-only 1H
chart (reelSessionOnly, under REEL_SESSION_HOURS of bars a day) now works as
session-only 4H already did: REEL_FRAME_VIEW['1H'].sessionUnit = 1/6 opens it
on the previous + current two-month block (1 Jul to 1 Nov on 30 Oct), and
reelTimeGrid draws one size up from the market's choice (Month -> two
months, Quarter -> half-year). Round-the-clock 1H charts (US indices, crypto,
forex, commodities) are unchanged. Tests: time_grid_test.cjs (its 1H
geometry checks moved to a 24h hourly feed; the old "session-only 1H keeps
the market's choice" check is now the reverse), stock_view_test.cjs.

2026-10-30 DRAWING BAR: DUPLICATE AND DELETE: drawing-toolbar.js v5,
style.css v394. User (screenshot of the drawing bar: Drawing · lock · undo ·
redo · ⌄ · Done): "put the delete and duplicate icon here". They moved out
of More (•••) into the bar, as icons after Lock, greyed out like Lock while
no drawing is selected; More keeps the ladder's remove-stack buttons, Show
on and the line intensity. The bar now holds up to seven buttons, so under
420px the tool's name gives way to its icon (the redo button already hides
while the panel is folded). Test: drawing_toolbar_checks.cjs (Duplicate and
Delete from the bar, not repeated in More; the 320px fit check passes).

2026-10-30 TRADINGVIEW REMOVED: app.js v555, style.css v393. User: "We no
longer need tradingview we can remove all connections to it". Gone: the
TradingView button on every chart card and its Web/App picker
(openTvPicker, tradingview:// deep links), "Open in TradingView" in the
Watchlist sheet, the link in the details modal, the TradingView line in a
shared card, the icon buttons on the old feed/trend cards, the per-user
layout ids (publish.py TV_LAYOUTS, app.js userTvLayout), the `tv` interval
on app.js TIMEFRAMES, tv-map.json (server /api/tv-map + build_tv_map,
publish, health_check PARSEABLE, the browser fixture) and the CSS for all
of it. The old tv-map.json object is left on R2, unreferenced. KEPT, under a
new name: the crypto exchange pairs (BINANCE:XRPUSDT, COINBASE:BTCUSD) that
set where crypto prices come from. They lived in tv_symbols.py; they are now
crypto_exchanges.py CRYPTO_EXCHANGE (the 55 crypto instruments, generated
from the old table, so identical), read by exchange_feed.py; the live
worker still reads them from quotes.json. tv_symbols.py is deleted. Comments
that cite TradingView as the reference a chart's geometry was matched to
are left as history. Test: app_smoke.cjs (no TradingView button, text or
request), exchange_feed_test.py (every crypto reads its exchange pair).
2026-10-30 CURRENCY INDICES FOR TEN MORE CURRENCIES: currency_index.py,
Instruments.txt (#812-821). User: "can we build currency index
for other currencies". ZAR, MXN, SGD, SEK, NOK, TRY, PLN, HUF, CZK and CNY
(CNY=X, the USD/CNH quote), as CCY_<X> / <X>_IDX in the Currency Index group.
Each is the currency against all 8 majors, equal weight, through its USD
pair: ln(M in Y) = ln(M in USD) + ln(USD in Y), the no-arbitrage cross, from
pairs already downloaded (no new download). 100 on the first bar on or after
BASE_DATE; that base is stored with the majors' in CCY_BASE.json so the 5m
and 1h frames match the daily level; a stored base without it skips the
minor rather than invent one. A missing or short USD pair costs that one
index, never the eight majors, which are byte-identical with or without the
minors. HKD is left out: pegged to the dollar, its index would be the
dollar's. The Market currency focus still ranks the 8 majors only. The
unused TV_SYMBOL table goes with the TradingView links (removed the same
day). Instruments: 805 -> 815. Test:
htf_feed_test.py CurrencyIndexTests (synthetic consistent prices).
2026-10-30 FILTERS BELONG TO THE LIST: app.js v554 (same release as the
Charts row below). User: "when switching between lists the filter must go
off and only work within the selected group and not from an old list", and
"keep the filter but works within the selected group or list and when I move
to another list it goes off". Watchlist: wlSetList() switches every filter
off (class, sector, industry, trend, 4H direction, MA clusters) whenever
another list opens: a list chip, the swipe, the "Mine ✕" chip, a new or
deleted list. Sort and search stay. "Search all markets" on an empty result
keeps them (data-wl-keep), since it asks for the same filters everywhere.
Charts: the filters work inside the set in view (a watchlist opened there,
"charts like X") and reelFiltersOff() runs when that set changes
(reelSetKey); opening another chart of the same set keeps them, and a
Market tap starts from none. Tests: app_smoke.cjs, charts_row_checks.cjs,
dollar_index_checks.cjs.

2026-10-30 CHARTS: ONE ROW, FIVE VIEWS: app.js v554, style.css v392. User:
"Can we apply this to the charts as well?", then chose the Watchlist row
layout. The Charts row of Show / Class / Sector / Trend / MA / Sort dropdown
buttons is gone. A dropdown (#reelDdMode) before the row picks what it holds
(Show, Class, Sector, Trend, MA) as chips scrolling sideways, drawn from
`reel` in reelSyncPills on every buildReel; taps go through one handler on
#reelRow (data-rk / data-rv), MA clusters through the shared cluster handler.
Sector opens its industries after the picked sector; Trend shows Daily then
4H; MA shows order, clusters, width, near MA and within. The view menu names
each filter's value and the dropdown counts them; the view is remembered
(swingpulse-reel-mode). Sort and reset moved beside the search (.reel-head2).
The Show / Class / Sector / Trend / MA menus are gone from #reelMenus; Sort's
stays. Fixed with it: the "Daily" / "4H" labels in the Trend view (Watchlist
too) ran into the first chip, because an old 1px-divider `.wl2-sep` rule set
their width. Test: charts_row_checks.cjs, run from app_smoke.cjs.

2026-10-29 (later) CHART SAVE KEEPS THE EXACT FRAME: app.js v553. User: "After
I click save, it must capture the frame, the way it is, where I put it, and it
should open right there." A saved view was relative: bars back from the newest
bar and price per PIXEL around the latest close (2026-09-25 design). So it
moved with every new candle and every close, and a frame saved on the card
opened in full screen with over twice the price range (Daily test chart:
73-142 on the card, 33-182 full screen; saved full screen 78-137, card
94-121). Now a save (`v: 2`) is the first candle in view (`start`), the window
width (`slots`, blank future included) and the price window (`lo`/`hi`), and
it opens on exactly that on the card and in full screen; new candles fill the
blank space. The held window is `_saved` in reel.lockY, which full screen no
longer rescales and hands back to the card on close. A tap on Save always
saves (it toggled, so a second tap "to make sure" forgot the view); hold Save
0.7s to forget. Views now SYNC (`views`/`viewsMod`, merged view by view in the
Worker's mergeViews like notes); they were on one device only, and an iPhone
home-screen app and Safari do not share storage. Old v1 views open the old way
until saved again. Each save also records context that is never read back
(close, newest bar, blank bars, card/full, plot height) so
research/read_views.py can report how the user frames each timeframe and
class (from the Saved work backup file or the synced copy). Not done: the
opening frames are unchanged until the user asks to set them from those
medians. Tests: chart_framing_checks.cjs (exact restore, second tap keeps),
sync-worker saved_work_test.mjs (views merge). Also checked by hand in the
browser: save on card or full screen, reload, both match on 1H/4H/D/W; a new
candle after the save keeps the same dates and prices.

2026-10-29 (later) ONE DOLLAR INDEX: app.js v552. User asked why the dollar
index had drawings in one list and none under Currency Index: they were two
instruments, USDX (ICE's DXY, Yahoo DX-Y.NYB, the one with the drawings) and
USD_IDX (currency_index.py's equal-weight USD basket). User: "Make the one
with drawing the only one", then chose to hide USD_IDX rather than delete it,
because the Market tab's Currency strength card ranks the 8 baskets and USDX
(57.6% EUR) cannot stand in for USD there. app.js HIDDEN_INSTRUMENTS leaves
USD_IDX off the board (allData), so the Watchlist, Charts, search, a list's
count and Alerts never show it. USDX shows in the Currency Index group AS
WELL AS its own US Index (user: "should appear in both"): app.js
ALSO_IN_GROUP adds a copy of its row under each extra heading in All
markets (a list holds it once), and the Ccy Index class, the Charts class
chip and search (matchesSearch's group haystack) find it under either. Live
prices repaint every row of a name, not just the first. Nothing
server side changed: USD_IDX is still built and published, and still ranks
USD in trend_channels.json `ccy`. Test: dollar_index_checks.cjs, run from
app_smoke.cjs.

2026-10-29 (later) WATCHLIST: FILTER VIEWS SAY WHICH LIST THEY SEARCH:
app.js v551, style.css v391. User screenshot: Sector · Basic Materials (34)
read "Nothing matches". The filter counted 1, so the cause was the open
list: a filter view searches the list that is open, and with one of the
reader's own lists open nothing on screen said so. Now a chip beside the
dropdown names that list ("Mine ✕"; a tap goes back to All markets), and an
empty result reads "Nothing in Mine matches" with a Search all markets
button. Same screenshot: the picked sector was cut off on the left, because
a new view centred its pick and "Basic Materials 34" is wider than the row
on a phone. The pick is now scrolled only when it is not wholly in view, a
too-wide one lines up with the row's left edge, and a new view starts from
the left. Test: app_smoke.cjs. Not merged with #99 (one Filters button),
which the user paused.

2026-10-29 WATCHLIST: ONE ROW, FIVE VIEWS: app.js v550, style.css v390.
User: "remove class, sector trend, clusters and put them in a dropdown menu
with all markets ... if i select class then i should have all the class in
the same line as all markets ... i can scroll left or right". The row of
Class / Sector / Trend / Clusters / Sort dropdown buttons is gone. The lists
row now starts with a dropdown (Lists · Class · Sector · Trend · Clusters)
that picks what the row holds; the chips scroll sideways and a new view opens
scrolled to its current pick. Sector opens its industries right after the
picked sector, in the row; tapping the sector again closes it. Trend shows
Daily then 4H; Clusters shows the modes then the width. Filters set in
another view still apply, so the menu names each one's value and the dropdown
carries a count of the filters set. The swipe on the list steps through what
the row holds (it switched lists only, which would change a hidden pick in
the other views). Sort and the reset button moved beside the search. The
view is remembered (wlUi.mode); reset clears the filters and keeps the view.
sectorLists() is shared by the Charts sector menu and the row. Tests:
app_smoke.cjs (views, swipe, count, menu value, industries, reset),
stock_view_test.cjs loads sectorLists.

2026-10-28 MONTHLY OVERLAY FROM THE WHOLE HISTORY: app.js v549. User: "Add the
500ma and where it shows it show and where it does not it doesn't really
matter", then "like on the monthly MAs". The Monthly overlay on Daily, 4H, 1H
(every chart but Weekly, whose own `mo` is already whole-history, and Monthly)
was rolled over the 13-year Daily cache, so only its 50 ever warmed. With the
Monthly overlay on, the app now also loads the instrument's Monthly chart
chunk (publish_htf, whole Yahoo history) and rolls the overlay's Monthly
lines from its closes (ovDeepMonthly / ovHtfView), appending the months the
Daily feed has that the Monthly job has not published yet, the one in
progress included, labelled as chart_feed._htf_mas labels them. Every set
(3/5/9 MA) draws each period the history warms: on R2, 104 instruments warm
the Monthly 500 and 550 the 250. The overlay menu lists the whole set for
Monthly (was cut at 200). Checked against the Monthly chart's own MAs on
US500, LLY, KO, AAPL: worst difference 0.0005% (rounding). The lines join the
opening view's capped price fit like the Weekly ones; a line beyond the cap
is named off-screen. The MA-clusters filter still counts only the Monthly 50
(server side, from the Daily feed). Test: app_smoke.cjs (Monthly overlay on
Daily draws an M250 the fixture's Daily bundle cannot; menu lists 500).

2026-10-28 FULL SCREEN NAMES ITS TIME GRID: app.js v548. User: "i just need
to see what time grid i am on when the app is on full screen", then chose
"beside the timeframe". The full-screen header reads e.g. "AAPL Monthly · 10Y":
the grid's button label (M Q H Y ½T T 10Y 20Y, 2M for a session-only 4H's
two-month blocks), titled with its full name. It is read off the lines just
drawn (reelSyncGridTag, from reelChartSvg), so it changes the moment another
grid is picked and names what is on screen when a session-only 4H draws one
size up from the market's choice. Test: app_smoke.cjs (tag present; follows
a change to Month).

2026-10-28 R2 READS GET A WHOLE-BODY DEADLINE: tools/health_check.py,
tools/validate_hourly_release.py. Same day as the health-check retry. A body
that keeps trickling in never trips urlopen's per-read timeout: the 10:05
health check spent 12 minutes reading before it failed, and at 14:23 SAST the
release's "Verify the live app" printed nothing for 13 minutes on its first
R2 read, holding the shared release lock (so blocking the next hourly run)
until it was cancelled by hand. health_check._read_all now stops a body
still arriving after 90 s with a TimeoutError, which the existing retry
(3 tries, 5 s then 10 s) treats like any other stall; validate_hourly_release
--live reads through the same helper and retry. A healthy read of the largest
file (~2 MB) takes under a second. Tests: shape_audit_test.py
(HealthCheckFetchRetryTests: trickling body, whole body).

2026-10-28 WEEKLY 10Y TIME GRID: app.js v547, chart-preferences.js v8. User:
"apply 10y time grid on weekly". The 10Y choice (a line on every decade,
2000, 2010, 2020, 2030) is offered on Weekly as well as Monthly, after T, so
Weekly's menu reads M Q H Y / ½T T 10Y. 20Y stays Monthly only. Same
geometry as Monthly's 10Y; app.js LONG_GRID_TFS names where each long
division is offered. Weekly opens on four terms (2013-2029), so the opening
view shows the 2020 line, with 2010 and 2030 just outside it. Test:
time_grid_test.cjs.

2026-10-28 MONTHLY 20Y REPLACES 5Y: app.js v546, chart-preferences.js v7,
grid-geometry.js v9, sync worker. User: "Replace the monthy time grid 5y for
Mothly with 20y". Monthly's menu now reads M Q H Y / ½T T 10Y 20Y. 20Y (code
Y20, "Twenty years") puts a line on 2000, 2020, 2040, the same equal-year
geometry as 10Y. Y5 is no longer a choice: a Monthly grid saved as 5Y falls
back to the default Term, and the sync worker no longer stores it. The
Monthly charts are deep enough for it: tools/publish_htf.py builds them from
each instrument's whole Yahoo history (measured on R2 2026-10-28: 783 of 805
instruments, median first bar 2000, 58% start in or before 2000, US500 from
1927), and Monthly opens on all of it. Tests: time_grid_test.cjs,
sync-worker saved_work_test.mjs.

2026-10-28 HOURLY RUNS: HEALTH CHECK RETRIES, :35 BACKUP RETRIES A FAILED
RUN. tools/health_check.py, cron-worker. User: "My hourly updates keep
breaking and the 30m back up fails please fix". The 10:05 and 11:05 publish
runs both uploaded every file ("App updated!") and then went red in "Verify
the publish moved the data": r2.dev read and TLS-handshake timeouts on 3 and
2 files (a different set each time), which also set status.json to failed
and sent a failure push for data that was fine. health_check._fetch now
tries a read that times out or loses its connection up to 3 times, waiting
5 s then 10 s; an HTTP error fails at once and a file still unreadable after
the last try fails as before (shape_audit got the same retry earlier today).
The :35 backup only asked whether a run had been CREATED in the last 45
minutes, so a :05 run that failed was never retried. It now also dispatches
when the recent run has finished without success (failure, timed_out,
cancelled ...); one still queued or running is left alone. Tests:
cron_worker_test.mjs, shape_audit_test.py (HealthCheckFetchRetryTests).

2026-10-28 MONTHLY 5Y AND 10Y TIME GRIDS: app.js v545, chart-preferences.js v6,
grid-geometry.js v8, sync worker. User: "Add 5 and 10 time grids for months
only". Two new Time grid choices, 5Y (code Y5, "Five years") and 10Y (Y10,
"Ten years"), offered on the Monthly chart only, after T, so Monthly's menu
reads M Q H Y / ½T T 5Y 10Y. Five years fall on 2010, 2015, 2020, 2025 ...
and ten on the decades (2000, 2010, 2020, 2030), labelled with the plain
year. Same equal-year geometry as Term, shading alternating part by part,
the next line projected. grid-geometry's term loop now takes any multi-year
span; T and T2 draw exactly as before. The sync worker accepts Y5/Y10.
Tests: time_grid_test.cjs (Monthly only, order, lines, labels, equal gaps,
shading, saved), sync-worker saved_work_test.mjs (Y5/Y10 sync).

2026-10-28 WEEKLY OVERLAY PURPLE: app.js v544 / style.css v389. User: "The
orange for the weekly MAs looks close to red… can we find another tone that
is far from red?" `--reel-ov-w` goes from orange #ea580c to purple #9333ea.
Red (falling), green, blue (Daily overlay) and black (this chart's own MAs)
were all taken; purple is the remaining hue that is far from red. Its nearest
neighbour is the Daily blue (#2563eb), told apart by hue and the dash. Only
the colour changed; app.js changed in a comment only.

2026-10-28 HALF-TERM TIME GRID: app.js v543, chart-preferences.js v5,
grid-geometry.js v7, sync worker. User: "add 1/2 a term under time grid". A
new Time grid choice, ½T (code T2, "Half term"), on Daily, Weekly and Monthly
only, like T: one equal division every two years from 2025 (2021, 2023, 2025,
2027 ...), labelled with the administration on a term year ("2025 · Trump
II") and "2027 · 2nd half" between. Shading alternates half by half. It
sits before T, so the menu's second row is the two term choices. Daily keeps
its bold term lines on top. The sync worker accepts T2, so the choice
syncs across devices. Test: time_grid_test.cjs (lines, labels, equal gaps,
alternating shading, offered on D/W/M only).
2026-10-28 SHAPE AUDIT RETRIES A SLOW R2 READ: tools/shape_audit._fetch_json.
User: "Yes do it". Twice today (#82, #83) the golden job's `shape_audit --only
code` went red on an R2 read TimeoutError with the code unchanged, and one
re-run passed both times. A read that times out or loses its connection is
now tried up to 3 times in all, waiting 5 s then 10 s; an HTTP error (404,
403) fails at once, and R2 still down after the last try fails the job as
before. Test only, the app is unchanged. Test: shape_audit_test.py
(FetchRetryTests).

2026-10-28 WATCHLIST SORT KEEPS THE SECTIONS: app.js v542. User: "Make sort in
All Markets keep the grouping only sorting the order in the group same as the
watchlist with divisions". Any sort but By group used to flatten the list into
one run with no headings, in All markets and in a list alike. Now All markets
keeps its groups (in their usual class/group order) and a list its divisions;
Top gainers / Top losers / A-Z order only the rows inside each section. By
group is each section's own order (A-Z in All markets, the list's order in a
list). The Charts reel steps through the rows in the screen's order. Checked
on live data: All markets by Top gainers keeps AFRICA INDEX / ASIA INDEX /
..., ASIA INDEX running +1.77% NQTW, +0.51%, +0.49%, +0.43%. Test:
app_smoke.cjs (a division and the All markets groups survive Top gainers).

2026-10-28 4H CHART FOR YOUNG LISTINGS: chart_feed.build_4h_live. User: "fix
cerebras 4h it shows no data". CEREBRAS (listed May 2026) holds ~230
four-hour bars, so only MA50 is warm, and build_4h_live dropped any chart with
fewer than MIN_RIBBON_LINES (2) MAs: no 4H bundle at all ("No chart data").
It now draws with MA50 alone, as build_daily already did (CEREBRAS Daily:
115 bars, MA50); only under 50 bars is there still no chart. MA250 joins
by itself once 250 bars exist. Other builders keep the floor. Golden
identical. Test: four_hour_test.py (young listing draws with [50] and runs
through setup context and channel_rule; under 50 bars none).

2026-10-28 FULL NAME IN THE FULL-SCREEN CHART HEADER: app.js v541 / style.css
v388. User, on MPWR 4H: "add the instrument full name here". The full-screen
header gets a line under the symbol with the instrument's full name
(instName, from names.json: "Monolithic Power Systems"), one line, ellipsis
when long; left out when the name is only the symbol again. Test:
app_smoke.cjs ("Test instrument" on the fixture).

2026-10-28 SELECTED WATCHLIST TAB AS A GOLD PILL: style.css v387. User: "put
a background that compliments the tab section", then, pointing at the bottom
bar, "Some like the selection at the bottom". The selected list tab (All
markets / your lists) is now the bottom bar's selected style: #fbbf24 pill,
dark bold text, the same gold glow (smaller), count at 70% opacity. It was an
underline on a ruled row; the rule is gone, the row pads its edges so the
glow is not clipped. (A first reading, a card behind the ACTIVE strip, went up
as PR #80 and was closed unmerged.)

2026-10-28 SWIPE BETWEEN WATCHLIST LISTS: app.js v540 / style.css v386. User:
"here i need an option to scroll left and right in between price lists". A
sideways swipe on the price list (#wl2Body) moves to the next list tab (swipe
left) or the previous one (swipe right), in tab order: All markets, then the
reader's lists (wlSwipeWire, wlStepList). The list follows the finger at half
speed, the new list slides in, the tab row scrolls its tab into view and the
page goes back to the top of the list. Past the first or last tab it gives
only a little and stays. Needs 60px and a mostly sideways move (|dx| > 1.5
|dy|), so vertical scrolling and the pull-to-refresh are unchanged
(touch-action: pan-y). Off while editing a list or on a drag grip. Test:
app_smoke.cjs (left, right, the ends, a vertical drag, a short nudge).

2026-10-28 ACTIVE: TAP FOR THE NUMBERS: app.js v539 / style.css v385. User,
on the one-line strip: "how do u check per time frame?", then "Yes add it and
deploy". The counts and dates had gone into hover titles, which a phone never
shows. Tapping ACTIVE (now a button with ▾) opens a plain panel under the
line: per timeframe its date, every busy sector (a market-wide timeframe is
listed in full, under a "Market-wide · N sectors" note) and what made it busy
("14 big moves", "7 signals · 6 vol"); each entry opens that sector on that
timeframe like the line's letters. Tap ACTIVE again to close; the state is not
remembered, so every visit opens on the one line. Test: app_smoke.cjs.

2026-10-28 ACTIVE STRIP DOWN TO ONE LINE: app.js v538 / style.css v384. User,
off the three-row version: "Is this the best you can do ? I hate clutter".
Three rows of boxed chips (sector, arrow, counts) took ~a third of the phone
above the lists. Now one line, plain words: "ACTIVE Industrials D W▼ ·
Currency W M▼ · Crypto M▲" — each SECTOR once, then the timeframes it is busy
on, each letter coloured by its own direction; counts and dates moved to the
tooltip. The name opens its shortest timeframe, a letter opens that one. Day's
radar part now uses the radar card's own display gate (z >= 2 or two days
running) instead of its 1.5 alert line: on 27 Oct that left Industrials of
the five. Moves keep z >= 1.5. Long sector names are shortened (Tech,
Financials, Staples, Cyclicals, Materials, Comms, Indices). Market-wide stays
one word per timeframe that opens into the names. Checked at 390px on live
data: fits on one line; Currency's W opens Weekly on the 57 pairs.

2026-10-28 ACTIVE AT LAST CLOSE (Day / Week / Month): webapp/activity_feed.py
+ app.js v537 / style.css v383. User: "I spend most of my time looking at my
... watch list, and then I miss the active markets", Forex above all ("the
daily price movements, those must count a lot"), then "build this thing for
monthly and weekly". A strip at the top of the Watchlist, one row per
timeframe, naming the radar sectors busy at the last close; a tap opens that
sector's markets on Charts at that timeframe, biggest movers first ("Active:
Currency · Week"). Six or more sectors at once collapse to one "Market-wide"
chip that opens into the list. A timeframe with nothing busy has no row.
- BIG MOVE: a closed bar whose close-to-close change is >= 2x the
  instrument's own typical change (sd of its previous 60 changes). Measured on
  the published bundles before choosing: 5.3-6.0% of Daily bars in every radar
  sector (Currency 5.7%), Weekly 5.3-6.5%, Monthly 5.3-6.9%. ATR was rejected:
  Forex reached 1.5x ATR on 1.9% of days against ~4.6% elsewhere.
- ACTIVE: the sector's share of big moves vs its own last 20 bars, z >= 1.5
  (sector_activity._z_series, the radar's formula). Each sector ~9-12% of
  days, ~10-12% of weeks, ~10-15% of months; Daily has none on 53% of days and
  6+ (market-wide) on 5% (e.g. 22 Oct, 11 sectors).
- Day also shows the radar's own hot sectors (signal fires, volume spikes,
  sector_radar.json); Week and Month have no signals, so moves only. Moves stay
  OUT of sector_radar.json's rate, which feeds instrument_flavours.json (card
  glow, verdict bar): that layer is unchanged.
- Closed bars only: a Daily bar dated today (UTC) is dropped, and Daily
  weekend bars count only for coins (Forex/gold/futures carry a Sunday stub,
  USDZAR a Saturday one). Weekly/Monthly keep every bar: months are labelled
  by their 1st (1 Aug 2026 is a Saturday), which the first cut wrongly dropped.
- Stateless: each run recomputes from the bundles (Daily ~5 years, W/M
  decades), so nothing is stored and nothing needs a backfill.
- activity/D.json from build_chart_feed (hourly); activity/W.json and
  activity/M.json from tools/publish_htf.py with their charts (Mondays, the
  3rd-5th). Each job uploads only its own (publish.upload_to_r2's list).
- Live readings at build: Week of 19 Oct Currency (6 big moves) and Industrials
  (14, mostly down); September Crypto (5, up) and Currency (6, mostly down);
  Day 27 Oct no move-active sector, five radar-hot ones.
Tests: htf_feed_test.py ActivityFeedTests (weekend stub, today's bar, own
yardstick, active + market-wide, small sector, weekend month starts, W/M file),
app_smoke.cjs (rows per timeframe, tap opens the sector on Weekly).

2026-10-28 CHART RANGE MOVED TO THE GRID MENU: app.js v536. User: "move these
buttons to the time grid window and put below time grid". The Chart range
buttons left the Charts Sort menu (#reelRangeOpts removed from index.html)
and are now a row in the chart's Grid menu directly under Time grid, laid out
like it (reelRangeSwitch, REEL_RANGE_STEPS): Full · 260 · 130 · 65 bars,
"Remembered · <TF> only". Same behaviour as v535: per timeframe, remembered.
The Sort pill no longer shows "N bars"; instead the Grid button is lit while
a range is set on the timeframe (gridBtnOn), so a zoom keeps a visible cause.
The menu is reachable from full screen too, which repaints on a change.
Test: app_smoke.cjs drives the range through the Grid menu.

2026-10-28 CHART RANGE PER TIMEFRAME: app.js v534. User, after the v533 fix:
"Keep it but the tab must apply only in monthly if i tab it or weekly if i do
weekly and so forth". `reel.range` (one number for every timeframe) is now
`reel.ranges` (timeframe → bars), read through reelRange(). A range tapped on
one chart timeframe replaces that timeframe's opening frame only; the others
keep theirs, and coming back to it finds the range still set. The Chart range
buttons show the current timeframe's choice and the heading names it ("4H
only", reelSyncPills). Reset clears every timeframe's. Checked on live data:
Quarter on 4H gave 130 bars on SOLUSDT and AAPL 4H, with 1H, Daily, Weekly and
Monthly on their frames.
REMEMBERED (v535, same PR, user: "it must always remember where it was last
saved"): the per-timeframe ranges are kept in localStorage
(`swingpulse-reel-ranges`, {timeframe: bars}) and restored on load, which
reverses v533's visit-only rule for the per-timeframe choice. The old single
`swingpulse-reel-range` is still dropped, not carried over, and only values
the buttons offer on known timeframes are restored. Live check: a stored 4H
130 reopened SOLUSDT 4H on 130 bars and every other timeframe on its frame.
Tests: app_smoke.cjs (Close up on Monthly leaves Weekly; reload restores it on
Monthly only), stock_view_test.cjs.

2026-10-27 CHART RANGE NO LONGER SAVED: app.js v533. User: "The zoom frames
for all instruments for the 1 hour, 4 hour, the daily, weekly, and the
monthly have been messed up ... Now there's a zoom". The Sort menu's Chart
range (Half 260 / Quarter 130 / Close up 65 bars) was kept in localStorage
(`swingpulse-reel-range`), and any set range switches off the opening frame
(reelStockView) on every timeframe, so one tap zoomed every chart in on its
last N bars, with no blank future, on every later visit. It sits just under
the "Move over" row added earlier the same day. Measured against live data
with the range at 130: AAPL 1H showed 1-27 Oct (frame 1 Sep-1 Nov), Daily
Apr-Oct 2026 (2025-2028), Monthly from 2015 (all). The range now lasts for
the visit only, and a stored one is removed on load. The frames themselves
were already correct on a clean device (1H, 4H, D, W, M, card and full
screen). Not confirmed on the user's phone: a per-chart saved view also wins
over a frame. Test: app_smoke.cjs.

2026-10-27 LADDER LINES AND CHANNEL MIDLINE THICKER: style.css v382. User:
"Nothing changed" after the 90% black. Measured at iPhone scale (DPR 3, 390px
card): `.reel-ladder` at 1.6 units drew 0.59 CSS px and `.reel-ch-mid` at 1.7
drew 0.63 px — too thin to show black, so every colour/opacity change looked the
same grey. Both now 2.6 units (0.95 px), the calendar line's weight
(`.reel-tgrid`), with its 3/8 dots on the ladder and 2.6/8 on the midline;
still black at 90%. The user-picked midline weights (is-w2 3.2, is-w3 5) are
unchanged.

2026-10-27 LADDER LINES AND CHANNEL MIDLINE BLACK AT 90%: style.css v381. User:
the 50% lines were "still grey", then "ladder and middle of channel", "not
solid, still dotted, but make them black ... 90%". `.reel-ladder` (ladder
10%-90% lines and channel divisions) 50% -> 90%; `.reel-ch-mid` was the
drawing's colour at .6 (.85 when selected) and is now #000 at .9 either way.
Width and dots unchanged on both.

2026-10-27 LADDER % LINES BLACK: style.css v380. User: "The percentage lines
are grey make black", then "make it 50". The ladder's in-between lines
(10%-90%) and a channel's ten divisions (`.reel-ladder`, which `.reel-ch-div`
shares) were the drawing's colour at .7 opacity, which read grey on the white
plot. Now #000 at 50% opacity, same width and dots, selected or not (a selected
drawing used to lift them to full). The 0%/100% lines (`.reel-ladder-key`) keep the
drawing's own colour; the labels were already black.

2026-10-27 SORT BY % MOVE (GAINERS / LOSERS, 1D-1Y): app.js v531 + style.css
v378. User: "an option to sort by price percentage movement", then "Yes do
that" to the proposal. Charts: Sort's "Biggest move" (size of the 1D move, up
and down mixed) is replaced by Top gainers and Top losers, with a "Move over"
row (1D / 1W / 1M / 1Y, `reel.movePeriod`) read from pct_1d/1w/1m/1y. Sorted
over 1W-1Y the card's % shows that period, labelled ("+22.55% 1W"), so the
order matches a number on screen. Watchlist: Top gainers / Top losers gain the
same period row (shown once one is picked, `wlUi.move`, cleared by Clear); 1D
stays today's live quote change, as each row shows, and longer periods add a
"1M −47.58%" line under it. One comparator (sortByMove) serves both; a market
with no figure for the period sorts last either way (the old Watchlist one
returned 1 for two blanks, an inconsistent comparator). Checked in a browser
against live data: top six 1W gainers on Charts (ZS, S, LMT, OKTA, RAND, ROP)
and 1M losers on Watchlist (CEREBRAS, ZILUSDT, MARA, RIOT, CLSK, ONEUSDT)
match signals.json exactly.
LIVE (same PR, user: "Can the live be add as well?"): every period is now
measured to the latest price, not the last closed bar. quotes.json gains `r`
per market (chart_feed._quote_one): the daily close 5, 21 and 252 sessions
before the price's session, so price / ref - 1 is the pipeline's 5/21/252-bar
return ending now; on a closed daily price it equals pct_1w/1m/1y exactly
(htf_feed_test QuoteRefTests). The app's liveMovePct uses it on both tabs (1D
is the quote's change on its previous close, as before) and falls back to the
closed-bar figure when a market has no quote or reference, including until the
first data run after deploy writes `r`. The Watchlist row's period line is
repainted with each live price. Checked in a browser with injected references:
order and figures follow `r` on both tabs. For the five futures-fed indices
and gold, whose live price is basis-shifted to the cash level, the reference is
the cash daily close, so their longer moves carry that small basis error.

2026-10-27 ALERT TAPS OPEN THE NORMAL CHART: app.js v530 + style.css v377.
User: the Alerts tab "bring[s] up charts with an orange vertical line. Remove
it and bring up the actual chart with divisions because these are plain".
openChartAt (alert rows and the ?chart= deep link) used to centre the window on
the alert time and draw an amber line with a SAST label there. For a recent
alert that pushed the window into blank future past the opening frame, where
the time grid draws nothing: measured on AUDNZD 4H, 0 division lines from the
alert against 3 (Q4) opened normally. Now it clears the instrument's pan, price
lock and time zoom and opens the chart exactly as the Charts tab does, so the
divisions, shading and drawings are those of the normal view (4H, 1H and Daily
checked identical). `at` still picks the timeframe: Daily when the intraday
chart does not reach back that far. The amber line, `reel.focusAt` and
`.reel-focus-lbl` are gone. An older alert can sit left of the opening view;
scroll back to it.

2026-10-26 2H CHART REMOVED AGAIN: chart_feed.py + app.js v529. User: "Remove
2 h", the day after it came back. Gone: the 2H button, its TIMEFRAMES row, its
opening frame (REEL_FRAME_VIEW['2H']) and its test, and build_2h from
build_chart_feed's loop, so chart/2H chunks stop updating (the old ones stay on
R2, unreferenced). Kept: build_2h/_frame_2h for research, the grid/overlay
table entries (as after the 10-03 removal), and the hours-a-day session test
(reelSessionOnly), which 4H uses. A saved 2H chart choice opens on Daily
(isTf check in the timeframe restore).

2026-10-25 2H CHART BACK: chart_feed.py + app.js v528. User: "Just 2h" (8H was
declined: on session-only markets it is one daily bar, or 8h plus a 30-min
stub on European hours). Chart only, as it was 2026-10-01 to 10-03: no
signals, markers, alerts or trend read; header and filters read the Daily
row, as on Weekly/Monthly. Data: build_2h is back in build_chart_feed's loop
(chart/2H/<chunk>.json) and now carries the forming candle like 1H/4H
(_attach_forming, hours=2). App: a 2H button between 1H and 4H, TIMEFRAMES
row with chartOnly. Opening frame REEL_FRAME_VIEW['2H']: previous + current
TWO-MONTH block (Jul-Aug, Sep-Oct to the 1 Nov line on 25 Oct), priced
'centre' like 1H; session-only feeds take FOUR-MONTH blocks (May-Aug,
Sep-Dec). The session test is now hours of bars a day (reelSessionOnly,
REEL_SESSION_HOURS 16) so it works on 2H and 4H alike: 24h feeds give 20-24h,
sessions 6.5-10h. Grids: 2H keeps the market's choice (default Month). Tests:
stock_view_test.cjs, time_grid_test.cjs.

2026-10-25 BITCOIN MINERS KEEP "Bitcoin Mining": Instruments.txt. User: "Keep
Bitcoin Mining as the label for the bitcoin miners" (Yahoo files them as
"Capital Markets"). MARA, RIOT, CLSK, HUT, WULF and IREN are "Bitcoin Mining"
again (IREN's old "Bitcoin Mining / AI HPC" is not restored), and
tools/yahoo_industries.py OWN_LABELS keeps them so on every future Yahoo run.
They are back in the Miners chip ('mining'): 19 stocks.

2026-10-25 STOCK INDUSTRIES FROM YAHOO: Instruments.txt + app.js v527. User:
"Do it", on cleaning the industry labels behind the Sector › Industry filter.
tools/yahoo_industries.py, run by hand in Actions (yahoo-industries.yml, run
40170454966 — Yahoo is unreachable from the Claude sandbox), replaced the
industry of 462 stock rows with Yahoo's own label. Only that column of stock
rows changed: every sector, group, name, ticker and non-stock row, and the
column widths, are as they were. Stock industries 243 → 109; single-stock
industries 149 → 25 (e.g. "Data Center REIT"/"Data Centre REIT" are one now).
A stock Yahoo gave no industry keeps its old label. Yahoo's own calls stand,
including the bitcoin miners (MARA/RIOT/CLSK/HUT/IREN/WULF) as "Capital
Markets". The Miners chip (CATEGORY_ALIASES) matched "... Mining"; Yahoo
names the metal ("Gold", "Copper"), so it now also matches gold, copper,
silver and uranium: 13 metal miners, all the old ones plus WPM. Other chips
moved by a stock or two (Semis gains CRDO/RMBS/SITM, loses MKSI to
"Scientific & Technical Instruments").

2026-10-25 SECTOR / INDUSTRY FILTER: app.js v526 / style.css v376. User: "If
I ... wanted to filter by sector and industry, I wouldn't be able to do that,
would I?", then "yes build it". The only sector dropdown lived on the Scanner
tab, hidden with it on 2026-09-27 and never carried over; search still matched
sector and industry text. Watchlist and Charts each get a Sector dropdown
(#wl2DdSector / #reelDdSector, sectorMenuHtml): the stock sectors with
counts (Crypto/Index/Commodities/Currency are the Class menu's), then, once a
sector is picked, that sector's industries. Exact matches (sectorMatches);
picking a sector clears the industry; Reset and Market taps clear both.
Watchlist choices persist with the other wlUi filters; Charts' do not, like
its other filters. Measured on the live data: Technology 168 Watchlist rows,
Semiconductors 24; Healthcare 54 charts. NB the industry labels are
inconsistent — 259 stock industries, 169 holding one stock, near-duplicates
such as "Data Center REIT" / "Data Centre REIT". Test: stock_view_test.cjs.

2026-10-24 4H GRID SCALES WITH THE SESSION FRAME: app.js v525 /
grid-geometry.js v6. User, after the session half-year frame: "And the time
grids for these how can we fix", then took the recommendation. Grid choices
are per market, but on 4H the indices (20 session-only, 14 round the clock),
crypto (9 crypto stocks, 55 coins) and commodities (4 softs, 14 others) mix
both frames, so one choice could not suit a quarter frame and a half-year
frame at once. A session-only 4H chart (reelBarsPerDay < 4) now draws the
next size up from its market's choice (REEL_SESSION_GRID in reelTimeGrid):
Q → H, H → Y, M → M2 (two-month blocks, named by their first month in
gridGeometry.partLabel); Y and T stay. 24h charts, 1H and Daily keep the
choice as set. Test: time_grid_test.cjs.

2026-10-24 4H HALF-YEAR ON SESSION-ONLY CHARTS: app.js v524. User: EU
indices and SOX on 4H "are smaller and doesn't fit well on the 2 qs", then
"do option 1". Their 4H feed is the exchange session only — measured on the
live bundles: 2.99 bars a day on DAX/FRA40/IT40/NETH25/SPAIN35/EU50/UK100/SW20,
1.98 on SOX and US stocks, against 5.07 on the futures-fed US100/US500/NI225,
5.08 on PLATINUM and 5.99 on crypto. Two quarters therefore held ~380 and ~250
candles against US100's ~780. A 4H chart with fewer than
REEL_SESSION_BARS_PER_DAY (4) bars per calendar day (reelBarsPerDay) now opens
on the previous + current HALF-YEAR (`sessionUnit`: 1 Jan to 1 Jan on 24 Oct),
~760 slots on the EU indices and ~500 on SOX; 24h feeds keep the two quarters.
Decided from the bundle, not a market list, so stocks follow too. Test:
stock_view_test.cjs.

2026-10-24 OPAQUE iOS STATUS BAR: index.html only. User, after updating iOS:
the header (main screen) and the full-screen chart's title row looked blurred
and dimmed under the clock. Nothing in the app blurs its own header; the
status-bar style was `black-translucent`, which draws the page under the
clock, and iOS lays its own blur band over that area. Now `black`: iOS draws
a solid black strip and the page starts below it (safe-area-inset-top goes
to 0, which the existing env() paddings already handle). Trade-off: the
white full-screen chart has a black strip above it. Untestable off-device.

2026-10-22 DAILY YEAR FRAME ON EVERY MARKET: app.js v523. User, off
CHINAH/CHINA50/CHINA_NET/SA40 Daily: "This is how we do daily". Every Daily
chart opens on last year's line to two year lines ahead (2025 to 2028 on 22
Oct), priced 'all' (candles, overlay MAs and drawings, each held to 2.5
bar-ranges). Was: stocks the 2025-2029 term with 0 at the bottom ('zero'),
indices the 2025-2029 term ('all'), crypto 2025-2028 with 0 forced on
('allzero'), forex/commodities 2025-2028 ('all'), rates no frame. 1H, 4H and
Daily now live in one table, REEL_FRAME_VIEW; reelOpenSpec no longer looks at
the market. 'zero', 'allzero' and REEL_ZERO_FIT_FOOT are gone. A saved view
still wins. Tests: stock_view_test.cjs, chart_framing_checks.cjs.

2026-10-22 1H PRICE SCALE CENTRED: app.js v522. User, off TXN/ANET/AMKR 1H
against their saved GOLD: "Look at the 1 h again and fix. Yours not right" —
the price scale. 1H's 'all' fit (v521) pulled W500/M50/D500 and drawings
into view, squashing the candles to ~1/4 of the height and pinning them to an
edge (TXN at the top). 1H now opens 'centre': the last close in the middle,
the bars' furthest edge at REEL_CENTRE_PRICE_FILL (0.6) of the way out, so
the candles take about a third of the height (GOLD 36%, ETHUSD 36% in the
user's saved views). Overlay MAs and drawings take no part in it and are not
named as off-screen. The month window and 4H ('all') are unchanged. Tests:
stock_view_test.cjs, chart_framing_checks.cjs.

2026-10-22 1H MONTH FRAME ON EVERY MARKET: app.js v521. User, off ETHUSD 1H:
"do the same to all 1h charts like this" (after the 4H quarter frame). Every
1H chart opens on the previous + current MONTH (REEL_INTRADAY_VIEW, which
now holds 1H and 4H): the previous month, the current one running into blank
future up to the next month line (1 Sep to 1 Nov on 22 Oct), price 'all'.
Replaced: stock 1H previous + current quarter ('ov' fit), index 1H ~3 weeks
before the quarter line (`lead`), crypto/forex/commodity 1H 30 days back /
35 ahead ('upper'). The `back`/`ahead`/`lead` frame options and the 'upper'
fit (REEL_UPPER_FILL/HEAD) went with them. A saved view still wins. Tests:
stock_view_test.cjs, chart_framing_checks.cjs.

2026-10-22 4H QUARTER FRAME ON EVERY MARKET: app.js v520. User, off
PLATINUM/ETHUSD/LINKUSD/USDX/US100/IT40/NETH25/FRA40/SPAIN35: "for the 4h
time frame for all instruments let the frame look like this". Every 4H chart
now opens on the previous + current QUARTER (REEL_4H_VIEW, checked first in
reelOpenSpec): the shaded previous quarter, the current one running into
blank future up to the next quarter line (1 Jul to 1 Jan on 22 Oct; 1 Oct to
1 Apr in January), price 'all'. That was already the crypto/forex/commodity
4H frame. Stocks opened on a half-year with bars at half height ('wide',
removed with REEL_WIDE_PRICE_FILL), indices on a half-year, and rates on
five months. A saved view still wins.
Test: stock_view_test.cjs.

2026-10-21 CHANNEL DIVISIONS UNLABELLED: app.js v519. User: "Remove the labels
on the channel". The ten divisions (`div`) draw their dotted lines only; the
0%..100% text from v518 is gone. Ladders keep their labels. Test:
drawing_toolbar_checks.cjs.

2026-10-21 CHANNEL TEN DIVISIONS + LADDER 0%..100%: app.js v518 / style.css
v375 / drawing-toolbar.js v4. User: "Make the channel the same way [as the
percentage lines] with the 10 divisions but have a switch to turn the divisions
on and off. When done fix the horizontal percentage lines to also have 10
divisions and not 9". Channel: a `÷10` switch in its props row stores `div:
true`; on, the band between the edges is cut into ten by dotted lines in the
ladder's style (`.reel-ladder.reel-ch-div`), labelled 0% (bottom edge) to 100%
(top), the 50% line being the existing midline. Off stores no field and is the
default, so seeded and saved channels are unchanged; divisions on are alert
levels like a ladder's lines. Ladder: eleven lines, 0%..100% (was ten,
10%..100%). It starts FROM 0 (user: "make sure they start from 0 and not
10%"): p1, the first line, is now 0% and p4 the 30% line, so a saved ladder's
first line reads 0% where it read 10%, every label drops by 10 and a 100% line
is added on top (reversed ladders read 0% at the top). A new ladder puts 0% on the lowest
low and 100% on the highest high; stacks are ten steps each
(`ladderKRange`/`ladderPct`). Tests: drawing_toolbar_checks.cjs,
stock_view_test.cjs.

2026-10-21 PR VALIDATION BEFORE MERGE: deploy-app.yml now also runs on pull
requests. User: "I like the idea of testing before merging". Golden on a PR
missed failures the deploy run's engine and mobile browser steps catch (e.g.
10-17 18:31 browser, 10-19 #34 engine): they surfaced only after merge, with
main broken. PR runs stop before every refs/heads/main step, skip the Pages
preview (no secrets) and use a per-PR lock, so they never queue behind or
block a data publish. Live-only failures (10-17 #14/#16 "Verify the live
app") are not caught by this; they need their own look.

2026-10-21 OTHER MARKETS SPLIT BY MARKET: app.js v517 / chart-preferences.js
v4 + sync Worker. User: "Why does the swap for oil affect crypto? Oil should
stand alone" and "Fx, crypto, commodities, stocks and brent as energy".
'other' held Brent, crypto, currencies and metals under one time grid and one
swap. It is now energy (WTI, BRENT, NGAS, HEATINGOIL, GASOLINE), commodities,
crypto and currency (`reelGridScope`), each with its own grid (`energyGrids`,
`commodityGrids`, `cryptoGrids`, `currencyGrids`) and swap (`flipBy[scope]`).
They read the 'other' choice until set (`chartPreferences.fromOther`), so
nothing moved. Stocks and indices are unchanged; rates stay in 'other'.
Release the sync Worker with this UI.

2026-10-20 CHANNEL LINE WEIGHT: app.js v514 / style.css v372 / drawing-toolbar.js
v3. User: "an option to make the channels thin, thick and thicker … channel
only", not the time grids. A channel's props row has a three-button weight
group beside Dotted/Dashed (`data-act="draw-weight"`, v 1/2/3). Thin is the
old weight and stores no field; thick/thicker store `weight: 2|3`, rendered as
`.is-w2`/`.is-w3` on the edges and midline (dots and dashes both scale, and the
selected weight stays heavier). Linked copies carry it like any other field.
Test: drawing_toolbar_checks.cjs. Also: chart_framing_checks.cjs retries the
grip bounding boxes — the grips are rebuilt on every repaint and a read right
after a drag could land on the swap (the null-box race that failed deploys).

2026-10-20 OVERLAY COLOURS: app.js v513 / style.css v371. User: the Daily MA
overlay and the chart's own three MAs were "hard to distinguish" — both took
black rising / red falling, and only dash vs dot told them apart on a phone.
Now the Daily overlay is one colour, BLUE (`--reel-ov-d` #2563eb), and Weekly
one colour, ORANGE (`--reel-ov-w` #ea580c), whichever way they slope, their
projections too (`OV_COLOUR` → ribbonSvg/projSvg `colour`). Dashes unchanged
(the user declined solid). Monthly and the chart's own lines keep black/red by
slope. Labels stay black.

2026-10-19 DRAWINGS: CHOOSE THE TIMEFRAMES (user: "choose where my drawing
tools show on which time frames"). app.js v512 / drawing-toolbar.js v2 /
style.css v370. The selected drawing's More panel has a "Show on" row, one
switch per chart timeframe (1H 4H D W M). Default: its own chart only — an
ordinary unlinked drawing, as before. Any other set makes it a LINKED drawing
(the 2026-09-26 `link` copies, kept in step by channelLinkSync) with `tfs`
naming where it is drawn; switching back to its own chart alone unlinks it and
removes the copies. At least one timeframe stays on. drawShownOn(d, tf) is the
one rule: unlinked → its chart; linked with `tfs` → those; an old link without
`tfs` → everywhere but Daily (unchanged). Hidden copies are kept, not drawn,
left out of the price fit and of line alerts. tests/drawing_toolbar_checks.cjs.

2026-10-19 CRYPTO PRICES FROM THE EXCHANGES (user: prices should match
TradingView; "indices, crypto for now"). Every crypto download — Daily, 1H,
5m and the whole-history Weekly/Monthly pull — comes from the exchange the
user's TradingView chart reads: Binance (52 USDT pairs) and Coinbase (BTC,
ETH, LINK), not Yahoo. exchange_feed.py; hooked in at
data_fetcher._full_download, so engine, caches and charts are unchanged.
- The pair comes from tv_symbols.TV_BY_NAME (moved out of webapp/server.py
  so the data layer can read it): MATIC reads BINANCE:POLUSDT, FTM
  BINANCE:SUSDT. tests/exchange_feed_test.py pins every crypto instrument to
  its TradingView pair.
- Binance through data-api.binance.vision: api.binance.com answers HTTP 451
  to the US GitHub runners (probed 2026-10-19). Volume is QUOTE volume
  (USDT/USD), like Yahoo's crypto volume.
- `<cache>.source` names the feed that wrote a cache; when it differs from
  the ticker's current feed the next fetch REPLACES the cache instead of
  appending (no Yahoo/exchange splice). Yahoo caches carry no file.
- Live quotes: quotes.json `y` is 'BINANCE:XRPUSDT' / 'COINBASE:BTCUSD' for
  crypto; the cron Worker's /live routes those to the exchange (one Binance
  request for all pairs) and the rest to Yahoo. tests/live_worker_test.mjs.
- tools/check_exchange_feed.py (deploy validation, live network) fails the
  release if any pair stops answering at 1d/1h/5m.
- INDICES next: OANDA (user's choice) once OANDA_API_TOKEN / OANDA_ACCOUNT_ID
  are repository secrets; TradingView index symbols then repoint to OANDA:.

2026-10-19 Weekly and Monthly charts back: app.js v510 (freshness v5,
trend-context v2, grid-geometry v3). User: "add back weekly and monthly chart
but weekly run every Monday and monthly between 3-5" (the 3rd-5th), then "go
back further ... these need not run with the daily and hourly runs" and "we
will need the monthly overlay on weekly". CHARTS ONLY — `chartOnly` rows W/M in
app.js `TIMEFRAMES`, buttons #tfBtnW/#tfBtnM; no signals, markers, alerts or
`w_`/`m_` columns; `config.TIMEFRAMES` untouched.
- OWN JOB, not the hourly publish: .github/workflows/publish-htf.yml (GitHub
  cron 00:35 UTC — Mondays for W, the 3rd-5th for M; workflow_dispatch for
  either) runs tools/publish_htf.py. It downloads each instrument's WHOLE Yahoo
  daily history (period='max', fresh every run so adjustments are current),
  falling back to the read-only-restored Daily cache, builds
  chart_feed.weekly_bundle / monthly_bundle and uploads chart/<W|M>/<cid>.json
  plus chart/<W|M>/index.json (its own name -> chunk map, no-cache). The hourly
  build_chart_feed never builds W/M and chart/index.json says nothing about
  them. Its own concurrency group: in swingpulse-publish a waiting run is
  dropped when an hourly one queues behind it. Refuses to publish below 60% (W)
  / 50% (M) coverage. Every chunk id is written, empty ones too, so the stale
  pre-removal W/M chunks on R2 are never served.
- Bundles: closed periods only (main._resample_weekly/_monthly), stamped on
  the period START (Monday / the 1st) because the app places bars, year lines
  and overlays by start time; scaled like Daily. W carries 1300 bars (~25y), M
  1200 (all). Weekly carries its own Monthly overlay MAs (`mo`, _htf_mas over
  the whole history); app.js ovOwnHtf/OV_OWN_HTF draw them from the Weekly
  bundle and ovOtherTf only loads the Daily chunk for Daily lines.
- App reads W/M only through their own index (reelLoadTfIndex/reel.tfIndex),
  never the shared map. Opening views (REEL_SLOW_VIEW, every market): Weekly
  four terms 2013-2029, Monthly all history to 2029, price 'all'. Grid:
  Weekly and Monthly are DIVIDED BY ADMINISTRATION TERM, every line equal
  and light — no year lines, no bold lines (user: "the divisions of the
  weekly and the monthly are divided by administration and not by year. All
  must be equal"). This is the grid division 'T' (chart-preferences choices,
  one part per four-year term from 2025; default for W and M; offered on
  D/W/M only; the sync worker accepts it). Daily keeps its year grid with
  bold term lines. chart-preferences v3, grid-geometry v5, app.js v511.
  Labels are now
  thinned by their width (LABEL_MIN_GAP still the minimum). Header context on
  W/M is the Daily main trend only.
- Tests: tests/htf_feed_test.py, plus W/M cases in time_grid, stock_view,
  freshness, trend_context, browser_fixture and app_smoke.

2026-10-18 filter dropdowns: app.js v509 / style.css v369. Watchlist and
Charts filters (user: "app friendly and beautiful, not clutter", then "neat
drop down designs that fit" after a bottom-sheet try felt clumsy) are ONE
row of small dropdown buttons (.fdrop-btn) under the search field. A set
button turns gold and shows its value in place of its name ("▲ Up", "+1" for
a second choice); × resets. Menus (.fdrop-menu) live at body level
(#wl2Menus / #reelMenus) so the scrolling row cannot clip them; app.js
places each under its button (fdropPlace). data-fdrop-autoclose menus close
on a pick. Charts option ids and handlers are unchanged (#reelScopeOpts
etc.), grouped as Show / Class / Trend (main + 4H) / MA (order, clusters,
near MA) / Sort (sort + range); #reelReset is the × and #reelCatChips gained
an "All classes" row. Watchlist: lists are tabs; Class, Trend, Clusters and
Sort are dropdowns (data-wl-cls/-trend/-relation/-sort; the old Sort select
is gone) and × resets them all. buildReel now syncs the buttons on an empty
result too.

2026-10-18 index 4H/Daily + forex/commodity views: app.js v508. Index 4H =
stock 4H half-year frame, index Daily = stock Daily 2025-2029 term, both price
'all' (off the user's US100/RUSSELL/NETH25/IT40). Forex and commodities
(assetClassOf Currency/Commodity, REEL_FXCOM_VIEW) were left to us: they take
the crypto frames (1H 30d/35d 'upper', 4H quarter 'all', Daily 2025-2028)
but Daily is 'all', not 'allzero' — a 0 line would flatten a currency. Rates
and anything else still open the old way.

2026-10-18 index 1H view: app.js v507. Indices (reelGridScope 'indices') on
1H open from ~3 weeks before the current quarter line to the next quarter
line (REEL_INDEX_VIEW lead 0.23 of a quarter; 10 Sep to 1 Jan on 18 Oct),
anchored to the lines. Price 'all' (candles + overlay MAs + drawings), as
crypto 4H/Daily. Off the user's US100/RUSSELL/BCHAIN_NFT/CHINA_NET/EV_INDX/
FAANGS_10 screenshots.

2026-10-17 saved-view fix: app.js v506. reelMaxBars(bundle, name) allows at
least the opening view's slots (its blank future): a stock 1H quarter frame
(~896 slots) is wider than the ~880 bars carried, and capping zoom and saved
views at the bar count shrank every restored 1H view. The browser framing
check now drags price AND time before Save and asserts both restore.

2026-10-17 crypto 4H/Daily views: app.js v505. Crypto 4H opens on the
previous + current quarter (as stock 1H); crypto Daily on last year's line to
two year lines ahead (2025-2028, REEL_CRYPTO_VIEW years [1, 2]). Price 'all'
(user's choice, off BTC/AVAX/BCH/BNB 4H and ETH/BNB/BTC Daily): candles +
switched-on overlay MAs + the chart's drawings across the window
(reelDrawingRange: channel/trend ends and edges, ladder stack, levels), each
side held to 2.5 bar-ranges beyond the candles, 5% margin; Daily ('allzero')
always includes 0.

2026-10-17 crypto 1H view: app.js v504. Crypto (assetClassOf 'Crypto') on
1H opens on the last 30 days of candles plus 35 days of blank future
(REEL_CRYPTO_VIEW, via reelOpenSpec/reelStockView). Price 'upper': candles and
switched-on overlay MAs fill the upper 45% with 8% headroom, the lower half
left empty; an MA counts only up to one bar-range beyond the candles. Measured
off the user's DOT/DOGE/DASH screenshots.

2026-10-17 stock 4H/Daily views: app.js v503. reelQuarterView became
reelStockView (REEL_STOCK_VIEW table). Stocks open on: 1H previous + current
quarter (overlay-MA fit, capped); 4H previous + current half-year, centred on
the close with bars at ~half the height (REEL_WIDE_PRICE_FILL 0.55, off the
user's RAND/PHIA/NN_NL screenshots); Daily the current four-year term
(2025-2029 admin lines), price from just below 0 to twice the highest high
(user's choice, off BE/WKL). Test: tests/stock_view_test.cjs (was
quarter_view_test.cjs).

2026-10-17 price-fit cap: app.js v502. The 1H stock opening fit to overlay
MAs may grow the price frame to at most REEL_OV_FIT_CAP (2) times what the
bars need, so candles keep at least half their height; a line left outside is
named at the plot edge ("M50 62 ↓ off-screen", reelChartSvg).

2026-10-17 1H stock quarter view: app.js v501 / grid-geometry.js v2. A 1H
STOCK chart (reelGridScope 'stocks') opens on the previous quarter's start to
the NEXT quarter line, the current quarter running into blank future
(reelQuarterView; the blank is a default pan in reelPanOf, so zoom/pan work
from it). Quarters come from gridGeometry.yearFrame, the same frame as the
permanent Q lines, so the frame lands on them and moves each quarter. Opening
price fit also includes the switched-on D/W/M overlay MAs in view
(reelOverlayRange) until the reader zooms or pans. A Range pill or saved view
overrides it. Test: tests/quarter_view_test.cjs (now stock_view_test.cjs).

2026-10-17 app review fixes: app.js v500 / freshness.js v4 / sw.js + sync
Worker. Push: turning notifications off removes only that device's
subscription (DELETE ?endpoint=); the app re-sends its subscription on every
start, renewing the Worker's 90-day TTL; subscribe validates JSON and only
accepts browser push-service HTTPS endpoints. Two macro events on one day get
separate notification tags. Auth: an account is claimed only at POST
/sync/auth and only while it holds no saved work; each wrong password writes
its own `fail:<user>:<id>` key (the old single counter lost parallel
guesses), with a `fail:<user>` flag so a correct request costs one read, not
a KV list. Forex open/closed follows New York time (Sun-Fri 17:00), not fixed
22:00 UTC. A forming 1H/4H candle whose hourly feed has gone quiet closes with
its last hourly bar (`chart_feed._attach_forming`), so a finished session no
longer reads "Still forming". Release the sync Worker with this UI.

2026-10-17 grid swap per market: app.js v499. "Swap shaded gaps" is kept per
market group (stocks / indices / other) on each timeframe, matching the time
grid it shades (`tfOverlay.shade[tf].flipBy[scope]`, read via `gridFlip`). The
old per-timeframe `flip` is what every market inherits until swapped. Shading
on/off, strength and colour stay per timeframe. Device-local, like overlays.

2026-10-17 sync fix: app.js v498 + sync Worker. Notes now sync note by note
on per-note timestamps (`notesMod`, deletion = stamp without text), merged on
every pull and before every push, like drawings. Before, the newest WHOLE
notes map won, so a device that had not pulled wiped another device's edit.
Unstamped notes from older data or a cached older app keep the old rule only
for themselves. Note edits set the unsent-work marker and are resent on start
and on reconnect (`online`); the local sync mark moves only on a confirmed save.
Release the sync Worker with this UI.

2026-10-16 prepared market-specific time grids: app.js v497 / style.css v368,
chart-preferences.js v2 / saved-work.js v2. Stocks (Equity), stock indices
(Index excluding Rates), and other markets independently remember M/Q/H/Y for
each timeframe. The chart's instrument selects the group in cards and full screen;
the grid menu names that group. Existing choices are copied once on upgrade.
Preference v2 keeps `grids` for other markets and adds `stockGrids`/`indexGrids`,
with independent timestamps, sync merges and backup restore. Old clients cannot
erase the new groups. Equal grid geometry and permanent reference lines remain.
The percentage price-axis control and formatting are removed; old enabled
settings are ignored. Numeric price labels remain. No market-data rebuild or
additional Yahoo requests are needed; release the sync Worker with the UI.
The grid menu uses a light chart-matching surface, subtle borders/shadow and
neutral readable captions; amber remains the selected-control colour.

2026-10-15 prepared chart cleanup: app.js v496. Automatic buy/sell triangles,
B/S labels and MA-cross annotations are no longer drawn over candles on chart
cards, full-screen charts or exported chart images. Signal data remains available
to Alerts and filters. User-placed drawings and buy/sell marks remain editable.

2026-10-15 prepared compact chart header: app.js v495 / style.css v366.
Full-screen charts use two short rows: ticker/timeframe and essential controls,
then Daily main trend, the selected timeframe's direction and data update age.
The information row opens the full instrument name, MA-cluster levels and exact
bar/quote/publication times over the chart without reducing the plot's height.
Overdue and failed update warnings remain visible when collapsed. Previous-chart
and sharing actions are under More; marking, bookmark, grids and Close stay direct.
Saved framing, drawings, chart data and the hourly update schedule are unchanged.

2026-10-15 prepared UI fix: app.js v494. Unsaved 1H/4H/Daily frames centre
the latest visible close and fit the visible swing, without stretching to
distant moving averages. Full-screen auto-fit uses its own plot; it no longer
multiplies the automatic price range by the card-to-screen height ratio.
For wholly nonnegative history, automatic framing stops at zero if centring
a large decline would otherwise add empty negative-price space (ETH Daily).
Saved and manually adjusted frames retain their chosen price-per-pixel and
position. Time windows, drawings, overlays, equal grids and signals are unchanged.

2026-10-11 prepared release (not yet published): app.js v493 / style.css v365.
The shared workflow is Daily main trend, 4H swing/setup, and linked 1H entry
context. Main trend uses the completed Daily close against Daily MA500 on
every tab; it does not follow the selected chart timeframe or MA order.
`workflow_signals.py` defines `daily500-4h-v1`: Daily and 4H B1/S1 crossings
plus compatible native pullbacks. Daily trend changes rank first. A confirmed
4H D50 crossing can identify a minor swing before the native 4H MA500 crosses;
an opposing Daily direction never automatically suppresses that setup.

`webapp/setup_context.py` supplies causal completed D50/250/500, W50/250/500,
and M50 references, distances and closed 4H/1H crossings or rejections.
Weekly and Monthly periods have equal standing as setup levels. A cluster
can consist of Weekly/Monthly levels without Daily. Cluster width is adjustable
at 0.25, 0.5 or 1 Daily ATR (14); the whole zone must fit that width. Missing
history is unavailable, never replaced with a shorter average. Display-only
forming/projection values cannot confirm a signal. Grids and drawn lines stay
available as context; no new automatic timing/line priority weights are implied.

`webapp/trend_context_feed.py` and `trend-context.js` share the context across
Watchlist, Charts, Alerts and Market. Prefer the latest full-precision Daily
chart context over an older row summary. Signal ledger IDs and statistics carry
the new rule version; legacy outcomes are excluded from new-rule performance.
`backtest.py` defaults to the production Daily/4H workflow and writes its own
confidence map. Run the workflow replay/tests when changing these rules.

Every full `publish.build_data()` now runs `tools/validate_workflow_release.py`
before upload. It requires new-version signal rows, matching completed context,
4H reference coverage and versioned ledger statistics. The app-release workflow
must rebuild/validate data before publishing the v493 screens. Hourly Yahoo
fetches, forming-candle display, drawing/grid persistence and data-update/calendar
push notifications remain as before; individual trade push alerts are not added.

2026-10-10 release: app.js v492 / style.css v364 / freshness.js v3.
1H and 4H bundles carry a separate `forming` OHLC/MA snapshot from the existing
hourly cache. The renderer appends it only for display and labels it Still forming
(Awaiting final update after its close time). Completed arrays remain unchanged
for signals, alerts and channel trends. No extra scheduled Yahoo fetches.
The user approved the working LINKUSD preview for deployment. Golden engine,
forming/closed-bar separation, refresh, local-time and equal-grid checks passed.

2026-10-10 UI update: app.js v491 / style.css v363 / freshness.js v2. Intraday
chart freshness and axis labels share the device's local timezone and say local.
Daily bar labels retain their market-session date. Full-screen footer controls
sit 18pt lower on an iPhone with a 34pt bottom inset, returning height to the
chart while retaining clearance above the home indicator. Grid geometry is unchanged.

2026-10-10 UI update: app.js v490 / style.css v362. The main header stays on one
row on phones. The compact publication timestamp opens full freshness details;
failed and overdue states remain visible. Screens with their own timeframe
filters no longer reserve a header row for static captions. Charts retain the
global 1H / 4H / Daily switch. Refresh, calendar, backups and user remain accessible.

2026-10-10 release: app.js v489 / style.css v361.
Quote timestamps, latest completed-bar timestamps (bar start), and successful
dataset publication timestamps are shown separately. Regular-session status is
only inferred for known equity/currency markets, never from an old quote alone.
The Cloudflare schedule runs at :05 every hour, 24/7 including weekends, with a
:35 backup that dispatches only if no run was created in the last 45 minutes.
Dataset warnings use a 90-minute limit at all times; failed updates show immediately.
These rules supersede the historical 32-hour notes below.

Per-user grid choices now use `sp-chart-prefs__<user>`, independently timestamped
per timeframe and merged with authenticated sync. Legacy browser-only choices
migrate with timestamp zero so they cannot overwrite newer work. Drawings batch
for five minutes (previously four hours); Done, Sync now, leaving Charts, or
backgrounding flush sooner. Existing local save and dirty-marker retries remain.
The Worker merges charts independently and retains its previous synced copy.

Saved work offers JSON download, import preview, explicit restore, and five local
recovery copies. Restore first saves the current work and writes local storage
transactionally. Backups exclude authentication credentials. Drawings, notes,
watchlists and grid choices sync; views and overlay settings are backed up but
remain device-local. Items 3 (timeframe feature consistency) and 4 (atomic market
dataset publication) have deliberately not been changed.

Frontend modules live in `webapp/static/js/modules/`: data-client, freshness,
live-prices, chart-preferences, grid-geometry, drawing-icons, drawing-toolbar and
saved-work. They are loaded in order by the template before app.js. Keep static
market-data URL strings in app.js for publish.py's existing rewrite. app.js still
coordinates the app and chart renderer; this is a focused extraction, not a full
rewrite. Sync merging is isolated in `sync-worker/src/saved-work-store.js`.
Tests cover real two-device browser syncing, offline recovery, backup restore,
toolbar interaction, equal grids, freshness rules and authenticated Worker routes.

2026-10-08 UI update: app.js v483 / style.css v357 remove W, keep ordinary
year lines uniform, add permanent equal quarter markers on 30m/1H and equal
four-year administration markers on Daily. The selected grid controls shading;
permanent references remain across M/Q/H/Y choices. UI-only pushes skip market
data regeneration while retaining code/browser and live validation.

2026-10-08 UI release: app.js v482 / style.css v356 add the saved
W/M/Q/H/Y switch inside the Grid menu of every chart and expanded chart. One selection per timeframe
applies across its instruments; 52/12/4/2/1 equal year parts use a uniform
whole-bundle bar spacing, including through year boundaries. Browser storage
key: `swingpulse-grid-divisions`. The same release bounds price/data/chart
requests and refreshes an expanded chart's bundle after a dataset reload.

2026-10-09 UI update: app.js v484 retires 30m across app controls, filters,
alerts and currency focus. Saved 30m selections migrate to 1H. Only 1H and
Daily are offered; historical market data and drawings remain stored.
Quarter references stay permanent on 1H and administration references on Daily.

2026-10-09 UI update: app.js v485 restores 4H as a chart timeframe from
completed hourly-source four-hour bars. Chart feed and channel trends now
include 4H on every regular publish; each timeframe saves its own equal grid.
Initial release publishes validated 4H-only data from the hourly cache before
exposing its controls. Active Charts timeframes: 1H / 4H / Daily.

2026-10-09 UI update: app.js v486 / style.css v358 make 4H yearly references
permanently bold dotted across every M/Q/H/Y grid choice. Year spacing remains
equal. 1H quarter and Daily administration references remain in place.

2026-10-09 UI update: app.js v487 / style.css v359 compact the drawing toolbar.
Choosing a tool collapses it; selected drawing handles remain active. The strip
keeps Undo, Expand and Done; More contains Background and less-used actions.
Browser smoke tests exercise collapse, handle dragging, history and Done.

2026-10-09 UI update: app.js v488 / style.css v360 add Lock/Unlock to the
selected-tool strip and make drawing toolbar buttons monochrome. Lock keeps
the panel collapsed and uses existing per-drawing save and history behavior.
Drawing icons share a 24-unit outline style with distinct SVG Buy/Sell markers.

## Per-version notes (was CLAUDE.md "Current Versions")

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
