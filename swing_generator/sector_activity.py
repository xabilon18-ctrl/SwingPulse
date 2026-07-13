"""
Sector activity series — the data half of the Sector Activity Radar.

Per trading day per radar sector (see instruments.radar_sector_of) we record:
    buys       – # NEW daily-TF B-code fires on that bar
    sells      – # NEW daily-TF S-code fires on that bar
    vol_spikes – # instruments with RVOL >= VOL_SPIKE_RVOL on that bar
    members    – sector universe size at record time
    rate       – (buys + sells + vol_spikes) / members

Only the DAILY timeframe counts: the backfill recomputes history from the
parquet cache with the exact production engine, and 4H history only exists
for ~2 years of hourly cache — mixing TFs would bend the baseline.

Anomaly stats (computed on read, not stored):
    z = (rate − mean of trailing BASELINE_DAYS rates) / max(std, 0.5/members)
    hot = z >= Z_ALERT; elevated_days = consecutive hot days ending today.
The std floor is half of one member's worth of rate — a 20-run flat stretch
can't turn a single ordinary fire into a fake 10-sigma event.

Persistence: R2 is the source of truth (CI checkouts are ephemeral). Same
merge + clobber-guard pattern as signal_ledger.py.

CLI:
    python3 sector_activity.py --backfill   # seed history from parquet cache
    python3 sector_activity.py --report     # print current radar table
"""

import json
import os
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import pandas as pd

from _active_config import OUTPUT_DIR, MA_PERIODS, VOLUME_LOOKBACK
from instruments import load_instruments, radar_sector_of

ACTIVITY_PATH = os.path.join(OUTPUT_DIR, 'sector_activity.json')
RADAR_PATH    = os.path.join(OUTPUT_DIR, 'sector_radar.json')
# Public R2 data prefix — keep in sync with R2_BASE_URL in webapp/publish.py
R2_ACTIVITY_URL = ('https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev'
                   '/ma500/sector_activity.json')

CODES          = {'B1', 'B2', 'B3', 'B4', 'S1', 'S2', 'S3', 'S4'}
VOL_SPIKE_RVOL = 2.0     # volume >= 2x its 25d average = a volume event
BASELINE_DAYS  = 20      # trailing window for mean/std of rate
MIN_BASELINE   = 10      # need at least this many trailing rows to score z
Z_ALERT        = 1.5     # hot threshold (UI display-gates harder: z>=2 or 2 days)
MIN_MEMBERS    = 8       # sectors below this are logged but never flagged hot
RETAIN_DAYS    = 400     # rows kept per sector


def _now() -> str:
    return datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')


def _sector_maps() -> tuple[dict, dict]:
    """(instrument name -> sector, sector -> member count)."""
    name_to_sector, members = {}, {}
    for inst in load_instruments():
        s = radar_sector_of(inst)
        name_to_sector[inst['name']] = s
        members[s] = members.get(s, 0) + 1
    return name_to_sector, members


# ---------------------------------------------------------------------------
# Load / save (R2-merged, clobber-guarded — see signal_ledger.load_ledger)
# ---------------------------------------------------------------------------
def load_activity() -> tuple[dict, bool]:
    """Rows keyed 'date|sector'. Local wins on conflict (it is always the
    fresher computation). Returns (rows, safe_to_save)."""
    remote, local = {}, {}
    remote_ok = False
    url = f'{R2_ACTIVITY_URL}?t={int(datetime.utcnow().timestamp())}'
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'})
            with urllib.request.urlopen(req, timeout=20) as r:
                remote = {f"{row['date']}|{row['sector']}": row
                          for row in json.load(r).get('rows', [])}
            remote_ok = True
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:          # first-ever run
                remote_ok = True
                break
            import time; time.sleep(2 * (attempt + 1))
        except Exception:
            import time; time.sleep(2 * (attempt + 1))

    local_ok = False
    try:
        with open(ACTIVITY_PATH) as f:
            local = {f"{row['date']}|{row['sector']}": row
                     for row in json.load(f).get('rows', [])}
        local_ok = True
    except Exception:
        pass

    merged = dict(remote)
    merged.update(local)
    return merged, (remote_ok or local_ok)


def save_activity(rows: dict) -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    # prune to RETAIN_DAYS most-recent rows per sector
    by_sector: dict = {}
    for row in rows.values():
        by_sector.setdefault(row['sector'], []).append(row)
    kept = []
    for recs in by_sector.values():
        recs.sort(key=lambda r: r['date'])
        kept.extend(recs[-RETAIN_DAYS:])
    kept.sort(key=lambda r: (r['date'], r['sector']))
    with open(ACTIVITY_PATH, 'w') as f:
        json.dump({'updated_at': _now(), 'rows': kept}, f, separators=(',', ':'))


