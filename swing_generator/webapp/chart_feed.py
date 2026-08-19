#!/usr/bin/env python3
"""
Chart feed — compact OHLC + MA-ribbon bundles for the Charts reel.

Why this is not `history/`
--------------------------
`build_history` emits 600 bars as an array of objects with 20 named MA keys per
bar — ~250 KB per instrument. That is fine for one modal chart on demand and
impossible for a reel you scroll through: 1012 instruments x 2 timeframes of
that is half a gigabyte per publish, on an R2 upload that already sees 429s at
700 files.

So this feed trades away what a glance chart never uses:

  * 140 bars, not 600 — about what reads legibly on a phone.
  * Columnar arrays, not per-bar objects — the 24 repeated JSON keys per bar
    were most of the payload.
  * Instruments bundled into chunks — one fetch per ~25 cards scrolled, and
    ~80 uploaded files instead of ~2000.

All 20 MAs ship — the chart must show the ribbon the signals actually read —
but they ship at every MA_STRIDE'th bar. A 25-to-500 period mean is smooth at
bar resolution, and the ribbon is drawn dotted, so the dropped vertices are not
visible. Measured on 10 instruments at 520 bars: 40.0 KB per instrument
gzipped at full resolution, 18.8 KB at stride 3.

The 4H ribbon
-------------
4H ribbon periods are per-instrument: an instrument in H4_SESSION_NORMALIZE has
its periods scaled by bars-per-session (see main._h4_ma_periods and the H4 bar
geometry note in config.py). The chart MUST use the same periods the signals
fired from, so this calls that same function rather than assuming MA_PERIODS —
otherwise the reel would draw a ribbon that never produced the signal on the
card above it. Each bundle carries its own `p` (period list) for that reason.
"""

from __future__ import annotations

import concurrent.futures
import json
import math
import os
import sys

import pandas as pd

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, PROJECT_DIR)

from data_fetcher import h4_ticker                      # noqa: E402
from main import _resample_4h, _h4_ma_periods           # noqa: E402
from _active_config import MA_PERIODS                   # noqa: E402

# How many bars a card shows. Sized to the way these charts are actually read:
# roughly two years of daily bars, so the ribbon's full fan and any rollover in
# it are on screen. See the chart-presentation-style note.
BARS = 520

# Ribbon points are emitted every Nth bar (the last bar is always included).
# The MAs are smooth and drawn dotted, so this is invisible on screen and cuts
# the payload by more than half — the ribbon is ~80% of the bytes.
MA_STRIDE = 3

# Instruments per bundle. Only the FIRST card waits on a bundle — the reel
# prefetches the next one while you read — so this is sized for time-to-first-
# chart, ~95 KB gzipped, rather than for the fewest files.
CHUNK_SIZE = 5


