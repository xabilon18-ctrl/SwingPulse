"""
Tell the owner when main.py retires or restores an instrument (2026-10-17).

main.py writes config.RETIRED_FILE every run: the instruments whose daily data
stopped more than STALE_INSTRUMENT_DAYS before the newest bar, dropped from
that run's board. This turns changes in that list into GitHub issues — the
issues ARE the state, so nothing has to persist between runs:

  - retired, no open issue for it  -> open one (mentions the repo owner, so
                                      GitHub emails them)
  - open issue, no longer retired  -> comment "data resumed" and close it

Each issue carries a hidden marker naming its ticker, so titles can change
freely. Runs in publish.yml after main.py with continue-on-error: a GitHub API
problem must never cost a publish. A missing or unreadable RETIRED_FILE means
main.py did not finish, and does nothing; so does a run main.py flagged as a
feed outage (too many stale at once to retire). Neither may read as
"everything restored".

Needs GITHUB_TOKEN (issues: write) and GITHUB_REPOSITORY.
Usage (from swing_generator/):  python3 tools/retired_issues.py [--dry-run]
"""

import argparse
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _active_config import RETIRED_FILE  # noqa: E402

API = 'https://api.github.com'
MARKER = '<!-- swingpulse-retired:{ticker} -->'


def _call(method, path, token, body=None):
    req = urllib.request.Request(
        API + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': f'Bearer {token}',
                 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read() or b'null')


def _open_marked(repo, token) -> dict:
    """{ticker: issue number} for every open issue this script opened."""
    found, page = {}, 1
    while True:
        batch = _call('GET', f'/repos/{repo}/issues?state=open&per_page=100&page={page}', token)
        for issue in batch:
            body = issue.get('body') or ''
            if 'pull_request' in issue or '<!-- swingpulse-retired:' not in body:
                continue
            ticker = body.split('<!-- swingpulse-retired:', 1)[1].split(' -->', 1)[0]
            found[ticker] = issue['number']
        if len(batch) < 100:
            return found
        page += 1


def plan(retired: list, open_issues: dict):
    """(to_open, to_close): records to open issues for, ticker->number to close."""
    now = {r['ticker'] for r in retired}
    to_open = [r for r in retired if r['ticker'] not in open_issues]
    to_close = {t: n for t, n in open_issues.items() if t not in now}
    return to_open, to_close


def _issue_body(r, owner, newest, threshold):
    return (f'@{owner} **{r["name"]}** (`{r["ticker"]}`) was removed from the board '
            f'automatically: its last daily bar is **{r["last_bar"]}**, {r["days_behind"]} '
            f'days behind the newest bar of the run ({newest}). The limit is '
            f'{threshold} days.\n\n'
            'Usually this means Yahoo stopped publishing the ticker: a delisting, a '
            'takeover or a ticker change. Nothing was edited. The instrument is '
            'still in `Instruments.txt` and is checked again every run, so if its '
            'data resumes it returns on its own and this issue closes itself.\n\n'
            '**What to do:** confirm what happened (TradingView or Yahoo). If it is '
            'gone for good, delete its line from `Instruments.txt`. If it moved to '
            'a new ticker, replace the ticker there.\n\n'
            + MARKER.format(ticker=r['ticker']))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    try:
        with open(RETIRED_FILE, encoding='utf-8') as f:
            doc = json.load(f)
        retired = doc['instruments']
    except (OSError, ValueError, KeyError) as exc:
        print(f'retired_issues: no usable {RETIRED_FILE} ({exc}) — nothing to report')
        return

    token, repo = os.environ.get('GITHUB_TOKEN'), os.environ.get('GITHUB_REPOSITORY')
    if not token or not repo:
        print('retired_issues: GITHUB_TOKEN / GITHUB_REPOSITORY unset — '
              f'retired this run: {[r["ticker"] for r in retired]}')
        return
    owner = os.environ.get('GITHUB_REPOSITORY_OWNER') or repo.split('/')[0]

    to_open, to_close = plan(retired, _open_marked(repo, token))
    if doc.get('outage'):
        # Nothing could be retired this run, so nothing is known to be restored.
        print('retired_issues: feed outage this run — leaving open issues alone')
        to_close = {}
    for r in to_open:
        title = f'Auto-removed: {r["name"]} ({r["ticker"]}) — no data for {r["days_behind"]} days'
        print(f'open issue: {title}')
        if not args.dry_run:
            _call('POST', f'/repos/{repo}/issues', token,
                  {'title': title, 'body': _issue_body(r, owner, doc.get('newest_bar'),
                                                       doc.get('threshold_days'))})
    for ticker, number in to_close.items():
        print(f'close issue #{number}: {ticker} has data again')
        if not args.dry_run:
            _call('POST', f'/repos/{repo}/issues/{number}/comments', token,
                  {'body': f'`{ticker}` has fresh daily data again and is back on the '
                           f'board (newest bar {doc.get("newest_bar")}). Closing.'})
            _call('PATCH', f'/repos/{repo}/issues/{number}', token,
                  {'state': 'closed', 'state_reason': 'completed'})
    if not to_open and not to_close:
        print(f'retired_issues: no change ({len(retired)} retired)')


if __name__ == '__main__':
    main()
