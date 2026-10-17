"""Does the daily500-4h-v1 workflow engine have an edge? (2026-10-17)

backtest.py grades every fire of the production Daily/4H engine but has no
control, and this app's own history says an un-controlled average R misleads:
the retired engine's entries "tested no better than random". So this replays,
on the same finished bars backtest.py uses:

  workflow   the production engine (workflow_signals.add_workflow_signals)
  legacy     the retired engine (signals.add_signals, its old per-TF params)
  b1s1_*     B1/S1 only, re-derived with a confirmation buffer: the direction
             flips only once the close is buf% beyond MA500 (hysteresis), or
             after N consecutive closes on the new side. buf0 / n1 reproduce
             the production rule exactly.

and grades every fire through the SAME trade rules as backtest.simulate_trade
(next-bar open, 2xATR stop, 2R target, D 30 / 4H 60-bar time stop, slippage,
gap fills). Each fire is compared with CONTROL_PER_FIRE random entries on the
same instrument, same timeframe, same side, drawn from bars where MA500
exists. edge = avg R(signal) - avg R(control). Split before/after 2022.

Caveats, stated up front: trades overlap, so t-stats are optimistic; the
control is "random day, same instrument, same side", which already carries
the instrument's drift; financing is not modelled.

Run:  cd swing_generator && python3 research/workflow_edge_study.py
Env:  LIMIT=N (first N instruments), SINCE=YYYY-MM-DD (default 2016-01-01)
"""
import json
import math
import os
import sys
import zlib
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import date

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import backtest as bt                                          # noqa: E402
from data_fetcher import (_cache_path, _drop_priceless, scale_daily,   # noqa: E402
                          drop_unfinished_daily, load_1h)
from indicators import add_all_indicators                      # noqa: E402
from instruments import load_instruments, asset_class_of      # noqa: E402
from main import _frame_4h                                     # noqa: E402
from signals import add_signals                                # noqa: E402
from workflow_signals import add_workflow_signals              # noqa: E402

SINCE = date.fromisoformat(os.environ.get('SINCE', '2016-01-01'))
LIMIT = int(os.environ.get('LIMIT', '0') or 0)
CONTROL_PER_FIRE = 3
SPLIT_YEAR = 2022
BUFFERS = (0.0, 0.005, 0.01, 0.02)
CONFIRMS = (2, 3)
OUT = os.path.join(bt.OUTPUT_DIR, 'workflow_edge_study.json')


# ── Fast trade grading: simulate_trade's rules on numpy arrays ─────────────
def grade(o, h, l, c, atr, i, side, time_stop):
    """R multiple of a trade signalled on bar i, or None — bt.simulate_trade."""
    n = len(c)
    if i + 1 >= n or i + bt.MIN_BARS_AHEAD >= n:
        return None
    a = atr[i]
    if not (a > 0):
        return None
    entry = o[i + 1]
    if not (entry > 0):
        return None
    dist = bt.ATR_STOP_MULT * a
    slip = bt.SLIPPAGE_PCT
    if side > 0:
        entry *= 1 + slip
        stop, target = entry - dist, entry + dist * bt.TARGET_R
        if stop <= 0:
            return None
    else:
        entry *= 1 - slip
        stop, target = entry + dist, entry - dist * bt.TARGET_R
        if target <= 0:
            return None
    end = min(i + 1 + time_stop, n)
    for j in range(i + 1, end):
        oo, hh, ll = o[j], h[j], l[j]
        if not (oo > 0 and hh > 0 and ll > 0):
            continue
        if side > 0:
            if j > i + 1 and oo <= stop:
                return (oo * (1 - slip) - entry) / dist
            if j > i + 1 and oo >= target:
                return (oo * (1 - slip) - entry) / dist
            if ll <= stop:
                return (stop * (1 - slip) - entry) / dist
            if hh >= target:
                return (target * (1 - slip) - entry) / dist
        else:
            if j > i + 1 and oo >= stop:
                return (entry - oo * (1 + slip)) / dist
            if j > i + 1 and oo <= target:
                return (entry - oo * (1 + slip)) / dist
            if hh >= stop:
                return (entry - stop * (1 + slip)) / dist
            if ll <= target:
                return (entry - target * (1 + slip)) / dist
    k = end - 1
    px = float('nan')
    while k > i:
        px = c[k]
        if not math.isnan(px) and px > 0:
            break
        k -= 1
    if math.isnan(px) or px <= 0:
        return None
    return ((px * (1 - slip) - entry) if side > 0 else (entry - px * (1 + slip))) / dist


