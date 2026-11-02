"""List every FUTURE Yahoo will admit to, and flag the index futures.

User, 2026-11-02: "Get a list of all yahoo index futures". Yahoo publishes no
catalogue, so this sweeps its two discovery endpoints and keeps everything
tagged FUTURE:

  lookup  yf.Lookup(q).get_future(count=500)  (Yahoo's type=future lookup)
  search  yf.Search(q).quotes, quoteType == FUTURE

over a-z, 0-9, index names and exchange names. Each future is flagged INDEX
when its name reads like an equity index, and each index future gets 5 days
of 5m bars: distinct UTC hours on the latest complete weekday and the newest
bar. Writes the full list as JSON and the index futures as a Markdown table
(log + job summary). Read-only; runs in Actions because Yahoo is not
reachable from the Claude sandbox.

    python3 tools/list_yahoo_futures.py --report ../yahoo-futures.json
"""
import argparse
import json
import os
import re
import string
import time
from datetime import datetime, timezone

import yfinance as yf

INDEX_WORDS = [
    'index', 'indices', 'stoxx', 'dax', 'ftse', 'cac', 'nikkei', 's&p', 'sp 500', 'nasdaq', 'dow',
    'russell', 'hang seng', 'hsi', 'kospi', 'nifty', 'sensex', 'ibex', 'aex', 'smi', 'mib', 'asx',
    'spi', 'tsx', 'taiex', 'taiwan', 'msci', 'jse', 'top 40', 'topix', 'vix', 'straits', 'china a50',
    'a50', 'bovespa', 'ipc', 'omx', 'atx', 'wig', 'bist', 'sox', 'semiconductor', 'dollar index',
    'e-mini', 'micro e-mini', 'mini', 'set50', 'klci', 'psei', 'jci', 'tasi', 'tsx 60',
]
QUERIES = (
    list(string.ascii_lowercase) + list(string.digits)
    + ['index future', 'index futures', 'stock index', 'equity index', 'futures', 'e-mini', 'micro']
    + ['dax', 'stoxx', 'euro stoxx', 'ftse', 'cac', 'aex', 'ibex', 'mib', 'smi', 'omx', 'atx', 'wig',
       'nikkei', 'topix', 'hang seng', 'hsi', 'hscei', 'china', 'a50', 'taiwan', 'taiex', 'kospi',
       'nifty', 'sensex', 'asx', 'spi 200', 'straits', 'msci', 'tsx', 's&p', 'nasdaq', 'dow',
       'russell', 'vix', 'sox', 'semiconductor', 'dollar index', 'jse', 'top 40', 'bovespa', 'ipc']
    + ['eurex', 'ice', 'euronext', 'meff', 'idem', 'sgx', 'hkfe', 'ose', 'osaka', 'cme', 'cbot',
       'cboe', 'montreal', 'taifex', 'krx', 'nse', 'b3', 'safex']
)


def is_index(name, symbol):
    text = f' {name} {symbol} '.lower()
    return any(re.search(r'(?<![a-z])' + re.escape(w) + r'(?![a-z])', text) for w in INDEX_WORDS)


def lookup(q):
    try:
        df = yf.Lookup(q, timeout=30).get_future(count=500)
    except Exception as exc:
        return [], f'lookup failed: {exc}'
    if df is None or len(df) == 0:
        return [], None
    df = df.reset_index()
    sym_col = next((c for c in df.columns if c.lower() in ('symbol', 'index')), df.columns[0])
    rows = []
    for rec in df.to_dict('records'):
        rows.append({'symbol': str(rec.get(sym_col)),
                     'name': str(rec.get('shortName') or rec.get('longName') or rec.get('name') or ''),
                     'exchange': str(rec.get('exchange') or rec.get('exchDisp') or '')})
    return rows, None


def search(q):
    try:
        quotes = yf.Search(q, max_results=50, news_count=0).quotes or []
    except Exception as exc:
        return [], f'search failed: {exc}'
    return [{'symbol': x.get('symbol'), 'name': x.get('shortname') or x.get('longname') or '',
             'exchange': x.get('exchDisp') or x.get('exchange') or ''}
            for x in quotes if (x.get('quoteType') or '').upper() == 'FUTURE' and x.get('symbol')], None


def coverage(symbol):
    try:
        df = yf.Ticker(symbol).history(period='5d', interval='5m', prepost=True, auto_adjust=False)
    except Exception:
        return None
    if df is None or not len(df) or df['Close'].dropna().empty:
        return None
    close = df['Close'].dropna()
    close.index = close.index.tz_convert('UTC') if close.index.tz is not None else close.index.tz_localize('UTC')
    today = datetime.now(timezone.utc).date()
    days = sorted({d for d in close.index.normalize() if d.weekday() < 5 and d.date() < today})
    day = days[-1] if days else close.index[-1].normalize()
    return {'hours': int(close[close.index.normalize() == day].index.hour.nunique()),
            'last_at': close.index[-1].strftime('%Y-%m-%d %H:%M UTC'), 'last': round(float(close.iloc[-1]), 4)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--report', default='yahoo-futures.json')
    args = ap.parse_args()
    print(f'yfinance {yf.__version__}; {len(QUERIES)} queries')
    found, errors, per_query = {}, [], {}
    for q in QUERIES:
        n = 0
        for source, fn in (('lookup', lookup), ('search', search)):
            rows, err = fn(q)
            if err:
                errors.append(f'{source} "{q}": {err}')
            for r in rows:
                if not r['symbol'] or r['symbol'] == 'None':
                    continue
                entry = found.setdefault(r['symbol'], {**r, 'via': set()})
                entry['via'].add(source)
                if not entry['name'] and r['name']:
                    entry['name'] = r['name']
                n += 1
        per_query[q] = n
        time.sleep(0.4)
    print(f'{len(found)} distinct futures; {len(errors)} endpoint errors')
    for e in errors[:20]:
        print('  ' + e)
    print('Hits per query: ' + ', '.join(f'{q}={n}' for q, n in per_query.items()))

    allf = sorted(found.values(), key=lambda r: r['symbol'])
    for r in allf:
        r['via'] = sorted(r['via'])
        r['index'] = is_index(r['name'], r['symbol'])
    idx = [r for r in allf if r['index']]
    print(f'{len(idx)} look like index futures; measuring 5m coverage')
    for r in idx:
        r['coverage'] = coverage(r['symbol'])

    with open(args.report, 'w') as fh:
        json.dump({'generated_at': datetime.now(timezone.utc).isoformat(), 'yfinance': yf.__version__,
                   'queries': QUERIES, 'errors': errors, 'futures': allf}, fh, indent=1)

    lines = [f'## Yahoo index futures ({len(idx)} of {len(allf)} futures found)', '',
             '| Symbol | Name | Exchange | 5m hours/day | Newest bar |', '|---|---|---|---|---|']
    for r in sorted(idx, key=lambda r: (-(r['coverage'] or {}).get('hours', -1), r['symbol'])):
        c = r['coverage']
        lines.append(f"| {r['symbol']} | {r['name']} | {r['exchange']} | "
                     f"{c['hours'] if c else 'no 5m data'} | {c['last_at'] if c else ''} |")
    lines += ['', '### Every other future found', '',
              ', '.join(f"{r['symbol']} ({r['name']})" for r in allf if not r['index']) or 'none']
    text = '\n'.join(lines)
    print('\n' + text)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as fh:
            fh.write(text + '\n')


if __name__ == '__main__':
    main()
