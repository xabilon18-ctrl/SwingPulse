"""
SwingPulse Backtest Engine — production-parity replay.

Replays signals.add_signals with EXACTLY the parameters main.py uses in
production (per timeframe), simulates a trade on every fire, and aggregates
outcomes per signal code, timeframe, asset class, and instrument.

Reads price data straight from the parquet cache (no network) — run
`python3 main.py` first if the cache is stale.

Usage:
    python3 backtest.py                     # full run, all instruments, write JSON
    python3 backtest.py --quick             # first 30 instruments, no JSON
    python3 backtest.py --signal B1         # only this code (B1/S1/B2/S2/B3/S3/B4/S4)
    python3 backtest.py --since 2016-01-01  # only trades entered on/after this date
    python3 backtest.py --tf D              # one timeframe only (D or 4H)

Outputs:
    output_ma500/backtest_<date>.json   — stats (publish.py ships it as backtest.json)
    confidence_map.json                 — per tf|code|class tier used by signals.py
                                          (written only on unfiltered runs)
"""

import argparse
import concurrent.futures
import glob
import json
import math
import os
import sys
from datetime import date, datetime
from typing import Optional

import pandas as pd

from _active_config import MA_PERIODS, OUTPUT_DIR
from data_fetcher import _cache_path
from indicators import add_all_indicators
from instruments import load_instruments, asset_class_of
from main import _resample_4h
from signals import add_signals

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIDENCE_MAP_PATH = os.path.join(BASE_DIR, 'confidence_map.json')

# ---------------------------------------------------------------------------
# Trade simulation parameters
# ---------------------------------------------------------------------------
ATR_PERIOD     = 14
ATR_STOP_MULT  = 2.0    # stop distance = 2 x ATR(14) at the signal bar
TARGET_R       = 2.0    # 2:1 reward:risk
TIME_STOP_BARS = {'D': 30, '4H': 60}   # exit after N bars regardless
SLIPPAGE_PCT   = 0.0005 # 0.05% slippage per side
MIN_BARS_AHEAD = 5      # need at least 5 bars after signal to evaluate

# Production signal parameters — MUST mirror main.py process_instrument()
TF_SIGNAL_PARAMS = {
    'D':  {'refire_pct': 0.05, 'new_trend_pct': 0.05},
    '4H': {'refire_pct': 0.02, 'new_trend_pct': 0.05},
}

# Confidence-map tiering
CONF_MIN_TRADES = 30
CONF_HIGH_R     = 0.05   # avg R at/above this → high (a real edge at this frequency)
                          # 0 <= avg R < CONF_HIGH_R → standard; below 0 → low


# ---------------------------------------------------------------------------
# ATR
# ---------------------------------------------------------------------------
def _add_atr(df: pd.DataFrame, period: int = ATR_PERIOD) -> pd.DataFrame:
    # Mask corrupt zero-price bars (some Yahoo feeds contain them) so one bad
    # row doesn't blow up the true range for the next `period` bars
    high  = df['High'].where(df['High'] > 0)
    low   = df['Low'].where(df['Low'] > 0)
    close = df['Close'].where(df['Close'] > 0)
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    df['atr'] = tr.rolling(period, min_periods=period).mean()
    return df


