"""Check the 13F fund list (config.SMART_MONEY_FUNDS) against its rules.

Prints, per fund, from its own SEC filings: the quarters on file, the latest
book in $bn, how many stocks, and the share of its ten largest. Rules 2-5 of
config.py's list can be read straight off it; rule 1 (discretionary,
founder-led) is a judgement and is written next to the list.

    SEC_USER_AGENT="Name contact@address" python3 tools/holdings_report.py
    ... --extra 1037389:Renaissance 1350694:Bridgewater   # compare a candidate
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp')]
import holdings_feed as hf                                   # noqa: E402
from _active_config import SMART_MONEY_FUNDS                 # noqa: E402

MIN_YEARS, MIN_BOOK_BN, MIN_TOP10 = 10, 1.0, 50.0


def stats(quarters: dict) -> dict:
    qs = sorted(quarters)
    if not qs:
        return {}
    last = quarters[qs[-1]]
    vals = sorted((p['val'] for p in last['pos'].values()), reverse=True)
    total = sum(vals) or 1
    first_filing = qs[0]
    return {'first': first_filing, 'latest': qs[-1], 'quarters': len(qs),
            'book_bn': total / 1e9, 'stocks': len(vals), 'top10': sum(vals[:10]) / total * 100}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache')
    ap.add_argument('--since', default='2000-01-01', help='read filings from this quarter (years on file)')
    ap.add_argument('--extra', nargs='*', default=[], help='CIK:Name to compare')
    args = ap.parse_args()
    http = hf.Http(args.cache)
    funds = list(SMART_MONEY_FUNDS) + [
        {'id': 'x' + c, 'name': n, 'who': '(candidate)', 'ciks': [int(c)]}
        for c, n in (e.split(':', 1) for e in args.extra)]
    # Years on file come from the filing list alone; the book from the newest quarter.
    rows, newest = [], ''
    for f in funds:
        periods = sorted({r['period'] for c in f['ciks'] for r in hf.filings(http, c, args.since)})
        recent = {p: q for p, q in hf.fund_quarters(http, f, since=periods[-1] if periods else '9999', log=lambda *_: None).items()}
        s = stats(recent)
        s['first'] = periods[0] if periods else '-'
        newest = max(newest, s.get('latest', ''))
        rows.append((f, s))
    print(f'{"fund":24} {"who":30} {"since":>10} {"latest":>10} {"book $bn":>9} {"stocks":>6} {"top10%":>6}  rules')
    for f, s in rows:
        if not s.get('latest'):
            print(f'{f["name"]:24} no 13F-HR on file')
            continue
        years = (int(s['latest'][:4]) - int(s['first'][:4]))
        fails = [why for ok, why in ((years >= MIN_YEARS, f'<{MIN_YEARS}y'),
                                     (s['book_bn'] >= MIN_BOOK_BN, f'<${MIN_BOOK_BN:g}bn'),
                                     (s['top10'] >= MIN_TOP10, f'top10<{MIN_TOP10:g}%'),
                                     (s['latest'] == newest, 'stopped filing')) if not ok]
        print(f'{f["name"][:24]:24} {f["who"][:30]:30} {s["first"]:>10} {s["latest"]:>10} '
              f'{s["book_bn"]:9.1f} {s["stocks"]:6d} {s["top10"]:6.0f}  {", ".join(fails) or "pass"}')


if __name__ == '__main__':
    main()
