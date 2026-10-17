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


def load_retired() -> dict:
    """main.py's verdict for THIS run (config.RETIRED_FILE), or {} when there
    is none or it is unreadable — which retires nothing. Every reader of the
    file goes through here, so they share one format and one fallback."""
    try:
        with open(RETIRED_FILE, encoding='utf-8') as f:
            doc = json.load(f)
        if isinstance(doc, dict) and isinstance(doc.get('instruments'), list):
            return doc
    except (OSError, ValueError):
        pass
    return {}


def retired_tickers() -> set:
    """Tickers main.py retired this run for stale data."""
    return {r['ticker'] for r in load_retired().get('instruments', [])
            if isinstance(r, dict) and 'ticker' in r}


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


def find_stale(last_bars: dict, max_days: int, max_new: int,
               max_share: float, recent_days: int = 3) -> dict:
    """Judge {ticker: last finished daily bar} against the newest of them.

    stale  — more than max_days behind. Retired, unless held back below.
    new    — stale, but by no more than recent_days past the limit: these
             crossed it in the last few runs. More than max_new of them at
             once is a feed outage (many instruments stopping together), not
             delistings, so they are held back and the health check stays
             loud. Long-dead tickers are counted separately, so they never
             make a later delisting look like an outage.
    More than max_share of everything stale at once holds back ALL of it.
    Returns {'newest', 'retire': [(ticker, last_bar, days)] oldest first,
    'held': [tickers held back], 'fresh': [tickers within the limit],
    'outage': bool}."""
    if not last_bars:
        return {'newest': None, 'retire': [], 'held': [], 'fresh': [], 'outage': False}
    newest = max(last_bars.values())
    behind = {t: (newest - d).days for t, d in last_bars.items()}
    stale = sorted((t for t, b in behind.items() if b > max_days), key=lambda t: last_bars[t])
    new = [t for t in stale if behind[t] <= max_days + recent_days]
    if len(stale) > max_share * len(last_bars):
        held = stale
    elif len(new) > max_new:
        held = new
    else:
        held = []
    keep = set(held)
    return {'newest': newest,
            'retire': [(t, last_bars[t], behind[t]) for t in stale if t not in keep],
            'held': held,
            'fresh': sorted(t for t, b in behind.items() if b <= max_days),
            'outage': bool(held)}


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
