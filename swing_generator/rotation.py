"""Sector rotation wheel, momentum leaders, and a forward paper portfolio.

One Dashboard card, above the Sector Radar. Three parts, each with the evidence
that decided how it is worded:

  wheel    Where each sector sits against the AVERAGE sector: strength (its
           relative line vs its own 10-week average) and direction (the change
           in strength over 4 weeks). Zones: Leading / Weakening / Lagging /
           Improving. DESCRIPTIVE ONLY. Tested 2026-09-11 over 14 sectors and
           13 years: Improving sectors reached Leading within 4 weeks 57%
           (before 2022) / 62% (after) of the time vs 38% / 42% for the rest —
           but the "next in line" pick trailed the average sector in 22 of 24
           setting x period cells, and the ORDER of leaders did not repeat
           (1 of 19 later changes called). So nothing here is labelled "next".

  leaders  Top 20 by risk-adjusted 12-month-minus-last-month return (the move
           from 12 months to 1 month ago, divided by a year's volatility), at
           most 2 per sector. The one ranking that beat an equal-weight basket
           both before and after 2022: top decile +1.24% / +1.27% per 20
           trading days; this capped top 20 made +23.5%/yr net since 2022 vs
           +6.4% for the basket. Lumpy — 2021 and 2022 lost to the basket.

  paper    Those 20, equal weight, re-ranked every 20 trading days, marked
           FORWARD from the first run of this module and never backfilled — an
           out-of-sample record. Financing (0.02%/calendar day) is charged to it
           and to the basket; spread is charged on turnover.

Files: rotation.json is rebuilt every run. rotation_paper.json ACCUMULATES and
R2 is its source of truth (CI checkouts are ephemeral): it is loaded from R2
first and is NOT saved when R2 cannot be read, because saving a fresh record
over an unreadable one would silently restart the track record.
"""
import json
import math
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from _active_config import OUTPUT_DIR
from data_fetcher import _cache_path, drop_unfinished_daily
from instruments import asset_class_of, load_instruments, radar_sector_of

# Public R2 data prefix — keep in sync with R2_BASE_URL in webapp/publish.py
R2_BASE = 'https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev/ma500'
R2_USER_AGENT = 'SwingPulse-pipeline/1.0'   # r2.dev 403s the default urllib agent
ROTATION_PATH = os.path.join(OUTPUT_DIR, 'rotation.json')
PAPER_PATH = os.path.join(OUTPUT_DIR, 'rotation_paper.json')

TOP_N = 20
CAP_PER_SECTOR = 2
REBALANCE_ROWS = 20            # trading days between re-ranks
MIN_HISTORY_ROWS = 255         # of the last 260 weekdays, so 12-1 momentum is real
CARRY_PER_CAL_DAY = 0.0002     # 0.02% of notional per calendar day (~7.3%/yr)
SPREAD_RT = {'Equity': 0.0015, 'Index': 0.0005, 'Commodity': 0.0010, 'Crypto': 0.0040}
STRENGTH_WEEKS = 10
DIRECTION_WEEKS = 4
TRAIL_WEEKS = 8
MIN_SECTOR_MEMBERS = 12
LEADER_MIN_RUN_WEEKS = 3       # shorter spells at the top are flicker, not a leader


def _now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _pct(x, digits=1):
    return None if x is None or pd.isna(x) else round(float(x) * 100, digits)


# ---------------------------------------------------------------------------
# Prices
# ---------------------------------------------------------------------------
def load_panel(instruments=None):
    """Weekday close panel (finished sessions only), with instrument metadata.

    Currencies and Rates are left out: a currency pair has no sector, and a
    yield is not a price you can rank by how far it climbed.
    """
    insts = instruments or load_instruments()
    series, meta = {}, {}
    for inst in insts:
        cls = asset_class_of(inst['group'])
        if cls == 'Currency' or inst['group'] == 'Rates':
            continue
        try:
            df = pd.read_parquet(_cache_path(inst['ticker']), columns=['Close'])
        except Exception:
            continue
        idx = pd.to_datetime(df.index)
        if getattr(idx, 'tz', None) is not None:
            idx = idx.tz_convert('UTC').tz_localize(None)
        df.index = idx.normalize()
        df = drop_unfinished_daily(df[~df.index.duplicated(keep='last')].sort_index())
        close = df['Close'].where(df['Close'] > 0).dropna()
        if len(close) < 60:
            continue
        series[inst['name']] = close
        meta[inst['name']] = {'sector': radar_sector_of(inst), 'cls': cls,
                              'industry': inst.get('industry', ''), 'group': inst['group']}

    raw = pd.DataFrame(series)
    raw = raw[(raw.index.dayofweek < 5) & (raw.index >= '2013-01-01')]
    counts = raw.notna().sum(axis=1)
    # The newest date most of the book has actually closed — not a lone
    # 24h-market bar sitting a day ahead of everything else.
    as_of = counts[counts >= 0.3 * raw.shape[1]].index.max()
    panel = raw.loc[:as_of].ffill(limit=5)

    # One-bar spike-and-revert bad prints (>35% away and back within 10%),
    # never on crypto, where a 35% day can be real.
    prev, nxt = panel.shift(1), panel.shift(-1)
    bad = (((panel / prev) > 1.35) | ((panel / prev) < 1 / 1.35)) & \
          ((nxt / prev) > 0.9) & ((nxt / prev) < 1.1)
    noncrypto = np.array([meta[n]['cls'] != 'Crypto' for n in panel.columns])
    panel = panel.mask(bad & noncrypto).ffill(limit=5)
    return panel, meta, as_of


