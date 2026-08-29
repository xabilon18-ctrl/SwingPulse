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
  - macro (FOMC, CPI, ECB, SARB …) — NOT IMPLEMENTED. There is no free feed
    here worth trusting, and a hard-coded table of central-bank dates is worse
    than nothing: it looks authoritative, drifts silently the moment a meeting
    is moved, and would be read as fact off a phone. `MACRO_EVENTS` is
    deliberately empty and the front end renders the gap rather than hiding it.

Only equities are queried — an index, a currency pair, a commodity future and a
coin have no earnings date, so asking for one is 240-odd wasted requests.

Output: OUTPUT_DIR/events.json
    {
      "generated_at": "2026-08-29T18:04:11Z",
      "window": {"from": "2026-08-22", "to": "2026-12-27"},
      "sources": {"earnings": "yfinance", "macro": null},
      "events": [
        {"date":"2026-11-17","type":"earnings","instrument":"NVDA"},
        {"date":"2026-09-10","type":"exdiv","instrument":"NVDA"}
      ]
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

# Central-bank and inflation dates. EMPTY BY DESIGN — see the module docstring.
# Populate this only from a feed that can be re-fetched, never by hand.
MACRO_EVENTS: list[dict] = []


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

    rows.extend(MACRO_EVENTS)

    # Window, then sort by date so the front end can slice without re-sorting
    rows = [r for r in rows if lo <= r['date'] <= hi]
    rows.sort(key=lambda r: (r['date'], r['type'], r['instrument']))

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
        'sources': {'earnings': 'yfinance', 'macro': None},
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
            print(f"  {row['date']}  {row['type']:<9} {row['instrument']}")
        if len(data['events']) > 40:
            print(f"  … {len(data['events']) - 40} more")