# ── B1/S1 variants ─────────────────────────────────────────────────────────
def flips_buffer(close, anchor, buf):
    """Indices + sides where the MA500 direction flips, with hysteresis buf."""
    out, d = [], 0
    for i in range(len(close)):
        x, m = close[i], anchor[i]
        if not (x > 0 and m > 0):
            continue
        nd = 1 if x > m * (1 + buf) else -1 if x < m * (1 - buf) else d
        if buf == 0.0 and x == m:
            nd = d
        if d and nd != d:
            out.append((i, nd))
        d = nd or d
    return out


def flips_confirm(close, anchor, need):
    """Direction flips only after `need` consecutive closes on the new side."""
    out, d, run, side = [], 0, 0, 0
    for i in range(len(close)):
        x, m = close[i], anchor[i]
        if not (x > 0 and m > 0) or x == m:
            continue
        s = 1 if x > m else -1
        run = run + 1 if s == side else 1
        side = s
        if not d:
            d = s
        elif s != d and run >= need:
            d = s
            out.append((i, s))
    return out


# ── Per instrument ─────────────────────────────────────────────────────────
def _frames(ticker):
    frames = {}
    path = _cache_path(ticker)
    if os.path.exists(path):
        df = drop_unfinished_daily(scale_daily(ticker, _drop_priceless(pd.read_parquet(path))))
        if len(df) >= 500:
            df = bt._add_atr(add_all_indicators(df))
            frames['D'] = df
    hourly = load_1h(ticker)
    if hourly is not None and not hourly.empty:
        h4 = _frame_4h(hourly)
        if len(h4) >= 500:
            frames['4H'] = bt._add_atr(add_all_indicators(h4))
    return frames


def study_instrument(inst):
    rng = np.random.default_rng(zlib.crc32(inst['ticker'].encode()))
    rows = []   # (tf, variant, code, side, year, r, is_control)
    try:
        frames = _frames(inst['ticker'])
    except Exception as exc:
        return inst['ticker'], [], str(exc)
    for tf, base in frames.items():
        ts = bt.TIME_STOP_BARS[tf]
        o, h, l, c = (base[k].to_numpy(float) for k in ('Open', 'High', 'Low', 'Close'))
        atr = base['atr'].to_numpy(float)
        years = base.index.year.to_numpy()
        dates = base.index.date if not hasattr(base.index, 'tz') or base.index.tz is None \
            else base.index.tz_localize(None).date
        anchor = base['Close'].rolling(500, min_periods=500).mean().to_numpy(float)
        ok = np.array([d >= SINCE for d in dates])
        pool = np.flatnonzero(ok & (anchor > 0) & (atr > 0))
        pool = pool[pool < len(c) - bt.MIN_BARS_AHEAD - 1]
        if not len(pool):
            continue

        fires = defaultdict(list)    # variant -> [(i, side, code)]
        wf = add_workflow_signals(base, tf=tf)['primary_signal'].to_numpy()
        params = bt.TF_SIGNAL_PARAMS[tf]
        lg = add_signals(base.copy(), ma_periods=[50, 250, 500], tf='study-' + tf,
                         **params)['primary_signal'].to_numpy()
        for name, col in (('workflow', wf), ('legacy', lg)):
            for i, code in enumerate(col):
                if code and ok[i] and code[0] in 'BS':
                    fires[name].append((i, 1 if code[0] == 'B' else -1, code))
        for buf in BUFFERS:
            for i, s in flips_buffer(c, anchor, buf):
                if ok[i]:
                    fires[f'b1s1_buf{buf * 100:g}%'].append((i, s, 'B1' if s > 0 else 'S1'))
        for need in CONFIRMS:
            for i, s in flips_confirm(c, anchor, need):
                if ok[i]:
                    fires[f'b1s1_confirm{need}'].append((i, s, 'B1' if s > 0 else 'S1'))

        for variant, lst in fires.items():
            for i, s, code in lst:
                r = grade(o, h, l, c, atr, i, s, ts)
                if r is None:
                    continue
                rows.append((tf, variant, code, s, int(years[i]), r, 0))
                for j in rng.choice(pool, CONTROL_PER_FIRE):
                    rc = grade(o, h, l, c, atr, int(j), s, ts)
                    if rc is not None:
                        rows.append((tf, variant, code, s, int(years[j]), rc, 1))
        # Parity check: the fast grader must agree with simulate_trade.
        mism = 0
        for i, s, code in fires['workflow'][:5]:
            a = grade(o, h, l, c, atr, i, s, ts)
            b = bt.simulate_trade(base, i, 'long' if s > 0 else 'short', tf)
            if (a is None) != (b is None) or (a is not None and abs(round(a, 3) - b['r_multiple']) > 0.002):
                mism += 1
        if mism:
            rows.append((tf, '_parity_mismatch', '', 0, 0, float(mism), 0))
    return inst['ticker'], rows, None


