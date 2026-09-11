#!/usr/bin/env python3
"""
SwingPulse Publisher

Modes:
  python3 webapp/publish.py                      → build data + upload to R2  (daily use, ~60 sec)
  python3 webapp/publish.py --ui-only            → build UI + deploy to Cloudflare Pages (UI changes only)
  python3 webapp/publish.py --build-only         → build everything locally, no deploy
  python3 webapp/publish.py --profile ma500      → build + upload MA500 profile data (to R2 ma500/ prefix)
  python3 webapp/publish.py --profile ma500 --ui-only  → deploy MA500 UI to swingpulse500.pages.dev
"""

import argparse
import concurrent.futures
import glob
import gzip
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta

import pandas as pd

# yfinance imported lazily inside build_names() to keep startup fast

# ---------------------------------------------------------------------------
# Paths  (MA500 profile)
# ---------------------------------------------------------------------------
PROFILE     = 'ma500'
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

OUTPUT_DIR  = os.path.join(PROJECT_DIR, 'output_ma500')
CACHE_DIR   = os.path.join(PROJECT_DIR, 'cache_ma500')
# Kept in step with config.MA_PERIODS by hand — publish.py is deliberately
# standalone (it runs without importing the generator package). Cut to the
# three signal-bearing lines 2026-09-09.
MA_PERIODS  = [50, 250, 500]              # MA50 (B2/S2) · MA250 (B3/S3) · MA500 (B4/S4)

PUBLISH_DIR = os.path.join(SCRIPT_DIR, 'publish')

# ---------------------------------------------------------------------------
# R2 config
# ---------------------------------------------------------------------------
R2_BUCKET      = 'swingpulse-data'
R2_PUBLIC_URL  = 'https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev'
PAGES_PROJECT  = 'swingpulse200'
R2_DATA_PREFIX = 'ma500'
R2_BASE_URL    = f'{R2_PUBLIC_URL}/ma500'
TV_LAYOUTS = {
    'zabs': 'xvj4Xt7h',
    'hemi': '86bzFCIC',
}

# ---------------------------------------------------------------------------
# Project imports
# ---------------------------------------------------------------------------
sys.path.insert(0, PROJECT_DIR)
sys.path.insert(0, SCRIPT_DIR)
from instruments import load_instruments
from server import build_tv_map, build_ai_set, get_ticker_map, _ticker_to_filename
from chart_feed import build_chart_feed


# ---------------------------------------------------------------------------
# Data helpers  (unchanged from original)
# ---------------------------------------------------------------------------

