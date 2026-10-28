"""Which sectors were busy at the last close: Daily, Weekly and Monthly.

User, 2026-10-28: "I spend most of my time looking at my ... watch list, and
then I miss the active markets", and on Forex, which has no volume: "the daily
price movements, those must count a lot". Then: "build this thing for monthly
and weekly" too.

A BIG MOVE is a closed bar whose close-to-close change is at least MOVE_K
times that instrument's own typical change: the standard deviation of its
previous SD_WINDOW changes. Each market is held to its own yardstick, so a
0.8% day is big for EURUSD and nothing for a coin. Measured on the published
Daily bundles (804 instruments, ~5 years) before choosing it: 5.3-6.0% of days
are big moves in EVERY radar sector, Currency 5.7%. The ATR yardstick was
rejected: Forex ranges are wide against where it closes, so only 1.9% of its
days reached 1.5x ATR against ~4.6% elsewhere, and Forex would have stayed
hidden, the thing this exists to stop.

A sector is ACTIVE when its share of big moves on the latest closed bar is
unusual against its own last BASELINE bars: z >= Z_HOT, with the radar's
formula (sector_activity._z_series, whose std floor of half a member keeps one
ordinary move from reading as a 10-sigma event). Daily, ~1 day in 9 per sector.
When MARKET_WIDE_MIN or more sectors are active together, it was the market
moving, not a sector, and the payload says so.

Separate from sector_radar.json on purpose: that file's rate (signal fires and
volume spikes) feeds instrument_flavours.json, the validated card glow and
verdict bar. Moves never enter it. The app reads both files for Daily; Weekly
and Monthly carry no signals, so moves are all they have.

Stateless: the chart bundles carry years of bars (Daily ~5 years, Weekly and
Monthly decades), so every run recomputes the whole baseline from them. Nothing
is stored between runs and nothing needs a backfill.

Closed bars only (Important Rule 10). Daily bundles end on the bar still
trading, so a Daily bar dated today (UTC) or later is dropped. Weekly and
Monthly bundles already stop at the last closed week and month. Weekend bars
on Daily count only for crypto coins (group 'Crypto'): Forex, gold and index futures
carry a short Sunday bar, the opening hours of the new week, and one feed
(USDZAR) a Saturday one; counted, they would be days of near-zero moves in the
baseline. Weekly and Monthly keep every bar: a month is labelled by its 1st,
which is a weekend day in some months.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pandas as pd

MOVE_K = 2.0            # a big move: |change| >= MOVE_K x its own typical change
SD_WINDOW = 60          # bars behind each change that set its typical change
SD_MIN = 40             # need this many of them (non-zero, finite)
BASELINE = 20           # bars a sector is compared against (the radar's)
MIN_BASELINE = 10
Z_HOT = 1.5             # the radar's hot threshold
MIN_MEMBERS = 8         # smaller sectors are listed, never active
MARKET_WIDE_MIN = 6     # this many active sectors at once = the market moved
COVERAGE = 0.5          # a bar counts for a sector when half its members have it
TOP_N = 6               # biggest movers named per sector


def _weekday_ok(day: str, keep_weekends: bool) -> bool:
    return keep_weekends or date.fromisoformat(day).weekday() < 5


def instrument_moves(bundle: dict, keep_weekends: bool, cutoff: str | None) -> dict:
    """{bar date: (change, score)} for every closed bar with a typical change
    behind it. score = |change| / typical change, the typical change being the
    standard deviation of the previous SD_WINDOW changes (zeros left out: a
    market that did not trade that bar has no change to judge by). `cutoff`:
    drop bars dated on or after it (today's still-trading Daily bar).
    `keep_weekends`: True for coins and for Weekly and Monthly, whose bars are
    labelled by the period's first day (1 Aug 2026 is a Saturday)."""
    days, closes = [], []
    for t, c in zip(bundle.get('t') or [], bundle.get('c') or []):
        day = str(t)[:10]
        if cutoff and day >= cutoff:
            continue
        if c is None or not c > 0 or not _weekday_ok(day, keep_weekends):
            continue
        days.append(day)
        closes.append(float(c))
    if len(closes) < SD_MIN + 2:
        return {}
    ch = pd.Series(closes, index=days).pct_change().iloc[1:]
    sd = (ch.where(ch != 0).rolling(SD_WINDOW, min_periods=SD_MIN)
          .std(ddof=0).shift(1))
    ok = sd > 0
    return {d: (float(c), float(abs(c) / v))
            for d, c, v in zip(ch.index[ok], ch[ok], sd[ok])}


def sector_activity(moves: dict, sector_of: dict) -> dict:
    """Per sector, the bar-by-bar series and the latest bar's reading."""
    from sector_activity import _z_series
    members: dict[str, list[str]] = {}
    for name, sec in sector_of.items():
        if name in moves:
            members.setdefault(sec, []).append(name)
    out = {}
    for sec, names in sorted(members.items()):
        need = max(1, int(len(names) * COVERAGE))
        days = sorted({d for n in names for d in moves[n]})
        series = []
        for d in days:
            have = [(n, moves[n][d]) for n in names if d in moves[n]]
            if len(have) < need:
                continue
            big = [(n, ch, s) for n, (ch, s) in have if s >= MOVE_K]
            series.append({'date': d, 'counted': len(have), 'big': big})
        if not series:
            continue
        rates = [len(r['big']) / r['counted'] for r in series]
        zs = _z_series(rates, len(names), BASELINE)
        last, z = series[-1], zs[-1]
        up = sum(ch > 0 for _, ch, _ in last['big'])
        down = len(last['big']) - up
        eligible = len(names) >= MIN_MEMBERS and z is not None
        hot = bool(eligible and z >= Z_HOT)
        base = rates[-BASELINE - 1:-1]
        # Strongest first, so a tap opens on the markets that made it active;
        # members without a reading for the bar go last, by name.
        reading = {n: moves[n].get(last['date']) for n in names}
        order = sorted(names, key=lambda n: (reading[n] is None,
                                             -(reading[n][1] if reading[n] else 0), n))
        out[sec] = {
            'sector': sec, 'date': last['date'], 'members': len(names),
            'counted': last['counted'], 'big': len(last['big']), 'up': up, 'down': down,
            'rate': round(rates[-1], 5),
            'mean_rate': round(sum(base) / len(base), 5) if base else None,
            'z': None if z is None else round(z, 2), 'hot': hot,
            'tilt': ('up' if up >= 2 * max(down, 1) or (up and not down) else
                     'down' if down >= 2 * max(up, 1) or (down and not up) else
                     'mixed' if up or down else 'none'),
            'top': [[n, round(ch * 100, 2), round(s, 1)] for n, ch, s in
                    sorted(last['big'], key=lambda r: -r[2])[:TOP_N]],
            'order': order,
            'history_bars': len(series),
        }
    return out


def build_activity(bundles: dict, instruments: list, tf: str,
                   now: datetime | None = None) -> dict:
    """The activity/<tf>.json payload from one timeframe's chart bundles.

    bundles — {display name: chart bundle (t, c, ...)}
    instruments — instruments.load_instruments() rows (name, group, sector)
    """
    from instruments import radar_sector_of
    now = now or datetime.now(timezone.utc)
    cutoff = now.strftime('%Y-%m-%d') if tf == 'D' else None
    by_name = {i['name']: i for i in instruments}
    sector_of = {n: radar_sector_of(i) for n, i in by_name.items()}
    moves = {}
    for name, b in bundles.items():
        inst = by_name.get(name)
        if not inst or not b:
            continue
        coin = (inst.get('group') or '').strip() == 'Crypto'
        m = instrument_moves(b, coin or tf != 'D', cutoff)
        if m:
            moves[name] = m
    sectors = sector_activity(moves, sector_of)
    active = [s for s in sectors.values() if s['hot']]
    dates = sorted((s['date'] for s in sectors.values()), reverse=True)
    return {
        'generated_at': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'tf': tf,
        'period': dates[0] if dates else None,
        'rule': {'move_k': MOVE_K, 'sd_window': SD_WINDOW, 'baseline': BASELINE,
                 'z_hot': Z_HOT, 'min_members': MIN_MEMBERS,
                 'market_wide_min': MARKET_WIDE_MIN},
        'active': len(active),
        'market_wide': len(active) >= MARKET_WIDE_MIN,
        'sectors': sorted(sectors.values(), key=lambda s: s['sector']),
    }