# ---------------------------------------------------------------------------
# Wheel
# ---------------------------------------------------------------------------
def _zone(strength, direction):
    if strength is None or direction is None or pd.isna(strength) or pd.isna(direction):
        return ''
    if strength > 0:
        return 'Leading' if direction > 0 else 'Weakening'
    return 'Improving' if direction > 0 else 'Lagging'


def compute_wheel(panel, meta, as_of):
    sector = pd.Series({n: meta[n]['sector'] for n in panel.columns})
    counts = sector.value_counts()
    use = sorted(counts[counts >= MIN_SECTOR_MEMBERS].index)

    rets = panel.pct_change(fill_method=None).clip(-0.5, 0.5)
    valid = rets.notna().resample('W-FRI').sum() >= 3
    weekly = ((1 + rets.fillna(0)).resample('W-FRI').prod() - 1).where(valid)
    if weekly.index[-1] > as_of:
        # The week has not closed. Same rule as the Weekly timeframe: a wheel
        # that moves on Tuesday and moves back by Friday is repainting.
        weekly = weekly.iloc[:-1]

    sec_ret = pd.DataFrame({s: weekly[sector.index[sector == s]].mean(axis=1) for s in use})
    members = pd.DataFrame({s: weekly[sector.index[sector == s]].notna().sum(axis=1) for s in use})
    sec_ret = sec_ret.where(members >= 8).loc['2013-06-01':]
    bench = sec_ret.mean(axis=1)                                   # the average sector
    rel = np.log1p(sec_ret).sub(np.log1p(bench), axis=0)
    line = rel.fillna(0).cumsum().where(sec_ret.notna())
    strength = line - line.rolling(STRENGTH_WEEKS, min_periods=STRENGTH_WEEKS).mean()
    direction = strength - strength.shift(DIRECTION_WEEKS)
    week = strength.index[-1]

    sectors = []
    for s in use:
        trail = [[_pct(a, 2), _pct(b, 2)]
                 for a, b in zip(strength[s].iloc[-TRAIL_WEEKS:], direction[s].iloc[-TRAIL_WEEKS:])
                 if pd.notna(a) and pd.notna(b)]
        sectors.append({
            'name': s, 'members': int(counts[s]),
            'zone': _zone(strength.at[week, s], direction.at[week, s]),
            'strength': trail[-1][0] if trail else None,
            'direction': trail[-1][1] if trail else None,
            'trail': trail,
        })

    # The active sector each week: the strongest one in the Leading zone (or
    # simply the strongest, on a week with nobody Leading).
    tops = {}
    for d in strength.index:
        s_row, d_row = strength.loc[d], direction.loc[d]
        leading = s_row[(s_row > 0) & (d_row > 0)].dropna()
        pool = leading if len(leading) else s_row.dropna()
        if len(pool):
            tops[d] = pool.idxmax()
    top = pd.Series(tops)
    run_id = (top != top.shift()).cumsum()
    runs = [{'sector': grp.iloc[0], 'start': grp.index[0], 'end': grp.index[-1], 'weeks': len(grp)}
            for _, grp in top.groupby(run_id)]
    current = runs[-1]
    previous = []
    for run in reversed(runs[:-1]):
        if run['weeks'] < LEADER_MIN_RUN_WEEKS:
            continue
        if run['sector'] == current['sector'] or (previous and previous[-1]['name'] == run['sector']):
            continue
        previous.append({'name': run['sector'], 'from': str(run['start'].date()),
                         'to': str(run['end'].date()), 'weeks': run['weeks']})
        if len(previous) == 2:
            break

    return {
        'week': str(week.date()),
        'settings': {'strength_weeks': STRENGTH_WEEKS, 'direction_weeks': DIRECTION_WEEKS},
        'sectors': sectors,
        'active': {'name': current['sector'], 'since': str(current['start'].date()),
                   'weeks': current['weeks']},
        'previous': previous,
    }


