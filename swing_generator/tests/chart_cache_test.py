"""Chart bundle cache reuse rules and the R2 upload manifest (2026-11-01)."""
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp')]
import chart_cache
import publish


def _write(path, end, freq='h', n=10):
    pd.DataFrame({'Close': range(n)},
                 index=pd.date_range(end=end, periods=n, freq=freq, tz='UTC')).to_parquet(path)


def _build(store, ticker, paths):
    """Stand-in for a chart builder: reads its files through the recorder."""
    with chart_cache.recording() as reads:
        for p in paths:
            if os.path.exists(p):
                pd.read_parquet(p)
    return reads


class ChartCacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.h1 = os.path.join(self.dir, 'X_1h.parquet')
        self.ref = os.path.join(self.dir, 'REF_1h.parquet')

    def tearDown(self):
        self.tmp.cleanup()

    def _store(self, now):
        return chart_cache.Store(self.dir, now=pd.Timestamp(now))

    def test_settled_build_is_reused_until_a_file_changes(self):
        _write(self.h1, '2026-10-30 19:00')                     # Friday close
        s = self._store('2026-11-01 06:00')
        meta = s.meta('4H', 'X', ('X', None, None))
        s.save('4H', 'X', meta, _build(s, 'X', [self.h1]), {'c': [1]})
        self.assertEqual(self._store('2026-11-01 07:00').load('4H', 'X', meta), (True, {'c': [1]}))
        _write(self.h1, '2026-10-30 20:00')
        self.assertEqual(self._store('2026-11-01 07:00').load('4H', 'X', meta), (False, None))

    def test_a_file_that_appears_later_invalidates(self):
        _write(self.h1, '2026-10-30 19:00')
        s = self._store('2026-11-01 06:00')
        meta = s.meta('4H', 'X', ('X', 'REF', None))
        s.save('4H', 'X', meta, _build(s, 'X', [self.h1, self.ref]), {'c': [1]})
        self.assertTrue(self._store('2026-11-01 07:00').load('4H', 'X', meta)[0])
        _write(self.ref, '2026-10-30 19:00')
        self.assertFalse(self._store('2026-11-01 07:00').load('4H', 'X', meta)[0])

    def test_unfinished_bars_are_never_cached(self):
        _write(self.h1, '2026-11-01 05:00')                     # its 4H bucket is still open
        s = self._store('2026-11-01 06:00')
        meta = s.meta('4H', 'X', ('X', None, None))
        s.save('4H', 'X', meta, _build(s, 'X', [self.h1]), {'c': [1]})
        self.assertFalse(self._store('2026-11-01 06:00').load('4H', 'X', meta)[0])

    def test_a_new_utc_day_or_engine_rebuilds(self):
        _write(self.h1, '2026-10-30 19:00')
        s = self._store('2026-11-01 23:00')
        meta = s.meta('D', 'X', ('X', None, None))
        s.save('D', 'X', meta, _build(s, 'X', [self.h1]), {'c': [1]})
        tomorrow = self._store('2026-11-02 00:05')
        self.assertFalse(tomorrow.load('D', 'X', tomorrow.meta('D', 'X', ('X', None, None)))[0])
        self.assertFalse(s.load('D', 'X', ('other-engine',) + meta[1:])[0])

    def test_recording_restores_pandas_and_os(self):
        with chart_cache.recording():
            pass
        self.assertIs(pd.read_parquet, chart_cache._orig_read_parquet)
        self.assertIs(os.path.exists, chart_cache._orig_exists)


class ManifestTests(unittest.TestCase):
    def test_unchanged_chart_files_are_skipped_and_recorded(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, 'data', 'chart', 'D'))
            for name, body in (('chart/index.json', b'i'), ('chart/D/0.json', b'a'),
                               ('chart/D/1.json', b'b'), ('signals.json', b's')):
                with open(os.path.join(d, 'data', name), 'wb') as fh:
                    fh.write(body)
            sent = []
            put = lambda path, key, timeout=120: (sent.append(key), (True, key))[1]
            with patch.object(publish, 'R2_MANIFEST', os.path.join(d, 'm.json')), \
                 patch.object(publish, '_r2_put', side_effect=put):
                publish.upload_to_r2(os.path.join(d, 'data'), r2_prefix='ma500', skip_unchanged=True)
                self.assertEqual(len(sent), 4, 'no manifest yet: everything goes up')
                with open(os.path.join(d, 'data', 'chart/D/1.json'), 'wb') as fh:
                    fh.write(b'changed')
                sent.clear()
                publish.upload_to_r2(os.path.join(d, 'data'), r2_prefix='ma500', skip_unchanged=True)
                self.assertEqual(sorted(sent), ['ma500/chart/D/1.json', 'ma500/signals.json'])
                sent.clear()
                publish.upload_to_r2(os.path.join(d, 'data'), r2_prefix='ma500')
                self.assertEqual(len(sent), 4, 'without skip_unchanged every file goes up')
                m = publish._load_r2_manifest()
                m['full_at'] = time.time() - (publish.R2_FULL_UPLOAD_HOURS + 1) * 3600
                publish._save_r2_manifest(m)
                sent.clear()
                publish.upload_to_r2(os.path.join(d, 'data'), r2_prefix='ma500', skip_unchanged=True)
                self.assertEqual(len(sent), 4, 'a day after the last full upload, everything again')


if __name__ == '__main__':
    unittest.main()
