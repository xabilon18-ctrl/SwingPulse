"""Crypto prices from the exchanges the user's TradingView charts read.

User, 2026-10-19: the app's prices should match TradingView. For crypto
TradingView shows one exchange's own market — BINANCE:XRPUSDT, COINBASE:BTCUSD
(tv_symbols.py) — while Yahoo serves a blended USD price. So every crypto
download (Daily, 1H, 5m and the whole-history Weekly/Monthly pull) comes from
that exchange's public market data instead: free, no key, and theirs to give.

Hooked in at data_fetcher._full_download, the one place every price download
passes through, so the caches, the engine and the charts are unchanged; only
where the bars come from changes. Frames follow Yahoo's conventions: daily
bars on a tz-naive UTC date, intraday bars on tz-aware UTC instants, columns
Open/High/Low/Close/Volume with Volume in the QUOTE currency (USDT/USD, as
Yahoo's crypto volume is in USD).

Binance is read through data-api.binance.vision, its market-data-only host:
api.binance.com refuses US-located servers (HTTP 451 "restricted location"),
and the GitHub runners that publish are in Iowa — measured 2026-10-19.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import pandas as pd

BINANCE_URL = 'https://data-api.binance.vision/api/v3'
COINBASE_URL = 'https://api.exchange.coinbase.com'
BINANCE_LIMIT = 1000        # klines per request
COINBASE_LIMIT = 300        # candles per request
COINBASE_EPOCH = datetime(2015, 1, 1, tzinfo=timezone.utc)   # the exchange opened Jan 2015
COINBASE_PAUSE = 0.15       # public limit is ~10 requests/s per IP
BINANCE_INTERVAL = {'1d': '1d', '1h': '1h', '5m': '5m'}
COINBASE_GRANULARITY = {'1d': 86400, '1h': 3600, '5m': 300}

_sources: dict[str, str] | None = None


def source(ticker: str) -> str | None:
    """'BINANCE:XRPUSDT' / 'COINBASE:BTCUSD' for a crypto ticker, else None.

    Read from the TradingView table so the price source and the user's chart
    can never disagree — including renamed coins (MATIC is BINANCE:POLUSDT,
    FTM is BINANCE:SUSDT). Retired instruments are included: their caches
    still exist and must not mix sources if they come back.
    """
    global _sources
    if _sources is None:
        from instruments import load_instruments
        from tv_symbols import TV_BY_NAME
        found = {}
        for inst in load_instruments(include_retired=True):
            tv = TV_BY_NAME.get(inst['name'], '')
            if inst.get('group') == 'Crypto' and tv.startswith(('BINANCE:', 'COINBASE:')):
                found[inst['ticker']] = tv
        _sources = found
    return _sources.get(ticker)


def coinbase_product(symbol: str) -> str:
    """COINBASE:BTCUSD -> BTC-USD, the exchange's own product id."""
    pair = symbol.split(':', 1)[1]
    return pair[:-3] + '-' + pair[-3:]


def _get(url: str, attempts: int = 4):
    """GET JSON, retrying rate limits and server errors with backoff."""
    request = urllib.request.Request(url, headers={'User-Agent': 'SwingPulse/1.0',
                                                   'Accept': 'application/json'})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            if exc.code not in (418, 429, 500, 502, 503, 504) or attempt == attempts - 1:
                raise ValueError(f'HTTP {exc.code} from {url.split("?")[0]}') from exc
            wait = float(exc.headers.get('Retry-After') or 2 ** attempt)
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == attempts - 1:
                raise ValueError(f'{type(exc).__name__} from {url.split("?")[0]}') from exc
            wait = 2 ** attempt
        time.sleep(min(wait, 30))
    return None


def _utc(value) -> datetime | None:
    if value is None:
        return None
    ts = pd.Timestamp(value)
    ts = ts.tz_localize('UTC') if ts.tzinfo is None else ts.tz_convert('UTC')
    return ts.to_pydatetime()


