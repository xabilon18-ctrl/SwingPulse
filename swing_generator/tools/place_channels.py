"""Place trend channels by THE USER'S RULE — and nothing else (2026-10-04).

User: "next time i ask to add the trend lines you use these rules and nothing
else ... no matter the time frame". The rule was measured from the user's own
29 channels (30m + Daily) and confirmed on 10 auto-placed ones; memory note
user-channel-placement-rule has the numbers. Do not add judgement on top of it.

THE RULE
  1. Trend-side edge = the SLOWEST line on the chart (whatever its period: 500,
     or the stretched 1905/2658 on round-the-clock 30m charts) at the latest
     bar, pushed OUTWARD by GAP (3% of the channel width) — "breathing space".
     Downtrend: top edge. Uptrend: bottom edge.
  2. Slope = that slow line's slope over the last third of the leg. If the slow
     line is flat or still pointing AGAINST the price leg, the slope comes from
     the price leg instead (regression of closes) — what the user did on MKSI,
     LINKUSD D, AUDCAD, AUDCHF.
  3. Midline = through the deepest counter-trend reach of the leg (lowest low in
     a downtrend, highest high in an uptrend): pullbacks stop at the midline and
     price lives between the midline and the slow-line edge.
  4. Far edge = mirror of the trend-side edge through the midline (empty room).
  Leg start = the highest high (down) / lowest low (up) between LEG_MIN and
  LEG_MAX bars back, measured as fractions of the slow line's period, so the
  same rule fits every timeframe: on 30m the slow line spans ~55 calendar days
  on every chart since the 2026-10-03 scaling, so 0.2-0.9x is ~11-50 days
  (the user's 30m legs: 14-43); Daily 100-450 bars ~ 5 months-1.8 years (theirs:
  313-454 bars).

Reads the SAME bars the app draws (R2 chart bundles), and places lines in BAR
space exactly as app.js reelBarIndexForDate maps dates to x.

  python3 tools/place_channels.py MU FRA40                 # preview only
  python3 tools/place_channels.py --scan 5 --tf 30m        # best 5 up + 5 down
  python3 tools/place_channels.py MU --tf D --apply        # write to the app
  python3 tools/place_channels.py --all --tf D --apply     # every instrument
  python3 tools/place_channels.py --clear-auto --apply     # remove auto channels

--apply backs up the user's sync blob to research/out/ first, writes ONLY
charts that carry no CHANNEL of the user's own (their markers/lines stay beside
it; an earlier auto channel is replaced), stamps channelsMod so every device takes the change, and reads back.
Auto channels are purple (#a855f7) with seed:1; a channel the user drags loses
seed and is never touched again.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import subprocess
import sys
import time

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
R2 = 'https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev/ma500/chart'
KV_NS = '567b56a128dd4aee9c861d7653846acb'
WORKER_DIR = os.path.join(ROOT, 'webapp', 'sync-worker')
OUT_DIR = os.path.join(ROOT, 'research', 'out')

GAP = 0.03            # trend-side edge sits this share of the width outside the slow line
LEG_MIN = 0.2         # leg start searched between LEG_MIN and LEG_MAX x slow period bars back
LEG_MAX = 0.9
EXTRAP_BARS = 250     # app.js REEL_EXTRAP_BARS
AUTO_COLOR = '#a855f7'

# --scan only: what counts as a clean example worth showing
SCAN_MAX_BEYOND = 0.03   # share of closes (after the slow-line cross) on the wrong side of the edge
SCAN_MAX_POKE = 0.15     # furthest close past the edge, in channel widths
SCAN_MIN_MOVE = 0.3      # how far the channel travels over the leg, in widths
# --all: a chart whose price has crossed the slow line has no trend by rule 1, so no channel
ALL_MAX_POKE = 0.5       # furthest close past the trend-side edge since the cross, in widths


# ---------------------------------------------------------------- data ----

def _curl(url: str, tries: int = 3) -> dict:
    for k in range(tries):
        r = subprocess.run(['curl', '-s', '--max-time', '90', url], capture_output=True, text=True)
        try:
            return json.loads(r.stdout)
        except ValueError:
            time.sleep(2 * (k + 1))
    raise RuntimeError(f'could not read {url}')


class Feed:
    """Chart bundles exactly as the app loads them, memoised per chunk."""

    def __init__(self, tf: str):
        self.tf = tf
        self.idx = _curl(f'{R2}/index.json?x={int(time.time())}')['chunks']
        self._chunks: dict = {}

    def bundle(self, name: str) -> dict | None:
        cid = self.idx.get(name)
        if cid is None:
            return None
        if cid not in self._chunks:
            self._chunks[cid] = _curl(f'{R2}/{self.tf}/{cid}.json?x={int(time.time())}').get('data', {})
        return self._chunks[cid].get(name)

    def names(self) -> list[str]:
        return list(self.idx)


def _ms(label: str) -> float:
    return pd.Timestamp(label).value / 1e6


def bar_index(bt: np.ndarray, label: str) -> float:
    """app.js reelBarIndexForDate: interpolate inside history, project outside it."""
    t, n = _ms(label), len(bt)
    if t <= bt[0]:
        k = min(n - 1, EXTRAP_BARS)
        return (t - bt[0]) / ((bt[k] - bt[0]) / k)
    if t >= bt[-1]:
        k = max(0, n - 1 - EXTRAP_BARS)
        return n - 1 + (t - bt[-1]) / ((bt[-1] - bt[k]) / max(1, n - 1 - k))
    hi = int(np.searchsorted(bt, t, side='right'))
    lo = hi - 1
    return lo + (t - bt[lo]) / (bt[hi] - bt[lo])


# ---------------------------------------------------------------- rule ----

def _leg(b: dict, down: bool) -> dict | None:
    C = np.array(b['c'], float); H = np.array(b['h'], float); L = np.array(b['l'], float)
    N = len(C)
    slow = int(b['p'][-1])
    m = pd.Series(C).rolling(slow).mean().values          # == the slowest line the app draws
    w0, w1 = max(0, N - 1 - int(LEG_MAX * slow)), N - 1 - int(LEG_MIN * slow)
    if w1 - w0 < 10:
        return None
    s0 = w0 + int(np.argmax(H[w0:w1]) if down else np.argmin(L[w0:w1]))
    seg = np.arange(s0, N)
    ok = seg[~np.isnan(m[seg])]
    if len(ok) < 30:
        return None
    last = ok[-max(10, len(ok) // 3):]
    ma_slope = np.polyfit(last, m[last], 1)[0]
    px_slope = np.polyfit(seg, C[seg], 1)[0]
    if (px_slope < 0) != down:
        return None                                       # the price leg must go this way
    fallback = (ma_slope < 0) != down                     # slow line flat/against: slope from price
    slope = px_slope if fallback else ma_slope
    i = np.arange(N)
    edge = m[N - 1] + (i - (N - 1)) * slope               # through the slow line at the last bar
    reach = (L[seg] - edge[seg]).min() if down else (H[seg] - edge[seg]).max()
    if (reach < 0) != down or reach == 0:
        return None
    half = abs(reach)                                     # slow-line edge -> midline
    mid = edge + reach                                    # pullbacks stop here
    up_off = half * (1 + 2 * GAP)                         # edges pushed out by GAP x width (width = 2*half)
    # quality, for --scan and for the warning on named instruments
    sm = pd.Series(C).rolling(24, min_periods=1).mean().values
    wrong = np.where((sm[seg] > m[seg]) if down else (sm[seg] < m[seg]))[0]
    sc = seg[wrong[-1] + 1] if len(wrong) and wrong[-1] + 1 < len(seg) else s0
    W = 2 * up_off
    side = (C[sc:] - mid[sc:]) / up_off * (1 if down else -1)   # 1 = trend-side edge
    t = b['t']
    return dict(
        down=down, slow=slow, fallback=bool(fallback), leg_start=t[s0], leg_bars=N - s0,
        at_window_edge=bool(s0 - w0 < 0.05 * (w1 - w0)),
        channel=dict(kind='channel', t1=t[s0], p1=float(mid[s0]), t2=t[N - 1], p2=float(mid[N - 1]),
                     up=float(up_off), dn=float(-up_off), color=AUTO_COLOR, seed=1),
        beyond=float(np.mean(side > 1.0)), poke=float(max(0.0, side.max() - 1.0)),
        move=float(abs(slope) * (N - s0) / W),
        price_on_trend_side=bool((C[-1] < m[-1]) if down else (C[-1] > m[-1])),
    )


def place(b: dict) -> dict | None:
    """The channel for one chart, or None. Picks the direction whose leg fits."""
    cands = [c for c in (_leg(b, True), _leg(b, False)) if c]
    if not cands:
        return None
    cands.sort(key=lambda c: (not c['fallback'], c['price_on_trend_side'], -c['beyond'], c['move']), reverse=True)
    return cands[0]


def scan_ok(c: dict) -> bool:
    return (not c['fallback'] and c['price_on_trend_side'] and c['beyond'] <= SCAN_MAX_BEYOND
            and c['poke'] <= SCAN_MAX_POKE and c['move'] >= SCAN_MIN_MOVE)


# ------------------------------------------------------------------ KV ----

def kv_get(user: str) -> dict:
    for k in range(3):
        out = subprocess.run(['npx', 'wrangler', 'kv', 'key', 'get', user, '--namespace-id', KV_NS, '--remote'],
                             cwd=WORKER_DIR, capture_output=True, text=True).stdout
        if '{' in out:
            b = json.loads(out[out.index('{'):])
            if isinstance(b.get('channels'), dict):
                return b
        time.sleep(3 * (k + 1))
    raise RuntimeError('could not read the sync blob (nothing written)')


def kv_put(user: str, blob: dict, tag: str) -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = _dt.datetime.utcnow().strftime('%Y-%m-%dT%H%M')
    path = os.path.join(OUT_DIR, f'{user}_post_{tag}_{stamp}.json')
    with open(path, 'w') as f:
        json.dump(blob, f)
    subprocess.run(['npx', 'wrangler', 'kv', 'key', 'put', user, '--path', path, '--namespace-id', KV_NS, '--remote'],
                   cwd=WORKER_DIR, check=True, capture_output=True, text=True)
    os.remove(path)


def backup(user: str, blob: dict, tag: str) -> str:
    os.makedirs(OUT_DIR, exist_ok=True)
    stamp = _dt.datetime.utcnow().strftime('%Y-%m-%dT%H%M')
    path = os.path.join(OUT_DIR, f'{user}_backup_before_{tag}_{stamp}.json')
    with open(path, 'w') as f:
        json.dump(blob, f)
    return path


def users_own(drawings: list) -> list:
    return [d for d in drawings or [] if not d.get('seed')]


def has_own_channel(drawings: list) -> bool:
    """The user drew a channel here: theirs is the reference, no auto one beside it."""
    return any(d.get('kind', 'channel') == 'channel' for d in users_own(drawings))


# ------------------------------------------------------------- preview ----

def preview(rows: list, feed: Feed, path: str) -> None:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    n = len(rows)
    cols = 2 if n > 1 else 1
    rws = int(np.ceil(n / cols))
    fig, axs = plt.subplots(rws, cols, figsize=(8 * cols, 3.4 * rws), facecolor='#111', squeeze=False)
    for ax, (name, c) in zip(axs.flat, rows):
        b = feed.bundle(name)
        C = np.array(b['c'], float); H = np.array(b['h'], float); L = np.array(b['l'], float)
        bt = np.array([_ms(x) for x in b['t']]); N = len(C)
        ch = c['channel']
        f1, f2 = bar_index(bt, ch['t1']), bar_index(bt, ch['t2'])
        sl = (ch['p2'] - ch['p1']) / (f2 - f1)
        lo = max(0, int(f1 - 0.3 * (N - f1)))
        x = np.arange(lo, N + int(0.1 * (N - lo)))
        mid = ch['p1'] + (x - f1) * sl
        ax.vlines(np.arange(lo, N), L[lo:], H[lo:], color='#bbb', lw=0.5)
        for off, ls in ((ch['up'], '-'), (ch['dn'], '-'), (0, ':')):
            ax.plot(x, mid + off, color=AUTO_COLOR, lw=1.2, ls=ls)
        for k, col in zip(range(len(b['p'])), ('#3fb950', '#d29922', '#e5534b')):
            mm = pd.Series(C).rolling(int(b['p'][k])).mean().values
            ax.plot(np.arange(lo, N), mm[lo:], color=col, lw=0.9)
        ys = np.r_[L[lo:], H[lo:], mid + ch['up'], mid + ch['dn']]
        ax.set_ylim(np.nanmin(ys), np.nanmax(ys))
        ax.set_facecolor('#111'); ax.tick_params(colors='#777', labelsize=7); ax.set_xticks([])
        tag = ' · slope from price (slow line against)' if c['fallback'] else ''
        ax.set_title(f"{name} {feed.tf} {'DOWN' if c['down'] else 'UP'} · slow MA{c['slow']} · leg from {c['leg_start'][:10]}{tag}",
                     color='#ddd', fontsize=9, loc='left')
    for ax in list(axs.flat)[n:]:
        ax.axis('off')
    plt.tight_layout()
    plt.savefig(path, dpi=80, facecolor='#111')


# ---------------------------------------------------------------- main ----

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('names', nargs='*', help='instrument names as the app shows them (MU, FRA40, BTCUSD)')
    ap.add_argument('--tf', default='30m', help="chart timeframe: '30m' or 'D' (any timeframe the feed has)")
    ap.add_argument('--scan', type=int, default=0, help='pick the N cleanest uptrends and N cleanest downtrends')
    ap.add_argument('--all', action='store_true', help='every instrument the rule finds a leg on')
    ap.add_argument('--apply', action='store_true', help='write to the live app (otherwise preview only)')
    ap.add_argument('--clear-auto', action='store_true', help='remove every auto channel (seed) on --tf')
    ap.add_argument('--user', default='zabs')
    ap.add_argument('--preview', default=os.path.join(os.path.dirname(ROOT), 'auto_channels_preview.png'))
    a = ap.parse_args()

    if a.clear_auto:
        blob = kv_get(a.user)
        hit = [n for n, v in blob['channels'].items() if any(d.get('seed') for d in v.get(a.tf) or [])]
        print('auto channels on', a.tf, ':', hit or 'none')
        if a.apply and hit:
            print('backup:', backup(a.user, blob, 'clear_auto'))
            now = int(time.time() * 1000)
            for n in hit:
                blob['channels'][n][a.tf] = users_own(blob['channels'][n][a.tf])
                blob['channelsMod'][f'{n}|{a.tf}'] = now
            blob['lastModified'] = now
            kv_put(a.user, blob, 'clear_auto')
            print('removed', len(hit))
        return

    feed = Feed(a.tf)
    blob = kv_get(a.user) if (a.apply or a.scan or a.all) else None
    rows = []
    if a.scan:
        found = {True: [], False: []}
        for name in feed.names():
            b = feed.bundle(name)
            if not b or len(b['c']) < 200:
                continue
            if has_own_channel(blob['channels'].get(name, {}).get(a.tf)):
                continue                                          # never beside the user's own channel
            c = place(b)
            if c and scan_ok(c):
                found[c['down']].append((name, c))
        for down in (False, True):
            best = sorted(found[down], key=lambda r: (1 - r[1]['beyond']) * min(r[1]['move'], 1.5) - 0.5 * r[1]['poke'],
                          reverse=True)[:a.scan]
            rows += best
    nofit, broken = [], []
    if a.all:
        for name in feed.names():
            b = feed.bundle(name)
            if not b or len(b['c']) < 200:
                continue
            if has_own_channel(blob['channels'].get(name, {}).get(a.tf)):
                continue
            c = place(b)
            if not c:
                nofit.append(name)
            elif not c['price_on_trend_side'] or c['poke'] > ALL_MAX_POKE:
                broken.append(name)                               # price is through the slow line: no trend by the rule
            else:
                rows.append((name, c))
        print(f'{len(rows)} charts get a channel; {len(broken)} skipped (price through the slow line = trend broken '
              f'by the rule); {len(nofit)} have no leg that fits')
    for name in a.names:
        b = feed.bundle(name)
        if not b:
            print(f'{name}: not in the {a.tf} feed'); continue
        c = place(b)
        if not c:
            print(f'{name}: no leg fits the rule (no clear trend between {LEG_MIN}x and {LEG_MAX}x the slow period back)'); continue
        rows.append((name, c))

    for name, c in (rows if len(rows) <= 40 else []):
        warn = []
        if c['fallback']: warn.append('slow line against the leg -> slope from price')
        if not c['price_on_trend_side']: warn.append('price is on the far side of the slow line')
        if c['at_window_edge']: warn.append('leg start is at the edge of the search window (trend may be older)')
        if c['poke'] > SCAN_MAX_POKE: warn.append(f"price pokes {c['poke']:.0%} of the width past the edge")
        print(f"{name:10s} {'DOWN' if c['down'] else 'UP  '} slow MA{c['slow']:<5d} leg from {c['leg_start']} "
              f"({c['leg_bars']} bars){'  ! ' + '; '.join(warn) if warn else ''}")
    if not rows:
        return
    if len(rows) <= 40:
        preview(rows, feed, a.preview)
        print('preview:', a.preview)

    if not a.apply:
        print('(preview only — add --apply to put these in the app)')
        return
    blob = kv_get(a.user)                                          # fresh, right before the write
    print('backup:', backup(a.user, blob, 'auto_channels'))
    now = int(time.time() * 1000)
    made = _dt.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S.000Z')
    written, skipped = [], []
    for name, c in rows:
        cur = blob['channels'].setdefault(name, {}).get(a.tf) or []
        if has_own_channel(cur) and not a.names:
            skipped.append(name); continue
        ch = dict(c['channel'], made=made)
        blob['channels'][name][a.tf] = users_own(cur) + [ch]          # an older auto channel is replaced
        blob['channelsMod'][f'{name}|{a.tf}'] = now
        written.append(name)
    blob['lastModified'] = now
    kv_put(a.user, blob, 'auto_channels')
    back = kv_get(a.user)
    ok = [n for n in written if any(d.get('seed') for d in back['channels'][n][a.tf])]
    print(f'written {len(ok)}/{len(written)} on {a.tf}: {", ".join(ok)}' + (f' | skipped (yours): {skipped}' if skipped else ''))


if __name__ == '__main__':
    main()
