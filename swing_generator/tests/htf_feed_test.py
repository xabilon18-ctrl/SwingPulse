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

    def test_cache_restore_paths_match_the_publisher(self):
        # The path list is part of the actions cache version: any difference
        # and the restore finds nothing (the first run, 2026-10-19).
        import re
        workflows = ROOT.parent / '.github' / 'workflows'
        def paths(name):
            text = (workflows / name).read_text()
            block = re.search(r'path: \|\n((?:\s+swing_generator/\S+\n)+)\s+key: parquet-ma500', text)
            return block.group(1).split()
        self.assertEqual(paths('publish-htf.yml'), paths('publish.yml'))


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


class QuoteRefTests(unittest.TestCase):
    """quotes.json `r` (2026-10-27): the closes the app's live 1W/1M/1Y moves
    are measured from. On a closed daily price they must give exactly the
    pipeline's 5/21/252-bar returns; on a newer session's price the window
    ends at that price, so it starts one session later."""

    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp()
        shutil.copy(FIXTURES / 'AAPL_D.parquet', os.path.join(cls.dir, chart_feed._cache_name('AAPL')))
        daily = chart_feed.scale_daily('AAPL', pd.read_parquet(FIXTURES / 'AAPL_D.parquet'))
        cls.close = daily['Close'].dropna()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_closed_price_matches_the_pipeline_returns(self):
        with patch.object(chart_feed, 'load_5m', return_value=None):
            q = chart_feed._quote_one(self.dir, 'AAPL')
        c = self.close
        for ref, n in zip(q['r'], (5, 21, 252)):
            self.assertAlmostEqual(q['p'] / ref - 1, c.iloc[-1] / c.iloc[-1 - n] - 1, places=4)

    def test_newer_session_window_ends_at_the_live_price(self):
        c = self.close
        when = c.index[-1].normalize() + pd.offsets.BDay(1) + pd.Timedelta(hours=15)
        five = pd.DataFrame({'Close': [float(c.iloc[-1]) * 1.01]}, index=[when])
        with patch.object(chart_feed, 'load_5m', return_value=five), \
             patch.object(chart_feed, '_frame_5m', side_effect=lambda raw: raw):
            q = chart_feed._quote_one(self.dir, 'AAPL')
        self.assertEqual(q['s'], '5m')
        self.assertAlmostEqual(q['pc'], float(c.iloc[-1]), places=2)
        self.assertEqual(q['r'], [chart_feed._round(float(c.iloc[-n])) for n in (5, 21, 252)])


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



