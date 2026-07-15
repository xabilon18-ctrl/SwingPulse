"""
SwingPulse Edge Audit — phase 2 analysis.

Reads the per-trade context dataset written by backtest.py
(output_ma500/edge_audit_<date>.csv.gz) and slices expectancy by feature band
per (timeframe, signal code). Reports only *survivors* — condition bands that
clear all robustness gates — so a survivor is worth turning into a confidence
dimension or a hard filter.

Survivor gates (all must hold):
  - n >= MIN_N                     enough trades in the band
  - |avgR - baseline| >= MIN_EDGE  materially different from taking the signal blind
  - sign of the edge is the SAME in the 2016-2021 and 2022-2026 halves
    (each half needs >= MIN_HALF_N trades)
  - not a one-asset-class fluke: if one class is > CLASS_DOM of the band, the
    edge must survive with that class removed

Usage:
    python3 edge_audit.py                    # newest edge_audit_*.csv.gz
    python3 edge_audit.py --file path.csv.gz
"""

import argparse
import glob
import json
import os
from datetime import date

import numpy as np
import pandas as pd

from _active_config import OUTPUT_DIR
from data_fetcher import _cache_path

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ── Survivor gates ─────────────────────────────────────────────────────────
MIN_N      = 300     # band trade count
MIN_HALF_N = 75      # per-half trade count for stability check
MIN_EDGE   = 0.04    # |avgR - baseline| in R
CLASS_DOM  = 0.70    # a class over this share triggers the fluke re-check
# Each timeframe is split into two halves at its OWN median entry date, so the
# stability check works even though the 4H hourly cache only reaches back ~2022
# while the daily cache reaches 2016. A fixed calendar cut would zero out one
# 4H half and silently disqualify every 4H edge.

# ── Feature bands ──────────────────────────────────────────────────────────
# Each entry: column -> ordered list of (label, predicate on a numeric value).
def _bands():
    def rng(lo, hi):
        return lambda v: (lo is None or v >= lo) and (hi is None or v < hi)
    return {
        'rsi': [
            ('<30 oversold',   rng(None, 30)),
            ('30-45',          rng(30, 45)),
            ('45-55 neutral',  rng(45, 55)),
            ('55-70',          rng(55, 70)),
            ('70+ overbought', rng(70, None)),
        ],
        'rvol': [
            ('<0.7 quiet',     rng(None, 0.7)),
            ('0.7-1.3 normal', rng(0.7, 1.3)),
            ('1.3-2 elevated', rng(1.3, 2)),
            ('2+ spike',       rng(2, None)),
        ],
        'dist_anchor_pct': [
            ('<-15 far below', rng(None, -15)),
            ('-15..-5 below',  rng(-15, -5)),
            ('-5..0 at/below', rng(-5, 0)),
            ('0..5 at/above',  rng(0, 5)),
            ('5..15 above',    rng(5, 15)),
            ('15+ far above',  rng(15, None)),
        ],
        'atr_pct': [
            ('<1.5 low vol',   rng(None, 1.5)),
            ('1.5-3',          rng(1.5, 3)),
            ('3-5',            rng(3, 5)),
            ('5+ high vol',    rng(5, None)),
        ],
        'trend_age': [
            ('0 fresh',        rng(None, 1)),
            ('1-10 young',     rng(1, 11)),
            ('11-30',          rng(11, 31)),
            ('31-100 mature',  rng(31, 101)),
            ('100+ old',       rng(101, None)),
        ],
        'ma_order_score': [
            ('<=5 disordered', rng(None, 6)),
            ('6-11 mixed',     rng(6, 12)),
            ('12+ ordered',    rng(12, None)),
        ],
        'rollover_stage': [
            ('0',              rng(None, 1)),
            ('1',              rng(1, 2)),
            ('2',              rng(2, 3)),
            ('3',              rng(3, None)),
        ],
        'roc': [
            ('<-3 falling',    rng(None, -3)),
            ('-3..0',          rng(-3, 0)),
            ('0..3',           rng(0, 3)),
            ('3+ rising',      rng(3, None)),
        ],
    }


def _band_of(value, spec):
    if pd.isna(value):
        return None
    for label, pred in spec:
        if pred(float(value)):
            return label
    return None


