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
from config import INSTRUMENTS_FILE


_LINE_PATTERN = re.compile(
    r'^\s*(\d+)\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$'
)


def load_instruments():
    """Parse instrument file and return list of dicts."""
    instruments = []
    with open(INSTRUMENTS_FILE, 'r', encoding='utf-8') as f:
        for line in f:
            m = _LINE_PATTERN.match(line)
            if m:
                num, ticker, name, group, sector, industry = m.groups()
                instruments.append({
                    'num':      int(num),
                    'ticker':  ticker.strip(),
                    'name':    name.strip(),
                    'group':   group.strip(),
                    'sector':  sector.strip(),
                    'industry': industry.strip(),
                })
    return instruments


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
