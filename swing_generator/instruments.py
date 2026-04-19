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


def tickers_list():
    """Return just the list of Yahoo Finance ticker strings."""
    return [inst['ticker'] for inst in load_instruments()]


def instruments_by_ticker():
    """Return dict keyed by ticker for fast lookup."""
    return {inst['ticker']: inst for inst in load_instruments()}
