"""Fail a data build before upload if Daily/4H workflow files disagree."""
import gzip
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow_signals import RULE_VERSION


def validate(directory):
    def read(name):
        raw = (Path(directory) / name).read_bytes()
        return json.loads(gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw)
    rows = read('signals.json')['data']
    assert rows and all(row.get('signal_rule_version') == RULE_VERSION for row in rows), 'Signal rows use another rule version'
    assert all('h4_close' in row and 'h4_primary_signal' in row for row in rows), '4H columns missing'
    channels, alerts = read('trend_channels.json'), read('alerts.json')
    assert channels.get('workflow_version') == 1 and alerts.get('workflow_version') == 1, 'New workflow feed missing'
    contexts = channels['workflow']
    assert len(contexts['D']) >= len(rows)*0.8 and len(contexts['4H']) >= len(rows)*0.8, 'Workflow chart coverage below 80%'
    for name, context in contexts['D'].items():
        price, anchor = context.get('close'), context.get('mas', {}).get('500')
        if price is not None and anchor is not None and abs(price-anchor)>max(1,abs(anchor))*1e-12:
            assert context['direction'] == ('UPTREND' if price>anchor else 'DOWNTREND'), f'Daily MA500 mismatch: {name}'
        if anchor is None:
            assert context['direction'] == 'NEUTRAL', f'Missing Daily anchor substituted: {name}'
    assert all(e[1] in ('D','4H') for e in alerts['workflow_ev']), 'Independent 1H signal leaked into Alerts'
    assert all(e[2] in ('B1','S1','B2','S2','B3','S3','B4','S4') for e in alerts['workflow_ev'])
    setup_count = sum(bool(c.get('setup')) for c in contexts['4H'].values())
    assert setup_count >= len(rows)*0.8, 'Higher-timeframe setup references missing'
    for context in contexts['4H'].values():
        setup = context.get('setup')
        if not setup:
            continue
        assert setup['asOf'] == context['asOf'], 'Setup and 4H direction use different completed bars'
        assert all(level['id'] in ('D50','D250','D500','W50','W250','W500','M50') for level in setup['levels'])
    ledger = read('ledger_summary.json')
    assert ledger.get('rule_version') == RULE_VERSION, 'Saved signal statistics still mix old rules'
    print(f'PASS: shared Daily/4H workflow for {len(rows)} rows; {setup_count} setup reference sets')


if __name__ == '__main__':
    validate(sys.argv[1] if len(sys.argv)>1 else ROOT/'webapp/publish/data_ma500')
