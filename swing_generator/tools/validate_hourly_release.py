"""Check the complete hourly payload before publishing, and optionally on R2."""
import argparse
import gzip
import json
from pathlib import Path
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp')]
from publish import R2_BASE_URL

parser = argparse.ArgumentParser()
parser.add_argument('--live', action='store_true')
args = parser.parse_args()

def read(relative):
    if args.live:
        req = urllib.request.Request(f'{R2_BASE_URL}/{relative}?releasecheck={time.time_ns()}',
                                     headers={'User-Agent': 'SwingPulse-releasecheck/1.0'})
        with urllib.request.urlopen(req, timeout=60) as response:
            raw = response.read()
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
assert all(tf in trends for tf in ('30m', '1H', 'D'))
assert len(trends['1H']) >= len(rows) * 0.8, 'Hourly chart coverage below 80%; stopping release'
alerts = read('alerts.json')
assert all(e[1] in ('30m', '1H', 'D') for e in alerts['ev'])
name = next(iter(trends['1H']))
cid = index['chunks'][name]
chunk = read(f'chart/1H/{cid}.json')
bundle = chunk['data'][name]
assert bundle['p'] in ([50, 250], [50, 250, 500])
assert bundle['t'] and 'sg' in bundle and 'xm' in bundle
assert all(code in ('B1', 'S1') for _, code in bundle['sg'])
if args.live:
    with urllib.request.urlopen(urllib.request.Request(
            f'https://swingpulse200.pages.dev/?releasecheck={time.time_ns()}',
            headers={'User-Agent': 'SwingPulse-releasecheck/1.0'}), timeout=60) as response:
        html = response.read().decode()
    assert 'id="tfBtn1H"' in html and 'app.js?v=481' in html, 'Live UI is still the previous build'
print(f'PASS: {len(rows)} instruments, {len(trends["1H"])} hourly charts, B1/S1 markers, alerts and trend payloads')
