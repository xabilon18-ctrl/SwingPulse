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

from data_fetcher import (h4_ticker, load_5m, load_1h, FIVE_MIN_LEVEL_REF, _read_5m_raw,   # noqa: E402
                          scale_daily, SGX_FRONT)
from main import (_resample_4h, _h4_ma_periods,          # noqa: E402
                  _h1_frame, _h1_ma_periods,
                  _resample_weekly, _resample_monthly, _resample_3d, _resample_10m,
                  _m10_ma_periods, _frame_5m, _frame_30m, _m30_ma_periods, _frame_15m, _m15_ma_periods,
                  _frame_1h, _m1h_ma_periods, _frame_4h, _m4h_ma_periods,
                  _frame_2h, _m2h_ma_periods, _frame_12h)
from _active_config import MA_PERIODS                   # noqa: E402

# A chart needs at least two ribbon lines to be worth drawing. This was 3 until
# 2026-09-09; with the ribbon cut to [50, 250, 500] a short-history instrument
# clipped by `p <= len(df)` keeps exactly two, and a `< 3` guard would have
# returned None — no chart at all — for 141 instruments on Weekly and 53 on
# 3-Day. Under the old 20-MA ribbon those same frames kept a dozen lines.
MIN_RIBBON_LINES = 2

# How many calendar months the 10m bundle CARRIES. The app opens on the most
# recent one; the rest is what panning back reaches. See build_10m.
CARRY_MONTHS = 2

# How far back the 30m bundle goes: TWO MONTHS (user, 2026-09-24, said of the 5m
# chart it replaced: "2 months is fine going back"). The 5m download itself is
# ~60 days deep, so the warm-up cap below trims a 24h instrument by MA500's
# ~10 days and an equity by more (its MA500 is ~38 sessions).
# 5 months, every instrument, since 2026-09-30 (user: "at least 3 months ...
# for all instruments ... 5 months max"). Only what the 5m cache has kept can
# be shown — Yahoo serves 60 days of 5m, so older bars build up run by run.
CARRY_MONTHS_30M = 5
CARRY_MONTHS_15M = 2   # 15m back beside 30m, 2026-09-29

# The 1H bundle (2026-09-27): the chart opens on a month, and carries six so a
# drag can reach back a season. ~4,400 bars on a 24/7 instrument (under the
# BARS_BY_TF ceiling), ~880 on a US stock. The hourly cache holds ~2 years.
CARRY_MONTHS_1H = 6

# The 2H bundle (2026-10-01): a year of calendar, so the month/quarter grid
# (the 30m's) has four quarters to show. ~4,300 bars on a 24/7 instrument,
# ~1,000 on a US stock (12 vs 4 bars a day).
CARRY_MONTHS_2H = 12

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
    # 10m is the ONE timeframe not cut to a bar count — see build_10m. The entry
    # is the safety ceiling on CARRY_MONTHS' worth, not the window: a 24h
    # instrument puts ~4,300 ten-minute bars in a calendar month against an
    # equity's ~815, and Yahoo's own 5m ceiling stops it at 8,599.
    '10m': 8800,
    # 30m (2026-09-29, replaced 15m on the Charts tab): the same ceiling role —
    # two calendar months of a 24/7 instrument is ~2,950 thirty-minute bars.
    '30m': 7400,   # 5 months of a 24/7 instrument (48 bars x ~153 days), 2026-09-30
    '15m': 6000,   # two months of a 24/7 instrument
    'D':  1300,   # ~5 years   (93% of instruments have this much daily history)
    '3D': 1040,   # ~8.5 years
    'W':  1040,   # ~20 years  (the deepest the weekly cache goes)
    # 4H CARRIES more than it shows (user, 2026-09-19: "i cannot go back further
    # on the 4h"). The card still opens on 520 bars (REEL_DEFAULT_WINDOW_BARS);
    # this is how far back a drag can reach. 2190 = a year of a 24h instrument
    # (6 bars x 365); a US equity's whole hourly cache is only ~1,120 four-hour
    # bars (Yahoo keeps 730 days of 1h), so equities ship everything they have.
    # Cost: the oldest ~500 bars of an equity carry no MA500 (it has not warmed
    # up yet — 167 null points of 374 on AAPL); the 520-bar opening window is
    # fully warm on every instrument. Gzipped bundle AAPL 8 -> 18 KB, BTC 10 -> 43.
    # (2026-09-29, 4H back on the Daily's year grid): raised to the whole
    # ~2-year hourly cache past MA500's warm-up, so a 24h instrument shows
    # more than one year line. ~3,900 bars on BTC, ~1,000 on a US equity.
    '4H': 4400,
    # 1H (2026-09-27): the ceiling on CARRY_MONTHS_1H of a 24/7 instrument.
    '1H': 4500,
    # 2H (2026-10-01): the ceiling on CARRY_MONTHS_2H of a 24/7 instrument.
    '2H': 4400,
    # 12H (2026-10-01): as deep as the Daily. A 24h market only reaches ~960
    # bars past MA500's warm-up (the hourly cache is ~2 years).
    '12H': 1300,
}

