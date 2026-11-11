"""Chart bundle cache — a chart is rebuilt only when what it is built from changed.

Why (profiled 2026-11-01): the chart feed was 300-554s of every 8-16 minute
hourly run, against 10s for the signals. Every run rebuilt all 814 x 4 charts,
including the ~40-80% whose markets had not traded since the previous run. The
cost is not the bars shipped: frame_context re-runs add_workflow_signals over the
WHOLE history for each chart (5.0 of 9.2s on Daily, 2.3 of 5.4s on 4H, for 40
instruments), so the depth a bundle carries barely moves it.

A cached bundle is reused only when ALL of these hold — anything else rebuilds:

  * the same engine (every .py in swing_generator/ and webapp/, plus the json
    config beside them) — any code change rebuilds everything once;
  * the same UTC date. Daily bars are stored at naive UTC midnight, so every
    daily-granularity clock effect (drop_unfinished_daily, frame_context's
    closed-bar cut, reference_history's 90-day window, the SGX front-month
    roll) flips at midnight and nowhere else;
  * the same resolved source tickers (h4_ticker, FIVE_MIN_LEVEL_REF);
  * every parquet file the build READ, or looked for and did not find, is
    byte-identical. The reads are RECORDED during the build rather than listed
    by hand — repair_daily started reading the hourly file on 2026-10-31, and a
    hand-written list is exactly what such a change silently outdates;
  * the build was SETTLED: every intraday bar it read had already finished, by
    the longest bar it can feed (4H from 1h files, 30m from 5m files). Until
    then the drop_unfinished_* cuts, the forming candle and frame_context's
    closed-bar cut all move with the clock even when no file changes.

So a market that is closed reuses all four charts until its next bar (or the
next UTC midnight); an open one rebuilds, as it would have changed anyway.
Entries live in the parquet cache directory so CI's actions/cache carries them.
"""
from __future__ import annotations

import contextlib
import glob
import hashlib
import os
import shutil
import pickle
import zlib

import pandas as pd

CACHE_SUBDIR = 'chartcache'

# How long after its newest bar a file can still change what a chart shows
# without the file itself changing: the longest bar built from it.
SETTLE_BY_SUFFIX = {
    '_5m.parquet': pd.Timedelta(minutes=30),   # 30m chart; daily_level_scale
    '_1h.parquet': pd.Timedelta(hours=4),      # 4H chart and its forming candle
}

_HERE = os.path.dirname(os.path.abspath(__file__))
_PROJECT = os.path.dirname(_HERE)


def engine_hash() -> str:
    h = hashlib.sha256()
    files = sorted(glob.glob(os.path.join(_PROJECT, '*.py')) + glob.glob(os.path.join(_PROJECT, '*.json'))
                   + glob.glob(os.path.join(_HERE, '*.py')))
    for f in files:
        with open(f, 'rb') as fh:
            h.update(os.path.relpath(f, _PROJECT).encode() + b'\0' + fh.read())
    return h.hexdigest()[:16]


# ── Recording what a build reads ────────────────────────────────────────────
_reads: list | None = None
_orig_read_parquet = pd.read_parquet
_orig_exists = os.path.exists


def _newest(df) -> pd.Timestamp | None:
    idx = getattr(df, 'index', None)
    if not isinstance(idx, pd.DatetimeIndex) or not len(idx):
        return None
    ts = idx.max()
    return ts.tz_convert('UTC').tz_localize(None) if ts.tzinfo else ts


def _read_parquet(path, *args, **kwargs):
    rec = _reads
    try:
        df = _orig_read_parquet(path, *args, **kwargs)
    except Exception:
        if rec is not None:
            rec.append((os.fspath(path), None))
        raise
    if rec is not None:
        rec.append((os.fspath(path), _newest(df)))
    return df


def _exists(path):
    found = _orig_exists(path)
    rec = _reads
    if rec is not None and not found and str(path).endswith('.parquet'):
        rec.append((os.fspath(path), None))
    return found