# ---------------------------------------------------------------------------
# Single trade simulation
# ---------------------------------------------------------------------------
def simulate_trade(df: pd.DataFrame, entry_idx: int, side: str, tf: str) -> Optional[dict]:
    """
    Simulate one trade entered at the next bar's open with an ATR-based stop.
    Gap opens beyond the stop/target fill at the open (no fantasy fills).
    side: 'long' or 'short'
    """
    if entry_idx + 1 >= len(df):
        return None
    if entry_idx + MIN_BARS_AHEAD >= len(df):
        return None  # not enough forward data

    atr = df['atr'].iloc[entry_idx] if 'atr' in df.columns else float('nan')
    if atr is None or math.isnan(float(atr)) or float(atr) <= 0:
        return None
    atr = float(atr)

    entry_bar = df.iloc[entry_idx + 1]
    entry_price = float(entry_bar['Open'])
    if not (entry_price > 0):   # catches NaN as well as <= 0
        return None

    stop_dist = ATR_STOP_MULT * atr
    if side == 'long':
        entry_price *= (1 + SLIPPAGE_PCT)
        stop   = entry_price - stop_dist
        target = entry_price + stop_dist * TARGET_R
        if stop <= 0:
            return None
    else:  # short
        entry_price *= (1 - SLIPPAGE_PCT)
        stop   = entry_price + stop_dist
        target = entry_price - stop_dist * TARGET_R
        if target <= 0:
            return None

    risk = stop_dist
    time_stop = TIME_STOP_BARS.get(tf, 30)

    # Walk forward bar by bar (entry bar included — its range can hit stop/target)
    end_idx = min(entry_idx + 1 + time_stop, len(df))
    for j in range(entry_idx + 1, end_idx):
        bar  = df.iloc[j]
        o    = float(bar['Open'])
        high = float(bar['High'])
        low  = float(bar['Low'])
        # Skip corrupt bars — some Yahoo feeds (esp. EU/UK tickers) contain
        # zero-price rows, which would read as catastrophic gaps
        if not (o > 0 and high > 0 and low > 0):
            continue
        bars_held = j - (entry_idx + 1) + 1

        if side == 'long':
            # Gap open through stop/target fills at the open
            if j > entry_idx + 1 and o <= stop:
                return _build_outcome(entry_price, o * (1 - SLIPPAGE_PCT), risk, side,
                                      df.index[entry_idx + 1], df.index[j], bars_held, 'gap-stop')
            if j > entry_idx + 1 and o >= target:
                return _build_outcome(entry_price, o * (1 - SLIPPAGE_PCT), risk, side,
                                      df.index[entry_idx + 1], df.index[j], bars_held, 'gap-target')
            if low <= stop:   # conservative: stop checked before target
                return _build_outcome(entry_price, stop * (1 - SLIPPAGE_PCT), risk, side,
                                      df.index[entry_idx + 1], df.index[j], bars_held, 'stop')
            if high >= target:
                return _build_outcome(entry_price, target * (1 - SLIPPAGE_PCT), risk, side,
                                      df.index[entry_idx + 1], df.index[j], bars_held, 'target')
        else:
            if j > entry_idx + 1 and o >= stop:
                return _build_outcome(entry_price, o * (1 + SLIPPAGE_PCT), risk, side,
                                      df.index[entry_idx + 1], df.index[j], bars_held, 'gap-stop')
            if j > entry_idx + 1 and o <= target:
                return _build_outcome(entry_price, o * (1 + SLIPPAGE_PCT), risk, side,
                                      df.index[entry_idx + 1], df.index[j], bars_held, 'gap-target')
            if high >= stop:
                return _build_outcome(entry_price, stop * (1 + SLIPPAGE_PCT), risk, side,
                                      df.index[entry_idx + 1], df.index[j], bars_held, 'stop')
            if low <= target:
                return _build_outcome(entry_price, target * (1 + SLIPPAGE_PCT), risk, side,
                                      df.index[entry_idx + 1], df.index[j], bars_held, 'target')

    # Time stop — exit at the last valid close in the window
    last_idx = end_idx - 1
    exit_price = float('nan')
    while last_idx > entry_idx:
        exit_price = float(df.iloc[last_idx]['Close'])
        if not math.isnan(exit_price) and exit_price > 0:
            break
        last_idx -= 1
    if math.isnan(exit_price) or exit_price <= 0:
        return None
    exit_price *= (1 - SLIPPAGE_PCT) if side == 'long' else (1 + SLIPPAGE_PCT)
    return _build_outcome(entry_price, exit_price, risk, side,
                          df.index[entry_idx + 1], df.index[last_idx],
                          last_idx - (entry_idx + 1) + 1, 'time')


def _build_outcome(entry_price, exit_price, risk, side, entry_date, exit_date,
                   bars_held, exit_reason):
    pnl_pct = (exit_price - entry_price) / entry_price * 100
    if side == 'short':
        pnl_pct = -pnl_pct
    pnl_abs = exit_price - entry_price if side == 'long' else entry_price - exit_price
    r_multiple = pnl_abs / risk if risk > 0 else 0
    return {
        'side': side,
        'entry_price': round(entry_price, 6),
        'exit_price':  round(exit_price, 6),
        'entry_date':  str(entry_date.date()) if hasattr(entry_date, 'date') else str(entry_date),
        'exit_date':   str(exit_date.date())  if hasattr(exit_date,  'date') else str(exit_date),
        'bars_held':   int(bars_held),
        'pnl_pct':     round(pnl_pct, 3),
        'r_multiple':  round(r_multiple, 3),
        'exit_reason': exit_reason,
        'win':         pnl_pct > 0,
    }


