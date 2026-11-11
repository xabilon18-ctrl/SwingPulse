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
                          scale_daily, _utc_now)
import exchange_feed                                    # noqa: E402
from main import (_resample_4h,                          # noqa: E402
                  _resample_weekly, _resample_monthly, _frame_5m, _frame_1h, _m1h_ma_periods)
from trend_context_feed import frame_context, workflow_context, workflow_alerts
from setup_context import reference_history, attach_setup_context
from chart_cache import Store, recording
from _active_config import MA_PERIODS, RUN_CHART_BUILDERS, TIMEFRAMES  # noqa: E402

# A chart needs at least two ribbon lines to be worth drawing. This was 3 until
# 2026-09-09; with the ribbon cut to [50, 250, 500] a short-history instrument
# clipped by `p <= len(df)` keeps exactly two, and a `< 3` guard would have
# returned None — no chart at all — for 141 instruments on Weekly and 53 on
# 3-Day. Under the old 20-MA ribbon those same frames kept a dozen lines.
MIN_RIBBON_LINES = 2

# How many calendar months the 10m bundle CARRIES. The app opens on the most
# recent one; the rest is what panning back reaches.
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

# The 10m bundle (back 2026-10-03, chart only, week grid): two months, so the
# month the chart opens on has a month of panning behind it.
CARRY_MONTHS_10M = 2

# DEEP HISTORY (2026-11-01, user: "it looks like will need more data in all
# time frames ... without affecting the code run time"). Bars OLDER than the
# carry above ride in the bundle's `deep` block: drawn by the app, never read by
# the after-steps (markers, alerts, setup context, activity, trend channels),
# which keep seeing exactly the window they always saw — so shipping more
# history to look at changes no alert, trend or count, and costs them nothing.
# _attach_deep stitches the block on in front just before the file is written.
#   D  — the whole 13-year cache: ~3,300 bars against 1,300.
#   1H — a further 6 months behind CARRY_MONTHS_1H: a year in all.
#   4H — a further year behind its ~2-year carry, filling as the never-trimmed
#        hourly cache grows past Yahoo's 730 days.
# 30m stays at CARRY_MONTHS_30M: the 30m SIGNALS run over the whole 5m cache,
# so keeping more 5m history would slow every open-market run.
DEEP_BARS_BY_TF = {'D': 2200, '1H': 4500}
DEEP_MONTHS_1H = 6

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
    # 10m is the ONE timeframe not cut to a bar count. The entry
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
    # Weekly and Monthly (back 2026-10-19) are built from each instrument's
    # WHOLE Yahoo history (tools/publish_htf.py), not the 13-year Daily cache:
    # Weekly carries ~25 years behind its four-term opening view, Monthly
    # every month there is (^GSPC goes back to 1927).
    'W':  1300,   # ~25 years
    'M':  1200,   # 100 years — in practice all of it
    # 1H (2026-09-27): the ceiling on CARRY_MONTHS_1H of a 24/7 instrument.
    '1H': 4500,
    # 2H (2026-10-01): the ceiling on CARRY_MONTHS_2H of a 24/7 instrument.
    '2H': 4400,
    # 12H (2026-10-01): as deep as the Daily. A 24h market only reaches ~960
    # bars past MA500's warm-up (the hourly cache is ~2 years).
    '12H': 1300,
}