@contextlib.contextmanager
def recording():
    """Collect (path, newest bar) for every parquet the block reads or misses.
    One build at a time per process — the chart feed runs builds in worker
    processes, never threads, while recording."""
    global _reads
    _reads = reads = []
    pd.read_parquet, os.path.exists = _read_parquet, _exists
    try:
        yield reads
    finally:
        pd.read_parquet, os.path.exists = _orig_read_parquet, _orig_exists
        _reads = None


# ── The store ───────────────────────────────────────────────────────────────
class Store:
    def __init__(self, cache_dir: str, now: pd.Timestamp | None = None):
        self.cache_dir = cache_dir
        self.root = os.path.join(cache_dir, CACHE_SUBDIR)
        self.now = now if now is not None else pd.Timestamp.utcnow().tz_localize(None)
        self.engine = engine_hash()
        self._digests: dict[str, str] = {}
        self.hits = 0

    def _path(self, tf: str, ticker: str) -> str:
        safe = ticker.replace('=', '_EQ_').replace('^', '_IDX_').replace('.', '_DOT_').replace('/', '_')
        return os.path.join(self.root, tf, safe + '.pkl')

    def meta(self, tf: str, ticker: str, sources: tuple) -> tuple:
        return (self.engine, tf, ticker, sources, self.now.strftime('%Y-%m-%d'))

    def _digest(self, rel: str) -> str:
        d = self._digests.get(rel)
        if d is None:
            try:
                with open(os.path.join(self.cache_dir, rel), 'rb') as fh:
                    d = hashlib.blake2b(fh.read(), digest_size=16).hexdigest()
            except FileNotFoundError:
                d = 'missing'
            self._digests[rel] = d
        return d

    def load(self, tf: str, ticker: str, meta: tuple) -> tuple[bool, dict | None]:
        """(True, bundle) on a valid entry — a fresh copy, so the feed's
        post-processing may mutate it — else (False, None)."""
        try:
            with open(self._path(tf, ticker), 'rb') as fh:
                emeta, deps, bundle = pickle.loads(zlib.decompress(fh.read()))
        except Exception:
            return False, None
        if emeta != meta or any(self._digest(rel) != d for rel, d in deps.items()):
            return False, None
        self.hits += 1
        return True, bundle

    def save(self, tf: str, ticker: str, meta: tuple, reads: list, bundle: dict | None) -> None:
        path = self._path(tf, ticker)
        settled = all(newest is None or newest + margin <= self.now
                      for p, newest in reads
                      for suffix, margin in SETTLE_BY_SUFFIX.items() if p.endswith(suffix))
        if not settled:
            # Can never be reused; an older entry fails its digest check anyway,
            # but leaving it would only cost a read next run.
            with contextlib.suppress(FileNotFoundError):
                os.remove(path)
            return
        deps = {}
        for p, _ in reads:
            rel = os.path.relpath(os.path.abspath(p), self.cache_dir)
            deps[rel] = self._digest(rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + '.tmp'
        try:
            with open(tmp, 'wb') as fh:
                fh.write(zlib.compress(pickle.dumps((meta, deps, bundle), protocol=pickle.HIGHEST_PROTOCOL), 1))
            os.replace(tmp, path)
        except OSError:
            with contextlib.suppress(FileNotFoundError):
                os.remove(tmp)

    def drop_other_timeframes(self, keep) -> None:
        """Delete the stored charts of timeframes no longer built (30m went
        2026-11-11): nothing reads them again, and they ride in the CI cache."""
        if not os.path.isdir(self.root):
            return
        for tf in os.listdir(self.root):
            path = os.path.join(self.root, tf)
            if tf not in keep and os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)

    def prune(self, tf: str, tickers) -> None:
        """Drop entries for instruments no longer in the feed."""
        keep = {os.path.basename(self._path(tf, t)) for t in tickers}
        for f in glob.glob(os.path.join(self.root, tf, '*.pkl')):
            if os.path.basename(f) not in keep:
                with contextlib.suppress(FileNotFoundError):
                    os.remove(f)