def load_latest_signals(src_dir=None):
    d = src_dir or OUTPUT_DIR
    files = sorted(glob.glob(os.path.join(d, 'signals_*.csv')))
    if not files:
        return pd.DataFrame(), '', ''
    latest     = files[-1]
    date_str   = os.path.basename(latest).replace('signals_', '').replace('.csv', '')
    mtime      = os.path.getmtime(latest)
    # ISO 8601 UTC so the frontend can convert to the user's local timezone
    from datetime import timezone
    fetched_at = datetime.fromtimestamp(mtime, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    df = pd.read_csv(latest).fillna('')
    return df, date_str, fetched_at


def load_latest_trends(date_str, src_dir=None):
    d    = src_dir or OUTPUT_DIR
    path = os.path.join(d, f'trends_{date_str}.json')
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return {}


def _dump_json_gz(path, obj, **kw):
    """Write JSON gzipped under its plain .json name.

    The app's three big startup files went out uncompressed: 7.9 MB of the
    8.24 MB a phone downloaded on first open (signals.json 4.59 MB, 0.63 MB
    gzipped). The public r2.dev endpoint compresses nothing itself, and
    upload_to_r2 already sets Content-Encoding: gzip on gzip bytes
    (_is_gzipped), as it does for the chart feed. mtime=0 keeps identical
    content byte-identical between runs.
    """
    with open(path, 'wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0, compresslevel=9) as gz:
        gz.write(json.dumps(obj, **kw).encode('utf-8'))


def build_summary(df, dt):
    if df.empty:
        return {}
    def _col(name):
        return df[name] if name in df.columns else pd.Series('', index=df.index)

    trend_counts  = _col('trend_direction').value_counts().to_dict()
    trend_counts.pop('', None)
    # Daily, like the screen it sits under (was h4_ — 4H counts under a Daily app).
    sigs          = _col('primary_signal').fillna('').astype(str)
    buy_mask      = sigs.str.startswith('B')
    sell_mask     = sigs.str.startswith('S')
    signal_types  = sigs[sigs != ''].value_counts().to_dict()
    groups = sorted([g for g in df['group'].unique().tolist() if g])

    # ── Coverage ── main.py already names the dropouts in its run log, but a
    # buried log line in a 700-instrument CI run is not a signal anyone sees:
    # 16 instruments (incl. AXA, Roche, Marsh) had been fetching nothing for
    # months while the app happily published 725 of 741. Carrying the count in
    # the payload lets the app say so on screen.
    try:
        from instruments import load_instruments
        expected = load_instruments()
        published = set(df['instrument_name'].astype(str))
        missing = sorted(i['name'] for i in expected if i['name'] not in published)
    except Exception:
        expected, missing = [], []

    return {
        'date':             dt,
        'total':            len(df),
        'expected':         len(expected),
        'missing_count':    len(missing),
        'missing':          missing[:50],

        'trend_counts':     trend_counts,
        'buy_count':        int(buy_mask.sum()),
        'sell_count':       int(sell_mask.sum()),
        'volume_spikes':    int((_col('volume_spike_flag') == 'yes').sum()),
        'key_level_touches': int((_col('key_level_touched_today') == 'yes').sum()),
        'signal_types':     signal_types,
        'groups':           groups,
        'ma_max_pairs':     len(MA_PERIODS) - 1,
        'ma_longest':       _longest_ma,
        'ma_shortest':      _shortest_ma,
    }


# ---------------------------------------------------------------------------
# Signal Explanations — rule-based, no API required
# ---------------------------------------------------------------------------

_longest_ma  = max(MA_PERIODS)
_shortest_ma = min(MA_PERIODS)
_SIG_WHAT = {
    'B1': (f'trend breakout — price crossed above all MAs (MA{_shortest_ma}–MA{_longest_ma})',),
    'S1': (f'trend breakdown — price crossed below all MAs (MA{_shortest_ma}–MA{_longest_ma})',),
    'B2': (f'pullback recovery — price crossed back above MA{_shortest_ma}',),
    'S2': (f'rally rejection — price crossed back below MA{_shortest_ma}',),
    'B3': ('mid-ribbon bounce off MA250',),
    'S3': ('mid-ribbon rejection at MA250',),
    'B4': (f'anchor bounce off MA{_longest_ma}',),
    'S4': (f'anchor rejection at MA{_longest_ma}',),
}

# Keys must match the labels emitted by _compute_tf_alignment in main.py
_ALIGN_NOTES = {
    'Quad Bull':     'all four timeframes aligned bullish',
    'Quad Bear':     'all four timeframes aligned bearish',
    'Triple Bull':   'three timeframes aligned bullish',
    'Triple Bear':   'three timeframes aligned bearish',
    'Double Bull':   'two timeframes aligned bullish',
    'Double Bear':   'two timeframes aligned bearish',
    'Counter-trend': 'counter-trend setup — higher timeframe conflicts',
    'Mixed':         'mixed timeframe picture',
}

def _explain_one(row: pd.Series) -> str:
    """Plain description of what fired on DAILY bars — no API, no forecasts.

    Rewritten 2026-09-11. It used to read the 4H columns (published beside a
    Daily screen) and to add judgements the evidence does not support:
    "high-confidence setup" (tiers fitted in-sample), "MA order fully stacked"
    (the order score points the wrong way), "volume spike confirms institutional
    participation" and "breakout expected" (both measured null). Entries tested
    no better than random ones taken the same day, and shorts lost after costs,
    so a sell reads as a warning for longs, not as a short entry.
    """
    def v(col):
        val = row.get(col, '')
        return str(val).strip() if val is not None and str(val) not in ('', 'nan', 'None') else ''

    sig    = v('primary_signal')
    trend  = v('trend_direction')
    run    = v('trend_run_days')
    vol    = v('volume_spike_flag')
    comp   = v('ribbon_compression')
    spread = v('ribbon_spread')

    sig_desc  = _SIG_WHAT.get(sig, ('signal',))[0]
    trend_lbl = 'uptrend' if trend == 'UPTREND' else 'downtrend' if trend == 'DOWNTREND' else 'sideways trend'

    clauses = [f"{sig} {sig_desc}"]
    try:
        days = int(float(run)) if run else 0
    except ValueError:
        days = 0
    clauses.append(f"{days}-day {trend_lbl}" if days > 0 else trend_lbl)
    facts = []
    if vol == 'yes':
        facts.append('volume above its 25-day average')
    if comp == 'yes' and spread:
        try:
            facts.append(f'moving averages bunched within {abs(float(spread)):.1f}%')
        except ValueError:
            pass
    s1 = ', '.join(clauses) + (' — ' + '; '.join(facts) if facts else '')
    s1 = s1[:1].upper() + s1[1:] + '.'   # not capitalize(): it lowercases MA500 / B4

    if sig.startswith('B'):
        s2 = f'The setup fails on a close below MA{_shortest_ma}.'
    elif sig.startswith('S'):
        s2 = ('Trend weakening — a warning for longs, not a short entry (shorts lost '
              f'after costs in testing). It clears on a close back above MA{_shortest_ma}.')
    else:
        s2 = ''
    return f'{s1} {s2}'.strip()


EVENT_TITLES = {
    'earnings': 'earnings',
    'exdiv':    'ex-dividend',
}


def _ics_escape(text: str) -> str:
    """RFC 5545 §3.3.11 — backslash, semicolon, comma and newline are special."""
    return (str(text).replace('\\', '\\\\').replace(';', '\\;')
                     .replace(',', '\\,').replace('\n', '\\n'))


def build_ics(events: list) -> str:
    """One all-day VEVENT per row, as a subscribable calendar.

    DTEND is the day AFTER DTSTART: an all-day VALUE=DATE event is a half-open
    range, so an equal DTEND renders as a zero-length event that several
    calendar apps drop silently.

    THIS IS THE ONLY PLACE AN EVENT IS GIVEN A CALENDAR TITLE. app.js used to
    build its own one-day .ics with its own naming, and the two drifted the
    moment macro rows arrived: this builder special-cases them, that one did
    not, so subscribing gave you "FOMC decision" while the day download gave
    you "FOMC decision - macro". The browser now slices THIS output instead of
    rebuilding it (app.js downloadIcs), so there is one name per event.
    """
    stamp = datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
    lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0',
        'PRODID:-//SwingPulse//Events//EN',
        'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'X-WR-CALNAME:SwingPulse Events',
        'X-WR-TIMEZONE:UTC',
        # Tell subscribers how often to re-poll; the pipeline runs 3x a weekday.
        'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
        'X-PUBLISHED-TTL:PT6H',
    ]
    for e in events:
        try:
            d0 = datetime.strptime(e['date'], '%Y-%m-%d').date()
        except (KeyError, ValueError):
            continue
        d1   = d0 + timedelta(days=1)
        # An event either points at an instrument you can hold, or it is a
        # named event that hits everything. `title` marks the second kind.
        inst  = e.get('instrument') or ''
        title = e.get('title') or ''
        uid   = f"{e['date']}-{e.get('type','')}-{title or inst}@swingpulse"
        if title:
            summary = title
            detail  = f"SwingPulse · {title}" + (f" · {e['time']}" if e.get('time') else '')
        else:
            kind    = EVENT_TITLES.get(e.get('type'), e.get('type', 'event'))
            summary = f"{inst} — {kind}"
            detail  = f"SwingPulse · {inst} {kind}"
        lines += [
            'BEGIN:VEVENT',
            f'UID:{_ics_escape(uid)}',
            f'DTSTAMP:{stamp}',
            f'DTSTART;VALUE=DATE:{d0.strftime("%Y%m%d")}',
            f'DTEND;VALUE=DATE:{d1.strftime("%Y%m%d")}',
            f'SUMMARY:{_ics_escape(summary)}',
            f'DESCRIPTION:{_ics_escape(detail)}',
            'TRANSP:TRANSPARENT',
            'END:VEVENT',
        ]
    lines.append('END:VCALENDAR')
    # RFC 5545 requires CRLF line endings
    return '\r\n'.join(lines) + '\r\n'


def generate_explanations(df: pd.DataFrame) -> dict:
    """Generate rule-based signal explanations for all signaled instruments.
    No API key required — runs entirely from signal data fields.
    Returns {instrument_name: explanation_text}.
    """
    _sig_col = 'primary_signal'
    signaled = df[df[_sig_col].notna() & (df[_sig_col] != '')].copy()
    if signaled.empty:
        return {}

    results = {}
    for _, row in signaled.iterrows():
        name = row['instrument_name']
        try:
            results[name] = _explain_one(row)
        except Exception as exc:
            print(f'    ✗ Explanation failed for {name}: {exc}')

    print(f'  Signal explanations: {len(results)}/{len(signaled)} generated (rule-based)')
    return results


# ---------------------------------------------------------------------------
# Instrument names  (yfinance shortName + manual overrides for futures/indices)
# ---------------------------------------------------------------------------

def build_names():
    """Return dict {ticker: display_name} for all instruments.
    Uses a local cache at output/names_cache.json to avoid re-fetching.
    Manual overrides are applied first (futures, indices, well-known crypto).
    """
    import yfinance as yf

    # Hard-coded overrides — futures roll monthly (name changes), indices have poor shortNames
    OVERRIDES = {
        # Futures
        'GC=F':   'Gold',
        'SI=F':   'Silver',
        'CL=F':   'Crude Oil',
        'NG=F':   'Natural Gas',
        'HG=F':   'Copper',
        'ZW=F':   'Wheat',
        'ZC=F':   'Corn',
        'ZS=F':   'Soybeans',
        'ES=F':   'S&P 500 Futures',
        'NQ=F':   'Nasdaq Futures',
        'YM=F':   'Dow Futures',
        'RTY=F':  'Russell 2000 Futures',
        # Currency pairs
        'EURUSD=X': 'EUR/USD',
        'GBPUSD=X': 'GBP/USD',
        'USDJPY=X': 'USD/JPY',
        'AUDUSD=X': 'AUD/USD',
        'USDCAD=X': 'USD/CAD',
        'USDCHF=X': 'USD/CHF',
        'GBP=X':  'GBP/USD',
        'EUR=X':  'EUR/USD',
        'JPY=X':  'USD/JPY',
        # Indices
        '^GSPC':  'S&P 500',
        '^DJI':   'Dow Jones',
        '^IXIC':  'Nasdaq',
        '^RUT':   'Russell 2000',
        '^VIX':   'VIX',
        '^FTSE':  'FTSE 100',
        '^GDAXI': 'DAX',
        '^FCHI':  'CAC 40',
        '^N225':  'Nikkei 225',
        '^HSI':   'Hang Seng',
        '^BVSP':  'Bovespa',
        '^STOXX50E': 'Euro Stoxx 50',
        # Crypto (strip generic " USD" suffix)
        'BTC-USD':   'Bitcoin',
        'ETH-USD':   'Ethereum',
        'BNB-USD':   'BNB',
        'XRP-USD':   'XRP',
        'SOL-USD':   'Solana',
        'ADA-USD':   'Cardano',
        'AVAX-USD':  'Avalanche',
        'DOGE-USD':  'Dogecoin',
        'POL28321-USD': 'Polygon',
        'DOT-USD':   'Polkadot',
        'LINK-USD':  'Chainlink',
        'UNI7083-USD': 'Uniswap',
        'LTC-USD':   'Litecoin',
        'ATOM-USD':  'Cosmos',
        'XLM-USD':   'Stellar',
        'ALGO-USD':  'Algorand',
        'NEAR-USD':  'NEAR Protocol',
        'S32684-USD': 'Sonic (ex-Fantom)',
        'SAND-USD':  'The Sandbox',
        'MANA-USD':  'Decentraland',
        'APT21794-USD': 'Aptos',
        'ARB11841-USD': 'Arbitrum',
        'OP-USD':    'Optimism',
        'SUI-USD':   'Sui',
        'INJ-USD':   'Injective',
        'TIA-USD':   'Celestia',
        'JTO-USD':   'Jito',
        'WIF-USD':   'dogwifhat',
        'PEPE-USD':  'Pepe',
        'FLOKI-USD': 'Floki',
        'BONK-USD':  'Bonk',
    }

    # Legal / verbose suffixes to strip for mobile readability
    STRIP_SUFFIXES = [
        # Exchange-appended suffixes (yfinance adds these for ADRs/foreign listings)
        ' - New York Registry Shares', ' - New York Registered Shares',
        ' - New York Re', ' - ADR', ' - ADS',
        ' Common Stock', ' Ordinary Shares', ' Class A', ' Class B',
        # Legal entity suffixes
        ', Inc.', ' Inc.', ' Incorporated', ' Corporation', ' Corp.',
        ' Corp', ' Company', ' Limited', ' Ltd.', ' Ltd',
        ' PLC', ' plc', ' AG', ' SE', ' N.V.', ' NV', ' SA', ' S.A.',
        # Verbose descriptors
        ' Technologies', ' Technology', ' Solutions',
        ' International', ' Global', ' Worldwide',
        ' Holdings', ' Holding', ' Group',
        ' & Co.', ' & Co', ' Co.',
        # Parenthetical (e.g. "Boeing Company (The)")
        ' (The)', '(The) ',
        ' USD',  # leftover crypto suffix
    ]

    import re as _re

    cache_path = os.path.join(OUTPUT_DIR, 'names_cache.json')
    cache = {}
    if os.path.exists(cache_path):
        try:
            with open(cache_path) as f:
                cache = json.load(f)
        except Exception:
            pass

    # result is keyed by the DISPLAY name (item.instrument_name — what app.js
    # instName() looks up); the cache stays keyed by yfinance ticker.
    instruments = load_instruments()
    result      = {}
    fetched     = 0

    for inst in instruments:
        ticker = inst['ticker']
        disp   = inst['name']
        # 1. Hard override wins
        if ticker in OVERRIDES:
            result[disp] = OVERRIDES[ticker]
            continue
        # 2. Cache hit
        if ticker in cache and cache[ticker]:
            result[disp] = cache[ticker]
            continue
        # 3. Fetch from yfinance
        try:
            info = yf.Ticker(ticker).info
            # longName is cleaner for foreign stocks; shortName can contain padding garbage
            name = (info.get('longName') or info.get('shortName') or '').strip()
            # Strip leading "The " (e.g. "The Boeing Company")
            if name.startswith('The '):
                name = name[4:].strip()
            # Strip anything after ' - ' (exchange descriptions like '- New York Re')
            if ' - ' in name:
                name = name.split(' - ')[0].strip()
            for sfx in STRIP_SUFFIXES:
                if name.endswith(sfx):
                    name = name[:-len(sfx)].strip()
            # Strip trailing noise: single uppercase/lowercase letter after whitespace
            # e.g. "Covestro AG    I"  →  "Covestro"  (the AG was already stripped above)
            name = _re.sub(r'\s{2,}[A-Za-z]\s*$', '', name).strip()
            name = name.rstrip(',').strip()
            cache[ticker] = name
            result[disp] = name
            fetched += 1
        except Exception as exc:
            print(f'    ✗ Name fetch failed for {ticker}: {exc}')
            cache[ticker] = ''
            result[disp] = ''

    # Persist updated cache
    try:
        with open(cache_path, 'w') as f:
            json.dump(cache, f, separators=(',', ':'), indent=2)
    except Exception:
        pass

    print(f'  Instrument names: {len(result)} ({fetched} newly fetched)')
    return result


# ---------------------------------------------------------------------------
# Build data files into a local directory
# ---------------------------------------------------------------------------

def build_data(output_dir, src_signals_dir=None):
    """Generate all JSON data files into output_dir. Returns (date_str, fetched_at).

    src_signals_dir — override where signals CSVs are read from (intraday pipeline).
    """
    df, dt, fetched_at = load_latest_signals(src_dir=src_signals_dir)
    print(f'  Signals date: {dt}')
    print(f'  Data fetched: {fetched_at}')
    print(f'  Instruments:  {len(df)}')

    signals_data = {'date': dt, 'data': df.to_dict(orient='records')}
    _dump_json_gz(os.path.join(output_dir, 'signals.json'), signals_data, separators=(',', ':'))

    summary = build_summary(df, dt)
    summary['fetched_at'] = fetched_at
    with open(os.path.join(output_dir, 'summary.json'), 'w') as f:
        json.dump(summary, f, separators=(',', ':'))

    # Run status — the CI failure step overwrites this with state:'failed';
    # the service worker checks it on push to alert when a run broke.
    with open(os.path.join(output_dir, 'status.json'), 'w') as f:
        json.dump({'state': 'ok', 'at': fetched_at, 'date': dt},
                  f, separators=(',', ':'))

    tv_map = build_tv_map()
    with open(os.path.join(output_dir, 'tv-map.json'), 'w') as f:
        json.dump(tv_map, f, separators=(',', ':'))

    ai_set = build_ai_set()
    with open(os.path.join(output_dir, 'ai-instruments.json'), 'w') as f:
        json.dump(ai_set, f, separators=(',', ':'))

    trends = load_latest_trends(dt, src_dir=src_signals_dir)
    _dump_json_gz(os.path.join(output_dir, 'trends.json'), trends, separators=(',', ':'))
    print(f'  Trend histories: {len(trends)}')

    explanations = generate_explanations(df)
    with open(os.path.join(output_dir, 'explanations.json'), 'w') as f:
        json.dump(explanations, f, separators=(',', ':'), ensure_ascii=False)


    # Live signal ledger + sector activity series — copy verbatim if present
    for fname in ('signal_ledger.json', 'ledger_summary.json',
                  'sector_activity.json', 'sector_radar.json',
                  'sector_activity_w.json', 'sector_radar_w.json',
                  'sector_activity_3d.json', 'sector_radar_3d.json',
                  'shape_similarity.json',
                  'instrument_flavours.json', 'events.json',
                  'rotation.json', 'rotation_paper.json'):
        src = os.path.join(OUTPUT_DIR, fname)
        if os.path.exists(src):
            # Byte-for-byte, as the comment above always claimed. It used to
            # json.load then json.dump, which re-minified files that were
            # already minified — no gain, and it CANNOT read a gzipped
            # artifact: shape_similarity.json is written gzipped under a plain
            # .json name (the trick chart_feed uses so R2 serves it compressed)
            # and the round-trip died on it with UnicodeDecodeError, taking the
            # whole publish down after the signals had been computed.
            shutil.copyfile(src, os.path.join(output_dir, fname))

    # Calendar subscription feed. The per-event "Add to calendar" button in the
    # app builds its own one-off .ics client-side; THIS file is the standing
    # subscription — point iOS Calendar at webcal://<r2>/ma500/events.ics once
    # and every future earnings date arrives on its own. All-day VEVENTs, since
    # events.py deliberately carries no time of day.
    ev_src = os.path.join(OUTPUT_DIR, 'events.json')
    if os.path.exists(ev_src):
        with open(ev_src) as f:
            ev_payload = json.load(f)
        with open(os.path.join(output_dir, 'events.ics'), 'w') as f:
            f.write(build_ics(ev_payload.get('events', [])))
        print(f'  Calendar feed: events.ics ({len(ev_payload.get("events", []))} events)')

    # Backtest results — copy if a recent backtest JSON exists
    bt_files = sorted(glob.glob(os.path.join(OUTPUT_DIR, 'backtest_*.json')))
    if bt_files:
        with open(bt_files[-1]) as f:
            bt = json.load(f)
        _dump_json_gz(os.path.join(output_dir, 'backtest.json'), bt, separators=(',', ':'))
        print(f'  Backtest report: {os.path.basename(bt_files[-1])}')
    else:
        print(f'  Backtest report: none found in {OUTPUT_DIR}')

    # Flow volumes — build pre-structured JSON for Cloudflare Pages (static hosting)
    flow_csv = os.path.join(OUTPUT_DIR, 'flow_volumes.csv')
    if os.path.exists(flow_csv):
        try:
            fdf = pd.read_csv(flow_csv)
            fdf['total_volume'] = pd.to_numeric(fdf['total_volume'], errors='coerce').fillna(0).astype(int)
            fdf['instrument_count'] = pd.to_numeric(fdf['instrument_count'], errors='coerce').fillna(0).astype(int)
            flow_json = {'Indices': {}}
            for region in ['All', 'US', 'EU', 'Asian', 'Other']:
                subset = fdf[(fdf['group'] == 'Indices') & (fdf['region'] == region)].sort_values('date')
                flow_json['Indices'][region] = [
                    {'date': row['date'], 'volume': int(row['total_volume']),
                     'instrument_count': int(row['instrument_count'])}
                    for _, row in subset.iterrows()
                ]
            with open(os.path.join(output_dir, 'flow_volumes.json'), 'w') as f:
                json.dump(flow_json, f, separators=(',', ':'))
            print(f'  Flow volumes: {fdf["date"].nunique()} dates')
        except Exception as e:
            print(f'  Flow volumes: skipped ({e})')
    else:
        print(f'  Flow volumes: no CSV found — run main.py first')

    names = build_names()
    with open(os.path.join(output_dir, 'names.json'), 'w') as f:
        json.dump(names, f, separators=(',', ':'), ensure_ascii=False)

    # Chart reel feed — the app's only source of price history now. It also
    # feeds the volume sparklines, which used to read the per-instrument
    # `history/` dump that stopped being built when the modal's Lightweight
    # Charts view was removed. See webapp/chart_feed.py.
    try:
        t_chart = time.time()
        cstats  = build_chart_feed(output_dir, CACHE_DIR, get_ticker_map())
        # Report every timeframe the builder actually produced. Hard-coding D
        # and 4H here meant the 2026-09-02 run printed "798 daily / 798 4H"
        # while it had in fact written 160 weekly chunks too — a summary line
        # that under-reports is how a broken feed looks healthy.
        _tf_parts = ', '.join(f'{v} {k}' for k, v in cstats.items() if k != 'chunks')
        print(f'  Chart feed: {_tf_parts} '
              f'in {cstats["chunks"]} chunks ({time.time() - t_chart:.0f}s)')
    except Exception as e:
        # NOT swallowed any more. The old comment here said a missing chart feed
        # "costs you the Charts tab, not the publish" — but that is not what it
        # costs. The upload step below skips the chart directory when it does not
        # exist, so R2 KEEPS THE PREVIOUS CHUNKS and the publish still reports
        # success: the app goes on serving the last good chart feed as though it
        # were current. That is exactly how the 2026-09-09 ribbon change reached
        # the live app with every chart still drawing the old twenty MAs while
        # every other surface had moved to three.
        #
        # A stale chart feed presented as a fresh one is worse than a red
        # publish, so this now fails loudly and takes the exit code with it.
        import traceback
        print('\n  ' + '=' * 66)
        print('  CHART FEED BUILD FAILED — R2 STILL HOLDS THE PREVIOUS CHUNKS.')
        print('  The charts on the live app are STALE, not missing. Fix and')
        print('  re-publish before trusting anything the Charts tab draws.')
        print('  ' + '=' * 66)
        traceback.print_exc()
        raise

    return dt, fetched_at


# ---------------------------------------------------------------------------
# R2 upload
# ---------------------------------------------------------------------------
# Two upload paths depending on what credentials are available:
#
#  A) CLOUDFLARE_API_TOKEN is set (GitHub Actions CI)
#     → direct HTTPS PUT to Cloudflare REST API — no wrangler, no version issues
#
#  B) Not set (local dev — authenticated via `wrangler login` OAuth)
#     → fall back to wrangler CLI which uses the cached OAuth token
#
# CI GitHub secret needed:  CLOUDFLARE_API_TOKEN
# Account ID is hardcoded below (not sensitive — visible in public R2 URLs).
# ---------------------------------------------------------------------------

# Cloudflare account ID — not a secret, safe to commit
_CF_ACCOUNT_ID = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '1b10154f55836228244d2602eb39b480')

