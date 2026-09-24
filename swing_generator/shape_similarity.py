"""
Chart shape similarity — which instruments' charts look like each other.

Why this exists
---------------
Two charts can look like twins because the instruments really are the same bet
wearing different tickers. Measured on the 2026-09-03 cache, SA40 and GOLD run
at +0.976 over 520 daily bars: the JSE Top 40 is mining-heavy, so it tracks the
gold complex. Someone holding GOLD, SA40 and FRES believes they hold three
positions. They hold one, three times.

That concentration read is the point of this file. The lookalike list is the
pleasant half; the warning is the useful half.

What it is NOT
--------------
Not a signal, and not predictive. Three separate null results have already been
measured on this codebase's entries (see the MA-cross study 2026-09-03, the
random-control study, and the 4H confirmation study). Shape similarity is a
DESCRIPTION of what has already happened, published so the app can say "these
five buys are one trade". Nothing here feeds signal_confidence and nothing
should.

Method, and the two corrections it needs
----------------------------------------
1. Each instrument's last WINDOW_BARS daily closes, z-scored. Level and
   volatility drop out, so a R50 share and a $4,000 ounce are comparable.

2. **Remove the market's common drift.** Skipping this is the difference
   between a useful grouping and a useless one: a first cut put 468 of 793
   instruments (59%) into one bucket called "Steady climb", which is true —
   almost everything has risen for two years — and tells you nothing. Each
   path is regressed on the cross-sectional mean path and the residual is what
   gets compared, so what is left is what makes a chart DIFFERENT.

3. **Do not force a partition.** Cutting the tree at a similarity threshold
   leaves genuinely tight families named and everything else honestly
   ungrouped. Asking for "10 groups" always yields one group holding half the
   book. At MIN_FAMILY_CORR the book gives ~60 families over about half the
   instruments; the other half legitimately belong to no family.

Written to output_ma500/shape_similarity.json and uploaded like every other
aggregate artifact.

CLI:
    python3 shape_similarity.py            # build + write the json
    python3 shape_similarity.py --report   # print families and a sample
"""

import argparse
import gzip
import json
import os
from collections import Counter
from datetime import date

import numpy as np
import pandas as pd

from _active_config import OUTPUT_DIR
from data_fetcher import _cache_path, _drop_priceless
from instruments import load_instruments

OUT_PATH = os.path.join(OUTPUT_DIR, 'shape_similarity.json')

# 520 daily bars is the window the Charts reel draws, so "these look alike"
# means alike on the chart actually on screen. It is also ~2 years, which is a
# judgement about the current regime rather than about all history.
WINDOW_BARS = 520

TOP_N = 10            # lookalikes stored per instrument
MIN_NEIGHBOUR_CORR = 0.55   # below this "similar" is not a claim worth making
MIN_FAMILY_CORR = 0.80      # average-linkage cut for a named family
MIN_FAMILY_SIZE = 3


# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------
# Which bars each timeframe compares. Same 520 as the Charts reel draws, on
# every timeframe — "these look alike" has to mean alike on the chart actually
# on screen, and the reel draws 520 bars whichever tab you are on.
#
# 520 bars is a different amount of CALENDAR on each: ~3 months of 1H, a year
# of 4H, two years of Daily, six of 3-day, ten of Weekly. That is the point.
# Grouping on daily shape and then showing the result on the Weekly tab was the
# original fault — measured 2026-09-08, families that correlate 0.91 on Daily
# fall to 0.68 on 3D and 0.69 on Weekly, with the worst pairs at -0.71 and
# -0.69: moving in OPPOSITE directions while labelled lookalikes.
#
# Instruments without 520 bars on a timeframe are left out of that timeframe's
# grouping rather than compared over a shorter span — a 300-bar weekly chart
# and a 520-bar one do not look alike even when the numbers correlate, because
# the reel draws both across the same width. Coverage at 520: D/4H/1H ~100%,
# 3D 95%, Weekly 84%.
SHAPE_TIMEFRAMES = ('D',)   # 1H/4H removed 2026-09-11, 3D/W 2026-09-24


def _frame_for(path, tf):
    """The bars one timeframe compares, from the cache the pipeline already has."""
    from main import _resample_3d, _resample_weekly, _resample_4h, _h1_frame
    if tf in ('1H', '4H'):
        hourly = path.replace('.parquet', '_1h.parquet')
        if not os.path.exists(hourly):
            return None
        df = pd.read_parquet(hourly)
        return _h1_frame(df) if tf == '1H' else _resample_4h(df)
    if not os.path.exists(path):
        return None
    df = _drop_priceless(pd.read_parquet(path))
    if tf == '3D':
        return _resample_3d(df)
    if tf == 'W':
        return _resample_weekly(df)
    return df