# MONTHLY was removed 2026-09-14 and is BACK 2026-10-19 as a chart only (user:
# "add back weekly and monthly chart"), built from each instrument's whole Yahoo
# history. Its MA250/MA500 are ~21/~42 years, so most instruments still draw
# the MA50 alone; see monthly_bundle.
#
# Weekly and Monthly are NOT built by build_chart_feed: they have their own
# workflow (publish-htf.yml -> tools/publish_htf.py) on Mondays and the 3rd-5th,
# with their own chunk index, chart/<W|M>/index.json.

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
            with_volume: bool = False, bars: int = BARS, context_tf: str | None = None,
            deep: int = 0) -> dict | None:
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

    out = {
        't':  [d.strftime(date_fmt) for d in tail.index],
        'o':  [_round(v) for v in tail['Open']],
        'h':  [_round(v) for v in tail['High']],
        'l':  [_round(v) for v in tail['Low']],
        'c':  [_round(v) for v in tail['Close']],
        **({'context': frame_context(df, context_tf)} if context_tf else {}),
        **({'analysis': {key: [_round(v, 12) for v in tail[col]]
                        for key, col in [('c','Close'),('h','High'),('l','Low')]}}
           if context_tf == '1H' else {}),
        'p':  periods,
        'ms': MA_STRIDE,
        'mi': keep,
        'm':  [[_round(v) for v in mas[p].tail(bars).iloc[keep]] for p in periods],
        # Signal calculations need each completed day's value. Interpolating
        # the display ribbon between sampled points would read future days.
        **({'am': [[_round(v, 12) for v in mas[p].tail(bars)] for p in periods]}
           if context_tf == 'D' else {}),
        **({'v': [int(v) if pd.notna(v) and math.isfinite(v) else 0
                  for v in tail['Volume']]}
           if with_volume and 'Volume' in tail.columns else {}),
    }
    start = len(df) - n
    head = df.iloc[max(0, start - deep):start] if deep > 0 else df.iloc[0:0]
    if len(head):
        hkeep = list(range(0, len(head), MA_STRIDE))
        out['deep'] = {
            't':  [d.strftime(date_fmt) for d in head.index],
            'o':  [_round(v) for v in head['Open']],
            'h':  [_round(v) for v in head['High']],
            'l':  [_round(v) for v in head['Low']],
            'c':  [_round(v) for v in head['Close']],
            'mi': hkeep,
            'm':  [[_round(v) for v in mas[p].iloc[start - len(head):start].iloc[hkeep]] for p in periods],
            **({'v': [int(v) if pd.notna(v) and math.isfinite(v) else 0 for v in head['Volume']]}
               if 'v' in out else {}),
        }
    return out


def _attach_deep(bundle: dict) -> dict:
    """Stitch the `deep` block (older bars, see DEEP_BARS_BY_TF) on in front of
    a finished bundle, shifting every bar-position field — `mi`, and the `sg` /
    `xm` markers the after-steps added — by the bars put in front."""
    d = bundle.pop('deep', None)
    if not d or not d.get('t'):
        return bundle
    n = len(d['t'])
    for k in ('t', 'o', 'h', 'l', 'c', 'v'):
        if k in bundle and k in d:
            bundle[k] = d[k] + bundle[k]
    bundle['m'] = [dm + bm for dm, bm in zip(d['m'], bundle['m'])]
    bundle['mi'] = d['mi'] + [i + n for i in bundle['mi']]
    for k in ('sg', 'xm'):
        if k in bundle:
            bundle[k] = [[row[0] + n, *row[1:]] for row in bundle[k]]
    return bundle


def build_daily(cache_dir: str, ticker: str) -> dict | None:
    path = os.path.join(cache_dir, _cache_name(ticker))
    if not os.path.exists(path):
        return None
    df = scale_daily(ticker, pd.read_parquet(path))
    periods = [p for p in MA_PERIODS if p <= len(df)]
    if not periods:
        return None
    out = _bundle(df, periods, '%Y-%m-%d', with_volume=True, bars=BARS_BY_TF['D'], context_tf='D',
                  deep=DEEP_BARS_BY_TF['D'])
    if out:
        out['references'] = reference_history(df)
        # Higher-timeframe MA lines for the overlay: Weekly 50/250/500 and
        # Monthly 50 only (user, 2026-09-28: "the monthly with a 50MA thicker
        # than them all"; a Monthly 250/500 is ~21/42 years, never warm).
        # Carries BOTH overlay MA sets (user, 2026-09-28: "another profile for
        # the overlay ... 50, 100, 200, 300 and 500"); the client draws the
        # set chosen. A period the history cannot warm is dropped by
        # _htf_mas (Monthly 500 = ~42 years, never; 300 = 25, rarely).
        for key, resample, periods in (('w', _resample_weekly, OVERLAY_MA_PERIODS),
                                       ('mo', _resample_monthly, OVERLAY_MA_PERIODS)):
            ma = _htf_mas(df, (out.get('deep') or out)['t'][0], resample, periods)
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