def _frame(rows: list[tuple], interval: str) -> pd.DataFrame:
    """[(open_ms, o, h, l, c, quote_volume)] -> a Yahoo-shaped frame."""
    cols = ['Open', 'High', 'Low', 'Close', 'Volume']
    if not rows:
        return pd.DataFrame(columns=cols, dtype=float)
    df = pd.DataFrame(rows, columns=['t', *cols]).drop_duplicates('t', keep='last').sort_values('t')
    index = pd.DatetimeIndex(pd.to_datetime(df.pop('t').to_numpy(), unit='ms', utc=True))
    df.index = index.tz_localize(None).normalize() if interval == '1d' else index
    df.index.name = 'date'   # as data_fetcher._normalise names the Yahoo frames
    return df.astype(float)


def _binance(pair: str, interval: str, start: datetime | None, end: datetime) -> list[tuple]:
    cursor = int(start.timestamp() * 1000) if start else 0
    stop = int(end.timestamp() * 1000)
    rows = []
    while cursor < stop:
        batch = _get(f'{BINANCE_URL}/klines?symbol={pair}&interval={BINANCE_INTERVAL[interval]}'
                     f'&startTime={cursor}&endTime={stop}&limit={BINANCE_LIMIT}') or []
        # [open time, open, high, low, close, base volume, close time, QUOTE volume, ...]
        rows += [(k[0], k[1], k[2], k[3], k[4], k[7]) for k in batch]
        if len(batch) < BINANCE_LIMIT:
            break
        cursor = batch[-1][0] + 1
    return rows


def _coinbase(product: str, interval: str, start: datetime | None, end: datetime) -> list[tuple]:
    step = COINBASE_GRANULARITY[interval]
    window = timedelta(seconds=step * COINBASE_LIMIT)
    cursor = max(start or COINBASE_EPOCH, COINBASE_EPOCH)
    # Coinbase answers HTTP 400 to a window that starts in the future, and the
    # default end is tomorrow: at 5m a window is only 25 hours, so the last one
    # of a 60-day pull (or of any hourly top-up) began after now (2026-10-19).
    end = min(end, datetime.now(timezone.utc))
    rows = []
    while cursor < end:
        upto = min(cursor + window, end)
        batch = _get(f'{COINBASE_URL}/products/{product}/candles?granularity={step}'
                     f'&start={cursor.isoformat()}&end={upto.isoformat()}') or []
        # [time (s), low, high, open, close, BASE volume] — newest first
        rows += [(int(c[0]) * 1000, c[3], c[2], c[1], c[4], float(c[5]) * float(c[4])) for c in batch]
        cursor = upto
        time.sleep(COINBASE_PAUSE)
    return rows


def download(symbol: str, interval: str, start=None, end=None, period: str | None = None) -> pd.DataFrame:
    """Bars for 'BINANCE:XRPUSDT' / 'COINBASE:BTCUSD' between start and end.

    `period` mirrors Yahoo's: 'max' for the whole history, '60d' for the last
    60 days; it replaces start. Naive datetimes are taken as UTC. Raises when
    the exchange returns nothing, like the Yahoo path does.
    """
    if interval not in BINANCE_INTERVAL:
        raise ValueError(f'unsupported interval {interval!r} for {symbol}')
    end = _utc(end) or datetime.now(timezone.utc) + timedelta(days=1)
    start = _utc(start)
    if period == 'max':
        start = None
    elif period:
        start = end - timedelta(days=int(period.rstrip('d')))
    venue, pair = symbol.split(':', 1)
    if venue == 'BINANCE':
        rows = _binance(pair, interval, start, end)
    elif venue == 'COINBASE':
        rows = _coinbase(coinbase_product(symbol), interval, start, end)
    else:
        raise ValueError(f'no exchange feed for {symbol}')
    df = _frame(rows, interval)
    if df.empty:
        raise ValueError(f'empty response from {symbol}')
    return df
