"""
Parse 220_Instruments.txt and return a list of instrument dicts.

Each dict contains:
    num      – sequential number
    ticker   – Yahoo Finance ticker symbol
    name     – display name used in output
    group    – index/group category
    sector   – sector classification
    industry – industry classification
"""

import json
import re
from _active_config import INSTRUMENTS_FILE, RETIRED_FILE


_LINE_PATTERN = re.compile(
    r'^\s*(\d+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$'
)

# Canonical sector taxonomy (normalized 2026-07-13). Any row outside this set
# is a data error — load_instruments() raises rather than silently passing it
# through to grouping features (sector radar, scanner filters).
CANONICAL_SECTORS = {
    'Technology', 'Financial Services', 'Consumer Cyclical', 'Industrials',
    'Healthcare', 'Consumer Defensive', 'Utilities', 'Basic Materials',
    'Communication Services', 'Energy', 'Real Estate',
    'Crypto', 'Index', 'Commodities', 'Currency',
}


def retired_tickers() -> set:
    """Tickers main.py retired THIS run for stale data (config.RETIRED_FILE).
    No file, or an unreadable one, retires nothing."""
    try:
        with open(RETIRED_FILE, encoding='utf-8') as f:
            return {r['ticker'] for r in json.load(f).get('instruments', [])}
    except (OSError, ValueError, KeyError, TypeError):
        return set()


def load_instruments(include_retired: bool = False):
    """Parse instrument file and return list of dicts.

    Instruments main.py retired for stale data are left out unless
    include_retired, so the published board, the summary's expected count,
    the chart feed and the sector series all drop them together."""
    instruments = []
    bad = []
    with open(INSTRUMENTS_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            m = _LINE_PATTERN.match(line)
            if m:
                num, ticker, name, group, sector, industry = m.groups()
                inst = {
                    'num':      int(num),
                    'ticker':  ticker.strip(),
                    'name':    name.strip(),
                    'group':   group.strip(),
                    'sector':  sector.strip(),
                    'industry': industry.strip(),
                }
                if inst['sector'] not in CANONICAL_SECTORS:
                    bad.append(f"#{inst['num']} {inst['ticker']}: {inst['sector']!r}")
                instruments.append(inst)
    if bad:
        raise ValueError(
            'Non-canonical sector in Instruments.txt (fix the row or extend '
            'CANONICAL_SECTORS): ' + '; '.join(bad)
        )
    if not include_retired:
        retired = retired_tickers()
        instruments = [i for i in instruments if i['ticker'] not in retired]
    return instruments


def find_stale(last_bars: dict, max_days: int, max_count: int):
    """(stale, newest) from {ticker: last daily bar date}.

    stale is [(ticker, last_bar, days_behind)] for every ticker more than
    max_days behind the newest bar, oldest first — or [] when more than
    max_count are, because that many at once is a feed outage, not
    delistings, and must stay loud rather than empty the board."""
    if not last_bars:
        return [], None
    newest = max(last_bars.values())
    stale = sorted(((t, d, (newest - d).days) for t, d in last_bars.items()
                    if (newest - d).days > max_days), key=lambda r: r[1])
    return ([] if len(stale) > max_count else stale), newest


def radar_sector_of(inst: dict) -> str:
    """Sector axis for the activity radar. Crypto/Index/Commodity asset
    classes override the display sector so blockchain equities and thematic
    ETFs group with what they actually trade like."""
    cls = asset_class_of(inst['group'])
    if cls == 'Crypto':
        return 'Crypto'
    if cls == 'Index':
        return 'Index'
    if cls == 'Commodity':
        return 'Commodities'
    # No Currency branch needed: unlike Commodity (class 'Commodity' vs sector
    # 'Commodities'), the currency rows name the class, group and sector all
    # 'Currency', so the sector fall-through below already returns it.
    return inst['sector']


def instruments_by_ticker(include_retired: bool = False):
    """Return dict keyed by ticker for fast lookup."""
    return {inst['ticker']: inst for inst in load_instruments(include_retired)}


def asset_class_of(group: str) -> str:
    """Collapse Instruments.txt groups into 5 broad classes.
    Used to key backtest expectancy stats and signal confidence tiers."""
    g = (group or '').strip()
    if g in ('Crypto', 'Blockchain'):
        return 'Crypto'
    if g == 'Currency':
        return 'Currency'
    if g == 'Commodity':
        return 'Commodity'
    # Rates (^TNX/^VIX/^IRX/^FVX/^TYX, added 2026-08-29) are their own GROUP so
    # they get their own Class chip, but they are an Index asset CLASS: the
    # confidence map and backtest buckets are keyed by class, and a brand-new
    # class would look up nothing and silently drop every rate signal to the
    # untiered fallback.
    if g == 'Rates':
        return 'Index'
    if g.endswith('Index'):
        return 'Index'
    return 'Equity'
