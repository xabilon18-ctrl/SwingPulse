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

from _active_config import (MA_PERIODS,                     # noqa: E402
                            REFIRE_PCT_WEEKLY, NEW_TREND_PCT_WEEKLY,
                            TREND_UP_FRAC, TREND_DOWN_FRAC)
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
    'W':  {'refire_pct': REFIRE_PCT_WEEKLY, 'new_trend_pct': NEW_TREND_PCT_WEEKLY},
}

_DAILY_BARS  = 2600   # fixture size: enough for MA500 + years of signals
                      # — and, at 5 sessions a week, ~520 weekly bars, which is
                      #   just past the 500 a full weekly ribbon needs
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
    # Explicitly three-way rather than `if D / else 4H`: that shape was correct
    # while 4H was the only other timeframe and would have quietly graded the
    # weekly snapshot against 4H bars.
    if tf == 'D':
        df = pd.read_parquet(_fixture_path(ticker, 'D'))
        df = add_all_indicators(df)
        ma_p = [p for p in MA_PERIODS if p <= len(df)]
    elif tf == 'W':
        # Weekly comes off the SAME frozen daily fixture production resamples
        # from. _resample_weekly's in-progress-week drop is judged against the
        # frame's own last bar, not the wall clock, so this stays deterministic.
        #
        # COVERAGE NOTE: 2600 daily bars is only ~540 weekly bars, and MA500
        # needs 500 of them as warmup — so the weekly golden pins roughly the
        # LAST 40 BARS of each fixture, not a decade like the daily one. It
        # will catch a rule change that moves a recent fire and will not catch
        # one that only bites deeper in history. Widening it means refreezing
        # every fixture, which also rewrites the D and 4H goldens.
        from main import _resample_weekly
        df = _resample_weekly(pd.read_parquet(_fixture_path(ticker, 'D')))
        ma_p = [p for p in MA_PERIODS if p <= len(df)]
        df = add_all_indicators(df, ma_periods=ma_p)
    else:
        from main import _resample_4h
        hourly = pd.read_parquet(_fixture_path(ticker, '1h'))
        df = _resample_4h(hourly)
        ma_p = [p for p in MA_PERIODS if p <= len(df)]
        df = add_all_indicators(df, ma_periods=ma_p)
    # Mirrors the ribbon gate in main.process_instrument, lowered 3 -> 2 on
    # 2026-09-09 with the ribbon cut to [50, 250, 500]. Left at 3 it dropped
    # BTC-USD|W, ETH-USD|W and CRWV|D from the snapshot — the three fixtures
    # whose ribbon is CLIPPED by `p <= len(df)`, i.e. precisely the short-history
    # case the lowered production gate exists to serve. The golden would have
    # stopped covering it while still passing.
    if len(ma_p) < 2:
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
        for tf in ('D', '4H', 'W'):
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
    if _signal_confidence('B1', 'D', 'Currency') != 'low':
        failures.append('confidence lookup did not fall back to TF|CODE')
    if _signal_confidence('B2', 'D', 'Currency') != 'standard':
        failures.append('confidence lookup did not default to standard')
    _signals_mod._conf_loaded = False   # restore lazy loading for golden run
    _signals_mod._conf_tiers = None

    # 4. trend_direction must read the RIBBON, not the MA500 anchor alone
    #    (2026-07-30 bug). The old rule was `UPTREND ⇔ Close > MA500` with
    #    DOWNTREND checked second, so while price stayed above the anchor the
    #    other 19 MAs had no vote and DOWNTREND was unreachable. The golden
    #    snapshot covers primary_signal / established_trend /
    #    confirmation_status only — it never looked at trend_direction, which is
    #    how this survived. Both fixtures below are COMPOUNDING uptrends: that
    #    is what drags MA500 far enough under price for a deep selloff to still
    #    close above the anchor, which is the whole shape of the bug (US100 4H
    #    2026-07-28: close 6% over an anchor drawn from 305 days of bars).
    from indicators import add_ma_ribbon, add_trend

    _rise = list(100 * np.exp(np.linspace(0, 1.6, max(MA_PERIODS) + 400)))
    _fall = list(100 * np.exp(np.linspace(1.6, 0, max(MA_PERIODS) + 400)))

    def _ribbon(closes):
        df = pd.DataFrame({'Close': closes})
        df['Open'] = df['High'] = df['Low'] = df['Close']
        df.index = pd.date_range('2018-01-01', periods=len(df), freq='D')
        p = [q for q in MA_PERIODS if q <= len(df)]
        last = add_trend(add_ma_ribbon(df, p), p).iloc[-1]
        mas = {q: last[f'ma_{q}'] for q in p if pd.notna(last.get(f'ma_{q}'))}
        held = sum(1 for m in mas.values() if last['Close'] > m)
        return last['trend_direction'], held, len(mas), last['Close'] > mas[max(p)]

    def _selloff(frac, bars=30):
        return _rise + list(np.linspace(_rise[-1], _rise[-1] * frac, bars))

    def _rally(frac, bars=40):
        return _fall + list(np.linspace(_fall[-1], _fall[-1] * frac, bars))

    # Selloff that cuts through the ribbon while price is STILL above MA500 —
    # it holds ONLY the anchor. Old rule: UPTREND. Correct: DOWNTREND. This is
    # the 2026-07-30 bug itself, and the one check here that must never be
    # relaxed.
    lbl, held, size, above_anchor = _ribbon(_selloff(0.72))
    if not above_anchor or held > size * TREND_DOWN_FRAC:
        failures.append(f'trend fixture drifted (holds {held}/{size}, above anchor '
                        f'{above_anchor}) — the above-anchor DOWNTREND case is '
                        f'no longer being exercised')
    elif lbl != 'DOWNTREND':
        failures.append(f'price below {size - held} of {size} MAs is not DOWNTREND '
                        f'(got {lbl}) — MA500-only rule regressed')

    # Price INSIDE the ribbon: neither trend. Reached from BELOW — a rally out
    # of a compounding decline that has recovered the fast and mid lines but
    # not the anchor.
    #
    # Rewritten 2026-09-09 with the ribbon cut to [50, 250, 500]. This used to
    # be a shallow selloff holding ~half of twenty MAs, and on three lines
    # "half the ribbon" no longer exists: a selloff that holds 2 of 3 while
    # above the anchor is holding MA250 and MA500 and is below MA50 only, which
    # is the SHALLOW PULLBACK the check below asserts must stay UPTREND — the
    # two fixtures had collapsed onto the same shape. Coming from below
    # separates them again: same "inside the ribbon" fraction, anchor not held.
    lbl, held, size, above_anchor = _ribbon(_rally(1.20))
    if above_anchor or not (size * TREND_DOWN_FRAC < held < size):
        failures.append(f'mid-ribbon fixture drifted (holds {held}/{size}, above '
                        f'anchor {above_anchor})')
    elif lbl != 'NEUTRAL':
        failures.append(f'price inside the ribbon ({held}/{size} held, below the '
                        f'anchor) is not NEUTRAL (got {lbl})')

    # Mirror: an unbroken rise holds every MA and must be UPTREND.
    lbl, held, size, _ = _ribbon(_rise)
    if held != size:
        failures.append(f'rise fixture does not hold the whole ribbon ({held}/{size})')
    elif lbl != 'UPTREND':
        failures.append(f'price above the whole ribbon is not UPTREND (got {lbl})')

    # A shallow dip below the FAST line stays UPTREND — the documented intent:
    # normal retracements must not read as downtrends. Deepened from a 3% /
    # 4-bar dip to 7% / 12 bars on 2026-09-09: the fast line moved 25 -> 50, and
    # a 4-bar dip no longer breaks a 50-bar average at all, so the old fixture
    # had stopped exercising anything (it held the whole ribbon).
    lbl, held, size, _ = _ribbon(_selloff(0.93, bars=12))
    if held >= size:
        failures.append('pullback fixture never dips below the fast MA')
    elif lbl != 'UPTREND':
        failures.append(f'shallow pullback below the fast MA no longer reads '
                        f'UPTREND (got {lbl})')

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
