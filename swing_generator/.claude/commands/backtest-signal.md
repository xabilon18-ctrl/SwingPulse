# Backtest a Signal

Check how a specific signal type has performed historically across instruments.

## Usage
```
/backtest-signal P1          → check all P1 (trend continuation) signals
/backtest-signal P2          → check all P2 (200 MA bounce) signals  
/backtest-signal P3          → check P3 (small MA bounce in uptrend)
/backtest-signal GOLD        → check all historical signals for one instrument
/backtest-signal P1 UPTREND  → filter by signal type + trend
```

## Steps to execute

Run the backtest analysis:

```bash
cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator" && python3 - << 'EOF'
import glob, os, pandas as pd

# Load all available signal files
files = sorted(glob.glob('output/signals_*.csv'))
if not files:
    print("No signal files found.")
    exit()

all_dfs = []
for f in files:
    df = pd.read_csv(f).fillna('')
    df['_file_date'] = os.path.basename(f).replace('signals_','').replace('.csv','')
    all_dfs.append(df)

combined = pd.concat(all_dfs, ignore_index=True)
print(f"Loaded {len(files)} signal files ({len(combined)} rows total)")
print(f"Date range: {files[0][-14:-4]} → {files[-1][-14:-4]}")
print()

# Signal frequency by type
print("SIGNAL FREQUENCY:")
sig_counts = combined[combined['primary_signal'] != '']['primary_signal'].value_counts()
for sig, cnt in sig_counts.items():
    print(f"  {sig:<6}  {cnt:>4} occurrences")

print()

# Confidence breakdown
print("CONFIDENCE BREAKDOWN:")
conf_sig = combined[combined['primary_signal'] != ''].groupby(['primary_signal','signal_confidence']).size().unstack(fill_value=0)
print(conf_sig.to_string())

print()

# TF alignment at signal time
print("ALIGNMENT WHEN SIGNAL FIRES:")
align_sig = combined[combined['primary_signal'] != ''].groupby(['primary_signal','tf_alignment']).size().unstack(fill_value=0)
print(align_sig.to_string())
EOF
```

Present the findings in a clean, readable format. Highlight which signals fire most often under Triple Bull / Aligned Bull alignment (highest quality setups).
