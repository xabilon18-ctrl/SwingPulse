"""THE USER'S TREND RULE — one implementation for the channels on the charts AND
the uptrend / downtrend / neutral counts (2026-10-04).

User: "this is how i see trends ... not any other way and this is what need to be
used to measure how many instruments are in an uptrend, downtrend or neutral".
Measured from the user's own channels; see tools/place_channels.py for the rule in
words and memory note user-channel-placement-rule for the numbers. Used by:
  tools/place_channels.py        draws the channels (purple, seed:1) into the app
  webapp/chart_feed.py           writes trend_channels.json -> app effectiveTrend()
Change the rule HERE only, or the lines and the counts drift apart.

A bundle is a chart_feed bundle: t (bar labels), h, l, c, p (MA periods, slowest last).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

GAP = 0.03            # trend-side edge sits this share of the width outside the slow line
LEG_MIN = 0.2         # leg start searched between LEG_MIN and LEG_MAX x slow period bars back
LEG_MAX = 0.9
AUTO_COLOR = '#a855f7'
# A chart whose price has crossed the slow line has no trend by rule 1: NEUTRAL, no channel.
ALL_MAX_POKE = 0.5    # furthest close past the trend-side edge since the cross, in widths


def _leg(b: dict, down: bool) -> dict | None:
    C = np.array(b['c'], float); H = np.array(b['h'], float); L = np.array(b['l'], float)
    N = len(C)
    if len(b['p']) < 3:
        return None                                       # the slowest line has no history yet: no read
    slow = int(b['p'][-1])
    m = pd.Series(C).rolling(slow).mean().values          # == the slowest line the app draws
    w0, w1 = max(0, N - 1 - int(LEG_MAX * slow)), N - 1 - int(LEG_MIN * slow)
    if w1 - w0 < 10:
        return None
    s0 = w0 + int(np.argmax(H[w0:w1]) if down else np.argmin(L[w0:w1]))
    seg = np.arange(s0, N)
    ok = seg[~np.isnan(m[seg])]
    if len(ok) < 30:
        return None
    last = ok[-max(10, len(ok) // 3):]
    ma_slope = np.polyfit(last, m[last], 1)[0]
    px_slope = np.polyfit(seg, C[seg], 1)[0]
    if (px_slope < 0) != down:
        return None                                       # the price leg must go this way
    fallback = (ma_slope < 0) != down                     # slow line flat/against: slope from price
    slope = px_slope if fallback else ma_slope
    i = np.arange(N)
    edge = m[N - 1] + (i - (N - 1)) * slope               # through the slow line at the last bar
    reach = (L[seg] - edge[seg]).min() if down else (H[seg] - edge[seg]).max()
    if (reach < 0) != down or reach == 0:
        return None
    half = abs(reach)                                     # slow-line edge -> midline
    mid = edge + reach                                    # pullbacks stop here
    up_off = half * (1 + 2 * GAP)                         # edges pushed out by GAP x width (width = 2*half)
    # quality, for --scan and for the warning on named instruments
    sm = pd.Series(C).rolling(24, min_periods=1).mean().values
    wrong = np.where((sm[seg] > m[seg]) if down else (sm[seg] < m[seg]))[0]
    sc = seg[wrong[-1] + 1] if len(wrong) and wrong[-1] + 1 < len(seg) else s0
    W = 2 * up_off
    side = (C[sc:] - mid[sc:]) / up_off * (1 if down else -1)   # 1 = trend-side edge
    t = b['t']
    return dict(
        down=down, slow=slow, fallback=bool(fallback), leg_start=t[s0], leg_bars=N - s0,
        at_window_edge=bool(s0 - w0 < 0.05 * (w1 - w0)),
        channel=dict(kind='channel', t1=t[s0], p1=float(mid[s0]), t2=t[N - 1], p2=float(mid[N - 1]),
                     up=float(up_off), dn=float(-up_off), color=AUTO_COLOR, seed=1),
        beyond=float(np.mean(side > 1.0)), poke=float(max(0.0, side.max() - 1.0)),
        move=float(abs(slope) * (N - s0) / W),
        price_on_trend_side=bool((C[-1] < m[-1]) if down else (C[-1] > m[-1])),
    )


def place(b: dict) -> dict | None:
    """The channel for one chart, or None. Picks the direction whose leg fits."""
    cands = [c for c in (_leg(b, True), _leg(b, False)) if c]
    if not cands:
        return None
    cands.sort(key=lambda c: (not c['fallback'], c['price_on_trend_side'], -c['beyond'], c['move']), reverse=True)
    return cands[0]


def classify(b: dict) -> str:
    """UPTREND / DOWNTREND / NEUTRAL by the user's rule: a trend is a chart the rule
    can put a channel on with price still on the trend side of the slow line."""
    try:
        c = place(b)
    except Exception:
        return 'NEUTRAL'
    if not c or not c['price_on_trend_side'] or c['poke'] > ALL_MAX_POKE:
        return 'NEUTRAL'
    return 'DOWNTREND' if c['down'] else 'UPTREND'


def trusted(c: dict | None) -> bool:
    """A channel worth drawing on --all: the same test classify() uses."""
    return bool(c) and c['price_on_trend_side'] and c['poke'] <= ALL_MAX_POKE
