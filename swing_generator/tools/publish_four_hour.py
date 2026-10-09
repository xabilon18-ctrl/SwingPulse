"""Restore 4H chart chunks from the current hourly cache without replacing prices."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import gzip
import json
from pathlib import Path
import sys
import time
import urllib.request
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp')]
from chart_feed import build_4h_live, BARS_BY_TF, _write_gz
from channel_rule import read as channel_read
from publish import CACHE_DIR, R2_BASE_URL, R2_DATA_PREFIX, upload_to_r2
from server import get_ticker_map


def read_published(relative):
    request = urllib.request.Request(
        f'{R2_BASE_URL}/{relative}?fourhour={time.time_ns()}',
        headers={'User-Agent': 'SwingPulse-4H-release/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    return json.loads(raw)


def prepare(output, index, trends, ticker_map, cache_dir=CACHE_DIR):
    """Use the live chunk IDs and preserve every existing timeframe's trends."""
    names = sorted(index['chunks'])
    (output / 'chart' / '4H').mkdir(parents=True, exist_ok=True)

    def build(name):
        ticker = ticker_map.get(name)
        return name, build_4h_live(cache_dir, ticker) if ticker else None

    with ThreadPoolExecutor(max_workers=8) as pool:
        bundles = {name: bundle for name, bundle in pool.map(build, names) if bundle}
    required = max(1, int(len(trends['tf']['1H']) * 0.8))
    assert len(bundles) >= required, f'4H coverage {len(bundles)} is below {required}'
    latest = max(pd.Timestamp(bundle['t'][-1], tz='UTC') for bundle in bundles.values())
    published = pd.Timestamp(trends['generated_at'])
    published = published.tz_localize('UTC') if published.tzinfo is None else published.tz_convert('UTC')
    assert latest + pd.Timedelta(hours=4) >= published - pd.Timedelta(hours=8), 'Hourly cache is too old for this release'
    groups = {}
    readings = {}
    for name, bundle in bundles.items():
        assert bundle['p'] in ([50, 250], [50, 250, 500]), f'Bad 4H MA periods: {name}'
        assert len(bundle['t']) >= 2, f'Insufficient 4H bars: {name}'
        assert bundle['t'] == sorted(set(bundle['t'])), f'4H bars out of order: {name}'
        assert all(len(bundle[k]) == len(bundle['t']) for k in ('o', 'h', 'l', 'c'))
        groups.setdefault(index['chunks'][name], {})[name] = bundle
        readings[name] = channel_read(bundle, '4H')
    for cid in set(index['chunks'].values()):
        _write_gz(str(output / 'chart' / '4H' / f'{cid}.json'),
                  {'tf': '4H', 'bars': BARS_BY_TF['4H'], 'data': groups.get(cid, {})})
    merged = deepcopy(trends)
    merged['tf']['4H'] = {name: result[0] for name, result in readings.items()}
    merged.setdefault('since', {})['4H'] = {name: result[1] for name, result in readings.items() if result[1]}
    _write_gz(str(output / 'trend_channels.json'), merged)
    return len(bundles)


def verify_live():
    index = read_published('chart/index.json')
    trends = read_published('trend_channels.json')
    names = trends['tf'].get('4H', {})
    assert len(names) >= max(1, int(len(trends['tf']['1H']) * 0.8)), '4H live coverage below 80%'
    def verify_chunk(cid):
        chunk = read_published(f'chart/4H/{cid}.json')
        assert chunk['tf'] == '4H'
        for name in (name for name in names if index['chunks'][name] == cid):
            assert len(chunk['data'][name]['t']) >= 2
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(verify_chunk, {index['chunks'][name] for name in names}))
    print(f'PASS: {len(names)} live 4H charts using the current chunk index', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--verify-live', action='store_true')
    args = parser.parse_args()
    if args.verify_live:
        verify_live()
    else:
        output = ROOT / 'webapp' / 'publish' / 'four-hour-release'
        output.mkdir(parents=True, exist_ok=True)
        count = prepare(output, read_published('chart/index.json'),
                        read_published('trend_channels.json'), get_ticker_map())
        print(f'Validated {count} 4H charts from the existing hourly cache', flush=True)
        ok, failed = upload_to_r2(str(output), r2_prefix=R2_DATA_PREFIX)
        assert not failed, f'{failed} 4H files failed to upload; UI deployment stopped'
        print(f'Published {ok} 4H files without replacing quotes or signals', flush=True)
        verify_live()
