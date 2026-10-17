"""Auto-retirement of instruments whose daily data stopped (2026-10-17)."""
from datetime import date
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'tools')]
import instruments
import main
import retired_issues
import data_fetcher as main_data_fetcher


def _daily(last: str, bars: int = 30) -> pd.DataFrame:
    idx = pd.bdate_range(end=last, periods=bars)
    return pd.DataFrame({'Close': range(1, bars + 1)}, index=idx, dtype=float)


def _judge(bars, max_new=10, share=0.10):
    return instruments.find_stale(bars, 10, max_new, share)


class FindStaleTests(unittest.TestCase):
    def test_only_instruments_past_the_threshold(self):
        bars = {'A': date(2026, 10, 16), 'B': date(2026, 10, 6), 'C': date(2026, 10, 5)}
        bars.update({f'F{i}': date(2026, 10, 16) for i in range(20)})
        v = _judge(bars)
        self.assertEqual(v['newest'], date(2026, 10, 16))
        # B is exactly 10 days behind: a week-long closure plus a weekend stays.
        self.assertEqual(v['retire'], [('C', date(2026, 10, 5), 11)])
        self.assertNotIn('C', v['fresh'])
        self.assertIn('B', v['fresh'])
        self.assertFalse(v['outage'])

    def test_many_crossing_together_is_an_outage_and_holds_them_back(self):
        bars = {f'T{i}': date(2026, 10, 5) for i in range(11)}
        bars.update({f'F{i}': date(2026, 10, 16) for i in range(200)})
        bars['DEAD'] = date(2026, 8, 1)
        v = _judge(bars)
        self.assertTrue(v['outage'])
        self.assertEqual(len(v['held']), 11)
        # The long-dead ticker is not part of the outage and still retires.
        self.assertEqual([r[0] for r in v['retire']], ['DEAD'])

    def test_dead_tickers_piling_up_never_look_like_an_outage(self):
        # Review finding: ten old delistings must not turn the eleventh into an outage.
        bars = {f'OLD{i}': date(2026, 8, i + 1) for i in range(10)}
        bars.update({f'F{i}': date(2026, 10, 16) for i in range(200)})
        bars['QRVO'] = date(2026, 10, 5)
        v = _judge(bars)
        self.assertFalse(v['outage'])
        self.assertEqual(len(v['retire']), 11)

    def test_a_large_share_stale_holds_back_everything(self):
        bars = {f'T{i}': date(2026, 7, 1) for i in range(30)}
        bars.update({f'F{i}': date(2026, 10, 16) for i in range(100)})
        v = _judge(bars)
        self.assertTrue(v['outage'])
        self.assertEqual(v['retire'], [])

    def test_empty(self):
        self.assertEqual(_judge({})['retire'], [])


class RetireTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / 'retired_instruments.json')
        # Tiny boards: one stale ticker of two is 50%, past RETIRE_MAX_SHARE.
        # The share guard has its own test in FindStaleTests.
        self.patches = [patch.object(main, 'RETIRED_FILE', self.path),
                        patch.object(instruments, 'RETIRED_FILE', self.path),
                        patch.object(main, 'RETIRE_MAX_SHARE', 1.0)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def test_stale_instrument_is_dropped_written_and_filtered(self):
        data = {'AAPL': _daily('2026-10-16'), 'QRVO': _daily('2026-10-05')}
        with patch.object(main_data_fetcher, '_utc_now', return_value=pd.Timestamp('2026-10-17 12:00')):
            records = main._retire_stale(data, {'QRVO': {'name': 'QRVO'}})
        self.assertEqual(list(data), ['AAPL'])
        self.assertEqual([r['ticker'] for r in records], ['QRVO'])
        doc = json.loads(Path(self.path).read_text())
        self.assertFalse(doc['outage'])
        self.assertEqual(doc['instruments'][0]['days_behind'], 11)
        self.assertEqual(instruments.retired_tickers(), {'QRVO'})
        every = instruments.load_instruments(include_retired=True)
        fake = {'instruments': [{'ticker': every[0]['ticker'], 'name': every[0]['name']}]}
        Path(self.path).write_text(json.dumps(fake))
        self.assertEqual(len(instruments.load_instruments()), len(every) - 1)

    def test_resumed_data_rewrites_an_empty_list(self):
        Path(self.path).write_text(json.dumps({'instruments': [{'ticker': 'QRVO'}]}))
        with patch.object(main_data_fetcher, '_utc_now', return_value=pd.Timestamp('2026-10-17 12:00')):
            main._retire_stale({'QRVO': _daily('2026-10-16')}, {})
        self.assertEqual(instruments.retired_tickers(), set())

    def test_outage_is_flagged_and_keeps_everything(self):
        data = {f'T{i}': _daily('2026-10-05') for i in range(11)}
        data.update({f'F{i}': _daily('2026-10-16') for i in range(200)})
        main._retire_stale(data, {})
        self.assertEqual(len(data), 211)
        self.assertTrue(json.loads(Path(self.path).read_text())['outage'])

    def test_judged_on_finished_bars(self):
        # Review finding: a 24h market's open bar for today must not move 'newest'.
        now = pd.Timestamp('2026-10-17 00:05')
        data = {'BTC': _daily('2026-10-17'), 'HOLIDAY': _daily('2026-10-06')}
        with patch.object(main_data_fetcher, '_utc_now', return_value=now):
            main._retire_stale(data, {})
        doc = json.loads(Path(self.path).read_text())
        self.assertEqual(doc['newest_bar'], '2026-10-16')
        self.assertEqual(doc['instruments'], [])          # 10 days behind: kept
        self.assertEqual(sorted(doc['fresh']), ['BTC', 'HOLIDAY'])

    def test_unreadable_file_retires_nothing(self):
        for bad in ('{not json', '{"instruments": null}', '[]'):
            Path(self.path).write_text(bad)
            self.assertEqual(instruments.retired_tickers(), set())
            self.assertEqual(instruments.load_retired(), {})


class IssuePlanTests(unittest.TestCase):
    R = {'ticker': 'QRVO', 'name': 'QRVO', 'last_bar': '2026-10-05', 'days_behind': 11}

    def test_new_stoppage_opens_an_issue(self):
        to_open, to_close = retired_issues.plan([self.R], [], set(), {'QRVO'}, False)
        self.assertEqual(to_open, [self.R])
        self.assertEqual(to_close, {})

    def test_hand_closed_issue_for_the_same_stoppage_is_not_reopened(self):
        issues = [{'number': 5, 'state': 'closed', 'ticker': 'QRVO', 'last_bar': '2026-10-05'}]
        self.assertEqual(retired_issues.plan([self.R], issues, set(), {'QRVO'}, False)[0], [])

    def test_a_later_separate_stoppage_gets_a_new_issue(self):
        issues = [{'number': 5, 'state': 'closed', 'ticker': 'QRVO', 'last_bar': '2026-03-01'}]
        self.assertEqual(retired_issues.plan([self.R], issues, set(), {'QRVO'}, False)[0], [self.R])

    def test_old_format_open_issue_counts_as_known(self):
        issues = [{'number': 5, 'state': 'open', 'ticker': 'QRVO', 'last_bar': None}]
        self.assertEqual(retired_issues.plan([self.R], issues, set(), {'QRVO'}, False)[0], [])

    def test_close_only_on_evidence(self):
        issues = [{'number': 1, 'state': 'open', 'ticker': 'BACK', 'last_bar': '2026-10-01'},
                  {'number': 2, 'state': 'open', 'ticker': 'GONE', 'last_bar': '2026-10-01'},
                  {'number': 3, 'state': 'open', 'ticker': 'FAILED', 'last_bar': '2026-10-01'}]
        _, to_close = retired_issues.plan([], issues, {'BACK'}, {'BACK', 'FAILED'}, False)
        # A fetch failure is neither: its issue stays open, no false "resumed".
        self.assertEqual(to_close, {1: ('BACK', 'resumed'), 2: ('GONE', 'removed')})

    def test_outage_closes_nothing(self):
        issues = [{'number': 1, 'state': 'open', 'ticker': 'BACK', 'last_bar': '2026-10-01'}]
        self.assertEqual(retired_issues.plan([], issues, {'BACK'}, {'BACK'}, True)[1], {})

    def test_marker_parses_both_formats(self):
        new = retired_issues._MARKER_RE.search(retired_issues.MARKER.format(ticker='GC=F', last_bar='2026-10-05'))
        old = retired_issues._MARKER_RE.search('x <!-- swingpulse-retired:FERG.L --> y')
        self.assertEqual(new.groups(), ('GC=F', '2026-10-05'))
        self.assertEqual(old.groups(), ('FERG.L', None))


if __name__ == '__main__':
    unittest.main()
