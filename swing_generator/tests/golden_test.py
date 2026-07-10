"""
Golden-file regression tests for the SwingPulse signal engine.

Runs the production signal path (mirroring main.py process_instrument: full-
ribbon indicators, clipped-ribbon signals, per-TF params) over FROZEN price
fixtures and compares the result to a committed golden snapshot. Any change
to signals.py / indicators.py / config.py that alters a single fire or trend
transition fails with a readable diff.

Also runs synthetic unit checks for past real bugs (zero-price bars, gap
fills, confidence-map fallback) so they can't regress silently.

Usage (from swing_generator/):
    python3 tests/golden_test.py                  # compare against golden
    python3 tests/golden_test.py --update         # regenerate golden snapshot
    python3 tests/golden_test.py --make-fixtures  # refreeze fixtures (rare!)

Notes:
  - signal_confidence is EXCLUDED from the golden — it's driven by
    confidence_map.json (a data file that legitimately regenerates); the
    lookup logic is unit-tested separately below.
  - The hash covers only per-bar signal/trend STRINGS, never floats, so a
    pandas version bump can't fail the test with 1e-15 wobble.
"""

import argparse
import hashlib
import json
import os
import sys

import pandas as pd

_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
_GEN_DIR = os.path.dirname(_TESTS_DIR)
sys.path.insert(0, _GEN_DIR)

from _active_config import MA_PERIODS                       # noqa: E402
from indicators import add_all_indicators                    # noqa: E402
from signals import add_signals, _signal_confidence          # noqa: E402
import signals as _signals_mod                               # noqa: E402

FIXTURES_DIR = os.path.join(_TESTS_DIR, 'fixtures')
GOLDEN_PATH  = os.path.join(_TESTS_DIR, 'golden_signals.json')

# Diverse fixture set: US equity, crypto, forex, commodity, index, EU equity
# with zero-price bars (TEF), short-history IPO (CRWV)
FIXTURE_TICKERS = ['AAPL', 'NVDA', 'BTC-USD', 'ETH-USD', 'EURUSD=X',
                   'USDJPY=X', 'GC=F', 'CL=F', '^GSPC', '^GDAXI',
                   'TEF.MC', 'CRWV']

# Production per-TF params — MUST mirror main.py process_instrument()
TF_PARAMS = {
    'D':  {'refire_pct': 0.05, 'new_trend_pct': 0.05},
    '4H': {'refire_pct': 0.02, 'new_trend_pct': 0.05},
}

_DAILY_BARS  = 2600   # fixture size: enough for MA500 + years of signals
_HOURLY_BARS = 6500   # → ~1080 4H bars


def _safe_name(ticker: str) -> str:
    return ticker.replace('=', '_').replace('^', 'IDX_').replace('.', '_')


def _fixture_path(ticker: str, tf: str) -> str:
    return os.path.join(FIXTURES_DIR, f'{_safe_name(ticker)}_{tf}.parquet')


# ---------------------------------------------------------------------------
# Fixture freezing (one-off; fixtures are committed and never auto-refresh)
# ---------------------------------------------------------------------------
def make_fixtures() -> None:
    from data_fetcher import _cache_path
    os.makedirs(FIXTURES_DIR, exist_ok=True)
    cols = ['Open', 'High', 'Low', 'Close', 'Volume']
    for t in FIXTURE_TICKERS:
        daily = pd.read_parquet(_cache_path(t))
        daily = daily[[c for c in cols if c in daily.columns]].tail(_DAILY_BARS)
        daily.to_parquet(_fixture_path(t, 'D'))
        hourly = pd.read_parquet(_cache_path(t, suffix='1h'))
        hourly = hourly[[c for c in cols if c in hourly.columns]].tail(_HOURLY_BARS)
        hourly.to_parquet(_fixture_path(t, '1h'))
        print(f'  froze {t}: {len(daily)} daily / {len(hourly)} hourly bars')


