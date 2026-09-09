# SwingPulse — Signal Rules Reference (for editing)

> Rewritten from code 2026-07-09 — verified against signals.py/indicators.py/main.py.
> Engine: `signals.py` · indicators: `indicators.py` · thresholds: `config.py`
> Backtest/confidence: `backtest.py` → `confidence_map.json`

---

## 1. Trend definitions

**Price-position trend** (`trend_direction`, per bar, per timeframe) — `indicators.py add_trend()`

Decided by how much of the **whole ribbon** price holds — `TREND_UP_FRAC` / `TREND_DOWN_FRAC`
in `config.py`. Only non-NaN MAs are counted, so short-history instruments score on the same scale.

| Condition | Trend |
|---|---|
| holds ≥ 65% of the ribbon (2 of 3) AND close > MA500 | UPTREND (a shallow pullback below MA50 still counts) |
| holds ≤ 35% of the ribbon (1 of 3) AND close < MA50 | DOWNTREND |
| otherwise — price inside the ribbon | NEUTRAL (deep pullback or chop) |

> **Fixed 2026-07-30.** The rule was `UPTREND ⇔ close > MA500`, DOWNTREND checked second.
> One line decided it and the other 19 had no vote; because `np.select` takes the first true
> condition, **DOWNTREND was unreachable while price was above the anchor at all.** COHR read
> UPTREND on 4H below 19 of 20 of its own MAs at RSI 32; PLTR read UPTREND on Daily below 19 of 20
> with a negative ribbon slope. Worst on 4H: equities/indices resample to ~2 four-hour bars a
> session, so 4H MA500 spans **~305 calendar days** — the "4-hour trend" was a 10-month trend and
> could not report a 4H breakdown until price surrendered a year of average. Re-classified 109 of
> 734 Daily rows and 113 of 735 4H rows on the 07-28 run, 17 of them UPTREND → DOWNTREND (a
> transition the old rule could not make). Pinned by unit check 4 in `tests/golden_test.py`; the
> golden snapshot itself never covered `trend_direction`, which is how it survived.
>
> `trend_direction` is **not** the signal-firing gate — `signals.py` keeps its own strict
> `above_all`/`below_all` test — so this changed no fires (golden identical, 1454 fires).

**Weekly bar geometry** — `config.py` §"Weekly bar geometry", `main._resample_weekly()`

Weekly runs the SAME MA50–MA500 ribbon on weekly bars, unscaled. There is no session
ambiguity to correct for: a week is a week on every venue, so the 4H problem below has no
weekly analogue. What the three ribbons actually span:

| TF | MA50 spans | MA500 spans |
|---|---|---|
| 4H (equity, 2 bars/session) | ~2 weeks | ~12 months |
| Daily | ~5 weeks | ~24 months |
| Weekly | ~6 months | **~9.6 years** |

Two consequences, both measured:

- **Warmup eats half the history.** MA500 needs 500 weekly bars before it exists at all.
  The median instrument holds 1052 weekly bars, so only ~552 (≈11 years) can ever carry a
  weekly signal; 82.1% of the 808 cached instruments reach 500 weekly bars, the rest clip
  the ribbon through the same `p <= len(df)` rule the daily side uses. An instrument like
  BTC-USD (621 weekly bars) has just ~122 usable bars, ~2 years.
- **Fires are rare, by design.** 6–31 fires per instrument across ~11 usable years
  (AAPL 6, ^GSPC 7, GC=F 31) — roughly one a year on a trending equity, against ~120 on
  Daily. 13,146 weekly trades in the full backtest against 92,879 Daily.

**The in-progress week is dropped.** A week is not a bar until it has ended — the same rule
`drop_unfinished_daily` / `drop_unfinished_4h` apply to their own timeframes (CLAUDE.md
Important Rule 10). Without it, every run Monday–Thursday would compute the ribbon, the
trend and the signals on a part-formed bar, and a weekly B2 that fired on Tuesday could be
gone by Friday: the signal would repaint four days in five. So mid-week the weekly
timeframe shows the LAST CLOSED week and does not move. That is correct, not stale, and
`w_date` names the week it is showing. Weeks end Friday (`WEEKLY_RESAMPLE_RULE = 'W-FRI'`)
and are labelled by that Friday.

