"""
Plot BTC/USD daily chart with MA ribbon and all BP/SP signals marked.
Run from the swing_generator/ directory:
    python3 plot_btc_signals.py
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

# ---------------------------------------------------------------------------
# Fetch & process
# ---------------------------------------------------------------------------
print('Fetching BTC-USD...')
df = fetch('BTC-USD')
if df is None:
    print('ERROR: no data'); sys.exit(1)

df = add_all_indicators(df)
df = add_signals(df)

# Trim to Mar 2023 onward (matches the chart window)
df = df[df.index >= '2023-03-01'].copy()
print(f'Rows after trim: {len(df)}  ({df.index[0].date()} → {df.index[-1].date()})')

# ---------------------------------------------------------------------------
# Signal rows
# ---------------------------------------------------------------------------
bp1 = df[df['primary_signal'] == 'BP1']
sp1 = df[df['primary_signal'] == 'SP1']
bp2 = df[df['primary_signal'] == 'BP2']
sp2 = df[df['primary_signal'] == 'SP2']
bp3 = df[df['primary_signal'] == 'BP3']
sp3 = df[df['primary_signal'] == 'SP3']
bp4 = df[df['primary_signal'] == 'BP4']
sp4 = df[df['primary_signal'] == 'SP4']

# ---------------------------------------------------------------------------
# Figure
# ---------------------------------------------------------------------------
fig, ax = plt.subplots(figsize=(22, 12))
fig.patch.set_facecolor('#0d1117')
ax.set_facecolor('#0d1117')

dates = df.index

# ── MA Ribbon: draw each MA as a thin line, shade between extremes ────────
ma_cols_all  = [f'ma_{p}' for p in MA_PERIODS]
ma_cols_small = [f'ma_{p}' for p in SMALL_MA_RANGE]
ma_108 = df['ma_108']
ma_10  = df['ma_10']

# Shade between ma_10 and ma_108 (ribbon body)
uptrend_mask   = df['trend_direction'] == 'UPTREND'
downtrend_mask = df['trend_direction'] == 'DOWNTREND'

ax.fill_between(dates, df['ma_10'], df['ma_108'],
                where=uptrend_mask,
                color='#1a6632', alpha=0.25, linewidth=0, label='_nolegend_')
ax.fill_between(dates, df['ma_10'], df['ma_108'],
                where=downtrend_mask,
                color='#661a1a', alpha=0.25, linewidth=0, label='_nolegend_')
ax.fill_between(dates, df['ma_10'], df['ma_108'],
                where=~(uptrend_mask | downtrend_mask),
                color='#333355', alpha=0.20, linewidth=0, label='_nolegend_')

# Individual MA lines (thin, muted)
for col in ma_cols_all:
    if col in df.columns:
        lw = 0.6 if col not in ('ma_10', 'ma_108') else 1.0
        color = '#4a9eff' if col == 'ma_108' else '#888888'
        ax.plot(dates, df[col], color=color, linewidth=lw, alpha=0.5)

# ── Candlestick (simplified: OHLC bars) ───────────────────────────────────
bar_width = 0.6
for i, (date, row) in enumerate(df.iterrows()):
    color = '#26a69a' if row['Close'] >= row['Open'] else '#ef5350'
    # body
    ax.bar(date, abs(row['Close'] - row['Open']),
           bottom=min(row['Open'], row['Close']),
           width=pd.Timedelta(hours=14), color=color, linewidth=0)
    # wick
    ax.plot([date, date], [row['Low'], row['High']],
            color=color, linewidth=0.7, alpha=0.8)

# ── Price line ────────────────────────────────────────────────────────────
ax.plot(dates, df['Close'], color='#ffffff', linewidth=0.4, alpha=0.3)

# ── Signal markers ────────────────────────────────────────────────────────
MARKER_SIZE = 120

def plot_signals(signal_df, y_col, marker, color, offset_pct, label):
    if signal_df.empty:
        return
    prices = signal_df[y_col]
    offset = prices * offset_pct
    ax.scatter(signal_df.index, prices + offset,
               s=MARKER_SIZE, marker=marker, color=color,
               zorder=10, linewidths=1.2, edgecolors='white', label=label)
    for date, price in zip(signal_df.index, prices + offset):
        ax.annotate(label.split(' ')[0],
                    xy=(date, price),
                    xytext=(0, 14 if offset_pct > 0 else -14),
                    textcoords='offset points',
                    ha='center', va='bottom' if offset_pct > 0 else 'top',
                    fontsize=7.5, color=color, fontweight='bold',
                    bbox=dict(boxstyle='round,pad=0.2', fc='#0d1117',
                              ec=color, lw=0.8, alpha=0.85))

# BUY signals — below the low, pointing up
plot_signals(bp1, 'Low', '^', '#00e676', -0.025, 'BP1')
plot_signals(bp2, 'Low', '^', '#a5d6a7', -0.022, 'BP2')
plot_signals(bp3, 'Low', '^', '#69f0ae', -0.020, 'BP3')
plot_signals(bp4, 'Low', '^', '#c8e6c9', -0.018, 'BP4')

# SELL signals — above the high, pointing down
plot_signals(sp1, 'High', 'v', '#ff1744', 0.025, 'SP1')
plot_signals(sp2, 'High', 'v', '#ff8a65', 0.022, 'SP2')
plot_signals(sp3, 'High', 'v', '#ff6e40', 0.020, 'SP3')
plot_signals(sp4, 'High', 'v', '#ffccbc', 0.018, 'SP4')

# ── Axes styling ──────────────────────────────────────────────────────────
ax.set_title('BTC/USD · Daily · SwingPulse Signal Map',
             color='white', fontsize=15, pad=12, fontweight='bold')
ax.tick_params(colors='#aaaaaa', labelsize=9)
for spine in ax.spines.values():
    spine.set_color('#333333')
ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
plt.xticks(rotation=30, ha='right', color='#aaaaaa')
ax.yaxis.set_major_formatter(plt.FuncFormatter(
    lambda x, _: f'${x:,.0f}'))
ax.set_ylabel('Price (USD)', color='#aaaaaa', fontsize=10)
ax.grid(color='#1e2329', linewidth=0.6, linestyle='--', alpha=0.7)

# ── Legend ────────────────────────────────────────────────────────────────
legend_elements = [
    Line2D([0],[0], marker='^', color='w', markerfacecolor='#00e676',
           markersize=10, label='BP1 — Trend reversal (ribbon cross)', linestyle='None'),
    Line2D([0],[0], marker='^', color='w', markerfacecolor='#a5d6a7',
           markersize=10, label='BP2 — Fast MA pullback (10–66)', linestyle='None'),
    Line2D([0],[0], marker='^', color='w', markerfacecolor='#69f0ae',
           markersize=10, label='BP3 — MA108 bounce', linestyle='None'),
    Line2D([0],[0], marker='^', color='w', markerfacecolor='#c8e6c9',
           markersize=9, label='BP4 — Key level bounce', linestyle='None'),
    Line2D([0],[0], marker='v', color='w', markerfacecolor='#ff1744',
           markersize=10, label='SP1 — Trend reversal (ribbon cross)', linestyle='None'),
    Line2D([0],[0], marker='v', color='w', markerfacecolor='#ff8a65',
           markersize=10, label='SP2 — Fast MA rejection (10–66)', linestyle='None'),
    Line2D([0],[0], marker='v', color='w', markerfacecolor='#ff6e40',
           markersize=10, label='SP3 — MA108 rejection', linestyle='None'),
    Line2D([0],[0], marker='v', color='w', markerfacecolor='#ffccbc',
           markersize=9,  label='SP4 — Key level rejection', linestyle='None'),
    Line2D([0],[0], color='#4a9eff', linewidth=1.5, label='MA108'),
]
leg = ax.legend(handles=legend_elements, loc='upper left',
                facecolor='#161b22', edgecolor='#333333',
                labelcolor='#cccccc', fontsize=8.5, framealpha=0.9)

# ── Signal count summary in corner ───────────────────────────────────────
counts = {
    'BP1': len(bp1), 'BP2': len(bp2), 'BP3': len(bp3), 'BP4': len(bp4),
    'SP1': len(sp1), 'SP2': len(sp2), 'SP3': len(sp3), 'SP4': len(sp4),
}
summary = '  '.join(f'{k}: {v}' for k, v in counts.items())
fig.text(0.5, 0.01, summary, ha='center', color='#888888', fontsize=8)

# ── Save ──────────────────────────────────────────────────────────────────
out_path = os.path.join(os.path.dirname(__file__), 'btc_signals.png')
plt.tight_layout()
plt.savefig(out_path, dpi=150, bbox_inches='tight',
            facecolor=fig.get_facecolor())
print(f'\nSaved → {out_path}')

# Print signal table
all_signals = df[df['primary_signal'].isin(['BP1','SP1','BP2','SP2','BP3','SP3','BP4','SP4'])][
    ['Close', 'trend_direction', 'primary_signal', 'signal_confidence',
     'confirmation_status']
].copy()
all_signals.index = all_signals.index.date
print('\n── Signal Table ──────────────────────────────────────────────────')
print(all_signals.to_string())