# MONTHLY was REMOVED 2026-09-14 at the user's request, along with
# MONTHLY_MA_PERIODS = [50] and build_monthly(). It carried one moving average
# because it could: 98% of instruments hold the 50 monthly bars MA50 needs and
# 0% hold the 250 or 500 the other two would (~21 and ~42 years against a cache
# whose median is 244 months), so the ribbon this app is built on was never
# actually drawable there. main._resample_monthly STAYS — backtest.py and the
# research scripts use it, and the monthly MA50 finding (mildly contrarian
# within-instrument) is a result, not dead code.
#
# NB the published chart/M/*.json chunks are NOT deleted by this: the publisher
# only ever writes, it has no sweep step (see the stale-chunk note in
# DOCUMENTATION). They will sit on R2 unreferenced until removed by hand.

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
    df = scale_daily(ticker, pd.read_parquet(path))
    periods = [p for p in MA_PERIODS if p <= len(df)]
    if not periods:
        return None
    out = _bundle(df, periods, '%Y-%m-%d', with_volume=True, bars=BARS_BY_TF['D'])
    if out:
        # Higher-timeframe MA lines for the overlay: Weekly 50/250/500 and
        # Monthly 50 only (user, 2026-09-28: "the monthly with a 50MA thicker
        # than them all"; a Monthly 250/500 is ~21/42 years, never warm).
        # Carries BOTH overlay MA sets (user, 2026-09-28: "another profile for
        # the overlay ... 50, 100, 200, 300 and 500"); the client draws the
        # set chosen. A period the history cannot warm is dropped by
        # _htf_mas (Monthly 500 = ~42 years, never; 300 = 25, rarely).
        for key, resample, periods in (('w', _resample_weekly, OVERLAY_MA_PERIODS),
                                       ('mo', _resample_monthly, OVERLAY_MA_PERIODS)):
            ma = _htf_mas(df, out['t'][0], resample, periods)
            if ma:
                out[key] = ma
    return out


# Every period any overlay MA set uses: 50/250/500, 50/100/200/300/500 and
# every 50 from 50 to 500 (user, 2026-09-28: "one that goes up by 50 all the
# way to 500").
OVERLAY_MA_PERIODS = list(range(50, 501, 50))


def _htf_mas(df: pd.DataFrame, since: str, resample, periods) -> dict | None:
    """Weekly / Monthly MA lines for the chart overlay (user, 2026-09-28:
    "include the option to include the weekly ... make the weekly MAs thicker").

    Only the MA lines ride along, never the bars: the overlay draws MAs only.
    They are rolled over the WHOLE daily cache resampled to closed periods
    (MA500 weekly = ~9.6 years, Monthly MA50 = ~4.2, against the Daily bundle's
    ~5 years), then cut to the span the Daily bundle covers — plus the one
    period before it, so the line reaches the left edge. `t` is the period's
    label (a week's Friday, W-FRI; a month's last day); the client places each
    point at the close of that day. The period in progress is added below
    from the daily bars so far; the client holds the last value flat to the
    newest intraday bar. A period the history cannot warm is left out.
    """
    weekly = resample(df)
    # The period IN PROGRESS (user, 2026-09-28: "if the data is small we can
    # add to get it right"): built from the daily bars already held — no extra
    # Yahoo request — and appended as the last point, dated on the newest daily
    # bar so the client places it there. Chart overlay only: the signal
    # pipeline's own resamplers still drop it (a week is not a bar until it
    # closes, Important Rule 10).
    last_day = pd.Timestamp(df.index.max())
    if getattr(last_day, 'tz', None) is not None:
        last_day = last_day.tz_localize(None)
    last_day = last_day.normalize()
    closed_to = weekly.index.max() if len(weekly) else None
    if closed_to is None or last_day > pd.Timestamp(closed_to).normalize():
        idx = df.index.tz_localize(None) if getattr(df.index, 'tz', None) is not None else df.index
        part = df['Close'][idx > (pd.Timestamp(closed_to) if closed_to is not None else pd.Timestamp.min)].dropna()
        if len(part):
            live = pd.DataFrame({'Close': [float(part.iloc[-1])]}, index=[last_day])
            weekly = pd.concat([weekly[['Close']], live])
    periods = [p for p in periods if p <= len(weekly)]
    if not periods:
        return None
    mas = _ma_frame(weekly, periods)
    keep = weekly.index >= pd.Timestamp(since)
    if not keep.any():
        return None
    first = keep.argmax()
    if first > 0:
        keep[first - 1] = True
    return {
        't': [d.strftime('%Y-%m-%d') for d in weekly.index[keep]],
        'p': periods,
        # 5 significant figures: an MA line needs no more (7133.3, 0.71234),
        # and ten Weekly lines at 6 cost ~9 KB gz more per chunk.
        'm': [[_round(v, 5) for v in mas[p][keep]] for p in periods],
        # PROJECTED MAs (user, 2026-09-30): the client runs each line forward
        # assuming price holds at the last close, which needs the closes that
        # will DROP OUT of each window — for an MA500, closes from ~10 years
        # back that the bundle does not otherwise carry. So the last
        # max(periods) period closes ride along, ending on the same period as
        # `m` (the one in progress included).
        'c': [_round(v, 5) for v in weekly['Close'].iloc[-max(periods):]],
    }


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
    # 2026-09-27: back on the Charts tab, built like build_15m — the 15m's
    # sources and cash/spot level (data_fetcher.load_1h), EXACT 50/250/500,
    # CARRY_MONTHS_1H of calendar, the carry capped so MA500 is warm at the
    # left edge.
    df_1h = load_1h(ticker)
    if df_1h is None or df_1h.empty:
        return None
    frame = _frame_1h(df_1h)
    if len(frame) < 2:
        return None
    periods = _m1h_ma_periods(frame)
    if len(periods) < MIN_RIBBON_LINES:
        return None
    cutoff  = frame.index[-1] - pd.DateOffset(months=CARRY_MONTHS_1H)
    n_carry = int((frame.index > cutoff).sum()) or len(frame)
    warm_cap = len(frame) - max(periods)
    bars = min(n_carry, BARS_BY_TF['1H'], max(warm_cap, 1))
    return _bundle(frame, periods, '%Y-%m-%d %H:%M', bars=bars)