**Per-timeframe thresholds** — `REFIRE_PCT_WEEKLY = 0.08`, `NEW_TREND_PCT_WEEKLY = 0.05`.
**UNTUNED**: 0.08 is Daily's 0.05 scaled by sqrt(5) (a weekly bar holds five daily bars, so
its moves are ~2.2x). Sweep both with `backtest.py` before treating either as measured.

**4H bar geometry** — `config.py` §"4H bar geometry", `data_fetcher.h4_ticker()`, `main._h4_ma_periods()`

A 4H bar is only as fast as the session behind it. yfinance 1h returns **regular session only**
for a cash index, so `^NDX` gave 2 four-hour bars a session where the 24h contract gives 6 —
MA500 spanning ~305 calendar days instead of ~83. The 4H was a 10-month read wearing a 4H badge.

| | bars/session | MA500 spans |
|---|---|---|
| 24h contract (`NQ=F`) | 6 | ~83 days |
| Cash index (`^NDX`) | 2 | ~305 days |

Measured on the 07-28 cache: **all 20 cash indices** carried a 4H trend label that disagreed with
a true-4H read, and **5 produced no fire while a true 4H fired** — US100 S1 (07-24), SOX S1
(07-27), NI225 S1 (07-28), NQTW S1 (07-28), CHINAH B1.

- `H4_SOURCE` — US100/US500/US30/RUSSELL/NI225 take their **4H feed from `NQ=F`/`ES=F`/`YM=F`/
  `RTY=F`/`NKD=F`**. Exact fix: real 24h bars, so wick-touch setups (B3/B4) are right too. The
  cache is keyed by the SOURCE ticker; `main.py` and `backtest.py` both resolve the mapping.
- `H4_SESSION_NORMALIZE` — the other 15 indices have no usable yfinance future, so the ribbon is
  scaled by bars/session instead: MA25–MA250 (EU, 3/session), MA17–MA167 (2/session). Approximate
  — the bars are still session bars — but far closer than reaching 3x too far back.
- **Daily is untouched.** It stays on the cash index; the timeframes are independent.
- **Not a universal problem.** A US equity really does trade 6.5h, so its 4H chart is ~2
  bars/session everywhere including TradingView — those 642 instruments were already correct and
  are deliberately left alone. Forcing a 6-bar target on them would invent fires.

Backtest after the change (`backtest.py --since 2016-01-01`, 123,977 trades): **Index class
avg R −0.048 → −0.021** (PF 0.92 → 0.94), 4H buys up across the board (B4 +0.098 → +0.122,
B2 +0.052 → +0.060, B1 −0.001 → +0.008). Daily Index cells unchanged to 3dp — the parity check
that proves this is 4H-only. Four tier flips, two of them (`4H|S2|Index` high→low,
`4H|S3|Index` low→high) on samples of 199 and 96 — treat as noise, not signal.

**Established trend** (`established_trend`, state machine) — `signals.py`
- B1 fires → established UPTREND until an S1 fires (and vice versa).
- Persists through NEUTRAL bars. This is the trend that "comes first" in all conflict arbitration.
- With `B1S1_ANCHOR_GATE = True` (live), the state flips only on a genuine full-ribbon cross
  from a non-trending state — fast-MA noise cannot flip it.
- **It is a latch, and nothing else clears it.** `in_uptrend` is set by B1 (close above all 3 MAs)
  and cleared only by S1 (close below all 20), so it survives any decline that stops short of the
  anchor. US100 on 2026-07-28 still carried `h4_established_trend = UPTREND` from a 4H B2 on
  07-14 while its 4H close sat below its whole ribbon at RSI 31. **Consumers that mean "right now" must
  read `trend_direction`, not this** — `tf_alignment` (main.py) and `effectiveTrend()` (app.js)
  were both switched off the latch on 2026-07-30 for exactly this reason. Un-latching it early
  would change which B2/B3/B4 setups fire and therefore invalidate `confidence_map.json`; still
  open, needs a backtest before any change.

