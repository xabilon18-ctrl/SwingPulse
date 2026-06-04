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
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime

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
MA_PERIODS  = list(range(25, 501, 25))   # MA25–MA500

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


def build_summary(df, dt):
    if df.empty:
        return {}
    trend_counts  = df['trend_direction'].value_counts().to_dict()
    buy_mask      = df['confirmation_status'].str.contains('buy',  case=False, na=False)
    sell_mask     = df['confirmation_status'].str.contains('sell', case=False, na=False)
    signal_types  = df['primary_signal'].value_counts().to_dict()
    signal_types.pop('', None)
    groups = sorted([g for g in df['group'].unique().tolist() if g])
    return {
        'date':             dt,
        'total':            len(df),
        'trend_counts':     trend_counts,
        'buy_count':        int(buy_mask.sum()),
        'sell_count':       int(sell_mask.sum()),
        'watch_count':      int((df['watch_flag'] != '').sum()),
        'volume_spikes':    int((df['volume_spike_flag'] == 'yes').sum()),
        'key_level_touches':int((df['key_level_touched_today'] == 'yes').sum()),
        'turning_points':   int((df['potential_turning_point_flag'] != '').sum()),
        'signal_types':     signal_types,
        'groups':           groups,
        'ma_max_pairs':     len(MA_PERIODS) - 1,
        'ma_longest':       _longest_ma,
        'ma_shortest':      _shortest_ma,
    }


def build_history(name, ticker):
    path = os.path.join(CACHE_DIR, _ticker_to_filename(ticker))
    if not os.path.exists(path):
        return None
    df = pd.read_parquet(path).tail(600).copy()
    for p in MA_PERIODS:
        col = f'ma_{p}'
        if col not in df.columns:
            full      = pd.read_parquet(path)
            full[col] = full['Close'].rolling(p, min_periods=p).mean()
            df[col]   = full[col].tail(600)
    df.index = df.index.strftime('%Y-%m-%d')
    records  = []
    for dt_str, row in df.iterrows():
        rec = {
            'date':   dt_str,
            'open':   round(float(row.get('Open',   0)), 4),
            'high':   round(float(row.get('High',   0)), 4),
            'low':    round(float(row.get('Low',    0)), 4),
            'close':  round(float(row.get('Close',  0)), 4),
            'volume': int(row.get('Volume', 0)),
        }
        for p in MA_PERIODS:
            v = row.get(f'ma_{p}')
            if pd.notna(v):
                rec[f'ma_{p}'] = round(float(v), 4)
        records.append(rec)
    return {'ticker': ticker, 'data': records}


# ---------------------------------------------------------------------------
# Signal Explanations — rule-based, no API required
# ---------------------------------------------------------------------------

_longest_ma  = max(MA_PERIODS)
_shortest_ma = min(MA_PERIODS)
_SIG_WHAT = {
    'B1': (f'trend reversal — price crossed above all MAs (MA{_shortest_ma}–MA{_longest_ma})',),
    'S1': (f'trend reversal — price crossed below all MAs (MA{_shortest_ma}–MA{_longest_ma})',),
    'B2': (f'pullback bounce off MA{_shortest_ma} — first pullback level',),
    'S2': (f'rejection at MA{_shortest_ma} — first rally level',),
    'B3': ('pullback bounce off MA100',),
    'S3': ('rejection at MA100',),
    'B4': ('pullback bounce off MA200',),
    'S4': ('rejection at MA200',),
    'B5': ('pullback bounce off MA300',),
    'S5': ('rejection at MA300',),
    'B6': ('pullback bounce off MA400',),
    'S6': ('rejection at MA400',),
    'B7': (f'deep pullback bounce off MA{_longest_ma} — anchor level',),
    'S7': (f'deep rally rejection at MA{_longest_ma} — anchor level',),
}

_ALIGN_NOTES = {
    'Triple Bull':   'all three timeframes aligned bullish',
    'Triple Bear':   'all three timeframes aligned bearish',
    'Aligned Bull':  'two timeframes aligned bullish',
    'Aligned Bear':  'two timeframes aligned bearish',
    'Leaning Bull':  'leaning bullish across timeframes',
    'Leaning Bear':  'leaning bearish across timeframes',
    'Counter-trend': 'counter-trend setup — higher timeframe conflicts',
    'Mixed':         'mixed timeframe picture',
}

_CONF_NOTES = {
    'high':     'high-confidence setup',
    'standard': 'standard-confidence setup',
    'low':      'low-confidence — wait for additional confirmation',
}


