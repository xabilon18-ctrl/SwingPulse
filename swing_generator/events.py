"""
Scheduled-event feed for the calendar tab.

Answers one question the price engine cannot: *what is coming*. Every other
file here describes bars that have already closed; this one describes dates
that have not happened yet.

Sources, and their honesty:
  - earnings / ex-dividend — yfinance `Ticker.calendar`. REAL. Yahoo carries a
    confirmed-or-estimated next report date for most listed equities, and it is
    the same feed the price history already comes from, so there is no new
    dependency and no new failure mode.
  - macro (FOMC decisions, and US CPI/PCE/payrolls when a FRED key is set) —
    REAL, via macro_events.py. Both sources are official and re-fetchable, which
    was the condition for filling this at all; a hand-typed table of meeting
    dates was and remains off the table. Speeches are still absent: the Fed's
    speech feed publishes at DELIVERY, not in advance, so it could not have
    warned about the 2026-08-28 Warsh speech that prompted this work.

Only equities are queried — an index, a currency pair, a commodity future and a
coin have no earnings date, so asking for one is 240-odd wasted requests.

Output: OUTPUT_DIR/events.json
    {
      "generated_at": "2026-08-29T18:04:11Z",
      "window": {"from": "2026-08-22", "to": "2026-12-27"},
      "sources": {"earnings": "yfinance", "fomc": "https://...", "fred": null,
                  "speeches": null},
      "events": [
        {"date":"2026-11-17","type":"earnings","instrument":"NVDA"},
        {"date":"2026-09-10","type":"exdiv","instrument":"NVDA"},
        {"date":"2026-09-16","type":"macro","title":"FOMC decision",
         "time":"14:00 ET"}
      ]

    An equity row carries `instrument` (a name that resolves in signals.json).
    A macro row carries `title` and NO instrument — it is an event, not a
    thing you can hold. Consumers test for `instrument`, never for `type`.
    }

Run standalone:
    python3 events.py            # rebuild events.json
    python3 events.py --report   # rebuild and print what was found
"""

from __future__ import annotations

import concurrent.futures
import datetime as dt
import json
import os
import sys
import warnings

from _active_config import OUTPUT_DIR
from instruments import load_instruments, asset_class_of

warnings.filterwarnings('ignore')

EVENTS_PATH = os.path.join(OUTPUT_DIR, 'events.json')

# How far either side of today the calendar carries events. The UI shows a
# month at a time and swipes one month either way, so a quarter forward covers
# every panel reachable without a second fetch; a week back keeps a date that
# has just passed visible rather than vanishing mid-session.
PAST_DAYS   = 7
FUTURE_DAYS = 120

# Matches data_fetcher.FETCH_WORKERS' default. `calendar` is a small metadata
# call (~0.1s each at 8 workers, measured over 12 tickers), so the whole equity
# universe costs well under two minutes on top of a ~20-minute pipeline run.
WORKERS = int(os.environ.get('FETCH_WORKERS', 8))

def macro_events() -> tuple[list[dict], dict]:
    """Central-bank and inflation dates, from macro_events.py.

    Was an empty list until 2026-08-29, held that way because a hand-typed table
    of meeting dates goes stale silently. It is populated now only because both
    sources can be RE-FETCHED: the Fed's own calendar page (no key) and the FRED
    release API (free key in FRED_API_KEY). Without the key the FOMC half still
    ships on its own.

    Returns `(rows, sources)` — see build_macro_events for why each feed has to
    report on itself rather than sharing one flag.
    """
    try:
        from macro_events import build_macro_events
        return build_macro_events()
    except Exception as e:
        print(f'  Events: macro sources unavailable — {type(e).__name__}: {e}')
        return [], {'fomc': None, 'fred': None}


def _iso(d) -> str | None:
    """Normalise yfinance's mixed date/datetime/Timestamp to 'YYYY-MM-DD'."""
    if d is None:
        return None
    if isinstance(d, dt.datetime):
        return d.date().isoformat()
    if isinstance(d, dt.date):
        return d.isoformat()
    # pandas Timestamp and anything else that knows its own date
    try:
        return d.date().isoformat()
    except Exception:
        return None


# NB there is deliberately no time-of-day on an earnings row. `Ticker.calendar`
# returns a bare date for every ticker (measured: 0 of 542 carried a time), and
# the endpoint that does carry one — get_earnings_dates — costs 0.42s per ticker
# against calendar's 0.10s and only populates it for US listings. That is a 4x
# fetch for a field that would render on some rows and not others; the date is
# what decides whether you hold into a report. If macro events ever land here
# they can carry their own time, where the minute genuinely matters.


