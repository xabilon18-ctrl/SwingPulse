"""Instrument-level test: does the sector's 'flavour' on the day a signal fires
change what happens next? Re-runs the production engine per instrument to find
every B/S fire, tags each with its sector flavour that day, measures fwd returns.

Hypothesis (from the sector study): a BUY firing into a sell/mixed-thrust
('sinking') sector underperforms; a SELL there is confirmed.

Env: LIMIT=N to smoke-test on first N instruments.
"""
import json, os, sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pandas as pd

from _active_config import MA_PERIODS, VOLUME_LOOKBACK
from instruments import load_instruments, radar_sector_of
from data_fetcher import _cache_path
from indicators import add_all_indicators
from signals import add_signals
from backtest import TF_SIGNAL_PARAMS

CODES = {'B1', 'B2', 'B3', 'B4', 'S1', 'S2', 'S3', 'S4'}
BASELINE_DAYS = 20; MIN_BASELINE = 10; Z = 1.5
FWD = [5, 10, 20]
HARVEST_FROM = '2024-10-01'          # match activity-json span

# ---------------------------------------------------------------------------
# 1. Sector flavour per (date, sector) from the activity ledger (same as before)
# ---------------------------------------------------------------------------
def build_flavours():
    rows = json.load(open('output_ma500/sector_activity.json'))['rows']
    by_sector = defaultdict(list)
    for r in rows:
        by_sector[r['sector']].append(r)

    def zser(vals, floor):
        out = []
        for i in range(len(vals)):
            b = vals[max(0, i - BASELINE_DAYS):i]
            if len(b) < MIN_BASELINE:
                out.append(None); continue
            mu = sum(b) / len(b)
            sd = max((sum((x - mu) ** 2 for x in b) / len(b)) ** 0.5, floor)
            out.append((vals[i] - mu) / sd)
        return out

    blended_hot = defaultdict(int)
    tmp = {}
    for sector, recs in by_sector.items():
        recs.sort(key=lambda r: r['date'])
        m = recs[-1]['members']
        if m < 8:
            continue
        z_sig = zser([(r['buys'] + r['sells']) / m for r in recs], 0.5 / m)
        z_vol = zser([r['vol_spikes'] / m for r in recs], 0.5 / m)
        z_bl  = zser([r['rate'] for r in recs], 0.5 / m)
        for i, r in enumerate(recs):
            if z_bl[i] is not None and z_bl[i] >= Z:
                blended_hot[r['date']] += 1
            tot = r['buys'] + r['sells']
            tilt = ('buy' if tot and r['buys'] / tot >= 0.65 else
                    'sell' if tot and r['sells'] / tot >= 0.65 else
                    'mixed' if tot else 'none')
            tmp[(r['date'], sector)] = (z_sig[i], z_vol[i], tilt)

    flav = {}
    for (date, sector), (zs, zv, tilt) in tmp.items():
        if zs is None:
            flav[(date, sector)] = 'normal'; continue
        if blended_hot[date] >= 6:
            flav[(date, sector)] = 'market_wide'
        elif zs >= Z:
            flav[(date, sector)] = f'{tilt}_thrust' if tilt in ('buy', 'sell', 'mixed') else 'thrust_notilt'
        elif zv is not None and zv >= Z and zs < 1.0:
            flav[(date, sector)] = 'churn'
        else:
            flav[(date, sector)] = 'normal'
    return flav

# ---------------------------------------------------------------------------
# 2. Per-instrument fires + forward returns (production engine)
# ---------------------------------------------------------------------------
def fires_for(inst):
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
    df = add_signals(df, ma_periods=d_ma, **TF_SIGNAL_PARAMS['D'])
    sector = radar_sector_of(inst)
    col = next((c for c in df.columns if c.lower() == 'close'), 'Close')
    close = df[col].astype(float).to_numpy()
    sig = df['primary_signal'].to_numpy()
    dates = [str(d.date()) for d in pd.to_datetime(df.index)]
    out = []
    n = len(df)
    for i in range(n):
        code = sig[i]
        if code not in CODES:
            continue
        d = dates[i]
        if d < HARVEST_FROM:
            continue
        rets = {}
        ok = True
        for h in FWD:
            if i + h < n and close[i] > 0 and np.isfinite(close[i + h]) and close[i + h] > 0:
                rets[h] = close[i + h] / close[i] - 1.0
            else:
                ok = False
        if not ok:
            continue
        out.append((d, sector, code, rets))
    return out

# ---------------------------------------------------------------------------
# 3. Run
# ---------------------------------------------------------------------------
def main():
    insts = load_instruments()
    lim = int(os.environ.get('LIMIT', 0))
    if lim:
        insts = insts[:lim]
    flav = build_flavours()
    print(f'flavours: {len(flav)} sector-days | instruments: {len(insts)}')

    all_fires = []
    done = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for res in pool.map(fires_for, insts):
            all_fires.extend(res)
            done += 1
            if done % 100 == 0:
                print(f'  {done}/{len(insts)} instruments, {len(all_fires)} fires so far...')
    print(f'total fires harvested: {len(all_fires)}')

    # bucket: direction (B/S) x sector-flavour
    def dirn(code): return 'BUY' if code.startswith('B') else 'SELL'
    buckets = defaultdict(lambda: {h: [] for h in FWD})
    # merged 'sinking' = sell_thrust + mixed_thrust
    for d, sector, code, rets in all_fires:
        fl = flav.get((d, sector), 'no_flavour')
        for h in FWD:
            buckets[(dirn(code), fl)][h].append(rets[h])
            if fl in ('sell_thrust', 'mixed_thrust'):
                buckets[(dirn(code), 'SINKING(sell+mixed)')][h].append(rets[h])
            if fl == 'buy_thrust':
                buckets[(dirn(code), 'RISING(buy_thrust)')][h].append(rets[h])
            buckets[(dirn(code), 'ALL')][h].append(rets[h])

    def stat(vals, null):
        a = np.array(vals)
        if len(a) < 5:
            return None
        m = a.mean(); se = a.std(ddof=1) / np.sqrt(len(a))
        exc = m - null
        t = exc / se if se else 0.0
        return len(a), m, exc, t, (a > 0).mean() * 100

    for direction in ('BUY', 'SELL'):
        print(f'\n================ {direction} signals — forward return by sector mood ================')
        for h in FWD:
            null = np.mean(buckets[(direction, 'normal')][h]) if buckets[(direction, 'normal')][h] else 0.0
            print(f'  --- +{h}d (baseline = same signal in a NORMAL sector: {null*100:+.2f}%) ---')
            order = ['ALL', 'normal', 'RISING(buy_thrust)', 'SINKING(sell+mixed)',
                     'sell_thrust', 'mixed_thrust', 'buy_thrust', 'churn', 'market_wide']
            for fl in order:
                s = stat(buckets[(direction, fl)][h], null)
                if s:
                    n_, m, exc, t, win = s
                    flag = '  <== signif' if abs(t) >= 2 else ('  ~' if abs(t) >= 1.5 else '')
                    print(f'    {fl:<22} n={n_:>5}  fwd {m*100:+6.2f}%  excess {exc*100:+6.2f}%  t={t:+4.1f}  win% {win:3.0f}{flag}')

if __name__ == '__main__':
    main()
