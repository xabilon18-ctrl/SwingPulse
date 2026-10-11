"""Daily/4H closed-bar signal rules for the shared SwingPulse workflow.

No Daily-direction gate is applied to 4H: a native sell can be a minor move
inside a Daily uptrend, and the mirrored buy is equally eligible.
"""
import math
import pandas as pd

RULE_VERSION = 'daily500-4h-v1'
CODES = {'B1', 'S1', 'B2', 'S2', 'B3', 'S3', 'B4', 'S4'}


def add_workflow_signals(frame, tf='D'):
    """Caller supplies completed bars. Keep legacy research rules unchanged."""
    df = frame.copy()
    for period in (50, 250, 500):
        df[f'ma_{period}'] = df.Close.rolling(period, min_periods=period).mean()
    legacy = None
    if {'Open', 'High', 'Low'}.issubset(df.columns):
        from signals import add_signals
        legacy = add_signals(df, ma_periods=[50, 250, 500], refire_pct=0.0,
                             tf=RULE_VERSION + '-' + tf)
    direction, run = '', 0
    directions, runs, codes, descriptions = [], [], [], []
    for i, (close, anchor) in enumerate(zip(df.Close.to_numpy(), df.ma_500.to_numpy())):
        code, description = '', 'Daily MA500 history unavailable' if tf == 'D' else 'Native MA500 history unavailable'
        if pd.notna(close) and pd.notna(anchor):
            equal = math.isclose(float(close), float(anchor), rel_tol=1e-12, abs_tol=1e-12)
            next_direction = direction if equal else 'UPTREND' if close > anchor else 'DOWNTREND'
            changed = next_direction != direction
            if direction and changed:
                code = 'B1' if next_direction == 'UPTREND' else 'S1'
            direction = next_direction
            run = 1 if changed else run + 1 if direction else 0
            if not code and legacy is not None:
                candidate = str(legacy.primary_signal.iloc[i])
                if candidate in CODES - {'B1', 'S1'}:
                    if (candidate.startswith('B') and close > anchor) or (candidate.startswith('S') and close < anchor):
                        code = candidate
            role = 'Daily main trend' if tf == 'D' else '4H direction'
            description = f'{role}: {direction.lower() or "unavailable"}'
            if code in ('B1', 'S1'):
                description += ' — completed close crossed MA500'
            elif code:
                description += f' — {code} pullback'
            directions.append(direction)
        else:
            directions.append('')
        runs.append(run if directions[-1] else 0)
        codes.append(code)
        descriptions.append(description)
    df['primary_signal'] = codes
    df['signal_confidence'] = ['standard' if code else '' for code in codes]
    df['confirmation_status'] = descriptions
    df['established_trend'] = directions
    df['trend_direction'] = [direction or 'NEUTRAL' for direction in directions]
    df['trend_run_days'] = runs
    df['watch_flag'] = ''
    df['potential_turning_point_flag'] = ''
    df['new_trend_flag'] = [code in ('B1', 'S1') for code in codes]
    df['signal_rule_version'] = RULE_VERSION
    return df
