# SwingPulse — Change Notes

History moved verbatim out of `CLAUDE.md` on 2026-10-21, so `CLAUDE.md` holds only
what is true now. Each entry describes the code AT THE TIME it was written:
versions, counts and file locations may have moved since. Check the code
before relying on one. Add new entries at the top of the first section.

## Dated notes (newest first)

2026-10-28 ACTIVE STRIP ON A CARD: style.css v387. User: "put a background that
compliments the tab section on the active watchlist". The ACTIVE line (and its
panel when open) sits on a soft card: the filter buttons' colour
(--bg-elevated), a faint gold wash from the top (--accent-glow) and a gold
left edge (--accent), echoing the selected tab's underline; 12px radius,
--border outline. Spacing tightened (gaps 9/3px) so the line still fits at
390px. CSS only, theme variables throughout.

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
