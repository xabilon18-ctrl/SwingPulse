"""The 8 major CURRENCY INDICES (2026-10-05, user: "create indices charts for the major 8").

One index per major currency — USD, EUR, GBP, JPY, CHF, CAD, AUD, NZD — measuring it
against the other seven, equally weighted, built from the 28 major pairs the pipeline
already downloads. No extra download, no Yahoo ticker: the frames are written into the
same caches as a real instrument (daily `<ticker>.parquet`, 5m `<ticker>_5m.parquet`),
so the signal workers, the chart feed, quotes and the channel rule read them like any
other instrument.

    index_X(t) = 100 * exp( mean over the 7 others Y of  ln(X in Y at t) - ln(X in Y at base) )

"X in Y" is the pair's price when the pair is XY and its inverse when it is YX. Base =
BASE_DATE (2 Jan 2015), so every index reads 100 there and the 5m
frame is scaled to the SAME base (the 30m and Daily charts read the same level).
Open and Close are exact; High/Low average the components' highs/lows (inverted pairs
swap them), which slightly overstates the bar's true range — components do not all
peak in the same minute. Volume is 0.

OTHER CURRENCIES (2026-10-30, MINORS below): ZAR, MXN, SGD, SEK, NOK, TRY, PLN,
HUF, CZK and CNY, each against all 8 majors through its USD pair. They are charts
and Watchlist rows only: the currency focus below still ranks the 8 majors.

These are equal-weight indices, NOT the ICE dollar index family (DXY is a 6-currency
basket, 57.6% EUR), so the levels differ.
"""
from __future__ import annotations

import os

import numpy as np
import pandas as pd

MAJORS = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD']
PREFIX = 'CCY_'                                   # synthetic tickers: CCY_USD ...
# Every index = 100 on this date, so a rebuilt cache (CI keeps 13 years) gives the same levels.
BASE_DATE = '2015-01-02'
_ORDER = ['EUR', 'GBP', 'AUD', 'NZD', 'USD', 'CAD', 'CHF', 'JPY']   # market convention: base first

# OTHER CURRENCIES (2026-10-30, user: "can we build currency index for other
# currencies"). Each is measured against all 8 majors, equal weight, through its
# USD pair: ln(M in Y) = ln(M in USD) + ln(USD in Y), the no-arbitrage cross the
# market quotes, from pairs already downloaded. HKD is left out: pegged to the
# dollar, its index would be the dollar's. Value: the USD pair, quoted USD/M.
MINORS = {'ZAR': 'USDZAR=X', 'MXN': 'USDMXN=X', 'SGD': 'USDSGD=X', 'SEK': 'USDSEK=X',
          'NOK': 'USDNOK=X', 'TRY': 'USDTRY=X', 'PLN': 'USDPLN=X', 'HUF': 'USDHUF=X',
          'CZK': 'USDCZK=X', 'CNY': 'CNY=X'}


def is_synthetic(ticker: str) -> bool:
    return str(ticker).startswith(PREFIX)


def ticker_of(ccy: str) -> str:
    return PREFIX + ccy


def _pair(a: str, b: str) -> tuple[str, bool]:
    """Yahoo ticker of the a/b market pair, and whether 'a in b' is its INVERSE."""
    x, y = sorted([a, b], key=_ORDER.index)
    return f'{x}{y}=X', x != a


def _logs(df: pd.DataFrame, invert: bool) -> pd.DataFrame:
    o, h, l, c = (np.log(df[k].astype(float)) for k in ('Open', 'High', 'Low', 'Close'))
    if invert:
        o, h, l, c = -o, -l, -h, -c
    return pd.DataFrame({'Open': o, 'High': h, 'Low': l, 'Close': c})


