"""Phase 0 — sector-mood GO/NO-GO gate on REAL backtested trades.

Re-grades every daily B/S fire by its sector's flavour that day, but instead of
raw forward returns it runs each fire through backtest.simulate_trade for
production parity: entry at the NEXT bar's open, 2xATR(14) stop, 2:1 target,
D=30-bar time stop, 0.05%/side slippage, gap-fills at open, stop-before-target.
Buckets the resulting R by (direction x sector flavour) and compares each flavour
against the SAME signal firing in a NORMAL sector. Zero production changes.

Run:  cd swing_generator && PYTHONPATH=$PWD python3 research/flavour_phase0_R.py
Env:  LIMIT=N to smoke-test on the first N instruments.
"""
import os, sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # research/ dir

from _active_config import MA_PERIODS
from instruments import load_instruments, radar_sector_of
from data_fetcher import _cache_path
from indicators import add_all_indicators
from signals import add_signals
from backtest import simulate_trade, _add_atr, TF_SIGNAL_PARAMS
from instrument_flavour_check import build_flavours, CODES, HARVEST_FROM

TF = 'D'


def trades_for(inst):
    """Every daily fire since HARVEST_FROM, graded through simulate_trade → R."""
    path = _cache_path(inst['ticker'])
    if not os.path.exists(path):
        return []
    try:
        df = pd.read_parquet(path)
    except Exception:
        return []
    if len(df) < 250:
        return []
    df = add_all_indicators(df)
    d_ma = [p for p in MA_PERIODS if p <= len(df)]
    if len(d_ma) < 3:
        return []
    df = add_signals(df, ma_periods=d_ma, **TF_SIGNAL_PARAMS[TF])
    df = _add_atr(df)
    sector = radar_sector_of(inst)
    sig = df['primary_signal'].to_numpy()
    dates = [str(d.date()) for d in pd.to_datetime(df.index)]
    out = []
    for i in range(len(df)):
        code = sig[i]
        if code not in CODES:
            continue
        if dates[i] < HARVEST_FROM:
            continue
        side = 'long' if code[0] == 'B' else 'short'
        res = simulate_trade(df, i, side, TF)
        if res is None:
            continue
        out.append((dates[i], sector, code, res['r_multiple']))
    return out


def stat(vals, null):
    a = np.array(vals, dtype=float)
    if len(a) < 5:
        return None
    m = a.mean()
    se = a.std(ddof=1) / np.sqrt(len(a))
    exc = m - null
    t = exc / se if se else 0.0
    return len(a), m, exc, t, (a > 0).mean() * 100


def main():
    insts = load_instruments()
    lim = int(os.environ.get('LIMIT', 0))
    if lim:
        insts = insts[:lim]
    flav = build_flavours()
    print(f'flavours: {len(flav)} sector-days | instruments: {len(insts)}')

    all_trades = []
    done = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for res in pool.map(trades_for, insts):
            all_trades.extend(res)
            done += 1
            if done % 100 == 0:
                print(f'  {done}/{len(insts)} instruments, {len(all_trades)} trades so far...')
    print(f'total trades graded: {len(all_trades)}')

    def dirn(code): return 'BUY' if code[0] == 'B' else 'SELL'
    buckets = defaultdict(list)
    for d, sector, code, r in all_trades:
        fl = flav.get((d, sector), 'no_flavour')
        di = dirn(code)
        buckets[(di, fl)].append(r)
        buckets[(di, 'ALL')].append(r)
        if fl in ('sell_thrust', 'mixed_thrust'):
            buckets[(di, 'SINKING(sell+mixed)')].append(r)
        if fl in ('sell_thrust', 'mixed_thrust', 'churn'):
            buckets[(di, 'FIGHTING(sink+churn)')].append(r)

    order = ['ALL', 'normal', 'buy_thrust', 'FIGHTING(sink+churn)',
             'SINKING(sell+mixed)', 'sell_thrust', 'mixed_thrust', 'churn',
             'market_wide']
    print('\n(Shipped rules to confirm: SELL+sell_thrust = confirmed [+], '
          'BUY into FIGHTING = demote [-], SELL+market_wide = trap [-].)')
    for direction in ('BUY', 'SELL'):
        base = buckets[(direction, 'normal')]
        null = float(np.mean(base)) if base else 0.0
        print(f'\n===== {direction} — avg R by sector mood '
              f'(baseline = same signal, NORMAL sector: {null:+.3f}R) =====')
        for fl in order:
            s = stat(buckets[(direction, fl)], null)
            if s:
                n_, m, exc, t, win = s
                flag = '  <== signif' if abs(t) >= 2 else ('  ~' if abs(t) >= 1.5 else '')
                print(f'    {fl:<22} n={n_:>5}  avgR {m:+.3f}  '
                      f'vs-normal {exc:+.3f}R  t={t:+4.1f}  win% {win:3.0f}{flag}')


if __name__ == '__main__':
    main()
