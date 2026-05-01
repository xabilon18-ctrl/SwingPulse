# Check Instrument

Deep-dive into a single instrument — show all timeframes, signals, MA positions, and ribbon state.

## Usage
```
/check-instrument GOLD
/check-instrument BTCUSD
/check-instrument NVDA
```

## Steps to execute

```bash
cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator" && python3 - << 'PYEOF'
import glob, os, pandas as pd, sys

name = "INSTRUMENT_NAME_HERE"  # replaced by the user's argument

files = sorted(glob.glob('output/signals_*.csv'))
if not files:
    print("No signals file. Run /run first.")
    sys.exit()

df = pd.read_csv(files[-1]).fillna('')
row = df[df['instrument_name'].str.upper() == name.upper()]
if row.empty:
    print(f"'{name}' not found. Available: {sorted(df['instrument_name'].tolist())[:10]} ...")
    sys.exit()

r = row.iloc[0]

def fmt(v, label):
    return f"  {label:<28}  {v}" if v else ""

print(f"\n{'='*58}")
print(f"  {r['instrument_name']}  |  {r.get('group','')}  |  {r.get('sector','')}")
print(f"{'='*58}")

print(f"\n  ── DAILY ──────────────────────────────────────")
print(fmt(r.get('date'), 'Date'))
print(fmt(r.get('close'), 'Close'))
print(fmt(r.get('trend_direction'), 'Trend'))
print(fmt(r.get('established_trend'), 'Established Trend'))
print(fmt(r.get('trend_run_days'), 'Trend Run (days)'))
print(fmt(r.get('confirmation_status'), 'Signal Status'))
print(fmt(r.get('primary_signal'), 'Primary Signal'))
print(fmt(r.get('signal_confidence'), 'Confidence'))
print(fmt(r.get('watch_flag'), 'Watch Flag'))
print(fmt(r.get('ribbon_spread'), 'Ribbon Spread %'))
print(fmt(r.get('ribbon_compression'), 'Squeeze'))
print(fmt(r.get('ma_order_score'), 'MA Order Score'))
print(fmt(r.get('roc'), 'ROC (5-bar %)'))

for tf, label in [('w_', 'WEEKLY'), ('m_', 'MONTHLY'), ('h4_', '4-HOUR')]:
    close = r.get(f'{tf}close')
    if close:
        print(f"\n  ── {label} ──────────────────────────────────────")
        print(fmt(r.get(f'{tf}close'), 'Close'))
        print(fmt(r.get(f'{tf}trend_direction'), 'Trend'))
        print(fmt(r.get(f'{tf}confirmation_status'), 'Signal Status'))
        print(fmt(r.get(f'{tf}primary_signal'), 'Primary Signal'))
        print(fmt(r.get(f'{tf}signal_confidence'), 'Confidence'))
        print(fmt(r.get(f'{tf}ribbon_compression'), 'Squeeze'))
        print(fmt(r.get(f'{tf}roc'), 'ROC'))

print(f"\n  ── ALIGNMENT ───────────────────────────────────")
print(fmt(r.get('tf_alignment'), 'TF Alignment'))
print(fmt(r.get('tf_alignment_score'), 'Alignment Score'))
print(fmt(r.get('key_level_price'), 'Nearest Key Level'))
print(fmt(r.get('key_level_touched_today'), 'Key Level Touch Today'))
print(f"\n{'='*58}\n")
PYEOF
```

Replace `INSTRUMENT_NAME_HERE` with the instrument name the user gave, then run and present the output clearly.
