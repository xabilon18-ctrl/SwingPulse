# SwingPulse — Signal Rules Reference (for editing)

> Extracted from code 2026-06-11. Each rule lists where to change it.
> Engine: `signals.py` · indicators: `indicators.py` · thresholds: `config.py`

---

## 1. Trend definitions

**Price-position trend** (`trend_direction`, per bar, per timeframe) — `indicators.py add_trend()`
| Condition | Trend |
|---|---|
| close < MA25 (below fastest MA) | DOWNTREND (checked first — wins in mixed ribbon) |
| close > MA500 (above slowest MA) | UPTREND |
| otherwise | NEUTRAL |

**Established trend** (`established_trend`, state machine) — `signals.py`
- B1 fires → established UPTREND until an S1 fires (and vice versa).
- Persists through NEUTRAL bars. This is the trend that "comes first" in all conflict arbitration.

---

## 2. B1 / S1 — Trend reversal (highest priority)

`signals.py add_signals()`
- **Strict all-MA test:** compares close against the actual ribbon extremes — `max()`/`min()` of all 20 MAs —
  not just MA25/MA500, since in a mixed/transitional ribbon MA500 is not necessarily the highest MA.
- **Arming:** close below EVERY ribbon MA arms B1; close above EVERY ribbon MA arms S1.
- **Fire B1:** close crosses above the HIGHEST ribbon MA (strictly above every MA) while armed and
  not already in uptrend. S1 mirror: close below the LOWEST ribbon MA.
- **Re-fire:** while in uptrend, any bar with distance from MA500 in `0 … refire_pct` re-fires B1
  (confirming the anchor level), minimum **5 bars** between fires (`_REFIRE_DEDUP_BARS`, signals.py).
- **New-trend zone:** `refire_pct < dist ≤ new_trend_pct` → consolidation; **no pullback signals fire here**
  (except B7/S7 — see below). Sets `new_trend_flag`.

**Per-timeframe thresholds** (passed by `main.py process_instrument()`):
| TF | refire_pct | new_trend_pct |
|---|---|---|
| 4H | 0.02 | 0.05 |
| Daily | 0.05 | 0.10 |
| Weekly | 0.08 | 0.15 |
| Monthly | 0.12 | 0.20 |

Confidence: **B1/S1 always `high`**.

---

## 3. B2–B7 / S2–S7 — Pullback (buy) / rally (sell) signals

`signals.py` — active only once `dist from MA500 > new_trend_pct` (established move), in the established direction.

**Watch-level ladder** (`PULLBACK_LEVELS` + `_LEVEL_TO_SIGNAL`, signals.py):
| Watch MA | Buy code | Sell code |
|---|---|---|
| MA25 | B2 | S2 |
| MA100 | B3 | S3 |
| MA200 | B4 | S4 |
| MA300 | B5 | S5 |
| MA400 | B6 | S6 |
| MA500 | B7 | S7 |

- **Buy side:** watch level = lowest ladder MA that close is **at or above**. Fire when the wick (Low)
  touches the watch MA within `MA_TOUCH_TOLERANCE` AND close confirms **above** it.
- **Sell side mirror:** watch level = lowest ladder MA close is at or below; wick (High) touches; close confirms below.
- **B7/S7 special:** fires on a wick-touch of MA500 with close confirming — allowed even inside the
  new-trend zone (it happens by definition near MA500). **Always `high` confidence.**

**Touch tolerance** (`config.py`):
- `MA_TOUCH_TOLERANCE = 0.001` (0.1%) — all TFs except monthly
- `TOUCH_TOLERANCE_MONTHLY = 0.007` (0.7%)

---

## 4. Watch flag (pre-signal alerts)

`signals.py` — feeds the Watchlist alert tab:
- Wick touched the watch MA but close hasn't confirmed → `"Wick touched MAxxx — waiting for close…"`.
- Price within `WATCH_APPROACH_PCT = 0.015` (1.5%, config.py) of the watch MA without touching →
  `"Approaching MAxxx — N.N% above/below"`.

---

## 5. Signal confidence

`signals.py _signal_confidence()` — evaluated in this order:
1. B1/S1 → **high** (always)
2. B7/S7 → **high** (always)
3. Rollover aligned + stage ≥ 3 (full driver flip) → **high**
4. Volume spike AND at key level → **high**
5. Volume spike OR at key level OR (rollover aligned + stage ≥ 2) → **standard**
6. else → **low**

- *Volume spike* = today's volume > 25-day average (`VOLUME_LOOKBACK`, config.py).
- *At key level* = close within **0.5%** of a key level with ≥ **3** touches (hardcoded in signals.py).

---

## 6. Rollover — the MA-cross engine

`indicators.py add_ribbon_analytics()`
- **Movers** (weights): MA25 ×2, MA100 ×2 (drivers), MA200 ×1 (lagging)
- **Anchors:** MA300, MA400, MA500
- Each mover-above-anchor pair adds its weight to bull; below adds to bear → `rollover_score` 0–15,
  `rollover_dir` = dominant side.
