"""
Macro event dates — the half of the calendar the price feed cannot know.

Two sources, both official and both re-fetchable, which was the bar set when
`events.MACRO_EVENTS` was deliberately left empty rather than hand-typed:

  1. FOMC meeting dates — federalreserve.gov's own calendar page. No key, no
     account, dates published years ahead (2021..2027 as of writing). Parsed
     from the `fomc-meeting__month` / `fomc-meeting__date` cell pair.
  2. Data release dates (CPI, PCE, payrolls, GDP…) — the FRED API's
     `release/dates` endpoint. Needs a free API key in `FRED_API_KEY`; without
     one this half returns [] and the FOMC half still ships.

What is still NOT here, and why: **speeches**. The Fed's speech RSS publishes a
speech when it is DELIVERED, not when it is scheduled — the entry for the
2026-08-28 Warsh speech is timestamped 14:00 GMT that same day. It is a record,
not a warning. The forward-looking events calendar on federalreserve.gov is
JavaScript-rendered (one date in the raw HTML), so getting speaking engagements
in advance needs a headless browser or a commercial feed. Neither is worth
adding to this pipeline yet.

Run standalone:
    python3 macro_events.py            # print what both sources return
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import urllib.request

FOMC_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'
FRED_API = 'https://api.stlouisfed.org/fred'

# A browser UA: federalreserve.gov answers Python-urllib with a challenge page.
# Same reason data_fetcher and sector_activity set one for r2.dev.
_UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
       '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

_MONTHS = {m: i for i, m in enumerate(
    ['January', 'February', 'March', 'April', 'May', 'June', 'July',
     'August', 'September', 'October', 'November', 'December'], start=1)}

# FRED release ids for the handful of prints that actually move a chart. Chosen
# rather than pulling every release: FRED carries hundreds, and a calendar that
# shows all of them is the noise problem this feature exists to avoid.
FRED_RELEASES = {
    10:  'US CPI',
    50:  'US jobs report',
    54:  'US PCE inflation',
    53:  'US GDP',
}

# Statement drops at 14:00 Eastern on the LAST day of the meeting. Stored as a
# display string on purpose — converting to the user's zone here would mean
# tracking US daylight-saving transitions in a file that has no other reason to
# know about them, and getting that wrong is worse than showing the zone.
FOMC_TIME = '14:00 ET'


def _get(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': _UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', errors='replace')


def fetch_fomc(today: dt.date | None = None) -> list[dict]:
    """FOMC decision dates from the Fed's own calendar page.

    The event is dated the LAST day of the meeting: a two-day meeting decides
    and publishes on day two, so dating it day one would warn a day early and
    show the wrong date on the sheet.
    """
    today = today or dt.date.today()
    try:
        html = _get(FOMC_URL)
    except Exception as e:
        print(f'  Macro: FOMC fetch failed — {type(e).__name__}: {e}')
        return []

    out: list[dict] = []
    # Year headings split the page into per-year panels
    parts = re.split(r'<a id="\d+">(\d{4}) FOMC Meetings</a>', html)
    for i in range(1, len(parts) - 1, 2):
        year = int(parts[i])
        body = parts[i + 1]
        months = re.findall(
            r'fomc-meeting__month[^>]*>\s*(?:<strong>)?([^<]+?)(?:</strong>)?\s*</div>', body)
        dates = re.findall(r'fomc-meeting__date[^>]*>\s*([^<]+?)\s*</div>', body)
        for mon_raw, date_raw in zip(months, dates):
            ev = _parse_meeting(year, mon_raw, date_raw)
            if ev and dt.date.fromisoformat(ev['date']) >= today:
                out.append(ev)
    return out


def _parse_meeting(year: int, mon_raw: str, date_raw: str) -> dict | None:
    """One meeting row → an event dict, or None if it cannot be read.

    Handles every shape the page actually uses:
        'January'  '27-28'              → 2026-01-28
        'March'    '17-18*'             → press conference
        'Jan/Feb'  '31-1'               → the 1st, in FEBRUARY (second month)
        'August'   '22 (notation vote)' → single day, no press conference
    """
    presser = '*' in date_raw
    # Strip the marker and any parenthetical note before reading the digits
    cleaned = date_raw.replace('*', '')
    note = re.search(r'\(([^)]+)\)', cleaned)
    cleaned = re.sub(r'\([^)]*\)', '', cleaned).strip()

    days = re.findall(r'\d+', cleaned)
    if not days:
        return None
    last_day = int(days[-1])

    # 'Jan/Feb' spans two months; the last day belongs to the SECOND one.
    month_names = [m.strip() for m in mon_raw.split('/')]
    name = month_names[-1] if len(month_names) > 1 and len(days) > 1 else month_names[0]
    month = _month_number(name)
    if not month:
        return None

    # A cross-month meeting that rolls into January is the NEXT year
    y = year
    if len(month_names) > 1 and month == 1 and _month_number(month_names[0]) == 12:
        y += 1

    try:
        date = dt.date(y, month, last_day)
    except ValueError:
        return None

    label = 'FOMC decision'
    if note:
        label += f' ({note.group(1).strip()})'
    elif presser:
        label += ' + press conference'

    return {
        'date':  date.isoformat(),
        'type':  'macro',
        # `title` and NOT `instrument`: everywhere else in the payload
        # `instrument` holds a name that resolves in signals.json and opens a
        # card. A rate decision is an event NAME with no instrument behind it,
        # and putting it in that field forced every consumer to branch on type
        # before it could trust the value. A row is now clickable exactly when
        # `instrument` is set. See CLAUDE.md > Event Calendar.
        'title': label,
        'time':  FOMC_TIME,
    }


def _month_number(name: str) -> int | None:
    name = name.strip()
    for full, num in _MONTHS.items():
        if full.lower().startswith(name.lower()[:3]):
            return num
    return None


def fetch_fred(today: dt.date | None = None, ahead_days: int = 120) -> list[dict]:
    """Upcoming release dates for the handful of prints that move markets.

    Returns [] and says so when FRED_API_KEY is unset — the FOMC half must not
    be held hostage to a key that may never be configured.
    """
    key = os.environ.get('FRED_API_KEY', '').strip()
    if not key:
        print('  Macro: FRED_API_KEY not set — skipping data releases '
              '(FOMC dates still included)')
        return []

    today = today or dt.date.today()
    hi = today + dt.timedelta(days=ahead_days)
    out: list[dict] = []
    for rel_id, label in FRED_RELEASES.items():
        url = (f'{FRED_API}/release/dates?release_id={rel_id}&api_key={key}'
               f'&file_type=json&include_release_dates_with_no_data=true'
               f'&realtime_start={today.isoformat()}&realtime_end={hi.isoformat()}')
        try:
            payload = json.loads(_get(url))
        except Exception as e:
            print(f'  Macro: FRED release {rel_id} failed — {type(e).__name__}: {e}')
            continue
        for row in payload.get('release_dates', []):
            d = row.get('date')
            if not d or not (today.isoformat() <= d <= hi.isoformat()):
                continue
            out.append({'date': d, 'type': 'macro', 'title': label})
    return out


def build_macro_events(today: dt.date | None = None) -> tuple[list[dict], dict]:
    """Everything macro, deduped and sorted, PLUS what actually loaded.

    Returns `(rows, sources)`. The UI prints a gap note driven by `sources`, so
    each feed must report on ITSELF: the old code set one `macro` flag from the
    combined list, which meant a FRED-only result (Fed page down, key present)
    made the app announce "FOMC dates are included" over a calendar holding
    none. A flag derived from a different source than the one it names is worse
    than no flag. Never raises into the pipeline.
    """
    sources = {'fomc': None, 'fred': None}
    try:
        fomc = fetch_fomc(today)
        fred = fetch_fred(today)
    except Exception as e:
        print(f'  Macro: SKIPPED — {type(e).__name__}: {e}')
        return [], sources

    # A feed counts as loaded only when it produced rows. The Fed publishes
    # meetings ~2 years ahead and FRED's window is the same 120 days the
    # calendar shows, so an empty list here means the fetch or the parse
    # failed — exactly the case the note must not paper over.
    if fomc:
        sources['fomc'] = FOMC_URL
    if fred:
        sources['fred'] = 'fred.stlouisfed.org'

    seen, uniq = set(), []
    for r in fomc + fred:
        k = (r['date'], r['title'])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)
    uniq.sort(key=lambda r: (r['date'], r['title']))
    print(f'  Macro: {len(uniq)} events ({len(fomc)} FOMC, {len(fred)} releases)')
    return uniq, sources


if __name__ == '__main__':
    rows, src = build_macro_events()
    for e in rows:
        print(f"  {e['date']}  {e['title']}"
              + (f"  [{e['time']}]" if e.get('time') else ''))
    print(f'  sources: {src}')
