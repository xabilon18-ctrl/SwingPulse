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


if __name__ == '__main__':
    unittest.main()