# ── Derived columns ────────────────────────────────────────────────────────
def _add_regime(df: pd.DataFrame) -> pd.DataFrame:
    """Bull/bear tag from ^GSPC close vs its MA200 on the trade's entry date."""
    p = _cache_path('^GSPC')
    if not os.path.exists(p):
        df['regime'] = 'unknown'
        return df
    g = pd.read_parquet(p)[['Close']].copy()
    g['ma200'] = g['Close'].rolling(200, min_periods=200).mean()
    g['regime'] = np.where(g['Close'] >= g['ma200'], 'bull', 'bear')
    g.index = pd.to_datetime(g.index).normalize()
    lut = g['regime']
    ed = pd.to_datetime(df['entry_date']).dt.normalize()
    # as-of match: last GSPC bar on or before entry date
    reg = lut.reindex(lut.index.union(ed.unique())).ffill().reindex(ed.values)
    df['regime'] = reg.values
    df['regime'] = df['regime'].fillna('unknown')
    return df


def _add_alignment(df: pd.DataFrame) -> pd.DataFrame:
    """Is the fire aligned with the OTHER timeframe's trend?"""
    up = df['other_tf_trend'] == 'UPTREND'
    dn = df['other_tf_trend'] == 'DOWNTREND'
    long_ = df['side'] == 'long'
    short_ = df['side'] == 'short'
    df['aligned'] = np.select(
        [(long_ & up) | (short_ & dn), (long_ & dn) | (short_ & up)],
        ['aligned', 'counter'], default='neutral')
    return df


CATEGORICAL = {
    'regime':  ['bull', 'bear'],
    'aligned': ['aligned', 'counter', 'neutral'],
    'rollover_dir': ['bull', 'bear'],
}


# ── Core slicing ───────────────────────────────────────────────────────────
def _edge(sub_r: np.ndarray, base_avg: float) -> float:
    return sub_r.mean() - base_avg


def analyse(df: pd.DataFrame) -> list[dict]:
    df = df.copy()
    df['entry_dt'] = pd.to_datetime(df['entry_date'])
    # Per-timeframe median-date split (see note at HALF gates above)
    df['half'] = 'H1'
    half_cuts = {}
    for tf, g in df.groupby('tf'):
        cut = g['entry_dt'].median()
        half_cuts[tf] = str(cut.date())
        df.loc[(df['tf'] == tf) & (df['entry_dt'] >= cut), 'half'] = 'H2'
    df = _add_regime(df)
    df = _add_alignment(df)

    band_specs = _bands()
    findings = []
    analyse.half_cuts = half_cuts

    for (tf, sig), g in df.groupby(['tf', 'signal']):
        base = g['r_multiple'].mean()
        base_n = len(g)
        gh1 = g[g['half'] == 'H1']
        gh2 = g[g['half'] == 'H2']
        base_h1 = gh1['r_multiple'].mean() if len(gh1) else np.nan
        base_h2 = gh2['r_multiple'].mean() if len(gh2) else np.nan

        # Assemble (feature, band-label) -> mask
        feat_bands = {}
        for col, spec in band_specs.items():
            if col not in g.columns:
                continue
            labels = g[col].map(lambda v: _band_of(v, spec))
            for lab in [l for l, _ in spec]:
                feat_bands[(col, lab)] = labels == lab
        for col, cats in CATEGORICAL.items():
            if col not in g.columns:
                continue
            for cat in cats:
                feat_bands[(col, cat)] = g[col] == cat

        for (col, lab), mask in feat_bands.items():
            sub = g[mask]
            n = len(sub)
            if n < MIN_N:
                continue
            avg = sub['r_multiple'].mean()
            edge = avg - base
            if abs(edge) < MIN_EDGE:
                continue

            # Half stability
            s1 = sub[sub['half'] == 'H1']
            s2 = sub[sub['half'] == 'H2']
            if len(s1) < MIN_HALF_N or len(s2) < MIN_HALF_N:
                continue
            e1 = s1['r_multiple'].mean() - base_h1
            e2 = s2['r_multiple'].mean() - base_h2
            if np.sign(e1) != np.sign(e2) or np.sign(e1) != np.sign(edge):
                continue

            # One-class fluke check
            cls_share = sub['class'].value_counts(normalize=True)
            top_cls = cls_share.index[0]
            top_share = cls_share.iloc[0]
            fluke = False
            edge_ex = None
            if top_share > CLASS_DOM:
                ex = sub[sub['class'] != top_cls]
                if len(ex) >= MIN_HALF_N:
                    edge_ex = ex['r_multiple'].mean() - g[g['class'] != top_cls]['r_multiple'].mean()
                    if np.sign(edge_ex) != np.sign(edge) or abs(edge_ex) < MIN_EDGE / 2:
                        fluke = True
                else:
                    fluke = True   # can't verify outside the dominant class
            if fluke:
                continue

            # Half consistency: 1.0 = both halves equal magnitude, ~0 = one-period
            denom = max(abs(e1), abs(e2)) or 1e-9
            half_consistency = round(min(abs(e1), abs(e2)) / denom, 2)
            tier = 'robust' if half_consistency >= 0.33 else 'directional'

            findings.append({
                'tf': tf, 'signal': sig, 'feature': col, 'band': lab,
                'n': int(n), 'band_pct': round(n / base_n * 100, 1),
                'win_rate': round(sub['win'].mean() * 100, 1),
                'avg_r': round(float(avg), 3),
                'baseline_r': round(float(base), 3),
                'edge_r': round(float(edge), 3),
                'edge_h1': round(float(e1), 3),
                'edge_h2': round(float(e2), 3),
                'half_consistency': half_consistency,
                'tier': tier,
                'top_class': top_cls,
                'top_class_share': round(float(top_share) * 100, 1),
                'edge_ex_class': round(float(edge_ex), 3) if edge_ex is not None else None,
                'base_n': int(base_n),
            })

    findings.sort(key=lambda f: (f['tier'] != 'robust', -abs(f['edge_r'])))
    return findings


