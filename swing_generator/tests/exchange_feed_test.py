"""Crypto prices from the exchanges (exchange_feed.py), offline.

The exchanges' replies are canned here; what is checked is that their bars
reach the caches shaped like Yahoo's, that every crypto instrument reads the
pair its TradingView chart shows, that nothing else changes source, and that a
Yahoo cache is replaced — never topped up — the first time a coin moves.
"""
import os
import re
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / 'webapp')]
import data_fetcher
import exchange_feed
from instruments import load_instruments
from tv_symbols import TV_BY_NAME

DAY = 86_400_000
T0 = 1_500_000_000_000 - 1_500_000_000_000 % DAY      # a UTC midnight in 2017


def kline(t, close):
    # [open time, open, high, low, close, base vol, close time, QUOTE vol, ...]
    return [t, str(close - 1), str(close + 2), str(close - 2), str(close), '10', t + DAY - 1,
            str(close * 10), 5, '1', '1', '0']


class SourceTests(unittest.TestCase):
    def test_every_crypto_reads_its_tradingview_pair(self):
        crypto = [i for i in load_instruments(include_retired=True) if i.get('group') == 'Crypto']
        self.assertGreater(len(crypto), 50)
        for inst in crypto:
            self.assertEqual(exchange_feed.source(inst['ticker']), TV_BY_NAME[inst['name']], inst['name'])
        # Renamed coins follow the chart, not the old name.
        self.assertEqual(exchange_feed.source('POL28321-USD'), 'BINANCE:POLUSDT')
        self.assertEqual(exchange_feed.source('BTC-USD'), 'COINBASE:BTCUSD')

    def test_nothing_else_changes_source(self):
        for ticker in ('AAPL', '^GSPC', 'EURUSD=X', 'GC=F', 'COIN', 'CCY_USD'):
            self.assertIsNone(exchange_feed.source(ticker), ticker)

    def test_coinbase_product(self):
        self.assertEqual(exchange_feed.coinbase_product('COINBASE:LINKUSD'), 'LINK-USD')


class DownloadTests(unittest.TestCase):
    def test_binance_daily_pages_and_matches_yahoo_shape(self):
        pages = [[kline(T0 + i * DAY, 100 + i) for i in range(1000)],
                 [kline(T0 + (1000 + i) * DAY, 1100 + i) for i in range(5)]]
        urls = []
        def fake(url, attempts=4):
            urls.append(url)
            return pages[len(urls) - 1]
        with patch.object(exchange_feed, '_get', side_effect=fake):
            df = exchange_feed.download('BINANCE:XRPUSDT', '1d', period='max')
        self.assertEqual(len(urls), 2)
        self.assertIn('data-api.binance.vision', urls[0])
        self.assertIn('startTime=0', urls[0])
        self.assertIn(f'startTime={T0 + 999 * DAY + 1}', urls[1])
        self.assertEqual(list(df.columns), ['Open', 'High', 'Low', 'Close', 'Volume'])
        self.assertEqual(len(df), 1005)
        self.assertIsNone(df.index.tz)                       # daily: a plain UTC date
        self.assertTrue((df.index == df.index.normalize()).all())
        self.assertEqual(df['Close'].iloc[0], 100.0)
        self.assertEqual(df['Volume'].iloc[0], 1000.0)       # quote (USDT) volume
        self.assertEqual(df.index.name, 'date')

    def test_binance_intraday_is_utc(self):
        rows = [kline(T0 + i * 3_600_000, 50) for i in range(3)]
        with patch.object(exchange_feed, '_get', return_value=rows):
            df = exchange_feed.download('BINANCE:SOLUSDT', '1h', start=pd.Timestamp(T0, unit='ms'),
                                        end=pd.Timestamp(T0 + DAY, unit='ms'))
        self.assertEqual(str(df.index.tz), 'UTC')
        self.assertEqual(df.index[1] - df.index[0], pd.Timedelta(hours=1))

    def test_coinbase_windows_order_and_quote_volume(self):
        calls = []
        def fake(url, attempts=4):
            calls.append(url)
            t = len(calls) * 86400 + T0 // 1000
            # newest first, [time, low, high, open, close, base volume]
            return [[t + 3600, 9, 12, 10, 11, 2], [t, 8, 11, 9, 10, 3]]
        with patch.object(exchange_feed, '_get', side_effect=fake), \
             patch.object(exchange_feed.time, 'sleep'):
            df = exchange_feed.download('COINBASE:BTCUSD', '1h', start=pd.Timestamp(T0, unit='ms'),
                                        end=pd.Timestamp(T0, unit='ms') + pd.Timedelta(days=20))
        self.assertEqual(len(calls), 2)                      # 300 hours a request
        self.assertIn('/products/BTC-USD/candles?granularity=3600', calls[0])
        self.assertTrue(df.index.is_monotonic_increasing)
        first = df.iloc[0]
        self.assertEqual((first['Open'], first['High'], first['Low'], first['Close']), (9, 11, 8, 10))
        self.assertEqual(first['Volume'], 30)                # 3 BTC at 10 = 30 USD

    def test_coinbase_never_asks_for_the_future(self):
        # The default end is tomorrow; Coinbase answers 400 to a window that
        # starts after now, which every 60-day 5m pull used to send.
        calls = []
        def fake(url, attempts=4):
            calls.append(url)
            return [[int(time.time()) - 600, 8, 11, 9, 10, 3]]
        with patch.object(exchange_feed, '_get', side_effect=fake), \
             patch.object(exchange_feed.time, 'sleep'):
            exchange_feed.download('COINBASE:BTCUSD', '5m', period='60d')
        now = pd.Timestamp.now(tz='UTC')
        starts = [pd.Timestamp(re.search(r'start=([^&]+)', u).group(1)) for u in calls]
        ends = [pd.Timestamp(re.search(r'end=([^&]+)', u).group(1)) for u in calls]
        self.assertTrue(all(s < now for s in starts), max(starts))
        self.assertLessEqual(max(ends), now)
        self.assertEqual(len(calls), 57)                     # 59 days up to now, 25 hours a window

    def test_empty_reply_raises_like_yahoo(self):
        with patch.object(exchange_feed, '_get', return_value=[]):
            with self.assertRaises(ValueError):
                exchange_feed.download('BINANCE:XRPUSDT', '1d', period='60d')