_WRANGLER_CANDIDATES = [
    os.path.expanduser('~/.npm-global/bin/wrangler'),
    '/usr/local/bin/wrangler',
    '/opt/homebrew/bin/wrangler',
]


def _wrangler_bin():
    import shutil
    found = shutil.which('wrangler')
    if found:
        return found
    for p in _WRANGLER_CANDIDATES:
        if os.path.isfile(p):
            return p
    return None


def _cache_control_for(r2_key):
    """Cache-Control for an R2 object.

    Signals and summary must never be served stale — the app's freshness banner
    reads them — so they stay no-cache. The chart bundles change once per
    publish and are ~250 KB each; serving them no-cache meant every scroll
    re-downloaded from the origin, which costs the reader mobile data and the
    bucket a Class B op per card.
    """
    tail = r2_key.split('/', 1)[-1]
    # The index is the map everything else is read through, and it is 3 KB.
    # Caching it independently of the chunks it points at is what let a stale
    # copy outlive the grouping it described. Chunks stay cached; this does not.
    if tail == 'chart/index.json':
        return 'no-cache, max-age=0'
    if tail.startswith('chart/'):
        return 'public, max-age=900'
    return 'no-cache, max-age=0'


def _content_type_for(r2_key):
    """Content-Type for an R2 object.

    Everything this pipeline publishes is JSON except the calendar feed, and an
    .ics served as application/json will not subscribe — iOS Calendar dispatches
    on the MIME type, not the extension, so a webcal:// link to a JSON-typed
    file silently does nothing.
    """
    return 'text/calendar; charset=utf-8' if r2_key.endswith('.ics') else 'application/json'


