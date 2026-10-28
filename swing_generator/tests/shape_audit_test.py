"""Sparse signal snapshots must not create failure emails on every code push."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _active_config import CONF_TIER_ORDER
from tools import shape_audit as audit


class ConfidenceVocabularyTests(unittest.TestCase):
    def test_supported_tiers_need_not_occur_today(self):
        rows = [{'signal_confidence': 'low', 'h4_signal_confidence': 'standard'}]
        for tier in CONF_TIER_ORDER:
            for field in ('signal_confidence', 'h4_signal_confidence'):
                with self.subTest(tier=tier, field=field):
                    js = f"item.{field} === '{tier}'"
                    self.assertEqual(audit.check_phantoms(rows, js), [])

    def test_inactive_signal_snapshot_still_validates_the_contract(self):
        rows = [{'signal_confidence': ''}]
        self.assertEqual(audit.check_phantoms(rows, "item.signal_confidence === 'high'"), [])
        self.assertTrue(audit.check_phantoms(rows, "item.signal_confidence === 'strong'"))

    def test_unknown_confidence_is_not_accepted_even_if_bad_data_contains_it(self):
        for value in ('standard', 'strong'):
            with self.subTest(value=value):
                findings = audit.check_phantoms([{'signal_confidence': value}],
                                                "item.signal_confidence === 'strong'")
                self.assertEqual(len(findings), 1)
                self.assertEqual(findings[0][:2], ('FAIL', 'phantom predicate'))

    def test_alias_and_case_folding(self):
        rows = [{'h4_signal_confidence': 'low'}]
        good = "const confidence = (item[f('signal_confidence')] || '').toLowerCase(); if (confidence === 'HIGH') {}"
        self.assertEqual(audit.check_phantoms(rows, good), [])
        self.assertTrue(audit.check_phantoms(rows, good.replace('HIGH', 'STRONG')))

    def test_all_configured_timeframes_share_a_vocabulary(self):
        for prefix in audit.TF_PREFIXES_NB:
            with self.subTest(prefix=prefix):
                field = prefix + 'signal_confidence'
                self.assertEqual(audit.check_phantoms([{field: 'standard'}],
                                                      "item[f('signal_confidence')] === 'high'"), [])

    def test_unknown_value_reports_once_per_family(self):
        rows = [{'signal_confidence': 'low', 'h4_signal_confidence': 'standard'}]
        js = "item.signal_confidence === 'strong'; item.h4_signal_confidence === 'strong';"
        self.assertEqual(len(audit.check_phantoms(rows, js)), 1)

    def test_market_pulse_buy_sell_bug_still_fails(self):
        rows = [{'confirmation_status': 'Uptrend - above all MAs'},
                {'confirmation_status': 'Downtrend - below all MAs'}]
        for direction in ('buy', 'sell'):
            with self.subTest(direction=direction):
                js = f"const status = (item[f('confirmation_status')] || '').toLowerCase(); if (status.includes('{direction}')) {{}}"
                self.assertTrue(audit.check_phantoms(rows, js))
        self.assertEqual(audit.check_phantoms(rows,
                         "item.confirmation_status.toLowerCase().includes('uptrend')"), [])

    def test_confidence_contract_does_not_exempt_other_fields(self):
        rows = [{'confidence_context': 'low'}]
        self.assertTrue(audit.check_phantoms(rows, "item.confidence_context === 'high'"))

    def test_missing_data_flood_still_fails(self):
        healthy = [{'confirmation_status': 'Uptrend - above all MAs'}] * 98
        self.assertEqual(audit.check_no_data(healthy + [{'confirmation_status': 'No data'}] * 2), [])
        self.assertTrue(audit.check_no_data(healthy + [{'confirmation_status': 'No data'}] * 20))


class FetchRetryTests(unittest.TestCase):
    """A slow R2 read is retried; an HTTP answer and a lasting stall are not hidden."""
    def _run(self, outcomes, tries=3):
        calls, waits = [], []
        def once(url):
            calls.append(url)
            r = outcomes.pop(0)
            if isinstance(r, Exception):
                raise r
            return r
        real = audit._fetch_once
        audit._fetch_once = once
        try:
            return audit._fetch_json('signals.json', tries=tries, wait=5, sleep=waits.append), calls, waits
        finally:
            audit._fetch_once = real

    def test_timeout_then_success_returns_the_payload(self):
        doc, calls, waits = self._run([TimeoutError('read'), {'data': []}])
        self.assertEqual(doc, {'data': []})
        self.assertEqual(len(calls), 2)
        self.assertEqual(waits, [5])

    def test_stall_on_every_try_still_fails(self):
        with self.assertRaises(TimeoutError):
            self._run([TimeoutError('a'), TimeoutError('b'), TimeoutError('c')])

    def test_waits_double(self):
        _, calls, waits = self._run([TimeoutError(), TimeoutError(), {'ok': 1}])
        self.assertEqual(waits, [5, 10])

    def test_http_error_is_not_retried(self):
        import urllib.error
        err = urllib.error.HTTPError('u', 404, 'Not Found', {}, None)
        with self.assertRaises(urllib.error.HTTPError):
            self._run([err, {'data': []}])

class HealthCheckFetchRetryTests(unittest.TestCase):
    """health_check.py's reads get the same retry (2026-10-28: the 10:05 and
    11:05 publishes went red on r2.dev timeouts after writing every file).
    Kept here because test.yml already runs this file."""
    def _run(self, outcomes, tries=3):
        from tools import health_check
        calls, waits = [], []
        def once(fname):
            calls.append(fname)
            r = outcomes.pop(0)
            if isinstance(r, Exception):
                raise r
            return r
        real = health_check._fetch_once
        health_check._fetch_once = once
        try:
            return health_check._fetch('signals.json', tries=tries, wait=5, sleep=waits.append), calls, waits
        finally:
            health_check._fetch_once = real

    def test_timeout_then_success_returns_the_payload(self):
        doc, calls, waits = self._run([TimeoutError('The read operation timed out'), {'data': []}])
        self.assertEqual(doc, {'data': []})
        self.assertEqual((len(calls), waits), (2, [5]))

    def test_handshake_timeout_is_retried(self):
        import urllib.error
        doc, _, waits = self._run([urllib.error.URLError('_ssl.c:999: The handshake operation timed out'),
                                   TimeoutError(), {'ok': 1}])
        self.assertEqual((doc, waits), ({'ok': 1}, [5, 10]))

    def test_stall_on_every_try_still_fails(self):
        with self.assertRaises(TimeoutError):
            self._run([TimeoutError('a'), TimeoutError('b'), TimeoutError('c')])

    def test_http_error_is_not_retried(self):
        import urllib.error
        err = urllib.error.HTTPError('u', 404, 'Not Found', {}, None)
        with self.assertRaises(urllib.error.HTTPError):
            self._run([err, {'data': []}])

    def test_trickling_body_hits_the_deadline(self):
        """A body that keeps arriving a little at a time never trips the
        per-read socket timeout; the whole-body deadline stops it."""
        from tools import health_check
        class Trickle:
            def read(self, n):
                return b'x'
        ticks = iter(range(0, 10_000, 10))   # each read costs 10 s
        with self.assertRaises(TimeoutError):
            health_check._read_all(Trickle(), deadline_s=90, clock=lambda: next(ticks))

    def test_read_all_returns_the_whole_body(self):
        from tools import health_check
        import io
        body = b'{"ok": 1}' * 20000
        self.assertEqual(health_check._read_all(io.BytesIO(body)), body)


if __name__ == '__main__':
    unittest.main()
