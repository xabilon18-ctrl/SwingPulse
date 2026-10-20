"""Earnings carry-forward (events.carry_forward, 2026-10-20), offline.

On the 15:05 UTC run Yahoo throttled the runner, 625/625 equities came back
empty and the calendar went out with macro rows only. A degraded lookup now
keeps the previous feed's rows for the instruments that returned nothing; a
healthy one carries nothing, so a date that really left Yahoo leaves ours.
"""
import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import events
from tools import shape_audit as audit

TODAY = dt.date.today()
def day(n): return (TODAY + dt.timedelta(days=n)).isoformat()

N = 100   # the audit's own floor is 70 events, so a smaller universe fails on size alone
INSTRUMENTS = [{'name': f'EQ{i}', 'ticker': f'EQ{i}', 'group': 'US Stocks'} for i in range(N)]
MACRO = [{'date': day(5), 'type': 'macro', 'title': 'FOMC decision'}]
PREVIOUS = {
    'generated_at': '2026-10-20T13:08:00Z',
    'carried': None,
    'events': [{'date': day(10), 'type': 'earnings', 'instrument': f'EQ{i}'} for i in range(N)]
              + [{'date': day(-30), 'type': 'earnings', 'instrument': 'EQ0'},      # out of window now
                 {'date': day(2), 'type': 'macro', 'title': 'old macro row'}],     # never carried
}


def build(answering, previous=PREVIOUS):
    """Run build_events with the named instruments answering and the rest empty."""
    calls = []
    def fetch(inst):
        if inst['name'] in answering:
            return [{'date': day(20), 'type': 'earnings', 'instrument': inst['name']}]
        return []
    def prev():
        calls.append(1)
        return previous
    orig = events._fetch_one, events.macro_events
    events._fetch_one = fetch
    events.macro_events = lambda: (list(MACRO), {'fomc': 'fed', 'fred': None})
    try:
        return events.build_events(INSTRUMENTS, previous=prev), len(calls)
    finally:
        events._fetch_one, events.macro_events = orig


def rows_for(payload, name):
    return [r['date'] for r in payload['events'] if r.get('instrument') == name]


class CarryForwardTests(unittest.TestCase):
    def test_healthy_run_carries_nothing(self):
        # 1 of 100 empty is 1%, under CARRY_MISS_SHARE: that stock's date is gone.
        payload, prev_calls = build({f'EQ{i}' for i in range(1, N)})
        self.assertEqual(prev_calls, 0, 'a healthy run does not even read the old feed')
        self.assertIsNone(payload['carried'])
        self.assertEqual(rows_for(payload, 'EQ0'), [])
        self.assertEqual(rows_for(payload, 'EQ1'), [day(20)])

    def test_throttled_run_keeps_the_previous_dates(self):
        payload, _ = build(set())
        self.assertEqual(payload['carried'], {'from': '2026-10-20T13:08:00Z', 'instruments': N})
        self.assertEqual(rows_for(payload, 'EQ0'), [day(10)], 'out-of-window row dropped')
        self.assertEqual(sum(r['type'] == 'earnings' for r in payload['events']), N)
        titles = [r.get('title') for r in payload['events'] if r['type'] == 'macro']
        self.assertEqual(titles, ['FOMC decision'], 'macro comes from this run, not the old feed')
        self.assertEqual(payload['sources']['earnings'], 'yfinance')

    def test_partial_throttle_carries_only_the_misses(self):
        answering = {f'EQ{i}' for i in range(75)}             # 25 of 100 empty
        payload, _ = build(answering)
        self.assertEqual(payload['carried']['instruments'], 25)
        self.assertEqual(rows_for(payload, 'EQ3'), [day(20)], 'an answer replaces the old date')
        self.assertEqual(rows_for(payload, 'EQ80'), [day(10)])

    def test_a_second_carry_keeps_the_first_fetch_time(self):
        again = dict(PREVIOUS, generated_at='2026-10-20T15:09:00Z',
                     carried={'from': '2026-10-20T13:08:00Z', 'instruments': N})
        payload, _ = build(set(), previous=again)
        self.assertEqual(payload['carried']['from'], '2026-10-20T13:08:00Z')

    def test_no_previous_feed_publishes_what_it_has(self):
        payload, _ = build(set(), previous=None)
        self.assertIsNone(payload['carried'])
        self.assertEqual([r['type'] for r in payload['events']], ['macro'])


class AuditTests(unittest.TestCase):
    def doc(self, carried_from):
        payload, _ = build(set(), previous=dict(PREVIOUS, generated_at=carried_from))
        return payload

    def test_carried_feed_warns_but_does_not_fail(self):
        now = dt.datetime.utcnow().replace(microsecond=0).isoformat() + 'Z'
        findings = audit.check_events(self.doc(now))
        self.assertFalse([f for f in findings if f[0] == 'FAIL'], findings)
        self.assertEqual(len([f for f in findings if 'carried from' in f[2]]), 1)

    def test_stale_carry_says_so(self):
        old = (dt.datetime.utcnow() - dt.timedelta(days=4)).replace(microsecond=0).isoformat() + 'Z'
        findings = audit.check_events(self.doc(old))
        self.assertTrue(any('over 3 days old' in f[2] for f in findings), findings)

    def test_empty_feed_without_carry_still_fails(self):
        payload, _ = build(set(), previous=None)
        self.assertTrue(any(f[0] == 'FAIL' for f in audit.check_events(payload)))


if __name__ == '__main__':
    unittest.main()
