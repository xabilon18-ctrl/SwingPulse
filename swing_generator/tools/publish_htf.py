"""Publish the Weekly and Monthly charts from each instrument's whole history.

User, 2026-10-19: "weekly run every Monday and monthly between 3-5" (the 3rd to
the 5th), then "we will need to go back further here ... but these need not
run with the daily and hourly runs". So this is its own job
(.github/workflows/publish-htf.yml), never part of the hourly publish:

  * Weekly and Monthly only ever show CLOSED weeks and months
    (main._resample_weekly / _resample_monthly drop the one in progress), so
    their bars cannot move between a Monday and the next one, or between one
    month's 3rd-5th and the next. Rebuilding them hourly would only re-upload
    the same chunks.
  * They need far more history than the 13-year Daily cache (HISTORY_YEARS):
    Weekly opens on four terms (2013-2029) with an MA500 that wants ~10 years
    before that, Monthly on everything there is. So each run downloads the
    instrument's WHOLE daily history from Yahoo (period='max'), adjusted the
    same way the Daily cache is, and keeps none of it — a fresh pull is always
    adjusted for the latest split or dividend. A failed pull falls back to the
    Daily cache, which the workflow restores read-only: a shallower chart beats
    none.

Each timeframe is published as chart/<W|M>/<chunk>.json plus its own
chart/<W|M>/index.json (name -> chunk). The hourly chart/index.json says nothing
about them, so neither job can leave the other's map out of step.

    python3 tools/publish_htf.py              # what is due today (SAST)
    python3 tools/publish_htf.py --tf W M     # these, whatever the day
    python3 tools/publish_htf.py --tf W --no-upload --output /tmp/htf
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import shutil
import sys

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp')]
from chart_feed import (CHUNK_SIZE, BARS_BY_TF, _cache_name, _write_gz,   # noqa: E402
                        weekly_bundle, monthly_bundle)
from data_fetcher import _full_download, FETCH_WORKERS                    # noqa: E402

SCHEDULE_TZ = 'Africa/Johannesburg'   # the clock the hourly runs are named in
BUILDERS = {'W': weekly_bundle, 'M': monthly_bundle}
# Below this share of instruments with a chart, something is broken (Yahoo
# refusing the runner, an empty cache) and publishing would blank good charts.
# Monthly is lower: it needs 50 months, Weekly 250 weeks, and young listings
# and crypto have neither.
MIN_COVERAGE = {'W': 0.6, 'M': 0.5}


def due(now: pd.Timestamp) -> list[str]:
    """The timeframes scheduled on `now`'s SAST date: Weekly on a Monday,
    Monthly on the 3rd, 4th and 5th — once each day, the spare days covering a
    failed run."""
    now = now.tz_convert(SCHEDULE_TZ) if now.tzinfo else now
    return [tf for tf, on in (('W', now.weekday() == 0), ('M', 3 <= now.day <= 5)) if on]


def fetch_deep(ticker: str, cache_dir: str) -> tuple[pd.DataFrame | None, str]:
    """(daily bars, source): the whole Yahoo history, else the Daily cache."""
    if not str(ticker).startswith('CCY_'):   # built from the pairs, not on Yahoo
        try:
            df = _full_download(ticker, None, None, period='max')
            if df is not None and not df.empty:
                return df, 'max'
        except Exception:
            pass
    path = os.path.join(cache_dir, _cache_name(ticker))
    if os.path.exists(path):
        df = pd.read_parquet(path)
        if not df.empty:
            return df, 'cache'
    return None, 'none'


def build(ticker_map: dict, tfs: list[str], fetch, workers: int = FETCH_WORKERS):
    """{tf: {name: bundle}} and the count of each history source."""
    def one(name):
        df, source = fetch(ticker_map[name])
        out = {}
        if df is not None:
            for tf in tfs:
                try:
                    bundle = BUILDERS[tf](ticker_map[name], df)
                except Exception as exc:
                    print(f'  WARN {name} {tf}: {exc}', flush=True)
                    bundle = None
                if bundle:
                    out[tf] = bundle
        return name, out, source

    built = {tf: {} for tf in tfs}
    sources: dict[str, int] = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for name, out, source in pool.map(one, sorted(ticker_map)):
            sources[source] = sources.get(source, 0) + 1
            for tf, bundle in out.items():
                built[tf][name] = bundle
    return built, sources


def write(output: Path, tf: str, bundles: dict, names: list[str], built_on: str) -> int:
    """Write chart/<tf>/<cid>.json for EVERY chunk id plus chart/<tf>/index.json.

    Empty chunks are written too: R2 still holds W and M chunks from before
    these charts were removed (2026-09), grouped differently, and one left
    unwritten would be served as current."""
    names = sorted(names)
    chunk_of = {n: i // CHUNK_SIZE for i, n in enumerate(names)}
    tf_dir = output / 'chart' / tf
    shutil.rmtree(tf_dir, ignore_errors=True)
    tf_dir.mkdir(parents=True)
    groups = {cid: {} for cid in set(chunk_of.values())}
    for name, bundle in bundles.items():
        groups[chunk_of[name]][name] = bundle
    for cid, group in groups.items():
        _write_gz(str(tf_dir / f'{cid}.json'), {'tf': tf, 'bars': BARS_BY_TF[tf], 'data': group})
    _write_gz(str(tf_dir / 'index.json'),
              {'tf': tf, 'built': built_on, 'chunk_size': CHUNK_SIZE, 'chunks': chunk_of})
    return len(groups)


def main():
    from publish import CACHE_DIR, R2_DATA_PREFIX, upload_to_r2
    from server import get_ticker_map

    ap = argparse.ArgumentParser()
    ap.add_argument('--tf', nargs='+', choices=sorted(BUILDERS),
                    help='timeframes to publish (default: what is due today, SAST)')
    ap.add_argument('--output', default=str(ROOT / 'webapp' / 'publish' / 'htf-release'))
    ap.add_argument('--no-upload', action='store_true')
    args = ap.parse_args()

    now = pd.Timestamp.now(tz=SCHEDULE_TZ)
    tfs = args.tf or due(now)
    if not tfs:
        print(f'Nothing due on {now:%a %Y-%m-%d} (SAST): Weekly runs on Mondays, '
              f'Monthly on the 3rd-5th.')
        return
    ticker_map = get_ticker_map()
    print(f'Building {" + ".join(tfs)} for {len(ticker_map)} instruments '
          f'from their whole history...', flush=True)
    built, sources = build(ticker_map, tfs, lambda t: fetch_deep(t, CACHE_DIR))
    print(f'  history: {sources}', flush=True)

    output = Path(args.output)
    for tf in tfs:
        n, need = len(built[tf]), int(len(ticker_map) * MIN_COVERAGE[tf])
        if n < need:
            raise SystemExit(f'{tf}: only {n} of {len(ticker_map)} charts built '
                             f'(need {need}) — not publishing over the live ones.')
        chunks = write(output, tf, built[tf], list(ticker_map), now.strftime('%Y-%m-%d'))
        print(f'  {tf}: {n} charts in {chunks} chunks', flush=True)
    if args.no_upload:
        return
    ok, failed = upload_to_r2(str(output), r2_prefix=R2_DATA_PREFIX)
    if failed:
        raise SystemExit(f'{failed} Weekly/Monthly files failed to upload')
    print(f'Published {ok} files', flush=True)


if __name__ == '__main__':
    main()