---

## 2. B1 / S1 — Trend reversal (highest priority)

`signals.py add_signals()`
- **Trigger:** close strictly above (B1) / below (S1) ALL ribbon MAs — `max()`/`min()` of every MA present.
- **Anchor gate (`B1S1_ANCHOR_GATE = True`):** a fresh B1 fires only from a non-uptrend state
  (S1 mirror). In an established trend the flag blocks fast-MA re-cross noise.
- **Re-fire:** after a primary cross, a pullback to within `refire_pct` of MA500 re-fires the code
  once per band entry, only within `_REFIRE_WINDOW_DAYS = 10` calendar days of the cross.
  Opposite primary cancels the window. 5-bar dedup (`_REFIRE_DEDUP_BARS`).
- The anchor band claims a bar **only while a re-fire window is active**. Outside an active
  window a near-anchor bar falls through to B4/S4 evaluation (before 2026-07-11 an expired
  band swallowed those bars with a status-only branch — audit finding 1.4).

**Per-timeframe thresholds** (passed by `main.py process_instrument()`):
| TF | refire_pct | new_trend_pct |
|---|---|---|
| 4H | 0.02 | 0.05 |
| Daily | 0.05 | 0.05 |
| Weekly | 0.08 | 0.05 | *(untuned — see §1)* |

---

## 3. B2–B4 / S2–S4 — Pullback (buy) / rally (sell) signals

`signals.py` — require established trend (in_uptrend / in_downtrend). Since 2026-07-11 (audit 1.4)
the sides are gated by established trend only, NOT by which side of MA500 the close landed on —
each setup carries its own close confirmation. One signal per bar, explicit priority:
B1/S1 primary > active B1/S1 re-fire > 4 > 3 > 2 (deepest wins).

| Code | Depth | Rule |
|---|---|---|
| B2/S2 | shallow | price pulled below MA50 (any depth) then closed back above it (mirror for S2) |
| B3/S3 | mid-ribbon | wick (Low/High) touches MA250 within `MA_TOUCH_TOLERANCE`, close confirms beyond MA250 |
| B4/S4 | anchor | wick touches MA500 within tolerance, close confirms beyond MA500 |

- Touch tolerance: `MA_TOUCH_TOLERANCE = 0.001` (0.1%), config.py.
- 5-bar dedup per code.
- Mid-ribbon MA is MA250 (`_MA_MID` in signals.py); clipped ribbons use the middle period.

---

## 4. Signal confidence — backtest-driven (since 2026-07-09)

`signals.py _signal_confidence()` reads `confidence_map.json` (generated by `backtest.py`):
- Lookup `TF|CODE|CLASS` (e.g. `D|B2|Equity`), falling back to `TF|CODE`, else `standard`.
- Asset classes (`instruments.py asset_class_of`): Crypto, Forex, Commodity, Index, Equity.
- Tiers from measured expectancy (`CONF_HIGH_R = 0.05`, `CONF_MIN_TRADES = 30` in backtest.py):
  - **high** — avg ≥ +0.05R per trade in backtest
  - **standard** — 0 ≤ avg < +0.05R, or too few trades for the cell
  - **low** — negative expectancy
- If `confidence_map.json` is missing entirely, every signal falls back to `high` (legacy).

**Regenerate:** `python3 backtest.py --since 2016-01-01` (full run rewrites the map).
Re-run after any signal-rule change, then re-run `main.py` so live confidences update.

### 4a. Context confidence modifiers — edge-audit phase 3a (since 2026-07-15)

After the base tier is set, `main.py apply_context_confidence()` nudges it one step
per matching rule in `config.CONTEXT_RULES` (deltas stack; clamped at high/low). Rules
come from the 120k-trade context backtest (`edge_audit.py`, see `EDGE_AUDIT_PHASE3.md`):
each is a signal + a fire-time condition whose measured expectancy differs materially
(≥0.04R) from that signal's blind baseline, stable across both history halves and not a
one-asset-class fluke. The reason string is written to `{tf}confidence_context`.

