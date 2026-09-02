#!/usr/bin/env python3
"""Replay shape_audit.py against bugs that ALREADY HAPPENED.

WHY THIS EXISTS
A monitor nobody has falsified is a monitor nobody should trust. The checks in
shape_audit.py were written after reading the incidents they claim to catch,
which makes "it looks right" worthless as evidence — of course it looks right,
it was written looking at the answer. The only test that means anything is:
point it at the actual broken data from the actual outage and see whether it
speaks up, then point it at the 21 healthy days around it and see whether it
shuts up.

That second half is the half people skip. A checker that fires on everything
catches every bug and is still useless, because you stop reading it by week
two. So each case below asserts BOTH directions.

The historical app.js versions come out of git, because the two front-end bugs
are bugs in the FRONT END — replaying them against today's app.js would prove
nothing, since one of them has since been fixed.

  python3 tools/shape_audit_replay.py
"""
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shape_audit as sa                                    # noqa: E402

_HERE = os.path.dirname(os.path.abspath(__file__))
_GEN = os.path.join(_HERE, '..')
_OUT = os.path.join(_GEN, 'output_ma500')
APP_JS_PATH = 'swing_generator/webapp/static/js/app.js'

# The commit that fixed the gauge (v225). Its parent is the last commit where
# computeSummary() still counted buys with confirmation_status.includes('buy').
GAUGE_FIX = '495decd'


def _git_show(rev, path):
    return subprocess.run(['git', 'show', f'{rev}:{path}'], cwd=_GEN + '/..',
                          capture_output=True, text=True, check=True).stdout


def _snap(name):
    return sa.load_rows(os.path.join(_OUT, f'signals_{name}.csv'))[0]


def _has(findings, check, needle=''):
    return any(c == check and needle.lower() in d.lower()
               for _, c, d in findings)


CASES = []


def case(fn):
    CASES.append(fn)
    return fn


@case
def priceless_bars():
    """2026-07-25: Yahoo returned bars with volume and no price.

    365 instruments silently went NEUTRAL. Every file published on time; the
    app showed half its board as blank cards, which reads as a quiet market.
    """
    js = _git_show(GAUGE_FIX, APP_JS_PATH)
    bad = sa.run(_snap('2026-07-25'), js)
    good = sa.run(_snap('2026-07-21'), js)
    return ('priceless bars (07-25)',
            _has(bad, 'no-data flood'),
            not _has(good, 'no-data flood'),
            'no-data flood')


@case
def priceless_bars_drift():
    """The same outage seen as a distribution move, without knowing the cause.

    This is the check that generalises: it does not know what 'No data' means,
    only that trend_direction has never moved this far in a day.
    """
    js = _git_show(GAUGE_FIX, APP_JS_PATH)
    bad = sa.run(_snap('2026-07-25'), js, base_rows=_snap('2026-07-21'))
    good = sa.run(_snap('2026-07-21'), js, base_rows=_snap('2026-07-20'))
    return ('trend drift on the same outage',
            _has(bad, 'distribution drift'),
            not _has(good, 'distribution drift'),
            'distribution drift')


@case
def gauge_pinned():
    """The Market Pulse gauge's signal term, a constant since it shipped.

    computeSummary() counted buys with confirmation_status.includes('buy').
    That field says "Uptrend - above all MAs". Zero matches, so buy_count and
    sell_count were structurally 0 and a third of the gauge formula sat on its
    no-signals fallback of 15 for months.

    Negative side needs care, and the care is itself a finding. v225 fixed
    computeSummary() but NOT shareCard(), which still does
    `conf.toLowerCase().includes('buy')` on the same field at app.js:4595 —
    so the post-fix tree legitimately still trips this check, and asserting
    "clean after the fix" would be asserting something false.

    The control is therefore a tree with BOTH call sites neutralised. That
    proves the check responds to the predicate rather than to the mere
    presence of the field, which is the thing worth proving.
    """
    rows = _snap('2026-07-21')
    after_js = _git_show(GAUGE_FIX, APP_JS_PATH)
    control = (after_js
               .replace("conf.toLowerCase().includes('buy')", 'false')
               .replace("conf.toLowerCase().includes('sell')", 'false'))
    before = sa.run(rows, _git_show(GAUGE_FIX + '^', APP_JS_PATH))
    ctrl = sa.run(rows, control)
    return ('gauge pinned at 15',
            _has(before, 'phantom predicate', "against 'buy'"),
            not _has(ctrl, 'phantom predicate', "against 'buy'"),
            'phantom predicate')


