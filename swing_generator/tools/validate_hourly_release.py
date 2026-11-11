"""Check the complete hourly payload before publishing, and optionally on R2."""
import argparse
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
# 4H removed 2026-11-04 as a signal timeframe and its chart removed
# permanently 2026-11-07: no 4H trend read, chunk events or chart button.
assert '4H' not in trends, '4H trend read is back'
assert '4H' not in index.get('events_by_tf', {}), '4H chart events are back'
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
if args.live:
    template = (ROOT / 'webapp' / 'templates' / 'index.html').read_text()
    expected_asset = re.search(r'app\.js\?v=\d+', template).group(0)
    # Pages publication can finish before its production alias updates.
    deadline = time.monotonic() + 60
    while True:
        with urllib.request.urlopen(urllib.request.Request(
                f'https://swingpulse200.pages.dev/?releasecheck={time.time_ns()}',
                headers={'User-Agent': 'SwingPulse-releasecheck/1.0'}), timeout=20) as response:
            html = response.read().decode()
        # The timeframe buttons are built by app.js from the table the build
        # injects (config.TIMEFRAME_TABLE -> window.SP_TIMEFRAMES, 2026-11-11),
        # so the released page is recognised by that table, not by button markup.
        codes = live_timeframes(html)
        if codes is not None and '1H' in codes and expected_asset in html:
            assert '30m' not in codes, 'Retired 30m control remains live'
            assert '4H' not in codes, 'Retired 4H control remains live'
            break
        assert time.monotonic() < deadline, 'Live UI is still the previous build'
        print('Waiting for the new Pages assets to reach the production URL', flush=True)
        time.sleep(5)
print(f'PASS: {len(rows)} instruments, {len(trends["1H"])} hourly charts, no 4H, B1/S1 markers, alerts and trend payloads')
