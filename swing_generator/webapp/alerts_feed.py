"""
alerts_feed.py — the Alerts tab's data (2026-09-27, replaced the Signals tab).

Built at publish from the SAME chart bundles the Charts tab draws, so an alert
is exactly a marker you can see on a chart:

    B1 / S1   1H and Daily fires

X (a close through a Daily MA that held) and T (a touch that did not) were read
from the 30m bundle and went with it on 2026-11-11 — see _events_for. The
direction and `stats` notes below still describe them for when they return.

Nothing here needs the user to report anything. Each alert carries what price
did AFTER it — 1 hour, 1 day and 1 week later, in the alert's own direction —
and `stats` sums every alert inside the bundles' history the same way, next to
a plain baseline: how often ANY bar of that timeframe moved that way over the
same horizon. That is the honest reading: a follow-through rate only means
something against what price did anyway.

Direction per alert: B1 / X up = +1, S1 / X down = -1. A touch is read as a
test of the MA: it "held" when price is back on the side it came from, so a
touch from above (`xm` dir 'dn') is +1.

Output (alerts.json):
    {'generated_at', 'ev': [[name, tf, kind, period, dir, 'YYYY-MM-DD HH:MM',
                              price, o1h, o1d, o1w], ...],
     'stats': {'<tf>|<kind>': {'n': int, 'h': {'1h': [pct_right, median, base], ...}}}}
    o* = % move since the alert in its direction (null = not reached yet).
"""
from __future__ import annotations

import bisect
from datetime import datetime, timedelta, timezone

import pandas as pd

HORIZONS = (('1h', timedelta(hours=1)), ('1d', timedelta(days=1)), ('1w', timedelta(days=7)))
# Recent enough to list: intraday alerts from the last 5 calendar days, Daily
# fires from the last 10 (a weekend or holiday must not empty the tab).
RECENT_INTRADAY = timedelta(days=5)
RECENT_DAILY    = timedelta(days=10)


def _ts(v) -> datetime:
    return pd.Timestamp(str(v)[:16]).to_pydatetime()


def _r(x, d=2):
    return None if x is None else round(float(x), d)


class _Series:
    """A bundle's closes on a time axis, for 'price N hours after'."""

    def __init__(self, b: dict, daily: bool):
        self.daily = daily
        self.t = [_ts(t) for t in b['t']]
        self.c = b['c']

    def after(self, i: int, dt: timedelta):
        """Close of the first bar at or after bar i's time + dt (Daily: +1 bar
        for a day, +5 bars for a week; no 1h). None if not reached yet."""
        if self.daily:
            if dt < timedelta(days=1):
                return None
            j = i + (1 if dt <= timedelta(days=1) else 5)
        else:
            j = bisect.bisect_left(self.t, self.t[i] + dt, lo=i + 1)
        while j < len(self.c) and self.c[j] is None:
            j += 1
        return self.c[j] if j < len(self.c) else None


def _events_for(name: str, bundles: dict, d_fires: list) -> list:
    """Every alert in this instrument's bundles: (tf, kind, period, dir, i, series)."""
    out = []
    b1h, bd = bundles.get('1H'), bundles.get('D')
    for tf, b in (('1H', b1h),):
        if not b:
            continue
        s = _Series(b, False)
        for i, code in b.get('sg') or []:
            out.append((tf, code, 0, 1 if code == 'B1' else -1, i, s))
    # Daily-MA touches/crosses (X / T) were read from the 30m bundle and tagged
    # '30m'. The app has listed only 1H and Daily alerts since 2026-11-04, so
    # they had been built and never shown; they went with the 30m chart on
    # 2026-11-11. The 1H chart still DRAWS its Daily-MA marks (`xm`). To list
    # them as alerts again, read b1h['xm'] here with XM_HOLD_BY_TF['1H'] and
    # time each at the bar it could first be known (cross: the confirming bar).
    if bd and d_fires:
        s = _Series(bd, True)
        pos = {str(t)[:10]: i for i, t in enumerate(bd['t'])}
        for date, code in d_fires:
            i = pos.get(date)
            if i is not None:
                out.append(('D', code, 0, 1 if code == 'B1' else -1, i, s))
    return out


def _move(s: _Series, i: int, dr: int, dt: timedelta):
    p0, p1 = s.c[i], s.after(i, dt)
    if p0 in (None, 0) or p1 is None:
        return None
    return dr * (p1 / p0 - 1) * 100


def _median(v):
    v = sorted(v)
    n = len(v)
    return None if not n else (v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2)


def build_alerts(built: dict, d_fires: dict, now: datetime | None = None) -> dict:
    """built = {'1H': {name: bundle}, 'D': {...}} with marks attached."""
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    names = set()
    for tf in ('1H', 'D'):
        names |= set(built.get(tf, {}))

    ev, acc = [], {}
    base = {}   # (tf, h) -> [n_up, n_down, n]  over every bar: the "anyway" rate
    for tf in ('1H', 'D'):
        for b in built.get(tf, {}).values():
            s = _Series(b, tf == 'D')
            step = 1 if tf == 'D' else 4   # a sample of bars is plenty
            for i in range(0, len(s.c), step):
                for h, dt in HORIZONS:
                    m = _move(s, i, 1, dt)
                    if m is None:
                        continue
                    k = base.setdefault((tf, h), [0, 0, 0])
                    k[0] += m > 0
                    k[1] += m < 0
                    k[2] += 1

    for name in sorted(names):
        bundles = {tf: built.get(tf, {}).get(name) for tf in ('1H', 'D')}
        for tf, kind, p, dr, i, s in _events_for(name, bundles, d_fires.get(name) or []):
            moves = {h: _move(s, i, dr, dt) for h, dt in HORIZONS}
            a = acc.setdefault(f'{tf}|{kind}', {'n': 0, 'h': {h: [] for h, _ in HORIZONS}, 'dir': []})
            a['n'] += 1
            a['dir'].append(dr)
            for h, m in moves.items():
                if m is not None:
                    a['h'][h].append((m, dr))
            t = s.t[i]
            if now - t <= (RECENT_DAILY if tf == 'D' else RECENT_INTRADAY):
                ev.append([name, tf, kind, p, dr, t.strftime('%Y-%m-%d %H:%M'),
                           _r(s.c[i], 6), *(_r(moves[h]) for h, _ in HORIZONS)])

    stats = {}
    for key, a in acc.items():
        tf = key.split('|')[0]
        hs = {}
        for h, vals in a['h'].items():
            if not vals:
                continue
            right = sum(m > 0 for m, _ in vals) / len(vals) * 100
            # Baseline in the SAME mix of directions: how often any bar of this
            # timeframe moved up (for the up alerts) / down (for the down ones).
            bk = base.get((tf, h))
            if bk and bk[2]:
                up, dn = bk[0] / bk[2], bk[1] / bk[2]
                bl = sum(up if d > 0 else dn for _, d in vals) / len(vals) * 100
            else:
                bl = None
            hs[h] = [round(right, 1), _r(_median([m for m, _ in vals])), _r(bl, 1), len(vals)]
        stats[key] = {'n': a['n'], 'h': hs}

    ev.sort(key=lambda e: e[5], reverse=True)
    return {'generated_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'), 'ev': ev, 'stats': stats}
