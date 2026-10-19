"""Weekly and Monthly charts (tools/publish_htf.py), offline on the daily fixtures.

Checks the schedule (Mondays, the 3rd-5th, SAST), the fallback from Yahoo's
whole history to the Daily cache, that the bundles hold closed periods stamped
on their start, that Weekly carries its own Monthly overlay MAs, and that each
timeframe ships its own index — never the hourly one.
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
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp'), str(ROOT / 'tools')]
import chart_feed
import publish_htf

FIXTURES = ROOT / 'tests' / 'fixtures'
TICKERS = {'Apple': 'AAPL', 'Bitcoin': 'BTC-USD', 'Gone': 'NOPE'}


def sast(day):
    return pd.Timestamp(day + ' 02:35', tz=publish_htf.SCHEDULE_TZ)


def fixture(ticker):
    path = FIXTURES / f'{ticker}_D.parquet'
    return pd.read_parquet(path) if path.exists() else None


def read_gz(path):
    with gzip.open(path, 'rt') as fh:
        return json.load(fh)


class ScheduleTests(unittest.TestCase):
    def test_weekly_on_mondays_monthly_on_the_3rd_to_5th(self):
        self.assertEqual(publish_htf.due(sast('2026-10-19')), ['W'])       # a Monday
        self.assertEqual(publish_htf.due(sast('2026-10-20')), [])
        for day in ('2026-11-03', '2026-11-04', '2026-11-05'):
            self.assertEqual(publish_htf.due(sast(day)), ['M'], day)
        for day in ('2026-11-01', '2026-11-06', '2026-11-07'):
            self.assertEqual(publish_htf.due(sast(day)), [], day)
        self.assertEqual(publish_htf.due(sast('2027-05-03')), ['W', 'M'])  # Monday the 3rd

    def test_schedule_is_read_in_sast(self):
        # 23:30 UTC on a Sunday is already Monday in SAST.
        self.assertEqual(publish_htf.due(pd.Timestamp('2026-10-18 23:30', tz='UTC')), ['W'])

    def test_workflow_crons_match_the_schedule(self):
        text = (ROOT.parent / '.github' / 'workflows' / 'publish-htf.yml').read_text()
        for cron, tf in (("'35 0 * * 1'", 'W'), ("'35 0 3-5 * *'", 'M')):
            self.assertIn(f'cron: {cron}', text)
            self.assertIn(f"{cron}{')' if tf == 'W' else ''}", text)
        self.assertNotIn('group: swingpulse-publish', text, 'an hourly run would drop a waiting one')


class FetchTests(unittest.TestCase):
    def test_whole_history_first_then_the_daily_cache(self):
        with tempfile.TemporaryDirectory() as cache:
            shutil.copy(FIXTURES / 'AAPL_D.parquet', os.path.join(cache, chart_feed._cache_name('AAPL')))
            deep = fixture('AAPL')
            with patch.object(publish_htf, '_full_download', return_value=deep) as dl:
                df, source = publish_htf.fetch_deep('AAPL', cache)
            self.assertEqual(source, 'max')
            self.assertEqual(dl.call_args.kwargs, {'period': 'max'})
            with patch.object(publish_htf, '_full_download', side_effect=ValueError('429')):
                df, source = publish_htf.fetch_deep('AAPL', cache)
                self.assertEqual((source, len(df)), ('cache', len(deep)))
                self.assertEqual(publish_htf.fetch_deep('NOPE', cache), (None, 'none'))
            # Synthetic currency indices are never asked of Yahoo.
            shutil.copy(FIXTURES / 'AAPL_D.parquet', os.path.join(cache, chart_feed._cache_name('CCY_USD')))
            with patch.object(publish_htf, '_full_download') as dl:
                self.assertEqual(publish_htf.fetch_deep('CCY_USD', cache)[1], 'cache')
                dl.assert_not_called()


class BuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.built, cls.sources = publish_htf.build(
            TICKERS, ['W', 'M'], lambda t: (fixture(t), 'max' if fixture(t) is not None else 'none'), workers=2)

    def test_every_instrument_with_history_gets_both(self):
        self.assertEqual(set(self.built['W']), {'Apple', 'Bitcoin'})
        self.assertEqual(set(self.built['M']), {'Apple', 'Bitcoin'})
        self.assertEqual(self.sources, {'max': 2, 'none': 1})

    def test_closed_periods_stamped_on_their_start(self):
        weekly, monthly = self.built['W']['Apple'], self.built['M']['Apple']
        # The fixture ends Friday 2026-07-10: that week is closed, July is not.
        self.assertEqual(weekly['t'][-1], '2026-07-06')
        self.assertEqual(monthly['t'][-1], '2026-06-01')
        self.assertTrue(all(pd.Timestamp(t).weekday() == 0 for t in weekly['t']))
        self.assertTrue(all(pd.Timestamp(t).day == 1 for t in monthly['t']))
        self.assertEqual(weekly['p'], [50, 250, 500])
        self.assertEqual(monthly['p'], [50])

    def test_weekly_carries_the_monthly_overlay_over_its_whole_span(self):
        weekly = self.built['W']['Apple']
        mo = weekly['mo']
        self.assertEqual(mo['p'][0], 50)
        # It reaches back to the first weekly bar (the fixture starts in March
        # 2016, so March is its first month), not just the Daily's five years.
        self.assertLessEqual(pd.Timestamp(mo['t'][0]), pd.Timestamp(weekly['t'][0]) + pd.Timedelta(days=31))
        self.assertTrue(all(len(series) == len(mo['t']) for series in mo['m']))
        self.assertNotIn('mo', self.built['M']['Apple'])


class WriteTests(unittest.TestCase):
    def test_own_index_and_every_chunk_written(self):
        names = [f'N{i:02d}' for i in range(12)]   # three chunks of five
        bundles = {'N00': {'t': ['2026-07-06']}, 'N11': {'t': ['2026-07-06']}}
        with tempfile.TemporaryDirectory() as out:
            out = Path(out)
            (out / 'chart' / 'W').mkdir(parents=True)
            (out / 'chart' / 'W' / '9.json').write_text('stale')
            self.assertEqual(publish_htf.write(out, 'W', bundles, names, '2026-10-19'), 3)
            files = sorted(p.name for p in (out / 'chart' / 'W').iterdir())
            self.assertEqual(files, ['0.json', '1.json', '2.json', 'index.json'])
            index = read_gz(out / 'chart' / 'W' / 'index.json')
            self.assertEqual(index['chunks']['N11'], 2)
            self.assertEqual(index['built'], '2026-10-19')
            self.assertEqual(read_gz(out / 'chart' / 'W' / '1.json')['data'], {})
            self.assertEqual(set(read_gz(out / 'chart' / 'W' / '2.json')['data']), {'N11'})
            self.assertFalse((out / 'chart' / 'index.json').exists())

    def test_hourly_feed_no_longer_builds_them(self):
        with tempfile.TemporaryDirectory() as tmp, \
             patch.object(chart_feed, 'build_weekly', side_effect=AssertionError('hourly W')), \
             patch.object(chart_feed, 'build_monthly', side_effect=AssertionError('hourly M')):
            for name in ('build_30m', 'build_1h', 'build_4h_live', 'build_daily'):
                patch.object(chart_feed, name, return_value=None).start()
            try:
                chart_feed.build_chart_feed(tmp, tmp, {'Apple': 'AAPL'})
            finally:
                patch.stopall()
            self.assertFalse(os.path.exists(os.path.join(tmp, 'chart', 'W')))
            self.assertNotIn('chunks_by_tf', read_gz(os.path.join(tmp, 'chart', 'index.json')))

    def test_index_files_are_never_cached(self):
        import publish
        self.assertEqual(publish._cache_control_for('ma500/chart/W/index.json'), 'no-cache, max-age=0')
        self.assertEqual(publish._cache_control_for('ma500/chart/W/3.json'), 'public, max-age=900')


if __name__ == '__main__':
    unittest.main()