# ---------------------------------------------------------------------------
# Production-parity signal frames
# ---------------------------------------------------------------------------
def _signal_frame(ticker: str, tf: str):
    """Signal columns for one fixture, computed the way main.py does."""
    if tf == 'D':
        df = pd.read_parquet(_fixture_path(ticker, 'D'))
        df = add_all_indicators(df)
        ma_p = [p for p in MA_PERIODS if p <= len(df)]
    else:
        from main import _resample_4h
        hourly = pd.read_parquet(_fixture_path(ticker, '1h'))
        df = _resample_4h(hourly)
        ma_p = [p for p in MA_PERIODS if p <= len(df)]
        df = add_all_indicators(df, ma_periods=ma_p)
    if len(ma_p) < 3:
        return None
    # asset_class fixed: signal_confidence is excluded from the golden anyway,
    # and a fixed value keeps output independent of Instruments.txt edits
    return add_signals(df, ma_periods=ma_p, tf=tf, asset_class='Equity',
                       **TF_PARAMS[tf])


def _snapshot_one(df: pd.DataFrame) -> dict:
    """Fires + established-trend transitions + a float-free hash."""
    dates  = [str(ts.date()) if hasattr(ts, 'date') else str(ts) for ts in df.index]
    codes  = df['primary_signal'].astype(str).tolist()
    trends = df['established_trend'].astype(str).tolist()
    status = df['confirmation_status'].astype(str).tolist()

    fires = [{'date': dates[i], 'code': codes[i], 'status': status[i]}
             for i in range(len(dates)) if codes[i]]

    transitions = []
    prev = None
    for i, t in enumerate(trends):
        if t != prev:
            transitions.append({'date': dates[i], 'trend': t})
            prev = t

    h = hashlib.sha256('|'.join(codes + trends).encode()).hexdigest()[:16]
    return {'bars': len(dates), 'fires': fires,
            'trend_transitions': transitions, 'hash': h}


def build_snapshot() -> dict:
    snap = {}
    for t in FIXTURE_TICKERS:
        for tf in ('D', '4H'):
            df = _signal_frame(t, tf)
            if df is not None:
                snap[f'{t}|{tf}'] = _snapshot_one(df)
    return snap


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------
def compare(golden: dict, current: dict) -> list:
    problems = []
    for key in sorted(set(golden) | set(current)):
        g, c = golden.get(key), current.get(key)
        if g is None or c is None:
            problems.append(f'{key}: {"missing from current" if c is None else "new (not in golden)"}')
            continue
        if g['hash'] == c['hash']:
            continue
        gf = {(f['date'], f['code']) for f in g['fires']}
        cf = {(f['date'], f['code']) for f in c['fires']}
        for d, code in sorted(cf - gf):
            problems.append(f'{key}: NEW fire {code} on {d}')
        for d, code in sorted(gf - cf):
            problems.append(f'{key}: LOST fire {code} on {d}')
        gt = {(t['date'], t['trend']) for t in g['trend_transitions']}
        ct = {(t['date'], t['trend']) for t in c['trend_transitions']}
        for d, tr in sorted(ct - gt):
            problems.append(f'{key}: NEW trend transition -> {tr or "(none)"} on {d}')
        for d, tr in sorted(gt - ct):
            problems.append(f'{key}: LOST trend transition -> {tr or "(none)"} on {d}')
        if cf == gf and ct == gt:
            problems.append(f'{key}: hash differs (status text or bar count changed: '
                            f'{g["bars"]} -> {c["bars"]} bars)')
    return problems


