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

from _active_config import HISTORY_YEARS, CACHE_DIR, MIN_ROWS_REQUIRED


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


def _full_download(ticker: str, start: datetime, end: datetime,
                   interval: str = '1d') -> pd.DataFrame | None:
    """Download a date range from Yahoo Finance. Returns None on failure."""
    df = yf.download(
        ticker,
        start=start.strftime('%Y-%m-%d'),
        end=end.strftime('%Y-%m-%d'),
        interval=interval,
        auto_adjust=True,
        progress=False,
        actions=(interval == '1d'),
    )
    if df.empty:
        raise ValueError('empty response')
    return _normalise(df)


def _append_new_bars(path: str, new_df: pd.DataFrame) -> pd.DataFrame:
    """Append new_df rows to the parquet file, deduplicate, and save."""
    existing = pd.read_parquet(path)
    combined = pd.concat([existing, new_df])
    combined = combined[~combined.index.duplicated(keep='last')]
    combined.sort_index(inplace=True)
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
        return pd.read_parquet(path)

    # yfinance treats `end` as EXCLUSIVE, so add a day to include today's bar.
    end = datetime.today() + timedelta(days=1)

    # ── Force refresh: re-download full history ───────────────────────────
    if force_refresh or not os.path.exists(path):
        start = end - timedelta(days=int(HISTORY_YEARS * 365.25))
        try:
            df = _full_download(ticker, start, end)
            df.to_parquet(path)
            return df
        except Exception as exc:
            print(f'    WARN [{ticker}] download failed: {exc}')
            if os.path.exists(path):
                print(f'    INFO [{ticker}] using stale cache')
                return pd.read_parquet(path)
            return None

    # ── Incremental: fetch only new bars ─────────────────────────────────
    try:
        existing   = pd.read_parquet(path)
        last_date  = existing.index[-1]
        start      = last_date + timedelta(days=1)

        if start.date() >= end.date():
            # Cache is already up to date — touch file to reset freshness timer
            os.utime(path, None)
            return existing

        new_df = _full_download(ticker, start, end)
        return _append_new_bars(path, new_df)

    except Exception as exc:
        print(f'    WARN [{ticker}] incremental update failed: {exc}')
        if os.path.exists(path):
            return pd.read_parquet(path)
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
        return pd.read_parquet(path)

    # yfinance treats `end` as EXCLUSIVE, so add a day to include today's bars.
    end = datetime.today() + timedelta(days=1)

    # ── Force refresh: full 729-day download ─────────────────────────────
    if force_refresh or not os.path.exists(path):
        start = end - timedelta(days=HOURLY_HISTORY_DAYS)
        try:
            df = _full_download(ticker, start, end, interval='1h')
            df.to_parquet(path)
            return df
        except Exception as exc:
            print(f'    WARN [{ticker}] hourly download failed: {exc}')
            if os.path.exists(path):
                print(f'    INFO [{ticker}] using stale hourly cache')
                return pd.read_parquet(path)
            return None

    # ── Incremental: fetch from the last cached bar onward ───────────────
    # Resumes from the last cached date (minus 1 day of overlap; dedup handles
    # repeats) so a multi-day pause between runs can't leave a gap in the cache.
    # Clamped to Yahoo's 729-day hourly limit.
    try:
        existing  = pd.read_parquet(path)
        last_date = existing.index[-1]
        if getattr(last_date, 'tzinfo', None) is not None:
            last_date = last_date.tz_localize(None)
        start = max(
            last_date.to_pydatetime() - timedelta(days=1),
            end - timedelta(days=HOURLY_HISTORY_DAYS),
        )

        new_df = _full_download(ticker, start, end, interval='1h')
        return _append_new_bars(path, new_df)

    except Exception as exc:
        print(f'    WARN [{ticker}] hourly incremental failed: {exc}')
        if os.path.exists(path):
            return pd.read_parquet(path)
        return None


# ---------------------------------------------------------------------------
# Bulk fetch helpers (called by main.py)
# ---------------------------------------------------------------------------

def fetch_all(instruments: list[dict], force_refresh: bool = False) -> dict[str, pd.DataFrame]:
    """Fetch daily data for every instrument. Returns dict ticker → DataFrame."""
    data  = {}
    total = len(instruments)

    for i, inst in enumerate(instruments, 1):
        ticker = inst['ticker']
        label  = f'{ticker:<15} ({inst["name"]:<12})'
        print(f'  [{i:3d}/{total}] {label}', end='  ', flush=True)

        df = fetch(ticker, force_refresh)

        if df is None:
            print('SKIP — no data')
            continue
        if len(df) < MIN_ROWS_REQUIRED:
            print(f'SKIP — only {len(df)} rows (need {MIN_ROWS_REQUIRED})')
            continue

        data[ticker] = df
        print(f'OK   {len(df)} rows  ({df.index[0].date()} → {df.index[-1].date()})')

    print(f'\n  Loaded {len(data)}/{total} instruments.\n')
    return data


def fetch_all_hourly(instruments: list[dict], force_refresh: bool = False,
                     max_age_hours: int = 20) -> dict[str, pd.DataFrame]:
    """Fetch hourly data for every instrument. Returns dict ticker → DataFrame."""
    data  = {}
    total = len(instruments)

    for i, inst in enumerate(instruments, 1):
        ticker = inst['ticker']
        label  = f'{ticker:<15} ({inst["name"]:<12})'
        print(f'  [{i:3d}/{total}] {label}', end='  ', flush=True)

        df = fetch_hourly(ticker, force_refresh, max_age_hours=max_age_hours)

        if df is None:
            print('SKIP — no hourly data')
            continue
        if len(df) < 200:
            print(f'SKIP — only {len(df)} hourly rows')
            continue

        data[ticker] = df
        print(f'OK   {len(df)} rows  ({df.index[0].date()} → {df.index[-1].date()})')

    print(f'\n  Loaded hourly data for {len(data)}/{total} instruments.\n')
    return data
