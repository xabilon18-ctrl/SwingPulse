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

import re
from _active_config import INSTRUMENTS_FILE


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


def load_instruments():
    """Parse instrument file and return list of dicts."""
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
    return instruments


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
    if cls == 'Forex':
        return 'Currency'
    return inst['sector']


def instruments_by_ticker():
    """Return dict keyed by ticker for fast lookup."""
    return {inst['ticker']: inst for inst in load_instruments()}


def asset_class_of(group: str) -> str:
    """Collapse Instruments.txt groups into 5 broad classes.
    Used to key backtest expectancy stats and signal confidence tiers."""
    g = (group or '').strip()
    if g in ('Crypto', 'Blockchain'):
        return 'Crypto'
    if g == 'Forex':
        return 'Forex'
    if g == 'Commodity':
        return 'Commodity'
    if g.endswith('Index'):
        return 'Index'
    return 'Equity'
