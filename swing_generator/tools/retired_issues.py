"""
Tell the owner when main.py retires or restores an instrument (2026-10-17).

main.py writes config.RETIRED_FILE every run: the instruments whose daily data
stopped more than STALE_INSTRUMENT_DAYS before the newest bar (dropped from
that run's board) and the ones within the limit ('fresh'). This turns that into
GitHub issues, and the issues ARE the state, so nothing persists between runs:

  - retired, and no issue (open OR closed) for this ticker with this last bar
        -> open one, mentioning the repo owner so GitHub emails them. Keyed on
           the last bar so an issue the owner closed by hand stays closed,
           while a later, separate stoppage still gets a new issue.
  - open issue, ticker no longer retired:
        in 'fresh'                 -> "data resumed", close
        gone from Instruments.txt  -> "removed from Instruments.txt", close
        neither (fetch failed, cold-cache skip, ...) -> leave it open; nothing
           is known, and claiming a recovery would be false.

A run main.py flagged as a feed outage touches no open issue. A missing or
unreadable RETIRED_FILE means main.py did not finish, and does nothing.
Runs in publish.yml after main.py with continue-on-error: a GitHub API problem
must never cost a publish.

Needs GITHUB_TOKEN (issues: write) and GITHUB_REPOSITORY.
Usage (from swing_generator/):  python3 tools/retired_issues.py [--dry-run]
"""

import argparse
import json
import os
import re
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from instruments import load_instruments, load_retired  # noqa: E402

API = 'https://api.github.com'
MARKER = '<!-- swingpulse-retired:{ticker}@{last_bar} -->'
# The @last_bar part is absent on issues opened before it existed.
_MARKER_RE = re.compile(r'<!-- swingpulse-retired:([^@\s]+?)(?:@(\d{4}-\d{2}-\d{2}))? -->')


def _call(method, path, token, body=None):
    req = urllib.request.Request(
        API + path, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': f'Bearer {token}',
                 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read() or b'null')


def _marked_issues(repo, token) -> list:
    """Every issue (open and closed) this script opened, parsed."""
    found, page = [], 1
    while True:
        batch = _call('GET', f'/repos/{repo}/issues?state=all&per_page=100&page={page}', token)
        for issue in batch:
            m = _MARKER_RE.search(issue.get('body') or '')
            if m and 'pull_request' not in issue:
                found.append({'number': issue['number'], 'state': issue['state'],
                              'ticker': m.group(1), 'last_bar': m.group(2)})
        if len(batch) < 100:
            return found
        page += 1


def plan(retired: list, issues: list, fresh: set, listed: set, outage: bool):
    """(to_open, to_close): records to open issues for, {number: (ticker, why)}
    with why 'resumed' or 'removed'."""
    def known(r):
        return any(i['ticker'] == r['ticker'] and
                   (i['last_bar'] == r['last_bar'] or (i['last_bar'] is None and i['state'] == 'open'))
                   for i in issues)
    to_open = [r for r in retired if not known(r)]
    to_close = {}
    if not outage:
        now = {r['ticker'] for r in retired}
        for i in issues:
            if i['state'] != 'open' or i['ticker'] in now:
                continue
            if i['ticker'] in fresh:
                to_close[i['number']] = (i['ticker'], 'resumed')
            elif i['ticker'] not in listed:
                to_close[i['number']] = (i['ticker'], 'removed')
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
            'gone for good, delete its line from `Instruments.txt` (this issue then '
            'closes itself). If it moved to a new ticker, replace the ticker there. '
            'Closing this issue by hand is fine too: it will not be reopened for '
            'the same stoppage.\n\n'
            + MARKER.format(ticker=r['ticker'], last_bar=r['last_bar']))


_CLOSE_TEXT = {
    'resumed': '`{t}` has fresh daily data again and is back on the board '
               '(newest bar {newest}). Closing.',
    'removed': '`{t}` is no longer in `Instruments.txt`. Closing.',
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    doc = load_retired()
    if not doc:
        print('retired_issues: no usable retired-instruments file — nothing to report')
        return
    retired = [r for r in doc['instruments']
               if isinstance(r, dict) and {'ticker', 'name', 'last_bar'} <= r.keys()]

    token, repo = os.environ.get('GITHUB_TOKEN'), os.environ.get('GITHUB_REPOSITORY')
    if not token or not repo:
        print('retired_issues: GITHUB_TOKEN / GITHUB_REPOSITORY unset — '
              f'retired this run: {[r["ticker"] for r in retired]}')
        return
    owner = os.environ.get('GITHUB_REPOSITORY_OWNER') or repo.split('/')[0]
    listed = {i['ticker'] for i in load_instruments(include_retired=True)}

    to_open, to_close = plan(retired, _marked_issues(repo, token),
                             set(doc.get('fresh') or []), listed, bool(doc.get('outage')))
    if doc.get('outage'):
        print('retired_issues: feed outage this run — leaving open issues alone')
    for r in to_open:
        title = f'Auto-removed: {r["name"]} ({r["ticker"]}) — no data for {r["days_behind"]} days'
        print(f'open issue: {title}')
        if not args.dry_run:
            _call('POST', f'/repos/{repo}/issues', token,
                  {'title': title, 'body': _issue_body(r, owner, doc.get('newest_bar'),
                                                       doc.get('threshold_days'))})
    for number, (ticker, why) in to_close.items():
        print(f'close issue #{number}: {ticker} {why}')
        if not args.dry_run:
            _call('POST', f'/repos/{repo}/issues/{number}/comments', token,
                  {'body': _CLOSE_TEXT[why].format(t=ticker, newest=doc.get('newest_bar'))})
            _call('PATCH', f'/repos/{repo}/issues/{number}', token,
                  {'state': 'closed', 'state_reason': 'completed'})
    if not to_open and not to_close:
        print(f'retired_issues: no change ({len(retired)} retired)')


if __name__ == '__main__':
    main()