def build_4h_live(cache_dir: str, ticker: str) -> dict | None:
    """4H chart (2026-09-29, user: "add the 4h"): the 1H chart's feed
    (load_1h — same sources and cash/spot level) in session-anchored 4-hour
    bars, EXACT 50/250/500. Carries everything the ~2-year hourly cache holds
    past MA500's warm-up (BARS_BY_TF['4H'] ceiling). Replaces build_4h (clock
    feed + session-scaled ribbon), which stays for research."""
    df_1h = load_1h(ticker)
    if df_1h is None or df_1h.empty:
        return None
    frame = _frame_4h(df_1h)
    if len(frame) < 2:
        return None
    periods = _m4h_ma_periods(frame)
    if len(periods) < MIN_RIBBON_LINES:
        return None
    warm_cap = len(frame) - max(periods)
    bars = min(len(frame), BARS_BY_TF['4H'], max(warm_cap, 1))
    return _bundle(frame, periods, '%Y-%m-%d %H:%M', bars=bars)


def build_2h(cache_dir: str, ticker: str) -> dict | None:
    """2H chart (2026-10-01, user: "add a 2h chart"): build_1h's feed in
    session-anchored 2-hour bars (main._frame_2h), EXACT 50/250/500,
    CARRY_MONTHS_2H of calendar, capped so MA500 is warm at the left edge."""
    df_1h = load_1h(ticker)
    if df_1h is None or df_1h.empty:
        return None
    frame = _frame_2h(df_1h)
    if len(frame) < 2:
        return None
    periods = _m2h_ma_periods(frame)
    if len(periods) < MIN_RIBBON_LINES:
        return None
    cutoff  = frame.index[-1] - pd.DateOffset(months=CARRY_MONTHS_2H)
    n_carry = int((frame.index > cutoff).sum()) or len(frame)
    warm_cap = len(frame) - max(periods)
    bars = min(n_carry, BARS_BY_TF['2H'], max(warm_cap, 1))
    return _bundle(frame, periods, '%Y-%m-%d %H:%M', bars=bars)


def build_12h(cache_dir: str, ticker: str) -> dict | None:
    """12H chart (2026-10-01, user: "add 12 built like the daily with the time
    grids"): the Daily's year grid and opening window, EXACT 50/250/500.

    A market whose session is shorter than 12 hours (stocks, cash indices on
    their own feed) has ONE 12-hour bar a session — the daily bar, exactly as
    TradingView's 12H draws it — so those are read from the DAILY cache, which
    carries years of history where the hourly cache has ~2 (MA500 alone needs
    ~2 years of sessions). Round-the-clock markets get two session-anchored
    bars a day from the hourly feed (main._frame_12h)."""
    df_1h = load_1h(ticker)
    if df_1h is None or df_1h.empty:
        return None
    frame = _frame_12h(df_1h)
    if len(frame) < 2:
        return None
    per_day = frame.groupby(frame.index.normalize()).size().tail(60).median()
    if per_day < 1.5:
        path = os.path.join(cache_dir, _cache_name(ticker))
        if not os.path.exists(path):
            return None
        df = scale_daily(ticker, pd.read_parquet(path))
        periods = [p for p in MA_PERIODS if p <= len(df)]
        if len(periods) < MIN_RIBBON_LINES:
            return None
        return _bundle(df, periods, '%Y-%m-%d', bars=BARS_BY_TF['12H'])
    periods = [p for p in MA_PERIODS if p <= len(frame)]
    if len(periods) < MIN_RIBBON_LINES:
        return None
    warm_cap = len(frame) - max(periods)
    bars = min(len(frame), BARS_BY_TF['12H'], max(warm_cap, 1))
    return _bundle(frame, periods, '%Y-%m-%d %H:%M', bars=bars)


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


