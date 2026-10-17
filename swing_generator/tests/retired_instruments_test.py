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


def _daily(last: str, bars: int = 30) -> pd.DataFrame:
    idx = pd.bdate_range(end=last, periods=bars)
    return pd.DataFrame({'Close': range(1, bars + 1)}, index=idx, dtype=float)


class FindStaleTests(unittest.TestCase):
    def test_only_instruments_past_the_threshold(self):
        bars = {'A': date(2026, 10, 16), 'B': date(2026, 10, 6), 'C': date(2026, 10, 5)}
        stale, newest = instruments.find_stale(bars, 10, 10)
        self.assertEqual(newest, date(2026, 10, 16))
        # B is exactly 10 days behind: a week-long closure plus a weekend stays.
        self.assertEqual(stale, [('C', date(2026, 10, 5), 11)])

    def test_too_many_at_once_is_an_outage_and_retires_nothing(self):
        bars = {f'T{i}': date(2026, 9, 1) for i in range(11)}
        bars['FRESH'] = date(2026, 10, 16)
        self.assertEqual(instruments.find_stale(bars, 10, 10)[0], [])

    def test_empty(self):
        self.assertEqual(instruments.find_stale({}, 10, 10), ([], None))


class RetireTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / 'retired_instruments.json')
        self.patches = [patch.object(main, 'RETIRED_FILE', self.path),
                        patch.object(instruments, 'RETIRED_FILE', self.path)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def test_stale_instrument_is_dropped_written_and_filtered(self):
        data = {'AAPL': _daily('2026-10-16'), 'QRVO': _daily('2026-10-05')}
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
        main._retire_stale({'QRVO': _daily('2026-10-16')}, {})
        self.assertEqual(instruments.retired_tickers(), set())

    def test_outage_is_flagged_and_keeps_everything(self):
        data = {f'T{i}': _daily('2026-09-01') for i in range(11)}
        data['FRESH'] = _daily('2026-10-16')
        main._retire_stale(data, {})
        self.assertEqual(len(data), 12)
        self.assertTrue(json.loads(Path(self.path).read_text())['outage'])

    def test_unreadable_file_retires_nothing(self):
        Path(self.path).write_text('{not json')
        self.assertEqual(instruments.retired_tickers(), set())


class IssuePlanTests(unittest.TestCase):
    def test_open_new_close_restored_keep_existing(self):
        retired = [{'ticker': 'QRVO'}, {'ticker': 'EA'}]
        to_open, to_close = retired_issues.plan(retired, {'EA': 7, 'FERG.L': 3})
        self.assertEqual([r['ticker'] for r in to_open], ['QRVO'])
        self.assertEqual(to_close, {'FERG.L': 3})


if __name__ == '__main__':
    unittest.main()
