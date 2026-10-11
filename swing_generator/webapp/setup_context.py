"""Completed higher-timeframe references and 4H swing context.

Chart overlay projections never enter these calculations. W50 means fifty
weekly closes; M50 means fifty monthly closes. No substitute periods are used.
"""
from bisect import bisect_right
import math
import pandas as pd


def reference_history(frame, now=None):
    now = pd.Timestamp(now or pd.Timestamp.now(tz='UTC'))
    now = now.tz_localize('UTC') if now.tzinfo is None else now.tz_convert('UTC')
    f = frame.copy()
    f.index = pd.to_datetime(f.index, utc=True)
    f = f.loc[f.index + pd.Timedelta(days=1) <= now]
    if f.empty:
        return {}
    close = f.Close
    previous = close.shift()
    atr = pd.concat([f.High-f.Low, (f.High-previous).abs(), (f.Low-previous).abs()], axis=1).max(axis=1).rolling(14).mean()
    series = {'ATR': atr}
    series.update({f'D{p}': close.rolling(p, min_periods=p).mean() for p in (50, 250, 500)})
    # Match the chart's W-FRI and calendar-month bars, excluding live periods.
    for tf, rule, periods in [('W', 'W-FRI', (50, 250, 500)), ('M', pd.offsets.MonthEnd(), (50,))]:
        higher = close.resample(rule).last().dropna()
        higher = higher.loc[higher.index + pd.Timedelta(days=1) <= now]
        for p in periods:
            series[f'{tf}{p}'] = higher.rolling(p, min_periods=p).mean()
    cutoff = now - pd.Timedelta(days=90)
    result = {}
    for label, values in series.items():
        values = values.dropna()
        values.index += pd.Timedelta(days=1)  # earliest time the bar is confirmed
        older, recent = values.loc[values.index < cutoff], values.loc[values.index >= cutoff]
        values = pd.concat([older.tail(1), recent])
        result[label] = [[int(t.timestamp()), float(v)] for t, v in values.items() if math.isfinite(v)]
    return result


def _at(history, stamp):
    values = {}
    seconds = int(pd.Timestamp(stamp, tz='UTC').timestamp()) if isinstance(stamp, str) else int(stamp.timestamp())
    for label, points in history.items():
        i = bisect_right(points, [seconds, math.inf]) - 1
        if i >= 0:
            values[label] = points[i][1]
    return values


def level_interactions(bundle, history, hours, now):
    """Closed-candle crossings and rejections, with each reference named.

    Daily, Weekly and Monthly references receive the same treatment. A touch
    alone is context, not a rejection or an entry confirmation.
    """
    result, previous = [], None
    for i, stamp in enumerate(bundle['t']):
        start = pd.Timestamp(stamp, tz='UTC')
        end = start + pd.Timedelta(hours=hours)
        if end > now or end < now-pd.Timedelta(days=7):
            continue
        refs = _at(history, end)
        analysis = bundle.get('analysis') or bundle
        price, high, low = analysis['c'][i], analysis['h'][i], analysis['l'][i]
        if previous:
            prev_price, prev_refs = previous
            for label, value in refs.items():
                before = prev_refs.get(label)
                if label == 'ATR' or before is None:
                    continue
                up = prev_price <= before and price > value
                down = prev_price >= before and price < value
                touched = low <= value <= high
                reject_up = touched and prev_price > before and price > value
                reject_down = touched and prev_price < before and price < value
                if not (up or down or reject_up or reject_down):
                    continue
                result.append({'at':stamp, 'kind':'cross' if up or down else 'rejection',
                               'direction':'UPTREND' if up or reject_up else 'DOWNTREND',
                               'reference':label, 'period':int(label[1:]),
                               'level':value, 'price':price})
        previous = price, refs
    return result


def attach_setup_context(built, now=None):
    now = pd.Timestamp(now or pd.Timestamp.now(tz='UTC'))
    now = now.tz_localize('UTC') if now.tzinfo is None else now.tz_convert('UTC')
    for name, daily in built.get('D', {}).items():
        history = daily.get('references', {})
        if not history:
            continue
        h4 = built.get('4H', {}).get(name)
        if not h4:
            continue
        bars = []
        for i, stamp in enumerate(h4['t']):
            t = pd.Timestamp(stamp, tz='UTC')
            end = t + pd.Timedelta(hours=4)
            if end > now or end < now-pd.Timedelta(days=85):
                continue
            refs = _at(history, end)
            analysis = h4.get('analysis') or h4
            bars.append({'at': stamp, 'close': analysis['c'][i], 'high': analysis['h'][i],
                         'low': analysis['l'][i], 'refs': refs})
        if not bars:
            continue
        last, previous = bars[-1], bars[-2] if len(bars)>1 else None
        refs = last['refs']
        events = []
        for prev, cur in zip(bars, bars[1:]):
            before, after = prev['refs'].get('D50'), cur['refs'].get('D50')
            if before is None or after is None:
                continue
            up = prev['close'] <= before and cur['close'] > after
            down = prev['close'] >= before and cur['close'] < after
            if up or down:
                events.append({'at':cur['at'], 'kind':'daily50-cross',
                               'direction':'UPTREND' if up else 'DOWNTREND',
                               'price':cur['close'], 'level':after})
        # Smaller swings against the main trend can begin at D50, before
        # the native 4H MA500 is crossed. This never changes the Daily trend.
        main = daily.get('context', {}).get('direction')
        d50 = refs.get('D50')
        candidate = None
        if d50 is not None and main in ('UPTREND', 'DOWNTREND'):
            side = 'UPTREND' if last['close'] > d50 else 'DOWNTREND' if last['close'] < d50 else None
            if side and side != main:
                candidate = next((e for e in reversed(events) if e['direction']==side), None)
        context = h4.setdefault('context', {})
        context['swingDirection'] = candidate['direction'] if candidate else context.get('direction')
        context['setup'] = {
            'asOf': last['at'], 'price':last['close'], 'high':last['high'], 'low':last['low'],
            'previousClose':previous['close'] if previous else None,
            'atr':refs.get('ATR'),
            'levels':[{'id':k, 'tf':k[0], 'period':int(k[1:]), 'value':v,
                       'previous':previous['refs'].get(k) if previous else None}
                      for k,v in refs.items() if k != 'ATR'],
            'minorOpportunity':candidate,
            'events':[e for e in events if pd.Timestamp(e['at'],tz='UTC') >= now-pd.Timedelta(days=5)]}
        context['setup']['interactions'] = level_interactions(h4, history, 4, now)[-40:]
        h1 = built.get('1H', {}).get(name)
        if h1:
            h1.setdefault('context', {})['entries'] = level_interactions(h1, history, 1, now)[-40:]
