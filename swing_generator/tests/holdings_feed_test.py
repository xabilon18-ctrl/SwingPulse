"""webapp/holdings_feed.py, offline: no SEC, OpenFIGI or Yahoo request.

    python3 tests/holdings_feed_test.py
Also run from tests/htf_feed_test.py, which CI and the Weekly/Monthly job run.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp')]
import holdings_feed as hf   # noqa: E402

NS = 'http://www.sec.gov/edgar/document/thirteenf/informationtable'


def table(rows) -> bytes:
    def row(cusip, value, shares, kind='SH', put_call=''):
        pc = f'<putCall>{put_call}</putCall>' if put_call else ''
        return (f'<infoTable><nameOfIssuer>X</nameOfIssuer><titleOfClass>COM</titleOfClass>'
                f'<cusip>{cusip}</cusip><value>{value}</value><shrsOrPrnAmt><sshPrnamt>{shares}</sshPrnamt>'
                f'<sshPrnamtType>{kind}</sshPrnamtType></shrsOrPrnAmt>{pc}</infoTable>')
    return f'<informationTable xmlns="{NS}">{"".join(row(*r) for r in rows)}</informationTable>'.encode()


def test_units_and_rows():
    # Whole dollars: AAPL-like $200 a share stays as it is.
    pos = hf.parse_infotable(table([('037833100', 2_000_000, 10_000)]))
    assert pos['037833100']['val'] == 2_000_000
    # Thousands (Duquesne still files these in 2026): 192493 for 772600 shares
    # is $0.25 a share, so the whole filing is scaled by 1000.
    pos = hf.parse_infotable(table([('023135106', 192493, 772600), ('000899104', 22194, 2212810)]))
    assert pos['023135106']['val'] == 192_493_000
    # Options and principal amounts are not stock; a short CUSIP is zero-padded;
    # two rows of one CUSIP are summed.
    pos = hf.parse_infotable(table([('37833100', 1000, 5), ('37833100', 3000, 15),
                                    ('111111111', 9e9, 10, 'SH', 'Put'), ('222222222', 50, 50, 'PRN')]))
    assert set(pos) == {'037833100'} and pos['037833100']['sh'] == 20, pos


def q(total_other, **held):
    """A quarter: {ticker-as-cusip: (shares, value)} plus other stock."""
    pos = {c: {'sh': sh, 'val': v, 'filed': '2025-11-14'} for c, (sh, v) in held.items()}
    pos['OTHER'] = {'sh': 1, 'val': total_other, 'filed': '2025-11-14'}
    return {'pos': pos, 'filed': '2025-11-14', 'total': sum(p['val'] for p in pos.values())}


UNIVERSE = {'AAA': 'AAA', 'BBB': 'BBB', 'CCC': 'CCC', 'DDD': 'DDD', 'EEE': 'EEE'}
CMAP = {t: t for t in UNIVERSE}


def moves(quarters, splits=None, **kw):
    return {(m['t'], m['q']): m for m in hf.fund_moves('fx', quarters, CMAP, UNIVERSE,
                                                      lambda t: (splits or {}).get(t, []),
                                                      log=lambda *_: None, **kw)}


def test_actions():
    got = moves({
        '2025-06-30': q(1000, AAA=(100, 100), BBB=(100, 100), CCC=(100, 100), DDD=(100, 1)),
        '2025-09-30': q(1000, AAA=(50, 50), BBB=(110, 110), EEE=(10, 100), DDD=(10, 0.1)),
    })
    assert got[('AAA', '2025-09-30')]['a'] == 'cut'       # -50%
    assert ('BBB', '2025-09-30') not in got                # +10% is under the 25% bar
    assert got[('CCC', '2025-09-30')]['a'] == 'exit'
    assert got[('EEE', '2025-09-30')]['a'] == 'new'
    assert ('DDD', '2025-09-30') not in got                # under 0.5% of the book either side
    m = got[('AAA', '2025-09-30')]
    assert m['was'] == 100 and m['sh'] == 50 and m['usd'] == -50 and m['filed'] == '2025-11-14', m


def test_split_is_not_a_move():
    # A 10-for-1 split: ten times the shares at a tenth of the price.
    quarters = {'2024-03-31': q(1000, AAA=(100, 1000)), '2024-06-30': q(1000, AAA=(1000, 1000))}
    assert not moves(quarters, {'AAA': [('2024-06-10', 10.0)]})
    # Without the split known, the price check drops it rather than call it a 900% add.
    assert not moves(quarters)


def test_gap_breaks_the_chain():
    # 2025-03-31 missing: no exit or new is inferred across it.
    assert not moves({'2024-12-31': q(1000, AAA=(100, 100)), '2025-06-30': q(1000, BBB=(100, 100))})


def test_index_rollup():
    by_t = {'AAA': [{'q': '2025-09-30', 'f': 'a', 'a': 'cut', 'usd': -300, 'filed': '2025-11-14', 't': 'AAA'}],
            'BBB': [{'q': '2025-09-30', 'f': 'b', 'a': 'new', 'usd': 100, 'filed': '2025-11-13', 't': 'BBB'}]}
    inst = [{'name': 'US100', 'ticker': '^NDX', 'group': 'US Index', 'industry': 'Nasdaq 100'},
            {'name': 'AAA', 'ticker': 'AAA', 'group': 'US100', 'industry': 'Software'},
            {'name': 'BBB', 'ticker': 'BBB', 'group': 'US30/US100', 'industry': 'Semiconductors'}]
    out = hf.index_rollups(by_t, inst, hf.us_universe(inst))
    row = out['US100'][0]
    assert (row['buy'], row['sell'], row['net'], row['nb'], row['ns'], row['n']) == (100, -300, -200, 1, 1, 2), row
    assert row['top_s'][0][:3] == ['AAA', 'a', 'cut'] and row['filed'] == '2025-11-14'
    assert 'SOX' not in out          # no SOX instrument in this list


def test_universe():
    inst = [{'name': n, 'ticker': t} for n, t in
            (('A', 'BRK-B'), ('B', 'LSEG.L'), ('C', '^GSPC'), ('D', 'GC=F'), ('E', 'BTC-USD'), ('F', 'NVDA'))]
    assert hf.us_universe(inst) == {'BRK-B': 'A', 'NVDA': 'F'}


def main():
    for name, fn in list(globals().items()):
        if name.startswith('test_') and callable(fn):
            fn()
    print('holdings_feed_test: ok')


if __name__ == '__main__':
    main()
