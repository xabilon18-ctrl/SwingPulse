#!/usr/bin/env python3
"""Warn when app.js or style.css changed without bumping its ?v= in index.html.

Stop hook. Never blocks — it prints a note and exits 0.

WHY
CLAUDE.md: "After any UI change, bump ?v=NNN on app.js, style.css and/or
utils.js in index.html." The query string is the ONLY cache-buster: phones that
already have the app installed keep serving the old file until the URL changes,
so a forgotten bump ships a fix that nobody receives — and it looks deployed
from this end, which is the worst kind of failure this project keeps having.

Warns rather than blocks on purpose. Mid-edit the tree is legitimately
half-done, and a Stop hook that refuses to let you stop is a trap.
"""
import json
import re
import subprocess
import sys
import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
INDEX = 'swing_generator/webapp/templates/index.html'
ASSETS = {
    'app.js': 'swing_generator/webapp/static/js/app.js',
    'style.css': 'swing_generator/webapp/static/css/style.css',
    'utils.js': 'swing_generator/webapp/static/js/utils.js',
}


def _git(*args):
    try:
        return subprocess.run(['git', *args], cwd=REPO, capture_output=True,
                              text=True, timeout=15).stdout
    except (OSError, subprocess.SubprocessError):
        return ''


def _version_of(text, asset):
    m = re.search(re.escape(asset) + r'\?v=(\d+)', text)
    return m.group(1) if m else None


def main():
    changed = set(_git('diff', 'HEAD', '--name-only').split())
    if not changed:
        return 0

    head_index = _git('show', f'HEAD:{INDEX}')
    live_index = ''
    try:
        with open(os.path.join(REPO, INDEX), encoding='utf-8') as fh:
            live_index = fh.read()
    except OSError:
        return 0
    if not head_index:
        return 0

    stale = []
    for asset, path in ASSETS.items():
        if path not in changed:
            continue
        before, after = _version_of(head_index, asset), _version_of(live_index, asset)
        if before is not None and before == after:
            stale.append(f'{asset} (still ?v={after})')

    if stale:
        print(json.dumps({'systemMessage':
            'Version bump missing: ' + ', '.join(stale) + '. '
            'Installed phones keep serving the cached file until ?v= changes in '
            'index.html, so this change would look deployed and not arrive. '
            'Bump it before running publish.py --ui-only.'}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
