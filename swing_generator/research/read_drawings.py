"""Read every drawing the user places, to learn how they read a chart (2026-09-30).

User: "remove all drawings and start afresh ... then start reading all the
drawings and my entries" — after "read the way I place the channel, because you
might get the logic and place for me very well soon". Every drawing was wiped
on 2026-09-30, so everything here was placed by the user from then on.

Per drawing it reports what can be measured from the chart it sits on:

  channel   slope (% per day), width in Daily ATR, whether each anchor sits on
            a swing high/low of that chart (a pivot within +-5 bars and 0.3 ATR),
            how many bars touched the upper / lower edge, where price is now
            inside it (0% = lower edge, 100% = upper)
  ladder    the span in ATR, where its 0% and 100% lines sit (swing high/low?)
  hline     distance from the close when drawn, in ATR; is it on a swing level
  trend     slope, and whether both ends sit on swings
  circle    what it rings: the bar range and dates inside it
  entry     Buy/Sell markers are graded by research/grade_views.py (run it too)

Provenance (app.js v467+): `made` = when drawn, `ed` = last moved; `tf` of the
chart it lives on. Anything without `made` predates the fresh start.

  python3 research/read_drawings.py            # user zabs
  python3 research/read_drawings.py --json     # rows as JSON for further study
"""
from __future__ import annotations

import json
import os
import sys
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings('ignore')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from grade_views import KV_NS, WORKER_DIR, daily_frame   # noqa: E402
from instruments import load_instruments                 # noqa: E402

PIVOT_BARS = 5        # a swing high/low: the extreme of +-5 bars
PIVOT_ATR = 0.3       # an anchor within 0.3 ATR of that extreme counts as "on" it
TOUCH_ATR = 0.25      # a bar within 0.25 ATR of a channel edge "touched" it


def read_blob(user: str) -> dict:
    import subprocess
    out = subprocess.run(['npx', 'wrangler', 'kv', 'key', 'get', user, '--namespace-id', KV_NS, '--remote'],
                         cwd=WORKER_DIR, capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.index('{'):])     # wrangler can print a notice first


def frame_for(ticker: str, tf: str) -> pd.DataFrame | None:
    """The bars of the chart the drawing lives on (30m or Daily)."""
    if tf == '30m':
        try:
            from data_fetcher import load_5m
            from main import _frame_30m
            f = _frame_30m(load_5m(ticker))
            if f is not None and len(f):
                if f.index.tz is not None:
                    f.index = f.index.tz_convert('UTC').tz_localize(None)
                return f
        except Exception:
            return None
        return None
    return daily_frame(ticker)


def bar_at(f: pd.DataFrame, t) -> int | None:
    """Index of the bar a drawing's date falls on (None if outside the data)."""
    ts = pd.Timestamp(str(t)[:16])
    if ts < f.index[0] or ts > f.index[-1] + pd.Timedelta(days=3):
        return None
    return int(min(f.index.searchsorted(ts, side='right') - 1, len(f) - 1))


def on_swing(f: pd.DataFrame, i: int | None, p: float, atr: float) -> str:
    """'high' / 'low' when (i, p) sits on a swing extreme, else ''."""
    if i is None or not atr:
        return ''
    a, z = max(0, i - PIVOT_BARS), min(len(f), i + PIVOT_BARS + 1)
    hi, lo = float(f['High'].iloc[a:z].max()), float(f['Low'].iloc[a:z].min())
    if abs(p - hi) <= PIVOT_ATR * atr:
        return 'high'
    if abs(p - lo) <= PIVOT_ATR * atr:
        return 'low'
    return ''


def daily_atr(ticker: str, t) -> float | None:
    d = daily_frame(ticker)
    if d is None:
        return None
    prior = d[d.index <= pd.Timestamp(str(t)[:10])]
    v = prior['atr'].iloc[-1] if len(prior) else d['atr'].iloc[-1]
    return float(v) if pd.notna(v) else None


