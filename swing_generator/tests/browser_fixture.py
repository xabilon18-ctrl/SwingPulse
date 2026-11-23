"""Make a deterministic market fixture for the real app browser smoke test."""
import json
from pathlib import Path
import sys
from unittest.mock import patch

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp'), str(ROOT / 'tests'), str(ROOT / 'tools')]
from hourly_test import hourly_frame
import main
import chart_feed
import publish
import publish_htf

out = ROOT / 'webapp' / 'publish' / 'browser-data'
out.mkdir(parents=True, exist_ok=True)
h1 = hourly_frame()
d = h1.copy()
d.index = pd.bdate_range(end=pd.Timestamp.now('UTC').tz_localize(None).normalize() - pd.Timedelta(days=1), periods=len(d))
meta = {'name': 'TEST', 'group': 'US Equity', 'sector': 'Technology', 'industry': 'Software'}
row, trends = main.process_instrument('TEST', d, meta, d.index[-1].date())
h_state = main._compute_1h_state(h1, 'Equity', h1.index[-1].date())
row.update(main._live_intraday(h_state, prefix='h1_'))
fires = out / 'h1-fires.json'
fires.write_text(json.dumps({'TEST': h_state[2]}))
with patch.object(chart_feed, 'load_1h', return_value=h1), \
     patch.object(chart_feed, 'build_daily', return_value={**chart_feed._bundle(d, [50, 250, 500], '%Y-%m-%d', bars=1000, context_tf='D'), 'references': chart_feed.reference_history(d)}):
    chart_feed.build_chart_feed(str(out), str(out), {'TEST': 'TEST'}, h1_fires_path=str(fires))
# Monthly as tools/publish_htf.py publishes it, from a deeper history than the
# Daily bundle carries (~25 years). There is no Weekly chart (removed
# 2026-11-16).
back = 1 + 0.3 * np.sin((np.arange(5000) - 5000) / 300)   # meets the fixture's first close
pc = float(d['Close'].iloc[0]) * back
deep = pd.concat([pd.DataFrame({'Open': pc, 'High': pc * 1.01, 'Low': pc * 0.99, 'Close': pc, 'Volume': 1000},
                               index=pd.bdate_range(end=d.index[0] - pd.Timedelta(days=1), periods=len(pc))), d])
# Yearly (2026-11-23) rides with it, from the same history: candles only.
built, _ = publish_htf.build({'TEST': 'TEST'}, ['M', 'Y'], lambda t: (deep, 'max'), workers=1)
publish_htf.write(out, 'M', built['M'], ['TEST'], str(d.index[-1].date()))
publish_htf.write(out, 'Y', built['Y'], ['TEST'], str(d.index[-1].date()))
# Active at last close (activity_feed): TEST's sector busy on Day and Week,
# quiet on Month, so the strip shows two rows.
for tf, period, hot in (('D', str(d.index[-1].date()), True), ('W', '2026-10-19', True), ('M', '2026-09-01', False)):
    (out / 'activity').mkdir(exist_ok=True)
    (out / 'activity' / f'{tf}.json').write_text(json.dumps({
        'tf': tf, 'period': period, 'active': int(hot), 'market_wide': False,
        'sectors': [{'sector': 'Technology', 'date': period, 'members': 9, 'counted': 9, 'big': 4,
                     'up': 4, 'down': 0, 'z': 2.4 if hot else 0.1, 'hot': hot, 'tilt': 'up',
                     'top': [['TEST', 3.1, 2.6]], 'order': ['TEST'], 'history_bars': 300}]}))
# Big-fund 13F moves (holdings_feed.py) on TEST's Monthly chart: two funds
# sold in Q3 2026 (one red marker, "2"), one bought in Q2 (one green).
(out / 'holdings.json').write_text(json.dumps({
    'built': '2026-11-20', 'since': '2013-06-30', 'latest': '2026-09-30',
    'rules': {'min_w': 0.5, 'min_chg': 25},
    'funds': {'duq': {'n': 'Duquesne Family Office', 'who': 'Stanley Druckenmiller'},
              'tgr': {'n': 'Tiger Global', 'who': 'Chase Coleman'},
              'app': {'n': 'Appaloosa', 'who': 'David Tepper'}},
    'stocks': {'TEST': [
        {'q': '2026-06-30', 'f': 'app', 'a': 'new', 'sh': 2_000_000, 'was': 0, 'w': 2.1, 'wp': 0.0,
         'usd': 250_000_000, 'filed': '2026-08-14'},
        {'q': '2026-09-30', 'f': 'duq', 'a': 'cut', 'sh': 456_000, 'was': 1_200_000, 'w': 1.6, 'wp': 4.1,
         'usd': -120_000_000, 'filed': '2026-11-14'},
        {'q': '2026-09-30', 'f': 'tgr', 'a': 'exit', 'sh': 0, 'was': 3_400_000, 'w': 0.0, 'wp': 2.0,
         'usd': -410_000_000, 'filed': '2026-11-16'}]},
    'indices': {}}))
stamp = pd.Timestamp.now('UTC').strftime('%Y-%m-%dT%H:%M:%SZ')
summary = publish.build_summary(pd.DataFrame([row]), str(d.index[-1].date()))
summary['fetched_at'] = stamp
for filename, payload in {
    'signals.json': {'data': [row], 'date': str(d.index[-1].date())},
    'summary.json': summary, 'status.json': {'state': 'ok', 'at': stamp},
    'ai-instruments.json': [],
    'trends.json': {'TEST': trends}, 'names.json': {'TEST': 'Test instrument'},
}.items():
    (out / filename).write_text(json.dumps(payload))
