"""Weekly and Monthly charts: rebuilt on Mondays and on the 3rd-5th, kept between.

Offline, on the daily fixtures. Checks the schedule itself, that a kept build
still reaches the app through index.json's chunks_by_tf, and that the bundles
are the closed weeks and months the Daily cache holds.
"""
import gzip
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp')]
import chart_feed

FIXTURES = ROOT / 'tests' / 'fixtures'
TICKERS = {'Apple': 'AAPL', 'Bitcoin': 'BTC-USD'}


def sast(day):
    return pd.Timestamp(day + ' 10:05', tz=chart_feed.HTF_SCHEDULE_TZ)


def read_gz(path):
    with gzip.open(path, 'rt') as fh:
        return json.load(fh)


class ScheduleTests(unittest.TestCase):
    def test_weekly_is_due_on_mondays_only(self):
        # 2026-10-19 is a Monday.
        self.assertTrue(chart_feed.htf_due('W', sast('2026-10-19')))
        for day in ('2026-10-18', '2026-10-20', '2026-10-24'):
            self.assertFalse(chart_feed.htf_due('W', sast(day)), day)

    def test_monthly_is_due_on_the_3rd_to_5th(self):
        for day in ('2026-11-03', '2026-11-04', '2026-11-05'):
            self.assertTrue(chart_feed.htf_due('M', sast(day)), day)
        for day in ('2026-11-01', '2026-11-02', '2026-11-06', '2026-11-30'):
            self.assertFalse(chart_feed.htf_due('M', sast(day)), day)

    def test_schedule_is_read_in_sast(self):
        # 23:30 UTC on a Sunday is already Monday in SAST.
        now = pd.Timestamp('2026-10-18 23:30', tz='UTC').tz_convert(chart_feed.HTF_SCHEDULE_TZ)
        self.assertTrue(chart_feed.htf_due('W', now))

    def test_rebuild_reasons(self):
        names = ['A', 'B']
        built = {'W': {'built': '2026-10-19', 'chunks': {'A': 0, 'B': 0}}}
        reason = chart_feed.htf_rebuild_reason
        self.assertEqual(reason('W', {}, names, sast('2026-10-21')), 'no previous build')
        self.assertIsNone(reason('W', built, names, sast('2026-10-19')))   # once per Monday
        self.assertIsNone(reason('W', built, names, sast('2026-10-21')))   # kept midweek
        self.assertEqual(reason('W', built, names, sast('2026-10-26')), 'scheduled')
        self.assertEqual(reason('W', built, names + ['C'], sast('2026-10-21')), 'new instruments')
        # A retired instrument needs nothing rebuilt: its old chunk ids still hold.
        self.assertIsNone(reason('W', built, ['A'], sast('2026-10-21')))


class FeedTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cache = os.path.join(self.tmp, 'cache')
        self.out = os.path.join(self.tmp, 'out')
        os.makedirs(self.cache)
        for ticker in TICKERS.values():
            shutil.copy(FIXTURES / f'{ticker}_D.parquet',
                        os.path.join(self.cache, chart_feed._cache_name(ticker)))
        # Only the scheduled timeframes are under test here.
        self.patches = [patch.object(chart_feed, name, return_value=None)
                        for name in ('build_30m', 'build_1h', 'build_4h_live', 'build_daily')]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.tmp)

    def publish(self, day):
        shutil.rmtree(self.out, ignore_errors=True)   # CI starts every run empty
        with patch.object(chart_feed, '_now_sast', return_value=sast(day)):
            stats = chart_feed.build_chart_feed(self.out, self.cache, TICKERS)
        index = read_gz(os.path.join(self.out, 'chart', 'index.json'))
        return stats, index

    def test_first_run_builds_then_keeps_until_the_schedule(self):
        # Wednesday, no previous build: both are built at once.
        stats, index = self.publish('2026-10-21')
        self.assertEqual((stats['W'], stats['M']), (2, 2))
        self.assertEqual(index['chunks_by_tf']['W'], index['chunks'])
        weekly = read_gz(os.path.join(self.out, 'chart', 'W', '0.json'))['data']
        monthly = read_gz(os.path.join(self.out, 'chart', 'M', '0.json'))['data']
        self.assertEqual(set(weekly), set(TICKERS))
        self.assertEqual(monthly['Apple']['p'], [50])
        self.assertEqual(weekly['Apple']['p'], [50, 250, 500])

        # Thursday: nothing written, the index still points at Wednesday's chunks.
        stats, index = self.publish('2026-10-22')
        self.assertFalse(os.path.exists(os.path.join(self.out, 'chart', 'W')))
        self.assertFalse(os.path.exists(os.path.join(self.out, 'chart', 'M')))
        self.assertEqual(stats['W'], 2)
        self.assertEqual(set(index['chunks_by_tf']), {'W', 'M'})

        # Monday: Weekly again, Monthly kept. Then the 3rd: Monthly.
        self.publish('2026-10-26')
        self.assertTrue(os.path.exists(os.path.join(self.out, 'chart', 'W', '0.json')))
        self.assertFalse(os.path.exists(os.path.join(self.out, 'chart', 'M')))
        self.publish('2026-11-03')
        self.assertFalse(os.path.exists(os.path.join(self.out, 'chart', 'W')))
        self.assertTrue(os.path.exists(os.path.join(self.out, 'chart', 'M', '0.json')))

    def test_bundles_hold_closed_periods_only(self):
        self.publish('2026-10-19')
        last_daily = pd.read_parquet(FIXTURES / 'AAPL_D.parquet').index.max()
        weekly = read_gz(os.path.join(self.out, 'chart', 'W', '0.json'))['data']['Apple']
        monthly = read_gz(os.path.join(self.out, 'chart', 'M', '0.json'))['data']['Apple']
        # Stamped on the period's start, and only once the period has closed.
        week, month = pd.Timestamp(weekly['t'][-1]), pd.Timestamp(monthly['t'][-1])
        self.assertEqual(week.weekday(), 0)
        self.assertEqual(month.day, 1)
        self.assertLessEqual(week + pd.Timedelta(days=4), last_daily)
        self.assertLessEqual(month + pd.offsets.MonthEnd(0), last_daily)
        # The fixture ends Friday 2026-07-10: that week is closed, July is not.
        self.assertEqual(weekly['t'][-1], '2026-07-06')
        self.assertEqual(monthly['t'][-1], '2026-06-01')


if __name__ == '__main__':
    unittest.main()