def _attach_forming(bundle: dict, hourly: pd.DataFrame,
                    completed: pd.DataFrame, hours: int) -> dict:
    """Carry one hourly-fetch snapshot separately from closed-bar analysis.

    Signals, alerts and channel trends continue to consume the unchanged
    columnar arrays. Only the chart renderer appends this provisional candle.
    """
    raw = hourly.copy()
    if raw.index.tz is not None:
        raw.index = raw.index.tz_convert('UTC').tz_localize(None)
    now = _utc_now()
    raw = raw[~raw.index.duplicated(keep='last')].sort_index()
    raw = raw.loc[raw.index <= now].dropna(subset=['Open', 'High', 'Low', 'Close'])
    if raw.empty:
        return bundle
    frame = raw if hours == 1 else _resample_4h(raw, hours=hours, completed_only=False)
    start = frame.index[-1]
    end = start + pd.Timedelta(hours=hours)
    if start <= completed.index[-1] or end <= now:
        return bundle
    # A bar is session-anchored, so the last one of a session is short: a US
    # equity's 17:30 UTC 4H bar ends at the 20:00 close, not at 21:30. Once the
    # hourly feed has nothing newer than a bar that has already ended, the
    # candle has stopped forming; say it closed then, so the chart reads
    # "Awaiting final update" instead of "Still forming" for up to 2 hours
    # after the session (the final completed bar still waits for `end`).
    last_hour_end = raw.index[-1] + pd.Timedelta(hours=1)
    closes = min(end, last_hour_end) if last_hour_end <= now else end
    row = frame.iloc[-1]
    values = {key: _round(row[col]) for key, col in
              [('o', 'Open'), ('h', 'High'), ('l', 'Low'), ('c', 'Close')]}
    if any(value is None for value in values.values()):
        return bundle
    bundle['forming'] = {
        't': start.strftime('%Y-%m-%d %H:%M'),
        'closes_at': closes.strftime('%Y-%m-%dT%H:%M:%SZ'),
        **values,
        'm': [_round((completed['Close'].tail(p - 1).sum() + row['Close']) / p)
              for p in bundle['p']],
    }
    return bundle


def build_1h(cache_dir: str, ticker: str) -> dict | None:
    """1H chart from the hourly cache (load_1h). A cash index redirected by
    H4_SOURCE stores its hourly bars under the CONTRACT's name.
    """
    # 2026-09-27: back on the Charts tab — the intraday
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
    n_deep = int((frame.index > cutoff - pd.DateOffset(months=DEEP_MONTHS_1H)).sum())
    deep = max(0, min(n_deep, BARS_BY_TF['1H'] + DEEP_BARS_BY_TF['1H'], max(warm_cap, 1)) - bars)
    return _attach_forming(_bundle(frame, periods, '%Y-%m-%d %H:%M', bars=bars, context_tf='1H', deep=deep),
                           df_1h, frame, 1)


def _read_daily(cache_dir: str, ticker: str) -> pd.DataFrame | None:
    path = os.path.join(cache_dir, _cache_name(ticker))
    if not os.path.exists(path):
        return None
    df = pd.read_parquet(path)
    return None if df.empty else df


def build_weekly(cache_dir: str, ticker: str) -> dict | None:
    """Weekly chart from the Daily cache — the local dev server's path. The
    published one is weekly_bundle over the instrument's whole history."""
    df = _read_daily(cache_dir, ticker)
    return None if df is None else weekly_bundle(ticker, df)


def build_monthly(cache_dir: str, ticker: str) -> dict | None:
    """Monthly chart from the Daily cache; see build_weekly."""
    df = _read_daily(cache_dir, ticker)
    return None if df is None else monthly_bundle(ticker, df)