def _is_gzipped(path):
    """True if the file on disk is gzip data (magic bytes 1f 8b).

    The chart feed is written pre-compressed so R2 can serve it with
    Content-Encoding: gzip — the public r2.dev endpoint does not compress
    anything itself, so without this a chart costs 51 KB on the wire instead
    of 19 KB.
    """
    try:
        with open(path, 'rb') as fh:
            return fh.read(2) == b'\x1f\x8b'
    except OSError:
        return False


def _r2_put_api(local_path, r2_key, api_token, account_id, timeout=120, max_429_retries=6):
    """Upload via Cloudflare REST API (used in CI where API token is available).

    The Cloudflare API is globally rate-limited (~1200 req / 5 min). A cold-cache
    full publish uploads 700+ files, so HTTP 429s are expected mid-run — retry
    them in-place with exponential backoff (honouring Retry-After) instead of
    letting them fail the whole upload. Warm incremental runs upload only a few
    changed files and never trip this.
    """
    import urllib.request
    import urllib.error
    url = (
        f'https://api.cloudflare.com/client/v4/accounts/{account_id}'
        f'/r2/buckets/{R2_BUCKET}/objects/{r2_key}'
    )
    with open(local_path, 'rb') as fh:
        data = fh.read()
    headers = {
        'Authorization': f'Bearer {api_token}',
        'Content-Type':  _content_type_for(r2_key),
        'Cache-Control': _cache_control_for(r2_key),
    }
    if _is_gzipped(local_path):
        headers['Content-Encoding'] = 'gzip'
    backoff = 2.0
    for attempt in range(max_429_retries + 1):
        try:
            req = urllib.request.Request(url, data=data, method='PUT', headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read(500).decode('utf-8', errors='replace')
                # Cloudflare returns 200 with {"success":true} on success
                if resp.status in (200, 201) and '"success":true' in body:
                    return True, r2_key
                print(f'  [R2] WARN {r2_key}: HTTP {resp.status} — {body[:200]}', flush=True)
                return False, r2_key
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < max_429_retries:
                retry_after = exc.headers.get('Retry-After') if exc.headers else None
                delay = float(retry_after) if retry_after and retry_after.isdigit() else backoff
                time.sleep(delay)
                backoff = min(backoff * 2, 30.0)
                continue
            body = exc.read(300).decode('utf-8', errors='replace') if exc.fp else ''
            print(f'  [R2] HTTP {exc.code} {r2_key}: {body[:200]}', flush=True)
            return False, r2_key
        except Exception as exc:
            print(f'  [R2] ERROR {r2_key}: {exc}', flush=True)
            return False, r2_key
    return False, r2_key


def _r2_put_wrangler(local_path, r2_key, timeout=120):
    """Upload via wrangler CLI (used locally with OAuth login)."""
    env = {**os.environ, 'PATH': '/usr/local/bin:' + os.environ.get('PATH', '')}
    wrangler = _wrangler_bin()
    cmd = [wrangler] if wrangler else ['npx', 'wrangler']
    enc = ['--content-encoding', 'gzip'] if _is_gzipped(local_path) else []
    cc  = _cache_control_for(r2_key)
    # --remote needed in wrangler 4.x (defaults to local emulator without it)
    # wrangler 3.x accepts but ignores it (already remote by default)
    try:
        result = subprocess.run(
            cmd + ['r2', 'object', 'put',
                   f'{R2_BUCKET}/{r2_key}',
                   '--file', local_path,
                   '--content-type', _content_type_for(r2_key),
                   '--cache-control', cc,
                   *enc, '--remote'],
            capture_output=True, text=True, env=env, timeout=timeout,
        )
        if result.returncode != 0:
            err = (result.stderr or result.stdout or '').strip()
            # wrangler 3.93 dropped --remote; retry without it
            if '--remote' in err or 'Unknown argument' in err:
                result = subprocess.run(
                    cmd + ['r2', 'object', 'put',
                           f'{R2_BUCKET}/{r2_key}',
                           '--file', local_path,
                           '--content-type', _content_type_for(r2_key),
                           '--cache-control', cc,
                           *enc],
                    capture_output=True, text=True, env=env, timeout=timeout,
                )
            if result.returncode != 0:
                err = (result.stderr or result.stdout or '').strip()
                if err:
                    print(f'  [R2] WARN {r2_key}: {err[:200]}', flush=True)
        return result.returncode == 0, r2_key
    except subprocess.TimeoutExpired:
        print(f'  [R2] TIMEOUT {r2_key}', flush=True)
        return False, r2_key
    except Exception as exc:
        print(f'  [R2] ERROR {r2_key}: {exc}', flush=True)
        return False, r2_key


def _r2_put(local_path, r2_key, timeout=120):
    """Upload a single file to R2. Returns (success, r2_key).

    Picks the best available upload method automatically:
    - CI (CLOUDFLARE_API_TOKEN set): direct REST API — no wrangler, no version issues
    - Local dev (wrangler login): wrangler CLI with OAuth
    """
    api_token = os.environ.get('CLOUDFLARE_API_TOKEN', '').strip()

    if api_token:
        return _r2_put_api(local_path, r2_key, api_token, _CF_ACCOUNT_ID, timeout)
    else:
        return _r2_put_wrangler(local_path, r2_key, timeout)


def upload_to_r2(data_dir, max_workers=8, retries=2, r2_prefix=''):
    """Upload all files in data_dir to R2 using parallel workers with retry.

    r2_prefix — optional path prefix for all R2 keys (e.g. 'intraday').
    """
    def _key(fname):
        return f'{r2_prefix}/{fname}' if r2_prefix else fname

    files = []

    # Core data files
    for fname in ['signals.json', 'summary.json', 'tv-map.json', 'ai-instruments.json',
                  'trends.json', 'explanations.json', 'names.json',
                  'backtest.json', 'flow_volumes.json',
                  'signal_ledger.json', 'ledger_summary.json',
                  'sector_activity.json', 'sector_radar.json',
                  'sector_activity_w.json', 'sector_radar_w.json',
                  'sector_activity_3d.json', 'sector_radar_3d.json',
                  'shape_similarity.json',
                  'instrument_flavours.json', 'status.json',
                  'events.json', 'events.ics',
                  'rotation.json', 'rotation_paper.json']:
        p = os.path.join(data_dir, fname)
        if os.path.exists(p):
            files.append((p, _key(fname)))

    # No history/ block: that feed's builder had been dead code since the
    # Lightweight Charts view was removed, so the directory only ever held
    # whatever a long-past run left behind — 184 MB of files last written
    # 2026-06-23, re-uploaded every publish. Its one remaining reader, the
    # volume sparklines, now reads the chart feed.

    # Chart reel feed — chart/index.json + chart/<tf>/<chunk>.json
    chart_dir = os.path.join(data_dir, 'chart')
    if not os.path.exists(chart_dir):
        # Silently skipping this is how a stale feed survives a green publish.
        print(f'  WARNING: no chart feed at {chart_dir} — R2 keeps its existing '
              f'chunks and the Charts tab will draw whatever was published last.')
    if os.path.exists(chart_dir):
        for root, _dirs, fnames in os.walk(chart_dir):
            for fname in fnames:
                if not fname.endswith('.json'):
                    continue
                full = os.path.join(root, fname)
                rel  = os.path.relpath(full, data_dir)
                files.append((full, _key(rel)))

    total  = len(files)
    print(f'  Uploading {total} files to R2...', flush=True)

    def _upload_batch(batch):
        ok, failed = 0, []
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(_r2_put, path, key): key for path, key in batch}
            done = 0
            for future in concurrent.futures.as_completed(futures):
                success, key = future.result()
                done += 1
                if success:
                    ok += 1
                else:
                    # find path for retry
                    orig = next(p for p, k in batch if k == key)
                    failed.append((orig, key))
                if done % 25 == 0 or done == len(batch):
                    print(f'  Progress: {done}/{len(batch)}', end='\r', flush=True)
        return ok, failed

    ok, failed = _upload_batch(files)

    # Retry failed files (sequentially, one at a time)
    for attempt in range(retries):
        if not failed:
            break
        print(f'\n  Retrying {len(failed)} failed file(s) (attempt {attempt+1}/{retries})...', flush=True)
        retry_ok = 0
        still_failed = []
        for path, key in failed:
            success, _ = _r2_put(path, key, timeout=180)
            if success:
                ok += 1
                retry_ok += 1
            else:
                still_failed.append((path, key))
        failed = still_failed
        print(f'  Retry result: {retry_ok} recovered', flush=True)

    print(f'\n  R2 upload: {ok}/{total} files ✓')
    if failed:
        keys = [k for _, k in failed]
        print(f'  Still failed ({len(failed)}): {keys[:5]}{"..." if len(failed) > 5 else ""}')
    # Return (ok_count, failed_count) so callers can decide whether to exit non-zero
    return ok, len(failed)


