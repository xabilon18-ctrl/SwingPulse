"""Event study: do radar 'flavours' predict forward sector returns?
Flavor 2 (directional thrust, isolated sector) vs Flavor 1 (churn / market-wide).
Measures equal-weight forward 5d/10d return of the sector's members, absolute
and market-relative (minus equal-weight all-universe return)."""
import json, os
from collections import defaultdict
import numpy as np
import pandas as pd
from instruments import load_instruments, radar_sector_of
from data_fetcher import _cache_path

BASELINE_DAYS = 20; MIN_BASELINE = 10; Z = 1.5
FWD = [5, 10, 20]

# ---- 1. sector membership ----
insts = load_instruments()
sec_members = defaultdict(list)
for i in insts:
    sec_members[radar_sector_of(i)].append(i['ticker'])
all_tickers = sorted({t for v in sec_members.values() for t in v})

# ---- 2. per-ticker forward returns keyed by date-string ----
fwd = {n: {} for n in FWD}          # fwd[n][ticker] = {date: return}
loaded = 0
for tk in all_tickers:
    p = _cache_path(tk)
    if not os.path.exists(p):
        continue
    try:
        df = pd.read_parquet(p)
    except Exception:
        continue
    col = next((c for c in df.columns if c.lower() == 'close'), None)
    if col is None or len(df) < 30:
        continue
    close = df[col].astype(float)
    dates = [str(d.date()) for d in pd.to_datetime(df.index)]
    for n in FWD:
        fret = (close.shift(-n) / close - 1.0).to_numpy()
        fwd[n][tk] = {dates[i]: fret[i] for i in range(len(dates)) if fret[i] == fret[i]}
    loaded += 1
print(f'loaded forward returns for {loaded} tickers')

# market baseline: equal-weight all-universe forward return per date
mkt = {n: defaultdict(list) for n in FWD}
for n in FWD:
    for tk, dd in fwd[n].items():
        for d, r in dd.items():
            mkt[n][d].append(r)
mkt_mean = {n: {d: float(np.mean(v)) for d, v in mkt[n].items()} for n in FWD}

def sector_fwd(sector, date, n):
    vals = [fwd[n][tk][date] for tk in sec_members[sector]
            if tk in fwd[n] and date in fwd[n][tk]]
    if not vals:
        return None
    abs_r = float(np.mean(vals))
    rel = abs_r - mkt_mean[n].get(date, 0.0)
    return abs_r, rel

# ---- 3. activity -> z_sig (directional breadth) and z_vol separately ----
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

# how many sectors 'hot' (blended z>=1.5) per date -> market-wide flag
blended_hot_by_date = defaultdict(int)
rec_index = {}   # (date,sector) -> row with z_sig,z_vol,tilt
for sector, recs in by_sector.items():
    recs.sort(key=lambda r: r['date'])
    m = recs[-1]['members']
    if m < 8:
        continue
    sig_rate = [(r['buys'] + r['sells']) / m for r in recs]
    vol_rate = [r['vol_spikes'] / m for r in recs]
    blend    = [r['rate'] for r in recs]
    z_sig = zser(sig_rate, 0.5 / m)
    z_vol = zser(vol_rate, 0.5 / m)
    z_bl  = zser(blend, 0.5 / m)
    for i, r in enumerate(recs):
        if z_bl[i] is not None and z_bl[i] >= Z:
            blended_hot_by_date[r['date']] += 1
        tot = r['buys'] + r['sells']
        tilt = 'buy' if tot and r['buys'] / tot >= 0.65 else \
               'sell' if tot and r['sells'] / tot >= 0.65 else \
               'mixed' if tot else 'none'
        rec_index[(r['date'], sector)] = {
            'z_sig': z_sig[i], 'z_vol': z_vol[i], 'tilt': tilt,
            'buys': r['buys'], 'sells': r['sells'], 'vspk': r['vol_spikes'], 'm': m}

# ---- 4. classify events + collect forward returns ----
buckets = defaultdict(lambda: {n: {'abs': [], 'rel': []} for n in FWD})
for (date, sector), r in rec_index.items():
    if r['z_sig'] is None:
        continue
    wide = blended_hot_by_date[date] >= 6           # market-wide churn day
    thrust = r['z_sig'] >= Z                          # directional breadth spike
    churn  = r['z_vol'] >= Z and (r['z_sig'] is None or r['z_sig'] < 1.0)

    tags = []
    if wide:
        tags.append('F1_marketwide')
    if churn and not thrust:
        tags.append('F1_churn_novol_dir')
    if thrust and not wide:
        if r['tilt'] == 'buy':
            tags.append('F2_buy_thrust')
        elif r['tilt'] == 'sell':
            tags.append('F2_sell_thrust')
        else:
            tags.append('F2_mixed_thrust')
    if not tags:
        tags.append('baseline_quiet')

    for n in FWD:
        sf = sector_fwd(sector, date, n)
        if sf is None:
            continue
        for t in tags:
            buckets[t][n]['abs'].append(sf[0])
            buckets[t][n]['rel'].append(sf[1])

# all sector-days baseline (the null)
for (date, sector) in rec_index:
    for n in FWD:
        sf = sector_fwd(sector, date, n)
        if sf:
            buckets['ALL_sector_days'][n]['abs'].append(sf[0])
            buckets['ALL_sector_days'][n]['rel'].append(sf[1])

# ---- 5. report ----
def line(name, n, d, null_mean):
    a = np.array(d['abs'])
    if len(a) == 0:
        print(f'  {name:<22} n=0'); return
    m = a.mean(); se = a.std(ddof=1) / np.sqrt(len(a)) if len(a) > 1 else float('nan')
    excess = m - null_mean
    t = excess / se if se else float('nan')     # excess vs baseline_quiet, in SEs
    hit = (a > 0).mean() * 100
    flag = '  <-- signif' if abs(t) >= 2 else ('  ~' if abs(t) >= 1 else '')
    print(f'  {name:<22} n={len(a):>4}  fwd {m*100:+6.2f}%  '
          f'excess {excess*100:+6.2f}%  t={t:+4.1f}  win% {hit:4.0f}{flag}')

order = ['F2_buy_thrust', 'F2_sell_thrust', 'F2_mixed_thrust',
         'F1_marketwide', 'F1_churn_novol_dir', 'baseline_quiet', 'ALL_sector_days']
for n in FWD:
    null_mean = np.mean(buckets['ALL_sector_days'][n]['abs'])   # the 'typical sector-day'
    print(f'\n===== forward {n}-day sector return by flavour (excess vs typical sector-day) =====')
    for name in order:
        if name in buckets:
            line(name, n, buckets[name][n], null_mean)