# ---------------------------------------------------------------------------
# Leaders
# ---------------------------------------------------------------------------
def compute_leaders(panel, meta, as_of):
    last = panel.iloc[-1]
    history = panel.iloc[-260:].notna().sum()
    mom_12_1 = panel.iloc[-22] / panel.iloc[-253] - 1
    mom_3m = last / panel.iloc[-64] - 1
    daily = panel.iloc[-253:].pct_change(fill_method=None)
    vol = (daily.std() * math.sqrt(252)).where(daily.notna().sum() >= 200)
    risk_adj = mom_12_1 / vol
    below_high = 1 - last / panel.iloc[-252:].max()
    # A unit change (SBK.JO printed 100x one day) is not a climb. A permanent
    # jump of 3x in one bar on a non-crypto name is treated as a bad print and
    # the name sits out of the ranking until it rolls out of the year.
    step = panel.iloc[-260:] / panel.iloc[-260:].shift(1)
    unit_jump = ((step > 3) | (step < 1 / 3)).any()

    ranked, basket = [], []
    for n in panel.columns:
        if history[n] < MIN_HISTORY_ROWS or pd.isna(last[n]):
            continue
        basket.append(n)
        if pd.isna(risk_adj[n]) or (meta[n]['cls'] != 'Crypto' and unit_jump[n]):
            continue
        ranked.append({
            'name': n, 'sector': meta[n]['sector'], 'cls': meta[n]['cls'],
            'industry': meta[n]['industry'],
            'mom_12_1': _pct(mom_12_1[n]), 'mom_3m': _pct(mom_3m[n]),
            'below_high': _pct(below_high[n]), 'score': round(float(risk_adj[n]), 3),
        })
    ranked.sort(key=lambda row: -row['score'])

    picked, hidden, per_sector = [], [], {}
    for row in ranked:
        if len(picked) == TOP_N:
            break
        if per_sector.get(row['sector'], 0) < CAP_PER_SECTOR:
            per_sector[row['sector']] = per_sector.get(row['sector'], 0) + 1
            row['rank'] = len(picked) + 1
            picked.append(row)
        elif len(hidden) < 12:
            hidden.append({'name': row['name'], 'sector': row['sector']})

    return {
        'rule': (f'Top {TOP_N} by risk-adjusted 12-month-minus-last-month return, '
                 f'at most {CAP_PER_SECTOR} per sector. Currencies and rates excluded.'),
        'list': picked,
        'hidden': hidden,
        'ranked_count': len(ranked),
    }, basket


def compute_thermometer(panel):
    window = panel.iloc[-221:]
    sma = window.rolling(200, min_periods=200).mean()

    def share(i):
        ok = sma.iloc[i].notna() & window.iloc[i].notna()
        return float((window.iloc[i][ok] > sma.iloc[i][ok]).mean() * 100), int(ok.sum())

    now, n = share(-1)
    then, _ = share(-21)
    zone = 'Washout' if now < 30 else 'Stretched' if now > 75 else 'Normal'
    return {'pct_above_200d': round(now), 'pct_4w_ago': round(then), 'zone': zone, 'count': n}


# ---------------------------------------------------------------------------
# Paper portfolio (accumulating; R2 is the source of truth)
# ---------------------------------------------------------------------------
def load_paper():
    """(state or None, safe_to_save). 404 means no record yet, which is safe."""
    url = f'{R2_BASE}/rotation_paper.json?t={int(time.time())}'
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'Cache-Control': 'no-cache',
                                                       'User-Agent': R2_USER_AGENT})
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read()), True
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return None, True
            print(f'  Rotation: R2 paper record fetch failed (HTTP {exc.code})')
        except Exception as exc:
            print(f'  Rotation: R2 paper record fetch failed ({exc})')
        time.sleep(2 * (attempt + 1))
    try:
        with open(PAPER_PATH) as fh:
            return json.load(fh), True
    except Exception:
        return None, False


def _price(panel, name, date):
    if name not in panel.columns:
        return None
    col = panel[name].loc[:pd.Timestamp(date)].dropna()
    if not len(col) or (pd.Timestamp(date) - col.index[-1]).days > 7:
        return None
    return float(col.iloc[-1])


