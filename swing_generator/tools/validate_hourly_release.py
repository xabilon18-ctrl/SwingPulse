"""Check the complete hourly payload before publishing, and optionally on R2."""
import argparse
from datetime import datetime
import gzip
import json
import re
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp')]
from publish import R2_BASE_URL
# The same slow-R2 handling as the publish health check (2026-10-28: this
# check's first live read hung for 13 minutes and held the release lock).
from tools.health_check import FETCH_TRIES, FETCH_WAIT, _read_all

parser = argparse.ArgumentParser()
parser.add_argument('--live', action='store_true')
# The page --live checks. deploy-app.yml checks the release-check preview
# before production, then production after it.
parser.add_argument('--url', default='https://swingpulse200.pages.dev')
args = parser.parse_args()

def live_timeframes(html):
    """Timeframe codes in the page's injected table, or None when the page has none."""
    m = re.search(r'window\.SP_TIMEFRAMES = (\[.*?\]);</script>', html, re.S)
    if not m:
        return None
    try:
        return [t['code'] for t in json.loads(m.group(1))]
    except (ValueError, KeyError, TypeError):
        return None


def read_live(relative):
    """A slow or stalled R2 read is retried; an HTTP error fails at once."""
    wait = FETCH_WAIT
    for n in range(1, FETCH_TRIES + 1):
        req = urllib.request.Request(f'{R2_BASE_URL}/{relative}?releasecheck={time.time_ns()}',
                                     headers={'User-Agent': 'SwingPulse-releasecheck/1.0'})
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return _read_all(response)
        except urllib.error.HTTPError:
            raise
        except (TimeoutError, urllib.error.URLError, ConnectionError) as exc:
            if n == FETCH_TRIES:
                raise
            print(f'{relative}: read failed ({exc}), try {n + 1} of {FETCH_TRIES} in {wait}s', flush=True)
            time.sleep(wait)
            wait *= 2

def read(relative):
    if args.live:
        raw = read_live(relative)
    else:
        raw = (ROOT / 'webapp' / 'publish' / 'data_ma500' / relative).read_bytes()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    return json.loads(raw)

rows = read('signals.json')['data']
assert rows and all('h1_primary_signal' in r and 'h1_close' in r for r in rows)
assert all(r['h1_primary_signal'] in ('', 'B1', 'S1') for r in rows)
index = read('chart/index.json')
trends = read('trend_channels.json')['tf']
assert all(tf in trends for tf in ('1H', 'D'))
# 30m removed 2026-11-11: no trend read, chart events, alerts or columns.
assert '30m' not in trends, '30m trend read is back'
assert '30m' not in index.get('events_by_tf', {}), '30m chart events are back'
assert not any(k.startswith(('m30_', 'h4_')) for k in rows[0]), '30m/4H columns are back'
# 4H removed 2026-11-04 as a signal timeframe: no 4H trend read or chunk
# events. 2H and 4H are back as CHARTS ONLY on 2026-11-20 (checked below).
assert '4H' not in trends and '2H' not in trends, '2H/4H trend read: they are charts only'
assert not {'2H', '4H'} & set(index.get('events_by_tf', {})), '2H/4H chart events: they are charts only'
assert len(trends['1H']) >= len(rows) * 0.8, 'Hourly chart coverage below 80%; stopping release'
alerts = read('alerts.json')
assert all(e[1] in ('1H', 'D') for e in alerts['ev'])
name = next(iter(trends['1H']))
cid = index['chunks'][name]
chunk = read(f'chart/1H/{cid}.json')
bundle = chunk['data'][name]
assert bundle['p'] in ([50, 250], [50, 250, 500])
assert bundle['t'] and 'sg' in bundle and 'xm' in bundle
assert all(code in ('B1', 'S1') for _, code in bundle['sg'])
# 2H / 4H charts (2026-11-20, chart only): built for the same instrument,
# session-anchored bars counted from the 1H feed, the exact ribbon, and fewer
# bars per day than 1H.
for tf, per_hour in (('2H', 2), ('4H', 4)):
    tf_bundle = read(f'chart/{tf}/{cid}.json')['data'].get(name)
    assert tf_bundle and tf_bundle['t'], f'{tf} chart missing for {name}'
    assert tf_bundle['p'] in ([50], [50, 250], [50, 250, 500]), f'{tf} ribbon is not 50/250/500'
    assert 'sg' not in tf_bundle and 'context' not in tf_bundle, f'{tf} carries signals; it is chart only'
    # The TYPICAL spacing: a bar starts at its first hourly bar, so a hole in
    # the hourly feed can put one start closer to the last.
    stamps = [datetime.strptime(t, '%Y-%m-%d %H:%M') for t in tf_bundle['t'][-60:]]
    gaps = sorted((b - a).total_seconds() / 3600 for a, b in zip(stamps, stamps[1:]))
    assert gaps and gaps[len(gaps) // 2] >= per_hour - 1e-9, f'{tf} bars typically under {per_hour}h apart: {gaps[:5]}'
if args.live:
    template = (ROOT / 'webapp' / 'templates' / 'index.html').read_text()
    expected_asset = re.search(r'app\.js\?v=\d+', template).group(0)
    # Pages publication can finish before its production alias updates.
    deadline = time.monotonic() + 60
    while True:
        with urllib.request.urlopen(urllib.request.Request(
                f'{args.url.rstrip("/")}/?releasecheck={time.time_ns()}',
                headers={'User-Agent': 'SwingPulse-releasecheck/1.0'}), timeout=20) as response:
            html = response.read().decode()
        # The timeframe buttons are built by app.js from the table the build
        # injects (config.TIMEFRAME_TABLE -> window.SP_TIMEFRAMES, 2026-11-11),
        # so the released page is recognised by that table, not by button markup.
        codes = live_timeframes(html)
        if codes is not None and '1H' in codes and expected_asset in html:
            assert '30m' not in codes, 'Retired 30m control remains live'
            assert '2H' in codes and '4H' in codes, '2H/4H charts missing from the live timeframe table'
            break
        assert time.monotonic() < deadline, 'Live UI is still the previous build'
        print('Waiting for the new Pages assets to reach the production URL', flush=True)
        time.sleep(5)
print(f'PASS: {len(rows)} instruments, {len(trends["1H"])} hourly charts, 2H/4H charts only, B1/S1 markers, alerts and trend payloads')
