# Signal Status Report

Show a full summary of the current signal state without re-running anything.

## What it does
Reads the latest signals CSV and prints a rich breakdown:
- Signal counts by type and timeframe
- Timeframe alignment distribution
- Squeeze / compression alerts
- High-confidence setups
- Any instruments with active primary signals

## Steps to execute

Run this Python snippet against the latest signals file:

```bash
cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator" && python3 - << 'EOF'
import glob, os, pandas as pd

files = sorted(glob.glob('output/signals_*.csv'))
if not files:
    print("No signals file found. Run /run first.")
    exit()

df = pd.read_csv(files[-1]).fillna('')
date = os.path.basename(files[-1]).replace('signals_','').replace('.csv','')

print(f"\n{'='*55}")
print(f"  SwingPulse Signal Status  —  {date}")
print(f"{'='*55}")
print(f"\n  Total instruments: {len(df)}")

# Trend breakdown
print("\n  TREND (Daily):")
for t, c in df['trend_direction'].value_counts().items():
    bar = '█' * (c // 5)
    print(f"    {t:<12}  {c:>3}  {bar}")

# Signals
buy = df['confirmation_status'].str.contains('buy', case=False, na=False).sum()
sell = df['confirmation_status'].str.contains('sell', case=False, na=False).sum()
watch = (df['watch_flag'] != '').sum()
print(f"\n  SIGNALS:  Buy {buy}  |  Sell {sell}  |  Watch {watch}")

# Confidence
print("\n  CONFIDENCE:")
for c, n in df['signal_confidence'].value_counts().items():
    if c: print(f"    {c:<10}  {n}")

# Alignment
print("\n  TF ALIGNMENT:")
for a, n in df['tf_alignment'].value_counts().items():
    print(f"    {a:<18}  {n}")

# Squeeze
sq = (df['ribbon_compression'] == 'yes').sum()
print(f"\n  SQUEEZE ALERTS:  {sq} instruments compressed")

# Primary signals
primaries = df[df['primary_signal'] != ''][['instrument_name','primary_signal','signal_confidence','tf_alignment','confirmation_status']]
if not primaries.empty:
    print(f"\n  PRIMARY SIGNALS ({len(primaries)}):")
    for _, r in primaries.iterrows():
        print(f"    {r['instrument_name']:<15}  {r['primary_signal']:<5}  [{r['signal_confidence']:<8}]  <{r['tf_alignment']}>")

print(f"\n{'='*55}\n")
EOF
```

Report the output clearly to the user.