def _summ(rs, cs):
    rs, cs = np.asarray(rs), np.asarray(cs)
    if not len(rs):
        return None
    out = {'n': int(len(rs)), 'avg_r': round(float(rs.mean()), 3),
           'win': round(float((rs > 0).mean() * 100), 1)}
    if len(cs) > 1 and len(rs) > 1:
        edge = rs.mean() - cs.mean()
        se = math.sqrt(rs.var(ddof=1) / len(rs) + cs.var(ddof=1) / len(cs))
        out.update(ctrl_r=round(float(cs.mean()), 3), edge=round(float(edge), 3),
                   t=round(float(edge / se), 2) if se else None)
    return out


def main():
    try:   # retired instruments included where the option exists (no survivorship bias)
        insts = load_instruments(include_retired=True)
    except TypeError:
        insts = load_instruments()
    if LIMIT:
        insts = insts[:LIMIT]
    print(f'workflow edge study: {len(insts)} instruments, since {SINCE}, '
          f'{CONTROL_PER_FIRE} random controls per fire', flush=True)
    rows, errs, parity = [], 0, 0
    with ProcessPoolExecutor(max_workers=os.cpu_count() or 4) as ex:
        for k, (t, rr, err) in enumerate(ex.map(study_instrument, insts, chunksize=4), 1):
            if err:
                errs += 1
            parity += sum(int(r[5]) for r in rr if r[1] == '_parity_mismatch')
            rows += [r for r in rr if r[1] != '_parity_mismatch']
            if k % 100 == 0:
                print(f'  {k}/{len(insts)}', flush=True)
    print(f'errors: {errs}   fast-grader parity mismatches: {parity}')

    groups = defaultdict(lambda: ([], []))
    for tf, variant, code, side, year, r, ctl in rows:
        for key in ((tf, variant, 'ALL', 'all'), (tf, variant, code, 'all'),
                    (tf, variant, 'ALL', 'pre' if year < SPLIT_YEAR else 'post'),
                    (tf, variant, code, 'pre' if year < SPLIT_YEAR else 'post')):
            groups[key][ctl].append(r)
    result = {}
    for key in sorted(groups):
        s = _summ(*groups[key])
        if s:
            result['|'.join(key)] = s

    print(f'\n{"tf|variant|code|period":<42} {"n":>7} {"avgR":>7} {"win%":>6} '
          f'{"ctrlR":>7} {"edge":>7} {"t":>6}')
    for k, s in result.items():
        if k.endswith('|all') or '|ALL|' in k:
            print(f'{k:<42} {s["n"]:>7} {s["avg_r"]:>7.3f} {s["win"]:>6.1f} '
                  f'{s.get("ctrl_r", float("nan")):>7.3f} {s.get("edge", float("nan")):>7.3f} '
                  f'{(s.get("t") or float("nan")):>6.2f}')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump({'since': str(SINCE), 'controls_per_fire': CONTROL_PER_FIRE,
                   'split_year': SPLIT_YEAR, 'parity_mismatches': parity,
                   'results': result}, f, indent=1)
    print(f'\nwrote {OUT}')


if __name__ == '__main__':
    main()
