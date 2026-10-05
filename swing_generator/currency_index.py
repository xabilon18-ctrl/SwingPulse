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

These are equal-weight indices, NOT TradingView's TVC:DXY family (DXY is a 6-currency
basket, 57.6% EUR), so the levels differ; the TradingView link points at the nearest
published index for a cross-check of direction.
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
TV_SYMBOL = {'USD': 'TVC:DXY', 'EUR': 'TVC:EXY', 'GBP': 'TVC:BXY', 'JPY': 'TVC:JXY',
             'CHF': 'TVC:SXY', 'CAD': 'TVC:CXY', 'AUD': 'TVC:AXY', 'NZD': 'TVC:ZXY'}


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
    if base is None:                       # daily build: a FIXED base date, else the first shared bar
        at = common[common >= pd.Timestamp(BASE_DATE)]
        b0 = at[0] if len(at) else common[0]
        base = {k: float(f.loc[b0, 'Close']) for k, f in comps.items()}
    out = {}
    for a in MAJORS:
        parts = [comps[(a, b)].loc[common] - base[(a, b)] for b in MAJORS if b != a]
        m = sum(parts) / len(parts)
        frame = 100 * np.exp(m)
        frame['High'] = frame[['High', 'Open', 'Close']].max(axis=1)
        frame['Low'] = frame[['Low', 'Open', 'Close']].min(axis=1)
        frame['Volume'] = 0
        out[a] = frame
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
    bp = cache_path('CCY_BASE').replace('.parquet', '.json')
    if not os.path.exists(bp):
        return 0
    raw = pd.read_json(bp, typ='series')
    base = {tuple(k.split('|')): float(v) for k, v in raw.items()}
    frames, _ = _build(read_5m, base=base, ffill_limit=6)
    for ccy, f in frames.items():
        f.index = f.index.tz_localize('UTC') if f.index.tz is None else f.index
        f.index.name = 'date'
        f.to_parquet(cache_path(ticker_of(ccy), suffix='5m'))
    return len(frames)
