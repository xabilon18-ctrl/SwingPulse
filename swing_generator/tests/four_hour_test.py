"""Regression checks for current 4H bars and a data-preserving release."""
from copy import deepcopy
import gzip
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp'), str(ROOT / 'tools'), str(ROOT / 'tests')]
from hourly_test import hourly_frame
import main
import chart_feed
import publish_four_hour


class FourHourTests(unittest.TestCase):
    def test_completed_four_hour_bars_and_exact_mas(self):
        hourly = hourly_frame()
        frame = main._frame_4h(hourly)
        self.assertTrue((frame.index + pd.Timedelta(hours=4) <= pd.Timestamp.utcnow().tz_localize(None)).all())
        stamp = frame.index[-2]
        source = hourly.tz_localize(None).loc[stamp:stamp + pd.Timedelta(hours=3)]
        self.assertEqual(frame.loc[stamp, 'Open'], source['Open'].iloc[0])
        self.assertEqual(frame.loc[stamp, 'Close'], source['Close'].iloc[-1])
        self.assertEqual(frame.loc[stamp, 'High'], source['High'].max())
        self.assertEqual(frame.loc[stamp, 'Low'], source['Low'].min())
        self.assertEqual(frame.loc[stamp, 'Volume'], source['Volume'].sum())
        with patch.object(chart_feed, 'load_1h', return_value=hourly):
            bundle = chart_feed.build_4h_live('', 'TEST')
        self.assertEqual(bundle['p'], [50, 250])
        self.assertEqual(bundle['c'][-1], round(frame['Close'].iloc[-1], 4))

    def test_targeted_release_preserves_index_and_other_timeframes(self):
        hourly = hourly_frame()
        with patch.object(chart_feed, 'load_1h', return_value=hourly):
            bundle = chart_feed.build_4h_live('', 'TEST')
        index = {'chunks': {'TEST': 17}}
        trends = {'generated_at': pd.Timestamp.utcnow().isoformat(),
                  'tf': {'1H': {'TEST': 'UPTREND'}, 'D': {'TEST': 'DOWNTREND'}},
                  'since': {'D': {'TEST': '2025-01-01'}}}
        saved = deepcopy(trends)
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(publish_four_hour, 'build_4h_live', return_value=bundle):
            out = Path(temp)
            self.assertEqual(publish_four_hour.prepare(out, index, trends, {'TEST': 'TEST'}), 1)
            merged = json.loads(gzip.decompress((out / 'trend_channels.json').read_bytes()))
            self.assertEqual(merged['tf']['D'], saved['tf']['D'])
            self.assertEqual(merged['tf']['1H'], saved['tf']['1H'])
            self.assertEqual(merged['since']['D'], saved['since']['D'])
            self.assertIn('TEST', merged['tf']['4H'])
            self.assertEqual(trends, saved)
            self.assertTrue((out / 'chart' / '4H' / '17.json').exists())
            self.assertFalse((out / 'chart' / 'index.json').exists())
            self.assertFalse((out / 'signals.json').exists())
            self.assertFalse((out / 'quotes.json').exists())
        with tempfile.TemporaryDirectory() as temp, \
             patch.object(publish_four_hour, 'build_4h_live', return_value=None):
            with self.assertRaisesRegex(AssertionError, 'coverage'):
                publish_four_hour.prepare(Path(temp), index, trends, {'TEST': 'TEST'})


if __name__ == '__main__':
    unittest.main()