def build_10m(cache_dir: str, ticker: str) -> dict | None:
    """10-minute chart, resampled from the instrument's own 5m cache.

    The only timeframe here with a HARD CEILING on history: Yahoo serves ~60
    sessions of 5m and refuses anything older, so 1300 ten-minute bars is about
    33 sessions on a US equity and ~9 days on a 24h instrument, and no amount of
    cache-warming will ever make it deeper. That is enough for the MA500 anchor
    to be fully warm rather than warming up — an equity's 60 sessions give ~2,325
    ten-minute bars, of which the 1,025 behind the window are the ribbon's
    lead-in (measured on AAPL, 2026-09-14).

    Reads the ticker's OWN 5m file, never h4_ticker's redirect: at 4H a cash
    index borrows the 24h contract's clock on purpose, but a 10m chart of ^NDX
    has to be ^NDX's own session or it is a chart of something else.

    Periods come from _m10_ma_periods: unscaled for anything exchange-traded,
    scaled up for round-the-clock instruments so MA500 reaches the same number of
    CALENDAR days on every chart. See config.py §"Ribbon normalisation".

    CUT BY CALENDAR, NOT BY BAR COUNT — the only timeframe here that is, and the
    user asked for it directly: "one month for all". Every other timeframe slices
    `tail(bars)`, which works there because a daily bar is a day on every
    instrument in the book. A ten-minute bar is not: measured 2026-09-14, an
    equity puts 38.8 of them in a session and a 24h instrument 143.3, so a flat
    1300 bars was 34 sessions of Apple against 10 days of Bitcoin — the same
    button showing three different amounts of market depending on what you were
    looking at. One month of calendar is one month on all 798.

    The ribbon is still computed over the WHOLE 5m cache before the cut (that is
    what _bundle does), so MA500 is warm at the left edge rather than warming up
    inside the window — ~60 sessions of 5m behind a one-month window is plenty.
    """
    path = os.path.join(cache_dir, _cache_name(ticker, suffix='5m'))
    if not os.path.exists(path):
        return None
    df_5m = pd.read_parquet(path)
    if df_5m.empty:
        return None
    ten = _resample_10m(df_5m)
    # NOT `[p for p in MA_PERIODS ...]` — a round-the-clock instrument needs its
    # ribbon scaled or MA500 reaches 3.5 days against an equity's 18.5. The chart
    # carries its own `p`, so the app draws whatever this returns.
    periods = _m10_ma_periods(ten)
    if len(periods) < MIN_RIBBON_LINES:
        return None
    # TWO calendar months are CARRIED; the app OPENS on the most recent one
    # (reelWindowBars). Same split every other timeframe uses — the bundle is
    # depth, the window is the view — and it is what lets the reader pan back
    # into the previous month, which a one-month bundle could not do at all: the
    # chart simply ran out of history at its left edge.
    #
    # Two, not everything Yahoo has (~3 months for an equity, capped at 59 days
    # for a 24h instrument). Depth is not free here the way it is on the daily
    # feed: measured 2026-09-14, AAPL goes 11.8 -> 25.9 -> 35.2 KB gzipped at
    # 1/2/3 months and BTC 79.0 -> 147.4, and five of those share a chunk. Two
    # months answers "show me the previous month" exactly and costs half of what
    # carrying the lot would.
    #
    # DateOffset, not 30 days: the window is the month the reader means rather
    # than an approximation of it. Clamped to the ceiling so a pathological cache
    # cannot emit a bundle of unbounded size.
    cutoff = ten.index[-1] - pd.DateOffset(months=CARRY_MONTHS)
    n_carry = int((ten.index > cutoff).sum()) or len(ten)

    # LEAVE THE SLOWEST MA ITS WARM-UP. _bundle computes the ribbon over the
    # whole frame and then tails it, so the carried window is warm only while
    # there are at least max(periods) bars BEHIND it. On an equity that is free
    # (2,326 bars total against 1,677 carried). On a 24h instrument it is not:
    # BTC's entire 10m history is 8,599 bars and two calendar months is ~8,599 of
    # them, so the carry swallowed the lead-in and the chart shipped 167 null
    # MA500 points — a ribbon that visibly began partway into the window, which
    # is exactly the "MAs look wrong on crypto" report. Capping the carry here
    # costs BTC ~3.5 days of pannable history and buys a ribbon that is drawn all
    # the way to the left edge.
    warm_cap = len(ten) - max(periods)
    bars = min(n_carry, BARS_BY_TF['10m'], max(warm_cap, 1))
    return _bundle(ten, periods, '%Y-%m-%d %H:%M', bars=bars)


