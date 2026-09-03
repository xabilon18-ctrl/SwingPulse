"""
Yahoo Finance data fetcher with incremental disk-based parquet cache.

Strategy:
  - First run / force_refresh: downloads full history from scratch.
  - Daily runs: fetches ONLY bars newer than the last cached date (~1-2 rows)
                then appends to the existing parquet file.
  - Cache < 20 hours old: returned as-is (no network call at all).
  - Network failure: falls back to existing cache rather than crashing.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd
import yfinance as yf

from _active_config import HISTORY_YEARS, CACHE_DIR, MIN_ROWS_REQUIRED, H4_SOURCE


def h4_ticker(ticker: str) -> str:
    """The ticker the 4H timeframe is built from.

    A cash index's 1h feed is regular-session only (~2 four-hour bars a
    session), so its 4H ribbon reaches ~3x further back than the 24h contract
    the instrument is actually charted on. H4_SOURCE redirects the 4H feed to
    that contract. DAILY is unaffected and still comes from `ticker` — the two
    timeframes are independent. See config.py §"4H bar geometry".
    """
    return H4_SOURCE.get(ticker, ticker)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cache_path(ticker: str, suffix: str = '') -> str:
    """Convert ticker to a safe filename. suffix differentiates daily vs hourly."""
    safe = (ticker
            .replace('=', '_EQ_')
            .replace('^', '_IDX_')
            .replace('.', '_DOT_'))
    tag = f'_{suffix}' if suffix else ''
    return os.path.join(CACHE_DIR, f'{safe}{tag}.parquet')


def _is_fresh(path: str, max_age_hours: int = 20) -> bool:
    """Return True if the cache file exists and is newer than max_age_hours."""
    if not os.path.exists(path):
        return False
    age = datetime.now() - datetime.fromtimestamp(os.path.getmtime(path))
    return age < timedelta(hours=max_age_hours)


def _normalise(df: pd.DataFrame) -> pd.DataFrame:
    """Flatten MultiIndex columns (newer yfinance versions) and standardise."""
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df.index.name = 'date'
    df.columns = [c.strip() for c in df.columns]
    return df


def _drop_priceless(df: pd.DataFrame) -> pd.DataFrame:
    """Drop bars Yahoo returned with no Close.

    Yahoo intermittently serves a bar carrying real Volume but NaN OHLC — an
    upstream defect, not a market holiday (2026-07-24: 365 of 741 instruments
    had one, MU showing 40.3M shares traded against NaN prices; re-fetching
    returns the same broken bar, so the prices are simply unrecoverable).

    Left in place these are corrosive out of all proportion to their size,
    because a rolling mean whose window contains a NaN is itself NaN:
      - as the LAST bar it blanks close + all 20 MAs for that instrument, and
        `trend_direction` (indicators.py) then falls through np.select to its
        default of NEUTRAL. 426 of 727 instruments read NEUTRAL on the Daily
        tab, of which only 49 were genuinely between the MAs; the rest were
        strong trends with no data. No daily signal can fire for them either.
      - mid-history one NaN blanks MA500 for the following 500 bars.

    The 4H path never had this problem because `_resample_4h` in main.py ends
    in .dropna(subset=['Close']); daily fed the raw frame to add_all_indicators.

    Verified safe before adopting: across 1,587 caches ZERO NaN-Close rows
    carried a real Open/High/Low, and a 300-cache sample found ZERO rows with
    a real Close but NaN OHLC (which this would keep). Nothing of value is lost.
    """
    if 'Close' not in df.columns or df.empty:
        return df
    return df.dropna(subset=['Close'])


# ---------------------------------------------------------------------------
# Finished sessions only
# ---------------------------------------------------------------------------
#
# A bar is admitted to the pipeline only once the session that builds it has
# ENDED. A run that lands while a market is open otherwise reads a half-made
# day as if it were a close.
#
# This is not hypothetical. The 20-hour freshness gate in fetch() means that of
# the three CI runs a day, only the first actually downloads — so the whole
# day's dashboard is built from ONE snapshot taken at 03:00 UTC. At 03:00 UTC
# New York has closed and London has not opened (both fine), but Tokyo, Hong
# Kong and Sydney are MID-SESSION and crypto never stops. Measured 2026-08-04
# against a fresh pull: ASX200 held 28% of its session's volume, Japan 51%,
# the Asian indices 0%, and their closes were off by 0.5-1.3% — an unfinished
# price that then fed the ribbon and the signals.
#
# Deliberately NOT a per-exchange timetable. Every venue in the universe closes
# before midnight UTC on its own bar date (Asia ~06:00, Europe ~16:30, US
# ~20:00-21:00, CME ~21:00) and a crypto UTC day ends exactly there, so "the
# UTC day after the bar's date has begun" is one rule that is correct for all
# 736 instruments with no table to maintain and nothing to drift.
#
# Late volume is a SEPARATE problem and is not solved here — Yahoo settles the
# close immediately but backfills volume for hours (US bars first arrive at
# ~79% of final volume, UK/Spain far less). That is what re-requesting the last
# cached date in fetch() is for. The two work together: this keeps unfinished
# bars OUT, the re-request pulls late corrections IN.

def _utc_now() -> pd.Timestamp:
    return pd.Timestamp.utcnow().tz_localize(None)


def drop_unfinished_daily(df: pd.DataFrame) -> pd.DataFrame:
    """Drop trailing daily bars whose session has not closed yet."""
    if df.empty:
        return df
    idx = df.index
    if getattr(idx, 'tz', None) is not None:
        idx = idx.tz_convert('UTC').tz_localize(None)
    # Bar dated D is final once the UTC day after D has started.
    return df[pd.DatetimeIndex(idx).normalize() + pd.Timedelta(days=1) <= _utc_now()]


def drop_unfinished_1h(df: pd.DataFrame) -> pd.DataFrame:
    """Drop trailing hourly bars whose hour has not elapsed yet.

    Same rule as drop_unfinished_4h with a one-hour window (Important Rule 10:
    the pipeline never computes on a bar whose period is still open). Hourly
    caches are stored in UTC, so no per-exchange timetable is needed.
    """
    if df.empty:
        return df
    idx = df.index
    if getattr(idx, 'tz', None) is not None:
        idx = idx.tz_convert('UTC').tz_localize(None)
    return df[pd.DatetimeIndex(idx) + pd.Timedelta(hours=1) <= _utc_now()]


def drop_unfinished_4h(df: pd.DataFrame) -> pd.DataFrame:
    """Drop trailing 4H bars whose 4-hour window has not elapsed yet.

    Applied after resampling, so a bucket is judged by its own window rather
    than by the session — the last bucket of a short session is simply admitted
    a few hours late, which the once-a-day fetch cadence makes free.
    """
    if df.empty:
        return df
    idx = df.index
    if getattr(idx, 'tz', None) is not None:
        idx = idx.tz_convert('UTC').tz_localize(None)
    return df[pd.DatetimeIndex(idx) + pd.Timedelta(hours=4) <= _utc_now()]


def heal_daily_gaps_from_hourly(daily: pd.DataFrame, hourly: pd.DataFrame) -> pd.DataFrame:
    """Rebuild whole daily bars Yahoo's daily feed simply omitted.

    ONLY safe for 24/7 instruments, and only called for them: a crypto daily
    bar IS the UTC day, so resampling the hourly feed reproduces it exactly.
    An equity's daily bar is a session with pre/post-market either side of it
    and cannot be reconstructed this way, so equities are never passed here.

    Yahoo drops crypto days routinely — 2026-08-03 was missing for all 55 coins
    while the hourly feed had every hour of it. Measured over ~400 days: every
    one of the 55 has gaps, median 6 days each, GALA 32. Mid-history a gap is a
    small ribbon distortion, but at the tail it collides with the finished-
    sessions rule — drop the in-progress day, fall back to a missing one, and
    the instrument reads two days stale.
    """
    if daily.empty or hourly is None or hourly.empty:
        return daily
    h = hourly.copy()
    if getattr(h.index, 'tz', None) is not None:
        h.index = h.index.tz_convert('UTC').tz_localize(None)
    rebuilt = h.resample('1D').agg({'Open': 'first', 'High': 'max', 'Low': 'min',
                                    'Close': 'last', 'Volume': 'sum'}).dropna(subset=['Close'])
    have = pd.DatetimeIndex(daily.index).normalize()
    missing = rebuilt.index.difference(have)
    # Only fill INSIDE the daily series' own span — never extend it past the
    # end, or an in-progress day would sneak back in through this door.
    missing = missing[(missing > have.min()) & (missing < have.max())]
    if len(missing) == 0:
        return daily
    out = pd.concat([daily, rebuilt.loc[missing, [c for c in rebuilt.columns if c in daily.columns]]])
    return out.sort_index()


def _read_cache(path: str) -> pd.DataFrame:
    """Read a parquet cache, healing any priceless bars already stored in it.

    Existing caches are cleaned on read and rewritten, so the fix reaches the
    365 files that already hold a bad bar without forcing a full re-download.
    Rewriting also rolls the cache's last date back to the last real bar, which
    makes the next incremental run re-request the bad day — so if Yahoo ever
    repairs it, the bar returns on its own with no manual step.
    """
    df = pd.read_parquet(path)
    cleaned = _drop_priceless(df)
    if len(cleaned) != len(df):
        try:
            cleaned.to_parquet(path)
        except Exception:
            pass        # read-only FS / race — the in-memory frame is still correct
    return cleaned


def _full_download(ticker: str, start: datetime, end: datetime,
                   interval: str = '1d') -> pd.DataFrame | None:
    """Download a date range from Yahoo Finance. Raises on empty response.

    Uses Ticker.history() rather than yf.download() — download() mutates
    module-level shared state (shared._DFS/_ERRORS) and cross-contaminates
    results when called from multiple threads (the 2026-06 cache-corruption
    bug). Ticker.history() is self-contained and thread-safe.
    """
    df = yf.Ticker(ticker).history(
        start=start.strftime('%Y-%m-%d'),
        end=end.strftime('%Y-%m-%d'),
        interval=interval,
        auto_adjust=True,
        actions=(interval == '1d'),
    )
    if df.empty:
        raise ValueError('empty response')
    # Match the cache's index convention: daily bars are tz-naive exchange
    # dates; hourly bars are tz-aware UTC instants.
    if df.index.tz is not None:
        if interval == '1d':
            df.index = df.index.tz_localize(None).normalize()
        else:
            df.index = df.index.tz_convert('UTC')
    # Never let a priceless bar into the cache. May return an empty frame when
    # the only bar on offer is broken — callers handle that as "no new bars".
    return _drop_priceless(_normalise(df))


def _append_new_bars(path: str, new_df: pd.DataFrame) -> pd.DataFrame:
    """Append new_df rows to the parquet file, deduplicate, and save."""
    existing = pd.read_parquet(path)
    combined = pd.concat([existing, new_df])
    combined = combined[~combined.index.duplicated(keep='last')]
    combined.sort_index(inplace=True)
    combined = _drop_priceless(combined)
    combined.to_parquet(path)
    return combined


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch(ticker: str, force_refresh: bool = False) -> pd.DataFrame | None:
    """
    Return a daily OHLCV DataFrame for *ticker*.

    - force_refresh=True  → re-downloads full 16-year history (used by /refresh-data)
    - Normal daily run    → appends only bars newer than last cached date (~1-2 rows)
    - Cache < 20 hrs old  → returned immediately, no network call
    """
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = _cache_path(ticker)

    # ── Already fresh: return immediately ────────────────────────────────
    if not force_refresh and _is_fresh(path):
        return _read_cache(path)

    # yfinance treats `end` as EXCLUSIVE, so add a day to include today's bar.
    end = datetime.today() + timedelta(days=1)

    # ── Force refresh: re-download full history ───────────────────────────
    if force_refresh or not os.path.exists(path):
        start = end - timedelta(days=int(HISTORY_YEARS * 365.25))
        try:
            df = _full_download(ticker, start, end)
            if df.empty:
                raise ValueError('no priced bars in response')
            df.to_parquet(path)
            return df
        except Exception as exc:
            print(f'    WARN [{ticker}] download failed: {exc}')
            if os.path.exists(path):
                print(f'    INFO [{ticker}] using stale cache')
                return _read_cache(path)
            return None

    # ── Incremental: fetch only new bars ─────────────────────────────────
    try:
        # Clean BEFORE reading last_date: a trailing priceless bar would
        # otherwise make last_date the broken day and start the fetch the day
        # AFTER it, so the missing session would never be requested again.
        existing   = _read_cache(path)
        last_date  = existing.index[-1]
        # Re-request the last cached date rather than starting the day AFTER it.
        #
        # A run that lands mid-session writes a bar that is real but INCOMPLETE,
        # and starting at last_date+1 meant that bar was never asked for again —
        # it froze at whatever the market had done by the time the run fired.
        # Measured 2026-08-04 against a fresh pull: 299 of 727 cached last bars
        # (41%) held less volume than the session finally traded.
        #
        # Two flavours, same cause. Yahoo settles the CLOSE immediately but
        # backfills VOLUME for some venues, so UK100 (75 names) and SPAIN35 (19)
        # froze at ~0.1% of true volume with a correct close — volume-only
        # damage. Where the run caught a genuinely live session the PRICE is
        # wrong too: Crypto off 1.34%, Commodity 1.05%, Japan 0.77%, ASX200
        # 0.54% at the median, which reaches the ribbon and the signals.
        #
        # `_append_new_bars` already dedupes with keep='last', so the corrected
        # bar simply overwrites the stale one; a bar that was already complete
        # is rewritten identically. Costs one extra bar per instrument per run.
        start      = last_date

        if start.date() > end.date():
            # Cache is already up to date — touch file to reset freshness timer
            os.utime(path, None)
            return existing

        new_df = _full_download(ticker, start, end)

        # Every bar on offer was priceless (Yahoo serving NaN OHLC for a session
        # it has volume for). Not an error and not worth a warning — there is
        # simply nothing new to add. The next run asks for the same day again.
        if new_df.empty:
            os.utime(path, None)
            return _drop_priceless(existing)

        # Sanity guard: a long gap or an absurd price discontinuity between
        # the cached series and the new bars means the cache went stale or
        # Yahoo's symbol mapping changed underneath us. Stitching across it
        # fabricates a giant one-bar move that fires fake reversal signals
        # (the APT-USD incident: dead-token history + one real bar = fake B1).
        # Re-download the full history instead.
        gap_days   = (new_df.index[0] - last_date).days
        prev_close = existing['Close'].iloc[-1]
        new_close  = new_df['Close'].iloc[0]
        ratio = (float(new_close) / float(prev_close)
                 if pd.notna(prev_close) and pd.notna(new_close) and float(prev_close) != 0
                 else 1.0)
        if gap_days > 10 or ratio > 3 or ratio < 1 / 3:
            print(f'    WARN [{ticker}] discontinuity (gap {gap_days}d, '
                  f'jump ×{ratio:.2f}) — re-downloading full history')
            start_full = end - timedelta(days=int(HISTORY_YEARS * 365.25))
            df = _full_download(ticker, start_full, end)
            df.to_parquet(path)
            return df

        return _append_new_bars(path, new_df)

    except Exception as exc:
        print(f'    WARN [{ticker}] incremental update failed: {exc}')
        if os.path.exists(path):
            return _read_cache(path)
        return None


# ---------------------------------------------------------------------------
# Hourly (4H timeframe)
# ---------------------------------------------------------------------------

HOURLY_HISTORY_DAYS = 729   # Yahoo Finance max for 1h interval


def fetch_hourly(ticker: str, force_refresh: bool = False,
                 max_age_hours: int = 20) -> pd.DataFrame | None:
    """
    Return an hourly OHLCV DataFrame for *ticker*.

    - force_refresh=True   → re-downloads full 729-day hourly history
    - Normal daily run     → fetches last 5 days and appends new bars only
    - Cache < max_age_hours → returned immediately (default 20h; use 1 for hourly pipelines)
    """
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = _cache_path(ticker, suffix='1h')

    # ── Already fresh ─────────────────────────────────────────────────────
    if not force_refresh and _is_fresh(path, max_age_hours=max_age_hours):
        return _read_cache(path)

    # yfinance treats `end` as EXCLUSIVE, so add a day to include today's bars.
    end = datetime.today() + timedelta(days=1)

    # ── Force refresh: full 729-day download ─────────────────────────────
    if force_refresh or not os.path.exists(path):
        start = end - timedelta(days=HOURLY_HISTORY_DAYS)
        try:
            df = _full_download(ticker, start, end, interval='1h')
            if df.empty:
                raise ValueError('no priced bars in response')
            df.to_parquet(path)
            return df
        except Exception as exc:
            print(f'    WARN [{ticker}] hourly download failed: {exc}')
            if os.path.exists(path):
                print(f'    INFO [{ticker}] using stale hourly cache')
                return _read_cache(path)
            return None

    # ── Incremental: fetch from the last cached bar onward ───────────────
    # Resumes from the last cached date (minus 1 day of overlap; dedup handles
    # repeats) so a multi-day pause between runs can't leave a gap in the cache.
    # Clamped to Yahoo's 729-day hourly limit.
    try:
        existing  = _read_cache(path)   # clean first — see the daily path
        last_date = existing.index[-1]
        if getattr(last_date, 'tzinfo', None) is not None:
            last_date = last_date.tz_localize(None)
        start = max(
            last_date.to_pydatetime() - timedelta(days=1),
            end - timedelta(days=HOURLY_HISTORY_DAYS),
        )

        new_df = _full_download(ticker, start, end, interval='1h')

        # Nothing priced on offer — see the daily path. Not an error.
        if new_df.empty:
            os.utime(path, None)
            return _drop_priceless(existing)

        # Sanity guard (same as daily): an absurd discontinuity between the
        # cached series and the new bars means the cache holds bad data —
        # re-download the full hourly history instead of stitching onto it.
        prev_close = existing['Close'].iloc[-1]
        new_close  = new_df['Close'].iloc[-1]
        ratio = (float(new_close) / float(prev_close)
                 if pd.notna(prev_close) and pd.notna(new_close) and float(prev_close) != 0
                 else 1.0)
        if ratio > 3 or ratio < 1 / 3:
            print(f'    WARN [{ticker}] hourly discontinuity (jump ×{ratio:.2f}) '
                  f'— re-downloading full hourly history')
            start_full = end - timedelta(days=HOURLY_HISTORY_DAYS)
            df = _full_download(ticker, start_full, end, interval='1h')
            df.to_parquet(path)
            return df

        return _append_new_bars(path, new_df)

    except Exception as exc:
        print(f'    WARN [{ticker}] hourly incremental failed: {exc}')
        if os.path.exists(path):
            return _read_cache(path)
        return None


# ---------------------------------------------------------------------------
# Bulk fetch helpers (called by main.py)
# ---------------------------------------------------------------------------

# Parallel fetch workers — network-bound, so threads give a near-linear
# speedup. Each ticker writes its own parquet file (no write contention).
# Override with FETCH_WORKERS=1 to fall back to sequential fetching.
FETCH_WORKERS = int(os.environ.get('FETCH_WORKERS', 8))


def _fetch_all_parallel(instruments, fetch_fn, min_rows, kind=''):
    """Shared driver: fetch every instrument via fetch_fn on a thread pool.
    Returns dict ticker → DataFrame, skipping None / too-short results."""
    import concurrent.futures

    data  = {}
    total = len(instruments)
    done  = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(FETCH_WORKERS, 1)) as ex:
        futures = {ex.submit(fetch_fn, inst['ticker']): inst for inst in instruments}
        for future in concurrent.futures.as_completed(futures):
            inst   = futures[future]
            ticker = inst['ticker']
            label  = f'{ticker:<15} ({inst["name"]:<12})'
            done  += 1
            try:
                df = future.result()
            except Exception as exc:
                print(f'  [{done:3d}/{total}] {label}  SKIP — error: {exc}')
                continue

            if df is None:
                print(f'  [{done:3d}/{total}] {label}  SKIP — no {kind}data')
                continue
            if len(df) < min_rows:
                print(f'  [{done:3d}/{total}] {label}  SKIP — only {len(df)} rows (need {min_rows})')
                continue

            data[ticker] = df
            print(f'  [{done:3d}/{total}] {label}  OK   {len(df)} rows  '
                  f'({df.index[0].date()} → {df.index[-1].date()})')

    return data


def fetch_all(instruments: list[dict], force_refresh: bool = False) -> dict[str, pd.DataFrame]:
    """Fetch daily data for every instrument. Returns dict ticker → DataFrame.

    NB the frames are used for their KEYS only — main.py's workers re-read each
    parquet per-ticker. `drop_unfinished_daily` is therefore applied there, at
    the read that actually feeds the indicators, NOT here.
    """
    data = _fetch_all_parallel(
        instruments,
        lambda t: fetch(t, force_refresh),
        min_rows=MIN_ROWS_REQUIRED,
    )
    print(f'\n  Loaded {len(data)}/{len(instruments)} instruments.\n')
    return data


def fetch_all_hourly(instruments: list[dict], force_refresh: bool = False,
                     max_age_hours: int = 20) -> dict[str, pd.DataFrame]:
    """Fetch hourly data for every instrument. Returns dict ticker → DataFrame.

    Cash indices in H4_SOURCE are fetched from their 24h contract instead. The
    cache is keyed by the SOURCE ticker (NQ=F lands in NQ_EQ_F_1h.parquet, not
    under ^NDX), so a file always holds what its name says and the incremental
    fetch/freshness logic keeps working per real ticker. main.py resolves the
    same mapping when it reads the cache back.
    """
    data = _fetch_all_parallel(
        instruments,
        lambda t: fetch_hourly(h4_ticker(t), force_refresh, max_age_hours=max_age_hours),
        min_rows=200,
        kind='hourly ',
    )
    print(f'\n  Loaded hourly data for {len(data)}/{len(instruments)} instruments.\n')
    return data
