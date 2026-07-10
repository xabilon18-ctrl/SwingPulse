"""
Live signal ledger — records every signal the pipeline fires in production and
grades it against what price actually did afterwards.

Each record is one fire: {instrument, ticker, tf, code, confidence, fire_date}.
On every pipeline run, open records are graded from the parquet cache:
  - horizon marks: % move at +5 / +10 / +20 bars after entry (next bar open)
  - trade outcome: the same ATR-stop simulation as backtest.py (2xATR14 stop,
    2R target, time stop) so live results are directly comparable to the
    backtested expectancy per signal code.

Persistence: R2 is the source of truth (CI checkouts are ephemeral; the
Actions cache can be evicted). The ledger is fetched from the public R2 URL
at the start of a run, merged with any local copy, and re-uploaded by
publish.py along with the rest of the data files.

CLI:
    python3 signal_ledger.py --backfill   # seed from output_*/signals_*.csv
    python3 signal_ledger.py --grade      # grade open records, write summary
"""

import glob
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime

import pandas as pd

from _active_config import OUTPUT_DIR
from instruments import load_instruments, asset_class_of

LEDGER_PATH  = os.path.join(OUTPUT_DIR, 'signal_ledger.json')
SUMMARY_PATH = os.path.join(OUTPUT_DIR, 'ledger_summary.json')
# Public R2 data prefix — keep in sync with R2_BASE_URL in webapp/publish.py
R2_LEDGER_URL = 'https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev/ma500/signal_ledger.json'

HORIZONS = (5, 10, 20)          # bars after entry for % marks

# Only fires from the CURRENT signal engine belong in the live record.
# The B1-B4/S1-S4 system went live 2026-06-18; the B1/S1 anchor gate (which
# changed what B1/S1 mean) landed 2026-06-27 — that's the comparability epoch.
LEDGER_EPOCH  = '2026-06-27'
CURRENT_CODES = {'B1', 'B2', 'B3', 'B4', 'S1', 'S2', 'S3', 'S4'}


def _now() -> str:
    return datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')


def _name_to_ticker() -> dict:
    return {i['name']: i['ticker'] for i in load_instruments()}


# ---------------------------------------------------------------------------
# Load / save
# ---------------------------------------------------------------------------
def load_ledger() -> tuple[dict, bool]:
    """R2 copy merged with local copy (union by id, prefer the more-graded one).

    Returns (records, safe_to_save). safe_to_save is False when the R2 fetch
    failed AND there is no local copy — saving then would CLOBBER the remote
    ledger with a near-empty one (this happened 2026-07-10: an edge-cached 404
    made a CI run overwrite 342 records with 43). Cache-busting query param +
    retries make the fetch itself reliable."""
    remote, local = {}, {}
    remote_ok = False
    url = f'{R2_LEDGER_URL}?t={int(datetime.utcnow().timestamp())}'
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'Cache-Control': 'no-cache'})
            with urllib.request.urlopen(req, timeout=20) as r:
                remote = {rec['id']: rec for rec in json.load(r).get('records', [])}
            remote_ok = True
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:      # genuinely absent — first-ever run
                remote_ok = True
                break
            import time; time.sleep(2 * (attempt + 1))
        except Exception:
            import time; time.sleep(2 * (attempt + 1))

    local_ok = False
    try:
        with open(LEDGER_PATH) as f:
            local = {rec['id']: rec for rec in json.load(f).get('records', [])}
        local_ok = True
    except Exception:
        pass

    def _graded_score(rec):
        return sum(1 for h in HORIZONS if rec.get(f'h{h}_pct') is not None) \
               + (2 if rec.get('trade') else 0)

    merged = dict(remote)
    for rid, rec in local.items():
        if rid not in merged or _graded_score(rec) > _graded_score(merged[rid]):
            merged[rid] = rec
    return merged, (remote_ok or local_ok)


def save_ledger(records: dict) -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    recs = sorted(records.values(), key=lambda r: (r['fire_date'], r['instrument']))
    with open(LEDGER_PATH, 'w') as f:
        json.dump({'updated_at': _now(), 'records': recs}, f, separators=(',', ':'))


# ---------------------------------------------------------------------------
# Recording fires
# ---------------------------------------------------------------------------
def _make_record(name, ticker, group, tf, code, conf, fire_date):
    return {
        'id':          f'{fire_date}|{tf}|{name}|{code}',
        'instrument':  name,
        'ticker':      ticker,
        'group':       group,
        'class':       asset_class_of(group),
        'tf':          tf,
        'code':        code,
        'conf':        conf or '',
        'fire_date':   fire_date,      # bar date the signal fired on
        'recorded_at': _now(),
        'trade':       None,           # filled by grading (ATR-stop simulation)
    }