def build_15m(cache_dir: str, ticker: str) -> dict | None:
    """15-minute chart (back 2026-09-29 beside 30m): build_30m at 15 minutes."""
    df_5m = load_5m(ticker)
    if df_5m is None or df_5m.empty:
        return None
    frame = _frame_15m(df_5m)
    if len(frame) < 2:
        return None
    periods = _m15_ma_periods(frame)
    if len(periods) < MIN_RIBBON_LINES:
        return None
    cutoff  = frame.index[-1] - pd.DateOffset(months=CARRY_MONTHS_15M)
    n_carry = int((frame.index > cutoff).sum()) or len(frame)
    warm_cap = len(frame) - max(periods)
    bars = min(n_carry, BARS_BY_TF['15m'], max(warm_cap, 1))
    return _bundle(frame, periods, '%Y-%m-%d %H:%M', bars=bars)


def build_30m(cache_dir: str, ticker: str) -> dict | None:
    """30-minute chart, resampled from the instrument's 5m source (main._frame_30m).

    Replaced the 15m chart on 2026-09-29, which had replaced 5m on 2026-09-25.
    Ribbon over the whole cache so MA500
    is warm at the left edge, CARRY_MONTHS_30M of calendar shipped, and the
    carry capped so the slowest MA keeps its warm-up on a 24/7 instrument. See
    build_10m for the reasoning.
    """
    # data_fetcher.load_5m: US indices draw their nearly-24h FUTURES, gold its
    # COMEX contract — each shifted to the cash/spot LEVEL the user trades.
    # The daily chart stays on the instrument's own ticker.
    df_5m = load_5m(ticker)
    if df_5m is None or df_5m.empty:
        return None
    frame = _frame_30m(df_5m)
    if len(frame) < 2:
        return None
    periods = _m30_ma_periods(frame)
    if len(periods) < MIN_RIBBON_LINES:
        return None
    cutoff  = frame.index[-1] - pd.DateOffset(months=CARRY_MONTHS_30M)
    n_carry = int((frame.index > cutoff).sum()) or len(frame)
    # No warm-up cap any more: the bars before MA500 has 500 behind it are
    # shipped too, and the slow lines simply begin partway in (2026-09-30).
    bars = min(n_carry, BARS_BY_TF['30m'])
    return _bundle(frame, periods, '%Y-%m-%d %H:%M', bars=bars)


def _quote_one(cache_dir: str, ticker: str) -> dict | None:
    """Latest price + previous close for the Watchlist tab (quotes.json).

    Price is the newest FINISHED 5m bar when there is one (the same feed the
    5m chart draws, so a US index reads its futures contract), else the newest
    daily close. Previous close is the daily close of the last session BEFORE
    that price's date — except for a futures-redirected index, whose 5m price
    and the cash index's daily close are different instruments: there it is
    the contract's own last 5m close before the 22:00 UTC session break.
    """
    dpath = os.path.join(cache_dir, _cache_name(ticker))
    daily = scale_daily(ticker, pd.read_parquet(dpath))[['Close']].dropna() if os.path.exists(dpath) else pd.DataFrame()
    src = h4_ticker(ticker)
    adjusted = src != ticker or ticker in FIVE_MIN_LEVEL_REF
    five = pd.DataFrame()
    try:
        raw = load_5m(ticker)
        if raw is not None and len(raw):
            five = _frame_5m(raw)
    except Exception:
        five = pd.DataFrame()
    if daily.index.tz is not None if len(daily) else False:
        daily.index = daily.index.tz_localize(None)

    if len(five) and (not len(daily) or five.index[-1].normalize() >= daily.index[-1].normalize()):
        ts, last = five.index[-1], float(five['Close'].iloc[-1])
        if adjusted:
            brk = ts.normalize() + pd.Timedelta(hours=22)
            if brk > ts:
                brk -= pd.Timedelta(days=1)
            prev = five['Close'][five.index < brk]
            pc = float(prev.iloc[-1]) if len(prev) else None
        else:
            prev = daily['Close'][daily.index.normalize() < ts.normalize()]
            pc = float(prev.iloc[-1]) if len(prev) else None
        srcname = '5m'
    elif len(daily) >= 2:
        ts, last, pc, srcname = daily.index[-1], float(daily['Close'].iloc[-1]), float(daily['Close'].iloc[-2]), 'D'
    else:
        return None
    out = {'p': _round(last), 'pc': _round(pc), 't': ts.strftime('%Y-%m-%d %H:%M'), 's': srcname,
           # LIVE polling (Watchlist): `y` is the Yahoo symbol to poll, `b` the
           # spot/cash shift to subtract from it (load_5m's basis at the last
           # bar), `yc` an unshifted level reference polled alongside — the cash
           # index or XAUT — which the app uses whenever it is the fresher print.
           'y': src}
    ref = FIVE_MIN_LEVEL_REF.get(ticker)
    if ref:
        try:
            raw_last = float(_read_5m_raw(src)['Close'].iloc[-1])
            adj_last = float(load_5m(ticker)['Close'].iloc[-1])
            out['b'] = _round(raw_last - adj_last)
        except Exception:
            pass
        out['yc'] = ref
    return out