def _explain_one(row: pd.Series) -> str:
    """Build a specific, data-driven signal explanation from signal fields — no API."""
    def v(col):
        val = row.get(col, '')
        return str(val).strip() if val is not None and str(val) not in ('', 'nan', 'None') else ''

    sig   = v('primary_signal')
    conf  = v('confirmation_status')
    sconf = v('signal_confidence')
    trend = v('trend_direction')
    run   = v('trend_run_days')
    align = v('tf_alignment')
    order = v('ma_order_score')
    vol   = v('volume_spike_flag')
    roc   = v('roc')
    comp  = v('ribbon_compression')
    tp    = v('potential_turning_point_flag')
    kl    = v('key_level_touched_today')
    spread= v('ribbon_spread')

    conf_lc = conf.lower()
    is_buy  = 'buy' in conf_lc or 'bull' in conf_lc
    is_sell = 'sell' in conf_lc or 'bear' in conf_lc
    if not is_buy and not is_sell:
        is_buy = trend == 'UPTREND'
        is_sell = trend == 'DOWNTREND'
    idx = 0 if is_buy else 1

    # ── Sentence 1: what is firing and why ───────────────────────────
    sig_desc = _SIG_WHAT.get(sig, ('signal',))[0]
    trend_lbl = 'uptrend' if trend == 'UPTREND' else 'downtrend' if trend == 'DOWNTREND' else 'sideways trend'

    s1_clauses = [f"{sig} {sig_desc}"]

    if run:
        try:
            run_int = int(float(run))
            s1_clauses.append(f"{run_int}-day {trend_lbl}")
        except ValueError:
            pass
    else:
        s1_clauses.append(trend_lbl)

    extras = []
    align_note = _ALIGN_NOTES.get(align, '')
    if align_note:
        extras.append(align_note)
    if vol == 'yes':
        extras.append('volume spike confirms institutional participation')
    if sconf:
        conf_note = _CONF_NOTES.get(sconf, '')
        if conf_note:
            extras.append(conf_note)
    if order:
        try:
            o = int(float(order))
            _max_pairs = len(MA_PERIODS) - 1
            if o >= _max_pairs - 1:
                extras.append(f'MA order fully stacked bullish ({o}/{_max_pairs})')
            elif o <= 3:
                extras.append(f'MA order fully stacked bearish ({o}/{_max_pairs})')
        except ValueError:
            pass
    if roc:
        try:
            r = float(roc)
            if abs(r) >= 3:
                extras.append(f'strong momentum (ROC {r:+.1f}%)')
        except ValueError:
            pass

    s1_body = ', '.join(s1_clauses)
    if extras:
        s1_body += ' — ' + '; '.join(extras[:2])
    sentence1 = s1_body.capitalize() + '.'

    # ── Sentence 2: what to watch / risk ─────────────────────────────
    s2_parts = []

    if comp == 'yes':
        if spread:
            try:
                sp = float(spread)
                s2_parts.append(f'ribbon compressed ({sp:.1f}% spread) — breakout expected')
            except ValueError:
                s2_parts.append('ribbon squeeze active — watch for breakout direction')
        else:
            s2_parts.append('ribbon squeeze active — watch for breakout')

    if tp:
        s2_parts.append(f'potential turning point: {tp}')
    elif kl == 'yes':
        s2_parts.append('key level touched today — watch for reaction')

    if is_buy:
        if not s2_parts:
            s2_parts.append('hold while price stays above the MA ribbon')
        s2_parts.append(f'invalidated on a close below MA{_shortest_ma}')
    elif is_sell:
        if not s2_parts:
            s2_parts.append('hold while price stays below the MA ribbon')
        s2_parts.append(f'invalidated on a close above MA{_shortest_ma}')

    if sconf == 'low':
        s2_parts.insert(0, 'low confidence — wait for next-candle confirmation')

    sentence2 = ('; '.join(s2_parts[:3])).capitalize() + '.'

    # Fix casing for technical terms
    for old, new in [(' ma ', ' MA '), (' ma1', ' MA1'), ('ma ribbon', 'MA ribbon'),
                     (' bp', ' BP'), (' sp', ' SP')]:
        sentence1 = sentence1.replace(old, new)
        sentence2 = sentence2.replace(old, new)

    return f'{sentence1} {sentence2}'


def generate_explanations(df: pd.DataFrame) -> dict:
    """Generate rule-based signal explanations for all signaled instruments.
    No API key required — runs entirely from signal data fields.
    Returns {instrument_name: explanation_text}.
    """
    signaled = df[df['primary_signal'].notna() & (df['primary_signal'] != '')].copy()
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
# Events — big volume & big moves tracker across all daily CSVs
# ---------------------------------------------------------------------------