def record_fires_from_row(records: dict, row: dict, ticker: str) -> int:
    """Append this instrument's fired signals (both TFs) to the ledger. Returns #new."""
    added = 0
    for tf, sig_col, conf_col, date_col in (
        ('D',  'primary_signal',    'signal_confidence',    'date'),
        ('4H', 'h4_primary_signal', 'h4_signal_confidence', 'h4_date'),
    ):
        code = str(row.get(sig_col) or '').strip()
        fire_date = str(row.get(date_col) or '').strip()
        if not code or code.lower() == 'nan' or not fire_date:
            continue
        if code not in CURRENT_CODES or fire_date < LEDGER_EPOCH:
            continue  # old engine's codes/behavior — not comparable
        rec = _make_record(row.get('instrument_name', ''), ticker,
                           str(row.get('group') or ''), tf, code,
                           str(row.get(conf_col) or '').strip(), fire_date)
        if rec['id'] not in records:
            records[rec['id']] = rec
            added += 1
    return added


def record_fires(records: dict, output_df: pd.DataFrame) -> int:
    n2t = _name_to_ticker()
    added = 0
    for _, row in output_df.iterrows():
        ticker = n2t.get(str(row.get('instrument_name') or ''))
        if not ticker:
            continue
        added += record_fires_from_row(records, row.to_dict(), ticker)
    return added


# ---------------------------------------------------------------------------
# Grading
# ---------------------------------------------------------------------------
def _load_tf_frame(ticker: str, tf: str):
    """Price frame with ATR for one ticker/timeframe, or None."""
    # Deferred imports — main.py imports this module, and backtest.py imports
    # main; importing backtest at module level would make the cycle bite.
    from backtest import _add_atr
    from data_fetcher import _cache_path

    if tf == 'D':
        path = _cache_path(ticker)
        if not os.path.exists(path):
            return None
        df = pd.read_parquet(path)
    else:
        path = _cache_path(ticker, suffix='1h')
        if not os.path.exists(path):
            return None
        from main import _resample_4h
        df = _resample_4h(pd.read_parquet(path))
    if len(df) < 10:
        return None
    return _add_atr(df)


def _fire_index(df: pd.DataFrame, tf: str, fire_date: str):
    """Bar index the signal fired on. 4H fires are recorded by date only, so we
    use the last 4H bar of that date (matches how the pipeline extracts rows)."""
    ts = pd.Timestamp(fire_date)
    end = df.index.searchsorted(ts + pd.Timedelta(days=1), side='left') - 1
    if end < 0:
        return None
    bar_date = df.index[end].date() if hasattr(df.index[end], 'date') else None
    if bar_date != ts.date():
        return None
    return int(end)


def _grade_record(rec: dict, df: pd.DataFrame) -> bool:
    """Grade one record in place. Returns True if anything changed."""
    from backtest import simulate_trade, TIME_STOP_BARS, SLIPPAGE_PCT

    changed = False
    tf = rec['tf']
    fire_idx = _fire_index(df, tf, rec['fire_date'])
    if fire_idx is None:
        # Bar not in cache (delisted / symbol change) — give up on old records
        if len(df) and (pd.Timestamp.now() - pd.Timestamp(rec['fire_date'])).days > 200:
            if not rec.get('grade_error'):
                rec['grade_error'] = 'fire bar not found'
                changed = True
        return changed

    entry_idx = fire_idx + 1
    if entry_idx >= len(df):
        return changed  # entry bar hasn't happened yet
    side = 'long' if rec['code'].startswith('B') else 'short'

    if rec.get('entry') is None:
        entry = float(df.iloc[entry_idx]['Open'])
        if entry > 0:
            entry *= (1 + SLIPPAGE_PCT) if side == 'long' else (1 - SLIPPAGE_PCT)
            rec['entry'] = round(entry, 6)
            rec['entry_date'] = str(df.index[entry_idx].date())
            changed = True

    entry = rec.get('entry')
    if not entry:
        return changed

    # Horizon marks — % move (signed for the trade direction) at +N bars
    for h in HORIZONS:
        key = f'h{h}_pct'
        if rec.get(key) is None and fire_idx + h < len(df):
            close = float(df.iloc[fire_idx + h]['Close'])
            if not (close > 0):   # corrupt zero-price bar — retry next run
                continue
            pct = (close - entry) / entry * 100
            if side == 'short':
                pct = -pct
            rec[key] = round(pct, 3)
            changed = True

    # Trade outcome — same simulation as the backtest, but a 'time' exit only
    # counts once the full window has actually elapsed (otherwise still open)
    if rec.get('trade') is None:
        outcome = simulate_trade(df, fire_idx, side, tf)
        if outcome is not None:
            available_fwd = len(df) - (fire_idx + 1)
            if outcome['exit_reason'] != 'time' or available_fwd >= TIME_STOP_BARS.get(tf, 30):
                rec['trade'] = {k: outcome[k] for k in
                                ('exit_reason', 'exit_date', 'bars_held',
                                 'pnl_pct', 'r_multiple', 'win')}
                changed = True

    return changed


