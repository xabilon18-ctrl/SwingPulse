# Start Local Dev Server

Start (or restart) the local SwingPulse dashboard at http://localhost:5050

## What it does
- Kills any existing process on port 5050
- Starts the Flask server fresh
- Confirms the server is responding

## Steps to execute

1. Kill any existing process on port 5050:
```bash
lsof -ti:5050 | xargs kill -9 2>/dev/null; sleep 1; echo "port cleared"
```

2. Start the server:
```bash
cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator" && python3 webapp/server.py &
```

3. Wait 2 seconds then verify it's up:
```bash
sleep 2 && curl -s http://localhost:5050/api/summary | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Server up | Date: {d.get(\"date\",\"?\")} | Buy: {d.get(\"buy_count\",0)} | Sell: {d.get(\"sell_count\",0)} | Total: {d.get(\"total\",0)}')"
```

4. Report the local URL: http://localhost:5050

## Notes
- The server reads from the latest `output/signals_*.csv` on each request (cached in memory)
- If data looks stale, use `/run` to regenerate signals
- Use `/status` to check signal counts without restarting anything
