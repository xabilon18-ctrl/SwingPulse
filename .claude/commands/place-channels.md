# Place Channels

Put trend channels on the charts using THE USER'S RULE — and nothing else.

## Usage
```
/place-channels                       # every instrument, 30m and Daily
/place-channels MU FRA40              # just these, 30m
/place-channels BTCUSD --tf D         # just this, Daily
/place-channels clear                 # remove all auto channels
```

## The rule (measured from the user's own channels, 2026-10-04 — do NOT add to it)

1. **Trend-side edge = the slowest line on the chart** at the latest bar (MA500, or the
   stretched 1905/2658 on round-the-clock 30m charts), pushed **3% of the channel width
   outward** — breathing space. Downtrend: top edge. Uptrend: bottom edge.
2. **Slope = that slow line's slope** over the last third of the leg. If the slow line is
   flat or still pointing against the price leg, take the slope from the price leg.
3. **Midline = through the deepest counter-trend reach** of the leg (lowest low in a
   downtrend, highest high in an uptrend). Pullbacks stop at the midline; price lives
   between the midline and the slow-line edge.
4. **Far edge = mirror** of the trend-side edge through the midline (empty room).
5. **Leg start** = highest high (down) / lowest low (up) between 0.2x and 0.9x the slow
   line's period back — the same rule on every timeframe.
6. **No channel where price is through the slow line** — by rule 1 the trend is broken.

## Steps to execute

ALWAYS use `tools/place_channels.py`. Never place, nudge or "improve" a channel by hand
or by judgement — the user asked for these rules and nothing else, on every timeframe.
If the rule cannot place one on a chart, say so; do not invent one.

```bash
cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator"
# preview first (writes auto_channels_preview.png in the project root when <= 40 charts)
python3 tools/place_channels.py NAMES --tf 30m
# then put them in the live app
python3 tools/place_channels.py NAMES --tf 30m --apply
# everything: run once per timeframe the app has (30m and D today)
python3 tools/place_channels.py --all --tf 30m --apply
python3 tools/place_channels.py --all --tf D --apply
# remove them all
python3 tools/place_channels.py --clear-auto --tf 30m --apply
python3 tools/place_channels.py --clear-auto --tf D --apply
```

## What the script guarantees
- Reads the SAME bars the app draws (the R2 chart bundles) and maps dates to bars as
  app.js does, so a line lands where the preview shows it.
- Backs up the user's sync data to `research/out/` before every write and reads back after.
- Never touches a chart that carries a channel the USER drew; their markers/lines stay.
- Auto channels are purple with `seed: 1`. A channel the user DRAGS loses `seed`, becomes
  theirs, and is never replaced — read those corrections to refine the rule (with the
  user's OK), never silently.
- Alerts ignores auto channels (app.js v476) so ~1,400 of them don't flood the tab.

## Report
Say how many charts got a channel per timeframe, how many were skipped because price is
through the slow line, and how many had no leg that fits. Name the instruments when the
user asked for specific ones.
