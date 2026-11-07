"""Regression checks for the 1H chart's forming (still-open) bar.

4H was removed permanently on 2026-11-07 (user: "Remove 4h permanently",
then "Even from the code"): its builder, its release tool and their tests
are gone. This file keeps its old name only because the CI workflows run it
by name; what is left checks the 1H forming bar, which the 4H checks shared.
"""
import sys
from pathlib import Path
import unittest
from unittest.mock import patch
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp'), str(ROOT / 'tests')]
from hourly_test import hourly_frame
import main
import chart_feed
import data_fetcher


class HourlyFormingBarTests(unittest.TestCase):
    def test_forming_snapshots_do_not_enter_completed_analysis(self):
        now = pd.Timestamp('2026-10-10 15:05')
        hourly = hourly_frame(2600)
        hourly.index = pd.date_range(end=now.floor('h'), periods=len(hourly), freq='h', tz='UTC')
        changed = hourly.copy()
        changed.iloc[-1, changed.columns.get_loc('Close')] = 999
        changed.iloc[-1, changed.columns.get_loc('High')] = 1000
        with patch.object(data_fetcher, '_utc_now', return_value=now), \
             patch.object(chart_feed, '_utc_now', return_value=now):
            with patch.object(chart_feed, 'load_1h', return_value=hourly):
                first = chart_feed.build_1h('', 'TEST')
            with patch.object(chart_feed, 'load_1h', return_value=changed):
                second = chart_feed.build_1h('', 'TEST')
            self.assertEqual(first['forming']['t'], '2026-10-10 15:00')
            self.assertEqual(second['forming']['c'], 999)
            for key in ('t', 'o', 'h', 'l', 'c', 'p', 'mi', 'm'):
                self.assertEqual(first[key], second[key], key + ' must remain completed-only')
            from channel_rule import read
            self.assertEqual(read(first, '1H'), read(second, '1H'))
            self.assertEqual(main._compute_1h_state(hourly, 'Crypto', now.date()),
                             main._compute_1h_state(changed, 'Crypto', now.date()))

    def test_closed_market_does_not_invent_a_candle(self):
        hourly = hourly_frame(2600)
        hourly.index = pd.date_range(end='2026-10-09 20:00', periods=len(hourly), freq='h', tz='UTC')
        now = pd.Timestamp('2026-10-10 15:05')
        with patch.object(data_fetcher, '_utc_now', return_value=now), \
             patch.object(chart_feed, '_utc_now', return_value=now), \
             patch.object(chart_feed, 'load_1h', return_value=hourly):
            self.assertNotIn('forming', chart_feed.build_1h('', 'TEST'))

    def test_four_hour_chart_is_gone(self):
        self.assertFalse(hasattr(chart_feed, 'build_4h_live'))
        self.assertFalse(hasattr(chart_feed, 'build_4h'))
        self.assertNotIn('4H', chart_feed.CHART_BUILDERS)
        self.assertFalse((ROOT / 'tools' / 'publish_four_hour.py').exists())


if __name__ == '__main__':
    unittest.main()