| Rule | Signal (TF) | Condition at fire | Δ | Measured edge (n) |
|------|-------------|-------------------|---|-------------------|
| R2a | D B1 | `rsi ≥ 70` | −1 | −0.099R (1862) |
| R2b | D B1 | `ma_order_score ≤ 5` | −1 | −0.134R (718) |
| R3a | D B2 | `roc ≥ 3` (chasing) | −1 | −0.059R (5826) |
| R3b | D B2 | `roc ≤ −3` (buying weakness) | +1 | +0.082R (829) |
| R4  | D S3, D S4 | `rollover_stage == 2` | +1 | S3 +0.114R (713), S4 +0.136R (1240) |

**Rejected R1** (4H signal counter to daily trend): after removing a look-ahead bias in
the 4H↔daily join, its edge attenuated (B2 −0.061R robust, B3/B4 directional-only) below
the ship bar. Deferred to 3b along with ATR/volatility rules and aligned boosts.

Historical check on the 120k set: high-bucket avg R +0.133→+0.144, low −0.153→−0.156,
high-minus-low separation +0.286→+0.299 (labels discriminate better).

---

## 5. Backtest engine — `backtest.py`

- Production-parity replay: same `add_signals` params as main.py per TF, reads the parquet cache.
- Entry next bar open, slippage 0.05%/side, stop = 2×ATR(14), target 2R,
  time stop 30 bars (D) / 60 bars (4H). Gap opens through stop/target fill at the open.
- Output `output_ma500/backtest_<date>.json` → published to R2 as `backtest.json`
  (dashboard Track Record card + per-instrument modal Track Record).

---

## 6. Rollover — the MA-cross engine

`indicators.py add_ribbon_analytics()`
- **Movers** (weights, positional): the fast line MA50 ×2 (it leads), the mid line MA250 ×1
- **Anchors:** MA300, MA400, MA500
- Each mover-above-anchor pair adds its weight to bull; below adds to bear → `rollover_score` 0–15,
  `rollover_dir` = dominant side.
- **Stage** (depth of the cut): MA50 through MA250 → 1, MA50 through MA500 → 2, MA250 through MA500 → 3 (full flip).
- Early-warning gauge — may deliberately oppose the established trend. Display-only
  (it no longer affects confidence).

---

## 7. Ribbon analytics

`indicators.py` / `config.py`:
- `ribbon_spread` = (MA50 − MA500) / MA500 × 100 (+ = bullish fan)
- **Squeeze:** |spread| < `RIBBON_COMPRESSION_THRESHOLD = 5.0`
- `ribbon_slope_pct` = median %change of all 3 MAs over `SLOPE_LOOKBACK = 10` bars
- `ma_order_score` = correctly-ordered adjacent MA pairs, 0–19 (19 = perfect bull stack)

---

## 8. Key levels (daily) — live since 2026-07-09

`key_levels.py`, wired in `main.py process_instrument()`:
- Detected on the last `KEY_LEVEL_WINDOW_BARS = 1500` daily bars (~6 years).
- Pivot = bar whose High (Low) is the extreme of ±`PIVOT_LOOKBACK = 5` bars.
- Cluster levels within `KEY_LEVEL_CLUSTER_RANGE = 0.005` (0.5%) — highest touch count kept.
- Touch = bar range overlaps level ± `KEY_LEVEL_TOUCH_TOLERANCE = 0.002` (0.2%).
- Keep levels with ≥ 2 touches. Daily row gets: `key_level_price/type/date/touch_count`,
  `key_level_touched_today` (yes/no), `key_levels_all` (top 12 by touches).
- **Touched-today + the primary displayed level consider only the top `KEY_LEVEL_MAJOR_COUNT = 8`
  levels by touch count** — against all levels ~80% of instruments touch one daily (noise);
  against the top 8 it's ~8%/day, a real alert.