def build_events():
    """Scan all daily signal CSVs and extract noteworthy events:
      - volume_spike_flag == 'yes'
      - |roc| >= 5  (5-day rate-of-change)
    Returns a list of event dicts sorted newest → oldest.
    """
    csv_files = sorted(glob.glob(os.path.join(OUTPUT_DIR, 'signals_*.csv')))
    if not csv_files:
        return []

    CRYPTO_SECTORS = {'Crypto', 'DeFi', 'Layer 1', 'Layer 2', 'NFT / Gaming', 'Stablecoins'}
    ROC_THRESH_STOCK  = 5.0   # 5% 5-day move for equities
    ROC_THRESH_CRYPTO = 10.0  # 10% 5-day move for crypto

    events = []
    seen_keys = set()  # deduplicate same instrument+date

    for fpath in reversed(csv_files):          # newest first
        date_str = os.path.basename(fpath).replace('signals_', '').replace('.csv', '')
        try:
            df = pd.read_csv(fpath).fillna('')
        except Exception:
            continue

        # Normalise column types
        for col in ('volume', 'volume_average', 'close', 'open', 'high', 'low', 'roc'):
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

        for _, row in df.iterrows():
            name    = str(row.get('instrument_name', '')).strip()
            if not name:
                continue
            key = f'{date_str}|{name}'
            if key in seen_keys:
                continue

            sector   = str(row.get('sector', '')).strip()
            is_crypto = sector in CRYPTO_SECTORS
            roc_thresh = ROC_THRESH_CRYPTO if is_crypto else ROC_THRESH_STOCK

            vol_spike = str(row.get('volume_spike_flag', '')).strip().lower() == 'yes'
            roc_val   = float(row.get('roc', 0))
            big_move  = abs(roc_val) >= roc_thresh

            if not vol_spike and not big_move:
                continue

            event_types = []
            if vol_spike:
                event_types.append('vol_spike')
            if big_move:
                event_types.append('big_move')

            vol     = int(row.get('volume', 0))
            vol_avg = int(row.get('volume_average', 0))
            vol_ratio = round(vol / vol_avg, 2) if vol_avg > 0 else 0.0

            close_px = float(row.get('close', 0))
            open_px  = float(row.get('open', 0))
            day_chg  = round((close_px - open_px) / open_px * 100, 2) if open_px > 0 else 0.0

            events.append({
                'date':              date_str,
                'instrument_name':   name,
                'group':             str(row.get('group', '')).strip(),
                'sector':            sector,
                'industry':          str(row.get('industry', '')).strip(),
                'close':             round(close_px, 4),
                'open':              round(open_px, 4),
                'high':              round(float(row.get('high', 0)), 4),
                'low':               round(float(row.get('low', 0)), 4),
                'day_chg_pct':       day_chg,
                'volume':            vol,
                'volume_average':    vol_avg,
                'volume_ratio':      vol_ratio,
                'roc':               round(roc_val, 2),
                'trend_direction':   str(row.get('trend_direction', '')).strip(),
                'primary_signal':    str(row.get('primary_signal', '')).strip(),
                'signal_confidence': str(row.get('signal_confidence', '')).strip(),
                'tf_alignment':      str(row.get('tf_alignment', '')).strip(),
                'event_types':       event_types,
            })
            seen_keys.add(key)

    print(f'  Events (vol spikes + big moves): {len(events)}')
    return events


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
        # Forex
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
        'MATIC-USD': 'Polygon',
        'DOT-USD':   'Polkadot',
        'LINK-USD':  'Chainlink',
        'UNI-USD':   'Uniswap',
        'LTC-USD':   'Litecoin',
        'ATOM-USD':  'Cosmos',
        'XLM-USD':   'Stellar',
        'ALGO-USD':  'Algorand',
        'NEAR-USD':  'NEAR Protocol',
        'FTM-USD':   'Fantom',
        'SAND-USD':  'The Sandbox',
        'MANA-USD':  'Decentraland',
        'APT-USD':   'Aptos',
        'ARB-USD':   'Arbitrum',
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

    instruments = load_instruments()
    tickers     = [inst['ticker'] for inst in instruments]
    result      = {}
    fetched     = 0

    for ticker in tickers:
        # 1. Hard override wins
        if ticker in OVERRIDES:
            result[ticker] = OVERRIDES[ticker]
            continue
        # 2. Cache hit
        if ticker in cache and cache[ticker]:
            result[ticker] = cache[ticker]
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
            result[ticker] = name
            fetched += 1
        except Exception as exc:
            print(f'    ✗ Name fetch failed for {ticker}: {exc}')
            cache[ticker] = ''
            result[ticker] = ''

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
    history_dir = os.path.join(output_dir, 'history')
    os.makedirs(history_dir, exist_ok=True)

    df, dt, fetched_at = load_latest_signals(src_dir=src_signals_dir)
    print(f'  Signals date: {dt}')
    print(f'  Data fetched: {fetched_at}')
    print(f'  Instruments:  {len(df)}')

    signals_data = {'date': dt, 'data': df.to_dict(orient='records')}
    with open(os.path.join(output_dir, 'signals.json'), 'w') as f:
        json.dump(signals_data, f, separators=(',', ':'))

    summary = build_summary(df, dt)
    summary['fetched_at'] = fetched_at
    with open(os.path.join(output_dir, 'summary.json'), 'w') as f:
        json.dump(summary, f, separators=(',', ':'))

    tv_map = build_tv_map()
    with open(os.path.join(output_dir, 'tv-map.json'), 'w') as f:
        json.dump(tv_map, f, separators=(',', ':'))

    ai_set = build_ai_set()
    with open(os.path.join(output_dir, 'ai-instruments.json'), 'w') as f:
        json.dump(ai_set, f, separators=(',', ':'))

    trends = load_latest_trends(dt, src_dir=src_signals_dir)
    with open(os.path.join(output_dir, 'trends.json'), 'w') as f:
        json.dump(trends, f, separators=(',', ':'))
    print(f'  Trend histories: {len(trends)}')

    explanations = generate_explanations(df)
    with open(os.path.join(output_dir, 'explanations.json'), 'w') as f:
        json.dump(explanations, f, separators=(',', ':'), ensure_ascii=False)

    events = build_events()
    with open(os.path.join(output_dir, 'events.json'), 'w') as f:
        json.dump({'generated': dt, 'events': events}, f, separators=(',', ':'))

    # Backtest results — copy if a recent backtest JSON exists
    bt_files = sorted(glob.glob(os.path.join(OUTPUT_DIR, 'backtest_*.json')))
    if bt_files:
        with open(bt_files[-1]) as f:
            bt = json.load(f)
        with open(os.path.join(output_dir, 'backtest.json'), 'w') as f:
            json.dump(bt, f, separators=(',', ':'))
        print(f'  Backtest report: {os.path.basename(bt_files[-1])}')
    else:
        print(f'  Backtest report: none found in {OUTPUT_DIR}')

    # Portfolio data — shared across profiles (XM account positions)
    # Look in current OUTPUT_DIR first, fall back to default output/ dir
    default_output = os.path.join(PROJECT_DIR, 'output')
    pf_candidates = [
        os.path.join(OUTPUT_DIR, 'portfolio.json'),
        os.path.join(default_output, 'portfolio.json'),
    ]
    for pf_src in pf_candidates:
        if os.path.exists(pf_src):
            shutil.copy2(pf_src, os.path.join(output_dir, 'portfolio.json'))
            print(f'  Portfolio: {pf_src}')
            break

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

    tm = get_ticker_map()
    ok = 0
    for name, ticker in tm.items():
        hist = build_history(name, ticker)
        if hist:
            safe_name = name.replace('/', '_')
            with open(os.path.join(history_dir, f'{safe_name}.json'), 'w') as f:
                json.dump(hist, f, separators=(',', ':'))
            ok += 1
    print(f'  History charts: {ok}/{len(tm)}')

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


