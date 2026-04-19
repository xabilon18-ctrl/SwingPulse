# Add New Instrument

Add a new instrument to the watchlist and verify it works end-to-end.

## Usage
```
/add-instrument NAME TICKER GROUP
```
Example:
```
/add-instrument COPPER HG=F Commodities
/add-instrument TSMC TSM Technology
```

## Parameters
- **NAME** — display name used in the app (e.g. COPPER, TSMC)
- **TICKER** — Yahoo Finance ticker symbol (e.g. HG=F, TSM, BTC-USD)
- **GROUP** — category group (Commodities, Crypto, Indices, Stocks, Forex)

## Steps to execute

1. Read the instruments file to see the current format:
```bash
tail -5 "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/220_Instruments.txt"
```

2. Add the new instrument line in the correct format (match existing entries).

3. Test that data fetches successfully:
```bash
cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator" && python3 - << 'EOF'
from data_fetcher import fetch, fetch_hourly
ticker = "TICKER_HERE"
df = fetch(ticker, force_refresh=True)
if df is not None and len(df) > 200:
    print(f"OK: {len(df)} daily bars, latest close: {df['Close'].iloc[-1]:.4f}")
else:
    print(f"PROBLEM: only {len(df) if df is not None else 0} bars — check the ticker symbol")
EOF
```

4. If data is good, confirm the instrument was added and tell the user to run `/run --refresh` to include it in the next signal generation.

## Notes
- Yahoo Finance tickers: stocks use plain symbol (AAPL), forex use =X suffix (EURUSD=X), futures use =F (GC=F for Gold)
- After adding, run `/run` to generate signals for the new instrument
- To add TradingView mapping, update `_TV_BY_NAME` in `webapp/server.py`