def load_matrix(instruments=None, tf='D'):
    """Z-scored close paths for every instrument with a full window ON `tf`.

    Returns (names, X, meta) where X[i] is one z-scored path.
    """
    instruments = instruments or load_instruments()
    names, rows, meta = [], [], {}
    for inst in instruments:
        path = _cache_path(inst['ticker'])
        try:
            frame = _frame_for(path, tf)
            if frame is None or 'Close' not in frame:
                continue
            close = frame['Close'].dropna()
        except Exception:
            continue
        if len(close) < WINDOW_BARS:
            continue
        v = close.iloc[-WINDOW_BARS:].to_numpy().astype(float)
        # A frozen instrument has zero variance and would correlate with
        # nothing meaningfully; a NaN anywhere poisons the whole column.
        if not np.isfinite(v).all() or v.std() == 0:
            continue
        names.append(inst['name'])
        meta[inst['name']] = {
            'group':  inst.get('group', ''),
            'sector': inst.get('sector', '') or inst.get('industry', ''),
        }
        rows.append((v - v.mean()) / v.std())
    return names, np.asarray(rows), meta


def residual_correlation(X):
    """Correlation between paths AFTER the common market drift is removed.

    See the module docstring, point 2 — this single step is what stops the
    result being one enormous "everything went up" bucket.
    """
    market = X.mean(axis=0)
    beta = (X @ market) / (market @ market)
    R = X - np.outer(beta, market)
    R = (R - R.mean(axis=1, keepdims=True)) / (R.std(axis=1, keepdims=True) + 1e-9)
    return np.corrcoef(R), R


# ---------------------------------------------------------------------------
# Families
# ---------------------------------------------------------------------------
def _agglomerate(C, min_corr, min_size):
    """Average-linkage clustering, stopping at a similarity floor.

    Hand-rolled because scipy is not a dependency here and this is ~30 lines.
    Merges the closest pair until the closest pair is no longer similar enough
    to be called a family, then keeps whatever is big enough.
    """
    n = C.shape[0]
    d = (1.0 - C).astype(float)
    np.fill_diagonal(d, np.inf)
    members = {i: [i] for i in range(n)}
    active = list(range(n))
    cut = 1.0 - min_corr

    while len(active) > 1:
        sub = d[np.ix_(active, active)]
        i_, j_ = np.unravel_index(np.argmin(sub), sub.shape)
        if sub[i_, j_] > cut:
            break
        a, b = active[i_], active[j_]
        na, nb = len(members[a]), len(members[b])
        for c in active:
            if c in (a, b):
                continue
            d[a, c] = d[c, a] = (d[a, c] * na + d[b, c] * nb) / (na + nb)
        members[a] += members[b]
        del members[b]
        active.remove(b)
        d[b, :] = np.inf
        d[:, b] = np.inf

    return [m for m in members.values() if len(m) >= min_size]


def _shape_name(path):
    """Fallback name, from the family's own average shape.

    Fed the RAW z-scored path, never the de-drifted residual. Naming off the
    residual describes performance RELATIVE to the market, which produced
    'Steady slide' for the gold complex on 2026-09-03 — a family whose charts
    have plainly been rising. Similarity is a relative question and grouping
    correctly needs the residual; the NAME is about what the chart looks like,
    and the chart shows the actual path.
    """
    n = len(path)
    net = path[-1] - path[0]
    x = np.linspace(0, 1, n)
    resid = float(np.std(path - np.polyval(np.polyfit(x, path, 1), x)))
    peak = int(np.argmax(path)) / n
    trough = int(np.argmin(path)) / n
    if abs(net) < 0.8 and resid > 0.55:
        return 'Range and chop'
    if net > 0.8 and resid < 0.55:
        return 'Steady climb'
    if net > 0.8 and 0.25 < trough < 0.8:
        return 'V recovery'
    if net < -0.8 and 0.2 < peak < 0.75:
        return 'Rounded top'
    if net < -0.8:
        return 'Steady slide'
    return 'Grinding up' if net > 0 else 'Drifting lower'


def _family_name(idx, names, meta, X, used):
    """Name a family from what its members ARE, falling back to their shape.

    Composition wins when it is consistent, because "Energy" tells you more
    than "Steady slide" does. But composition alone produced FOUR families all
    called "Technology" (semis, software, payments and data are genuinely
    different shapes), so a name already taken gets its shape appended rather
    than silently duplicated — a label that does not distinguish is worse than
    a plain one.
    """
    sectors = Counter(meta[names[i]]['sector'] for i in idx if meta[names[i]]['sector'])
    groups = Counter(meta[names[i]]['group'] for i in idx if meta[names[i]]['group'])
    shape = _shape_name(X[idx].mean(axis=0))

    base = ''
    if sectors:
        top, cnt = sectors.most_common(1)[0]
        if cnt / len(idx) >= 0.5:
            base = top
    if not base and groups:
        top, cnt = groups.most_common(1)[0]
        if cnt / len(idx) >= 0.6:
            base = top
    if not base:
        return shape
    return f'{base} — {shape.lower()}' if base in used else base