# ---------------------------------------------------------------------------
# Live update from the pipeline's output frame
# ---------------------------------------------------------------------------
def _num(v):
    try:
        x = float(str(v).replace(',', ''))
        return x if x == x else 0.0     # NaN -> 0
    except (TypeError, ValueError):
        return 0.0


def update_from_output(rows: dict, output_df: pd.DataFrame) -> int:
    """Recompute today's (bar-date, sector) rows from the freshly generated
    output. Fully replaces those keys — a later run the same day is more
    complete, never less. Returns #rows upserted."""
    name_to_sector, members = _sector_maps()
    agg: dict = {}
    for _, r in output_df.iterrows():
        row = r.to_dict()
        sector = name_to_sector.get(str(row.get('instrument_name') or ''))
        bar_date = str(row.get('date') or '').strip()
        if not sector or not bar_date or bar_date.lower() == 'nan':
            continue
        a = agg.setdefault((bar_date, sector),
                           {'buys': 0, 'sells': 0, 'vol_spikes': 0})
        code = str(row.get('primary_signal') or '').strip()
        if code in CODES:
            a['buys' if code.startswith('B') else 'sells'] += 1
        vol, avg = _num(row.get('volume')), _num(row.get('volume_average'))
        if avg > 0 and vol / avg >= VOL_SPIKE_RVOL:
            a['vol_spikes'] += 1

    for (bar_date, sector), a in agg.items():
        m = members.get(sector, 0)
        rows[f'{bar_date}|{sector}'] = {
            'date': bar_date, 'sector': sector, 'members': m,
            'buys': a['buys'], 'sells': a['sells'], 'vol_spikes': a['vol_spikes'],
            'rate': round((a['buys'] + a['sells'] + a['vol_spikes']) / m, 5) if m else 0,
        }
    return len(agg)


# ---------------------------------------------------------------------------
# Radar summary (small file the frontend fetches)
# ---------------------------------------------------------------------------
def _z_series(rates: list, members: int) -> list:
    """z per row vs its own trailing BASELINE_DAYS window (None until warm)."""
    zs = []
    floor = 0.5 / members if members else 1.0
    for i in range(len(rates)):
        base = rates[max(0, i - BASELINE_DAYS):i]
        if len(base) < MIN_BASELINE:
            zs.append(None)
            continue
        mean = sum(base) / len(base)
        var = sum((x - mean) ** 2 for x in base) / len(base)
        std = max(var ** 0.5, floor)
        zs.append((rates[i] - mean) / std)
    return zs


def _tilt(buys: int, sells: int) -> str:
    total = buys + sells
    if total == 0:
        return 'none'
    if buys / total >= 0.65:
        return 'buy'
    if sells / total >= 0.65:
        return 'sell'
    return 'mixed'


def compute_radar(rows: dict) -> dict:
    by_sector: dict = {}
    for row in rows.values():
        by_sector.setdefault(row['sector'], []).append(row)

    sectors = []
    for sector, recs in sorted(by_sector.items()):
        recs.sort(key=lambda r: r['date'])
        latest = recs[-1]
        members = latest.get('members', 0)
        zs = _z_series([r['rate'] for r in recs], members)
        z = zs[-1]
        eligible = members >= MIN_MEMBERS
        hot = bool(eligible and z is not None and z >= Z_ALERT)
        elevated = 0
        for zi, ri in zip(reversed(zs), reversed(recs)):
            if eligible and zi is not None and zi >= Z_ALERT:
                elevated += 1
            else:
                break
        base = [r['rate'] for r in recs[-(BASELINE_DAYS + 1):-1]]
        sectors.append({
            'sector':        sector,
            'date':          latest['date'],
            'members':       members,
            'buys':          latest['buys'],
            'sells':         latest['sells'],
            'vol_spikes':    latest['vol_spikes'],
            'rate':          latest['rate'],
            'mean_rate':     round(sum(base) / len(base), 5) if base else None,
            'z':             round(z, 2) if z is not None else None,
            'hot':           hot,
            'elevated_days': elevated,
            'tilt':          _tilt(latest['buys'], latest['sells']),
            'history_days':  len(recs),
        })

    return {
        'generated_at':  _now(),
        'baseline_days': BASELINE_DAYS,
        'alert_z':       Z_ALERT,
        'min_members':   MIN_MEMBERS,
        'sectors':       sectors,
    }


def write_radar(rows: dict) -> dict:
    radar = compute_radar(rows)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(RADAR_PATH, 'w') as f:
        json.dump(radar, f, separators=(',', ':'))
    return radar