# ---------------------------------------------------------------------------
# Edge-audit context — snapshot of the fire bar, no new computation
# ---------------------------------------------------------------------------
def _fire_context(df: pd.DataFrame, i: int, ma_periods: list,
                  other_trend: Optional[pd.Series], fire_tf: str = 'D') -> dict:
    row = df.iloc[i]

    def _num(col, nd=3):
        v = row.get(col)
        try:
            v = float(v)
            return round(v, nd) if not math.isnan(v) else None
        except (TypeError, ValueError):
            return None

    close    = _num('Close', 6)
    anchor_p = ma_periods[-1]
    anchor   = _num(f'ma_{anchor_p}', 6)
    ma_fast  = _num(f'ma_{ma_periods[0]}', 6)
    atr      = _num('atr', 6)
    vol      = _num('Volume', 0)
    vol_avg  = _num('volume_average', 0)

    ctx = {
        'rsi':             _num('rsi', 1),
        'roc':             _num('roc', 2),
        'ribbon_spread':   _num('ribbon_spread', 2),
        'ribbon_slope':    _num('ribbon_slope_pct', 3),
        'ma_order_score':  _num('ma_order_score', 0),
        'pvo':             _num('pvo', 1),
        'pvo_signal':      _num('pvo_signal', 1),
        'rvol':            round(vol / vol_avg, 2) if vol and vol_avg else None,
        'atr_pct':         round(atr / close * 100, 2) if atr and close else None,
        'dist_anchor_pct': round((close - anchor) / anchor * 100, 2) if close and anchor else None,
        'dist_fast_pct':   round((close - ma_fast) / ma_fast * 100, 2) if close and ma_fast else None,
        'anchor_period':   anchor_p,
        'trend':           str(row.get('trend_direction') or ''),
        'established':     str(row.get('established_trend') or ''),
        'trend_age':       int(_num('trend_run_days', 0) or 0),
        'rollover_stage':  int(_num('rollover_stage', 0) or 0),
        'rollover_dir':    str(row.get('rollover_dir') or ''),
    }

    # Other-timeframe trend as it was KNOWN at the fire bar (no look-ahead).
    ctx['other_tf_trend'] = ''
    if other_trend is not None and len(other_trend):
        ts = df.index[i]
        if getattr(ts, 'tz', None) is not None:
            ts = ts.tz_localize(None)
        if fire_tf == '4H':
            # 4H fire intraday: the SAME day's daily bar hasn't closed yet, so
            # take the last daily bar strictly before this calendar day.
            pos = other_trend.index.searchsorted(ts.normalize(), side='left') - 1
        else:
            # D fire: 4H bars all close before the daily close — same-day is safe.
            ts = ts + pd.Timedelta(hours=23, minutes=59)
            pos = other_trend.index.searchsorted(ts, side='right') - 1
        if pos >= 0:
            ctx['other_tf_trend'] = str(other_trend.iloc[pos] or '')
    return ctx


# ---------------------------------------------------------------------------
# Per-timeframe signal replay (production parity)
# ---------------------------------------------------------------------------
def _collect_trades(df: pd.DataFrame, tf: str, name: str, asset_class: str,
                    signal_filter: Optional[set], since: Optional[date],
                    ma_periods: list,
                    other_trend: Optional[pd.Series] = None) -> list[dict]:
    trades = []
    signals_col = df['primary_signal'].to_numpy()
    for i in range(len(df)):
        sig = signals_col[i]
        if not sig:
            continue
        if signal_filter and sig not in signal_filter:
            continue
        bar_date = df.index[i]
        if since and hasattr(bar_date, 'date') and bar_date.date() < since:
            continue
        side = 'long' if sig.startswith('B') else 'short' if sig.startswith('S') else None
        if side is None:
            continue

        outcome = simulate_trade(df, i, side, tf)
        if outcome is None or math.isnan(outcome['r_multiple']) or math.isnan(outcome['pnl_pct']):
            continue
        outcome['instrument'] = name
        outcome['signal']     = sig
        outcome['tf']         = tf
        outcome['class']      = asset_class
        outcome.update(_fire_context(df, i, ma_periods, other_trend, fire_tf=tf))
        trades.append(outcome)
    return trades