class ActivityFeedTests(unittest.TestCase):
    """Active sectors at the last close (webapp/activity_feed.py, 2026-10-28)."""

    @staticmethod
    def bars(days, closes):
        return {'t': [str(d.date()) for d in days], 'c': list(closes)}

    def quiet(self, seed, days, last=None):
        """Closes moving ~0.5% a bar; `last` replaces the final bar's change."""
        import numpy as np
        ch = np.random.default_rng(seed).normal(0, 0.005, len(days))
        if last is not None:
            ch[-1] = last
        return self.bars(days, 100 * np.cumprod(1 + ch))

    def test_closed_weekday_bars_only_except_coins(self):
        import activity_feed as af
        days = pd.date_range('2026-06-01', '2026-10-28', freq='D')
        b = self.quiet(1, days)
        fx = af.instrument_moves(b, keep_weekends=False, cutoff='2026-10-28')
        coin = af.instrument_moves(b, keep_weekends=True, cutoff='2026-10-28')
        self.assertFalse(any(pd.Timestamp(d).weekday() >= 5 for d in fx))   # Sunday stub out
        self.assertTrue(any(pd.Timestamp(d).weekday() >= 5 for d in coin))  # coins trade weekends
        self.assertNotIn('2026-10-28', fx)                                 # still trading
        self.assertNotIn('2026-10-28', coin)
        # Monday is measured from Friday, not from the Sunday stub.
        mon, fri = '2026-10-26', '2026-10-23'
        i = {d: k for k, d in enumerate(b['t'])}
        self.assertAlmostEqual(fx[mon][0], b['c'][i[mon]] / b['c'][i[fri]] - 1)

    def test_monthly_bars_on_a_weekend_first_are_kept(self):
        import activity_feed as af
        months = pd.date_range(end='2026-09-01', periods=80, freq='MS')   # 1 Aug 2026 = Saturday
        b = self.quiet(3, months)
        insts = [{'name': 'Apple', 'group': 'US Equity', 'sector': 'Technology'}]
        s = af.build_activity({'Apple': b}, insts, 'M')['sectors'][0]
        self.assertEqual(s['date'], '2026-09-01')
        self.assertEqual(s['history_bars'], 80 - 1 - af.SD_MIN)   # no month dropped

    def test_own_yardstick_flags_a_big_move(self):
        import activity_feed as af
        days = pd.bdate_range(end='2026-10-27', periods=120)
        calm = af.instrument_moves(self.quiet(2, days), False, None)
        jump = af.instrument_moves(self.quiet(2, days, last=-0.03), False, None)
        self.assertLess(calm['2026-10-27'][1], af.MOVE_K)
        self.assertGreaterEqual(jump['2026-10-27'][1], af.MOVE_K)   # ~6x its typical bar
        self.assertLess(jump['2026-10-27'][0], 0)

    def test_sector_active_down_and_market_wide(self):
        import activity_feed as af
        days = pd.bdate_range(end='2026-10-27', periods=150)
        sectors = ['Currency', 'Technology', 'Energy', 'Utilities', 'Healthcare', 'Industrials', 'Real Estate']
        bundles, insts, seed = {}, [], 10
        for k, sec in enumerate(sectors):
            for j in range(10):
                name = f'{sec[:3]}{j}'
                # Every sector but Real Estate: six of ten fall hard on the last bar.
                big = sec != 'Real Estate' and j < 6
                bundles[name] = self.quiet(seed, days, last=-0.04 if big else None)
                insts.append({'name': name, 'group': sec, 'sector': sec})
                seed += 1
        out = af.build_activity(bundles, insts, 'D', now=pd.Timestamp('2026-10-28 06:00', tz='UTC').to_pydatetime())
        by = {s['sector']: s for s in out['sectors']}
        self.assertEqual(out['period'], '2026-10-27')
        cur = by['Currency']
        self.assertTrue(cur['hot'])
        self.assertEqual((cur['big'], cur['down'], cur['tilt']), (6, 6, 'down'))
        self.assertEqual(len(cur['top']), 6)
        self.assertEqual(sorted(cur['order'][:6]), [f'Cur{j}' for j in range(6)])   # movers first
        self.assertFalse(by['Real Estate']['hot'])
        self.assertEqual(out['active'], 6)
        self.assertTrue(out['market_wide'])

    def test_small_sector_is_listed_never_active(self):
        import activity_feed as af
        days = pd.bdate_range(end='2026-10-27', periods=150)
        bundles = {f'S{j}': self.quiet(40 + j, days, last=-0.05) for j in range(af.MIN_MEMBERS - 1)}
        insts = [{'name': n, 'group': 'Utilities', 'sector': 'Utilities'} for n in bundles]
        s = af.build_activity(bundles, insts, 'W')['sectors'][0]
        self.assertEqual(s['big'], af.MIN_MEMBERS - 1)
        self.assertFalse(s['hot'])

    def test_weekly_and_monthly_jobs_write_their_own_file(self):
        days = pd.bdate_range(end='2026-10-23', periods=150, freq='W-MON')
        with tempfile.TemporaryDirectory() as out:
            out = Path(out)
            act = publish_htf.write_activity(out, 'W', {'Apple': self.quiet(5, days)})
            self.assertEqual(act['tf'], 'W')
            self.assertEqual(read_gz(out / 'activity' / 'W.json')['tf'], 'W')
            self.assertFalse((out / 'activity' / 'D.json').exists())


if __name__ == '__main__':
    unittest.main()
