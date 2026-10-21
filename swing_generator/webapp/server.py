"""
SwingPulse — Interactive trading signal dashboard.

Run:
    cd swing_generator/webapp
    python server.py

Then open http://localhost:5050
"""

from __future__ import annotations

import glob
import gzip
import json
import os
import sys
from datetime import datetime

import pandas as pd
from flask import Flask, jsonify, render_template, request, send_file

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)
OUTPUT_DIR = os.path.join(PARENT_DIR, 'output_ma500')
CACHE_DIR  = os.path.join(PARENT_DIR, 'cache_ma500')

# Allow importing config from parent package
sys.path.insert(0, PARENT_DIR)

from _active_config import MA_PERIODS  # MA50–MA500 (active profile ribbon: 50, 250, 500)

sys.path.insert(0, BASE_DIR)
import chart_feed          # compact OHLC + ribbon bundles for the Charts reel

app = Flask(__name__, static_folder='static', template_folder='templates')
app.config['TEMPLATES_AUTO_RELOAD'] = True

# ---------------------------------------------------------------------------
# Instrument name→ticker mapping
# ---------------------------------------------------------------------------

def _load_ticker_map() -> dict[str, str]:
    """Build a display-name → ticker mapping from the instruments file."""
    from instruments import load_instruments
    return {inst['name']: inst['ticker'] for inst in load_instruments()}


_ticker_map: dict[str, str] | None = None


def get_ticker_map() -> dict[str, str]:
    global _ticker_map
    if _ticker_map is None:
        _ticker_map = _load_ticker_map()
    return _ticker_map


# Display-name → TradingView symbol overrides live in tv_symbols.py (the
# data layer reads them too: exchange_feed.py takes crypto prices from them).
from tv_symbols import TV_BY_NAME as _TV_BY_NAME  # noqa: E402

# NYSE stocks that appear under different ticker in TV
_NYSE_SET = {
    'BA','CVX','IBM','JPM','AXP','CRM','GS','KO','PG','HD','V','DOW',
    'TRV','DIS','CAT','NKE','JNJ','VZ','MCD','MRK','MMM','UNH','WMT','BUD',
}

