#!/usr/bin/env python3
"""Re-capture tests/fixtures/fomc_calendar.html from the live Fed page.

The fixture is a TRIM of federalreserve.gov's FOMC calendar: the year anchors
and every fomc-meeting__month / __date cell, with their real class attributes
intact, and nothing else. Trimmed because the live page is 165 KB of navigation
chrome, and a fixture nobody can read is a fixture nobody checks.

Run this when tests/macro_events_test.py starts failing on the markup checks
rather than the date-notation ones — that is the signal the Fed changed the
page. Read the diff before committing it: a fixture refreshed on autopilot
turns a real regression into a green test.

    python3 tools/refresh_fomc_fixture.py
"""
from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import macro_events

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'tests', 'fixtures', 'fomc_calendar.html')

# Deliberately loose, matching the parser's own pattern. 27 of the 57 cells on
# the 2026-08-30 capture read `class="fomc-meeting--shaded fomc-meeting__month
# ..."` — the class the parser keys on is NOT first in the attribute, so a
# regex anchored to `class="fomc-meeting__month` silently keeps half the page.
CELL = re.compile(r'<div[^>]*fomc-meeting__(?:month|date)[^>]*>.*?</div>', re.S)
YEAR = re.compile(r'(<a id="\d+">\d{4} FOMC Meetings</a>)')

HEADER = """<!-- Trimmed from federalreserve.gov/monetarypolicy/fomccalendars.htm.
     Only what macro_events.fetch_fomc actually reads: the year anchors and
     every fomc-meeting__month / __date cell, in page order, with their real
     class attributes intact. BOTH month variants must survive the trim —
     roughly half the rows carry "fomc-meeting--shaded fomc-meeting__month",
     and a fixture holding only the plain variant tests half the page while
     looking complete. Regenerate with tools/refresh_fomc_fixture.py, and read
     the diff before committing it. -->
<html><body>"""


def main() -> int:
    html = macro_events._get(macro_events.FOMC_URL)
    parts = YEAR.split(html)
    if len(parts) < 3:
        print('No year panels found — the page structure has changed more than '
              'a refresh can absorb. Fix fetch_fomc first.')
        return 1

    out = [HEADER]
    cells = 0
    for i in range(1, len(parts), 2):
        out.append(parts[i])
        for m in CELL.finditer(parts[i + 1]):
            out.append(re.sub(r'\s+', ' ', m.group()).strip())
            cells += 1
    out.append('</body></html>')
    text = '\n'.join(out)

    shaded = text.count('fomc-meeting--shaded')
    if not shaded:
        print(f'Refusing to write: {cells} cells captured but none shaded. '
              'Either the page dropped the variant or the trim regex is wrong; '
              'both need a human before this fixture is trusted.')
        return 1

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(text)
    print(f'{OUT}\n  {cells} cells ({shaded} shaded), {len(text)} bytes')
    print('  Now run: python3 tests/macro_events_test.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