def build(instruments=None, tf='D'):
    names, X, meta = load_matrix(instruments, tf)
    if len(names) < 10:
        return None

    C, R = residual_correlation(X)
    order = np.argsort(-C, axis=1)

    neighbours = {}
    for i, name in enumerate(names):
        picks = []
        for j in order[i]:
            if j == i:
                continue
            c = float(C[i, j])
            if c < MIN_NEIGHBOUR_CORR or len(picks) >= TOP_N:
                break
            picks.append({'name': names[j], 'corr': round(c, 3)})
        neighbours[name] = picks

    families, family_of = [], {}
    used = set()
    for idx in sorted(_agglomerate(C, MIN_FAMILY_CORR, MIN_FAMILY_SIZE),
                      key=len, reverse=True):
        label = _family_name(idx, names, meta, X, used)
        used.add(label)
        sub = C[np.ix_(idx, idx)]
        cohesion = float((sub.sum() - len(idx)) / (len(idx) * (len(idx) - 1)))
        fid = len(families)
        members = [names[i] for i in idx]
        families.append({
            'id': fid,
            'label': label,
            'cohesion': round(cohesion, 3),
            'members': members,
        })
        for m in members:
            family_of[m] = fid

    return {
        'generated': str(date.today()),
        'window_bars': WINDOW_BARS,
        'timeframe': tf,
        'instruments': len(names),
        'min_neighbour_corr': MIN_NEIGHBOUR_CORR,
        'min_family_corr': MIN_FAMILY_CORR,
        'neighbours': neighbours,
        'families': families,
        'family_of': family_of,
    }


def write(instruments=None):
    """Build one grouping PER TIMEFRAME and write them as one file.

    Never fatal — a failure here must not cost a run of market data, and one
    timeframe failing must not cost the others.

    The Daily grouping stays at the top level as well as inside `by_tf`, so a
    browser running an older app.js keeps working exactly as before instead of
    losing the feature to a shape it does not understand.
    """
    instruments = instruments or load_instruments()
    by_tf, counts = {}, []
    for tf in SHAPE_TIMEFRAMES:
        try:
            p = build(instruments, tf)
        except Exception as exc:
            print(f'  ! shape similarity [{tf}] failed: {type(exc).__name__}: {exc}')
            continue
        if not p:
            print(f'  ! shape similarity [{tf}]: too few instruments with a full window')
            continue
        by_tf[tf] = p
        counts.append(f"{tf} {len(p['families'])}f/{p['instruments']}")

    payload = by_tf.get('D')
    if not payload:
        print('  ! shape similarity: no daily grouping — nothing written')
        return None
    payload = dict(payload)
    payload['by_tf'] = by_tf
    payload['timeframes'] = list(by_tf)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    # Written GZIPPED under the plain .json name, the same trick chart_feed
    # uses: publish.upload_to_r2 detects the magic bytes and sets
    # Content-Encoding, so the app fetches the same URL and gets 43 KB
    # instead of 236 KB. r2.dev does no compression of its own.
    raw = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    with gzip.GzipFile(OUT_PATH, 'wb', compresslevel=6, mtime=0) as fh:
        fh.write(raw)
    kb = os.path.getsize(OUT_PATH) / 1024
    print(f'  Shape similarity: {" · ".join(counts)}  ({kb:.0f} KB gzipped)')
    return payload


def _report(payload):
    fams = payload['families']
    grouped = sum(len(f['members']) for f in fams)
    print(f"\n{payload['instruments']} instruments over {payload['window_bars']} daily bars")
    print(f"{len(fams)} families, {grouped} instruments grouped "
          f"({grouped / payload['instruments'] * 100:.0f}%)\n")
    for f in fams[:15]:
        print(f"  {f['label'][:32]:32s} n={len(f['members']):3d} "
              f"cohesion={f['cohesion']:+.2f}  "
              f"{', '.join(f['members'][:7])}{' …' if len(f['members']) > 7 else ''}")
    for probe in ('SA40', 'GOLD'):
        nb = payload['neighbours'].get(probe)
        if nb:
            print(f"\n{probe} looks like: " +
                  ', '.join(f"{n['name']} {n['corr']:+.2f}" for n in nb[:6]))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--report', action='store_true', help='print families after building')
    ap.add_argument('--profile', default='ma500')
    args = ap.parse_args()
    p = write()
    if p and args.report:
        _report(p)
