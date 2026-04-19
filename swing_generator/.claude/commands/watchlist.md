# Show Watchlist

Display all instruments currently flagged — watches, squeezes, high-confidence signals, and key level touches.

## Usage
```
/watchlist              → show all flags
/watchlist squeeze      → only squeeze/compression alerts
/watchlist buy          → only buy signals
/watchlist sell         → only sell signals
/watchlist high         → only high-confidence signals
/watchlist aligned      → Triple Bull or Aligned Bull only
```

## Steps to execute

```bash
cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator" && python3 - << 'EOF'
import glob, pandas as pd

files = sorted(glob.glob('output/signals_*.csv'))
if not files:
    print("No signals file. Run /run first.")
    exit()

df = pd.read_csv(files[-1]).fillna('')

print(f"\nSwingPulse Watchlist  —  {files[-1][-14:-4]}\n")

# Active signals (buy/sell)
signals = df[df['primary_signal'] != ''].sort_values('signal_confidence', ascending=True)
if not signals.empty:
    print(f"  ── ACTIVE SIGNALS ({len(signals)}) ──────────────────────────────")
    for _, r in signals.iterrows():
        direction = '▲ BUY ' if 'buy' in str(r['confirmation_status']).lower() else '▼ SELL'
        conf = r.get('signal_confidence', '')
        stars = {'high': '★★★', 'standard': '★★☆', 'low': '★☆☆'}.get(conf, '   ')
        align = r.get('tf_alignment', '')
        print(f"  {direction}  {r['instrument_name']:<15}  {r['primary_signal']:<5}  {stars}  <{align}>")
    print()

# Watch flags
watches = df[df['watch_flag'] != '']
if not watches.empty:
    print(f"  ── APPROACHING KEY LEVELS ({len(watches)}) ──────────────────────")
    for _, r in watches.iterrows():
        print(f"  👁  {r['instrument_name']:<15}  {r['watch_flag']}")
    print()

# Squeezes
squeezes = df[df['ribbon_compression'] == 'yes'].sort_values('ma_order_score', ascending=False)
if not squeezes.empty:
    print(f"  ── RIBBON SQUEEZE ({len(squeezes)}) ─────────────────────────────")
    for _, r in squeezes.iterrows():
        spread = r.get('ribbon_spread', '')
        order = r.get('ma_order_score', '')
        trend = r.get('trend_direction', '')
        print(f"  ⚡  {r['instrument_name']:<15}  spread:{spread}%  order:{order}/16  {trend}")
    print()

# Key level touches today
touches = df[df['key_level_touched_today'] == 'yes']
if not touches.empty:
    print(f"  ── KEY LEVEL TOUCHES TODAY ({len(touches)}) ─────────────────────")
    for _, r in touches.iterrows():
        lvl = r.get('key_level_price', '')
        lvl_type = r.get('key_level_type', '')
        print(f"  🎯  {r['instrument_name']:<15}  {lvl_type} @ {lvl}")
    print()

# Turning points
turning = df[df['potential_turning_point_flag'] != '']
if not turning.empty:
    print(f"  ── POTENTIAL TURNING POINTS ({len(turning)}) ────────────────────")
    for _, r in turning.iterrows():
        print(f"  ↩  {r['instrument_name']:<15}  {r['potential_turning_point_flag']}")
    print()
EOF
```

Present the output cleanly. If a filter was specified (e.g. `/watchlist squeeze`), apply it by only showing that section.
