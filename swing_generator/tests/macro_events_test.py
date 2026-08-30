#!/usr/bin/env python3
"""Unit tests for the FOMC calendar parser (macro_events.py).

Why this file exists: fetch_fomc is a set of regular expressions run against
someone else's HTML, which is the most breakable code in the pipeline. It
shipped with its shapes verified by hand and nothing committed, so a Fed
redesign would have produced zero rows, flipped sources.fomc to null, sent the
calendar quietly back to "no rate decisions loaded", and raised nothing.

Two layers:
  1. _parse_meeting against every date notation the page actually uses.
  2. fetch_fomc against a trimmed copy of the real page (tests/fixtures/), so a
     change in the surrounding markup is caught and not only a change in the
     date text.

No network. Run:  python3 tests/macro_events_test.py
"""
from __future__ import annotations

import datetime as dt
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import macro_events
from macro_events import _parse_meeting

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       'fixtures', 'fomc_calendar.html')

failures: list[str] = []


def check(label, got, want):
    if got == want:
        print(f'  ok    {label}')
    else:
        print(f'  FAIL  {label}\n          got  {got!r}\n          want {want!r}')
        failures.append(label)


# ---------------------------------------------------------------------------
# 1. Every date notation the page uses
# ---------------------------------------------------------------------------
print('_parse_meeting — date notations')

# An ordinary two-day meeting is dated day TWO: the statement lands when the
# meeting ends, so dating it day one would warn a day early and print the
# wrong date on the day sheet.
check('plain two-day', _parse_meeting(2026, 'January', '27-28')['date'], '2026-01-28')

# An asterisk marks a press conference. It must not reach the date digits.
m = _parse_meeting(2026, 'March', '17-18*')
check('asterisk -> date', m['date'], '2026-03-18')
check('asterisk -> title', m['title'], 'FOMC decision + press conference')

# A cross-month meeting belongs to the SECOND month — all three the page uses.
check('Jan/Feb 31-1', _parse_meeting(2026, 'Jan/Feb', '31-1')['date'], '2026-02-01')
check('Apr/May 30-1', _parse_meeting(2026, 'Apr/May', '30-1')['date'], '2026-05-01')
check('Oct/Nov 31-1', _parse_meeting(2026, 'Oct/Nov', '31-1')['date'], '2026-11-01')

# A meeting that rolls from December into January belongs to the NEXT year.
check('Dec/Jan rolls year', _parse_meeting(2026, 'Dec/Jan', '15-16')['date'], '2027-01-16')

# The 2025 notation vote: one day, a parenthetical, no press conference.
m = _parse_meeting(2025, 'August', '22 (notation vote)')
check('notation vote -> date',  m['date'],  '2025-08-22')
check('notation vote -> title', m['title'], 'FOMC decision (notation vote)')

# Schema: a macro row carries `title` and NO `instrument`. Everywhere else in
# the payload `instrument` names something that resolves in signals.json and
# opens a card; a rate decision has no card, and consumers test for the
# presence of `instrument` rather than branching on type.
m = _parse_meeting(2026, 'January', '27-28')
check('carries title',        'title' in m,          True)
check('carries no instrument', 'instrument' in m,    False)
check('carries a time',        m['time'],            '14:00 ET')

# Unreadable rows are dropped, never guessed at.
check('no digits -> None', _parse_meeting(2026, 'January', 'TBD'), None)
check('bad month -> None', _parse_meeting(2026, 'Smarch', '5-6'), None)


# ---------------------------------------------------------------------------
# 2. The surrounding markup, against a trimmed copy of the real page
# ---------------------------------------------------------------------------
print('\nfetch_fomc — real page markup')

fixture = io.open(FIXTURE, encoding='utf-8').read()
_real_get = macro_events._get
macro_events._get = lambda url, timeout=30: fixture
try:
    rows = macro_events.fetch_fomc(dt.date(2020, 1, 1))
finally:
    macro_events._get = _real_get

# The 2026-08-30 capture holds seven year panels: 8+9+8+8+8+8+8.
check('all meetings parsed', len(rows), 57)

# HALF THE PAGE uses `fomc-meeting--shaded fomc-meeting__month`, i.e. the class
# the regex keys on is NOT first in the attribute. A parser anchored to
# `class="fomc-meeting__month` would silently return 30 of 57 and look fine.
check('shaded variant present in fixture', 'fomc-meeting--shaded' in fixture, True)
check('shaded rows are parsed', len(rows) > 30, True)

check('every row is a macro row', {r['type'] for r in rows}, {'macro'})
check('every row has an ISO date',
      all(len(r['date']) == 10 and r['date'][4] == '-' for r in rows), True)
check('no row carries an instrument',
      any('instrument' in r for r in rows), False)
check('dates are unique', len({r['date'] for r in rows}), len(rows))

# The past filter is the only thing standing between the calendar and five
# years of history, so prove it actually filters.
macro_events._get = lambda url, timeout=30: fixture
try:
    future = macro_events.fetch_fomc(dt.date(2027, 1, 1))
finally:
    macro_events._get = _real_get
check('past meetings filtered out', all(r['date'] >= '2027-01-01' for r in future), True)
check('future window is non-empty', len(future) > 0, True)

# A dead feed returns [], never a partial list that reads as success.
macro_events._get = lambda url, timeout=30: '<html><body>redesigned</body></html>'
try:
    empty = macro_events.fetch_fomc(dt.date(2020, 1, 1))
finally:
    macro_events._get = _real_get
check('unrecognised page -> no rows', empty, [])


print()
if failures:
    print(f'FAILED — {len(failures)} of the checks above: {", ".join(failures)}')
    sys.exit(1)
print('macro_events: all checks passed')