def _fetch_one(inst: dict) -> list[dict]:
    """Earnings + ex-dividend rows for one instrument, or [] if unavailable."""
    import yfinance as yf
    try:
        cal = yf.Ticker(inst['ticker']).calendar or {}
    except Exception:
        return []

    name = inst['name']
    out  = []

    earnings = cal.get('Earnings Date') or []
    if not isinstance(earnings, (list, tuple)):
        earnings = [earnings]
    for raw in earnings:
        iso = _iso(raw)
        if not iso:
            continue
        out.append({'date': iso, 'type': 'earnings', 'instrument': name})

    exdiv = _iso(cal.get('Ex-Dividend Date'))
    if exdiv:
        out.append({'date': exdiv, 'type': 'exdiv', 'instrument': name})

    return out


def build_events(instruments: list[dict] | None = None) -> dict:
    """Fetch the equity event feed and return the payload dict."""
    instruments = instruments if instruments is not None else load_instruments()
    equities = [i for i in instruments if asset_class_of(i['group']) == 'Equity']

    today = dt.date.today()
    lo    = (today - dt.timedelta(days=PAST_DAYS)).isoformat()
    hi    = (today + dt.timedelta(days=FUTURE_DAYS)).isoformat()

    print(f'  Events: querying {len(equities)} equities for earnings dates ...')

    rows: list[dict] = []
    misses = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(WORKERS, 1)) as ex:
        for got in ex.map(_fetch_one, equities):
            if got:
                rows.extend(got)
            else:
                misses += 1

    macro, macro_sources = macro_events()
    rows.extend(macro)

    # Window, then sort by date so the front end can slice without re-sorting
    rows = [r for r in rows if lo <= r['date'] <= hi]
    # A macro row has no `instrument` — it carries `title` instead (see the
    # module docstring). Sorting on a key that only most rows have is exactly
    # how the first version of this crashed into the never-fatal guard.
    rows.sort(key=lambda r: (r['date'], r['type'], r.get('instrument') or r.get('title') or ''))

    by_type: dict[str, int] = {}
    for r in rows:
        by_type[r['type']] = by_type.get(r['type'], 0) + 1
    summary = ' · '.join(f'{k} {v}' for k, v in sorted(by_type.items())) or 'none'
    print(f'  Events: {len(rows)} in window ({summary}); '
          f'{misses}/{len(equities)} equities returned nothing')

    return {
        'generated_at': dt.datetime.now(dt.timezone.utc)
                          .replace(microsecond=0).isoformat().replace('+00:00', 'Z'),
        'window':  {'from': lo, 'to': hi},
        # The UI states the gap out loud, so it has to know what actually
        # loaded — not what was intended, and not what a NEIGHBOURING feed did.
        # Each flag is set by the fetcher it names (see build_macro_events).
        # `speeches` is permanently null and documented as such: the Fed's
        # speech feed publishes at delivery, so there is nothing to load.
        'sources': {
            'earnings': 'yfinance' if any(r['type'] != 'macro' for r in rows) else None,
            'fomc':     macro_sources.get('fomc'),
            'fred':     macro_sources.get('fred'),
            'speeches': None,
        },
        'events':  rows,
    }


def write_events(instruments: list[dict] | None = None) -> dict:
    """Build the feed and write it to OUTPUT_DIR/events.json.

    Never raises into the pipeline: an event feed is a nice-to-have beside the
    signals, and a Yahoo outage on the metadata endpoint must not cost a day of
    market data. On failure the previous events.json is left in place.
    """
    try:
        payload = build_events(instruments)
    except Exception as e:
        print(f'  Events: SKIPPED — {type(e).__name__}: {e}')
        return {}

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(EVENTS_PATH, 'w') as f:
        json.dump(payload, f, separators=(',', ':'))
    print(f'  Events: {EVENTS_PATH}')
    return payload


if __name__ == '__main__':
    data = write_events()
    if '--report' in sys.argv and data:
        for row in data['events'][:40]:
            label = row.get('instrument') or row.get('title') or ''
            print(f"  {row['date']}  {row['type']:<9} {label}")
        if len(data['events']) > 40:
            print(f"  … {len(data['events']) - 40} more")
