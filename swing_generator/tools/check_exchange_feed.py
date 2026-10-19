"""Live check: every crypto pair answers from its exchange, at every timeframe.

Run by the deploy workflow before a release (it needs the network). A pair the
exchange does not know — a delisting, a rename the TradingView table missed —
fails the release instead of silently falling back to a stale cache.

    python3 tools/check_exchange_feed.py
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import exchange_feed                                   # noqa: E402
from instruments import load_instruments               # noqa: E402

# A short window per timeframe: enough to prove the pair and its bars exist.
# Asked with the pipeline's own defaults (a period, no end) and, at 5m, longer
# than one Coinbase window — an explicit end=now once hid a 400 that every real
# 5m Coinbase fetch hit (2026-10-19).
WINDOWS = {'1d': timedelta(days=10), '1h': timedelta(days=2), '5m': timedelta(days=2)}


def check(ticker):
    symbol = exchange_feed.source(ticker)
    end = datetime.now(timezone.utc)
    problems = []
    for interval, span in WINDOWS.items():
        try:
            df = exchange_feed.download(symbol, interval, period=f'{span.days}d')
            age = end - df.index[-1].to_pydatetime().replace(tzinfo=timezone.utc)
            if age > span:
                problems.append(f'{interval} last bar {age} old')
        except Exception as exc:
            problems.append(f'{interval} {exc}')
    return ticker, symbol, problems


def main():
    tickers = [i['ticker'] for i in load_instruments() if exchange_feed.source(i['ticker'])]
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(check, tickers))
    bad = [(t, s, p) for t, s, p in results if p]
    for ticker, symbol, problems in bad:
        print(f'  FAIL {symbol:<18} ({ticker}): {"; ".join(problems)}')
    print(f'Exchange feed: {len(results) - len(bad)}/{len(results)} crypto pairs answer at 1d, 1h and 5m')
    if bad:
        sys.exit(1)


if __name__ == '__main__':
    main()
