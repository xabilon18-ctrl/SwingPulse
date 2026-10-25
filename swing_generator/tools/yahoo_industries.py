"""Replace each stock's industry in Instruments.txt with Yahoo's own label.

User, 2026-10-25: "Do it", on cleaning up the industry column. It had grown
by hand to 259 stock industries, 169 of them holding a single stock, with
near-duplicates ("Data Center REIT" / "Data Centre REIT") and one-off theme
labels ("AI Chip Inspection"), so the Sector › Industry filter listed dozens
of one-stock industries. Yahoo's industry is the standard list the column was
meant to follow (about 145 names: "Semiconductors", "Banks - Regional", ...).

Only the industry of a STOCK row changes. Crypto, index, commodity and
currency rows, every sector, group, name and ticker, and the file's layout are
left exactly as they are. A stock Yahoo gives no industry for keeps its old
label and is listed in the report. Sectors Yahoo files differently are only
REPORTED, never changed: the sector is part of the radar and the rotation
wheel, and moving one is a separate decision.

Needs Yahoo, so it runs in GitHub Actions (yahoo-industries.yml); the Claude
sandbox's network cannot reach it.

    python3 tools/yahoo_industries.py --report report.json [--write]
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from _active_config import INSTRUMENTS_FILE            # noqa: E402

NON_STOCK = {'Crypto', 'Index', 'Commodities', 'Currency'}
# num | ticker | name | group | sector | industry — everything up to the last
# separator is kept byte for byte; only the industry text is replaced.
ROW = re.compile(r'^(\s*\d+\s*\|\s*(\S+)\s*\|\s*\S+\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*)(.+?)\s*$')


def is_stock(m):
    """A stock row: not a crypto/index/commodity/currency sector, not in an
    index group (the XM indices carry a stock sector, but the app files any
    '... Index' group as an index, app.js assetClassOf) and not a Yahoo index
    ticker (^SOX sits in the US100 group with sector Technology)."""
    return (m.group(4) not in NON_STOCK and not m.group(3).endswith('Index')
            and not m.group(2).startswith('^'))


def clean(label):
    """Yahoo has written 'Software—Infrastructure' and 'Software - Infrastructure'."""
    return re.sub(r'\s*[—–]\s*', ' - ', label or '').strip()


def yahoo_profile(ticker, tries=3):
    import yfinance as yf
    for attempt in range(tries):
        try:
            info = yf.Ticker(ticker).info or {}
            return clean(info.get('industry')), clean(info.get('sector'))
        except Exception:                               # rate limit, timeout
            time.sleep(3 * (attempt + 1))
    return '', ''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--report', required=True, help='where to write the JSON report')
    ap.add_argument('--write', action='store_true', help='rewrite Instruments.txt')
    ap.add_argument('--pause', type=float, default=0.4, help='seconds between Yahoo calls')
    args = ap.parse_args()

    lines = Path(INSTRUMENTS_FILE).read_text(encoding='utf-8').splitlines(keepends=True)
    report = {'changed': [], 'unchanged': 0, 'missing': [], 'sector_differs': []}
    out = []
    for line in lines:
        m = ROW.match(line.rstrip('\n'))
        if not m or not is_stock(m):
            out.append(line)
            continue
        prefix, ticker, sector, old = m.group(1), m.group(2), m.group(4), m.group(5)
        industry, yahoo_sector = yahoo_profile(ticker)
        time.sleep(args.pause)
        if yahoo_sector and yahoo_sector != sector:
            report['sector_differs'].append({'ticker': ticker, 'ours': sector, 'yahoo': yahoo_sector})
        if not industry:
            report['missing'].append({'ticker': ticker, 'kept': old})
            out.append(line)
            continue
        if industry == old:
            report['unchanged'] += 1
        else:
            report['changed'].append({'ticker': ticker, 'old': old, 'new': industry})
        out.append(prefix + industry + ('\n' if line.endswith('\n') else ''))

    stocks = report['unchanged'] + len(report['changed']) + len(report['missing'])
    before = {}
    after = {}
    for line, new in zip(lines, out):
        for text, tally in ((line, before), (new, after)):
            m = ROW.match(text.rstrip('\n'))
            if m and is_stock(m):
                tally[m.group(5)] = tally.get(m.group(5), 0) + 1
    report['summary'] = {
        'stocks': stocks, 'changed': len(report['changed']), 'unchanged': report['unchanged'],
        'missing': len(report['missing']), 'sector_differs': len(report['sector_differs']),
        'industries_before': len(before), 'single_stock_before': sum(v == 1 for v in before.values()),
        'industries_after': len(after), 'single_stock_after': sum(v == 1 for v in after.values()),
    }
    Path(args.report).write_text(json.dumps(report, indent=1), encoding='utf-8')
    print(json.dumps(report['summary'], indent=1))
    # A Yahoo outage must not rewrite the file from a handful of answers.
    if args.write:
        if stocks and len(report['missing']) > 0.2 * stocks:
            sys.exit(f"{len(report['missing'])} of {stocks} stocks had no Yahoo industry; file left as it was")
        Path(INSTRUMENTS_FILE).write_text(''.join(out), encoding='utf-8')
        print('Instruments.txt rewritten')


if __name__ == '__main__':
    main()