@case
def unread_returns():
    """pct_1w / pct_1m: computed, published, and read by nothing for ~2 months.

    Fixed in app.js v234, which is what makes this a clean two-sided case —
    the same payload is an orphan against the old front end and is not against
    the new one.
    """
    rows = _snap('2026-08-04')
    # PINNED SHA, not HEAD~5. This was written as a relative ref and silently
    # stopped testing anything as soon as five more commits landed: by
    # 2026-09-02 HEAD~5 was 3f0bfaf, whose app.js already reads pct_1w, so the
    # "before" side of the case had no bug in it and the replay reported
    # caught=NO against a working auditor. A regression test anchored to a
    # moving ref is the exact failure this harness exists to catch, committed
    # by the harness itself. a4f2988 is the parent of f38385a (app.js v234,
    # the commit that started reading pct_1w) and is verified to contain zero
    # occurrences of the name.
    old = sa.run(rows, _git_show('a4f2988', APP_JS_PATH))
    with open(sa.DEFAULT_APP_JS, encoding='utf-8') as fh:
        new = sa.run(rows, fh.read())
    return ('pct_1w / pct_1m unread',
            _has(old, 'orphan column', 'pct_1w'),
            not _has(new, 'orphan column', 'pct_1w'),
            'orphan column')


@case
def quiet_on_healthy_days():
    """The one that decides whether anyone will still be reading this in a month.

    Every healthy snapshot, audited against the app.js of its own era, must
    raise no FAILURES. Warnings are allowed — dead columns really are there.

    Three findings are excluded from the count, and NOT because they are noise.
    Each is a REAL bug that was live in that app.js on every one of these days,
    so firing on all seven is the tool being right. Counting them would score it
    down for working:

      shareCard's buy/sell phantom      app.js:4595, fixed 2026-08-17 (v235)
      f('signal_type') / f('signal')    buildTrendsCards, fixed 2026-08-17

    Anything OUTSIDE this list on a healthy day is a false positive and fails
    the case. The list is deliberately specific — "ignore all ghost reads" would
    have hidden the very finding that justified reinstating that check.
    """
    # Snapshots must be CONTEMPORARY with the app.js they are audited against.
    # 2026-07-13 is deliberately excluded: confidence_context and
    # last_signal_price were both added on 07-15, so pairing a 07-13 payload
    # with the 07-25 front end reports two ghost reads that are an anachronism
    # of this harness, not a defect in the app or the checker. Auditing a front
    # end against a payload older than its own schema is not a healthy-day test.
    js = _git_show(GAUGE_FIX, APP_JS_PATH)
    # NB 2026-07-25 is the outage itself and belongs in the positive cases
    # above, not here — a "healthy day" list containing it would be scoring the
    # no-data flood check as noise.
    days = ['2026-07-15', '2026-07-16', '2026-07-17',
            '2026-07-19', '2026-07-20', '2026-07-21', '2026-07-26']
    KNOWN_LIVE_BUGS = [
        ('phantom predicate', "against 'buy'"),
        ('phantom predicate', "against 'sell'"),
        ('ghost read', "f('signal_type')"),
        ('ghost read', "f('signal')"),
    ]
    noisy = []
    for d in days:
        fails = [f for f in sa.run(_snap(d), js) if f[0] == 'FAIL'
                 and not any(_has([f], c, n) for c, n in KNOWN_LIVE_BUGS)]
        if fails:
            noisy.append((d, fails))
    return (f'quiet on {len(days)} healthy days',
            True, not noisy,
            f'{len(noisy)} noisy day(s)' if noisy else 'no spurious failures')


def main():
    print('Replaying shape_audit.py against bugs that already happened.\n')
    rows = []
    for fn in CASES:
        try:
            rows.append(fn())
        except Exception as exc:                            # noqa: BLE001
            rows.append((fn.__name__, False, False, f'ERROR: {exc}'))

    width = max(len(r[0]) for r in rows)
    ok = True
    for name, caught, quiet, note in rows:
        verdict = 'PASS' if (caught and quiet) else 'FAIL'
        ok = ok and caught and quiet
        print(f'  {verdict}  {name:<{width}}  '
              f'caught={"yes" if caught else "NO "}  '
              f'quiet-when-healthy={"yes" if quiet else "NO "}   [{note}]')

    print()
    if ok:
        print('All cases pass: every historical bug is detected, and the '
              'checks stay quiet on healthy data.')
    else:
        print('At least one case failed — do not wire this into CI yet.')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
