#!/usr/bin/env python3
"""
Chart feed — compact OHLC + MA-ribbon bundles for the Charts reel.

Why this is not the old `history/` feed
---------------------------------------
That feed emitted 600 bars as an array of objects with 20 named MA keys per bar
— ~250 KB per instrument. Fine for one modal chart on demand, impossible for a
reel you scroll through: 736 instruments x 2 timeframes of it is well over half
a gigabyte per publish, on an R2 upload that already sees 429s at 700 files. It
has since been deleted; this feed replaced it for the sparklines too.

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

The bundles are WRITTEN gzipped, under their plain .json names, and uploaded
with Content-Encoding: gzip. R2's public r2.dev endpoint does no compression of
its own — verified: a chunk came back byte-identical with and without
Accept-Encoding — so an uncompressed feed would cost 51 KB per chart on a phone
instead of 19 KB. Browsers decompress transparently, so the URLs and the fetch
code are unchanged.

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
import gzip
import json
import math
import os
import sys

import pandas as pd

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, PROJECT_DIR)

from data_fetcher import h4_ticker                      # noqa: E402
from main import (_resample_4h, _h4_ma_periods,          # noqa: E402
                  _h1_frame, _h1_ma_periods,
                  _resample_weekly, _resample_3d, _resample_monthly)
from _active_config import MA_PERIODS                   # noqa: E402

# A chart needs at least two ribbon lines to be worth drawing. This was 3 until
# 2026-09-09; with the ribbon cut to [50, 250, 500] a short-history instrument
# clipped by `p <= len(df)` keeps exactly two, and a `< 3` guard would have
# returned None — no chart at all — for 141 instruments on Weekly and 53 on
# 3-Day. Under the old 20-MA ribbon those same frames kept a dozen lines.
MIN_RIBBON_LINES = 2

# How many bars a bundle CARRIES. This is not what a card shows: the reel opens
# on its own default window (REEL_DEFAULT_WINDOW_BARS, 520) and this is the
# depth behind it — how far the time-scale zoom can pull back and how far you
# can pan into history before running out of chart.
#
# Raised past 520 on 2026-09-09. At 520 the default view WAS the whole bundle,
# so zooming out did nothing at all and said so ("all 520 bars are already
# shown") — a limit that looked like a broken gesture. There was never a data
# reason for it: the cache holds a median of 5,088 daily bars, 1,696 three-day
# and 1,056 weekly. It was a payload choice, and this is a more generous one.
#
# Cost: the ribbon is ~80% of the bytes and MA_STRIDE is deliberately NOT scaled
# up to compensate — a wider stride would thin the ribbon to two or three points
# once the time scale is zoomed in to ten bars, which is exactly where it has to
# stay readable. So a daily chunk goes from ~52 KB gzipped to ~130 KB for five
# instruments, and the reel still only fetches one chunk per five cards.
#
# 4H and 1H stay at 520: their cache is Yahoo's ~729 days of hourly, so there is
# no more history to carry.
BARS = 520

BARS_BY_TF = {
    'D':  1300,   # ~5 years   (93% of instruments have this much daily history)
    '3D': 1040,   # ~8.5 years
    'W':  1040,   # ~20 years  (the deepest the weekly cache goes)
    'M':  300,    # every month there is — the cache tops out at 244 monthly bars
    '4H': 520,
    '1H': 520,
}

# Monthly carries ONE moving average, and it has to be this one. Measured over
# 200 instruments: 98% hold the 50 monthly bars MA50 needs, and 0% hold the 250
# or 500 that MA250/MA500 would need (that is ~21 and ~42 YEARS of history
# against a cache whose median is 244 months). Those two lines would be blank on
# every instrument, so the monthly ribbon is MA50 alone.
MONTHLY_MA_PERIODS = [50]

# Ribbon points are emitted every Nth bar (the last bar is always included).
# The MAs are smooth and drawn dotted, so this is invisible on screen and cuts
# the payload by more than half — the ribbon is ~80% of the bytes.
MA_STRIDE = 3

# Instruments per bundle. Only the FIRST card waits on a bundle — the reel
# prefetches the next one while you read — so this is sized for time-to-first-
# chart, ~95 KB gzipped, rather than for the fewest files.
#
# Cut 5 -> 3 on 2026-09-09 to hold that number when the bundles got deeper, and
# PUT BACK to 5 the same evening. Changing it re-groups which instruments share
# a chunk, so the index (name -> chunk id) and the chunks must land together —
# and the published index did not update, leaving a live index that described a
# grouping the chunks no longer had. Every card read "No chart data".
#
# Until that publish path is understood, this stays where the live index
# expects it. The cost is a ~148 KB daily chunk instead of ~92 KB, which is a
# slower first chart; the alternative was no chart at all.
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


def _bundle(df: pd.DataFrame, periods: list[int], date_fmt: str,
            with_volume: bool = False, bars: int = BARS) -> dict | None:
    """Columnar OHLC + ribbon for the last `bars` rows of an indicator-ready df.

    The reel draws no volume — these charts are read as price against the
    ribbon, and a volume strip only takes height from the fan. Daily bundles
    still CARRY volume, because the dashboard's mover sparklines and the
    modal's volume panel need it and this feed replaced the one they used to
    read.
    """
    if df is None or df.empty or len(df) < 2:
        return None

    mas  = _ma_frame(df, periods)
    tail = df.tail(bars)
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
        'm':  [[_round(v) for v in mas[p].tail(bars).iloc[keep]] for p in periods],
        **({'v': [int(v) if pd.notna(v) and math.isfinite(v) else 0
                  for v in tail['Volume']]}
           if with_volume and 'Volume' in tail.columns else {}),
    }


def build_daily(cache_dir: str, ticker: str) -> dict | None:
    path = os.path.join(cache_dir, _cache_name(ticker))
    if not os.path.exists(path):
        return None
    df = pd.read_parquet(path)
    periods = [p for p in MA_PERIODS if p <= len(df)]
    if not periods:
        return None
    return _bundle(df, periods, '%Y-%m-%d', with_volume=True, bars=BARS_BY_TF['D'])


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
    if len(periods) < MIN_RIBBON_LINES:
        return None
    return _bundle(h4, periods, '%Y-%m-%d %H:%M', bars=BARS_BY_TF['4H'])


def build_1h(cache_dir: str, ticker: str) -> dict | None:
    """1H chart from the same hourly cache the 4H chart is resampled from.

    Reads through h4_ticker for the same reason build_4h does: a cash index
    redirected by H4_SOURCE stores its hourly bars under the CONTRACT's name,
    and both intraday timeframes come out of that one file.
    """
    src  = h4_ticker(ticker)
    path = os.path.join(cache_dir, _cache_name(src, suffix='1h'))
    if not os.path.exists(path):
        return None
    hourly = pd.read_parquet(path)
    if hourly.empty:
        return None
    h1 = _h1_frame(hourly)
    periods = _h1_ma_periods(h1, ticker)
    if len(periods) < MIN_RIBBON_LINES:
        return None
    return _bundle(h1, periods, '%Y-%m-%d %H:%M', bars=BARS_BY_TF['1H'])


def build_weekly(cache_dir: str, ticker: str) -> dict | None:
    """Weekly chart from the same daily cache the daily chart reads.

    520 weekly bars is ~10 years, which is what the MA500 anchor needs to
    be drawn at all — so a weekly chart deliberately shows far more calendar
    time than a daily one. Volume is included, as on daily.
    """
    path = os.path.join(cache_dir, _cache_name(ticker))
    if not os.path.exists(path):
        return None
    df = pd.read_parquet(path)
    if df.empty:
        return None
    weekly = _resample_weekly(df)
    periods = [p for p in MA_PERIODS if p <= len(weekly)]
    if len(periods) < MIN_RIBBON_LINES:
        return None
    return _bundle(weekly, periods, '%Y-%m-%d', with_volume=True, bars=BARS_BY_TF['W'])


def build_3d(cache_dir: str, ticker: str) -> dict | None:
    """3-day chart from the same daily cache the daily chart reads.

    520 three-day bars is ~6 years, which is what the MA500 anchor needs to
    be drawn at all — so a 3-day chart shows about three times the calendar span
    of a daily one and about two thirds of a weekly one, which is the gap this
    timeframe exists to fill. Volume is included, as on daily and weekly.
    """
    path = os.path.join(cache_dir, _cache_name(ticker))
    if not os.path.exists(path):
        return None
    df = pd.read_parquet(path)
    if df.empty:
        return None
    three_day = _resample_3d(df)
    periods = [p for p in MA_PERIODS if p <= len(three_day)]
    if len(periods) < MIN_RIBBON_LINES:
        return None
    return _bundle(three_day, periods, '%Y-%m-%d', with_volume=True, bars=BARS_BY_TF['3D'])


def build_monthly(cache_dir: str, ticker: str) -> dict | None:
    """Monthly chart from the same daily cache every other timeframe reads.

    The one timeframe that deliberately ignores MIN_RIBBON_LINES: it carries a
    single line by design (see MONTHLY_MA_PERIODS), so the two-line floor —
    which exists to reject a ribbon too short to be worth drawing — would reject
    every monthly chart instead. The floor still applies in its own terms: an
    instrument without 50 monthly bars gets no monthly chart at all.
    """
    path = os.path.join(cache_dir, _cache_name(ticker))
    if not os.path.exists(path):
        return None
    df = pd.read_parquet(path)
    if df.empty:
        return None
    monthly = _resample_monthly(df)
    periods = [p for p in MONTHLY_MA_PERIODS if p <= len(monthly)]
    if not periods:
        return None
    return _bundle(monthly, periods, '%Y-%m-%d', with_volume=True, bars=BARS_BY_TF['M'])


def _cache_name(ticker: str, suffix: str = '') -> str:
    safe = (ticker
            .replace('=', '_EQ_')
            .replace('^', '_IDX_')
            .replace('.', '_DOT_'))
    tag = f'_{suffix}' if suffix else ''
    return f'{safe}{tag}.parquet'


def _write_gz(path: str, payload: dict) -> None:
    """Write JSON gzipped, under the plain .json name.

    upload_to_r2 detects the gzip magic bytes and sets Content-Encoding, so the
    object is served compressed under the same URL the app already fetches.
    """
    raw = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    with gzip.GzipFile(path, 'wb', compresslevel=6, mtime=0) as f:
        f.write(raw)


def build_chart_feed(output_dir: str, cache_dir: str, ticker_map: dict,
                     max_workers: int = 8) -> dict:
    """Write chart/<tf>/<chunk>.json bundles + chart/index.json.

    ticker_map — instrument display name -> yfinance ticker.
    Returns {'D': n, '3D': n, 'W': n, 'chunks': n_files}. 1H and 4H removed 2026-09-11.
    """
    chart_dir = os.path.join(output_dir, 'chart')
    os.makedirs(chart_dir, exist_ok=True)

    names = sorted(ticker_map)
    # Chunk on the sorted name list so an instrument's chunk id is stable
    # between publishes — the reel caches bundles across sessions.
    chunk_of = {n: i // CHUNK_SIZE for i, n in enumerate(names)}

    stats = {'D': 0, '3D': 0, 'W': 0, 'M': 0, 'chunks': 0}

    for tf, builder in (('D', build_daily), ('3D', build_3d), ('W', build_weekly),
                        ('M', build_monthly)):
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
            _write_gz(os.path.join(tf_dir, f'{cid}.json'),
                      {'tf': tf, 'bars': BARS_BY_TF.get(tf, BARS), 'data': group})
            stats['chunks'] += 1

    _write_gz(os.path.join(chart_dir, 'index.json'),
              {'chunk_size': CHUNK_SIZE, 'bars': BARS,
               'bars_by_tf': BARS_BY_TF, 'chunks': chunk_of})

    return stats