def _round(v, digits=6):
    """Round to significant digits, NaN/inf -> None (JSON null)."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    if f == 0:
        return 0.0
    mag = math.floor(math.log10(abs(f)))
    return round(f, max(0, digits - 1 - mag))


def _ma_frame(df: pd.DataFrame, periods: list[int]) -> dict[int, pd.Series]:
    """Rolling means over the FULL series, so the tail is not warming up."""
    close = df['Close']
    return {p: close.rolling(p, min_periods=p).mean() for p in periods}


def _bundle(df: pd.DataFrame, periods: list[int], date_fmt: str) -> dict | None:
    """Columnar OHLC + ribbon for the last BARS rows of an indicator-ready df.

    No volume: these charts are read as price against the ribbon, and a volume
    strip would only take height away from the fan.
    """
    if df is None or df.empty or len(df) < 2:
        return None

    mas  = _ma_frame(df, periods)
    tail = df.tail(BARS)
    n    = len(tail)

    # Bar indices the ribbon is sampled at. The final bar is always present so
    # the ribbon reaches the right edge, where price meets it.
    keep = list(range(0, n, MA_STRIDE))
    if keep[-1] != n - 1:
        keep.append(n - 1)

    return {
        't':  [d.strftime(date_fmt) for d in tail.index],
        'o':  [_round(v) for v in tail['Open']],
        'h':  [_round(v) for v in tail['High']],
        'l':  [_round(v) for v in tail['Low']],
        'c':  [_round(v) for v in tail['Close']],
        'p':  periods,
        'ms': MA_STRIDE,
        'mi': keep,
        'm':  [[_round(v) for v in mas[p].tail(BARS).iloc[keep]] for p in periods],
    }


def build_daily(cache_dir: str, ticker: str) -> dict | None:
    path = os.path.join(cache_dir, _cache_name(ticker))
    if not os.path.exists(path):
        return None
    df = pd.read_parquet(path)
    periods = [p for p in MA_PERIODS if p <= len(df)]
    if not periods:
        return None
    return _bundle(df, periods, '%Y-%m-%d')


def build_4h(cache_dir: str, ticker: str) -> dict | None:
    # The hourly cache is keyed by the SOURCE ticker — a cash index redirected
    # through H4_SOURCE lands under the contract's name, not its own.
    src  = h4_ticker(ticker)
    path = os.path.join(cache_dir, _cache_name(src, suffix='1h'))
    if not os.path.exists(path):
        return None
    hourly = pd.read_parquet(path)
    if hourly.empty:
        return None
    h4 = _resample_4h(hourly)
    periods = _h4_ma_periods(h4, ticker)
    if len(periods) < 3:
        return None
    return _bundle(h4, periods, '%Y-%m-%d %H:%M')


def _cache_name(ticker: str, suffix: str = '') -> str:
    safe = (ticker
            .replace('=', '_EQ_')
            .replace('^', '_IDX_')
            .replace('.', '_DOT_'))
    tag = f'_{suffix}' if suffix else ''
    return f'{safe}{tag}.parquet'


def build_chart_feed(output_dir: str, cache_dir: str, ticker_map: dict,
                     max_workers: int = 8) -> dict:
    """Write chart/<tf>/<chunk>.json bundles + chart/index.json.

    ticker_map — instrument display name -> yfinance ticker.
    Returns {'D': n_instruments, '4H': n_instruments, 'chunks': n_files}.
    """
    chart_dir = os.path.join(output_dir, 'chart')
    os.makedirs(chart_dir, exist_ok=True)

    names = sorted(ticker_map)
    # Chunk on the sorted name list so an instrument's chunk id is stable
    # between publishes — the reel caches bundles across sessions.
    chunk_of = {n: i // CHUNK_SIZE for i, n in enumerate(names)}

    stats = {'D': 0, '4H': 0, 'chunks': 0}

    for tf, builder in (('D', build_daily), ('4H', build_4h)):
        tf_dir = os.path.join(chart_dir, tf)
        os.makedirs(tf_dir, exist_ok=True)

        bundles: dict[str, dict] = {}

        def _one(name):
            try:
                return name, builder(cache_dir, ticker_map[name])
            except Exception:
                # One unreadable parquet must not sink the whole feed. The
                # instrument simply shows "no chart data" on its card.
                return name, None

        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
            for name, payload in ex.map(_one, names):
                if payload:
                    bundles[name] = payload

        stats[tf] = len(bundles)

        grouped: dict[int, dict] = {}
        for name, payload in bundles.items():
            grouped.setdefault(chunk_of[name], {})[name] = payload

        for cid, group in grouped.items():
            with open(os.path.join(tf_dir, f'{cid}.json'), 'w') as f:
                json.dump({'tf': tf, 'bars': BARS, 'data': group},
                          f, separators=(',', ':'))
            stats['chunks'] += 1

    with open(os.path.join(chart_dir, 'index.json'), 'w') as f:
        json.dump({'chunk_size': CHUNK_SIZE, 'bars': BARS, 'chunks': chunk_of},
                  f, separators=(',', ':'))

    return stats