def weekly_bundle(ticker: str, df: pd.DataFrame) -> dict | None:
    """Weekly chart from daily bars, as deep as `df` goes.

    520 weekly bars is ~10 years, which is what the MA500 anchor needs to
    be drawn at all — so a weekly chart deliberately shows far more calendar
    time than a daily one. Volume is included, as on daily. Price is scaled the
    way build_daily scales it, so a week closes where the Daily chart says.

    Carries the MONTHLY overlay MAs itself (`mo`, user 2026-10-19: "we will
    need the monthly overlay on weekly"), rolled over the same whole history,
    so they reach back as far as the weekly bars do. The Daily bundle's `mo`
    only spans the Daily chart's ~5 years.
    """
    df = scale_daily(ticker, df)
    weekly = _resample_weekly(df)
    periods = [p for p in MA_PERIODS if p <= len(weekly)]
    if len(periods) < MIN_RIBBON_LINES:
        return None
    # Stamped on the week's MONDAY, not the Friday _resample_weekly labels it by
    # (that label is what drops the week in progress). The app places every bar
    # at its start, as Daily is — an end stamp would put each week, the year
    # lines and the overlay one bar apart. TradingView stamps weeks this way too.
    weekly.index = weekly.index - pd.Timedelta(days=4)
    out = _bundle(weekly, periods, '%Y-%m-%d', with_volume=True, bars=BARS_BY_TF['W'])
    if out:
        mo = _htf_mas(df, out['t'][0], _resample_monthly, OVERLAY_MA_PERIODS)
        if mo:
            out['mo'] = mo
    return out


def monthly_bundle(ticker: str, df: pd.DataFrame) -> dict | None:
    """Monthly chart from daily bars, as deep as `df` goes.

    The one timeframe that ignores MIN_RIBBON_LINES: a monthly MA250 is ~21
    years, so short histories carry the MA50 alone, and the two-line floor
    would reject them. An instrument without 50 monthly bars gets no monthly
    chart at all. Over the whole Yahoo history many indices and old stocks do
    warm the 250 and some the 500 (~42 years).
    """
    monthly = _resample_monthly(scale_daily(ticker, df))
    periods = [p for p in MA_PERIODS if p <= len(monthly)]
    if not periods:
        return None
    # Stamped on the 1st, for the reason in build_weekly.
    monthly.index = monthly.index.to_period('M').to_timestamp()
    return _bundle(monthly, periods, '%Y-%m-%d', with_volume=True, bars=BARS_BY_TF['M'])


# How far back quotes.json's `h` / `l` reach: a little over the hourly data
# run spacing, so consecutive runs overlap rather than leave a gap.
QUOTE_RANGE_MIN = 70


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
    # Reference closes for the LIVE 1W/1M/1Y moves (2026-10-27, user: "can the
    # live be added as well?"): the daily close 5, 21 and 252 sessions before
    # this price's session. price / ref - 1 is then the same 5/21/252-bar
    # return indicators.py gives a closed bar, ending at the latest price —
    # on a closed daily price it IS pct_1w/1m/1y.
    before = daily['Close'][daily.index.normalize() < ts.normalize()] if len(daily) else pd.Series(dtype=float)
    refs = [_round(float(before.iloc[-n])) if len(before) >= n else None for n in (5, 21, 252)]
    out = {'p': _round(last), 'pc': _round(pc), 't': ts.strftime('%Y-%m-%d %H:%M'), 's': srcname, 'r': refs,
           # LIVE polling (Watchlist): `y` is the Yahoo symbol to poll, `b` the
           # spot/cash shift to subtract from it (load_5m's basis at the last
           # bar), `yc` an unshifted level reference polled alongside — the cash
           # index or XAUT — which the app uses whenever it is the fresher print.
           # Crypto polls its exchange instead ('BINANCE:XRPUSDT'), which the
           # live Worker routes there (exchange_feed, 2026-10-19).
           'y': exchange_feed.source(ticker) or src}
    # The last hour's range (2026-11-03, ladder line alerts): the sync Worker
    # checks the user's alert lines against it after every data run, so a
    # wick through a line between two runs still counts. Finished 5m bars in
    # the QUOTE_RANGE_MIN minutes up to the price; the same feed as `p`.
    if srcname == '5m':
        win = five[five.index > ts - pd.Timedelta(minutes=QUOTE_RANGE_MIN)]
        hi = win['High'] if 'High' in win else win['Close']
        lo = win['Low'] if 'Low' in win else win['Close']
        if len(win):
            out['h'], out['l'] = _round(float(hi.max())), _round(float(lo.min()))
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
XM_HOLD_BY_TF = {'15m': 4, '30m': 2, '1H': 1}
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
    for k, series in enumerate(bd['m']):
        if bd.get('am') and k < len(bd['am']) and len(bd['am'][k]) == on:
            dm.append(bd['am'][k])
            continue
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