# ---------------------------------------------------------------------------
# Artificial Intelligence universe — instruments with material AI exposure
# Add new names here; they get picked up automatically by the app.
# ---------------------------------------------------------------------------
_AI_INSTRUMENTS: set[str] = {
    # ── AI Chips & Fabless Silicon ──
    'NVDA',   # NVIDIA — dominant AI GPU
    'AMD',    # AI GPUs & CPUs
    'AVGO',   # Broadcom — AI networking ASICs
    'ARM',    # ARM Holdings — AI chip architecture
    'MRVL',   # Marvell — AI networking chips
    'INTC',   # Intel — Gaudi AI accelerators
    'ON',     # ON Semiconductor — AI edge chips
    'QCOM',   # Qualcomm — edge AI / NPUs
    'NXPI',   # NXP — automotive AI silicon
    'STM',    # STMicroelectronics — edge AI
    'MPWR',   # Monolithic Power Systems — AI power delivery
    'AMBA',   # Ambarella — AI edge vision chips

    # ── AI Server & Data-Centre Hardware ──
    'SMCI',   # Super Micro Computer — AI server racks
    'DELL',   # Dell — AI server infrastructure
    'ANET',   # Arista Networks — AI data-centre networking
    'CSCO',   # Cisco — AI networking
    'IBM',    # IBM — Watson AI / Granite models

    # ── Chip Design Tools (EDA) ──
    'CDNS',   # Cadence Design Systems
    'SNPS',   # Synopsys

    # ── Semiconductor Equipment (AI supply chain) ──
    'ASML',       # ASML — EUV lithography, essential for AI chips
    'AMAT',       # Applied Materials — wafer processing
    'LRCX',       # Lam Research — etch & deposition
    'KLAC',       # KLA Corporation — chip inspection
    'ENTG',       # Entegris — semiconductor materials
    'TOKYOELEC',  # Tokyo Electron — semiconductor equipment
    'BESI',       # BE Semiconductor — advanced AI chip packaging (AEX)
    'TER',        # Teradyne — chip testing equipment

    # ── AI Mega-caps & Cloud AI Platforms ──
    'MSFT',   # Microsoft — Azure AI, OpenAI partnership
    'GOOGL',  # Alphabet — Gemini, DeepMind
    'GOOG',   # Alphabet Class C
    'META',   # Meta — Llama, AI research
    'AMZN',   # Amazon — AWS Bedrock, Trainium
    'TSLA',   # Tesla — FSD, Dojo, Optimus robot
    'AAPL',   # Apple — Apple Intelligence, CoreML

    # ── AI Data, Analytics & Observability ──
    'PLTR',   # Palantir — AI analytics & AIP
    'SNOW',   # Snowflake — AI data platform
    'DDOG',   # Datadog — AI observability
    'NET',    # Cloudflare — Workers AI / edge inference

    # ── AI Enterprise Software ──
    'CRM',    # Salesforce — Einstein AI
    'NOW',    # ServiceNow — Now Assist AI
    'WDAY',   # Workday — AI HR & Finance
    'INTU',   # Intuit — AI fintech (Intuit Assist)
    'ADBE',   # Adobe — Firefly AI creative
    'ORCL',   # Oracle — AI database / OCI
    'SAP_DE', # SAP — Joule AI copilot

    # ── AI Cybersecurity ──
    'CRWD',   # CrowdStrike — AI endpoint security
    'PANW',   # Palo Alto Networks — AI SASE
    'ZS',     # Zscaler — AI zero-trust
    'APP',    # AppLovin — AI ad optimisation engine

    # ── AI Robotics & Industrial Automation ──
    'SOFTBANK',  # SoftBank — AI Vision Fund, ARM owner
    'KEYENCE',   # Keyence — AI machine vision & sensors
    'FANUC',     # Fanuc — AI robotics & CNC

    # ── AI Industrial / Enterprise (Europe) ──
    'SIE',    # Siemens — Industrial AI & digital twin
    'IFX',    # Infineon — AI automotive & industrial chips
    'CAP_FR', # Capgemini — AI consulting & transformation
    'DSY',    # Dassault Systèmes — AI simulation & PLM
    'ERICB',  # Ericsson — AI-enabled 5G networks

    # ── AI Data & Analytics (UK/Europe) ──
    'EXPN',   # Experian — AI credit & data analytics
    'RELX',   # RELX — AI legal & scientific analytics
    'LSEG',   # London Stock Exchange Group — AI market data
}


def build_ai_set() -> list[str]:
    """Return sorted list of AI-flagged instrument names."""
    return sorted(_AI_INSTRUMENTS)