def _r2_put_api(local_path, r2_key, api_token, account_id, timeout=120):
    """Upload via Cloudflare REST API (used in CI where API token is available)."""
    import urllib.request
    import urllib.error
    try:
        url = (
            f'https://api.cloudflare.com/client/v4/accounts/{account_id}'
            f'/r2/buckets/{R2_BUCKET}/objects/{r2_key}'
        )
        with open(local_path, 'rb') as fh:
            data = fh.read()
        req = urllib.request.Request(
            url, data=data, method='PUT',
            headers={
                'Authorization': f'Bearer {api_token}',
                'Content-Type':  'application/json',
                'Cache-Control': 'no-cache, max-age=0',
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(500).decode('utf-8', errors='replace')
            # Cloudflare returns 200 with {"success":true} on success
            if resp.status in (200, 201) and '"success":true' in body:
                return True, r2_key
            print(f'  [R2] WARN {r2_key}: HTTP {resp.status} — {body[:200]}', flush=True)
            return False, r2_key
    except urllib.error.HTTPError as exc:
        body = exc.read(300).decode('utf-8', errors='replace') if exc.fp else ''
        print(f'  [R2] HTTP {exc.code} {r2_key}: {body[:200]}', flush=True)
        return False, r2_key
    except Exception as exc:
        print(f'  [R2] ERROR {r2_key}: {exc}', flush=True)
        return False, r2_key


def _r2_put_wrangler(local_path, r2_key, timeout=120):
    """Upload via wrangler CLI (used locally with OAuth login)."""
    env = {**os.environ, 'PATH': '/usr/local/bin:' + os.environ.get('PATH', '')}
    wrangler = _wrangler_bin()
    cmd = [wrangler] if wrangler else ['npx', 'wrangler']
    # --remote needed in wrangler 4.x (defaults to local emulator without it)
    # wrangler 3.x accepts but ignores it (already remote by default)
    try:
        result = subprocess.run(
            cmd + ['r2', 'object', 'put',
                   f'{R2_BUCKET}/{r2_key}',
                   '--file', local_path,
                   '--content-type', 'application/json',
                   '--cache-control', 'no-cache, max-age=0',
                   '--remote'],
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
                           '--content-type', 'application/json',
                           '--cache-control', 'no-cache, max-age=0'],
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


def upload_to_r2(data_dir, max_workers=16, retries=2, r2_prefix=''):
    """Upload all files in data_dir to R2 using parallel workers with retry.

    r2_prefix — optional path prefix for all R2 keys (e.g. 'intraday').
    """
    def _key(fname):
        return f'{r2_prefix}/{fname}' if r2_prefix else fname

    files = []

    # Core data files
    for fname in ['signals.json', 'summary.json', 'tv-map.json', 'ai-instruments.json',
                  'trends.json', 'explanations.json', 'events.json', 'names.json',
                  'backtest.json', 'portfolio.json', 'flow_volumes.json']:
        p = os.path.join(data_dir, fname)
        if os.path.exists(p):
            files.append((p, _key(fname)))

    # History charts
    history_dir = os.path.join(data_dir, 'history')
    if os.path.exists(history_dir):
        for fname in os.listdir(history_dir):
            if fname.endswith('.json'):
                files.append((os.path.join(history_dir, fname), _key(f'history/{fname}')))

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

    # Copy index.html — patch profile badge and title
    with open(os.path.join(SCRIPT_DIR, 'templates', 'index.html')) as f:
        html = f.read()
    html = html.replace('PROFILE_BADGE', 'MA500')
    html = html.replace('<title>SwingPulse</title>', '<title>SwingPulse 500</title>')
    html = html.replace('content="SwingPulse"', 'content="SwingPulse 500"')
    html = html.replace('__APP_PROFILE__', 'ma500')
    # Patch Signal Types legend with correct MA periods for this profile
    html = html.replace('__SIG_LONGEST__', str(_longest_ma))
    html = html.replace('__SIG_SHORTEST__', str(_shortest_ma))
    with open(os.path.join(ui_dir, 'index.html'), 'w') as f:
        f.write(html)

    # Patch app.js: replace /api/* with R2 URLs
    app_js_path = os.path.join(static_dst, 'js', 'app.js')
    with open(app_js_path) as f:
        js = f.read()

    base = R2_BASE_URL.rstrip('/')   # profile-aware: R2_PUBLIC_URL or R2_PUBLIC_URL/ma200
    js = js.replace("'/api/signals'",      f"'{base}/signals.json'")
    js = js.replace("'/api/summary'",      f"'{base}/summary.json'")
    js = js.replace("'/api/tv-map'",          f"'{base}/tv-map.json'")
    js = js.replace("'/api/ai-instruments'",  f"'{base}/ai-instruments.json'")
    js = js.replace("'/api/trends'",       f"'{base}/trends.json'")
    js = js.replace("'/api/explanations'", f"'{base}/explanations.json'")
    js = js.replace("'/api/events'",       f"'{base}/events.json'")
    js = js.replace("'/api/names'",        f"'{base}/names.json'")
    js = js.replace("'/api/backtest'",     f"'{base}/backtest.json'")
    js = js.replace("'/api/portfolio?t='", f"'{base}/portfolio.json?t='")
    js = js.replace("'/api/flow'",         f"'{base}/flow_volumes.json'")
    js = js.replace(
        "'/api/history/' + encodeURIComponent(item.instrument_name)",
        f"'{base}/history/' + encodeURIComponent(item.instrument_name) + '.json'"
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
        cmd + ['pages', 'deploy', ui_dir, '--project-name', name],
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
