"""One-off probe: does Yahoo carry a usable FUTURE for each cash index?

User, 2026-11-02: "i want future for all indices". The US indices and the
Nikkei already draw 5m/4H from their near-24h futures (config.H4_SOURCE:
^NDX -> NQ=F ...). The other cash indices are listed in
config.H4_SESSION_NORMALIZE as having "no usable yfinance future", but nothing
in the repo records that being measured. This measures it.

For every cash index it (1) asks Yahoo's search for FUTURE quotes on the
index's name, (2) adds likely tickers by hand, then (3) for each candidate
pulls 5 days of 5m bars and scores:

  hours   distinct UTC hours with a bar on the latest complete weekday
          (a 24h contract shows ~20-23; a cash index ~6-9)
  level   last futures close / last cash close - 1 (should be within a few %)
  corr    correlation of 5m returns with the cash index over shared bars
  age     how old the newest bar is

USABLE = hours >= 18, |level| <= 5%, corr >= 0.8, newest bar under 4 days old.
Runs in Actions (Yahoo is not reachable from the Claude sandbox):
.github/workflows/probe-index-futures.yml. Changes nothing in the app.

    python3 tools/probe_index_futures.py --report ../futures-probe.json
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

# app name, cash ticker, search phrases, hand-picked candidate tickers.
# Candidates are guesses on purpose: a wrong one simply returns no data.
TARGETS = [
    # Controls: known-good mappings from config.H4_SOURCE. If these do not come
    # out USABLE the probe's method is wrong, not the feed.
    ('US100 (control)', '^NDX', [], ['NQ=F']),
    ('NI225 (control)', '^N225', [], ['NKD=F']),
    # Europe
    ('DAX', '^GDAXI', ['DAX futures', 'FDAX'], ['FDAX=F', 'FDXM=F', 'DAX=F', 'DY=F']),
    ('EU50EUR', '^STOXX50E', ['Euro Stoxx 50 futures', 'FESX'], ['FESX=F', 'FX=F', 'SX5E=F', 'ESTX50=F']),
    ('FRA40', '^FCHI', ['CAC 40 futures'], ['FCE=F', 'CAC=F', 'FCH=F']),
    ('UK100', '^FTSE', ['FTSE 100 futures'], ['Z=F', 'FTSE=F', 'FFI=F', 'UKX=F']),
    ('NETH25', '^AEX', ['AEX futures'], ['FTI=F', 'AEX=F']),
    ('SPAIN35', '^IBEX', ['IBEX 35 futures'], ['IBEX=F', 'MFXI=F', 'FIBX=F']),
    ('IT40', 'FTSEMIB.MI', ['FTSE MIB futures'], ['FMIB=F', 'FIB=F', 'MIB=F']),
    ('SW20', '^SSMI', ['SMI futures'], ['FSMI=F', 'SMI=F']),
    # Americas
    ('SOX', '^SOX', ['PHLX Semiconductor futures', 'semiconductor index futures'], ['SOX=F', 'SMH=F']),
    ('CAN60', '^GSPTSE', ['S&P/TSX 60 futures'], ['SXF=F', 'TSX=F']),
    ('USDX', 'DX-Y.NYB', ['US Dollar Index futures'], ['DX=F']),
    # Asia-Pacific / Africa
    ('HANGSENG', '^HSI', ['Hang Seng futures'], ['HSI=F', 'MHI=F', 'HS=F']),
    ('CHINAH', '^HSCE', ['Hang Seng China Enterprises futures'], ['HHI=F', 'HCEI=F']),
    ('CHINA50', '2822.HK', ['FTSE China A50 futures'], ['CN=F', 'XINA50=F', 'A50=F']),
    ('NQTW', '^TWII', ['Taiwan index futures', 'TAIEX futures'], ['TW=F', 'TWN=F', 'STW=F']),
    ('SG30SGD', '^STI', ['Straits Times Index futures'], ['SGP=F', 'STI=F']),
    ('AUS200', '^AXJO', ['S&P/ASX 200 futures', 'SPI 200 futures'], ['AP=F', 'SPI=F', 'XJO=F']),
    ('SA40', '^J200.JO', ['JSE Top 40 futures'], ['ALSI=F', 'J200=F']),
]

MIN_HOURS, MAX_LEVEL, MIN_CORR, MAX_AGE_DAYS = 18, 0.05, 0.80, 4


def search_futures(phrase):
    """Yahoo search, FUTURE quotes only. Empty list if the search is unavailable."""
    try:
        res = yf.Search(phrase, max_results=25, news_count=0)
        quotes = res.quotes or []
    except Exception as exc:                       # older yfinance, rate limit, ...
        print(f'    search "{phrase}" failed: {exc}')
        return []
    return [(q.get('symbol'), q.get('shortname') or q.get('longname') or '', q.get('exchange') or '')
            for q in quotes if (q.get('quoteType') or '').upper() == 'FUTURE' and q.get('symbol')]


def bars(symbol):
    for attempt in range(3):
        try:
            df = yf.Ticker(symbol).history(period='5d', interval='5m', prepost=True, auto_adjust=False)
            if df is not None and len(df):
                idx = df.index.tz_convert('UTC') if df.index.tz is not None else df.index.tz_localize('UTC')
                df.index = idx
                return df
            return None
        except Exception:
            time.sleep(2 * (attempt + 1))
    return None


def score(cand, cash):
    df = bars(cand)
    if df is None or 'Close' not in df or df['Close'].dropna().empty:
        return {'symbol': cand, 'data': False}
    close = df['Close'].dropna()
    now = datetime.now(timezone.utc)
    weekdays = sorted({d for d in close.index.normalize() if d.weekday() < 5 and d.date() < now.date()})
    day = weekdays[-1] if weekdays else close.index[-1].normalize()
    hours = int(close[close.index.normalize() == day].index.hour.nunique())
    out = {'symbol': cand, 'data': True, 'bars': int(len(close)), 'day': str(day.date()), 'hours': hours,
           'last': float(close.iloc[-1]), 'last_at': close.index[-1].strftime('%Y-%m-%d %H:%M UTC'),
           'age_days': round((now - close.index[-1].to_pydatetime()).total_seconds() / 86400, 2),
           'level': None, 'corr': None}
    if cash is not None and len(cash):
        c = cash['Close'].dropna()
        out['level'] = round(float(close.iloc[-1]) / float(c.iloc[-1]) - 1, 4)
        # Align the CLOSES first, then take returns: returns taken separately
        # would set the cash index's overnight gap against one 5m futures move.
        joined = pd.concat([close, c], axis=1, join='inner').dropna().pct_change().dropna()
        if len(joined) >= 30:
            out['corr'] = round(float(joined.iloc[:, 0].corr(joined.iloc[:, 1])), 3)
    out['usable'] = bool(hours >= MIN_HOURS and out['level'] is not None and abs(out['level']) <= MAX_LEVEL
                         and out['corr'] is not None and out['corr'] >= MIN_CORR
                         and out['age_days'] <= MAX_AGE_DAYS)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--report', default='futures-probe.json')
    args = ap.parse_args()
    print(f'yfinance {yf.__version__}')
    results = []
    for name, cash_t, phrases, guesses in TARGETS:
        print(f'\n== {name} ({cash_t})')
        cash = bars(cash_t)
        cash_hours = None
        if cash is not None:
            c = cash['Close'].dropna()
            cash_hours = int(c[c.index.normalize() == c.index[-1].normalize()].index.hour.nunique())
        found = []
        for p in phrases:
            found += search_futures(p)
        names = {s: f'{n} [{e}]' for s, n, e in found}
        cands = list(dict.fromkeys([s for s, _, _ in found] + guesses))
        scored = []
        for cand in cands:
            r = score(cand, cash)
            r['found_by'] = 'search' if cand in names else 'guess'
            r['yahoo_name'] = names.get(cand, '')
            scored.append(r)
            if r['data']:
                print(f"  {cand:<14} {r['found_by']:<6} hours={r['hours']:>2} level={r['level']} "
                      f"corr={r['corr']} last={r['last_at']} {'USABLE' if r['usable'] else ''} {r['yahoo_name']}")
            else:
                print(f'  {cand:<14} {r["found_by"]:<6} no data')
        best = max((r for r in scored if r['data']), default=None,
                   key=lambda r: (r['usable'], r['hours'], r['corr'] or 0))
        results.append({'name': name, 'cash': cash_t, 'cash_hours': cash_hours,
                        'best': best['symbol'] if best and best['usable'] else None, 'candidates': scored})

    with open(args.report, 'w') as fh:
        json.dump({'generated_at': datetime.now(timezone.utc).isoformat(), 'yfinance': yf.__version__,
                   'results': results}, fh, indent=1)

    lines = ['| Index | Cash | Cash hours | Usable future | Hours | Level vs cash | Corr | Candidates with data |',
             '|---|---|---|---|---|---|---|---|']
    for r in results:
        b = next((c for c in r['candidates'] if c['symbol'] == r['best']), None)
        with_data = ', '.join(f"{c['symbol']}({c['hours']}h)" for c in r['candidates'] if c['data']) or '—'
        lines.append(f"| {r['name']} | {r['cash']} | {r['cash_hours'] if r['cash_hours'] is not None else '—'} | "
                     f"{r['best'] or '**none**'} | {b['hours'] if b else '—'} | "
                     f"{f'{b['level']:+.2%}' if b else '—'} | {b['corr'] if b else '—'} | {with_data} |")
    table = '\n'.join(lines)
    print('\n' + table)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as fh:
            fh.write('## Yahoo futures for cash indices\n\n' + table + '\n')
    controls_ok = all(r['best'] for r in results if '(control)' in r['name'])
    if not controls_ok:
        print('\nCONTROL FAILED: a known-good future did not score USABLE; the method needs fixing.')
        sys.exit(1)


if __name__ == '__main__':
    main()