def _build(read, base: dict | None = None, ffill_limit: int = 3):
    """read(ticker) -> OHLC frame or None. Returns ({ccy: frame}, base logs used)."""
    comps = {}
    for a in MAJORS:
        for b in MAJORS:
            if a == b:
                continue
            t, inv = _pair(a, b)
            df = read(t)
            if df is None or df.empty or not {'Open', 'High', 'Low', 'Close'} <= set(df.columns):
                return {}, base
            df = df[['Open', 'High', 'Low', 'Close']].replace([np.inf, -np.inf], np.nan).dropna()
            df = df[(df > 0).all(axis=1)]
            comps[(a, b)] = _logs(df, inv)
    # Align on EVERY timestamp any pair printed, carrying a pair's last price forward
    # for a few bars: a quiet 5m forex bar is simply missing from Yahoo, and a strict
    # intersection of 28 pairs would drop that bar from all eight indices.
    union = None
    for f in comps.values():
        union = f.index if union is None else union.union(f.index)
    limit = ffill_limit
    comps = {k: f.reindex(union).ffill(limit=limit) for k, f in comps.items()}
    ok = np.logical_and.reduce([f['Close'].notna().values for f in comps.values()])
    common = union[ok]
    if len(common) < 10:
        return {}, base
    built_here = base is None
    if base is None:                       # daily build: a FIXED base date, else the first shared bar
        at = common[common >= pd.Timestamp(BASE_DATE)]
        b0 = at[0] if len(at) else common[0]
        base = {k: float(f.loc[b0, 'Close']) for k, f in comps.items()}
    out = {}
    def finish(m):
        frame = 100 * np.exp(m)
        frame['High'] = frame[['High', 'Open', 'Close']].max(axis=1)
        frame['Low'] = frame[['Low', 'Open', 'Close']].min(axis=1)
        frame['Volume'] = 0
        return frame
    for a in MAJORS:
        parts = [comps[(a, b)].loc[common] - base[(a, b)] for b in MAJORS if b != a]
        out[a] = finish(sum(parts) / len(parts))
    # Other currencies: M against the 8 majors = M in USD, plus USD in each major
    # (zero for USD itself), averaged over 8. Each is built on its own: a missing
    # or short pair costs that one index, never the eight.
    usd = sum(comps[('USD', b)].loc[common] - base[('USD', b)] for b in MAJORS if b != 'USD') / len(MAJORS)
    for m, t in MINORS.items():
        df = read(t)
        if df is None or df.empty or not {'Open', 'High', 'Low', 'Close'} <= set(df.columns):
            continue
        df = df[['Open', 'High', 'Low', 'Close']].replace([np.inf, -np.inf], np.nan).dropna()
        df = df[(df > 0).all(axis=1)]
        mu = _logs(df, True)                   # USD/M quoted: M in USD is its inverse
        mu = mu.reindex(mu.index.union(common)).ffill(limit=limit).loc[common].dropna()
        if len(mu) < 10:
            continue
        key = (m, 'USD')
        if key not in base:                    # a daily build fixes it; an intraday one without it skips M
            if not built_here:
                continue
            at = mu.index[mu.index >= pd.Timestamp(BASE_DATE)]
            base[key] = float(mu.loc[at[0] if len(at) else mu.index[0], 'Close'])
        out[m] = finish((mu - base[key]) + usd.loc[mu.index])
    return out, base


def build_daily(cache_path) -> dict:
    """Write CCY_<X>.parquet daily caches; returns {ticker: frame}."""
    def read(t):
        p = cache_path(t)
        return pd.read_parquet(p) if os.path.exists(p) else None
    frames, base = _build(read, ffill_limit=3)
    out = {}
    for ccy, f in frames.items():
        f.index.name = 'date'
        f.to_parquet(cache_path(ticker_of(ccy)))
        out[ticker_of(ccy)] = f
    if base:
        pd.Series({f'{a}|{b}': v for (a, b), v in base.items()}).to_json(cache_path('CCY_BASE').replace('.parquet', '.json'))
    return out


def build_5m(cache_path, read_5m) -> int:
    """Write CCY_<X>_5m.parquet from the pairs' 5m caches, on the daily base."""
    return _build_intraday(cache_path, read_5m, '5m', ffill_limit=6)


