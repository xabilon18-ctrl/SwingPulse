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
import data_fetcher
import publish_four_hour


class FourHourTests(unittest.TestCase):
    def test_forming_snapshots_do_not_enter_completed_analysis(self):
        now = pd.Timestamp('2026-10-10 15:05')
        hourly = hourly_frame(2600)
        hourly.index = pd.date_range(end=now.floor('h'), periods=len(hourly), freq='h', tz='UTC')
        changed = hourly.copy()
        changed.iloc[-1, changed.columns.get_loc('Close')] = 999
        changed.iloc[-1, changed.columns.get_loc('High')] = 1000
        with patch.object(data_fetcher, '_utc_now', return_value=now), \
             patch.object(chart_feed, '_utc_now', return_value=now):
            for builder, hours, start in [(chart_feed.build_1h, 1, '15:00'),
                                           (chart_feed.build_4h_live, 4, '12:00')]:
                with patch.object(chart_feed, 'load_1h', return_value=hourly):
                    first = builder('', 'TEST')
                with patch.object(chart_feed, 'load_1h', return_value=changed):
                    second = builder('', 'TEST')
                self.assertEqual(first['forming']['t'], '2026-10-10 ' + start)
                self.assertEqual(second['forming']['c'], 999)
                for key in ('t', 'o', 'h', 'l', 'c', 'p', 'mi', 'm'):
                    self.assertEqual(first[key], second[key], key + ' must remain completed-only')
                from channel_rule import read
                self.assertEqual(read(first, str(hours) + 'H'), read(second, str(hours) + 'H'))
            self.assertEqual(main._compute_1h_state(hourly, 'Crypto', now.date()),
                             main._compute_1h_state(changed, 'Crypto', now.date()))
            pd.testing.assert_frame_equal(main._frame_4h(hourly), main._frame_4h(changed))
        # Once the bucket closes, it moves into completed data exactly once.
        later = now + pd.Timedelta(hours=1)
        with patch.object(data_fetcher, '_utc_now', return_value=later), \
             patch.object(chart_feed, '_utc_now', return_value=later), \
             patch.object(chart_feed, 'load_1h', return_value=changed):
            final = chart_feed.build_4h_live('', 'TEST')
        self.assertNotIn('forming', final)
        self.assertEqual(final['t'][-1], '2026-10-10 12:00')
        self.assertEqual(final['c'][-1], 999)

    def test_closed_market_does_not_invent_a_candle(self):
        hourly = hourly_frame(2600)
        hourly.index = pd.date_range(end='2026-10-09 20:00', periods=len(hourly), freq='h', tz='UTC')
        now = pd.Timestamp('2026-10-10 15:05')
        with patch.object(data_fetcher, '_utc_now', return_value=now), \
             patch.object(chart_feed, '_utc_now', return_value=now), \
             patch.object(chart_feed, 'load_1h', return_value=hourly):
            self.assertNotIn('forming', chart_feed.build_1h('', 'TEST'))
            self.assertNotIn('forming', chart_feed.build_4h_live('', 'TEST'))

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
