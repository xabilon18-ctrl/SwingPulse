"""Fit + test the 10-day expected-move band (2026-09-27, Market Today tab).

Target: |ln(C[t+10]/C[t])|. Predictors at t (no look-ahead): rv20, rv250 (std
of daily log returns), atr_rank (ATR14 percentile vs its own last 252 values).
Model: log|r10| = a + b·log rv20 + c·log rv250 + d·atr_rank (OLS), fitted on
dates < 2022, sampled every 5 days. Band = exp(pred) × k, k picked on < 2022
so 50% / 80% of moves fall inside; coverage then measured on >= 2022.
"""
import os, sys, glob, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from instruments import load_instruments
from data_fetcher import _cache_path, scale_daily

H = 10
def feats(df):
    c = df['Close'].astype(float); h = df['High'].astype(float); l = df['Low'].astype(float)
    lr = np.log(c / c.shift(1))
    lr[(lr.abs() > 0.4)] = np.nan                     # split / bad-print guard
    rv20 = lr.rolling(20, min_periods=15).std()
    rv250 = lr.rolling(250, min_periods=200).std()
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = tr.rolling(14).mean() / c
    rank = atr.rolling(252, min_periods=200).apply(lambda w: (w[:-1] < w[-1]).mean(), raw=True)
    fwd = np.log(c.shift(-H) / c).abs()
    out = pd.DataFrame({'rv20': rv20, 'rv250': rv250, 'rank': rank, 'y': fwd})
    return out

rows = []
for inst in load_instruments():
    p = _cache_path(inst['ticker'])
    if not os.path.exists(p): continue
    try:
        df = scale_daily(inst['ticker'], pd.read_parquet(p)).dropna(subset=['Close'])
    except Exception: continue
    if len(df) < 400: continue
    f = feats(df).iloc[::5].dropna()
    f = f[(f.rv20 > 0) & (f.rv250 > 0)]
    f['date'] = pd.to_datetime(f.index).tz_localize(None) if getattr(f.index, 'tz', None) else pd.to_datetime(f.index)
    f['name'] = inst['name']
    rows.append(f)
d = pd.concat(rows)
d = d[d.date >= '2010-01-01']
d['ly'] = np.log(d.y.clip(lower=1e-5))
X = np.column_stack([np.ones(len(d)), np.log(d.rv20), np.log(d.rv250), d['rank']])
tr = (d.date < '2022-01-01').values; te = ~tr
beta, *_ = np.linalg.lstsq(X[tr], d.ly.values[tr], rcond=None)
pred = np.exp(X @ beta)
ratio = d.y.values / pred
k50, k80 = np.quantile(ratio[tr], 0.5), np.quantile(ratio[tr], 0.8)
print('n train', tr.sum(), 'n test', te.sum(), 'instruments', d.name.nunique())
print('beta', np.round(beta, 4), 'k50', round(k50, 3), 'k80', round(k80, 3))
for nm, m in (('train <2022', tr), ('test >=2022', te)):
    print(nm, 'cov50', round((ratio[m] <= k50).mean() * 100, 1), 'cov80', round((ratio[m] <= k80).mean() * 100, 1))
# by year + by atr_rank quintile on the test side
t = d[te].assign(r=ratio[te])
print(t.groupby(t.date.dt.year).r.apply(lambda s: round((s <= k80).mean() * 100, 1)).to_dict())
print(t.groupby(pd.qcut(t['rank'], 5, labels=False, duplicates='drop')).r.apply(lambda s: round((s <= k80).mean() * 100, 1)).to_dict())
# naive band: sqrt(10)*rv20 with its own k80 — does the model beat it?
nv = d.y.values / (np.sqrt(H) * d.rv20.values)
kn = np.quantile(nv[tr], 0.8)
print('naive rv20 band cov80 test', round((nv[te] <= kn).mean() * 100, 1),
      'median width model/naive test', round(np.median((pred * k80)[te]) / np.median((np.sqrt(H) * d.rv20.values * kn)[te]), 3))
# sharpness: spread of coverage by rank quintile for naive
tn = d[te].assign(r=nv[te])
print('naive by rank', tn.groupby(pd.qcut(tn['rank'], 5, labels=False, duplicates='drop')).r.apply(lambda s: round((s <= kn).mean() * 100, 1)).to_dict())