class RoutingTests(unittest.TestCase):
    def test_full_download_routes_crypto_only(self):
        bars = pd.DataFrame({'Open': [1.0], 'High': [1.0], 'Low': [1.0], 'Close': [1.0], 'Volume': [1.0]},
                            index=pd.DatetimeIndex(['2026-10-01'], name='date'))
        with patch.object(exchange_feed, 'download', return_value=bars) as ex, \
             patch.object(data_fetcher.yf, 'Ticker') as yahoo:
            data_fetcher._full_download('XRP-USD', None, None, interval='5m', period='60d')
        ex.assert_called_once()
        self.assertEqual(ex.call_args.args[:2], ('BINANCE:XRPUSDT', '5m'))
        self.assertEqual(ex.call_args.args[4], '60d')
        yahoo.assert_not_called()

    def test_yahoo_cache_is_replaced_once_never_topped_up(self):
        old = pd.DataFrame({'Open': [5.0] * 3, 'High': [5.0] * 3, 'Low': [5.0] * 3, 'Close': [5.0] * 3,
                            'Volume': [1.0] * 3},
                           index=pd.DatetimeIndex(pd.date_range('2026-09-01', periods=3), name='date'))
        new = old.copy() * 2
        new.index = pd.DatetimeIndex(pd.date_range('2026-08-01', periods=3), name='date')
        with tempfile.TemporaryDirectory() as cache, \
             patch.object(data_fetcher, 'CACHE_DIR', cache), \
             patch.object(data_fetcher, '_full_download', return_value=new) as full:
            path = data_fetcher._cache_path('XRP-USD')
            old.to_parquet(path)                              # a Yahoo cache, no .source file
            got = data_fetcher.fetch('XRP-USD')
            self.assertEqual(len(got), 3)
            self.assertTrue((got['Close'] == 10.0).all(), 'the Yahoo bars are gone, not mixed in')
            self.assertEqual(Path(path + '.source').read_text(), 'BINANCE:XRPUSDT')
            self.assertEqual(full.call_count, 1)
            self.assertFalse(data_fetcher._cache_source_changed(path, 'XRP-USD'))

    def test_other_caches_are_left_alone(self):
        with tempfile.TemporaryDirectory() as cache, patch.object(data_fetcher, 'CACHE_DIR', cache):
            path = data_fetcher._cache_path('AAPL')
            pd.DataFrame({'Close': [1.0]}).to_parquet(path)
            self.assertFalse(data_fetcher._cache_source_changed(path, 'AAPL'))
            self.assertFalse(os.path.exists(path + '.source'))


if __name__ == '__main__':
    unittest.main()