def _mean_return(panel, names, start, end):
    rets = []
    for n in names:
        a, b = _price(panel, n, start), _price(panel, n, end)
        if a and b:
            rets.append(b / a - 1)
    return (float(np.mean(rets)) if rets else 0.0), len(rets)


def update_paper(state, panel, meta, as_of, leaders, basket):
    today = str(as_of.date())
    if not state or not state.get('nav'):
        state = {
            'started': today,
            'rule': f'Top {TOP_N} leaders, equal weight, re-ranked every {REBALANCE_ROWS} trading days',
            'costs': {'carry_per_calendar_day': CARRY_PER_CAL_DAY, 'spread_round_trip': SPREAD_RT},
            'rebalances': [], 'nav': [],
        }
    # Idempotent within a day: the 3-4 runs a day all recompute today's point.
    state['nav'] = [p for p in state['nav'] if p['date'] < today]
    state['rebalances'] = [rb for rb in state['rebalances'] if rb['date'] < today]

    def spread(names):
        return float(np.mean([SPREAD_RT.get(meta[n]['cls'], 0.0015) for n in names])) if names else 0.0

    if not state['nav']:
        cost = spread(leaders)
        state['rebalances'].append({'date': today, 'holdings': leaders, 'turnover': 1.0,
                                    'spread_cost': round(cost, 5)})
        state['nav'].append({'date': today, 'port': round(100 * (1 - cost), 4),
                             'basket': 100.0, 'held': len(leaders)})
        sessions_since = 0
    else:
        prev = state['nav'][-1]
        last_rb = state['rebalances'][-1]
        port_ret, held = _mean_return(panel, last_rb['holdings'], prev['date'], today)
        basket_ret, _ = _mean_return(panel, basket, prev['date'], today)
        carry = CARRY_PER_CAL_DAY * (pd.Timestamp(today) - pd.Timestamp(prev['date'])).days
        port = prev['port'] * (1 + port_ret - carry)
        basket_nav = prev['basket'] * (1 + basket_ret - carry)
        sessions_since = int(((panel.index > pd.Timestamp(last_rb['date'])) &
                              (panel.index <= as_of)).sum())
        if sessions_since >= REBALANCE_ROWS:
            turnover = len(set(leaders) - set(last_rb['holdings'])) / max(len(leaders), 1)
            cost = turnover * spread(leaders)
            port *= (1 - cost)
            state['rebalances'].append({'date': today, 'holdings': leaders,
                                        'turnover': round(turnover, 3), 'spread_cost': round(cost, 5)})
            sessions_since = 0
        state['nav'].append({'date': today, 'port': round(port, 4),
                             'basket': round(basket_nav, 4), 'held': held})

    state['as_of'] = today
    state['holdings'] = state['rebalances'][-1]['holdings']
    state['next_rerank_in'] = REBALANCE_ROWS - sessions_since
    state['updated_at'] = _now()
    return state


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def update(instruments=None) -> dict:
    t0 = time.time()
    panel, meta, as_of = load_panel(instruments)
    wheel = compute_wheel(panel, meta, as_of)
    leaders, basket = compute_leaders(panel, meta, as_of)
    thermometer = compute_thermometer(panel)

    state, safe = load_paper()
    earlier = [rb for rb in (state or {}).get('rebalances', []) if rb['date'] < str(as_of.date())]
    held_before = set(earlier[-1]['holdings']) if earlier else set()
    for row in leaders['list']:
        row['new'] = bool(held_before) and row['name'] not in held_before

    payload = {'generated_at': _now(), 'as_of': str(as_of.date()),
               'thermometer': thermometer, 'wheel': wheel, 'leaders': leaders}
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(ROTATION_PATH, 'w') as fh:
        json.dump(payload, fh, separators=(',', ':'))

    if safe:
        state = update_paper(state, panel, meta, as_of,
                             [row['name'] for row in leaders['list']], basket)
        with open(PAPER_PATH, 'w') as fh:
            json.dump(state, fh, separators=(',', ':'))
        last = state['nav'][-1]
        paper_note = (f"paper since {state['started']}: leaders {last['port'] - 100:+.2f}% "
                      f"vs basket {last['basket'] - 100:+.2f}%")
    else:
        paper_note = 'paper record NOT saved (R2 unreadable — saving would restart it)'

    active = wheel['active']
    print(f"  Rotation ({time.time() - t0:.0f}s): as of {payload['as_of']} · "
          f"active {active['name']} since {active['since']} · "
          f"{thermometer['pct_above_200d']}% above 200-day · "
          f"leaders {', '.join(r['name'] for r in leaders['list'][:5])}… · {paper_note}")
    return payload


if __name__ == '__main__':
    update()
