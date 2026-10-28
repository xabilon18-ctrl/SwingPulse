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
h4 = main._frame_4h(hourly_frame(12000))
h4_bundle = chart_feed._bundle(h4, [50, 250, 500], '%Y-%m-%d %H:%M', bars=len(h4) - 500, context_tf='4H')
d = h1.copy()
d.index = pd.bdate_range(end=pd.Timestamp.utcnow().tz_localize(None).normalize() - pd.Timedelta(days=1), periods=len(d))
m30 = h1.copy()
m30.index = pd.date_range(end=h1.index[-1], periods=len(h1), freq='30min')
meta = {'name': 'TEST', 'group': 'US Equity', 'sector': 'Technology', 'industry': 'Software'}
row, trends = main.process_instrument('TEST', d, meta, d.index[-1].date())
h_state = main._compute_1h_state(h1, 'Equity', h1.index[-1].date())
m_state = main._compute_30m_state(None, 'Equity', h1.index[-1].date())
row.update(main._live_intraday(h_state, prefix='h1_'))
row.update(main._live_intraday(main._compute_4h_state(hourly_frame(12000), 'Equity', h1.index[-1].date()),prefix='h4_'))
row.update(main._live_intraday(main._intraday_state(m30.tz_localize(None), 'm30_', '30m', 48, 'Equity', h1.index[-1].date())))
fires = out / 'h1-fires.json'
fires.write_text(json.dumps({'TEST': h_state[2]}))
with patch.object(chart_feed, 'load_1h', return_value=h1), \
     patch.object(chart_feed, 'build_4h_live', return_value=h4_bundle), \
     patch.object(chart_feed, 'build_30m', return_value=chart_feed._bundle(m30, [50, 250, 500], '%Y-%m-%d %H:%M', bars=1000)), \
     patch.object(chart_feed, 'build_daily', return_value={**chart_feed._bundle(d, [50, 250, 500], '%Y-%m-%d', bars=1000, context_tf='D'), 'references': chart_feed.reference_history(d)}):
    chart_feed.build_chart_feed(str(out), str(out), {'TEST': 'TEST'}, h1_fires_path=str(fires))
# Weekly and Monthly as tools/publish_htf.py publishes them, from a deeper
# history than the Daily bundle carries (~25 years, so Weekly's four-term view
# and its Monthly overlay have something behind them).
back = 1 + 0.3 * np.sin((np.arange(5000) - 5000) / 300)   # meets the fixture's first close
pc = float(d['Close'].iloc[0]) * back
deep = pd.concat([pd.DataFrame({'Open': pc, 'High': pc * 1.01, 'Low': pc * 0.99, 'Close': pc, 'Volume': 1000},
                               index=pd.bdate_range(end=d.index[0] - pd.Timedelta(days=1), periods=len(pc))), d])
built, _ = publish_htf.build({'TEST': 'TEST'}, ['W', 'M'], lambda t: (deep, 'max'), workers=1)
for tf in ('W', 'M'):
    publish_htf.write(out, tf, built[tf], ['TEST'], str(d.index[-1].date()))
# Active at last close (activity_feed): TEST's sector busy on Day and Week,
# quiet on Month, so the strip shows two rows.
for tf, period, hot in (('D', str(d.index[-1].date()), True), ('W', '2026-10-19', True), ('M', '2026-09-01', False)):
    (out / 'activity').mkdir(exist_ok=True)
    (out / 'activity' / f'{tf}.json').write_text(json.dumps({
        'tf': tf, 'period': period, 'active': int(hot), 'market_wide': False,
        'sectors': [{'sector': 'Technology', 'date': period, 'members': 9, 'counted': 9, 'big': 4,
                     'up': 4, 'down': 0, 'z': 2.4 if hot else 0.1, 'hot': hot, 'tilt': 'up',
                     'top': [['TEST', 3.1, 2.6]], 'order': ['TEST'], 'history_bars': 300}]}))
stamp = pd.Timestamp.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')
summary = publish.build_summary(pd.DataFrame([row]), str(d.index[-1].date()))
summary['fetched_at'] = stamp
for filename, payload in {
    'signals.json': {'data': [row], 'date': str(d.index[-1].date())},
    'summary.json': summary, 'status.json': {'state': 'ok', 'at': stamp},
    'tv-map.json': {'TEST': 'NASDAQ:TEST'}, 'ai-instruments.json': [],
    'trends.json': {'TEST': trends}, 'names.json': {'TEST': 'Test instrument'},
}.items():
    (out / filename).write_text(json.dumps(payload))