def build_1h(cache_path, read_1h) -> int:
    """Hourly indices use the same basket and daily base, without new sources."""
    return _build_intraday(cache_path, read_1h, '1h', ffill_limit=3)


def _build_intraday(cache_path, read, suffix, ffill_limit) -> int:
    bp = cache_path('CCY_BASE').replace('.parquet', '.json')
    if not os.path.exists(bp):
        return 0
    raw = pd.read_json(bp, typ='series')
    base = {tuple(k.split('|')): float(v) for k, v in raw.items()}
    frames, _ = _build(read, base=base, ffill_limit=ffill_limit)
    for ccy, f in frames.items():
        f.index = f.index.tz_localize('UTC') if f.index.tz is None else f.index
        f.index.name = 'date'
        f.to_parquet(cache_path(ticker_of(ccy), suffix=suffix))
    return len(frames)


# ── Currency focus (2026-10-05, user: "make me focus on two going in the opposite
# direction, then group the currency pairs affected by their cross current") ──
LOOKBACK = {'30m': pd.Timedelta(days=5), 'D': 20}    # strength = index % change over this


def focus(bundles: dict, reads: dict, name_of: dict) -> dict:
    """Per timeframe: the 8 currencies ranked by strength with the user's channel
    trend, the STRONGEST uptrend vs the WEAKEST downtrend, and the pairs their cross
    current runs through:
      main      the pair between the two
      strong_vs the strong currency against every OTHER downtrend currency
      weak_vs   every OTHER uptrend currency against the weak one
    Each pair carries the trade direction implied by the two currencies and its own
    channel trend, and `agree` when that pair's chart already trends that way.

    bundles[tf][name] — chart bundles; reads[tf][name] — channel_rule.read() tuples;
    name_of — Yahoo ticker -> display name (EURUSD=X -> EURUSD)."""
    out = {}
    for tf in ('30m', 'D'):
        B, R = bundles.get(tf, {}), reads.get(tf, {})
        rank = []
        for c in MAJORS:
            n = f'{c}_IDX'
            b = B.get(n)
            if not b or len(b['c']) < 30:
                continue
            C = b['c']
            if tf == '30m':
                t = pd.to_datetime(b['t'])
                k = int(t.searchsorted(t[-1] - LOOKBACK[tf]))
            else:
                k = max(0, len(C) - 1 - LOOKBACK[tf])
            lab, since = R.get(n, ('NEUTRAL', None))
            rank.append({'ccy': c, 'trend': lab, 'since': since, 'chg': round(100 * (C[-1] / C[k] - 1), 2)})
        if len(rank) < 2:
            continue
        rank.sort(key=lambda r: -r['chg'])
        ups = [r for r in rank if r['trend'] == 'UPTREND']
        downs = [r for r in rank if r['trend'] == 'DOWNTREND']
        confirmed = bool(ups and downs)
        S = max(ups, key=lambda r: r['chg'])['ccy'] if confirmed else rank[0]['ccy']
        W = min(downs, key=lambda r: r['chg'])['ccy'] if confirmed else rank[-1]['ccy']

        def pair(a, b):                    # trade a (strong side) against b (weak side)
            t, inv = _pair(a, b)
            name = name_of.get(t, t.replace('=X', ''))
            d = 'sell' if inv else 'buy'
            ptr = R.get(name, ('NEUTRAL', None))[0]
            return {'pair': name, 'dir': d, 'trend': ptr, 'strong': a, 'weak': b,
                    'agree': ptr == ('UPTREND' if d == 'buy' else 'DOWNTREND')}
        out[tf] = {
            'rank': rank, 'strong': S, 'weak': W, 'confirmed': confirmed,
            'main': pair(S, W),
            'strong_vs': [pair(S, r['ccy']) for r in downs if r['ccy'] != W] if confirmed else [],
            'weak_vs': [pair(r['ccy'], W) for r in ups if r['ccy'] != S] if confirmed else [],
        }
    return out

