"""Grade the user's BUY / SELL view markers (2026-09-30).

The user places green Buy / red Sell markers on any chart (app drawing tool,
kind 'entry' with `side`, `made` = when it was placed, `tf` = which chart).
They sync to the Worker's KV under the user's key. This reads them there (the
local wrangler login — no app password involved), and scores every call against
what price did next:

  move    direction-adjusted % move from the marked price at +1d, +1w, +1m
  atr     the same in Daily ATR(14) units, so FX and crypto compare
  base    how often ANY start on this instrument moved that way over the same
          horizon (last 2 years of daily closes) — the honest yardstick
  first   which came first: price reaching 2 ATR in the call's favour or 2 ATR
          against (a 1:1 test at a normal swing size)

A marker whose price bar is more than a day older than when it was placed is a
HINDSIGHT mark (drawn back in history) and is reported apart: those can't be
graded as calls.

  python3 research/grade_views.py            # user zabs
  python3 research/grade_views.py hemi
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings('ignore')
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from data_fetcher import _cache_path, drop_unfinished_daily, load_1h, scale_daily  # noqa: E402
from instruments import load_instruments                                         # noqa: E402

KV_NS = '567b56a128dd4aee9c861d7653846acb'
WORKER_DIR = os.path.join(os.path.dirname(HERE), 'webapp', 'sync-worker')
HORIZONS = (('1d', pd.Timedelta(days=1)), ('1w', pd.Timedelta(days=7)), ('1m', pd.Timedelta(days=30)))
STOP_ATR = 2.0


def read_blob(user: str) -> dict:
    out = subprocess.run(['npx', 'wrangler', 'kv', 'key', 'get', user, '--namespace-id', KV_NS, '--remote'],
                         cwd=WORKER_DIR, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def view_marks(blob: dict) -> list[dict]:
    ch = blob.get('channels') or {}
    if isinstance(ch, str):
        ch = json.loads(ch)
    marks = []
    for name, per in ch.items():
        if not isinstance(per, dict):
            continue
        for tf, lst in per.items():
            for d in lst if isinstance(lst, list) else []:
                if isinstance(d, dict) and d.get('kind') == 'entry' and d.get('side') in ('buy', 'sell'):
                    marks.append({'name': name, 'chart': d.get('tf') or tf, 'side': d['side'],
                                  't': pd.Timestamp(str(d['t'])[:16]), 'p': float(d['p']),
                                  'made': pd.Timestamp(d['made']) if d.get('made') else None})
    return sorted(marks, key=lambda m: m['t'])


def daily_frame(ticker: str) -> pd.DataFrame | None:
    path = _cache_path(ticker)
    if not os.path.exists(path):
        return None
    df = scale_daily(ticker, drop_unfinished_daily(pd.read_parquet(path)))
    if df.index.tz is not None:
        df.index = df.index.tz_localize(None)
    tr = pd.concat([df['High'] - df['Low'], (df['High'] - df['Close'].shift()).abs(),
                    (df['Low'] - df['Close'].shift()).abs()], axis=1).max(axis=1)
    df['atr'] = tr.rolling(14).mean()
    return df


def path_after(ticker: str, t: pd.Timestamp, daily: pd.DataFrame) -> pd.Series:
    """Closes after the mark: hourly where the 1H feed reaches, daily beyond."""
    parts = []
    try:
        h = load_1h(ticker)
        if h is not None and len(h):
            h = h.copy()
            if h.index.tz is not None:
                h.index = h.index.tz_convert('UTC').tz_localize(None)
            parts.append(h['Close'][h.index > t])
    except Exception:
        pass
    d = daily['Close'][daily.index > t.normalize()]
    if parts and len(parts[0]):
        d = d[d.index > parts[0].index[-1].normalize()]
        parts.append(d)
        return pd.concat(parts).sort_index()
    return d


def base_rate(daily: pd.DataFrame, days: int, side: int) -> float | None:
    c = daily['Close'].dropna().tail(520)
    if len(c) <= days + 20:
        return None
    fwd = (c.shift(-max(1, round(days * 5 / 7))) / c - 1).dropna()
    return float(((fwd * side) > 0).mean() * 100)


def main(user: str = 'zabs') -> None:
    marks = view_marks(read_blob(user))
    tick = {i['name']: i['ticker'] for i in load_instruments()}
    if not marks:
        print(f'No Buy/Sell markers found for {user}.')
        return
    now = pd.Timestamp.utcnow().tz_localize(None)
    rows = []
    for m in marks:
        tk = tick.get(m['name'])
        daily = daily_frame(tk) if tk else None
        if daily is None:
            continue
        side = 1 if m['side'] == 'buy' else -1
        hind = m['made'] is not None and (m['made'] - m['t']) > pd.Timedelta(days=1)
        prior = daily[daily.index <= m['t'].normalize()]
        atr = float(prior['atr'].iloc[-1]) if len(prior) and pd.notna(prior['atr'].iloc[-1]) else None
        path = path_after(tk, m['t'], daily)
        r = {'name': m['name'], 'chart': m['chart'], 'side': m['side'].upper(), 'at': m['t'],
             'price': m['p'], 'hindsight': hind}
        for h, dt in HORIZONS:
            seg = path[path.index <= m['t'] + dt]
            done = m['t'] + dt <= now and len(seg)
            mv = (seg.iloc[-1] / m['p'] - 1) * 100 * side if done else None
            r[h] = mv
            r[h + '_atr'] = (mv / 100 * m['p'] / atr) if (mv is not None and atr) else None
            r[h + '_base'] = base_rate(daily, dt.days, side)
        first = 'open'
        if atr and len(path):
            fav = (path - m['p']) * side
            win = fav[fav >= STOP_ATR * atr]
            loss = fav[fav <= -STOP_ATR * atr]
            tw = win.index[0] if len(win) else None
            tl = loss.index[0] if len(loss) else None
            if tw is not None and (tl is None or tw < tl):
                first = 'target'
            elif tl is not None:
                first = 'stop'
        r['first_2atr'] = first
        rows.append(r)

    df = pd.DataFrame(rows)
    pd.set_option('display.width', 200)
    fmt = lambda v: '' if v is None or (isinstance(v, float) and np.isnan(v)) else f'{v:+.2f}'  # noqa: E731
    print(f'\n{len(df)} markers for {user} ({int(df.hindsight.sum())} drawn back in history)\n')
    for _, r in df.iterrows():
        tag = ' (hindsight)' if r.hindsight else ''
        print(f"{r['at']:%Y-%m-%d %H:%M}  {r['name']:<12} {r['chart']:<4} {r['side']:<4} @ {r['price']:<10.5g}"
              f"  1d {fmt(r['1d']):>6}%  1w {fmt(r['1w']):>6}%  1m {fmt(r['1m']):>6}%   2ATR first: {r['first_2atr']}{tag}")
    live = df[~df.hindsight]
    for h, _ in HORIZONS:
        g = live[live[h].notna()]
        if len(g):
            right = (g[h] > 0).mean() * 100
            print(f'\n{h}: {len(g)} graded live calls, {right:.0f}% went your way '
                  f'(any start on the same instruments: {g[h + "_base"].mean():.0f}%), '
                  f'average {g[h + "_atr"].mean():+.2f} ATR')
    t = live['first_2atr'].value_counts().to_dict()
    print(f"\n2 ATR target before 2 ATR stop: {t.get('target', 0)} · stop first: {t.get('stop', 0)} · still open: {t.get('open', 0)}")


if __name__ == '__main__':
    main(*(sys.argv[1:2] or ['zabs']))