def _fmt_report(findings: list[dict]) -> str:
    lines = []
    robust = [f for f in findings if f['tier'] == 'robust']
    direc  = [f for f in findings if f['tier'] == 'directional']
    lines.append(f'EDGE AUDIT — {len(findings)} surviving condition bands '
                 f'({len(robust)} robust, {len(direc)} directional-only)')
    lines.append(f'gates: n>={MIN_N}, |edge|>={MIN_EDGE}R, same sign both halves, not 1-class fluke')
    lines.append('robust = both halves agree AND smaller half >= 1/3 of larger (not a single-period effect)')
    lines.append('=' * 100)

    def block(title, rows):
        if not rows:
            return
        pos = [f for f in rows if f['edge_r'] > 0]
        neg = [f for f in rows if f['edge_r'] < 0]
        lines.append(f'\n{title}')
        for sub_title, sub in (('  BOOSTERS (signal does better)', pos),
                               ('  DRAGS (signal does worse)', neg)):
            if not sub:
                continue
            lines.append(sub_title)
            lines.append(f'  {"tf":>3} {"sig":>4} {"feature":<16} {"band":<16} '
                         f'{"n":>6} {"win%":>6} {"avgR":>7} {"baseR":>7} {"edge":>7} '
                         f'{"H1":>7} {"H2":>7} {"cons":>5}')
            lines.append('  ' + '-' * 98)
            for f in sub:
                lines.append(f'  {f["tf"]:>3} {f["signal"]:>4} {f["feature"]:<16} {f["band"]:<16} '
                             f'{f["n"]:>6} {f["win_rate"]:>6.1f} {f["avg_r"]:>7.3f} '
                             f'{f["baseline_r"]:>7.3f} {f["edge_r"]:>+7.3f} '
                             f'{f["edge_h1"]:>+7.3f} {f["edge_h2"]:>+7.3f} {f["half_consistency"]:>5.2f}')

    block('=== ROBUST (act on these) ===', robust)
    block('=== DIRECTIONAL ONLY (right direction, but one period dominates — treat as weak) ===', direc)
    return '\n'.join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', help='edge_audit csv.gz (default: newest in output dir)')
    args = ap.parse_args()

    path = args.file
    if not path:
        cands = sorted(glob.glob(os.path.join(OUTPUT_DIR, 'edge_audit_*.csv.gz')))
        if not cands:
            raise SystemExit('No edge_audit_*.csv.gz found — run backtest.py first.')
        path = cands[-1]
    print(f'Loading {path} ...')
    df = pd.read_csv(path)
    print(f'{len(df)} trades. Analysing ...\n')

    findings = analyse(df)
    report = _fmt_report(findings)
    print(report)

    out_json = os.path.join(OUTPUT_DIR, f'edge_audit_findings_{date.today()}.json')
    with open(out_json, 'w') as f:
        json.dump({'generated_from': os.path.basename(path),
                   'gates': {'min_n': MIN_N, 'min_half_n': MIN_HALF_N,
                             'min_edge_r': MIN_EDGE, 'class_dom': CLASS_DOM,
                             'half_cuts': getattr(analyse, 'half_cuts', {})},
                   'findings': findings}, f, indent=1)
    out_txt = os.path.join(OUTPUT_DIR, f'edge_audit_findings_{date.today()}.txt')
    with open(out_txt, 'w') as f:
        f.write(report + '\n')
    print(f'\n✓ {len(findings)} findings → {out_json}')
    print(f'✓ report → {out_txt}')


if __name__ == '__main__':
    main()
