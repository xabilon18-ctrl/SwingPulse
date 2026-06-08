"""
SwingPulse Backtest Engine

Replays the existing signal-generation pipeline on historical data,
simulates trades when BP/SP signals fire, and aggregates outcomes.

Usage:
    python3 backtest.py                    # full run, all instruments, write JSON
    python3 backtest.py --quick            # 30 instruments, no JSON output
    python3 backtest.py --signal BP1       # only test BP1 signals
    python3 backtest.py --since 2023-01-01 # only signals after this date

Output (output/backtest_<date>.json):
    Per-signal-type stats: trade count, win rate, avg R, profit factor,
    median holding period, best/worst trade, equity-curve milestones.
"""

import argparse
import json
import os
import sys
from datetime import date, datetime
from typing import Optional

import pandas as pd

from _active_config import (
    MAX_PENETRATION_DAILY, OUTPUT_DIR,
)
from data_fetcher import fetch
from indicators import add_all_indicators
from instruments import load_instruments
from key_levels import find_key_levels
from signals import add_signals


# ---------------------------------------------------------------------------
# Trade simulation parameters
# ---------------------------------------------------------------------------
STOP_PCT          = 0.02   # 2% stop loss from entry
TARGET_R          = 2.0    # 2:1 reward:risk
TIME_STOP_BARS    = 30     # exit after 30 bars regardless
SLIPPAGE_PCT      = 0.0005 # 0.05% slippage per side
MIN_BARS_AHEAD    = 5      # need at least 5 bars after signal to evaluate