def build_quotes(cache_dir: str, ticker_map: dict, max_workers: int = 8) -> dict:
    """{'generated_at': ISO UTC, 'q': {name: {p, pc, t, s}}} for every instrument."""
    from datetime import datetime, timezone

    def _one(name):
        try:
            return name, _quote_one(cache_dir, ticker_map[name])
        except Exception:
            return name, None

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as ex:
        q = {n: v for n, v in ex.map(_one, sorted(ticker_map)) if v}
    return {'generated_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'q': q}


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


# ── Intraday markers (2026-09-26 on 15m, rules revised 2026-09-27; 30m and
# 4H since 2026-09-29) ─────────────────────────────────────────────────────
# Daily-MA marks, computed from the published intraday and Daily BUNDLES — the very
# arrays the app draws — so what the Charts filter selects on is what the chart
# shows. Per Daily MA (user, 2026-09-27: "when the price touches or crossed the
# daily MAs then apply markers there as well including that one hour hold"):
#   pre   — TOUCH: the 15m bar's high-low range reaches the Daily MA but the
#           close does not cross and hold. On the touching bar. Once per test:
#           re-armed when a close is XM_REARM daily ATRs away.
#   after — CROSS: the 15m close changes side and the next XM_HOLD closes stay
#           there (1 hour). Stamped on the CROSSING bar itself (it used to sit
#           on the confirming bar, an hour to the right of the cross, which
#           read as a random place). One per MA/direction/day.
# The Daily MA is the last COMPLETED daily bar's value (no look-ahead).
# XM_HOLD is in bars of the chart: one hour on 30m (2 bars) and 1H (1 bar);
# on 4H one bar is the shortest hold there is (XM_HOLD_BY_TF).
XM_REARM, XM_HOLD = 0.5, 2
XM_HOLD_BY_TF = {'15m': 4, '30m': 2, '1H': 1, '4H': 1}
_DAY_MS = 86_400_000


def _ts_ms(v: str) -> int:
    ts = pd.Timestamp(str(v)[:16])
    return int(ts.value // 1_000_000)


def cross_marks(b15: dict, bd: dict, hold: int = XM_HOLD) -> list[dict]:
    bt = [_ts_ms(t) for t in b15['t']]
    ot = [_ts_ms(t) for t in bd['t']]
    n, on, C = len(bt), len(ot), b15['c']
    mi = bd.get('mi') or [min(j * (bd.get('ms') or 1), on - 1) for j in range(len(bd['m'][0]))]
    dm = []
    for series in bd['m']:
        full = [None] * on
        for j, v in enumerate(series):
            if v is None:
                continue
            full[mi[j]] = v
            if j + 1 < len(series) and series[j + 1] is not None:
                a, z = mi[j], mi[j + 1]
                for q in range(a + 1, z):
                    full[q] = v + (series[j + 1] - v) * (q - a) / (z - a)
        dm.append(full)
    atr, tr = [None] * on, []
    for i in range(on):
        h, l = bd['h'][i], bd['l'][i]
        pc = bd['c'][i - 1] if i else None
        if h is None or l is None:
            tr.append(None)
            continue
        tr.append(h - l if pc is None else max(h - l, abs(h - pc), abs(l - pc)))
        w = [v for v in tr[-14:] if v is not None]
        atr[i] = sum(w) / len(w) if w else None
    di, d = [-1] * n, -1
    for i in range(n):
        while d + 1 < on and ot[d + 1] + _DAY_MS <= bt[i]:
            d += 1
        di[i] = d
    H, Lo = b15.get('h') or C, b15.get('l') or C
    out = []
    for k in range(len(dm)):
        lv = lambda i: dm[k][di[i]] if di[i] >= 0 else None      # noqa: E731
        at = lambda i: atr[di[i]] if di[i] >= 0 else None        # noqa: E731
        side, armed, seen, i = 0, True, set(), 0
        while i < n:
            c, D, A = C[i], lv(i), at(i)
            if c is None or D is None or not A:
                i += 1
                continue
            sg = 1 if c >= D else -1
            if not side:
                side = sg
                i += 1
                continue
            if sg != side:
                ok = i + hold < n
                q = i + 1
                while ok and q <= i + hold:
                    cq, dq = C[q], lv(q)
                    if cq is None or dq is None or (1 if cq >= dq else -1) != sg:
                        ok = False
                    q += 1
                if ok:
                    dr = 'up' if sg > 0 else 'dn'
                    key = dr + str(b15['t'][i])[:10]
                    if key not in seen:
                        seen.add(key)
                        out.append({'kind': 'after', 'k': k, 'i': i, 'v': D, 'dir': dr})
                    side, armed, i = sg, False, i + hold + 1
                    continue
                # A close through the MA that did not hold an hour is a touch.
            if abs(c - D) / A > XM_REARM:
                armed = True
            h, l = H[i], Lo[i]
            if armed and h is not None and l is not None and l <= D <= h:
                out.append({'kind': 'pre', 'k': k, 'i': i, 'v': D, 'dir': 'dn' if side > 0 else 'up'})
                armed = False
            i += 1
    return out


def _attach_15m_marks(b15: dict, bd: dict | None, fires: list, hold: int = XM_HOLD) -> dict:
    """Put `sg` (B1/S1 fires) and `xm` (Daily-MA cross marks) on a 15m bundle
    and return the instrument's RECENT events for the Charts filters: those on
    the bundle's last two trading dates, so a weekend never empties the list."""
    pos = {t: i for i, t in enumerate(b15['t'])}
    b15['sg'] = [[pos[t], code] for t, code in (fires or []) if t in pos]
    xm = cross_marks(b15, bd, hold) if bd else []
    b15['xm'] = [[m['i'], m['kind'], bd['p'][m['k']], m['dir'], _round(m['v'])] for m in xm]
    dates = sorted({str(t)[:10] for t in b15['t']})
    since = dates[-2] if len(dates) >= 2 else (dates[-1] if dates else '')
    ev = {}
    for i, code in b15['sg']:
        if str(b15['t'][i])[:10] >= since:
            ev['s'] = [code, b15['t'][i]]
    for i, kind, p, dr, _v in b15['xm']:
        if str(b15['t'][i])[:10] >= since:
            ev['a' if kind == 'after' else 'p'] = [dr, p, b15['t'][i]]
    return ev


NEAR_ATR_N = 14
NEAR_KEEP_ATR = 3


def near_ma(bd: dict) -> dict | None:
    """How far the latest Daily close sits from each Daily, Weekly and Monthly
    MA (user, 2026-09-28: "an option to see which are close to daily weekly
    and monthly MAs"), for the Charts "Near MA" filter.

    {'D50': [atr_units, pct], 'W250': [...], 'M50': [...]} — signed, + = price
    ABOVE the MA. ATR units (14-day average true range) so "close" means the
    same on a currency and on bitcoin; pct is only for the label. Read off the
    Daily bundle the charts already draw (Weekly/Monthly incl. the period in
    progress), so the filter and the lines on screen cannot disagree.
    """
    h, l, c = bd.get('h') or [], bd.get('l') or [], bd.get('c') or []
    n = len(c)
    if n < NEAR_ATR_N + 1 or c[-1] is None:
        return None
    trs = []
    for i in range(n - NEAR_ATR_N, n):
        if None in (h[i], l[i], c[i - 1]):
            continue
        trs.append(max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])))
    atr = sum(trs) / len(trs) if trs else 0
    close = c[-1]
    if not atr or not close:
        return None
    out = {}
    # Daily 100/200/300 are not shipped as lines (the app rolls them from the
    # bundle's closes); rolled here the same way for the filter.
    extra = [p for p in OVERLAY_MA_PERIODS if p not in (bd.get('p') or []) and p <= n]
    dx = {'p': extra, 'm': [[sum(c[-p:]) / p] if None not in c[-p:] else [None] for p in extra]}
    for tag, blk in (('D', bd), ('D', dx), ('W', bd.get('w')), ('M', bd.get('mo'))):
        if not blk:
            continue
        for p, series in zip(blk.get('p') or [], blk.get('m') or []):
            v = next((x for x in reversed(series) if x is not None), None) if series else None
            # Only the near ones ship (the filter's widest reach is 1 ATR; 3
            # leaves headroom) — every MA of every instrument was 37 KB gz.
            if v and abs(close - v) <= NEAR_KEEP_ATR * atr:
                out[f'{tag}{p}'] = [round((close - v) / atr, 2), round((close - v) / v * 100, 2)]
    return out or None


