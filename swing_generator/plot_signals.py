"""
Plot any instrument with the SwingPulse MA ribbon and all P1/P2/P3/P4 signals.

Usage:
    python3 plot_signals.py                         # defaults to BTC-USD
    python3 plot_signals.py ^NDX "Nasdaq 100"
    python3 plot_signals.py BTC-USD "Bitcoin"
"""

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.lines import Line2D

from data_fetcher import fetch
from indicators import add_all_indicators
from signals import add_signals
from config import MA_PERIODS, SMALL_MA_RANGE

TICKER = sys.argv[1] if len(sys.argv) > 1 else 'BTC-USD'
LABEL  = sys.argv[2] if len(sys.argv) > 2 else TICKER

# ---------------------------------------------------------------------------
# Fetch & process
# ---------------------------------------------------------------------------
print(f'Fetching {TICKER}...')
df = fetch(TICKER)
if df is None:
    print('ERROR: no data'); sys.exit(1)

df = add_all_indicators(df)
df = add_signals(df)
df = df[df.index >= '2023-01-01'].copy()
print(f'Rows: {len(df)}  ({df.index[0].date()} → {df.index[-1].date()})')

# ---------------------------------------------------------------------------
# Categorise signals
# ---------------------------------------------------------------------------
def sig(df, prim, trend=None, status_contains=None):
    mask = df['primary_signal'] == prim
    if trend:
        mask &= df['trend_direction'] == trend
    if status_contains:
        mask &= df['confirmation_status'].str.contains(status_contains, case=False, na=False)
    return df[mask]

p1_buy        = sig(df, 'P1', status_contains='buy')
p1_sell       = sig(df, 'P1', status_contains='sell')
p2_buy        = sig(df, 'P2', status_contains='buy')
p2_sell       = sig(df, 'P2', status_contains='sell')
p3_buy        = sig(df, 'P3')
p4_sell       = sig(df, 'P4')
sec_buy       = df[(df['secondary_signal'] == 'secondary') & (df['trend_direction'] == 'UPTREND')]
sec_sell      = df[(df['secondary_signal'] == 'secondary') & (df['trend_direction'] == 'DOWNTREND')]
comp_watch    = df[df['watch_flag'].str.contains('Ribbon expansion', na=False)]

# ---------------------------------------------------------------------------
# Plot
# ---------------------------------------------------------------------------
fig, ax = plt.subplots(figsize=(24, 13))
fig.patch.set_facecolor('#0d1117')
ax.set_facecolor('#0d1117')

dates = df.index

# Ribbon fill
up   = df['trend_direction'] == 'UPTREND'
dn   = df['trend_direction'] == 'DOWNTREND'
neu  = ~(up | dn)
ax.fill_between(dates, df['ma_40'], df['ma_200'], where=up,  color='#1a6632', alpha=0.22, linewidth=0)
ax.fill_between(dates, df['ma_40'], df['ma_200'], where=dn,  color='#661a1a', alpha=0.22, linewidth=0)
ax.fill_between(dates, df['ma_40'], df['ma_200'], where=neu, color='#333355', alpha=0.15, linewidth=0)

# Individual MA lines
for col in [f'ma_{p}' for p in MA_PERIODS]:
    if col in df.columns:
        lw    = 1.0 if col in ('ma_40', 'ma_200') else 0.5
        color = '#4a9eff' if col == 'ma_200' else '#666666'
        ax.plot(dates, df[col], color=color, linewidth=lw, alpha=0.5)

# Candlesticks
for date, row in df.iterrows():
    color = '#26a69a' if row['Close'] >= row['Open'] else '#ef5350'
    ax.bar(date, abs(row['Close'] - row['Open']),
           bottom=min(row['Open'], row['Close']),
           width=pd.Timedelta(hours=14), color=color, linewidth=0)
    ax.plot([date, date], [row['Low'], row['High']], color=color, linewidth=0.7, alpha=0.8)

# ---------------------------------------------------------------------------
# Signal markers
# ---------------------------------------------------------------------------
SZ = 130

def mark(sdf, y_col, marker, color, offset_pct, tag):
    if sdf.empty:
        return
    prices = sdf[y_col]
    offset = prices * offset_pct
    ax.scatter(sdf.index, prices + offset, s=SZ, marker=marker, color=color,
               zorder=10, linewidths=1.0, edgecolors='white', label=tag)
    for date, price in zip(sdf.index, prices + offset):
        ax.annotate(tag.split(' ')[0],
                    xy=(date, price),
                    xytext=(0, 13 if offset_pct > 0 else -13),
                    textcoords='offset points',
                    ha='center', va='bottom' if offset_pct > 0 else 'top',
                    fontsize=7.5, color=color, fontweight='bold',
                    bbox=dict(boxstyle='round,pad=0.2', fc='#0d1117',
                              ec=color, lw=0.8, alpha=0.9))

