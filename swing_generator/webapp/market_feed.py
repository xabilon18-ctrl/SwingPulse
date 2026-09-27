"""
market_feed.py — the Market tab's per-instrument numbers (2026-09-27).

For every instrument, from its daily bars, nothing entered by the user:
  * the 10-day expected-move band (config.EXPECTED_MOVE_*): the price range
    half / eight in ten 10-day moves stayed inside, as tested on 2022-2026;
  * quiet / normal / wild: today's ATR against its own last year (atr_rank).
    Measured 2026-09-11: this predicts how big the next moves are, not their
    direction — and a quiet market is NOT a coming breakout (the quietest
    decile moved 0.78x its usual amount next).

market.json: {'generated_at', 'model': {...}, 'i': {name: [close, lo80, hi80,
              pct50, pct80, atr_rank_pct, date]}}
"""
from __future__ import annotations

import concurrent.futures
import math
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from data_fetcher import _cache_path, scale_daily, drop_unfinished_daily
from _active_config import EXPECTED_MOVE_BETA, EXPECTED_MOVE_K, EXPECTED_MOVE_TEST_COVERAGE

QUIET_BELOW, WILD_ABOVE = 20, 80     # atr_rank percentiles


def _one(ticker: str):
    p = _cache_path(ticker)
    if not os.path.exists(p):
        return None
    df = scale_daily(ticker, drop_unfinished_daily(pd.read_parquet(p))).dropna(subset=['Close'])
    if len(df) < 260:
        return None
    c = df['Close'].astype(float)
    h = df['High'].astype(float)
    l = df['Low'].astype(float)
    lr = np.log(c / c.shift(1))
    lr[lr.abs() > 0.4] = np.nan                       # split / bad-print guard (as fitted)
    rv20 = lr.tail(20).std()
    rv250 = lr.tail(250).std()
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = (tr.rolling(14).mean() / c).tail(253).dropna()
    if len(atr) < 200 or not (rv20 > 0) or not (rv250 > 0):
        return None
    rank = float((atr.iloc[:-1] < atr.iloc[-1]).mean())
    a, b, cc, d = EXPECTED_MOVE_BETA
    size = math.exp(a + b * math.log(rv20) + cc * math.log(rv250) + d * rank)
    w50, w80 = size * EXPECTED_MOVE_K['50'], size * EXPECTED_MOVE_K['80']
    last = float(c.iloc[-1])
    rnd = lambda x: float(f'{x:.6g}')                 # noqa: E731
    return [rnd(last), rnd(last * math.exp(-w80)), rnd(last * math.exp(w80)),
            round((math.exp(w50) - 1) * 100, 2), round((math.exp(w80) - 1) * 100, 2),
            round(rank * 100), str(pd.Timestamp(c.index[-1]).date())]


def build_market(ticker_map: dict, max_workers: int = 8) -> dict:
    def run(name):
        try:
            return name, _one(ticker_map[name])
        except Exception:
            return name, None
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
        rows = {n: v for n, v in ex.map(run, sorted(ticker_map)) if v}
    return {
        'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'model': {'days': 10, 'coverage': EXPECTED_MOVE_TEST_COVERAGE,
                  'quiet_below': QUIET_BELOW, 'wild_above': WILD_ABOVE,
                  'tested': '2022-2026, not used to fit'},
        'i': rows,
    }
