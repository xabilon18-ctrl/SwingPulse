# Refresh Market Data

Force re-download all market data from Yahoo Finance without re-running the full signal pipeline.

## When to use this
- Cache is stale / corrupted for specific instruments
- You've added new instruments to `220_Instruments.txt`
- Data looks wrong for a specific ticker
- After a long weekend / market holiday

## Usage
```
/refresh-data              → refresh all instruments
/refresh-data GOLD         → refresh a single instrument by display name
/refresh-data GOLD BTCUSD  → refresh specific instruments
```

## Steps to execute

For full refresh:
```bash
cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator" && python3 - << 'EOF'
from data_fetcher import fetch_all, fetch_all_hourly
from instruments import load_instruments
instruments = load_instruments()
print(f"Refreshing {len(instruments)} instruments (daily)...")
data = fetch_all(instruments, force_refresh=True)
print(f"Daily: {len(data)} instruments fetched")
print("Refreshing hourly data (for 4H timeframe)...")
hourly = fetch_all_hourly(instruments, force_refresh=True)
print(f"Hourly: {len(hourly)} instruments fetched")
print("Done. Run /run to generate new signals.")
EOF
```

For a specific instrument (replace TICKER with the Yahoo Finance ticker, e.g. GC=F for GOLD):
```bash
cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator" && python3 - << 'EOF'
from data_fetcher import fetch, fetch_hourly
ticker = "GC=F"  # replace as needed
df = fetch(ticker, force_refresh=True)
print(f"Daily: {len(df)} bars" if df is not None else "Daily: FAILED")
hdf = fetch_hourly(ticker, force_refresh=True)
print(f"Hourly: {len(hdf)} bars" if hdf is not None else "Hourly: FAILED")
EOF
```

Report how many instruments refreshed successfully vs failed.