# Volume that is not a volume series (2026-11-08). Yahoo's =F futures report the
# volume of ONE contract, whichever it currently treats as front, so on metals
# and crops the series swings between a thin delivery month (~360 contracts a
# day on GOLD) and the active one (120k+) and back. Measured over the last 520
# Daily bars of all 737 instruments with volume: the median p90/p10 is 3.1; the
# ten metal/crop futures are 126-2,848 with 15-94 ten-fold day-to-day swings;
# ZECUSDT is 142 with 0 swings (real growth, kept); every other instrument is
# under 34, and none is over 50 with 10+ swings. The app leaves the volume
# strip empty for the names listed here, on every timeframe: the rule only
# separates cleanly on Daily (on 10-year Weekly bars fast-growing small caps
# such as QUBT trip it), so Daily decides for all three.
VOL_CHECK_BARS = 520
VOL_SPREAD_MAX = 50       # p90 / p10 of reported volume
VOL_SWINGS_MAX = 10       # day-to-day changes of 10x or more, either way


def volume_unreliable(v: list) -> bool:
    """True when a Daily volume series swings like a contract switch, not a market."""
    vv = [x if x and x > 0 else 0 for x in (v or [])[-VOL_CHECK_BARS:]]
    rep = sorted(x for x in vv if x > 0)
    if len(rep) < 50:
        return False
    spread = rep[9 * len(rep) // 10] / max(rep[len(rep) // 10], 1)
    swings = sum(1 for a, b in zip(vv, vv[1:]) if a > 0 and b > 0 and (b / a > 10 or a / b > 10))
    return spread > VOL_SPREAD_MAX and swings >= VOL_SWINGS_MAX


def unreliable_volume_names(daily: dict) -> list:
    return sorted(name for name, bd in daily.items() if volume_unreliable(bd.get('v')))


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


# The charts the hourly run builds, from config.TIMEFRAME_TABLE (chart 'run').
# By NAME, looked up at call time, so a test that patches a builder on this
# module is still the builder that runs. Weekly and Monthly are built by
# tools/publish_htf.py. Retired chart timeframes' R2 folders are deleted by
# publish.prune_retired_chart_folders.
CHART_BUILDERS = dict(RUN_CHART_BUILDERS)
# Charts that carry signals, and so alerts and channel reads: fast to slow.
SIGNAL_CHART_TFS = tuple(code for code, _ in TIMEFRAMES if code in CHART_BUILDERS)
# Below this many builds a process pool costs more to start than it saves.
MIN_POOL_JOBS = 32


def _build_recorded(job: tuple) -> tuple:
    """One chart build in a worker process, with the parquet files it read."""
    tf, cache_dir, ticker = job
    with recording() as reads:
        try:
            bundle = globals()[CHART_BUILDERS[tf]](cache_dir, ticker)
        except Exception:
            # One unreadable parquet must not sink the whole feed. The
            # instrument simply shows "no chart data" on its card.
            bundle = None
    return bundle, reads


def build_chart_feed(output_dir: str, cache_dir: str, ticker_map: dict,
                     max_workers: int = 8, fires_path: str | None = None,
                     d_fires_path: str | None = None,
                     h1_fires_path: str | None = None) -> dict:
    """Write chart/<tf>/<chunk>.json bundles + chart/index.json.

    ticker_map — instrument display name -> yfinance ticker.
    Returns {'1H': n, 'D': n, 'chunks': n_files}.
    Weekly and Monthly are published separately, by tools/publish_htf.py.
    """
    chart_dir = os.path.join(output_dir, 'chart')
    os.makedirs(chart_dir, exist_ok=True)

    names = sorted(ticker_map)
    # Chunk on the sorted name list so an instrument's chunk id is stable
    # between publishes — the reel caches bundles across sessions.
    chunk_of = {n: i // CHUNK_SIZE for i, n in enumerate(names)}

    stats = {**{tf: 0 for tf in CHART_BUILDERS}, 'chunks': 0}
    built: dict[str, dict[str, dict]] = {}

    # 2026-11-01: a chart whose inputs have not changed is taken from the
    # chart cache instead of rebuilt (chart_cache.py says exactly when), and the
    # rest are built in worker PROCESSES. The thread pool this replaced ran on
    # one core — the builders are pure-Python loops that hold the GIL.
    store = Store(cache_dir)
    store.drop_other_timeframes(CHART_BUILDERS)
    results: dict[tuple, dict | None] = {}
    jobs, metas = [], {}
    for tf in CHART_BUILDERS:
        for name in names:
            ticker = ticker_map[name]
            meta = store.meta(tf, ticker, (h4_ticker(ticker), FIVE_MIN_LEVEL_REF.get(ticker),
                                           exchange_feed.source(ticker)))
            hit, bundle = store.load(tf, ticker, meta)
            if hit:
                results[(tf, name)] = bundle
            else:
                metas[(tf, name)] = meta
                jobs.append((tf, cache_dir, ticker))
    keys = list(metas)
    procs = max(1, min(max_workers, os.cpu_count() or 1))
    built_jobs = None
    if procs > 1 and len(jobs) >= MIN_POOL_JOBS:
        try:
            with concurrent.futures.ProcessPoolExecutor(max_workers=procs) as ex:
                built_jobs = list(ex.map(_build_recorded, jobs, chunksize=4))
        except concurrent.futures.BrokenExecutor as exc:
            # A worker killed (memory) or unable to start must cost speed,
            # never the feed: build the lot here instead.
            print(f'  WARN chart worker pool failed ({exc}); building in-process')
    if built_jobs is None:
        built_jobs = [_build_recorded(job) for job in jobs]
    for key, (tf, _, ticker), (bundle, reads) in zip(keys, jobs, built_jobs):
        store.save(tf, ticker, metas[key], reads, bundle)
        results[key] = bundle
    for tf in CHART_BUILDERS:
        store.prune(tf, ticker_map.values())
        built[tf] = {name: results[(tf, name)] for name in names if results.get((tf, name))}
        stats[tf] = len(built[tf])
    stats['cached'] = store.hits

    # The 30m marker pass went with the 30m chart (2026-11-11); `fires_path`
    # (m30_fires.json) is accepted and ignored so older callers keep working.
    hourly_events: dict[str, dict] = {}

    # Hourly markers use the exact fires computed by the signal worker.
    # Daily-MA crosses can be drawn on 1H but alerts_feed avoids duplicating
    # those alerts when the finer 30m bundle is available.
    try:
        h1_fires = {}
        if h1_fires_path and os.path.exists(h1_fires_path):
            with open(h1_fires_path) as fh:
                h1_fires = json.load(fh)
        for name, bundle in built.get('1H', {}).items():
            ev = _attach_15m_marks(bundle, built.get('D', {}).get(name), h1_fires.get(name),
                                   hold=XM_HOLD_BY_TF['1H'])
            if ev:
                hourly_events[name] = ev
    except Exception as exc:
        raise RuntimeError('Hourly chart markers could not be built') from exc

    attach_setup_context(built)
    for name, bundle in built.get('D', {}).items():
        positions = {t: i for i, t in enumerate(bundle['t'])}
        bundle['sg'] = [[positions[e['at']], e['code']] for e in bundle.get('context', {}).get('events', []) if e['at'] in positions]
    # The "B1 / S1 · 2 sessions" filter reads 1H since 4H went (2026-11-04):
    # the latest workflow B1/S1 (completed close across the 1H MA500, the rule
    # 4H used) on the 1H bundle's last two trading dates, the same events the
    # Alerts tab lists. It replaces the h1-fires `s` from the marker pass.
    for name, bundle in built.get('1H', {}).items():
        dates = sorted({str(t)[:10] for t in bundle['t']})
        if not dates:
            continue
        since = dates[-2] if len(dates) > 1 else dates[-1]
        recent = [e for e in bundle.get('context', {}).get('events', []) if e['code'] in ('B1', 'S1') and e['at'][:10] >= since]
        ev = hourly_events.get(name, {})
        ev.pop('s', None)
        if recent:
            ev['s'] = [recent[-1]['code'], recent[-1]['at']]
        if ev:
            hourly_events[name] = ev
        else:
            hourly_events.pop(name, None)

    # Alerts tab (2026-09-27): every marker above as a listed alert, with what
    # price did after it. A failure costs the Alerts tab, never the chart feed.
    try:
        from alerts_feed import build_alerts
        d_fires = {}
        if d_fires_path and os.path.exists(d_fires_path):
            with open(d_fires_path) as fh:
                d_fires = json.load(fh)
        # 1H + Daily (30m removed 2026-11-11).
        alerts = build_alerts({tf: built.get(tf, {}) for tf in SIGNAL_CHART_TFS}, d_fires)
        alerts.update(workflow_alerts(built))
        _write_gz(os.path.join(output_dir, 'alerts.json'), alerts)
        stats['alerts'] = len(alerts['ev'])
    except Exception as exc:
        print(f'  WARN alerts.json not built: {exc}')

    # Active sectors at the last Daily close (2026-10-28, activity_feed): big
    # moves against each market's own typical move, per radar sector. Weekly
    # and Monthly are written by tools/publish_htf.py with their charts. A
    # failure costs the Watchlist strip, never the chart feed.
    try:
        from activity_feed import build_activity
        from instruments import load_instruments
        act = build_activity(built.get('D', {}), load_instruments(), 'D')
        os.makedirs(os.path.join(output_dir, 'activity'), exist_ok=True)
        _write_gz(os.path.join(output_dir, 'activity', 'D.json'), act)
        stats['activity'] = act['active']
    except Exception as exc:
        print(f'  WARN activity/D.json not built: {exc}')

    # The user's trend read (2026-10-04: "this is how i see trends ... not any other
    # way"): up / down / neutral per instrument per timeframe from channel_rule, the
    # same rule that draws the auto channels. The app's effectiveTrend() reads it, so
    # every trend count and filter follows the channels. A failure costs the file
    # (the app falls back to trend_direction), never the chart feed.
    try:
        from channel_rule import read as channel_read
        rd = {tf: {n: channel_read(b, tf) for n, b in built.get(tf, {}).items()} for tf in SIGNAL_CHART_TFS}
        tc = {tf: {n: v[0] for n, v in m.items()} for tf, m in rd.items()}
        since = {tf: {n: v[1] for n, v in m.items() if v[1]} for tf, m in rd.items()}
        payload = {'generated_at': pd.Timestamp.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'), 'tf': tc, 'since': since, 'workflow': workflow_context(built), 'workflow_version': 1}
        # Currency focus (2026-10-05): the strongest vs weakest major currency index
        # and the pairs their cross current runs through. A failure costs the card.
        try:
            from currency_index import focus as ccy_focus
            payload['ccy'] = ccy_focus(built, rd, {t: n for n, t in ticker_map.items()})
        except Exception as exc:
            print(f'  WARN currency focus not built: {exc}')
        _write_gz(os.path.join(output_dir, 'trend_channels.json'), payload)
        stats['trend'] = {tf: sum(v != 'NEUTRAL' for v in m.values()) for tf, m in tc.items()}
    except Exception as exc:
        print(f'  WARN trend_channels.json not built: {exc}')

    for tf, bundles in built.items():
        # Full precision OHLC is only needed while building setup context.
        # Keep phone downloads compact; display arrays remain unchanged.
        for bundle in bundles.values():
            bundle.pop('analysis', None)
            # `am` (full-precision Daily MAs) is read only by cross_marks,
            # above; the app never has — it was ~1/3 of every Daily chunk.
            bundle.pop('am', None)
            _attach_deep(bundle)
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
               'bars_by_tf': BARS_BY_TF, 'chunks': chunk_of,
               'events_by_tf': {'1H': hourly_events},
               'near': near_ma_map(built.get('D', {})),
               'novol': unreliable_volume_names(built.get('D', {}))})

    return stats