def build_tv_map() -> dict[str, str]:
    """Return display-name → TradingView symbol mapping.

    Priority:
      1. Explicit _TV_BY_NAME override (indices, crypto, NYSE, commodities)
      2. German stocks (.DE tickers)  → XETR:name
      3. Forex (=X tickers)           → FX:name
      4. Remaining US stocks           → NASDAQ:name (or name alone)
    """
    tm = get_ticker_map()           # {display_name: yahoo_ticker}
    result: dict[str, str] = {}

    for name, yf_ticker in tm.items():
        # 1. Exact override
        if name in _TV_BY_NAME:
            result[name] = _TV_BY_NAME[name]
            continue

        # 2. German stocks: *.DE → XETR:name
        #    Strip _DE suffix from display names (e.g. SAP_DE → XETR:SAP)
        if yf_ticker.endswith('.DE'):
            tv_sym = name[:-3] if name.endswith('_DE') else name
            result[name] = f'XETR:{tv_sym}'
            continue

        # 2b. Spanish stocks: *.MC → BME:name
        if yf_ticker.endswith('.MC'):
            result[name] = f'BME:{name}'
            continue

        # 2c. Canadian stocks: *.TO → TSX:name
        if yf_ticker.endswith('.TO'):
            result[name] = f'TSX:{name}'
            continue

        # 2d. UK stocks: *.L → LSE:name  (strip _UK suffix if present)
        if yf_ticker.endswith('.L'):
            tv_sym = name[:-3] if name.endswith('_UK') else name
            result[name] = f'LSE:{tv_sym}'
            continue

        # 2e. French stocks: *.PA → EURONEXT:name  (strip _FR suffix if present)
        if yf_ticker.endswith('.PA'):
            tv_sym = name[:-3] if name.endswith('_FR') else name
            result[name] = f'EURONEXT:{tv_sym}'
            continue

        # 2f. Italian stocks: *.MI → MIL:name  (strip _IT suffix if present)
        if yf_ticker.endswith('.MI'):
            tv_sym = name[:-3] if name.endswith('_IT') else name
            result[name] = f'MIL:{tv_sym}'
            continue

        # 2g. Dutch stocks: *.AS → EURONEXT:name  (strip _NL suffix if present)
        if yf_ticker.endswith('.AS'):
            tv_sym = name[:-3] if name.endswith('_NL') else name
            result[name] = f'EURONEXT:{tv_sym}'
            continue

        # 2h. Swiss stocks: *.SW → SIX:name  (strip _SW suffix if present)
        if yf_ticker.endswith('.SW'):
            tv_sym = name[:-3] if name.endswith('_SW') else name
            result[name] = f'SIX:{tv_sym}'
            continue

        # 2i. Australian stocks: *.AX → ASX:name  (strip _AX suffix if present)
        if yf_ticker.endswith('.AX'):
            tv_sym = name[:-3] if name.endswith('_AX') else name
            result[name] = f'ASX:{tv_sym}'
            continue

        # 2j. Japanese stocks: *.T → TSE:name
        if yf_ticker.endswith('.T'):
            result[name] = f'TSE:{name}'
            continue

        # 2k. South African stocks: *.JO → JSE:name  (strip _ZA suffix if present)
        if yf_ticker.endswith('.JO'):
            tv_sym = name[:-3] if name.endswith('_ZA') else name
            result[name] = f'JSE:{tv_sym}'
            continue

        # 2l. Swedish stocks: *.ST → STO:name
        if yf_ticker.endswith('.ST'):
            result[name] = f'STO:{name}'
            continue

        # 2m. Norwegian stocks: *.OL → OSL:name
        if yf_ticker.endswith('.OL'):
            result[name] = f'OSL:{name}'
            continue

        # 2n. Danish stocks: *.CO → CPH:name
        if yf_ticker.endswith('.CO'):
            result[name] = f'CPH:{name}'
            continue

        # 3. Forex pairs: *=X → FX:name
        if yf_ticker.endswith('=X'):
            result[name] = f'FX:{name}'
            continue

        # 4. Remaining US stocks — default to NASDAQ (NYSE ones are in _TV_BY_NAME)
        result[name] = f'NASDAQ:{name}'

    return result


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

_data_cache: dict = {}


def _ticker_to_filename(ticker: str) -> str:
    """Convert ticker symbol to parquet cache filename."""
    safe = (ticker
            .replace('=', '_EQ_')
            .replace('^', '_IDX_')
            .replace('.', '_DOT_'))
    return f'{safe}.parquet'


def load_latest_signals() -> tuple[pd.DataFrame, str]:
    """Load the most recent signals CSV."""
    files = sorted(glob.glob(os.path.join(OUTPUT_DIR, 'signals_*.csv')))
    if not files:
        return pd.DataFrame(), ''
    latest = files[-1]
    date_str = os.path.basename(latest).replace('signals_', '').replace('.csv', '')
    df = pd.read_csv(latest).fillna('')
    return df, date_str