def near_ma_map(daily: dict) -> dict:
    out = {}
    for name, bd in daily.items():
        try:
            d = near_ma(bd)
        except Exception:
            d = None
        if d:
            out[name] = d
    return out


def build_chart_feed(output_dir: str, cache_dir: str, ticker_map: dict,
                     max_workers: int = 8, fires_path: str | None = None,
                     d_fires_path: str | None = None) -> dict:
    """Write chart/<tf>/<chunk>.json bundles + chart/index.json.

    ticker_map — instrument display name -> yfinance ticker.
    Returns {'30m': n, '1H': n, '2H': n, 'D': n, 'chunks': n_files}.
    30m replaced 15m and 4H came back (built from the 1H feed) on 2026-09-29.
    1H returned 2026-09-27 (hourly download back, B1/S1 signals like 15m).
    1H and 4H removed 2026-09-11; Monthly removed and 10m added 2026-09-14;
    the 4H chart restored 2026-09-17, then 4H and Weekly removed 2026-09-24
    and 3D kept as a CHART ONLY (its signals went). Later on 2026-09-24 the 10m
    and 3D charts were replaced by 5m, and on 2026-09-25 5m by 15m. build_4h/build_weekly/build_10m/build_3d
    stay for local research; their published chunks sit on R2 unreferenced.
    """
    chart_dir = os.path.join(output_dir, 'chart')
    os.makedirs(chart_dir, exist_ok=True)

    names = sorted(ticker_map)
    # Chunk on the sorted name list so an instrument's chunk id is stable
    # between publishes — the reel caches bundles across sessions.
    chunk_of = {n: i // CHUNK_SIZE for i, n in enumerate(names)}

    stats = {'30m': 0, '1H': 0, '2H': 0, '12H': 0, 'D': 0, 'chunks': 0}
    built: dict[str, dict[str, dict]] = {}

    # 1H and 4H charts removed 2026-09-30 (build_4h_live kept); 15m removed
    # 2026-09-30 too (build_15m kept). 1H back, 2H and 12H added 2026-10-01 as
    # CHARTS ONLY — no signals, no markers, no alerts.
    for tf, builder in (('30m', build_30m), ('1H', build_1h), ('2H', build_2h), ('12H', build_12h),
                        ('D', build_daily)):
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
        built[tf] = bundles

    # 30m markers: B1/S1 from main's m30_fires.json, Daily-MA crosses from the
    # two bundles. A failure here costs the markers, never the chart feed.
    events: dict[str, dict] = {}
    try:
        fires = {}
        if fires_path and os.path.exists(fires_path):
            with open(fires_path) as fh:
                fires = json.load(fh)
        for name, b15 in built.get('30m', {}).items():
            ev = _attach_15m_marks(b15, built.get('D', {}).get(name), fires.get(name),
                                   hold=XM_HOLD_BY_TF['30m'])
            if ev:
                events[name] = ev
    except Exception as exc:
        print(f'  WARN 30m markers not built: {exc}')

    # Alerts tab (2026-09-27): every marker above as a listed alert, with what
    # price did after it. A failure costs the Alerts tab, never the chart feed.
    try:
        from alerts_feed import build_alerts
        d_fires = {}
        if d_fires_path and os.path.exists(d_fires_path):
            with open(d_fires_path) as fh:
                d_fires = json.load(fh)
        # 30m + Daily only: the chart-only 1H/2H have no alerts (and would
        # cost the base-rate pass over every bar for nothing).
        alerts = build_alerts({tf: built.get(tf, {}) for tf in ('30m', 'D')}, d_fires)
        _write_gz(os.path.join(output_dir, 'alerts.json'), alerts)
        stats['alerts'] = len(alerts['ev'])
    except Exception as exc:
        print(f'  WARN alerts.json not built: {exc}')

    for tf, bundles in built.items():
        tf_dir = os.path.join(chart_dir, tf)
        os.makedirs(tf_dir, exist_ok=True)
        grouped: dict[int, dict] = {}
        for name, payload in bundles.items():
            grouped.setdefault(chunk_of[name], {})[name] = payload

        for cid, group in grouped.items():
            _write_gz(os.path.join(tf_dir, f'{cid}.json'),
                      {'tf': tf, 'bars': BARS_BY_TF.get(tf, BARS), 'data': group})
            stats['chunks'] += 1

    _write_gz(os.path.join(chart_dir, 'index.json'),
              {'chunk_size': CHUNK_SIZE, 'bars': BARS,
               'bars_by_tf': BARS_BY_TF, 'chunks': chunk_of, 'ev15': events,
               'near': near_ma_map(built.get('D', {}))})

    return stats