def backtest_instrument(ticker: str, name: str, group: str,
                        signal_filter: Optional[set] = None,
                        since: Optional[date] = None,
                        tf_filter: Optional[str] = None) -> list[dict]:
    asset_class = asset_class_of(group)
    frames: dict[str, tuple] = {}

    # ── DAILY — mirror main.py: full-ribbon indicators, clipped-ribbon signals ──
    if tf_filter in (None, 'D'):
        path = _cache_path(ticker)
        if os.path.exists(path):
            df = pd.read_parquet(path)
            if len(df) >= 250:
                df = add_all_indicators(df)
                df = _add_atr(df)
                d_ma_periods = [p for p in MA_PERIODS if p <= len(df)]
                if len(d_ma_periods) >= 3:
                    df = add_signals(df, ma_periods=d_ma_periods,
                                     **TF_SIGNAL_PARAMS['D'])
                    frames['D'] = (df, d_ma_periods)

    # ── 4H — mirror main.py: resample hourly cache, clip ribbon ──
    if tf_filter in (None, '4H'):
        h_path = _cache_path(ticker, suffix='1h')
        if os.path.exists(h_path):
            hourly = pd.read_parquet(h_path)
            if len(hourly) >= 200:
                h4 = _resample_4h(hourly)
                h4_ma_periods = [p for p in MA_PERIODS if p <= len(h4)]
                if len(h4_ma_periods) >= 3:
                    h4 = add_all_indicators(h4, ma_periods=h4_ma_periods)
                    h4 = _add_atr(h4)
                    h4 = add_signals(h4, ma_periods=h4_ma_periods,
                                     **TF_SIGNAL_PARAMS['4H'])
                    frames['4H'] = (h4, h4_ma_periods)

    def _trend_series(tf: str) -> Optional[pd.Series]:
        if tf not in frames:
            return None
        f = frames[tf][0]
        s = f['trend_direction']
        if getattr(s.index, 'tz', None) is not None:
            s = s.copy()
            s.index = s.index.tz_localize(None)
        return s

    trades = []
    for tf in ('D', '4H'):
        if tf not in frames:
            continue
        df, periods = frames[tf]
        other_trend = _trend_series('4H' if tf == 'D' else 'D')
        trades += _collect_trades(df, tf, name, asset_class,
                                  signal_filter, since, periods, other_trend)
    return trades


