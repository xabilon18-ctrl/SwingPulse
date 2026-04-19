# Run Signal Generator

Run the full swing trading signal pipeline for today.

## What it does
1. Fetches market data for all 218+ instruments (uses cache if fresh)
2. Computes indicators + signals across all 4 timeframes (4H, Daily, Weekly, Monthly)
3. Writes signals CSV to `output/`
4. Automatically builds and deploys to Cloudflare Pages

## Usage
```
/run           → normal run, uses cached data if today's cache exists
/run --refresh → force re-download all data from Yahoo Finance
/run --date 2026-04-10 → backfill a specific past date
```

## Steps to execute

1. Kill any stale server processes:
```bash
lsof -ti:5050 | xargs kill -9 2>/dev/null; echo "port clear"
```

2. Run the generator with the arguments the user passed (or no args for normal run):
```bash
cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator" && python3 main.py $ARGUMENTS
```

3. Tail the output and report back:
   - How many instruments processed
   - Buy / Sell / Watch counts
   - Any errors or skipped instruments
   - Confirm deploy status at the end

4. Restart the local server so the dashboard reflects new data:
```bash
cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator" && python3 webapp/server.py &
```

5. Report the live URL: https://swingpulse.pages.dev