- Surfaces: scanner "Key Lvl" chip, Analyzed→Alerts Key Level tab, modal badge,
  summary `key_level_touches`.

---

## 9. Choppiness (daily)

`indicators.py add_neutral_oscillation()`:
- `ma_fast_cross_count` = closes crossing MA50 in last 30 bars
- `neutral_oscillation` = yes when count ≥ 3 AND |MA100 slope over 10 bars| < 0.15%
- Frontend treats `neutral_oscillation = yes` as NEUTRAL regardless of trend fields.

---

## 10. Timeframe alignment

`main.py _compute_tf_alignment()` — uses **trend_direction** (not the latch) of
4H + Daily + Weekly:
| Agreement | Label |
|---|---|
| every timeframe with a ribbon agrees | Aligned Bull / Aligned Bear |
| some up and some down | Counter-trend |
| otherwise (any NEUTRAL, no conflict) | Mixed |

Score = sum(+1 up / −1 down) → **−3 … +3** (was −2 … +2 before Weekly, 2026-09-02 —
anything drawing a bar from this must rescale, not clamp).

A timeframe that produced no ribbon at all — too little history for even a clipped MA set —
is **absent**, and absent does not vote. NEUTRAL is different: it is an opinion (price is
inside the ribbon) and it still blocks alignment, exactly as before. The test counts
timeframes that are present rather than hard-coding 2, which quietly stopped meaning
"all of them" the moment a third timeframe existed.

---

## 11. Trend history segments (Trends tab)

`main.py _extract_trend_segments()`:
- NEUTRAL bars inherit the prior direction; segments shorter than `MIN_TREND_DAYS = 30`
  are absorbed into the previous segment; consecutive same-direction segments merge.

---

## Quick-edit cheat sheet

| Knob | Value | Effect of raising it |
|---|---|---|
| `MA_TOUCH_TOLERANCE` (config) | 0.001 | more B3/B4/S3/S4 fires (looser touches) |
| `RIBBON_COMPRESSION_THRESHOLD` (config) | 5.0 | more squeeze alerts |
| `VOLUME_LOOKBACK` (config) | 25 | smoother volume baseline → fewer spikes |
| `KEY_LEVEL_TOUCH_TOLERANCE` (config) | 0.002 | levels accumulate touches faster |
| `KEY_LEVEL_CLUSTER_RANGE` (config) | 0.005 | fewer, fatter key levels |
| `KEY_LEVEL_WINDOW_BARS` (config) | 1500 | longer level lookback window |
| `PIVOT_LOOKBACK` (config) | 5 | fewer, more significant pivots |
| `SIGNAL_LOOKBACK_DAILY/4H` (config) | 20/60 | how far back "last signal" is reported |
| `_REFIRE_DEDUP_BARS` (signals.py) | 5 | fewer signal re-fires |
| `_REFIRE_WINDOW_DAYS` (signals.py) | 10 | longer B1/S1 re-fire window after a cross |
| `B1S1_ANCHOR_GATE` (signals.py) | True | False restores pre-audit 1-bar-edge B1/S1 |
| `CONF_HIGH_R` (backtest.py) | 0.05 | stricter bar for "high" confidence |
| `MIN_TREND_DAYS` (main.py) | 30 | longer → fewer, bigger trend segments |
| refire/new-trend pcts | per-TF table §2 | passed from `main.py process_instrument()` |

**Dead knobs in config.py** (no effect): `P3P4_DEDUP_WINDOW`, `P2_DEDUP_WINDOW`,
`TTP_COOLDOWN_BARS`, `MIDPOINT_BOUNCE_PCT`, `MAX_PENETRATION_*`, `TREND_DURATION_THRESHOLD`,
`MA_MIDPOINT`, `WATCH_APPROACH_PCT`, `SMALL_MA_RANGE`.

**Removed features** (2026-07-09): watch_flag and potential_turning_point_flag were emitted
as always-empty columns with dead UI — columns remain in the payload for compatibility but the
Analyzed alert tabs and counters were stripped. Re-implement in signals.py if ever wanted.
