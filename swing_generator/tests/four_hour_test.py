"""Regression checks for the 1H chart's forming (still-open) bar, and the
2H / 4H charts.

4H was removed on 2026-11-07 and is back with 2H on 2026-11-20 as CHARTS
ONLY (user: "charts only and make both under 1h button as a drop-down"):
built from the 1H feed in bars counted from each session's open, with a
forming bar, and no signals. tools/publish_four_hour.py stays gone.
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

    def test_two_and_four_hour_charts_only(self):
        self.assertEqual(chart_feed.CHART_BUILDERS['2H'], 'build_2h')
        self.assertEqual(chart_feed.CHART_BUILDERS['4H'], 'build_4h')
        self.assertNotIn('2H', chart_feed.SIGNAL_CHART_TFS)
        self.assertNotIn('4H', chart_feed.SIGNAL_CHART_TFS)
        self.assertFalse(hasattr(chart_feed, 'build_4h_live'))
        self.assertFalse((ROOT / 'tools' / 'publish_four_hour.py').exists())

    @staticmethod
    def _us_session_hours(days=400, end='2026-11-19'):
        """A US cash session in hourly bars: 14:30 .. 20:30 UTC (7 bars, the
        last a half hour to the 21:00 close), weekdays only."""
        stamps = [d + pd.Timedelta(hours=14, minutes=30) + pd.Timedelta(hours=h)
                  for d in pd.bdate_range(end=end, periods=days) for h in range(7)]
        idx = pd.DatetimeIndex(stamps, tz='UTC')
        close = pd.Series(range(len(idx)), index=idx, dtype=float) / 10 + 100
        return pd.DataFrame({'Open': close, 'High': close + 1, 'Low': close - 1,
                             'Close': close, 'Volume': 1000.0}, index=idx)

    def test_bars_count_from_the_session_open(self):
        hourly = self._us_session_hours()
        now = pd.Timestamp('2026-11-20 12:00')
        with patch.object(data_fetcher, '_utc_now', return_value=now), \
             patch.object(chart_feed, '_utc_now', return_value=now), \
             patch.object(chart_feed, 'load_1h', return_value=hourly), \
             patch.object(main.pd.Timestamp, 'now', return_value=pd.Timestamp('2026-11-20 12:00', tz='UTC')):
            two, four = chart_feed.build_2h('', 'TEST'), chart_feed.build_4h('', 'TEST')
        last_day = [t for t in four['t'] if t.startswith('2026-11-19')]
        self.assertEqual(last_day, ['2026-11-19 14:30', '2026-11-19 18:30'], 'two 4H bars a US session')
        self.assertEqual([t for t in two['t'] if t.startswith('2026-11-19')],
                         ['2026-11-19 14:30', '2026-11-19 16:30', '2026-11-19 18:30', '2026-11-19 20:30'])
        for bundle in (two, four):
            self.assertEqual(bundle['p'], [50, 250, 500])
            for key in ('sg', 'xm', 'context'):
                self.assertNotIn(key, bundle, 'charts only: no signals or trend read')

    def test_forming_bar_stays_out_of_completed_bars(self):
        now = pd.Timestamp('2026-10-10 15:05')
        hourly = hourly_frame(2600)
        hourly.index = pd.date_range(end=now.floor('h'), periods=len(hourly), freq='h', tz='UTC')
        with patch.object(data_fetcher, '_utc_now', return_value=now), \
             patch.object(chart_feed, '_utc_now', return_value=now), \
             patch.object(chart_feed, 'load_1h', return_value=hourly), \
             patch.object(main.pd.Timestamp, 'now', return_value=pd.Timestamp(now, tz='UTC')):
            four = chart_feed.build_4h('', 'TEST')
        self.assertEqual(four['forming']['t'], '2026-10-10 12:00')
        self.assertLess(four['t'][-1], '2026-10-10 12:00', 'the open 4H bar is not a completed bar')


if __name__ == '__main__':
    unittest.main()
