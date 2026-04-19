# Cache Info

Show the state of the local data cache — which instruments have data, how fresh it is, and how many bars each has.

## Usage
```
/cache-info           → full cache report
/cache-info stale     → show only instruments with stale/missing data
/cache-info GOLD      → check a single instrument's cache
```

## Steps to execute

```bash
cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator" && python3 - << 'EOF'
import os, glob, pandas as pd
from datetime import datetime, timedelta

cache_dir = 'cache'
files = sorted(glob.glob(os.path.join(cache_dir, '*.parquet')))

print(f"\nCache directory: {cache_dir}/")
print(f"Total files: {len(files)}\n")

today = datetime.today().date()
stale = []
ok = []
missing_bars = []

for f in files:
    name = os.path.basename(f)
    mtime = datetime.fromtimestamp(os.path.getmtime(f)).date()
    age_days = (today - mtime).days
    try:
        df = pd.read_parquet(f)
        bars = len(df)
        latest = str(df.index[-1].date()) if len(df) else 'empty'
        status = 'STALE' if age_days > 3 else 'OK'
        if bars < 500:
            missing_bars.append((name, bars, latest))
        if status == 'STALE':
            stale.append((name, bars, latest, age_days))
        else:
            ok.append((name, bars, latest, age_days))
    except Exception as e:
        stale.append((name, 0, 'ERROR: ' + str(e), age_days))

print(f"  OK (fresh):     {len(ok)}")
print(f"  Stale (>3 days): {len(stale)}")
print(f"  Low bar count (<500): {len(missing_bars)}")

if stale:
    print(f"\n  STALE CACHE:")
    for name, bars, latest, age in stale[:20]:
        print(f"    {name:<35}  {bars:>5} bars  latest:{latest}  age:{age}d")

if missing_bars:
    print(f"\n  LOW BAR COUNT (may affect monthly signals):")
    for name, bars, latest in missing_bars:
        print(f"    {name:<35}  {bars:>5} bars  latest:{latest}")

print(f"\n  Run '/run --refresh' to update all stale data.\n")
EOF
```

Present a clean summary. Emphasise if many instruments are stale since it means monthly signals may be missing.