# ---------------------------------------------------------------------------
# Pipeline entry point
# ---------------------------------------------------------------------------
def update_sector_activity(output_df: pd.DataFrame) -> None:
    """Called by main.py after signals are computed. Must never break the run."""
    try:
        rows, safe = load_activity()
        if not safe:
            print('  Sector activity: SKIPPED — could not load existing series '
                  '(saving would clobber it)')
            return
        upserted = update_from_output(rows, output_df)
        save_activity(rows)
        radar = write_radar(rows)
        hot = [s for s in radar['sectors'] if s['hot']]
        label = ', '.join(f"{s['sector']} z={s['z']}" for s in hot) or 'all quiet'
        print(f'  Sector activity: {upserted} sector-day rows upserted — {label}')
    except Exception as exc:
        print(f'  Sector activity: skipped ({exc})')


# ---------------------------------------------------------------------------
# Backfill — recompute history from the parquet cache with the real engine
# ---------------------------------------------------------------------------
def _backfill_instrument(inst: dict, cutoff: str) -> list:
    """[(date, sector, kind)] events for one instrument; kind in B/S/V."""
    from backtest import TF_SIGNAL_PARAMS
    from data_fetcher import _cache_path
    from indicators import add_all_indicators
    from signals import add_signals

    path = _cache_path(inst['ticker'])
    if not os.path.exists(path):
        return []
    df = pd.read_parquet(path)
    if len(df) < 250:
        return []
    df = add_all_indicators(df)
    d_ma_periods = [p for p in MA_PERIODS if p <= len(df)]
    if len(d_ma_periods) >= 3:
        df = add_signals(df, ma_periods=d_ma_periods, **TF_SIGNAL_PARAMS['D'])
    else:
        return []

    sector = radar_sector_of(inst)
    vol_avg = df['Volume'].rolling(VOLUME_LOOKBACK, min_periods=1).mean()
    sig = df['primary_signal'].to_numpy()
    events = []
    for i in range(len(df)):
        d = str(df.index[i].date())
        if d < cutoff:
            continue
        code = sig[i]
        if code in CODES:
            events.append((d, sector, 'B' if code.startswith('B') else 'S'))
        v, a = float(df['Volume'].iloc[i]), float(vol_avg.iloc[i])
        if a > 0 and v / a >= VOL_SPIKE_RVOL:
            events.append((d, sector, 'V'))
    return events


def backfill() -> None:
    insts = load_instruments()
    _, members = _sector_maps()
    cutoff = str((pd.Timestamp.utcnow().tz_localize(None)
                  - pd.Timedelta(days=int(RETAIN_DAYS * 1.6))).date())
    print(f'Backfilling sector activity since {cutoff} '
          f'({len(insts)} instruments, daily TF, production-parity engine)...')

    all_events = []
    done = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for events in pool.map(lambda i: _backfill_instrument(i, cutoff), insts):
            all_events.extend(events)
            done += 1
            if done % 100 == 0:
                print(f'  {done}/{len(insts)} instruments...')

    agg: dict = {}
    for d, sector, kind in all_events:
        a = agg.setdefault((d, sector), {'B': 0, 'S': 0, 'V': 0})
        a[kind] += 1

    rows, _ = load_activity()
    for (d, sector), a in agg.items():
        m = members.get(sector, 0)
        rows[f'{d}|{sector}'] = {
            'date': d, 'sector': sector, 'members': m,
            'buys': a['B'], 'sells': a['S'], 'vol_spikes': a['V'],
            'rate': round((a['B'] + a['S'] + a['V']) / m, 5) if m else 0,
        }
    save_activity(rows)
    radar = write_radar(rows)
    print(f'  {len(agg)} sector-day rows written '
          f"({len(radar['sectors'])} sectors)")
    _print_report(radar)


def _print_report(radar: dict) -> None:
    print(f"\n  {'sector':<24} {'z':>6} {'elev':>5} {'buys':>5} {'sells':>6} "
          f"{'vspk':>5} {'tilt':>6}  hot")
    for s in sorted(radar['sectors'],
                    key=lambda x: -(x['z'] if x['z'] is not None else -99)):
        print(f"  {s['sector']:<24} {s['z'] if s['z'] is not None else '--':>6} "
              f"{s['elevated_days']:>5} {s['buys']:>5} {s['sells']:>6} "
              f"{s['vol_spikes']:>5} {s['tilt']:>6}  {'HOT' if s['hot'] else ''}")


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--profile', default='ma500')
    p.add_argument('--backfill', action='store_true')
    p.add_argument('--report', action='store_true')
    args = p.parse_args()
    if args.backfill:
        backfill()
    elif args.report:
        rows, _ = load_activity()
        _print_report(compute_radar(rows))
    else:
        p.print_help()
