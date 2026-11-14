"""Fail a data build before upload if Daily/1H workflow files disagree.

1H took 4H's place in the workflow on 2026-11-04 (4H removed): setup context,
workflow signals and Alerts events are Daily + 1H."""
import gzip
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from workflow_signals import RULE_VERSION


def validate(directory, require_ledger=True):
    """require_ledger=False is the hourly publish (webapp/publish.py). There a
    missing ledger_summary.json means signal_ledger.update_ledger skipped on
    purpose: it could not read the R2 ledger, and saving without it would
    clobber the remote copy. The upload sends only files that exist, so R2
    keeps the last ledger, which passed this check when it was published.
    2026-11-14 07:05 SAST: three R2 read timeouts made the ledger skip, this
    check then died with FileNotFoundError, and the whole hour's data was not
    uploaded over a file that had nothing new in it. Release builds (deploy,
    signal preflight) call the CLI and stay strict: a rule change must refresh
    the ledger."""
    def read(name):
        raw = (Path(directory) / name).read_bytes()
        return json.loads(gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw)
    rows = read('signals.json')['data']
    assert rows and all(row.get('signal_rule_version') == RULE_VERSION for row in rows), 'Signal rows use another rule version'
    # 30m and 4H removed 2026-11-11: their columns must not come back unnoticed.
    assert not any(k.startswith(('h4_', 'm30_')) for k in rows[0]), '30m/4H columns are back'
    channels, alerts = read('trend_channels.json'), read('alerts.json')
    assert channels.get('workflow_version') == 1 and alerts.get('workflow_version') == 1, 'New workflow feed missing'
    contexts = channels['workflow']
    assert '4H' not in contexts, '4H workflow context is back (removed 2026-11-04)'
    assert len(contexts['D']) >= len(rows)*0.8 and len(contexts['1H']) >= len(rows)*0.8, 'Workflow chart coverage below 80%'
    for name, context in contexts['D'].items():
        price, anchor = context.get('close'), context.get('mas', {}).get('500')
        if price is not None and anchor is not None and abs(price-anchor)>max(1,abs(anchor))*1e-12:
            assert context['direction'] == ('UPTREND' if price>anchor else 'DOWNTREND'), f'Daily MA500 mismatch: {name}'
        if anchor is None:
            assert context['direction'] == 'NEUTRAL', f'Missing Daily anchor substituted: {name}'
    assert all(e[1] in ('D','1H') for e in alerts['workflow_ev']), 'A timeframe other than Daily/1H in the Alerts workflow'
    assert all(e[2] in ('B1','S1','B2','S2','B3','S3','B4','S4') for e in alerts['workflow_ev'])
    setup_count = sum(bool(c.get('setup')) for c in contexts['1H'].values())
    assert setup_count >= len(rows)*0.8, 'Higher-timeframe setup references missing'
    for context in contexts['1H'].values():
        setup = context.get('setup')
        if not setup:
            continue
        assert setup['asOf'] == context['asOf'], 'Setup and 1H direction use different completed bars'
        assert all(level['id'] in ('D50','D250','D500','W50','W250','W500','M50') for level in setup['levels'])
    if (Path(directory) / 'ledger_summary.json').exists():
        ledger = read('ledger_summary.json')
        assert ledger.get('rule_version') == RULE_VERSION, 'Saved signal statistics still mix old rules'
    else:
        assert not require_ledger, 'ledger_summary.json missing: the signal ledger was not refreshed'
        print('WARN: ledger_summary.json not refreshed this run (R2 ledger unreadable); '
              'R2 keeps the last published copy')
    print(f'PASS: shared Daily/1H workflow for {len(rows)} rows; {setup_count} setup reference sets')


if __name__ == '__main__':
    validate(sys.argv[1] if len(sys.argv)>1 else ROOT/'webapp/publish/data_ma500')
