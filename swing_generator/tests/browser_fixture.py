"""Make a deterministic market fixture for the real app browser smoke test."""
import json
from pathlib import Path
import sys
from unittest.mock import patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp'), str(ROOT / 'tests')]
from hourly_test import hourly_frame
import main
import chart_feed
import publish

out = ROOT / 'webapp' / 'publish' / 'browser-data'
out.mkdir(parents=True, exist_ok=True)
h1 = hourly_frame()
d = h1.copy()
d.index = pd.bdate_range(end=pd.Timestamp.utcnow().tz_localize(None).normalize() - pd.Timedelta(days=1), periods=len(d))
m30 = h1.copy()
m30.index = pd.date_range(end=h1.index[-1], periods=len(h1), freq='30min')
meta = {'name': 'TEST', 'group': 'US Equity', 'sector': 'Technology', 'industry': 'Software'}
row, trends = main.process_instrument('TEST', d, meta, d.index[-1].date())
h_state = main._compute_1h_state(h1, 'Equity', h1.index[-1].date())
m_state = main._compute_30m_state(None, 'Equity', h1.index[-1].date())
row.update(main._live_intraday(h_state, prefix='h1_'))
row.update(main._live_intraday(main._intraday_state(m30.tz_localize(None), 'm30_', '30m', 48, 'Equity', h1.index[-1].date())))
fires = out / 'h1-fires.json'
fires.write_text(json.dumps({'TEST': h_state[2]}))
with patch.object(chart_feed, 'load_1h', return_value=h1), \
     patch.object(chart_feed, 'build_30m', return_value=chart_feed._bundle(m30, [50, 250, 500], '%Y-%m-%d %H:%M', bars=1000)), \
     patch.object(chart_feed, 'build_daily', return_value=chart_feed._bundle(d, [50, 250, 500], '%Y-%m-%d', bars=1000)):
    chart_feed.build_chart_feed(str(out), str(out), {'TEST': 'TEST'}, h1_fires_path=str(fires))
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
