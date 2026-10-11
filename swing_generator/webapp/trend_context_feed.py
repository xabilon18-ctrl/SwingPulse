"""Completed-bar trend context shared by every SwingPulse screen.

The Daily 500 defines the main trend; each smaller chart uses its own 500
for direction. Channel geometry and MA ordering are separate observations.
"""
from __future__ import annotations

import math
import pandas as pd

UP, DOWN, UNKNOWN = 'UPTREND', 'DOWNTREND', 'NEUTRAL'


def _num(value):
    return float(value) if value is not None and math.isfinite(float(value)) else None


def frame_context(frame, tf, now=None):
    """Use full, unrounded history; never a projected MA or a forming candle."""
    now = pd.Timestamp(now) if now is not None else pd.Timestamp.now(tz='UTC')
    now = now.tz_localize('UTC') if now.tzinfo is None else now.tz_convert('UTC')
    times = pd.to_datetime(frame.index, utc=True)
    duration = pd.Timedelta(days=1) if tf == 'D' else pd.Timedelta(hours=4 if tf == '4H' else 1)
    closed = frame.loc[times + duration <= now]
    if closed.empty:
        return {'direction': UNKNOWN, 'asOf': None, 'mas': {}, 'events': []}
    close = closed['Close']
    mas = {p: close.rolling(p, min_periods=p).mean() for p in (50, 250, 500)}
    direction, since, events = UNKNOWN, None, []
    # Equality retains the last confirmed side. A missing average cannot
    # create a trend, and the first available side is not a crossover alert.
    for stamp, price, average in zip(closed.index, close, mas[500]):
        if pd.isna(price) or pd.isna(average):
            continue
        equal = math.isclose(float(price), float(average), rel_tol=1e-12, abs_tol=1e-12)
        next_direction = direction if equal else UP if price > average else DOWN
        if next_direction != direction:
            since = pd.Timestamp(stamp).strftime('%Y-%m-%d' if tf == 'D' else '%Y-%m-%d %H:%M')
            if direction != UNKNOWN:
                events.append({'at': since, 'code': 'B1' if next_direction == UP else 'S1',
                               'price': float(price), 'ma500': float(average)})
            direction = next_direction
    values = {str(p): _num(s.iloc[-1]) for p, s in mas.items() if pd.notna(s.iloc[-1])}
    if pd.isna(close.iloc[-1]) or '500' not in values:
        direction, since = UNKNOWN, None
    stack = None
    if len(values) == 3:
        a, b, c = (values[str(p)] for p in (50, 250, 500))
        state = 'BULL' if a > b > c else 'BEAR' if a < b < c else 'MIXED'
        pairs = [(abs(values[str(a)] - values[str(b)]) / abs(values[str(b)]) * 100, f'{a}x{b}')
                 for a, b in ((50, 250), (250, 500), (50, 500)) if values[str(b)] != 0]
        gap, pair = min(pairs) if pairs else (None, '')
        state_history = pd.Series('MIXED', index=closed.index)
        state_history[(mas[50] > mas[250]) & (mas[250] > mas[500])] = 'BULL'
        state_history[(mas[50] < mas[250]) & (mas[250] < mas[500])] = 'BEAR'
        warm = mas[500].notna()
        changes = state_history[warm].ne(state_history[warm].shift())
        changed = changes.index[changes]
        flip = len(closed) - 1 - closed.index.get_loc(changed[-1]) if len(changed) else None
        stack = {'state': state, 'gap': gap, 'pair': pair, 'flip': flip}
    # The chart feed and production rows use the exact same signal engine.
    if tf in ('D', '4H'):
        from workflow_signals import add_workflow_signals
        signalled = add_workflow_signals(closed, tf=tf)
        events = [{'at': pd.Timestamp(stamp).strftime('%Y-%m-%d' if tf == 'D' else '%Y-%m-%d %H:%M'),
                   'code': row.primary_signal, 'price': float(row.Close)}
                  for stamp, row in signalled[signalled.primary_signal.ne('')].iterrows()]
    return {'direction': direction, 'asOf': pd.Timestamp(closed.index[-1]).strftime('%Y-%m-%d' if tf == 'D' else '%Y-%m-%d %H:%M'),
            'since': since, 'close': _num(close.iloc[-1]), 'mas': values, 'stack': stack,
            'events': events[-60:]}


def workflow_context(built):
    """Compact all-instrument context; no per-chart downloads needed for filters."""
    return {tf: {name: b['context'] for name, b in built.get(tf, {}).items() if b.get('context')}
            for tf in ('D', '4H', '1H')}


def workflow_alerts(built, now=None):
    """Independent Daily/4H signals; 1H MA interactions are entry context."""
    now = pd.Timestamp(now) if now is not None else pd.Timestamp.now(tz='UTC')
    now = now.tz_localize('UTC') if now.tzinfo is None else now.tz_convert('UTC')
    ev = []
    for tf in ('D', '4H'):
        cutoff = now - pd.Timedelta(days=10 if tf == 'D' else 5)
        for name, b in built.get(tf, {}).items():
            for e in b.get('context', {}).get('events', []):
                stamp = pd.Timestamp(e['at'], tz='UTC')
                if stamp < cutoff:
                    continue
                ev.append([name, tf, e['code'], 500 if e['code'] in ('B1', 'S1') else 0,
                           1 if e['code'].startswith('B') else -1, e['at'], e['price'], None, None, None])
    # Current entry context is explicitly separate from historical setup events.
    # These are completed 1H interactions, not a second independent signal stream.
    entries = {}
    for name, b in built.get('1H', {}).items():
        h4 = built.get('4H', {}).get(name, {}).get('context', {})
        direction = h4.get('swingDirection') or h4.get('direction')
        if direction not in (UP, DOWN):
            continue
        if 'entries' in b.get('context', {}):
            matches = [e for e in b['context']['entries'] if e['direction'] == direction]
            if matches:
                entries[name] = sorted(matches, key=lambda e: e['at'], reverse=True)[:3]
            continue
        matches = []
        for i, kind, period, side, value in b.get('xm', []):
            if not 0 <= i < len(b['c']):
                continue
            prev, current = b['c'][i - 1] if i else None, b['c'][i]
            crossed = prev is not None and current is not None and value is not None and (prev-value)*(current-value) < 0
            j = i + 1 if kind == 'after' or crossed else i
            if j >= len(b['t']):
                continue
            stamp = pd.Timestamp(b['t'][j], tz='UTC')
            if stamp + pd.Timedelta(hours=1) > now or stamp < now - pd.Timedelta(days=5):
                continue
            dr = UP if (side == 'up' if kind == 'after' else side == 'dn') else DOWN
            if dr != direction:
                continue
            matches.append({'at': b['t'][j], 'kind': 'cross' if kind == 'after' else 'touch',
                            'period': period, 'level': value, 'price': b['c'][j], 'direction': dr})
        if matches:
            entries[name] = sorted(matches, key=lambda e: e['at'], reverse=True)[:3]
    ev.sort(key=lambda e: e[5], reverse=True)
    ev.sort(key=lambda e: 0 if e[1] == 'D' and e[2] in ('B1', 'S1') else 1)
    return {'workflow_version': 1, 'workflow_ev': ev, 'linked_entries': entries}
