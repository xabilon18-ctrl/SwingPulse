#!/usr/bin/env python3
"""Warn when a versioned static file changed without bumping its ?v= in index.html.

Stop hook. Never blocks — it prints a note and exits 0.

WHY
CLAUDE.md: "After any UI change, bump ?v=NNN ... in index.html." The query
string is the ONLY cache-buster: phones that already have the app installed
keep serving the old file until the URL changes, so a forgotten bump ships a
fix that nobody receives — and it looks deployed from this end, which is the
worst kind of failure this project keeps having.

Warns rather than blocks on purpose. Mid-edit the tree is legitimately
half-done, and a Stop hook that refuses to let you stop is a trap.

The assets are READ FROM index.html, not listed here (2026-10-21). The list
this used to carry named app.js, style.css and utils.js: utils.js had been
deleted, and the nine modules/*.js plus the icons and manifest that also
carry a ?v= were never checked. A hand-kept list decays the same way the
rule it enforces does; every `/static/...?v=N` reference is the list.
"""
import json
import re
import subprocess
import sys
import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEBAPP = 'swing_generator/webapp'
INDEX = f'{WEBAPP}/templates/index.html'
# src="/static/js/app.js?v=516", href="/static/css/style.css?v=374", ...
ASSET_RE = re.compile(r'(?:src|href)=["\'](/static/[^"\'?]+)\?v=(\d+)')


def _git(*args):
    try:
        return subprocess.run(['git', *args], cwd=REPO, capture_output=True,
                              text=True, timeout=15).stdout
    except (OSError, subprocess.SubprocessError):
        return ''


def _versions(text):
    """{repo path of the asset: its ?v= number} for every versioned reference."""
    return {f'{WEBAPP}{url}': v for url, v in ASSET_RE.findall(text)}


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

    before, after = _versions(head_index), _versions(live_index)
    stale = [f'{os.path.basename(path)} (still ?v={after[path]})'
             for path in sorted(after)
             if path in changed and before.get(path) == after[path]]

    if stale:
        print(json.dumps({'systemMessage':
            'Version bump missing: ' + ', '.join(stale) + '. '
            'Installed phones keep serving the cached file until ?v= changes in '
            'index.html, so this change would look deployed and not arrive. '
            'Bump it before running publish.py --ui-only.'}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
