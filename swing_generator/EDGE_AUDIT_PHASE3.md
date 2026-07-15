# Edge Audit — Phase 3 execution plan

Status: **approved by user, ready to execute.** Phase 1 (context capture, commit `bfdcd23`)
and phase 2 (analysis + findings, commit `622f07a`) are done. Phase 2 findings were
independently reviewed and endorsed (headline numbers re-verified from the raw dataset).
This file is the complete spec for phase 3. Execute it top to bottom; each step gates the next.

Dataset: `output_ma500/edge_audit_2026-07-15.csv.gz` (120,058 trades, 2016–2026).
Findings: `output_ma500/edge_audit_findings_2026-07-15.{json,txt}`.

---

## Step 0 — MANDATORY: re-measure alignment without look-ahead

**Why:** `_fire_context()` in backtest.py currently tags a 4H fire with the daily trend
from the **same calendar day's** daily bar. That bar's close isn't known intraday → mild
look-ahead bias in every 4H `aligned`/`counter` number. Daily trend flips are frequent
enough (~29% between consecutive D fires) that this must be re-measured honestly.

**Change (backtest.py):**
1. Pass the firing timeframe into the context capture: `_collect_trades` already knows
   `tf` — thread it through to `_fire_context(df, i, ma_periods, other_trend, fire_tf=tf)`.
2. Replace the `if getattr(ts, 'hour', 0) == 0:` heuristic with an explicit
   `if fire_tf == 'D':` (the heuristic misclassifies crypto 4H bars stamped 00:00).
3. For `fire_tf == '4H'`: use the **prior day's** daily bar —
   `pos = other_trend.index.searchsorted(ts.normalize(), side='left') - 1`
   (last daily bar strictly before the fire's calendar day).
   For `fire_tf == 'D'`: keep the existing same-day 23:59 lookup (4H bars close before
   the daily close — no look-ahead there).

**Run:** `python3 backtest.py --since 2016-01-01` (~8 min) then `python3 edge_audit.py`.
Trade mechanics are untouched by this change, so all trade counts / avg R must be
identical to the 2026-07-15 run — only `other_tf_trend`-derived rows in the findings move.
confidence_map.json should come out with identical tiers (commit it if the file changed).

**GATE:** proceed with rule R1 below only if, in the re-measured findings, the 4H
counter-trend drags on B2/B3/B4 remain **robust tier with edge ≤ −0.10R**. Expect modest
attenuation from the honest measurement; if any drops below that bar or flips to
directional, ship the rest of the rules and report the alignment result to the user
instead of implementing R1.

---

## Step 1 — the adopted rules (phase 3a)

Only these. All inputs already exist in production frames — no new indicators needed.
Declare them as data in config.py (a `CONTEXT_RULES` list with comments giving each
rule's provenance: edge in R and n), not scattered ifs.

Tier arithmetic: `high > standard > low`, move one step per rule hit, clamp at the ends.
Rules may stack (e.g. R2a + R2b → two steps down).

| # | Scope | Condition (at fire) | Action | Evidence |
|---|-------|--------------------|--------|----------|
| R1 | any 4H signal | signal direction counter to current **daily** `trend_direction` (buy vs DOWNTREND / sell vs UPTREND) | tier −1 | B3 −0.29, B4 −0.26, B2 −0.20 edge; n=473–753 each; robust (subject to Step 0 gate) |
| R2a | D B1 | `rsi >= 70` | tier −1 | −0.099 edge, n=1862, robust |
| R2b | D B1 | `ma_order_score <= 5` | tier −1 | −0.134 edge, n=718, robust |
| R3a | D B2 | `roc >= 3` | tier −1 | −0.059 edge, n=5826, robust |
| R3b | D B2 | `roc <= -3` | tier +1 | +0.082 edge, n=829, robust |
| R4 | D S3, D S4 | `rollover_stage == 2` | tier +1 | S3 +0.114 n=713, S4 +0.136 n=1240, robust |

**Do NOT implement:** regime rules (bear/bull — rides on 2024-26 only), sector-heat rules
(coverage starts 2024-10), any ATR/volatility rule (ATR isn't computed in production
frames — deferred to 3b), aligned **boosts** (only the counter penalty ships in 3a),
anything from the "directional-only" tier, anything with n < 300.

---

## Step 2 — implementation

- **Where:** the R1 rule needs both timeframes, so apply modifiers in `main.py
  process_instrument()` AFTER both TF rows exist — a small helper, e.g.
  `apply_context_confidence(row, other_tf_trend, tf)` called for each TF's extracted row.
  R2–R4 read columns already present on the row itself.
- Only adjust rows where a `primary_signal` fired (confidence is per-signal).
- Add a new per-TF column `confidence_context` (config `_tf_signal_columns` +
  the extract) holding a short human-readable reason, e.g. `"counter daily trend -1"`
  or `"RSI 70+ -1; ribbon disordered -1"`. Empty when no rule hit.
- **Golden tests:** `signal_confidence` is excluded from the golden hash and fires are
  unchanged, so goldens must pass untouched — run `python3 tests/golden_test.py` to confirm.
- **Frontend (minimal):** show `confidence_context` as one line in the modal Overview
  when non-empty (both TFs, use the `f()` prefix helper). Bump `app.js ?v=` in
  index.html. Nothing else — no filter changes in 3a.

## Step 3 — impact report BEFORE deploying

From the (re-measured) edge dataset, produce for the user:
1. Tier migration table: how many historical trades move high→standard, standard→low, etc.
2. Proof of sharpening: avg R of the "high" bucket before vs after modifiers
   (after must be higher), same for "low" (after must be lower).
3. Today's live diff: run `python3 main.py --profile ma500`, then diff today's
   signals CSV confidence columns against the prior day's — list every instrument whose
   tier changed and which rule caused it. Hand-inspect ~10 for sanity.

## Step 4 — deploy & commit

Established loop: goldens → `python3 main.py --profile ma500` (also publishes data to R2)
→ `python3 webapp/publish.py --profile ma500 --ui-only` if UI touched → verify live
(swingpulse200.pages.dev serves new version; spot-check a counter-trend 4H signal shows
the downgrade) → commit code + confidence_map.json together if the map changed.

Push BOTH remotes. `origin` pushes normally; `prod` needs the credential override:
`git -c credential.helper= -c credential.helper='!gh auth git-credential' push prod main`.
End commit messages with the project's `Co-Authored-By: Claude <model> <noreply@anthropic.com>` trailer.

Also update: `SIGNAL_RULES.md` (new "Context confidence modifiers" section — rules are
the source of truth in this project), CLAUDE.md current-versions block, and the
`pending_work.md` memory resume point (mark phase 3a shipped, list 3b deferred items).

## Deferred to phase 3b (do not start without the user)

- ATR in indicators.py + the volatility rules (B4/B3 calm-boost, B1/S1 high-vol boost)
- Aligned +1 boosts for 4H B1/B4
- Sector-heat-z appendix once coverage matures
- Regime re-test once 4H history spans a full cycle
- Full "why this confidence" chip UI in scanner cards