# ---------------------------------------------------------------------------
# Synthetic unit checks — past real bugs, pinned
# ---------------------------------------------------------------------------
def unit_checks() -> list:
    import numpy as np
    from backtest import simulate_trade, _add_atr
    failures = []

    def _mk(bars):
        df = pd.DataFrame(bars, columns=['Open', 'High', 'Low', 'Close'])
        df['Volume'] = 1000
        df.index = pd.date_range('2024-01-01', periods=len(df), freq='D')
        return _add_atr(df, period=3)

    # 1. Zero-price bars must be skipped, not read as gap fills (2026-07-10 bug)
    bars = [[100, 101, 99, 100]] * 6 + [[0, 0, 0, 0]] + [[100, 101, 99, 100]] * 10
    out = simulate_trade(_mk(bars), 5, 'long', 'D')
    if out is not None and out['pnl_pct'] < -50:
        failures.append('zero-price bar treated as a real gap fill (fake -100%)')

    # 2. A gap open beyond the stop must fill at the open, not the stop price
    bars = [[100, 101, 99, 100]] * 6 + [[80, 81, 79, 80]] + [[80, 81, 79, 80]] * 8
    out = simulate_trade(_mk(bars), 4, 'long', 'D')
    if out is None or out['exit_reason'] not in ('gap-stop', 'stop'):
        failures.append(f'gap-through-stop not detected (got {out and out["exit_reason"]})')
    elif out['exit_reason'] == 'gap-stop' and out['r_multiple'] > -1.0:
        failures.append('gap-stop filled better than -1R — gap fill not at the open')

    # 3. Confidence lookup fallback chain: TF|CODE|CLASS -> TF|CODE -> standard
    _signals_mod._conf_loaded = True
    _signals_mod._conf_tiers = {
        'D|B1|Crypto': {'tier': 'high'},
        'D|B1':        {'tier': 'low'},
    }
    if _signal_confidence('B1', 'D', 'Crypto') != 'high':
        failures.append('confidence lookup ignored the class-specific cell')
    if _signal_confidence('B1', 'D', 'Forex') != 'low':
        failures.append('confidence lookup did not fall back to TF|CODE')
    if _signal_confidence('B2', 'D', 'Forex') != 'standard':
        failures.append('confidence lookup did not default to standard')
    _signals_mod._conf_loaded = False   # restore lazy loading for golden run
    _signals_mod._conf_tiers = None

    return failures


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--profile', default='ma500')
    ap.add_argument('--update', action='store_true', help='regenerate golden snapshot')
    ap.add_argument('--make-fixtures', action='store_true', help='refreeze fixture data')
    args = ap.parse_args()

    if args.make_fixtures:
        make_fixtures()
        return

    print('Unit checks...', flush=True)
    failures = unit_checks()
    for f in failures:
        print(f'  ✘ {f}')
    if not failures:
        print('  ✓ all passed')

    print('Golden snapshot...', flush=True)
    current = build_snapshot()

    if args.update:
        with open(GOLDEN_PATH, 'w') as f:
            json.dump(current, f, indent=1, sort_keys=True)
        n_fires = sum(len(v['fires']) for v in current.values())
        print(f'  ✓ golden updated: {len(current)} frames, {n_fires} fires -> {GOLDEN_PATH}')
        sys.exit(1 if failures else 0)

    if not os.path.exists(GOLDEN_PATH):
        print(f'  ✘ no golden file at {GOLDEN_PATH} — run with --update first')
        sys.exit(1)
    with open(GOLDEN_PATH) as f:
        golden = json.load(f)

    problems = compare(golden, current)
    if problems:
        print(f'  ✘ {len(problems)} differences vs golden:')
        for p in problems[:40]:
            print(f'    {p}')
        if len(problems) > 40:
            print(f'    ... and {len(problems) - 40} more')
        print('\n  If this change is INTENTIONAL: rerun the backtest, review the diff,')
        print('  then refresh the snapshot with: python3 tests/golden_test.py --update')
    else:
        n_fires = sum(len(v['fires']) for v in golden.values())
        print(f'  ✓ identical to golden ({len(golden)} frames, {n_fires} fires)')

    sys.exit(1 if (failures or problems) else 0)


if __name__ == '__main__':
    main()