def grade_open_records(records: dict) -> int:
    """Grade everything still missing marks or a trade outcome. Returns #changed."""
    open_recs = [r for r in records.values()
                 if not r.get('grade_error')
                 and (r.get('trade') is None
                      or any(r.get(f'h{h}_pct') is None for h in HORIZONS))]
    if not open_recs:
        return 0

    by_key: dict = {}
    for r in open_recs:
        by_key.setdefault((r['ticker'], r['tf']), []).append(r)

    changed = 0
    for (ticker, tf), recs in by_key.items():
        df = _load_tf_frame(ticker, tf)
        if df is None:
            continue
        for rec in recs:
            if _grade_record(rec, df):
                changed += 1
    return changed


# ---------------------------------------------------------------------------
# Summary (small file the frontend fetches)
# ---------------------------------------------------------------------------
def _bucket_stats(recs: list) -> dict:
    done = [r for r in recs if r.get('trade')]
    out = {'fires': len(recs), 'graded': len(done)}
    if done:
        wins = [r for r in done if r['trade']['win']]
        out['win_rate'] = round(len(wins) / len(done) * 100, 1)
        out['avg_r']    = round(sum(r['trade']['r_multiple'] for r in done) / len(done), 3)
        out['avg_pct']  = round(sum(r['trade']['pnl_pct'] for r in done) / len(done), 2)
    h20 = [r[f'h20_pct'] for r in recs if r.get('h20_pct') is not None]
    if h20:
        out['h20_avg_pct'] = round(sum(h20) / len(h20), 2)
    return out


def write_summary(records: dict) -> dict:
    recs = list(records.values())
    by_signal: dict = {}
    by_code: dict = {}
    for r in recs:
        by_signal.setdefault(f"{r['tf']}|{r['code']}", []).append(r)
        by_code.setdefault(r['code'], []).append(r)

    summary = {
        'generated_at': _now(),
        'totals': {
            'fires':  len(recs),
            'graded': sum(1 for r in recs if r.get('trade')),
            'open':   sum(1 for r in recs if not r.get('trade') and not r.get('grade_error')),
            'since':  min((r['fire_date'] for r in recs), default=''),
        },
        'by_signal': {k: _bucket_stats(v) for k, v in sorted(by_signal.items())},
        'by_code':   {k: _bucket_stats(v) for k, v in sorted(by_code.items())},
    }
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(SUMMARY_PATH, 'w') as f:
        json.dump(summary, f, separators=(',', ':'))
    return summary


# ---------------------------------------------------------------------------
# Pipeline entry point
# ---------------------------------------------------------------------------
def update_ledger(output_df: pd.DataFrame) -> None:
    """Called by main.py after signals are computed: fetch, append, grade, save."""
    try:
        records, safe = load_ledger()
        if not safe:
            print('  Ledger: SKIPPED — could not load existing ledger '
                  '(saving would clobber it)')
            return
        added   = record_fires(records, output_df)
        graded  = grade_open_records(records)
        save_ledger(records)
        s = write_summary(records)
        print(f"  Ledger: +{added} fires, {graded} graded this run — "
              f"{s['totals']['fires']} total ({s['totals']['graded']} complete, "
              f"{s['totals']['open']} open)")
    except Exception as exc:
        # The ledger must never break the pipeline
        print(f'  Ledger: skipped ({exc})')


# ---------------------------------------------------------------------------
# CLI — backfill from historical snapshot CSVs / manual grade
# ---------------------------------------------------------------------------
def backfill() -> None:
    records, _ = load_ledger()
    n2t = _name_to_ticker()
    files = sorted(glob.glob(os.path.join(OUTPUT_DIR, 'signals_????-??-??.csv')))
    print(f'Backfilling from {len(files)} snapshot CSVs...')
    added = 0
    for path in files:
        df = pd.read_csv(path, dtype=str).fillna('')
        for _, row in df.iterrows():
            ticker = n2t.get(row.get('instrument_name', ''))
            if not ticker:
                continue
            added += record_fires_from_row(records, row.to_dict(), ticker)
    print(f'  +{added} fires from history')
    graded = grade_open_records(records)
    print(f'  {graded} records graded')
    save_ledger(records)
    s = write_summary(records)
    print(f"  Total: {s['totals']['fires']} fires, {s['totals']['graded']} complete, "
          f"{s['totals']['open']} open")
    for k, v in s['by_signal'].items():
        if v.get('graded'):
            print(f"    {k:<8} {v['fires']:>4} fires  {v['graded']:>4} graded  "
                  f"win {v.get('win_rate', 0):>5}%  avgR {v.get('avg_r', 0):>7}")


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--profile', default='ma500')
    p.add_argument('--backfill', action='store_true')
    p.add_argument('--grade', action='store_true')
    args = p.parse_args()
    if args.backfill:
        backfill()
    elif args.grade:
        records, safe = load_ledger()
        if not safe:
            print('could not load existing ledger — refusing to save over it')
            sys.exit(1)
        print(f'{grade_open_records(records)} records graded')
        save_ledger(records)
        write_summary(records)
    else:
        p.print_help()