# ---------------------------------------------------------------------------
# UI build (Cloudflare Pages — only needed when frontend changes)
# ---------------------------------------------------------------------------

def build_ui():
    """Build a minimal UI-only directory with app.js patched to use R2 URLs."""
    ui_dir     = os.path.join(PUBLISH_DIR, 'ui')
    static_dst = os.path.join(ui_dir, 'static')

    os.makedirs(ui_dir, exist_ok=True)
    if os.path.exists(static_dst):
        shutil.rmtree(static_dst)
    shutil.copytree(os.path.join(SCRIPT_DIR, 'static'), static_dst)

    # Unique build id for this deploy — powers the app's self-update check.
    # The installed PWA polls version.json and hard-reloads when this changes.
    build_id = str(int(time.time()))

    # Copy index.html — patch profile badge and title
    with open(os.path.join(SCRIPT_DIR, 'templates', 'index.html')) as f:
        html = f.read()
    html = html.replace('PROFILE_BADGE', 'MA500')
    html = html.replace('<title>SwingPulse</title>', '<title>SwingPulse 500</title>')
    html = html.replace('content="SwingPulse"', 'content="SwingPulse 500"')
    html = html.replace('__APP_PROFILE__', 'ma500')
    html = html.replace('__BUILDSTAMP__', build_id)  # value only — not the window.__BUILD_ID__ var name
    # Patch Signal Types legend with correct MA periods for this profile
    html = html.replace('__SIG_LONGEST__', str(_longest_ma))
    html = html.replace('__SIG_SHORTEST__', str(_shortest_ma))
    html = html.replace('__SIG_MID__', str(sorted(MA_PERIODS)[len(MA_PERIODS) // 2]))
    with open(os.path.join(ui_dir, 'index.html'), 'w') as f:
        f.write(html)

    # Emit version.json at site root — the app fetches this (cache: no-store)
    # on launch / foreground and reloads itself when build != running build.
    with open(os.path.join(ui_dir, 'version.json'), 'w') as f:
        json.dump({'build': build_id}, f)

    # Patch app.js: replace /api/* with R2 URLs
    app_js_path = os.path.join(static_dst, 'js', 'app.js')
    with open(app_js_path) as f:
        js = f.read()

    base = R2_BASE_URL.rstrip('/')   # profile-aware: R2_PUBLIC_URL or R2_PUBLIC_URL/ma200
    js = js.replace("'/api/signals'",      f"'{base}/signals.json'")
    js = js.replace("'/api/summary'",      f"'{base}/summary.json'")
    js = js.replace("'/api/status'",       f"'{base}/status.json'")
    js = js.replace("'/api/tv-map'",          f"'{base}/tv-map.json'")
    js = js.replace("'/api/ai-instruments'",  f"'{base}/ai-instruments.json'")
    js = js.replace("'/api/trends'",       f"'{base}/trends.json'")
    js = js.replace("'/api/explanations'", f"'{base}/explanations.json'")
    js = js.replace("'/api/ledger'",       f"'{base}/ledger_summary.json'")
    js = js.replace("'/api/names'",        f"'{base}/names.json'")
    js = js.replace("'/api/backtest'",     f"'{base}/backtest.json'")
    # NB the -w variants MUST be replaced before their unsuffixed siblings would
    # be reached, and they are distinct PATHS rather than '?tf=W' query strings
    # for exactly this reason: these rewrites are literal string matches
    # including the closing quote, so '/api/sector-radar?tf=W' matched nothing,
    # shipped to production unrewritten, and fetched a path that does not exist
    # on a static host. It failed soft — null radar, silent fall back to daily —
    # which is the worst way for it to fail. A published API path has to be a
    # path, because that is the only thing this rewrite can see.
    js = js.replace("'/api/shape-similarity'", f"'{base}/shape_similarity.json'")
    js = js.replace("'/api/sector-radar-w'", f"'{base}/sector_radar_w.json'")
    js = js.replace("'/api/sector-activity-w'", f"'{base}/sector_activity_w.json'")
    js = js.replace("'/api/sector-radar-3d'", f"'{base}/sector_radar_3d.json'")
    js = js.replace("'/api/sector-activity-3d'", f"'{base}/sector_activity_3d.json'")
    js = js.replace("'/api/sector-radar'", f"'{base}/sector_radar.json'")
    js = js.replace("'/api/sector-activity'", f"'{base}/sector_activity.json'")
    js = js.replace("'/api/instrument-flavours'", f"'{base}/instrument_flavours.json'")
    js = js.replace("'/api/events'",       f"'{base}/events.json'")
    js = js.replace("'/api/rotation-paper'", f"'{base}/rotation_paper.json'")
    js = js.replace("'/api/rotation'",     f"'{base}/rotation.json'")
    # The calendar SUBSCRIPTION feed. Must be an absolute R2 URL: the app is on
    # pages.dev and the .ics lives in the bucket, and webcal:// is resolved by
    # the OS calendar app, which has no page context to resolve a relative path.
    js = js.replace("'/events.ics'",       f"'{base}/events.ics'")
    js = js.replace("'/api/flow'",         f"'{base}/flow_volumes.json'")
    # The chart index and its chunks are ONE dataset and must never be mixed
    # across publishes. They are cached at the edge for 15 minutes, and the
    # index is a map of instrument -> chunk id: change how instruments are
    # grouped into chunks (CHUNK_SIZE) and a stale index sends every lookup to
    # a chunk that no longer holds that instrument. That is not theoretical —
    # on 2026-09-09 CHUNK_SIZE went 5 -> 3 and the live app served "No chart
    # data" for EVERY card until the cached index expired.
    #
    # Stamping both URLs with the publish time makes them a matched pair: a new
    # publish is a new URL, so the edge fetches index and chunks fresh and
    # together, and between publishes the URL is stable so the 15-minute cache
    # still does its job.
    _cv = str(int(time.time()))
    js = js.replace("'/api/chart-index'",  f"'{base}/chart/index.json?v={_cv}'")
    js = js.replace(
        "'/api/chart/' + tf + '/' + cid",
        f"'{base}/chart/' + tf + '/' + cid + '.json?v={_cv}'"
    )
    js = js.replace(
        "await fetch('/api/refresh', { method: 'POST' })",
        "window.location.reload(); return"
    )

    # Inject per-user TV layout IDs for this profile
    for user, layout_id in TV_LAYOUTS.items():
        js = js.replace(f'{user.upper()}_TV_LAYOUT_ID', layout_id)

    with open(app_js_path, 'w') as f:
        f.write(js)

    # Copy manifest
    manifest_src = os.path.join(SCRIPT_DIR, 'static', 'manifest.json')
    if os.path.exists(manifest_src):
        shutil.copy2(manifest_src, ui_dir)

    # Copy service worker to root (must be at / scope)
    # Patch R2_BASE so the SW fetches signals from the correct profile path
    sw_src = os.path.join(SCRIPT_DIR, 'static', 'sw.js')
    if os.path.exists(sw_src):
        with open(sw_src) as f:
            sw = f.read()
        sw = sw.replace('SW_R2_BASE_URL', R2_BASE_URL.rstrip('/'))
        with open(os.path.join(ui_dir, 'sw.js'), 'w') as f:
            f.write(sw)

    return ui_dir


def deploy_ui_to_pages(ui_dir, project_name=None):
    """Deploy UI directory to Cloudflare Pages."""
    name = project_name or PAGES_PROJECT
    print(f'\n  Deploying UI to Cloudflare Pages ({name})...')
    wrangler = _wrangler_bin()
    cmd = [wrangler] if wrangler else ['npx', 'wrangler']
    env = {**os.environ, 'PATH': '/usr/local/bin:' + os.environ.get('PATH', '')}
    result = subprocess.run(
        # --branch main, always. Without it wrangler names the deploy after the
        # CURRENT GIT BRANCH, so deploying from a feature branch silently went to
        # a preview URL (<branch>.swingpulse200.pages.dev) while the live site
        # kept the old build and this still printed 'deploy complete' (2026-09-11).
        cmd + ['pages', 'deploy', ui_dir, '--project-name', name, '--branch', 'main'],
        capture_output=True, text=True, env=env,
    )
    output = result.stdout + result.stderr
    if result.returncode == 0:
        pages_url = f'https://{name}.pages.dev'
        print(f'  ✓ Pages deploy complete — {pages_url}')
    else:
        print(f'  Pages deploy failed:\n{output}')
    return result.returncode == 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='SwingPulse Publisher')
    parser.add_argument('--build-only', action='store_true',
                        help='Build locally only — no deploy')
    parser.add_argument('--ui-only', action='store_true',
                        help='Build UI and deploy to Cloudflare Pages (use after frontend changes)')
    parser.add_argument('--profile', type=str, default='ma500',
                        help='Profile name (ignored — hardcoded to ma500)')
    args = parser.parse_args()

    # ── UI-only deploy ────────────────────────────────────────────────────
    if args.ui_only:
        print('Building UI for Cloudflare Pages... [ma500]')
        ui_dir = build_ui()
        print(f'  Output: {ui_dir}')
        deploy_ui_to_pages(ui_dir)
        return

    # ── Data build + R2 upload ────────────────────────────────────────────
    print('Building static site... [ma500]')
    data_dir = os.path.join(PUBLISH_DIR, 'data_ma500')
    os.makedirs(data_dir, exist_ok=True)

    build_data(data_dir)
    print(f'  Output: {data_dir}')

    if args.build_only:
        print('\n  Build complete.')
        return

    ok_count, fail_count = upload_to_r2(data_dir, r2_prefix=R2_DATA_PREFIX)
    pages_url = f'https://{PAGES_PROJECT}.pages.dev'
    if fail_count == 0:
        print(f'\n  ✓ App updated! {pages_url}')
    else:
        print(f'\n  ✗ R2 upload had {fail_count} failure(s) — {ok_count} files uploaded. Check wrangler auth (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID).')
        sys.exit(1)


if __name__ == '__main__':
    main()
