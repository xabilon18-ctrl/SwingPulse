"""
Sector activity series — the data half of the Sector Activity Radar.

Per trading day per radar sector (see instruments.radar_sector_of) we record:
    buys       – # NEW daily-TF B-code fires on that bar
    sells      – # NEW daily-TF S-code fires on that bar
    vol_spikes – # instruments with RVOL >= VOL_SPIKE_RVOL on that bar
    members    – sector universe size at record time
    rate       – (buys + sells + vol_spikes) / members

TWO radars, one implementation (see TF_SPECS):
    D — daily bars, 20-day baseline  -> sector_activity.json  / sector_radar.json
    W — weekly bars, 20-week baseline -> sector_activity_w.json / sector_radar_w.json
4H is deliberately absent: its history only exists for ~2 years of hourly cache,
where both D and W backfill from the full parquet cache with the production
engine. Mixing TFs inside ONE series would bend the baseline; running two series
side by side does not.

The weekly radar holds still for a week by construction, not by a freeze flag:
its key is `w_date`, the week-ending Friday, which does not move until the next
week closes, so every run Mon-Fri upserts the same row with the same counts.

instrument_flavours.json is written by the DAILY radar ONLY — see write_radar().

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

from _active_config import OUTPUT_DIR, MA_PERIODS
from instruments import load_instruments, radar_sector_of

FLAVOUR_PATH  = os.path.join(OUTPUT_DIR, 'instrument_flavours.json')
# Public R2 data prefix — keep in sync with R2_BASE_URL in webapp/publish.py
R2_BASE = 'https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev/ma500'
# r2.dev answers 403 to the default 'Python-urllib/3.x' agent. Without this the
# fetch below fails on every CI run, and since a CI checkout has no local
# sector_activity.json the load returns safe=False and the whole radar update is
# skipped — the R2 copy then only ever advances when the pipeline is run from a
# machine that happens to hold the file. Same header in signal_ledger.py.
R2_USER_AGENT = 'SwingPulse-pipeline/1.0'

CODES          = {'B1', 'B2', 'B3', 'B4', 'S1', 'S2', 'S3', 'S4'}
VOL_SPIKE_RVOL = 2.0     # volume >= 2x its 25d average = a volume event
BASELINE_DAYS  = 20      # trailing window for mean/std of rate
MIN_BASELINE   = 10      # need at least this many trailing rows to score z
Z_ALERT        = 1.5     # hot threshold (UI display-gates harder: z>=2 or 2 days)
MIN_MEMBERS    = 8       # sectors below this are logged but never flagged hot
MARKET_WIDE_MIN = 6      # >= this many sectors hot on one day = market-wide churn

# ---------------------------------------------------------------------------
# Timeframe specs  (weekly radar added 2026-09-02)
# ---------------------------------------------------------------------------
# One implementation of the maths, two sets of files. Everything that differs
# between the daily and weekly radar lives here; every function below takes a
# `tf` and reads its spec, rather than a second copy of _z_series existing.
#
# `writes_flavours` is the important field and it is False for Weekly ON
# PURPOSE. instrument_flavours.json drives the mood/conviction layer — the
# verdict bar, the card glow and dim — and that layer was validated on DAILY
# data only (Phase 0, TF='D', 14.5k trades). A weekly radar must never write it:
# the numbers would look plausible and would be grading signals against evidence
# that was never gathered. app.js already refuses to apply mood off Daily
# (`moodApplies()`); this is the same rule enforced at the producing end, so it
# holds even if the front-end guard is ever loosened.
#
# Weekly baseline is 20 WEEKS — the same shape as the daily 20 days, about five
# months of history to judge "is this week unusual". Measured on a 3-year
# prototype across all 798 instruments: 11.8% of sector-weeks score hot (z>=1.5)
# and tripping it needs a real cluster (Technology 14+ events, most sectors 3-6),
# not one fire. The thin end is the small sectors — Energy is silent in 33% of
# weeks, Index 29%, Real Estate 28% — which pushes their z negative rather than
# hot, so it costs sensitivity, not false alarms.
TF_SPECS = {
    'D': {
        'label':          'day',
        'prefix':         '',
        'activity_file':  'sector_activity.json',
        'radar_file':     'sector_radar.json',
        'baseline':       BASELINE_DAYS,
        'retain':         400,          # rows kept per sector (~1.6 years)
        'writes_flavours': True,
        'zero_fill':      False,        # see the note under 'zero_fill' below
    },
    'W': {
        'label':          'week',
        'prefix':         'w_',
        'activity_file':  'sector_activity_w.json',
        'radar_file':     'sector_radar_w.json',
        'baseline':       20,           # 20 WEEKS
        'retain':         200,          # ~4 years of weeks
        'writes_flavours': False,       # see above — deliberate, not an omission
        'zero_fill':      True,
    },
}

# `zero_fill` — a period with NO events must be recorded as a row of zeros, not
# left out. Leaving it out has two costs:
#
#   1. compute_radar reads recs[-1] as "now", so a sector that was silent in the
#      latest period silently reports the PREVIOUS one. Measured on the first
#      weekly run: Communication Services and Index showed the week ending
#      2026-08-21 while every other sector showed 2026-08-28.
#   2. _z_series averages over the rows that exist, so the baseline becomes
#      "a typical ACTIVE period" instead of "a typical period" — mean too high,
#      variance too low, and quiet stretches never pull the mean down.
#
# It is ON for Weekly, which is new and has nothing downstream of it.
#
# It is OFF for Daily, and that is a DELIBERATE HOLD, not a judgement that daily
# is fine — 35.2% of (sector, day) rows are missing there, against 12.8% of
# (sector, week) here, so the daily baseline is the more distorted of the two.
# Turning it on would change every daily z, which changes sector flavours, which
# changes instrument_flavours.json, which drives the verdict bar and the card
# glow/dim — a validated display layer. That is a change to make deliberately
# with a before/after count, not as a side effect of adding a weekly radar.
def _zero_fill(agg: dict, members: dict) -> None:
    """Add a zero row for every (period, sector) pair the aggregation missed."""
    periods = {d for d, _ in agg}
    for d in periods:
        for sector in members:
            agg.setdefault((d, sector), {'buys': 0, 'sells': 0, 'vol_spikes': 0})


def _spec(tf: str) -> dict:
    try:
        return TF_SPECS[tf]
    except KeyError:
        raise ValueError(f'sector_activity: unknown timeframe {tf!r}')


def _activity_path(tf: str) -> str:
    return os.path.join(OUTPUT_DIR, _spec(tf)['activity_file'])


def _radar_path(tf: str) -> str:
    return os.path.join(OUTPUT_DIR, _spec(tf)['radar_file'])


def _activity_url(tf: str) -> str:
    return f"{R2_BASE}/{_spec(tf)['activity_file']}"


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
def load_activity(tf: str = 'D') -> tuple[dict, bool]:
    """Rows keyed 'date|sector'. Local wins on conflict (it is always the
    fresher computation). Returns (rows, safe_to_save)."""
    remote, local = {}, {}
    remote_ok = False
    url = f'{_activity_url(tf)}?t={int(datetime.utcnow().timestamp())}'
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'Cache-Control': 'no-cache',
                                                       'User-Agent': R2_USER_AGENT})
            with urllib.request.urlopen(req, timeout=20) as r:
                remote = {f"{row['date']}|{row['sector']}": row
                          for row in json.load(r).get('rows', [])}
            remote_ok = True
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:          # first-ever run
                remote_ok = True
                break
            print(f'  Sector activity [{tf}]: R2 fetch failed (HTTP {e.code})')
            import time; time.sleep(2 * (attempt + 1))
        except Exception as exc:
            print(f'  Sector activity [{tf}]: R2 fetch failed ({exc})')
            import time; time.sleep(2 * (attempt + 1))

    local_ok = False
    try:
        with open(_activity_path(tf)) as f:
            local = {f"{row['date']}|{row['sector']}": row
                     for row in json.load(f).get('rows', [])}
        local_ok = True
    except Exception:
        pass

    merged = dict(remote)
    merged.update(local)
    return merged, (remote_ok or local_ok)


def save_activity(rows: dict, tf: str = 'D') -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    retain = _spec(tf)['retain']
    # prune to `retain` most-recent rows per sector
    by_sector: dict = {}
    for row in rows.values():
        by_sector.setdefault(row['sector'], []).append(row)
    kept = []
    for recs in by_sector.values():
        recs.sort(key=lambda r: r['date'])
        kept.extend(recs[-retain:])
    kept.sort(key=lambda r: (r['date'], r['sector']))
    with open(_activity_path(tf), 'w') as f:
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


def update_from_output(rows: dict, output_df: pd.DataFrame, tf: str = 'D') -> int:
    """Recompute this bar's (bar-date, sector) rows from the freshly generated
    output. Fully replaces those keys — a later run on the same bar is more
    complete, never less. Returns #rows upserted.

    For Weekly this is what makes the radar hold still for a week at no extra
    cost: `w_date` is the week-ending Friday and does not move until the next
    week closes, so every run Mon-Fri upserts the SAME key with the same counts.
    The row is rewritten, never appended, and the radar reads identical all week.
    """
    prefix = _spec(tf)['prefix']
    name_to_sector, members = _sector_maps()
    agg: dict = {}
    for _, r in output_df.iterrows():
        row = r.to_dict()
        sector = name_to_sector.get(str(row.get('instrument_name') or ''))
        bar_date = str(row.get(f'{prefix}date') or '').strip()
        if not sector or not bar_date or bar_date.lower() == 'nan':
            continue
        a = agg.setdefault((bar_date, sector),
                           {'buys': 0, 'sells': 0, 'vol_spikes': 0})
        code = str(row.get(f'{prefix}primary_signal') or '').strip()
        if code in CODES:
            a['buys' if code.startswith('B') else 'sells'] += 1
        vol = _num(row.get(f'{prefix}volume'))
        avg = _num(row.get(f'{prefix}volume_average'))
        if avg > 0 and vol / avg >= VOL_SPIKE_RVOL:
            a['vol_spikes'] += 1

    if _spec(tf)['zero_fill']:
        _zero_fill(agg, members)

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
def _z_series(rates: list, members: int, baseline: int = BASELINE_DAYS) -> list:
    """z per row vs its own trailing `baseline` window (None until warm)."""
    zs = []
    floor = 0.5 / members if members else 1.0
    for i in range(len(rates)):
        base = rates[max(0, i - baseline):i]
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


def _classify_flavour(zs_sig, zs_vol, tilt: str, eligible: bool,
                      market_wide: bool) -> str:
    """Sector 'mood' for the latest day (ported from research/instrument_flavour_
    check.build_flavours). Priority: market_wide > directional thrust > churn >
    normal. zs_sig = z of (buys+sells)/members, zs_vol = z of vol_spikes/members,
    both vs the trailing BASELINE_DAYS window. tilt = _tilt(buys, sells).

    'unknown' (too few members / no baseline yet) is deliberately NOT 'normal':
    the frontend must not present "we can't judge this sector" as a calm all-clear.
    Both are neutral for grading, but only one of them is a claim."""
    if not eligible or zs_sig is None:
        return 'unknown'
    if market_wide:
        return 'market_wide'
    if zs_sig >= Z_ALERT:
        return f'{tilt}_thrust' if tilt in ('buy', 'sell', 'mixed') else 'thrust'
    if zs_vol is not None and zs_vol >= Z_ALERT and zs_sig < 1.0:
        return 'churn'
    return 'normal'


def compute_radar(rows: dict, tf: str = 'D') -> dict:
    baseline = _spec(tf)['baseline']
    by_sector: dict = {}
    for row in rows.values():
        by_sector.setdefault(row['sector'], []).append(row)

    interim = []
    hot_count = 0
    for sector, recs in sorted(by_sector.items()):
        recs.sort(key=lambda r: r['date'])
        latest = recs[-1]
        members = latest.get('members', 0)
        m = members or 1
        zs = _z_series([r['rate'] for r in recs], members, baseline)
        z_sig = _z_series([(r['buys'] + r['sells']) / m for r in recs], members, baseline)
        z_vol = _z_series([r['vol_spikes'] / m for r in recs], members, baseline)
        z = zs[-1]
        eligible = members >= MIN_MEMBERS
        hot = bool(eligible and z is not None and z >= Z_ALERT)
        if hot:
            hot_count += 1
        elevated = 0
        for zi, ri in zip(reversed(zs), reversed(recs)):
            if eligible and zi is not None and zi >= Z_ALERT:
                elevated += 1
            else:
                break
        base = [r['rate'] for r in recs[-(baseline + 1):-1]]
        interim.append({
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
            '_z_sig':        z_sig[-1],
            '_z_vol':        z_vol[-1],
            '_eligible':     eligible,
        })

    market_wide = hot_count >= MARKET_WIDE_MIN

    sectors = []
    for t in interim:
        t['flavour'] = _classify_flavour(t.pop('_z_sig'), t.pop('_z_vol'),
                                         t['tilt'], t.pop('_eligible'),
                                         market_wide)
        sectors.append(t)

    return {
        'generated_at':  _now(),
        'baseline_days': baseline,
        'alert_z':       Z_ALERT,
        'min_members':   MIN_MEMBERS,
        'market_wide':   market_wide,
        'sectors':       sectors,
        # Named so a consumer can never mistake one radar for the other. The
        # daily payload keeps 'baseline_days' spelled that way for the front end
        # that already reads it; 'tf' and 'period' say what a unit actually is.
        'tf':            tf,
        'period':        _spec(tf)['label'],
    }


def write_instrument_flavours(radar: dict) -> None:
    """Per-instrument sector-mood map the Signals cards read (keyed by instrument
    name via radar_sector_of, so the frontend needs no sector-mapping logic).
    Provisional conviction layer — see [[sector-mood-signal-plan]]."""
    name_to_sector, _ = _sector_maps()
    sec_flav = {s['sector']: s['flavour'] for s in radar['sectors']}
    payload = {
        'generated_at': radar.get('generated_at'),
        'market_wide':  radar.get('market_wide', False),
        'instruments':  {name: sec_flav.get(sec, 'unknown')
                         for name, sec in name_to_sector.items()},
        'sectors':      {s['sector']: {'flavour': s['flavour'], 'z': s['z'],
                                       'buys': s['buys'], 'sells': s['sells'],
                                       'tilt': s['tilt'], 'members': s['members']}
                         for s in radar['sectors']},
    }
    with open(FLAVOUR_PATH, 'w') as f:
        json.dump(payload, f, separators=(',', ':'))


def write_radar(rows: dict, tf: str = 'D') -> dict:
    """Write this timeframe's radar file. Flavours are DAILY ONLY.

    instrument_flavours.json is not just another output — it drives the
    mood/conviction layer (verdict bar, card glow and dim), and that layer was
    validated on DAILY data only (Phase 0, TF='D', 14.5k trades). If the weekly
    radar wrote it, weekly sector moods would silently start grading signals
    against evidence nobody ever gathered, and the numbers would look perfectly
    reasonable while doing it.

    So the guard is structural, not a convention: the flavour write is reached
    only through `writes_flavours`, which is True for 'D' and False for 'W'.
    app.js enforces the same rule at the reading end (`moodApplies()` returns
    false off Daily); this half holds even if that half is ever loosened.
    """
    radar = compute_radar(rows, tf)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(_radar_path(tf), 'w') as f:
        json.dump(radar, f, separators=(',', ':'))
    if _spec(tf)['writes_flavours']:
        write_instrument_flavours(radar)
    return radar


# ---------------------------------------------------------------------------
# Pipeline entry point
# ---------------------------------------------------------------------------
def update_sector_activity(output_df: pd.DataFrame, tf: str = 'D') -> None:
    """Called by main.py after signals are computed. Must never break the run."""
    unit = _spec(tf)['label']
    try:
        rows, safe = load_activity(tf)
        if not safe:
            print(f'  Sector activity [{tf}]: SKIPPED — could not load existing '
                  f'series (saving would clobber it)')
            return
        upserted = update_from_output(rows, output_df, tf)
        save_activity(rows, tf)
        radar = write_radar(rows, tf)
        hot = [s for s in radar['sectors'] if s['hot']]
        label = ', '.join(f"{s['sector']} z={s['z']}" for s in hot) or 'all quiet'
        print(f'  Sector activity [{tf}]: {upserted} sector-{unit} rows '
              f'upserted — {label}')
    except Exception as exc:
        print(f'  Sector activity [{tf}]: skipped ({exc})')


def update_all_timeframes(output_df: pd.DataFrame) -> None:
    """Every radar timeframe, each isolated. One failing must not stop the next
    — and neither must stop the pipeline."""
    for tf in TF_SPECS:
        update_sector_activity(output_df, tf)


# ---------------------------------------------------------------------------
# Backfill — recompute history from the parquet cache with the real engine
# ---------------------------------------------------------------------------
def _backfill_instrument(inst: dict, cutoff: str, tf: str = 'D') -> list:
    """[(date, sector, kind)] events for one instrument; kind in B/S/V."""
    from backtest import TF_SIGNAL_PARAMS
    from data_fetcher import _cache_path, _drop_priceless
    from indicators import add_all_indicators, _reported_volume
    from signals import add_signals

    path = _cache_path(inst['ticker'])
    if not os.path.exists(path):
        return []
    # Drop Yahoo's volume-but-no-price bars before deriving activity — one at
    # the end blanks the MAs and silently zeroes the instrument's contribution
    # to its sector's signal counts, which is what feeds the mood/flavour layer.
    df = _drop_priceless(pd.read_parquet(path))
    if len(df) < 250:
        return []

    # Weekly resamples the SAME finished daily bars production does, through the
    # same helper, so the backfilled history and the live weekly rows are built
    # by one rule. The in-progress week is dropped inside _resample_weekly.
    if tf == 'W':
        from main import _resample_weekly
        df = _resample_weekly(df)

    ma_periods = [p for p in MA_PERIODS if p <= len(df)]
    if len(ma_periods) < 3:
        return []
    df = add_all_indicators(df, ma_periods=ma_periods)
    df = add_signals(df, ma_periods=ma_periods, **TF_SIGNAL_PARAMS[tf])

    sector = radar_sector_of(inst)
    # Read the baseline add_all_indicators just computed rather than rolling our
    # own — this used to recompute the 25-bar mean off raw df['Volume'], which
    # meant Yahoo's zero-volume bars deflated it here even after the pipeline
    # learned to exclude them (indicators._reported_volume). Two copies of one
    # rule is how the radar ends up disagreeing with the card above it.
    vol     = _reported_volume(df)
    vol_avg = df['volume_average']
    sig = df['primary_signal'].to_numpy()
    events = []
    for i in range(len(df)):
        d = str(df.index[i].date())
        if d < cutoff:
            continue
        code = sig[i]
        if code in CODES:
            events.append((d, sector, 'B' if code.startswith('B') else 'S'))
        v, a = float(vol.iloc[i]), float(vol_avg.iloc[i])
        if a > 0 and v / a >= VOL_SPIKE_RVOL:
            events.append((d, sector, 'V'))
    return events


def backfill(tf: str = 'D') -> None:
    spec = _spec(tf)
    insts = load_instruments()
    _, members = _sector_maps()
    # `retain` counts BARS, so convert to calendar days per timeframe before
    # using it as a date cutoff: 400 daily bars is ~1.6 years, 200 weekly bars
    # is ~4. Reusing the daily arithmetic for weeks would have backfilled about
    # seven weeks of history and left the 20-week baseline permanently cold.
    span_days = int(spec['retain'] * (1.6 if tf == 'D' else 7.2))
    cutoff = str((pd.Timestamp.utcnow().tz_localize(None)
                  - pd.Timedelta(days=span_days)).date())
    print(f'Backfilling sector activity [{tf}] since {cutoff} '
          f'({len(insts)} instruments, production-parity engine)...')

    all_events = []
    done = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for events in pool.map(lambda i: _backfill_instrument(i, cutoff, tf), insts):
            all_events.extend(events)
            done += 1
            if done % 100 == 0:
                print(f'  {done}/{len(insts)} instruments...')

    agg: dict = {}
    for d, sector, kind in all_events:
        a = agg.setdefault((d, sector), {'B': 0, 'S': 0, 'V': 0})
        a[kind] += 1
    if spec['zero_fill']:
        for d in {d for d, _ in agg}:
            for sector in members:
                agg.setdefault((d, sector), {'B': 0, 'S': 0, 'V': 0})

    rows, _ = load_activity(tf)
    for (d, sector), a in agg.items():
        m = members.get(sector, 0)
        rows[f'{d}|{sector}'] = {
            'date': d, 'sector': sector, 'members': m,
            'buys': a['B'], 'sells': a['S'], 'vol_spikes': a['V'],
            'rate': round((a['B'] + a['S'] + a['V']) / m, 5) if m else 0,
        }
    save_activity(rows, tf)
    radar = write_radar(rows, tf)
    print(f"  {len(agg)} sector-{spec['label']} rows written "
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
    p.add_argument('--tf', choices=sorted(TF_SPECS), default='D',
                   help="radar timeframe: D (daily) or W (weekly)")
    p.add_argument('--all-tfs', action='store_true',
                   help='run the chosen action for every timeframe')
    args = p.parse_args()
    tfs = sorted(TF_SPECS) if args.all_tfs else [args.tf]
    if args.backfill:
        for tf in tfs:
            backfill(tf)
    elif args.report:
        for tf in tfs:
            rows, _ = load_activity(tf)
            print(f"\n=== {tf} radar ===")
            _print_report(compute_radar(rows, tf))
    else:
        p.print_help()