# ---------------------------------------------------------------------------
# Multiprocessing worker (module-level for pickle)
# ---------------------------------------------------------------------------
def _worker(args: tuple) -> tuple:
    ticker, name, group, sig_filter, since, tf_filter = args
    try:
        trades = backtest_instrument(ticker, name, group, sig_filter, since, tf_filter)
        return name, trades, None
    except Exception as exc:
        return name, [], str(exc)


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------
def _stats(trades: list[dict], label: str) -> dict:
    if not trades:
        return {'label': label, 'total_trades': 0}
    n = len(trades)
    wins = [t for t in trades if t['win']]
    losses = [t for t in trades if not t['win']]
    win_rate = len(wins) / n * 100
    avg_r   = sum(t['r_multiple'] for t in trades) / n
    avg_pct = sum(t['pnl_pct']    for t in trades) / n
    median_bars = sorted(t['bars_held'] for t in trades)[n // 2]
    best  = max(trades, key=lambda t: t['pnl_pct'])
    worst = min(trades, key=lambda t: t['pnl_pct'])
    gross_win  = sum(t['pnl_pct'] for t in wins)
    gross_loss = abs(sum(t['pnl_pct'] for t in losses)) or 1e-9
    profit_factor = gross_win / gross_loss

    # Equity curve in R-multiples (assumes 1R risk per trade), chronological
    equity = 0.0
    peak   = 0.0
    max_dd = 0.0
    for t in sorted(trades, key=lambda t: t['exit_date']):
        equity += t['r_multiple']
        peak = max(peak, equity)
        max_dd = max(max_dd, peak - equity)

    return {
        'label':          label,
        'total_trades':   n,
        'wins':           len(wins),
        'losses':         len(losses),
        'win_rate':       round(win_rate, 1),
        'avg_r':          round(avg_r, 3),
        'avg_pct':        round(avg_pct, 2),
        'profit_factor':  round(profit_factor, 2),
        'median_bars':    median_bars,
        'best_pct':       round(best['pnl_pct'], 2),
        'worst_pct':      round(worst['pnl_pct'], 2),
        'final_r':        round(equity, 2),
        'max_drawdown_r': round(max_dd, 2),
    }


def _group_stats(trades: list[dict], key: str) -> dict:
    groups: dict[str, list] = {}
    for t in trades:
        groups.setdefault(t[key], []).append(t)
    out = {k: _stats(ts, k) for k, ts in groups.items()}
    return dict(sorted(out.items(), key=lambda kv: kv[1].get('avg_r', 0), reverse=True))


def aggregate(trades: list[dict], since: Optional[date]) -> dict:
    if not trades:
        return {'total_trades': 0}

    overall    = _stats(trades, 'ALL')
    by_signal  = _group_stats(trades, 'signal')      # merged across TFs (frontend)
    by_class   = _group_stats(trades, 'class')

    # Per-timeframe: overall + signal breakdown
    by_tf = {}
    for tf in ('D', '4H'):
        tf_trades = [t for t in trades if t['tf'] == tf]
        if tf_trades:
            by_tf[tf] = {
                'overall':   _stats(tf_trades, tf),
                'by_signal': _group_stats(tf_trades, 'signal'),
                'by_class':  _group_stats(tf_trades, 'class'),
            }

    # Per-instrument: overall + signal breakdown (modal Track Record)
    by_instrument = {}
    inst_groups: dict[str, list] = {}
    for t in trades:
        inst_groups.setdefault(t['instrument'], []).append(t)
    for inst, ts in inst_groups.items():
        by_instrument[inst] = {
            'overall':   _stats(ts, inst),
            'by_signal': _group_stats(ts, 'signal'),
        }

    # Combined equity curve, downsampled to <= 2000 points
    sorted_trades = sorted(trades, key=lambda t: t['exit_date'])
    curve = []
    cum = 0.0
    for t in sorted_trades:
        cum += t['r_multiple']
        curve.append({'date': t['exit_date'], 'r': round(cum, 2), 'trade_r': t['r_multiple']})
    if len(curve) > 2000:
        step = len(curve) / 2000
        curve = [curve[int(i * step)] for i in range(2000)] + [curve[-1]]

    return {
        'overall':       overall,
        'by_signal':     by_signal,
        'by_tf':         by_tf,
        'by_class':      by_class,
        'by_instrument': by_instrument,
        'equity_curve':  curve,
        'params': {
            'stop_model':     f'{ATR_STOP_MULT:g}xATR{ATR_PERIOD}',
            'target_r':       TARGET_R,
            'time_stop_bars': TIME_STOP_BARS,
            'slippage_pct':   SLIPPAGE_PCT,
            'since':          str(since) if since else 'full history',
            'engine':         'production-parity add_signals',
        },
        'sample_size_warning': overall['total_trades'] < 30,
        'generated_at': datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC'),
    }


# ---------------------------------------------------------------------------
# Confidence map — consumed by signals._signal_confidence
# ---------------------------------------------------------------------------
def _tier(avg_r: float) -> str:
    if avg_r >= CONF_HIGH_R:
        return 'high'
    if avg_r >= 0.0:
        return 'standard'
    return 'low'


def write_confidence_map(trades: list[dict], results: dict) -> None:
    """Write per tf|code|class tiers (plus tf|code fallbacks) for signals.py."""
    cells: dict[str, list] = {}
    for t in trades:
        cells.setdefault(f"{t['tf']}|{t['signal']}|{t['class']}", []).append(t)
        cells.setdefault(f"{t['tf']}|{t['signal']}", []).append(t)

    tiers = {}
    for key, ts in cells.items():
        if len(ts) < CONF_MIN_TRADES:
            continue
        s = _stats(ts, key)
        tiers[key] = {
            'n':        s['total_trades'],
            'win_rate': s['win_rate'],
            'avg_r':    s['avg_r'],
            'tier':     _tier(s['avg_r']),
        }

    payload = {
        'generated_at': results['generated_at'],
        'params':       results['params'],
        'min_trades':   CONF_MIN_TRADES,
        'high_r':       CONF_HIGH_R,
        'tiers':        tiers,
    }
    with open(CONFIDENCE_MAP_PATH, 'w') as f:
        json.dump(payload, f, indent=1)
    print(f'✓ Confidence map: {len(tiers)} cells → {CONFIDENCE_MAP_PATH}')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', default='ma500', help='Config profile (default: ma500)')
    parser.add_argument('--quick',  action='store_true', help='Test 30 instruments only')
    parser.add_argument('--signal', help='Only test this signal code (B1/S1/B2/S2/B3/S3/B4/S4)')
    parser.add_argument('--since',  help='Only trades entered on/after this date (YYYY-MM-DD)')
    parser.add_argument('--tf',     choices=['D', '4H'], help='Only this timeframe')
    parser.add_argument('--workers', type=int, default=min(os.cpu_count() or 4, 8))
    parser.add_argument('--no-save', action='store_true')
    args = parser.parse_args()

    instruments = load_instruments()
    if args.quick:
        instruments = instruments[:30]

    sig_filter = {args.signal} if args.signal else None
    since = datetime.strptime(args.since, '%Y-%m-%d').date() if args.since else None

    print(f'Backtesting {len(instruments)} instruments '
          f'(stop={ATR_STOP_MULT:g}xATR{ATR_PERIOD}, target={TARGET_R:g}R, '
          f'time={TIME_STOP_BARS}, tf={args.tf or "D+4H"}, since={since or "all"})')
    print('─' * 70)

    worker_args = [
        (inst['ticker'], inst['name'], inst.get('group', ''), sig_filter, since, args.tf)
        for inst in instruments
    ]

    all_trades: list[dict] = []
    errors = 0
    done = 0
    with concurrent.futures.ProcessPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(_worker, a): a[1] for a in worker_args}
        for fut in concurrent.futures.as_completed(futures):
            name, trades, err = fut.result()
            done += 1
            if err:
                errors += 1
                print(f'  [{done:3d}/{len(worker_args)}] {name:<15} ✘ {err}')
            else:
                all_trades.extend(trades)
                print(f'  [{done:3d}/{len(worker_args)}] {name:<15} {len(trades):>5} trades')

    print('─' * 70)
    if errors:
        print(f'⚠  {errors} instruments errored')
    results = aggregate(all_trades, since)

    if not all_trades:
        print('No trades generated — is the parquet cache populated?')
        sys.exit(1)

    # Pretty print summary
    print(f'\nOverall: {results["overall"]["total_trades"]} trades, '
          f'{results["overall"].get("win_rate", 0)}% win rate, '
          f'avg R: {results["overall"].get("avg_r", 0)}, '
          f'PF: {results["overall"].get("profit_factor", 0)}')

    for tf, blk in results.get('by_tf', {}).items():
        print(f'\n[{tf}] {blk["overall"]["total_trades"]} trades, '
              f'{blk["overall"]["win_rate"]}% win, avg R {blk["overall"]["avg_r"]}')
        print(f'  {"Signal":<7} {"Trades":>7} {"Win%":>7} {"Avg R":>7} {"PF":>7} {"Final R":>9} {"Max DD":>8}')
        for sig, s in blk['by_signal'].items():
            print(f'  {sig:<7} {s["total_trades"]:>7} {s["win_rate"]:>6.1f}% '
                  f'{s["avg_r"]:>7.3f} {s["profit_factor"]:>7.2f} '
                  f'{s["final_r"]:>9.2f} {s["max_drawdown_r"]:>8.2f}')

    print('\nBy asset class:')
    for cls, s in results['by_class'].items():
        print(f'  {cls:<10} {s["total_trades"]:>7} trades  {s["win_rate"]:>5.1f}% win  '
              f'avg R {s["avg_r"]:>7.3f}  PF {s["profit_factor"]:>5.2f}')

    if results.get('sample_size_warning'):
        print('\n⚠  Small sample size (<30 trades). Stats may not be reliable.')

    # Save JSON output
    if not args.no_save:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        out_path = os.path.join(OUTPUT_DIR, f'backtest_{date.today()}.json')
        with open(out_path, 'w') as f:
            json.dump({**results, 'trades': all_trades[-200:]}, f, default=str)
        print(f'\n✓ Saved to {out_path}')

        # Confidence map only from complete runs (all codes, both TFs)
        if not sig_filter and not args.tf and not args.quick:
            write_confidence_map(all_trades, results)

            # Edge-audit dataset: every trade with its fire-bar context snapshot
            edge_path = os.path.join(OUTPUT_DIR, f'edge_audit_{date.today()}.csv.gz')
            pd.DataFrame(all_trades).to_csv(edge_path, index=False, compression='gzip')
            print(f'✓ Edge-audit dataset: {len(all_trades)} trades → {edge_path}')


if __name__ == '__main__':
    main()
