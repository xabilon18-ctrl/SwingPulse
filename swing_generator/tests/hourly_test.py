"""Offline regression checks for the restored hourly production path."""
import gzip
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp')]
import main
import data_fetcher
import chart_feed
import config


def hourly_frame():
    end = pd.Timestamp.utcnow().tz_localize(None).floor('h') - pd.Timedelta(hours=1)
    t = pd.date_range(end=end, periods=1600, freq='h', tz='UTC')
    c = 100 + 15 * np.sin(np.arange(len(t)) / 70)
    c[-1] = 130  # a fresh full-ribbon cross for liveness and alert checks
    return pd.DataFrame({'Open': c, 'High': c + 1, 'Low': c - 1,
                         'Close': c, 'Volume': 1000}, index=t)


class HourlyTests(unittest.TestCase):
    def test_unfinished_hour_does_not_change_signals(self):
        f = hourly_frame()
        now = f.index[-1].tz_localize(None) + pd.Timedelta(hours=1)
        extra = f.iloc[[-1]].copy()
        extra.index = pd.DatetimeIndex([now.tz_localize('UTC')])
        extra['Close'] = 99999
        with patch.object(data_fetcher, '_utc_now', return_value=now):
            before = main._compute_1h_state(f, 'Equity', now.date())
            after = main._compute_1h_state(pd.concat([f, extra]), 'Equity', now.date())
        self.assertEqual(before, after)
        self.assertEqual(main._m1h_ma_periods(f), [50, 250, 500])

    def test_only_primary_codes_and_no_retired_confidence(self):
        f = hourly_frame()
        state = main._compute_1h_state(f, 'Equity', f.index[-1].date())
        self.assertTrue(state[2])
        self.assertEqual({code for _, code in state[2]}, {'B1', 'S1'})
        self.assertTrue(all(conf == 'standard' for _, _, conf, _ in state[1]))
        self.assertEqual(main._live_intraday(None, prefix='h1_'), {})
        self.assertIn(('1H', 'h1_'), config.TIMEFRAMES)
        self.assertIn('h1_primary_signal', config.OUTPUT_COLUMNS)
        # The 24-hour lifetime uses wall time, including when a market is closed.
        live = main._live_intraday(state, state[1][-1][0], prefix='h1_')
        self.assertIn(live['h1_primary_signal'], ('B1', 'S1'))
        expired = main._live_intraday(state, state[1][-1][0] + pd.Timedelta(hours=25), prefix='h1_')
        self.assertEqual(expired['h1_primary_signal'], '')

    def test_worker_merges_hourly_without_discarding_daily(self):
        f = hourly_frame()
        daily_row = {'instrument_name': 'TEST', 'primary_signal': 'B2', 'close': '123'}
        with patch.object(pd, 'read_parquet', return_value=f), \
             patch.object(main.os.path, 'exists', return_value=True), \
             patch.object(data_fetcher, 'load_5m', return_value=None), \
             patch.object(data_fetcher, 'load_1h', return_value=f), \
             patch.object(main, 'process_instrument', return_value=(daily_row, [])), \
             patch.object(main, '_rowcache_load', return_value={}), \
             patch.object(main, '_rowcache_save'):
            _, row, _, status = main._process_worker(('TEST', {'name': 'TEST', 'group': 'US Equity'}, f.index[-1].date()))
        self.assertEqual(row['primary_signal'], 'B2')
        self.assertEqual(row['close'], '123')
        self.assertIn('h1_close', row)
        self.assertTrue(row['_h1_fires'])
        self.assertTrue(status.startswith('OK'))

    def test_published_hourly_markers_alerts_and_trends(self):
        f = hourly_frame()
        state = main._compute_1h_state(f, 'Equity', f.index[-1].date())
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(chart_feed, 'load_1h', return_value=f), \
             patch.object(chart_feed, 'build_30m', return_value=None), \
             patch.object(chart_feed, 'build_daily', return_value=None):
            fires = Path(tmp) / 'fires.json'
            fires.write_text(json.dumps({'TEST': state[2]}))
            stats = chart_feed.build_chart_feed(tmp, tmp, {'TEST': 'TEST'}, h1_fires_path=str(fires))
            self.assertEqual(stats['1H'], 1)
            def read(p):
                return json.loads(gzip.decompress((Path(tmp) / p).read_bytes()))
            b = read('chart/1H/0.json')['data']['TEST']
            expected = [[b['t'].index(t), code] for t, code in state[2] if t in b['t']]
            self.assertEqual(b['sg'], expected)
            self.assertTrue(expected)
            self.assertIn('TEST', read('trend_channels.json')['tf']['1H'])
            self.assertTrue(any(e[1] == '1H' for e in read('alerts.json')['ev']))


if __name__ == '__main__':
    unittest.main()