def get_signals():
    """Cached signal data."""
    if 'signals' not in _data_cache:
        df, dt = load_latest_signals()
        _data_cache['signals'] = df
        _data_cache['date'] = dt
    return _data_cache['signals'], _data_cache['date']


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route('/')
def index():
    # Patch the same template tokens publish.py patches for production, so
    # local dev doesn't show literal PROFILE_BADGE / __APP_PROFILE__ strings.
    html = render_template('index.html')
    html = html.replace('PROFILE_BADGE', 'MA500')
    html = html.replace('__APP_PROFILE__', 'ma500')
    html = html.replace('__SIG_SHORTEST__', str(min(MA_PERIODS)))
    html = html.replace('__SIG_LONGEST__', str(max(MA_PERIODS)))
    html = html.replace('__SIG_MID__', str(sorted(MA_PERIODS)[len(MA_PERIODS) // 2]))
    return html


@app.route('/sw.js')
def service_worker():
    return app.send_static_file('sw.js'), 200, {
        'Content-Type': 'application/javascript',
        'Service-Worker-Allowed': '/',
    }


@app.route('/api/signals')
def api_signals():
    df, dt = get_signals()
    return jsonify({'date': dt, 'data': df.to_dict(orient='records')})


@app.route('/api/status')
def api_status():
    """Pipeline health, mirroring the status.json publish.py writes to R2 (the
    CI failure step flips it to state:'failed'). Local dev has no CI, so a run
    that produced a signals file is reported ok."""
    df, dt = get_signals()
    if df.empty:
        return jsonify({'state': 'unknown'})
    return jsonify({'state': 'ok', 'at': None, 'date': str(dt)})


@app.route('/api/summary')
def api_summary():
    df, dt = get_signals()
    if df.empty:
        return jsonify({})

    try:
        trend_counts = df['trend_direction'].value_counts().to_dict() if 'trend_direction' in df.columns else {}

        # Signal codes are B1/B4 (buy) / S1/S4 (sell)
        sigs      = df['primary_signal'].fillna('').astype(str) if 'primary_signal' in df.columns else pd.Series('', index=df.index)
        buy_mask  = sigs.str.startswith('B')
        sell_mask = sigs.str.startswith('S')

        signal_types = df['primary_signal'].value_counts().to_dict() if 'primary_signal' in df.columns else {}
        signal_types.pop('', None)

        groups = sorted([g for g in df['group'].unique().tolist() if g]) if 'group' in df.columns else []

        # Coverage — kept identical to publish.py build_summary() so local dev
        # and the published payload never disagree about what's missing.
        try:
            from instruments import load_instruments
            expected  = load_instruments()
            published = set(df['instrument_name'].astype(str))
            missing   = sorted(i['name'] for i in expected if i['name'] not in published)
        except Exception:
            expected, missing = [], []
        from instruments import load_retired
        retired = [r.get('name', r.get('ticker')) for r in load_retired().get('instruments', [])
                   if isinstance(r, dict)]

        return jsonify({
            'date': dt,
            'total': len(df),
            'expected': len(expected),
            'missing_count': len(missing),
            'missing': missing[:50],
            'retired': retired,
            'trend_counts': trend_counts,
            'buy_count': int(buy_mask.sum()),
            'sell_count': int(sell_mask.sum()),
            'volume_spikes': int((df['volume_spike_flag'] == 'yes').sum()) if 'volume_spike_flag' in df.columns else 0,
            'key_level_touches': int((df['key_level_touched_today'] == 'yes').sum()) if 'key_level_touched_today' in df.columns else 0,
            'signal_types': signal_types,
            'groups': groups,
            'fetched_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
        })
    except Exception as e:
        app.logger.error(f'api_summary error: {e}')
        return jsonify({'date': dt, 'total': len(df), 'error': str(e)})


@app.route('/api/ticker-map')
def api_ticker_map():
    """Return the display-name → ticker mapping so the frontend can resolve chart requests."""
    return jsonify(get_ticker_map())


@app.route('/api/tv-map')
def api_tv_map():
    """Return display-name → TradingView symbol mapping."""
    return jsonify(build_tv_map())


@app.route('/api/ai-instruments')
def api_ai_instruments():
    """Return sorted list of AI-flagged instrument names."""
    return jsonify(build_ai_set())


# ---------------------------------------------------------------------------
# Chart reel feed
# ---------------------------------------------------------------------------
# Production serves these as static files from R2 (built by chart_feed.py during
# publish). Locally we build each chunk on demand and memoise it, so the reel
# shows whatever is in the parquet cache right now without a publish first.

_chart_chunk_cache: dict = {}

# ONE table — the route's timeframe whitelist reads this, it does not restate it.
_CHART_BUILDERS = {
    '10m': chart_feed.build_10m_live,
    '15m': chart_feed.build_15m,
    '30m': chart_feed.build_30m,
    '1H': chart_feed.build_1h,
    '4H': chart_feed.build_4h_live,
    '2H': chart_feed.build_2h,
    '12H': chart_feed.build_12h,
    'D':  chart_feed.build_daily,
    # From the Daily cache, always fresh. The published ones come from the whole
    # Yahoo history on their own schedule (tools/publish_htf.py).
    'W':  chart_feed.build_weekly,
    'M':  chart_feed.build_monthly,
}


def _chart_chunk_map() -> dict:
    """name -> chunk id, using the same sorted-name rule as the published feed."""
    names = sorted(get_ticker_map())
    return {n: i // chart_feed.CHUNK_SIZE for i, n in enumerate(names)}


@app.route('/api/chart-index')
def api_chart_index():
    return jsonify({
        'chunk_size': chart_feed.CHUNK_SIZE,
        'bars': chart_feed.BARS,
        'chunks': _chart_chunk_map(),
        'near': _near_map_local(),
    })


_near_cache: dict = {}


def _near_map_local() -> dict:
    """Local dev only: the published index gets `near` from build_chart_feed.
    Built once per server run (every Daily bundle, ~1 min), then cached."""
    if 'v' not in _near_cache:
        tm = get_ticker_map()
        daily = {}
        for name, tk in tm.items():
            try:
                bd = chart_feed.build_daily(CACHE_DIR, tk)
            except Exception:
                bd = None
            if bd:
                daily[name] = bd
        _near_cache['v'] = chart_feed.near_ma_map(daily)
    return _near_cache['v']


@app.route('/api/chart/<tf>/index')
def api_chart_tf_index(tf: str):
    # Weekly and Monthly read their own index (chart/<tf>/index.json when
    # published); locally it is the same sorted-name grouping as everything else.
    return jsonify({'tf': tf, 'chunk_size': chart_feed.CHUNK_SIZE, 'chunks': _chart_chunk_map()})


@app.route('/api/chart/<tf>/<int:cid>')
def api_chart_chunk(tf: str, cid: int):
    # Keyed off the builder table below rather than a hand-copied tuple — the
    # two used to be separate lists and 3D was added to one of them, which is
    # how the reel got a 400 and drew "No chart data" for every instrument.
    if tf not in _CHART_BUILDERS:
        return jsonify({'error': 'bad timeframe'}), 400

    key = (tf, cid)
    if key in _chart_chunk_cache:
        return jsonify(_chart_chunk_cache[key])

    tm      = get_ticker_map()
    members = [n for n, c in _chart_chunk_map().items() if c == cid]
    builder = _CHART_BUILDERS[tf]

    data = {}
    for name in members:
        try:
            payload = builder(CACHE_DIR, tm[name])
        except Exception:
            payload = None       # one bad parquet must not empty the chunk
        if payload:
            data[name] = payload

    # B1/S1 + Daily-MA markers on the intraday charts, as the publisher puts
    # them (chart_feed._attach_15m_marks) — so the dev server shows them too.
    if tf in ('15m', '30m', '1H', '4H'):
        try:
            fp = os.path.join(OUTPUT_DIR, {'15m': 'm15_fires.json', '30m': 'm30_fires.json', '1H': 'h1_fires.json',
                                           '4H': 'h4_fires.json'}[tf])
            fires = json.load(open(fp)) if os.path.exists(fp) else {}
            for name, b in data.items():
                bd = chart_feed.build_daily(CACHE_DIR, tm[name])
                chart_feed._attach_15m_marks(b, bd, fires.get(name),
                                             hold=chart_feed.XM_HOLD_BY_TF[tf])
        except Exception:
            pass

    # Per-timeframe depth, matching what build_chart_feed writes into the
    # published chunk. It was the flat BARS here and BARS_BY_TF there, so the
    # dev server described every chunk as 520 bars while serving 1300.
    out = {'tf': tf, 'bars': chart_feed.BARS_BY_TF.get(tf, chart_feed.BARS), 'data': data}
    _chart_chunk_cache[key] = out
    return jsonify(out)


@app.route('/api/quotes')
def api_quotes():
    """Latest price + previous close per instrument (Watchlist tab)."""
    return jsonify(chart_feed.build_quotes(CACHE_DIR, get_ticker_map()))


@app.route('/api/trends')
def api_trends():
    """Return trend segment history for all instruments."""
    import json as _json
    # Load from the latest trends JSON generated by main.py
    trend_files = sorted(glob.glob(os.path.join(OUTPUT_DIR, 'trends_*.json')))
    if not trend_files:
        return jsonify({})
    with open(trend_files[-1]) as f:
        return jsonify(_json.load(f))


@app.route('/api/ledger')
def api_ledger():
    """Return the live signal-ledger summary written by signal_ledger.py."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, 'ledger_summary.json')
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/names')
def api_names():
    """Return {display_name: full company name} built by publish.py build_names().
    Reads the file the last publish wrote; empty until a publish has run."""
    import json as _json
    path = os.path.join(os.path.dirname(__file__), 'publish', 'data_ma500', 'names.json')
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/shape-similarity')
def api_shape_similarity():
    """Chart lookalikes + families, written by shape_similarity.py.

    Served gzipped from R2 in production; here the file on disk is gzip too, so
    read it back through gzip rather than json.load on a text handle.
    """
    path = os.path.join(OUTPUT_DIR, 'shape_similarity.json')
    if not os.path.exists(path):
        return jsonify({'neighbours': {}, 'families': [], 'family_of': {}})
    try:
        with gzip.open(path, 'rt') as fh:
            return jsonify(json.load(fh))
    except OSError:
        with open(path) as fh:          # tolerate an un-gzipped local build
            return jsonify(json.load(fh))


_alerts_memo: dict = {}


@app.route('/api/alerts')
def api_alerts():
    """Alerts tab feed — built from the local chart bundles on demand (slow:
    every bundle of every instrument; memoised for the server's life)."""
    import alerts_feed
    if 'v' in _alerts_memo:
        return jsonify(_alerts_memo['v'])
    # The last publish's file, when there is one — building from every bundle
    # takes minutes.
    pub = os.path.join(BASE_DIR, 'publish', 'data_ma500', 'alerts.json')
    if os.path.exists(pub):
        with open(pub, 'rb') as fh:
            raw = fh.read()
        if raw[:2] == b'\x1f\x8b':
            raw = gzip.decompress(raw)
        return app.response_class(raw, mimetype='application/json')
    tm = get_ticker_map()
    built = {}
    for tf in ('15m', '30m', '1H', '4H', 'D'):
        built[tf] = {}
        for name, t in tm.items():
            try:
                b = _CHART_BUILDERS[tf](CACHE_DIR, t)
            except Exception:
                b = None
            if b:
                built[tf][name] = b
    def _load(f):
        p = os.path.join(OUTPUT_DIR, f)
        return json.load(open(p)) if os.path.exists(p) else {}
    for tf, fires in (('15m', _load('m15_fires.json')), ('30m', _load('m30_fires.json')), ('1H', _load('h1_fires.json')),
                      ('4H', _load('h4_fires.json'))):
        for name, b in built[tf].items():
            chart_feed._attach_15m_marks(b, built['D'].get(name), fires.get(name),
                                         hold=chart_feed.XM_HOLD_BY_TF[tf])
    out = alerts_feed.build_alerts(built, _load('d_fires.json'))
    _alerts_memo['v'] = out
    return jsonify(out)


@app.route('/api/market')
def api_market():
    import market_feed
    return jsonify(market_feed.build_market(get_ticker_map()))


@app.route('/api/trend-channels')
def api_trend_channels():
    """The user's trend read per instrument (channel_rule), written by the chart feed."""
    import json as _json, gzip as _gz
    path = os.path.join(OUTPUT_DIR, 'trend_channels.json')
    if not os.path.exists(path):
        return jsonify({})
    raw = open(path, 'rb').read()
    if raw[:2] == b'\x1f\x8b':
        raw = _gz.decompress(raw)
    return jsonify(_json.loads(raw))


@app.route('/api/rotation')
def api_rotation():
    """Sector rotation wheel + market ranking, written by rotation.py."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, 'rotation.json')
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/rotation-paper')
def api_rotation_paper():
    """The market ranking's forward paper record, written by rotation.py."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, 'rotation_paper.json')
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/sector-radar')
def api_sector_radar():
    """Sector activity radar summary written by sector_activity.py (Daily only
    since 2026-09-24)."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, 'sector_radar.json')
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/sector-activity')
def api_sector_activity():
    """Per-day sector activity series — powers the radar info modal sparkline.
    572K, so the frontend lazy-loads it on first info-button tap, never at boot."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, 'sector_activity.json')
    if not os.path.exists(path):
        return jsonify(None)
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/instrument-flavours')
def api_instrument_flavours():
    """Per-instrument sector-mood map (provisional conviction layer)."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, 'instrument_flavours.json')
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/backtest')
def api_backtest():
    """Return the latest backtest results generated by backtest.py."""
    import json as _json
    bt_files = sorted(glob.glob(os.path.join(OUTPUT_DIR, 'backtest_*.json')))
    if not bt_files:
        return jsonify({})
    with open(bt_files[-1]) as f:
        return jsonify(_json.load(f))


@app.route('/api/explanations')
def api_explanations():
    """Return pre-generated AI signal explanations."""
    import json as _json
    path = os.path.join(OUTPUT_DIR, 'explanations.json')
    if not os.path.exists(path):
        return jsonify({})
    with open(path) as f:
        return jsonify(_json.load(f))


@app.route('/api/flow')
def api_flow():
    """Aggregate index volume by region for the Flow tab."""
    group  = request.args.get('group',  'Indices')
    region = request.args.get('region', 'All')
    days   = min(int(request.args.get('days', 252)), 500)

    flow_path = os.path.join(OUTPUT_DIR, 'flow_volumes.csv')
    if not os.path.exists(flow_path):
        return jsonify({'group': group, 'region': region, 'data': [], 'stats': {}})

    try:
        df = pd.read_csv(flow_path)
        df = df[(df['group'] == group) & (df['region'] == region)].copy()
        df = df.sort_values('date').tail(days).reset_index(drop=True)
        df['total_volume'] = pd.to_numeric(df['total_volume'], errors='coerce').fillna(0)

        data = [
            {'date': row['date'], 'volume': int(row['total_volume']),
             'instrument_count': int(row.get('instrument_count', 0))}
            for _, row in df.iterrows()
        ]

        vols = [d['volume'] for d in data if d['volume'] > 0]
        recent = [d['volume'] for d in data[-30:] if d['volume'] > 0]
        stats = {
            'current':     data[-1]['volume'] if data else 0,
            'avg_30d':     round(sum(recent) / len(recent)) if recent else 0,
            'window_high': max(vols) if vols else 0,
            'window_low':  min(vols) if vols else 0,
            'mean':        round(sum(vols) / len(vols)) if vols else 0,
        }
        return jsonify({'group': group, 'region': region, 'data': data, 'stats': stats})
    except Exception as e:
        app.logger.error(f'api_flow error: {e}')
        return jsonify({'group': group, 'region': region, 'data': [], 'stats': {}, 'error': str(e)})


@app.route('/api/refresh', methods=['POST'])
def api_refresh():
    """Clear data cache so next request loads fresh CSV."""
    _data_cache.clear()
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    print('\n  SwingPulse Dashboard')
    print('  http://localhost:5050\n')
    app.run(debug=False, host='0.0.0.0', port=5050)