- **Stage** (both drivers MA25+MA100 through): MA300 → 1, MA400 → 2, MA500 → 3 (full flip).
- Rollover is the **early-warning reversal gauge** — it deliberately may oppose the established trend;
  it only affects confidence when aligned (rule 5).

---

## 7. Ribbon analytics

`indicators.py` / `config.py`:
- `ribbon_spread` = (MA25 − MA500) / MA500 × 100 (+ = bullish fan)
- **Squeeze:** |spread| < `RIBBON_COMPRESSION_THRESHOLD = 5.0`
- `ribbon_slope_pct` = median %change of all 20 MAs over `SLOPE_LOOKBACK = 10` bars
- `ma_order_score` = correctly-ordered adjacent MA pairs, 0–19 (19 = perfect bull stack)

---

## 8. Potential turning point (TTP)

`indicators.py add_neutral_oscillation()` (defaults in function signature):
- `ma25_cross_count` = closes crossing MA25 in last **30** bars (`lookback`)
- Fires when count ≥ **3** (`cross_threshold`) AND |MA100 slope over 10 bars| < **0.15%** (`slope_threshold`)
- → `potential_turning_point_flag` = "Potential top/bottom/reversal …" (direction from trend state)

---

## 9. Key levels

`key_levels.py` / `config.py`:
- Pivot = bar whose High (Low) is the extreme of ±`PIVOT_LOOKBACK = 5` bars
- Cluster levels within `KEY_LEVEL_CLUSTER_RANGE = 0.005` (0.5%) — highest touch count kept
- Touch = bar range overlaps level ± `KEY_LEVEL_TOUCH_TOLERANCE = 0.002` (0.2%)
- Keep levels with ≥ **2** touches; "confirmed" for confluence needs ≥ **3**

---

## 10. Macro S/R touches (daily)

`indicators.py add_macro_sr_touch()`:
- Levels: **MA500 + MA1000 + MA2000 + MA3000** (4 → "ALL 4" confluence)
- Tolerance `MACRO_SR_TOLERANCE = 0.005` (0.5%, config.py)
- Support: Low ≤ MA×1.005 AND close > MA · Resistance: High ≥ MA×0.995 AND close < MA
- `macro_sr_strength` = number of levels touched on the winning side (3+ = multi-MA confluence)
- `macro_sr_level` = longest MA touched

---

## 11. Timeframe alignment

`main.py _compute_tf_alignment()` — uses **established_trend** of D, 4H, W, M:
| Agreement | Label |
|---|---|
| 4 same direction | Quad Bull / Quad Bear |
| 3 same, none opposing | Triple Bull / Bear |
| 2 same, none opposing | Double Bull / Bear |
| at least 1 each way | Counter-trend |
| all neutral | Mixed |

Score = sum(+1 up / −1 down) → −4 … +4.

---

## 12. Trend history segments (Trends tab)

`main.py _extract_trend_segments()`:
- NEUTRAL bars inherit the prior direction; segments shorter than `MIN_TREND_DAYS = 30`
  are absorbed into the previous segment; consecutive same-direction segments merge.

---

## Quick-edit cheat sheet (config.py)

| Knob | Value | Effect of raising it |
|---|---|---|
| `MA_TOUCH_TOLERANCE` | 0.001 | more B2–B7/S2–S7 fires (looser touches) |
| `TOUCH_TOLERANCE_MONTHLY` | 0.007 | same, monthly only |
| `WATCH_APPROACH_PCT` | 0.015 | more watch-flag alerts |
| `RIBBON_COMPRESSION_THRESHOLD` | 5.0 | more squeeze alerts |
| `VOLUME_LOOKBACK` | 25 | smoother volume baseline → fewer spikes |
| `MACRO_SR_TOLERANCE` | 0.005 | more macro S/R touches |
| `KEY_LEVEL_TOUCH_TOLERANCE` | 0.002 | levels accumulate touches faster |
| `KEY_LEVEL_CLUSTER_RANGE` | 0.005 | fewer, fatter key levels |
| `PIVOT_LOOKBACK` | 5 | fewer, more significant pivots |
| `SIGNAL_LOOKBACK_DAILY/4H/W/M` | 20/60/12/6 | how far back "last signal" is reported |
| In `signals.py`: `_REFIRE_DEDUP_BARS` | 5 | fewer B1/S1 re-fires |
| In `main.py`: `MIN_TREND_DAYS` | 30 | longer → fewer, bigger trend segments |
| refire/new-trend pcts | per-TF table §2 | passed from `main.py process_instrument()` |

**Unused/dead knobs in config.py** (no effect, can ignore): `P3P4_DEDUP_WINDOW`, `P2_DEDUP_WINDOW`,
`TTP_COOLDOWN_BARS`, `MIDPOINT_BOUNCE_PCT`, `MAX_PENETRATION_*`, `TREND_DURATION_THRESHOLD`, `MA_MIDPOINT`.