# ---------------------------------------------------------------------------
# Single trade simulation
# ---------------------------------------------------------------------------
def simulate_trade(df: pd.DataFrame, entry_idx: int, side: str) -> Optional[dict]:
    """
    Simulate one trade entered at next bar's open. Returns outcome dict or None.
    side: 'long' or 'short'
    """
    if entry_idx + 1 >= len(df):
        return None
    if entry_idx + MIN_BARS_AHEAD >= len(df):
        return None  # not enough forward data

    entry_bar = df.iloc[entry_idx + 1]
    entry_price = float(entry_bar['Open'])
    if entry_price <= 0:
        return None

    # Apply slippage
    if side == 'long':
        entry_price *= (1 + SLIPPAGE_PCT)
        stop  = entry_price * (1 - STOP_PCT)
        target = entry_price * (1 + STOP_PCT * TARGET_R)
    else:  # short
        entry_price *= (1 - SLIPPAGE_PCT)
        stop  = entry_price * (1 + STOP_PCT)
        target = entry_price * (1 - STOP_PCT * TARGET_R)

    risk = abs(entry_price - stop)

    # Walk forward bar by bar
    end_idx = min(entry_idx + 1 + TIME_STOP_BARS, len(df))
    for j in range(entry_idx + 1, end_idx):
        bar = df.iloc[j]
        high = float(bar['High'])
        low  = float(bar['Low'])

        if side == 'long':
            if low <= stop:
                exit_price = stop * (1 - SLIPPAGE_PCT)
                return _build_outcome(entry_price, exit_price, risk, side,
                                       df.index[entry_idx + 1], df.index[j],
                                       j - (entry_idx + 1) + 1, 'stop')
            if high >= target:
                exit_price = target * (1 - SLIPPAGE_PCT)
                return _build_outcome(entry_price, exit_price, risk, side,
                                       df.index[entry_idx + 1], df.index[j],
                                       j - (entry_idx + 1) + 1, 'target')
        else:
            if high >= stop:
                exit_price = stop * (1 + SLIPPAGE_PCT)
                return _build_outcome(entry_price, exit_price, risk, side,
                                       df.index[entry_idx + 1], df.index[j],
                                       j - (entry_idx + 1) + 1, 'stop')
            if low <= target:
                exit_price = target * (1 + SLIPPAGE_PCT)
                return _build_outcome(entry_price, exit_price, risk, side,
                                       df.index[entry_idx + 1], df.index[j],
                                       j - (entry_idx + 1) + 1, 'target')

    # Time stop — exit at last close
    last_idx = end_idx - 1
    exit_price = float(df.iloc[last_idx]['Close'])
    if side == 'long':
        exit_price *= (1 - SLIPPAGE_PCT)
    else:
        exit_price *= (1 + SLIPPAGE_PCT)
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
# Per-instrument backtest
# ---------------------------------------------------------------------------
def backtest_instrument(ticker: str, name: str,
                         signal_filter: Optional[set] = None,
                         since: Optional[date] = None) -> list[dict]:
    df = fetch(ticker)
    if df is None or len(df) < 250:
        return []

    df = add_all_indicators(df)
    levels = find_key_levels(df)
    df = add_signals(df, max_penetration=MAX_PENETRATION_DAILY, key_levels_df=levels)

    trades = []
    for i in range(len(df)):
        sig = df.iloc[i].get('primary_signal', '')
        if not sig:
            continue
        if signal_filter and sig not in signal_filter:
            continue
        bar_date = df.index[i]
        if since and hasattr(bar_date, 'date') and bar_date.date() < since:
            continue
        status = (df.iloc[i].get('confirmation_status', '') or '').lower()
        side = 'long' if 'buy' in status else 'short' if 'sell' in status else None
        if side is None:
            continue

        outcome = simulate_trade(df, i, side)
        if outcome is None:
            continue
        outcome['instrument'] = name
        outcome['signal']     = sig
        outcome['confidence'] = df.iloc[i].get('signal_confidence', '')
        trades.append(outcome)

    return trades


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------
def aggregate(trades: list[dict]) -> dict:
    if not trades:
        return {'total_trades': 0}

    by_signal: dict[str, list] = {}
    by_instrument: dict[str, list] = {}
    for t in trades:
        by_signal.setdefault(t['signal'], []).append(t)
        by_instrument.setdefault(t['instrument'], []).append(t)

    overall = _stats(trades, 'ALL')
    per_signal = {sig: _stats(ts, sig) for sig, ts in by_signal.items()}
    per_signal = dict(sorted(per_signal.items(),
                             key=lambda kv: kv[1].get('avg_r', 0),
                             reverse=True))

    # Per-instrument: overall stats + signal-type breakdown
    per_instrument = {}
    for inst, inst_trades in by_instrument.items():
        inst_by_sig: dict[str, list] = {}
        for t in inst_trades:
            inst_by_sig.setdefault(t['signal'], []).append(t)
        per_instrument[inst] = {
            'overall':   _stats(inst_trades, inst),
            'by_signal': {sig: _stats(ts, sig) for sig, ts in inst_by_sig.items()},
        }

    # Equity curve (R-multiples over time, oldest → newest)
    sorted_trades = sorted(trades, key=lambda t: t['exit_date'])
    equity_curve = []
    cum = 0.0
    for t in sorted_trades:
        cum += t['r_multiple']
        equity_curve.append({'date': t['exit_date'], 'r': round(cum, 2), 'trade_r': t['r_multiple']})

    return {
        'overall': overall,
        'by_signal': per_signal,
        'by_instrument': per_instrument,
        'equity_curve': equity_curve,
        'sample_size_warning': overall['total_trades'] < 30,
        'generated_at': datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC'),
    }


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

    # Equity curve in R-multiples (assumes 1R risk per trade)
    equity = 0.0
    peak   = 0.0
    max_dd = 0.0
    for t in trades:
        equity += t['r_multiple']
        peak = max(peak, equity)
        dd = peak - equity
        max_dd = max(max_dd, dd)

    return {
        'label':         label,
        'total_trades':  n,
        'wins':          len(wins),
        'losses':        len(losses),
        'win_rate':      round(win_rate, 1),
        'avg_r':         round(avg_r, 3),
        'avg_pct':       round(avg_pct, 2),
        'profit_factor': round(profit_factor, 2),
        'median_bars':   median_bars,
        'best_pct':      round(best['pnl_pct'], 2),
        'worst_pct':     round(worst['pnl_pct'], 2),
        'final_r':       round(equity, 2),
        'max_drawdown_r':round(max_dd, 2),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', default='default', help='Config profile: default | ma200')
    parser.add_argument('--quick',  action='store_true', help='Test 30 instruments only')
    parser.add_argument('--signal', help='Only test this signal type (BP1/SP1/BP2/SP2/BP3/SP3/BP4/SP4)')
    parser.add_argument('--since',  help='Only signals after this date (YYYY-MM-DD)')
    parser.add_argument('--no-save', action='store_true')
    args = parser.parse_args()

    instruments = load_instruments()
    if args.quick:
        instruments = instruments[:30]

    sig_filter = {args.signal} if args.signal else None
    since = datetime.strptime(args.since, '%Y-%m-%d').date() if args.since else None

    print(f'Backtesting {len(instruments)} instruments (rules: stop={STOP_PCT*100}%, R={TARGET_R}, time={TIME_STOP_BARS} bars)')
    print('─' * 70)

    all_trades = []
    for i, inst in enumerate(instruments, 1):
        ticker = inst['ticker']
        name   = inst['name']
        print(f'  [{i:>3}/{len(instruments)}] {name:<10} {ticker:<12} ', end='', flush=True)
        try:
            trades = backtest_instrument(ticker, name, sig_filter, since)
            all_trades.extend(trades)
            print(f'{len(trades):>4} trades')
        except Exception as e:
            print(f'  ✘ {e}')

    print('─' * 70)
    results = aggregate(all_trades)

    # Pretty print summary
    print(f'\nOverall: {results["overall"]["total_trades"]} trades, '
          f'{results["overall"].get("win_rate", 0)}% win rate, '
          f'avg R: {results["overall"].get("avg_r", 0)}, '
          f'PF: {results["overall"].get("profit_factor", 0)}')
    print('\nBy signal type:')
    print(f'  {"Signal":<7} {"Trades":>7} {"Win%":>7} {"Avg R":>7} {"PF":>7} {"Final R":>9} {"Max DD":>8}')
    for sig, s in results['by_signal'].items():
        print(f'  {sig:<7} {s["total_trades"]:>7} {s["win_rate"]:>6.1f}% '
              f'{s["avg_r"]:>7.3f} {s["profit_factor"]:>7.2f} '
              f'{s["final_r"]:>9.2f} {s["max_drawdown_r"]:>8.2f}')

    if results.get('sample_size_warning'):
        print('\n⚠  Small sample size (<30 trades). Stats may not be reliable.')

    # Save JSON output
    if not args.no_save and all_trades:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        out_path = os.path.join(OUTPUT_DIR, f'backtest_{date.today()}.json')
        with open(out_path, 'w') as f:
            json.dump({**results, 'trades': all_trades[-500:]}, f, indent=2, default=str)
        print(f'\n✓ Saved to {out_path}')


if __name__ == '__main__':
    main()