mark(p1_buy,     'Low',  '^', '#00e676', -0.026, 'P1 BUY')
mark(p2_buy,     'Low',  '^', '#69f0ae', -0.022, 'P2 BUY')
mark(p3_buy,     'Low',  '^', '#a5d6a7', -0.019, 'P3 BUY')
mark(sec_buy,    'Low',  '^', '#c8e6c9', -0.016, 'SEC BUY')
mark(p1_sell,    'High', 'v', '#ff1744',  0.026, 'P1 SELL')
mark(p2_sell,    'High', 'v', '#ff6e40',  0.022, 'P2 SELL')
mark(p4_sell,    'High', 'v', '#ff8a65',  0.019, 'P4 SELL')
mark(sec_sell,   'High', 'v', '#ffccbc',  0.016, 'SEC SELL')

# Compression breakout watch — diamond marker
if not comp_watch.empty:
    for date, row in comp_watch.iterrows():
        is_up = 'bullish' in str(row.get('watch_flag', '')).lower()
        y = row['Low'] * 0.985 if is_up else row['High'] * 1.015
        ax.scatter(date, y, s=90, marker='D', color='#ffd740',
                   zorder=9, linewidths=0.8, edgecolors='white')

# ---------------------------------------------------------------------------
# Axes
# ---------------------------------------------------------------------------
ax.set_title(f'{LABEL} · Daily · SwingPulse Signal Map (Updated Rules)',
             color='white', fontsize=14, pad=10, fontweight='bold')
ax.tick_params(colors='#aaaaaa', labelsize=8.5)
for spine in ax.spines.values():
    spine.set_color('#333333')
ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
plt.xticks(rotation=30, ha='right', color='#aaaaaa')
ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, _: f'{x:,.0f}'))
ax.set_ylabel('Price', color='#aaaaaa', fontsize=10)
ax.grid(color='#1e2329', linewidth=0.5, linestyle='--', alpha=0.6)

# Legend
handles = [
    Line2D([0],[0], marker='^', color='w', markerfacecolor='#00e676', markersize=10, linestyle='None', label='P1 BUY — Trend reversal (incl. via neutral)'),
    Line2D([0],[0], marker='^', color='w', markerfacecolor='#69f0ae', markersize=10, linestyle='None', label='P2 BUY — 200 MA bounce'),
    Line2D([0],[0], marker='^', color='w', markerfacecolor='#a5d6a7', markersize=10, linestyle='None', label='P3 BUY — Small MA pullback'),
    Line2D([0],[0], marker='^', color='w', markerfacecolor='#c8e6c9', markersize=9,  linestyle='None', label='SEC BUY'),
    Line2D([0],[0], marker='v', color='w', markerfacecolor='#ff1744', markersize=10, linestyle='None', label='P1 SELL — Trend reversal (incl. via neutral)'),
    Line2D([0],[0], marker='v', color='w', markerfacecolor='#ff6e40', markersize=10, linestyle='None', label='P2 SELL — 200 MA rejection'),
    Line2D([0],[0], marker='v', color='w', markerfacecolor='#ff8a65', markersize=10, linestyle='None', label='P4 SELL — Small MA rejection'),
    Line2D([0],[0], marker='v', color='w', markerfacecolor='#ffccbc', markersize=9,  linestyle='None', label='SEC SELL'),
    Line2D([0],[0], marker='D', color='w', markerfacecolor='#ffd740', markersize=8,  linestyle='None', label='Ribbon expansion breakout'),
    Line2D([0],[0], color='#4a9eff', linewidth=1.5, label='200 SMA'),
]
ax.legend(handles=handles, loc='upper left', facecolor='#161b22',
          edgecolor='#333333', labelcolor='#cccccc', fontsize=8, framealpha=0.9)

# Signal count summary
counts = {
    'P1 BUY': len(p1_buy), 'P2 BUY': len(p2_buy), 'P3 BUY': len(p3_buy),
    'P1 SELL': len(p1_sell), 'P2 SELL': len(p2_sell), 'P4 SELL': len(p4_sell),
}
summary = '  |  '.join(f'{k}: {v}' for k, v in counts.items())
fig.text(0.5, 0.005, summary, ha='center', color='#888888', fontsize=8.5)

# Save
safe_ticker = TICKER.replace('^', '').replace('=', '')
out = os.path.join(os.path.dirname(__file__), f'signals_{safe_ticker}.png')
plt.tight_layout()
plt.savefig(out, dpi=150, bbox_inches='tight', facecolor=fig.get_facecolor())
print(f'Saved → {out}')

# Signal table
sigs = df[df['primary_signal'].isin(['P1','P2','P3','P4'])][
    ['Close','trend_direction','primary_signal','signal_confidence','confirmation_status']
].copy()
sigs.index = sigs.index.date
print(f'\n── Signal Table ({LABEL}) ──')
print(sigs.to_string())