def read_channel(d: dict, f: pd.DataFrame, atr: float) -> dict:
    i1, i2 = bar_at(f, d['t1']), bar_at(f, d['t2'])
    p1, p2 = float(d['p1']), float(d['p2'])
    up, dn = float(d.get('up', 0)), float(d.get('dn', 0))
    out = {'width_atr': round((up - dn) / atr, 2) if atr else None}
    days = (pd.Timestamp(str(d['t2'])[:16]) - pd.Timestamp(str(d['t1'])[:16])).total_seconds() / 86400
    out['slope_pct_day'] = round((p2 / p1 - 1) * 100 / days, 3) if days and p1 else None
    # Anchors: the spine runs p1 -> p2; the edges sit up/dn above and below it.
    out['anchor1'] = on_swing(f, i1, p1 + up, atr) or on_swing(f, i1, p1 + dn, atr) or on_swing(f, i1, p1, atr)
    out['anchor2'] = on_swing(f, i2, p2 + up, atr) or on_swing(f, i2, p2 + dn, atr) or on_swing(f, i2, p2, atr)
    if i1 is not None and i2 is not None and i2 != i1:
        k = np.arange(len(f))
        spine = p1 + (p2 - p1) * (k - i1) / (i2 - i1)
        lo_i = max(0, min(i1, i2))
        seg = slice(lo_i, len(f))
        hi_touch = np.abs(f['High'].values[seg] - (spine[seg] + up)) <= TOUCH_ATR * atr
        lo_touch = np.abs(f['Low'].values[seg] - (spine[seg] + dn)) <= TOUCH_ATR * atr
        out['touches_upper'], out['touches_lower'] = int(hi_touch.sum()), int(lo_touch.sum())
        last = float(f['Close'].iloc[-1]); s = spine[-1]
        out['price_in_channel_pct'] = round((last - (s + dn)) / (up - dn) * 100) if up != dn else None
    return out


def read_one(name: str, tf: str, d: dict, ticker: str) -> dict:
    row = {'name': name, 'chart': d.get('tf') or tf, 'kind': d.get('kind'),
           'made': d.get('made'), 'moved': d.get('ed')}
    f = frame_for(ticker, row['chart'])
    atr = daily_atr(ticker, d.get('made') or pd.Timestamp.utcnow())
    if f is None or not len(f) or not atr:
        row['note'] = 'no bars for this chart'
        return row
    k = row['kind']
    if k == 'channel':
        row.update(read_channel(d, f, atr))
    elif k == 'trend':
        i1, i2 = bar_at(f, d['t1']), bar_at(f, d['t2'])
        row.update(anchor1=on_swing(f, i1, float(d['p1']), atr), anchor2=on_swing(f, i2, float(d['p2']), atr))
    elif k == 'ladder':
        lo, hi = sorted((float(d['p1']), float(d['p4'])))
        span = (hi - lo) * 3                     # p1 and p4 are lines 1 and 4 of 10 (step = (p4-p1)/3)
        row.update(span_atr=round(span / atr, 2), stacks_up=d.get('up', 0), stacks_down=d.get('down', 0))
    elif k == 'hline':
        c = float(f['Close'].iloc[-1])
        row.update(dist_atr=round((float(d['p']) - c) / atr, 2))
    elif k == 'circle':
        row.update(from_=str(d.get('t1'))[:16], to=str(d.get('t2'))[:16],
                   lo=round(min(float(d['p1']), float(d['p2'])), 5), hi=round(max(float(d['p1']), float(d['p2'])), 5))
    elif k == 'entry' and d.get('side'):
        row.update(side=d['side'], price=d.get('p'), at=str(d.get('t'))[:16], note='graded by grade_views.py')
    return row


def main(user: str = 'zabs', as_json: bool = False) -> None:
    blob = read_blob(user)
    tick = {i['name']: i['ticker'] for i in load_instruments()}
    rows = []
    for name, per in (blob.get('channels') or {}).items():
        if not isinstance(per, dict):
            continue
        for tf, lst in per.items():
            for d in lst if isinstance(lst, list) else []:
                if isinstance(d, dict) and d.get('kind') and name in tick:
                    rows.append(read_one(name, tf, d, tick[name]))
    if as_json:
        print(json.dumps(rows, default=str, indent=1))
        return
    if not rows:
        print(f'No drawings yet for {user} (all were wiped 2026-09-30 for a fresh start).')
        return
    df = pd.DataFrame(rows).sort_values(['made', 'name'], na_position='first')
    with pd.option_context('display.max_rows', 500, 'display.width', 220, 'display.max_columns', 30):
        print(df.to_string(index=False))
    ch = df[df['kind'] == 'channel']
    if len(ch):
        print(f"\nChannels: {len(ch)} | median width {ch['width_atr'].median()} ATR | "
              f"anchors on swings: {(ch['anchor1'] != '').mean():.0%} / {(ch['anchor2'] != '').mean():.0%}")
    print(df['kind'].value_counts().to_string())


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    main(args[0] if args else 'zabs', as_json='--json' in sys.argv)
