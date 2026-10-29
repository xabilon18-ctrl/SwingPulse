"""Read every chart frame the user SAVES, to learn how they frame a chart (2026-10-29).

User: "I need you to look at these savings that I'm doing ... particularly the
ones where I click save ... to a point where when I come around again ... can
you put all charts in a range similar to the one I save? I need you to do
that." A save (app.js v553+) is the exact frame on screen; this reports, per
saved chart and as medians per timeframe and per timeframe x asset class:

  shown     candles in view                  span   calendar days they cover
  blank     share of the window left empty on the right (the future)
  height    price window top-bottom, as % of the close when saved
  close at  where the close sat in the window (0% = bottom, 100% = top)
  where     card or full screen

Those medians are what "a range similar to the one I save" means: the
opening frames (reelStockView / REEL_*_VIEW in app.js) can be set from them.
Version 1 views (saved before v553, relative to the newest bar) are listed
but left out of the medians.

Sources, either one:
  python3 research/read_views.py --file SwingPulse-zabs-2026-10-29.json
      the app's Saved work -> Download backup (includes every saved view)
  python3 research/read_views.py [--user zabs]
      the synced copy in the sync Worker's KV (needs wrangler with KV read)
  add --json for the rows as JSON.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from statistics import median

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

from instruments import asset_class_of, load_instruments   # noqa: E402


def load_views(args) -> dict:
    if args.file:
        with open(args.file, encoding='utf-8') as f:
            blob = json.load(f)
        return (blob.get('data') or blob).get('views') or {}
    from read_drawings import read_blob
    return read_blob(args.user).get('views') or {}


def _ts(v):
    try:
        return datetime.fromisoformat(str(v).strip()[:16].replace(' ', 'T'))
    except ValueError:
        return None


def rows_of(views: dict) -> list[dict]:
    classes = {i['name']: asset_class_of(i['group']) for i in load_instruments(include_retired=True)}
    rows = []
    for key, v in sorted(views.items()):
        if not isinstance(v, dict) or '|' not in key:
            continue
        name, tf = key.rsplit('|', 1)
        row = {'name': name, 'tf': tf, 'class': classes.get(name, '?'), 'version': v.get('v', 1)}
        if v.get('v') != 2:
            row.update(bars=v.get('bars'), pan=v.get('pan'))
            rows.append(row)
            continue
        slots, future = v.get('slots') or 0, v.get('future') or 0
        shown = max(1, slots - future)
        t0, t1 = _ts(v.get('start')), _ts(v.get('end'))
        span = (t1 - t0).total_seconds() / 86400 if t0 and t1 else None
        lo, hi, close = v.get('lo'), v.get('hi'), v.get('close')
        row.update(
            start=v.get('start'), end=v.get('end'), slots=slots, shown=shown,
            span_days=round(span, 1) if span is not None else None,
            blank_pct=round(100 * future / slots, 1) if slots else None,
            height_pct=round(100 * (hi - lo) / close, 2) if close and hi is not None and lo is not None else None,
            close_at_pct=round(100 * (close - lo) / (hi - lo), 1) if close and hi and lo is not None and hi > lo else None,
            where=v.get('where'),
            # The user's time zone (CLAUDE.md): SAST, UTC+2.
            saved=(datetime.fromtimestamp(v['savedAt'] / 1000, timezone.utc) + timedelta(hours=2)).strftime('%Y-%m-%d %H:%M SAST') if v.get('savedAt') else None,
        )
        rows.append(row)
    return rows


METRICS = ('shown', 'span_days', 'blank_pct', 'height_pct', 'close_at_pct')


def medians(rows: list[dict], key) -> dict:
    groups: dict = {}
    for r in rows:
        if r['version'] == 2:
            groups.setdefault(key(r), []).append(r)
    out = {}
    for g, rs in sorted(groups.items()):
        out[g] = {'n': len(rs)}
        for m in METRICS:
            vals = [r[m] for r in rs if r.get(m) is not None]
            out[g][m] = round(median(vals), 1) if vals else None
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--file', help='a Saved work backup downloaded from the app')
    ap.add_argument('--user', default='zabs')
    ap.add_argument('--json', action='store_true')
    args = ap.parse_args()
    rows = rows_of(load_views(args))
    by_tf = medians(rows, lambda r: r['tf'])
    by_tf_class = medians(rows, lambda r: f"{r['tf']} {r['class']}")
    if args.json:
        print(json.dumps({'views': rows, 'by_tf': by_tf, 'by_tf_class': by_tf_class}, indent=2))
        return
    print(f'{len(rows)} saved views ({sum(r["version"] == 2 for r in rows)} exact frames)\n')
    hdr = f'{"chart":<22}{"tf":>4} {"class":<10}{"shown":>6}{"days":>8}{"blank%":>8}{"height%":>9}{"close@%":>9}  where  saved'
    print(hdr)
    for r in rows:
        if r['version'] != 2:
            print(f'{r["name"]:<22}{r["tf"]:>4} {r["class"]:<10}  (old relative view: {r.get("bars")} bars, pan {r.get("pan")})')
            continue
        f = lambda v: '' if v is None else v   # noqa: E731
        print(f'{r["name"]:<22}{r["tf"]:>4} {r["class"]:<10}{f(r["shown"]):>6}{f(r["span_days"]):>8}{f(r["blank_pct"]):>8}'
              f'{f(r["height_pct"]):>9}{f(r["close_at_pct"]):>9}  {f(r["where"]):<6} {f(r["saved"])}')
    for title, table in (('By timeframe', by_tf), ('By timeframe and class', by_tf_class)):
        print(f'\n{title} (medians)')
        for g, m in table.items():
            print(f'  {g:<18} n={m["n"]:<3} shown {m["shown"]}  days {m["span_days"]}  blank {m["blank_pct"]}%'
                  f'  height {m["height_pct"]}%  close at {m["close_at_pct"]}%')


if __name__ == '__main__':
    main()
