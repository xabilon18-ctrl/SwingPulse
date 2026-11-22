"""Big-fund moves from SEC 13F filings, for the Monthly chart's markers.

User, 2026-11-22: show which big funds bought and sold a stock, as red and
green markers on the Monthly chart that open the details when tapped, with a
switch to hide them; and the same rolled up on the indices the stocks belong
to. The fund list and its rules are config.SMART_MONEY_FUNDS.

What a 13F is, and so what the markers can and cannot say:
  * A snapshot of a fund's US-listed long positions on the LAST DAY of a
    quarter, filed up to 45 days later. It does not say when in the quarter a
    trade was made, so a move belongs to the whole quarter, and the app says
    when it was disclosed.
  * Long stock and listed options only. Short positions and swaps are not in
    it, so a "cut" can be a hedge as much as a sale. Option rows are ignored
    here: their reported value is the underlying's, not the option's.
  * Only US-listed securities: UK, JSE and European stocks never appear.

Output, holdings.json (gzipped, plain name, like the other feeds):
  {built, since, rules: {min_w, min_chg}, funds: {id: {n, who}},
   latest: newest quarter in the data,
   stocks:  {instrument name: [move, ...]},
   indices: {instrument name: [quarter roll-up, ...]}}
A move: {q: quarter end, f: fund id, a: new|add|cut|exit, sh: shares now,
was: shares before (split-adjusted), w / wp: % of the fund's book now /
before, usd: shares bought (+) or sold (-) x the quarter-end price, filed}.

    python3 webapp/holdings_feed.py --output /tmp/h     # build, no upload
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from _active_config import (SMART_MONEY_FUNDS, SMART_MONEY_SINCE,          # noqa: E402
                            SMART_MONEY_MIN_WEIGHT, SMART_MONEY_MIN_CHANGE,
                            SMART_MONEY_INDEX_ROLLUPS)

# www.sec.gov refuses (403) a client whose User-Agent carries no contact
# address ("Name admin@domain"). It comes from the SEC_USER_AGENT secret; the
# build is skipped without it (publish_htf.py), never sent with a made-up one.
SEC_UA = os.environ.get('SEC_USER_AGENT', '').strip()
SEC_GAP_S = 0.12          # the SEC allows 10 requests a second; stay under it
OPENFIGI_URL = 'https://api.openfigi.com/v3/mapping'
# Every CUSIP looked up so far (cusip -> Yahoo ticker, '' = not a US equity).
# Committed, so a run only asks OpenFIGI about CUSIPs new since.
CUSIP_SEED = Path(__file__).with_name('holdings_cusips.json')
# 13F values were meant to switch from thousands to whole dollars with filings
# from 3 Jan 2023, but some funds (Duquesne, 2026) still file thousands. So the
# unit is read off each filing: a median implied price under $1 a share is a
# filing in thousands (real books trade at tens of dollars a share).
THOUSANDS_BELOW_PRICE = 1.0
# A held position whose implied quarter-end price moved more than this many
# times (after splits) is a data error (a bad CUSIP map, a unit slip), not a move.
MAX_PRICE_RATIO = 5.0


# ── HTTP ─────────────────────────────────────────────────────────────────────

class Http:
    """GET/POST with retries. Archive documents never change, so they are
    cached on disk when `cache_dir` is given (local reruns only)."""

    def __init__(self, cache_dir: str | None = None):
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self._last = 0.0
        self.requests = 0

    def _wait(self, gap):
        dt = time.monotonic() - self._last
        if dt < gap:
            time.sleep(gap - dt)
        self._last = time.monotonic()

    def get(self, url: str, *, cache: bool = True) -> bytes:
        path = None
        if cache and self.cache_dir:
            path = self.cache_dir / re.sub(r'[^A-Za-z0-9._-]', '_', url.split('://', 1)[-1])
            if path.exists():
                return path.read_bytes()
        body = self._fetch(urllib.request.Request(url, headers={
            'User-Agent': SEC_UA, 'Accept-Encoding': 'gzip'}), SEC_GAP_S)
        if path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
        return body

    def post_json(self, url: str, payload, headers: dict, gap: float):
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', **headers})
        return json.loads(self._fetch(req, gap))

    def _fetch(self, req, gap: float) -> bytes:
        for attempt in range(5):
            self._wait(gap)
            self.requests += 1
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    body = r.read()
                    if r.headers.get('Content-Encoding') == 'gzip':
                        body = gzip.decompress(body)
                    return body
            except urllib.error.HTTPError as e:
                if e.code == 403 and 'sec.gov' in req.full_url:
                    raise RuntimeError('SEC refused the request (403): SEC_USER_AGENT must be '
                                       '"Name contact@address" and under 10 requests a second') from e
                if e.code not in (429, 500, 502, 503, 504) or attempt == 4:
                    raise
                time.sleep(min(60, 2 ** attempt * (7 if e.code == 429 else 1)))
            except (urllib.error.URLError, TimeoutError):
                if attempt == 4:
                    raise
                time.sleep(2 ** attempt)
        raise RuntimeError('unreachable')


# ── SEC filings ──────────────────────────────────────────────────────────────

def _local(tag: str) -> str:
    return tag.rsplit('}', 1)[-1]


def _child(el, name):
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


def _text(el, *path) -> str:
    for name in path:
        el = _child(el, name) if el is not None else None
    return (el.text or '').strip() if el is not None and el.text else ''


def filings(http: Http, cik: int, since: str = SMART_MONEY_SINCE) -> list[dict]:
    """Every 13F-HR and 13F-HR/A this filer made for a quarter from `since`."""
    sub = json.loads(http.get(f'https://data.sec.gov/submissions/CIK{cik:010d}.json', cache=False))
    blocks = [sub['filings']['recent']]
    for f in sub['filings'].get('files', []):
        if f.get('filingTo', '9999') >= since:
            blocks.append(json.loads(http.get('https://data.sec.gov/submissions/' + f['name'], cache=False)))
    out, seen = [], set()
    for b in blocks:
        for i, form in enumerate(b['form']):
            period = b['reportDate'][i]
            if form not in ('13F-HR', '13F-HR/A') or not period or period < since:
                continue
            acc = b['accessionNumber'][i]
            if acc in seen:
                continue
            seen.add(acc)
            out.append({'cik': cik, 'form': form, 'period': period,
                        'filed': b['filingDate'][i], 'acc': acc})
    return sorted(out, key=lambda r: (r['period'], r['filed'], r['acc']))


def parse_infotable(raw: bytes, filed: str = '') -> dict:
    """{cusip: {sh, val, name}} for the long stock rows, values in dollars."""
    pos: dict = {}
    for it in ET.fromstring(raw).iter():
        if _local(it.tag) != 'infoTable':
            continue
        if _text(it, 'putCall'):
            continue
        if (_text(it, 'shrsOrPrnAmt', 'sshPrnamtType') or 'SH').upper() != 'SH':
            continue
        cusip = _text(it, 'cusip').upper().zfill(9)
        try:
            sh = float(_text(it, 'shrsOrPrnAmt', 'sshPrnamt').replace(',', '') or 0)
            val = float(_text(it, 'value').replace(',', '') or 0)
        except ValueError:
            continue
        p = pos.setdefault(cusip, {'sh': 0.0, 'val': 0.0, 'name': _text(it, 'nameOfIssuer')})
        p['sh'] += sh
        p['val'] += val
    prices = sorted(p['val'] / p['sh'] for p in pos.values() if p['sh'] > 0 and p['val'] > 0)
    if prices and prices[len(prices) // 2] < THOUSANDS_BELOW_PRICE:
        for p in pos.values():
            p['val'] *= 1000
    return pos


def filing_holdings(http: Http, f: dict) -> tuple[dict, str]:
    """(positions, amendment type) of one filing. The type is '' for an
    original, else RESTATEMENT or NEW HOLDINGS."""
    base = f'https://www.sec.gov/Archives/edgar/data/{f["cik"]}/{f["acc"].replace("-", "")}/'
    items = json.loads(http.get(base + 'index.json'))['directory']['item']
    xmls = [i['name'] for i in items if i['name'].lower().endswith('.xml')]
    kind = ''
    if f['form'].endswith('/A'):
        kind = 'RESTATEMENT'
        if 'primary_doc.xml' in xmls:
            prim = ET.fromstring(http.get(base + 'primary_doc.xml'))
            for el in prim.iter():
                if _local(el.tag) == 'amendmentType' and el.text:
                    kind = el.text.strip().upper()
    for name in sorted(xmls, key=lambda n: n == 'primary_doc.xml'):
        if name == 'primary_doc.xml':
            continue
        raw = http.get(base + name)
        if b'infoTable' in raw:
            return parse_infotable(raw), kind
    return {}, kind


def fund_quarters(http: Http, fund: dict, since: str = SMART_MONEY_SINCE, log=print) -> dict:
    """{quarter end: {pos: {cusip: {sh, val, name, filed}}, total, filed}}.

    Per filer: the original, then amendments in filing order (a restatement
    replaces the quarter, new holdings are added with their own filing date).
    Then per quarter, the filer with the larger book."""
    by_cik: dict = {}
    for cik in fund['ciks']:
        try:
            fs = filings(http, cik, since)
        except Exception as exc:
            log(f'  WARN {fund["id"]} CIK {cik}: {exc}')
            continue
        quarters: dict = {}
        for f in fs:
            try:
                pos, kind = filing_holdings(http, f)
            except Exception as exc:
                log(f'  WARN {fund["id"]} {f["acc"]}: {exc}')
                continue
            for p in pos.values():
                p['filed'] = f['filed']
            q = quarters.get(f['period'])
            if q is None or kind in ('', 'RESTATEMENT'):
                if kind == '' and q is not None and q.get('restated'):
                    continue          # an original filed after a restatement: keep the restatement
                quarters[f['period']] = {'pos': pos, 'filed': f['filed'], 'restated': kind == 'RESTATEMENT'}
            else:                     # NEW HOLDINGS
                for c, p in pos.items():
                    have = q['pos'].get(c)
                    if have:
                        have['sh'] += p['sh']
                        have['val'] += p['val']
                    else:
                        q['pos'][c] = p
        by_cik[cik] = quarters
    out: dict = {}
    for quarters in by_cik.values():
        for period, q in quarters.items():
            q['total'] = sum(p['val'] for p in q['pos'].values())
            if period not in out or q['total'] > out[period]['total']:
                out[period] = q
    return out


# ── CUSIP -> ticker ──────────────────────────────────────────────────────────

def load_cusip_seed(path: Path = CUSIP_SEED) -> dict:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def map_cusips(http: Http, cusips, known: dict, log=print) -> dict:
    """cusip -> Yahoo ticker ('' when OpenFIGI has no US equity for it),
    asking OpenFIGI only about the ones `known` does not hold. Without an
    OPENFIGI_API_KEY the service takes 25 requests of 10 a minute."""
    key = os.environ.get('OPENFIGI_API_KEY', '')
    batch, gap = (100, 0.3) if key else (10, 2.5)
    headers = {'X-OPENFIGI-APIKEY': key} if key else {}
    out = dict(known)
    todo = sorted(c for c in set(cusips) if c not in out)
    if todo:
        log(f'  OpenFIGI: {len(todo)} new CUSIPs')
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        try:
            res = http.post_json(OPENFIGI_URL, [{'idType': 'ID_CUSIP', 'idValue': c} for c in chunk],
                                 headers, gap)
        except Exception as exc:
            log(f'  WARN OpenFIGI: {exc}')
            continue                 # left unknown: asked again next run
        for c, r in zip(chunk, res):
            rows = r.get('data') or []
            us = [d for d in rows if d.get('exchCode') == 'US' and d.get('marketSector') == 'Equity']
            out[c] = (us[0]['ticker'].replace('/', '-').upper() if us and us[0].get('ticker') else '')
    return out


# ── Splits ───────────────────────────────────────────────────────────────────

def yahoo_splits(ticker: str) -> list[tuple[str, float]]:
    """[(YYYY-MM-DD, ratio)], ratio > 1 for a forward split. [] on failure:
    the price check in fund_moves then drops any quarter a split confused."""
    try:
        import yfinance as yf
        s = yf.Ticker(ticker).splits
        return [(d.strftime('%Y-%m-%d'), float(r)) for d, r in s.items() if r and r > 0]
    except Exception:
        return []


def split_factor(splits, after: str, upto: str) -> float:
    f = 1.0
    for d, r in splits:
        if after < d <= upto:
            f *= r
    return f


# ── Moves ────────────────────────────────────────────────────────────────────

def _qidx(period: str) -> int:
    y, m = int(period[:4]), int(period[5:7])
    return y * 4 + (m - 1) // 3


def us_universe(instruments: list[dict]) -> dict:
    """Yahoo ticker -> instrument name, for the US-listed stocks and ETFs."""
    out = {}
    for it in instruments:
        t = str(it.get('ticker') or '')
        if not t or t[0] == '^' or '=' in t or '.' in t or t.endswith('-USD') or t.startswith('CCY_'):
            continue
        if not re.fullmatch(r'[A-Z][A-Z0-9-]{0,9}', t):
            continue
        out[t] = it['name']
    return out


def by_ticker(pos: dict, cusip_ticker: dict, universe: dict) -> dict:
    """A quarter's positions summed per universe ticker (a CUSIP can change
    under the same ticker after a corporate action)."""
    out: dict = {}
    for c, p in pos.items():
        t = cusip_ticker.get(c)
        if not t or t not in universe:
            continue
        o = out.setdefault(t, {'sh': 0.0, 'val': 0.0, 'filed': p.get('filed')})
        o['sh'] += p['sh']
        o['val'] += p['val']
        o['filed'] = max(o['filed'] or '', p.get('filed') or '')
    return out


def fund_moves(fid: str, quarters: dict, cusip_ticker: dict, universe: dict, splits_of,
               min_w: float = SMART_MONEY_MIN_WEIGHT, min_chg: float = SMART_MONEY_MIN_CHANGE,
               log=print) -> list[dict]:
    """[move] for every pair of CONSECUTIVE quarters. A missing quarter breaks
    the chain: nothing is inferred across it."""
    periods = sorted(quarters)
    out = []
    for a, b in zip(periods, periods[1:]):
        if _qidx(b) - _qidx(a) != 1:
            continue
        A, B = quarters[a], quarters[b]
        if not A['total'] or not B['total']:
            continue
        ta, tb = by_ticker(A['pos'], cusip_ticker, universe), by_ticker(B['pos'], cusip_ticker, universe)
        for t in set(ta) | set(tb):
            pa, pb = ta.get(t, {'sh': 0.0, 'val': 0.0}), tb.get(t, {'sh': 0.0, 'val': 0.0, 'filed': None})
            wa, wb = pa['val'] / A['total'] * 100, pb['val'] / B['total'] * 100
            if max(wa, wb) < min_w:
                continue
            sh_a = pa['sh'] * (split_factor(splits_of(t), a, b) if pa['sh'] else 1.0)
            sh_b = pb['sh']
            if sh_a <= 0 and sh_b <= 0:
                continue
            if sh_a <= 0:
                act = 'new'
            elif sh_b <= 0:
                act = 'exit'
            else:
                chg = sh_b / sh_a - 1
                if abs(chg) * 100 < min_chg:
                    continue
                price_a, price_b = pa['val'] / sh_a, pb['val'] / sh_b
                if price_a <= 0 or not (1 / MAX_PRICE_RATIO < price_b / price_a < MAX_PRICE_RATIO):
                    log(f'  skip {fid} {t} {b}: price ratio {price_b / price_a if price_a else 0:.2f} (split or data error)')
                    continue
                act = 'add' if chg > 0 else 'cut'
            price = pb['val'] / sh_b if sh_b > 0 else (pa['val'] / sh_a if sh_a > 0 else 0)
            out.append({'q': b, 'f': fid, 'a': act, 'sh': round(sh_b), 'was': round(sh_a),
                        'w': round(wb, 2), 'wp': round(wa, 2), 'usd': round((sh_b - sh_a) * price),
                        'filed': pb.get('filed') or B['filed'], 't': t})
    return out


def index_rollups(moves_by_ticker: dict, instruments: list[dict], universe: dict) -> dict:
    """{index instrument name: [{q, filed, buy, sell, net, nb, ns, n, top_b, top_s}]}.
    top_b/top_s: up to three [stock name, fund id, act, usd]."""
    name_of = {it['name']: it for it in instruments}
    out = {}
    for idx_name, rule in SMART_MONEY_INDEX_ROLLUPS.items():
        if idx_name not in name_of:
            continue
        groups, ind = set(rule.get('groups', [])), rule.get('industry')
        members = {t for t, n in universe.items()
                   if (name_of[n].get('group') in groups)
                   or (ind and re.search(ind, str(name_of[n].get('industry') or ''), re.I))}
        per_q: dict = {}
        for t in members:
            for m in moves_by_ticker.get(t, []):
                per_q.setdefault(m['q'], []).append(m)
        rows = []
        for q in sorted(per_q):
            ms = per_q[q]
            buys = sorted((m for m in ms if m['usd'] > 0), key=lambda m: -m['usd'])
            sells = sorted((m for m in ms if m['usd'] < 0), key=lambda m: m['usd'])
            top = lambda xs: [[universe[m['t']], m['f'], m['a'], m['usd']] for m in xs[:3]]  # noqa: E731
            buy, sell = sum(m['usd'] for m in buys), sum(m['usd'] for m in sells)
            rows.append({'q': q, 'filed': max(m['filed'] for m in ms), 'buy': buy, 'sell': sell,
                         'net': buy + sell, 'nb': len({m['f'] for m in buys}),
                         'ns': len({m['f'] for m in sells}), 'n': len(members),
                         'top_b': top(buys), 'top_s': top(sells)})
        out[idx_name] = rows
    return out


# ── Build ────────────────────────────────────────────────────────────────────

def build(instruments: list[dict], http: Http | None = None, funds=SMART_MONEY_FUNDS,
          splits=yahoo_splits, built_on: str = '', log=print) -> tuple[dict, dict]:
    """(holdings.json payload, the CUSIP map after this run)."""
    if not SEC_UA:
        raise RuntimeError('SEC_USER_AGENT is not set')
    http = http or Http()
    universe = us_universe(instruments)
    log(f'13F: {len(funds)} funds, {len(universe)} US-listed instruments')
    quarters = {}
    for f in funds:
        quarters[f['id']] = fund_quarters(http, f, log=log)
        qs = sorted(quarters[f['id']])
        log(f'  {f["id"]}: {len(qs)} quarters {qs[0] if qs else "-"} .. {qs[-1] if qs else "-"}'
            f' ({http.requests} requests so far)')
    # Only a CUSIP that was ever big enough in a book to make a marker is looked up.
    need = {c for qs in quarters.values() for q in qs.values() if q['total']
            for c, p in q['pos'].items() if p['val'] / q['total'] * 100 >= SMART_MONEY_MIN_WEIGHT}
    cmap = map_cusips(http, need, load_cusip_seed(), log=log)
    cache: dict = {}

    def splits_of(t):
        if t not in cache:
            cache[t] = splits(t)
        return cache[t]

    moves = []
    for f in funds:
        moves += fund_moves(f['id'], quarters[f['id']], cmap, universe, splits_of, log=log)
    by_t: dict = {}
    for m in moves:
        by_t.setdefault(m['t'], []).append(m)
    stocks = {}
    for t, ms in by_t.items():
        stocks[universe[t]] = [{k: v for k, v in m.items() if k != 't'}
                               for m in sorted(ms, key=lambda m: (m['q'], m['f']))]
    latest = max((q for qs in quarters.values() for q in qs), default='')
    payload = {
        'built': built_on, 'since': SMART_MONEY_SINCE, 'latest': latest,
        'rules': {'min_w': SMART_MONEY_MIN_WEIGHT, 'min_chg': SMART_MONEY_MIN_CHANGE},
        'funds': {f['id']: {'n': f['name'], 'who': f['who']} for f in funds},
        'stocks': stocks,
        'indices': index_rollups(by_t, instruments, universe),
    }
    log(f'13F: {len(moves)} moves on {len(stocks)} instruments, latest quarter {latest}')
    return payload, cmap


def write(output: Path, payload: dict) -> Path:
    output.mkdir(parents=True, exist_ok=True)
    path = output / 'holdings.json'
    raw = json.dumps(payload, separators=(',', ':')).encode()
    with gzip.GzipFile(str(path), 'wb', compresslevel=9, mtime=0) as f:
        f.write(raw)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--output', required=True)
    ap.add_argument('--cache', help='keep SEC archive documents here between local runs')
    ap.add_argument('--save-cusips', action='store_true', help='rewrite the committed CUSIP map')
    args = ap.parse_args()
    from instruments import load_instruments
    import datetime as dt
    payload, cmap = build(load_instruments(), Http(args.cache),
                          built_on=dt.date.today().isoformat())
    print('wrote', write(Path(args.output), payload))
    if args.save_cusips:
        CUSIP_SEED.write_text(json.dumps(dict(sorted(cmap.items())), indent=0) + '\n')
        print('saved', len(cmap), 'CUSIPs to', CUSIP_SEED)


if __name__ == '__main__':
    main()
