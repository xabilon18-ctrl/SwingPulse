"""Publish the Monthly chart, and the Weekly and Monthly activity strip rows,
from each instrument's whole history.

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
    Monthly opens on everything there is, and a weekly MA500 wants ~10 years
    of weeks. So each run downloads the
    instrument's WHOLE daily history from Yahoo (period='max'), adjusted the
    same way the Daily cache is, and keeps none of it — a fresh pull is always
    adjusted for the latest split or dividend. A failed pull falls back to the
    Daily cache, which the workflow restores read-only: a shallower chart beats
    none.

Yearly (candles only, no MA lines) is built with every Monthly run and
published the same way, as chart/Y/<chunk>.json and chart/Y/index.json.

Monthly is published as chart/M/<chunk>.json plus its own chart/M/index.json
(name -> chunk). The hourly chart/index.json says nothing about it, so neither
job can leave the other's map out of step. Weekly publishes no chart (removed
2026-11-16), only activity/W.json for the Watchlist strip's Week row.

    python3 tools/publish_htf.py              # what is due today (SAST)
    python3 tools/publish_htf.py --tf W M     # these, whatever the day
    python3 tools/publish_htf.py --tf W --no-upload --output /tmp/htf
    python3 tools/publish_htf.py --holdings-only  # the 13F markers alone

The Monthly run also rebuilds holdings.json, the big-fund 13F moves behind the
Monthly chart's markers (webapp/holdings_feed.py), when SEC_USER_AGENT is set.
A failure there costs the markers' refresh, never the charts.
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
                        weekly_bundle, monthly_bundle, yearly_bundle)
from data_fetcher import _full_download, FETCH_WORKERS                    # noqa: E402
from _active_config import HTF_CHART_BUILDERS                             # noqa: E402

SCHEDULE_TZ = 'Africa/Johannesburg'   # the clock the hourly runs are named in
# Both are always BUILT: the Watchlist's activity strip reads the week's and
# the month's busy sectors (activity/<tf>.json) off these bundles. A CHART is
# published only for the timeframes config.TIMEFRAME_TABLE has enabled with
# chart 'htf': Monthly. Weekly's chart was removed on 2026-11-16 (its dormant
# code deleted the same day); its strip row stays.
BUILDERS = {'W': weekly_bundle, 'M': monthly_bundle, 'Y': yearly_bundle}
CHART_TFS = frozenset(HTF_CHART_BUILDERS)
# Yearly (user, 2026-11-23) has no schedule of its own: it rides with Monthly,
# from the same whole-history download, on the 3rd-5th and whenever Monthly is
# published by hand (`--tf M`, the workflow's 'M' choice). A year closes once a
# year, so eleven of those twelve rebuilds re-upload the same bars, which is
# cheap; the twelfth, in January, adds the year just closed.
RIDES_WITH = {'M': 'Y'}
# The Watchlist strip's Week and Month rows read activity/W and activity/M.
# Yearly has no strip row.
ACTIVITY_TFS = frozenset({'W', 'M'})
# Below this share of instruments with a chart, something is broken (Yahoo
# refusing the runner, an empty cache) and publishing would blank good charts.
# Monthly is lower: it needs 50 months, Weekly 250 weeks, and young listings
# and crypto have neither.
MIN_COVERAGE = {'W': 0.6, 'M': 0.5, 'Y': 0.5}


def due(now: pd.Timestamp) -> list[str]:
    """The timeframes scheduled on `now`'s SAST date: Weekly on a Monday,
    Monthly on the 3rd, 4th and 5th — once each day, the spare days covering a
    failed run."""
    now = now.tz_convert(SCHEDULE_TZ) if now.tzinfo else now
    return with_riders([tf for tf, on in (('W', now.weekday() == 0), ('M', 3 <= now.day <= 5))
                        if on and tf in BUILDERS])


def with_riders(tfs: list[str]) -> list[str]:
    """`tfs` plus what rides with them (Yearly with Monthly), when that is a
    published chart."""
    out = list(tfs)
    for tf in tfs:
        rider = RIDES_WITH.get(tf)
        if rider and rider in CHART_TFS and rider not in out:
            out.append(rider)
    return out


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


def write_activity(output: Path, tf: str, bundles: dict) -> dict:
    """activity/<tf>.json: the sectors busy at the last closed week or month
    (webapp/activity_feed.py), from the bundles this run just built."""
    from activity_feed import build_activity
    from instruments import load_instruments
    act = build_activity(bundles, load_instruments(), tf)
    (output / 'activity').mkdir(parents=True, exist_ok=True)
    _write_gz(str(output / 'activity' / f'{tf}.json'), act)
    return act


def write_holdings(output: Path, built_on: str) -> bool:
    """holdings.json and holdings_cusips.json into `output`. The CUSIP map is
    read back from R2 first, so each run asks OpenFIGI only about new ones.
    False (and the reason printed) when it cannot be built."""
    import gzip
    import json
    import urllib.request
    import holdings_feed as hf
    from instruments import load_instruments
    from publish import R2_DATA_PREFIX, R2_PUBLIC_URL
    if not hf.SEC_UA:
        print('  holdings: SEC_USER_AGENT not set, 13F moves not rebuilt', flush=True)
        return False
    known = hf.load_cusip_seed()
    try:
        url = f'{R2_PUBLIC_URL}/{R2_DATA_PREFIX}/holdings_cusips.json'
        with urllib.request.urlopen(url, timeout=30) as r:
            raw = r.read()
        known.update(json.loads(gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw))
    except Exception as exc:
        print(f'  holdings: no CUSIP map on R2 yet ({exc}); using the committed one', flush=True)
    try:
        payload, cmap = hf.build(load_instruments(), hf.Http(), built_on=built_on,
                                 known=known, log=lambda m: print(m, flush=True))
    except Exception as exc:
        print(f'  WARN holdings.json not built: {exc}', flush=True)
        return False
    if not payload['stocks']:
        print('  WARN holdings: no moves at all - not publishing over the live file', flush=True)
        return False
    hf.write(output, payload)
    _write_gz(str(output / 'holdings_cusips.json'), dict(sorted(cmap.items())))
    return True


def main():
    from publish import CACHE_DIR, R2_DATA_PREFIX, upload_to_r2
    from server import get_ticker_map

    ap = argparse.ArgumentParser()
    ap.add_argument('--tf', nargs='+', choices=sorted(BUILDERS),
                    help='timeframes to publish (default: what is due today, SAST)')
    ap.add_argument('--output', default=str(ROOT / 'webapp' / 'publish' / 'htf-release'))
    ap.add_argument('--no-upload', action='store_true')
    ap.add_argument('--holdings-only', action='store_true',
                    help='rebuild the 13F moves alone (the run after each filing deadline)')
    args = ap.parse_args()

    now = pd.Timestamp.now(tz=SCHEDULE_TZ)
    if args.holdings_only:
        output = Path(args.output)
        shutil.rmtree(output, ignore_errors=True)
        output.mkdir(parents=True)
        if not write_holdings(output, now.strftime('%Y-%m-%d')):
            raise SystemExit('13F moves not built')
        if not args.no_upload:
            ok, failed = upload_to_r2(str(output), r2_prefix=R2_DATA_PREFIX)
            if failed:
                raise SystemExit(f'{failed} holdings files failed to upload')
            print(f'Published {ok} files', flush=True)
        return
    tfs = with_riders(args.tf) if args.tf else due(now)
    if not tfs:
        print(f'Nothing due on {now:%a %Y-%m-%d} (SAST): Weekly runs on Mondays, '
              f'Monthly and Yearly on the 3rd-5th.')
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
        if tf in CHART_TFS:
            chunks = write(output, tf, built[tf], list(ticker_map), now.strftime('%Y-%m-%d'))
            print(f'  {tf}: {n} charts in {chunks} chunks', flush=True)
        else:
            print(f'  {tf}: activity only (no chart)', flush=True)
        if tf not in ACTIVITY_TFS:
            continue
        # A failure costs the Watchlist strip's Weekly/Monthly row, never the charts.
        try:
            act = write_activity(output, tf, built[tf])
            print(f'  {tf}: {act["active"]} active sectors at {act["period"]}', flush=True)
        except Exception as exc:
            print(f'  WARN activity/{tf}.json not built: {exc}', flush=True)
    if 'M' in tfs:
        write_holdings(output, now.strftime('%Y-%m-%d'))
    if args.no_upload:
        return
    ok, failed = upload_to_r2(str(output), r2_prefix=R2_DATA_PREFIX)
    if failed:
        raise SystemExit(f'{failed} Weekly/Monthly/Yearly files failed to upload')
    print(f'Published {ok} files', flush=True)


if __name__ == '__main__':
    main()
