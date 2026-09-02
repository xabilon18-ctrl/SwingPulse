#!/usr/bin/env python3
"""Assert that the numbers in a published payload are SHAPED like real numbers.

WHY THIS EXISTS (2026-08-17)
health_check.py answers "did the file move?". The golden test answers "did the
engine change?". Neither answers the question that has actually cost this
project the most: **the file moved, the engine is unchanged, and the number in
it is nonsense.** Every serious bug in the repo's history is that third kind:

  2026-07-25  365 instruments silently NEUTRAL — Yahoo returned bars with volume
              and no price. Every file published, on time, half of them blank.
              (measured below: 'No data' went 1.8% -> 51.6% overnight)
  since ship   the Market Pulse gauge's signal term was pinned to the constant
              15, because computeSummary() counted buys with
              confirmation_status.includes('buy') and that field's vocabulary is
              "Uptrend - above all MAs". The substring occurs zero times in the
              data. A third of the gauge formula was a constant for months.
  ~2 months    pct_1w / pct_1m were computed, published in every payload, and
              read by nothing until app.js v234.

None of those three has an assertion anyone would have thought to write first.
That is the whole point of this file: the checks here are not "is field X equal
to Y", they are "does this payload have the SHAPE of a working one" — is any
column dead, does the front end read anything that isn't there, does it compare
against a value that never occurs, did a distribution move further overnight
than it has ever legitimately moved.

WHAT IT IS NOT
Not a market opinion. Nothing here says a signal is right or a trend is real —
that is what backtest.py and the confidence map are for. This only asks whether
the data is structurally capable of being right.

THRESHOLDS ARE MEASURED, NOT PICKED
Every number below came from replaying the 23 signal snapshots in output_ma500/
(2026-06-29 .. 2026-08-13). The measurements are quoted at each constant. Where
a healthy range and a known-bug value do not separate cleanly, there is no check
— a threshold that cannot tell the two apart is worse than nothing, because it
trains you to ignore the output.

Usage:
  python3 tools/shape_audit.py                          # audit LIVE R2
  python3 tools/shape_audit.py --snapshot F.csv         # audit a local snapshot
  python3 tools/shape_audit.py --snapshot F --baseline G  # + drift vs G
  python3 tools/shape_audit.py --json                   # machine-readable
  python3 tools/shape_audit.py --warn-only              # report, always exit 0
"""
import argparse
import datetime
import json
import os
import re
import sys
import urllib.request

R2_BASE = 'https://pub-e74b1a3a64724b07a76b853093e21240.r2.dev/ma500'

# r2.dev 403s the default 'Python-urllib/3.x' — the same trap health_check.py
# documents. Sending a real agent here is not cosmetic.
USER_AGENT = 'SwingPulse-shapeaudit/1.0'

_HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_APP_JS = os.path.join(_HERE, '..', 'webapp', 'static', 'js', 'app.js')

# ── Measured constants ──────────────────────────────────────────────────────

# 'No data' share across the 21 healthy snapshots: 0.0% .. 1.9% (median 1.8%).
# On the 07-25 outage: 51.6%. Nothing has ever landed between 2% and 51%, so
# 5.0 sits ~2.6x above the observed healthy ceiling and ~10x below the bug.
NO_DATA_FAIL_PCT = 5.0

# Largest single-day shift in any trend_direction category across healthy days:
# 16.2pts (2026-07-30, the 4H bar-geometry fix — a deliberate engine change).
# Typical day: 2.9pts. The two outage days: 37.0 and 46.5pts. 25.0 clears the
# worst legitimate day by 1.5x and still catches both bugs.
#
# NB this fires on intentional engine changes too, and that is correct — a
# 16-point swing in what the app tells you SHOULD need a human to say "yes, I
# did that". It is a warning, not a failure, for exactly that reason.
DRIFT_WARN_PTS = 25.0

# Columns that are legitimately empty or constant. Everything NOT in here is
# expected to carry information, so that "absent from this list" always means
# "should vary".
KNOWN_DEAD = {
    'watch_flag': 'UI removed 2026-07-09; kept for payload compatibility',
    'potential_turning_point_flag': 'UI removed 2026-07-09; kept for payload compatibility',
    'h4_watch_flag': 'as above (4H)',
    'h4_potential_turning_point_flag': 'as above (4H)',
    'h4_confidence_context': 'CONTEXT_RULES are daily-only by design — see SIGNAL_RULES.md 4a',
}

# Columns the front end is not expected to read. Anything else that ships
# unread is a finding, not a fact of life.
ORPHAN_EXEMPT = {
    # Identity / bookkeeping consumed by the pipeline, the ledger or the CSV,
    # never rendered as such.
    'num', 'ticker', 'yf_ticker', 'profile',
} | set(KNOWN_DEAD)

# Files that WRITE the payload rather than read it. config.py declares the
# column list, main.py assembles the row, and indicators/signals/key_levels
# compute the values — a name appearing in any of them is not evidence that
# anything CONSUMES it, which is the whole question the orphan check asks.
# Getting this list wrong makes the tool lie in the reassuring direction: a
# first cut listed only config/main and duly reported that new_trend_flag was
# "read by signals.py", which is the module that computes it.
PRODUCER_FILES = {
    'config.py', '_active_config.py', 'main.py',
    'indicators.py', 'signals.py', 'key_levels.py', 'instruments.py',
    'data_fetcher.py', 'output_writer.py',
}


def _fetch_json(fname):
    url = f'{R2_BASE}/{fname}'
    req = urllib.request.Request(url, headers={
        'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache, max-age=0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def load_rows(snapshot=None):
    """Return (rows, label) where rows is a list of dicts, one per instrument.

    Deliberately NOT pandas. This has to run in CI next to health_check.py,
    which has no pandas dependency, and a list of dicts is all any check needs.
    """
    if snapshot:
        import csv
        with open(snapshot, newline='', encoding='utf-8') as fh:
            return list(csv.DictReader(fh)), os.path.basename(snapshot)
    doc = _fetch_json('signals.json')
    rows = doc.get('data') if isinstance(doc, dict) else None
    if not isinstance(rows, list):
        raise ValueError('signals.json has no "data" list')
    return rows, f'live R2 ({doc.get("date", "?")})'


def _blank(v):
    return v is None or (isinstance(v, str) and not v.strip()) or v != v


def _values(rows, col):
    """Non-blank values of a column, as strings."""
    return [str(r[col]).strip() for r in rows
            if col in r and not _blank(r.get(col))]


# ── Front-end reference extraction ──────────────────────────────────────────
# Regex over JavaScript is approximate by nature. It is used here in the one
# direction where approximation is safe: every check below is built so that a
# MISSED reference makes the tool quieter, never wronger. See each check.

# A comparison must be BOUND to the expression it tests, not merely near it.
# A first cut scanned a 160-char window after each accessor and produced 29
# findings on a clean payload, every one of them a comparison belonging to some
# other variable that happened to sit on a nearby line. Proximity is not
# binding. What follows matches the accessor, then a strict grammar of the
# things you are allowed to do to a value without changing which column it came
# from, and only then the comparison.
# The optional `item[` prefix matters: the live shareCard() bug reads
# `item[f('confirmation_status')] || ''`, where the accessor that identifies the
# column is the INNER f() call. Without this the alias below never binds.
_ACCESSOR = (r"""(?:\bitem\s*\[\s*)?"""
             r"""(?:(?<![\w$])f\(\s*['"]([a-z0-9_]+)['"]\s*\)"""
             r"""|\bitem\.([a-z_][a-z0-9_]*)"""
             r"""|\bitem\[\s*['"]([a-z0-9_]+)['"]\s*\])""")

# Closing brackets, a `|| ''` default, and the case/whitespace transforms. All
# value-preserving as far as "which column is this" is concerned.
_TAIL = (r"""(?:\s*[\)\]]|\s*(?:\|\||\?\?)\s*['"][^'"]*['"]"""
         r"""|\s*\.(?:toLowerCase|toUpperCase|trim|toString)\(\))*""")

_TEST = (r"""(?:\.(?:includes|startsWith|endsWith)\(\s*['"]([^'"]+)['"]"""
         r"""|\s*[=!]==?\s*['"]([^'"]+)['"])""")

_DIRECT = re.compile(_ACCESSOR + _TAIL + _TEST, re.I)

# The gauge bug did not test the accessor directly. It did this:
#     const status = (item[f('confirmation_status')] || '').toLowerCase();
#     if (status.includes('buy')) buyCount++;
# One level of aliasing, and the accessor-adjacent matcher above sees nothing.
# So aliases are resolved: a declaration whose right-hand side is exactly one
# accessor plus tail binds that name to that column for its enclosing block.
_ALIAS = re.compile(r"""\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*\(?\s*"""
                    + _ACCESSOR + _TAIL + r"""\s*;""", re.I)

# Single-letter and generic names are reused constantly across this file and
# are not worth the ambiguity.
_ALIAS_MIN_LEN = 3


def _blank_literals(js):
    """Return js with string/template/comment CONTENTS replaced by 'x'.

    Same length, same indices — so a regex can match on the real text while
    brace counting runs on this. Needed because app.js is dense with template
    literals, and a brace inside a string would wreck the scope walk.
    """
    out = list(js)
    i, n = 0, len(js)
    while i < n:
        c = js[i]
        if c in '\'"`':
            q, j = c, i + 1
            while j < n and js[j] != q:
                if js[j] == '\\':
                    out[j] = 'x'
                    j += 1
                if j < n:
                    out[j] = 'x'
                j += 1
            i = j + 1
        elif c == '/' and i + 1 < n and js[i + 1] == '/':
            while i < n and js[i] != '\n':
                out[i] = 'x'
                i += 1
        elif c == '/' and i + 1 < n and js[i + 1] == '*':
            j = js.find('*/', i + 2)
            j = n if j < 0 else j + 2
            for k in range(i, j):
                if js[k] != '\n':
                    out[k] = 'x'
            i = j
        else:
            i += 1
    return ''.join(out)


def _block_end(skeleton, start):
    """Index where the block enclosing `start` closes."""
    depth = 0
    for i in range(start, len(skeleton)):
        c = skeleton[i]
        if c == '{':
            depth += 1
        elif c == '}':
            if depth == 0:
                return i
            depth -= 1
    return len(skeleton)


def phantom_candidates(js, columns):
    """(column, literal, case_insensitive) triples the front end tests for.

    Emitted only for names that ARE columns, so a missed pattern costs a check
    rather than producing a false accusation.
    """
    skeleton = _blank_literals(js)
    out = []

    def emit(base, lit, ci):
        if not lit or len(lit) < 2:
            return
        for cand in (base, *(pre + base for pre in TF_PREFIXES_NB)):
            if cand in columns:
                out.append((cand, lit, ci))

    for m in _DIRECT.finditer(js):
        base = m.group(1) or m.group(2) or m.group(3)
        span = m.group(0)
        emit(base, m.group(4) or m.group(5),
             '.toLowerCase()' in span or '.toUpperCase()' in span)

    for m in _ALIAS.finditer(js):
        alias = m.group(1)
        base = m.group(2) or m.group(3) or m.group(4)
        if len(alias) < _ALIAS_MIN_LEN:
            continue
        folded = ('.toLowerCase()' in m.group(0)
                  or '.toUpperCase()' in m.group(0))
        # The alias is live until its enclosing block closes, or until the name
        # is re-declared — this file declares `const conf` in 11 separate
        # functions, and each must bind only its own.
        stop = _block_end(skeleton, m.end())
        redecl = re.search(r"\b(?:const|let|var)\s+%s\s*=" % re.escape(alias),
                           js[m.end():stop])
        if redecl:
            stop = m.end() + redecl.start()
        body = js[m.end():stop]
        use = re.compile(r"\b%s\b" % re.escape(alias) + _TAIL + _TEST)
        for u in use.finditer(body):
            emit(base, u.group(1) or u.group(2),
                 folded or '.toLowerCase()' in u.group(0)
                 or '.toUpperCase()' in u.group(0))
    return out


# ── Checks ──────────────────────────────────────────────────────────────────

def check_no_data(rows):
    """Rows the engine could not compute at all.

    The 07-25 signature: confirmation_status == 'No data'. This is the single
    highest-signal check in the file — a row saying 'No data' renders in the
    app as a blank card, which looks like a quiet instrument, not a broken one.
    """
    if not rows or 'confirmation_status' not in rows[0]:
        return []
    n = len(rows)
    bad = sum(1 for r in rows
              if str(r.get('confirmation_status', '')).strip().lower() == 'no data')
    pct = bad * 100.0 / n if n else 0.0
    if pct > NO_DATA_FAIL_PCT:
        return [('FAIL', 'no-data flood',
                 f'{bad}/{n} rows ({pct:.1f}%) have confirmation_status "No data" — '
                 f'healthy runs measure 0.0-1.9%. The app renders these as blank '
                 f'cards, which reads as a quiet instrument rather than a broken feed.')]
    return []


def check_degenerate(rows):
    """Columns that carry no information: all blank, or one value everywhere.

    A column that never varies is either dead weight in every payload or a
    computation that has quietly stopped computing. Both are worth knowing;
    the message does not guess which.
    """
    if not rows:
        return []
    findings = []
    n = len(rows)
    for col in rows[0].keys():
        if col in KNOWN_DEAD:
            continue
        vals = _values(rows, col)
        if not vals:
            findings.append(('WARN', 'dead column',
                             f'{col!r} is blank on all {n} rows.'))
        elif len(set(vals)) == 1 and len(vals) == n:
            findings.append(('WARN', 'constant column',
                             f'{col!r} is {vals[0]!r} on all {n} rows — it ships '
                             f'in every payload and can never change the display.'))
    return findings


def other_consumers():
    """{name: [files]} for every non-producer module in the package.

    Without this the orphan check overstates its case: h4_datetime is absent
    from app.js and looks dead, but signal_ledger.py reads it to resolve a 4H
    fire to its own bar. "The app does not read this" and "nothing reads this"
    are different claims and only the first one is provable from app.js.
    """
    roots = [os.path.join(_HERE, '..'), os.path.join(_HERE, '..', 'webapp')]
    out = {}
    for root in roots:
        try:
            names = os.listdir(root)
        except OSError:
            continue
        for fn in names:
            if not fn.endswith('.py') or fn in PRODUCER_FILES:
                continue
            path = os.path.join(root, fn)
            try:
                with open(path, encoding='utf-8', errors='replace') as fh:
                    out[fn] = fh.read()
            except OSError:
                pass
    return out


# ---------------------------------------------------------------------------
# Timeframe prefixes — READ FROM CONFIG, never restated here.
#
# Every prefixed column is reached through f('base'), never as the literal
# 'h4_close' / 'w_close', so each of these checks has to strip the prefix before
# it can decide whether the front end reads a column. That rule was written with
# 'h4_' hard-coded in five places; when Weekly shipped (2026-09-02) the auditor
# reported all 53 w_ columns as orphans while every one of them was live. An
# auditor that has to be edited for each new timeframe is one more place the
# timeframe list can go stale.
# ---------------------------------------------------------------------------
def _tf_prefixes():
    try:
        from _active_config import TF_PREFIXES
        return tuple(p for p in TF_PREFIXES if p)      # '' is the daily base
    except Exception:
        return ('h4_', 'w_')                            # last resort, not a default

TF_PREFIXES_NB = _tf_prefixes()


def _strip_tf(col: str) -> str:
    """Column name with its timeframe prefix removed, or unchanged."""
    for pre in TF_PREFIXES_NB:
        if col.startswith(pre):
            return col[len(pre):]
    return col


def check_orphans(rows, js):
    """Columns published but never mentioned anywhere in the front end.

    Substring search on purpose. A name that appears only in a comment counts
    as "referenced", so this UNDER-reports — and under-reporting is the safe
    direction: it will never tell you a live column is dead.

    A prefixed column is reached as f('close'), never as the literal
    'h4_close' / 'w_close', so it counts as read when its DAILY base is read.
    A first cut without this rule reported 13 live 4H columns as orphans, and
    the same omission for w_ reported all 53 weekly columns as orphans.
    """
    if not rows:
        return []
    findings = []
    others = other_consumers()
    for col in rows[0].keys():
        stripped = _strip_tf(col)
        if col in ORPHAN_EXEMPT or stripped.startswith('ma_'):
            continue
        if col in js:
            continue
        if stripped != col and stripped in js:
            continue
        elsewhere = sorted(f for f, src in others.items() if col in src)
        note = (f' Read by {", ".join(elsewhere)} though, so it is payload '
                f'weight for the app, not dead code.'
                if elsewhere else
                ' No other module reads it either — it is computed, published '
                'and never used.')
        findings.append(('WARN', 'orphan column',
                         f'{col!r} ships on every row and appears nowhere in '
                         f'app.js.' + note))
    return findings


# A field the front end reads through f() that is not a column.
#
# THE HISTORY MATTERS, because the first version of this check was wrong and
# deleting it was right. It flagged every name app.js reads that is not a
# column, keying on `item.x` as well as f('x') — and `item` is not always a
# signals row. It is a DOM node at app.js:2562 (`item.addEventListener`) and
# `__BUILDSTAMP__` is not a field read at all. Two of its three findings were
# noise, so it came out.
#
# What survived scrutiny is the f() half. `f()` applies the active timeframe
# prefix to a PAYLOAD COLUMN NAME — that is its only job and only use, so a
# name inside f() that is not a column is unambiguously a bug, with no type
# inference required. Narrowing to it turned a noisy check into an exact one.
#
# Reinstated 2026-08-17 after buildTrendsCards() was found doing
# `d[f('signal_type')] || d[f('signal')]` — neither is a column, never has
# been, so every Trends card showed a muted "No signal" for all 736
# instruments regardless of what fired. The deleted check had named both
# fields and been overruled by its own false positives.

def check_ghost_reads(rows, js):
    """f('name') where neither 'name' nor 'h4_name' is a column."""
    if not rows:
        return []
    cols = set(rows[0].keys())
    findings, seen = [], set()
    for m in re.finditer(r"""(?<![\w$])f\(\s*['"]([a-z0-9_]+)['"]\s*\)""", js, re.I):
        name = m.group(1)
        if name in seen:
            continue
        seen.add(name)
        if name in cols or any(pre + name in cols for pre in TF_PREFIXES_NB):
            continue
        findings.append(('FAIL', 'ghost read',
                         f"app.js reads f({name!r}), which is not a column on "
                         f"either timeframe — the read yields undefined on every "
                         f"row. f() is only ever applied to payload columns, so "
                         f"this is a name that does not exist."))
    return findings


def check_phantoms(rows, js):
    """Front-end compares a column against a literal that never occurs in it.

    THE GAUGE BUG. computeSummary() tested
    confirmation_status.includes('buy') against a vocabulary of "Uptrend -
    above all MAs" / "Downtrend - below all MAs". Zero matches, ever, so
    buy_count and sell_count were structurally 0 and a third of the Market
    Pulse formula sat on its no-signals fallback of 15 from the day it shipped.

    Reported as FAIL: unlike a drift, there is no market condition under which
    a predicate that matches nothing is correct.

    Tested against the FIELD FAMILY — 'x' and 'h4_x' together — not the single
    column. On 2026-08-13 only 33 rows carried a 4H signal and none of them
    happened to be 'standard', so a per-column test called
    h4_signal_confidence vs 'standard' a phantom. It is not: the predicate is
    fine and the sample was small. A literal is only phantom when it matches
    nowhere in the family, which is also what makes the daily and 4H halves of
    one real bug report once instead of twice.
    """
    if not rows:
        return []
    cols = set(rows[0].keys())
    seen, findings = set(), []
    for col, lit, ci in phantom_candidates(js, cols):
        base = _strip_tf(col)
        if (base, lit) in seen:
            continue
        seen.add((base, lit))
        family = [c for c in (base, 'h4_' + base) if c in cols]
        vals = [v for c in family for v in _values(rows, c)]
        if not vals:
            continue          # a dead column is check_degenerate's finding
        hay = [v.lower() for v in vals] if ci else vals
        needle = lit.lower() if ci else lit
        if not any(needle in v for v in hay):
            sample = sorted(set(vals))[:2]
            findings.append(('FAIL', 'phantom predicate',
                             f'app.js tests {"/".join(family)} against {lit!r}, '
                             f'which occurs in 0 of {len(vals)} values. Actual '
                             f'values look like {sample}. This comparison can '
                             f'never be true.'))
    return findings


def check_drift(rows, base_rows):
    """A categorical distribution that moved further overnight than it ever has.

    Warning, never a failure. A deliberate engine change moves these too (the
    4H geometry fix moved trend_direction 16.2pts), and the right response to
    that is a human saying "yes, I did that" — not a red pipeline.
    """
    if not rows or not base_rows:
        return []
    findings = []
    for col in ('trend_direction', 'confirmation_status', 'signal_confidence'):
        if col not in rows[0] or col not in base_rows[0]:
            continue
        def dist(rs):
            vs = _values(rs, col)
            out = {}
            for v in vs:
                out[v] = out.get(v, 0) + 1
            return {k: c * 100.0 / len(vs) for k, c in out.items()} if vs else {}
        a, b = dist(base_rows), dist(rows)
        if not a or not b:
            continue
        worst, key = 0.0, None
        for k in set(a) | set(b):
            d = abs(b.get(k, 0.0) - a.get(k, 0.0))
            if d > worst:
                worst, key = d, k
        if worst > DRIFT_WARN_PTS:
            findings.append(('WARN', 'distribution drift',
                             f'{col}: {key!r} moved {worst:.1f} points '
                             f'({a.get(key, 0.0):.1f}% -> {b.get(key, 0.0):.1f}%). '
                             f'Largest legitimate one-day move measured is 16.2pts. '
                             f'If you changed the engine, this is expected.'))
    return findings


# The two families answer to different owners, and mixing them in CI is a
# mistake worth avoiding up front.
#
#   data — properties of TODAY'S numbers. Changes every run, can break at 03:00
#          with nobody touching the repo, and SHOULD stop a bad publish.
#   code — properties of the front end against the payload's vocabulary. Cannot
#          change between two runs of the same commit, so gating the daily data
#          publish on it would mean a cosmetic front-end slip blocks your market
#          data for a day. It belongs on the code push instead.
CHECK_FAMILY = {
    'no-data flood': 'data',
    'distribution drift': 'data',
    'event feed': 'data',
    'phantom predicate': 'code',
    'orphan column': 'code',
    'ghost read': 'code',
    'constant column': 'code',
    'dead column': 'code',
}


def check_events(events_doc):
    """Is the event feed still a working one?

    The calendar has three ways to fail silently, and none of them stops the
    pipeline or changes a single number on the dashboard:

      - the whole fetch fails and write_events leaves YESTERDAY's file in place
        (deliberately — an outage must not cost a day of dates), so the app
        shows a stale month that looks exactly like a fresh one;
      - the FOMC parse breaks on a page redesign and macro rows drop to zero,
        which the UI reports as the honest-sounding "no rate decisions loaded";
      - the equity half returns nothing and the calendar is macro-only.

    All three are the "green run, wrong number" family this tool exists for.
    """
    out = []
    if events_doc is None:
        return [('WARN', 'event feed', 'events.json not published — the calendar '
                                       'tab has nothing to render')]

    events = events_doc.get('events') or []
    sources = events_doc.get('sources') or {}

    # Measured on the 2026-08-29 run: 701 rows (542 earnings, 156 ex-div, 3
    # FOMC) over a -7/+120 window. A tenth of that is not a quiet week.
    if len(events) < 70:
        out.append(('FAIL', 'event feed',
                    f'only {len(events)} events in the window — the 2026-08-29 '
                    f'baseline was 701. The equity fetch has probably failed.'))

    kinds = {}
    for e in events:
        kinds[e.get('type', '?')] = kinds.get(e.get('type', '?'), 0) + 1

    if not kinds.get('earnings'):
        out.append(('FAIL', 'event feed',
                    'no earnings rows at all — yfinance Ticker.calendar is the '
                    'only source for them, so this is a dead feed, not a quiet month'))

    # sources.fomc is set by the fetcher that names it, so a null here means the
    # Fed page did not answer or no longer parses. Warn, not fail: it must never
    # gate a day of market data, but it must not pass in silence either.
    if not (sources.get('fomc') or sources.get('macro')):
        out.append(('WARN', 'event feed',
                    'no FOMC dates loaded — federalreserve.gov did not answer, or '
                    'the calendar page markup changed (run tests/macro_events_test.py)'))
    elif not kinds.get('macro'):
        out.append(('FAIL', 'event feed',
                    'sources says the Fed calendar loaded but the payload holds zero '
                    'macro rows — the gap note will claim FOMC dates that are not there'))

    # Freshness. events.json is written by the same run as signals.json, so more
    # than a couple of runs' drift means the event fetch has been failing while
    # the pipeline stayed green.
    gen = events_doc.get('generated_at') or ''
    if gen:
        try:
            when = datetime.datetime.strptime(gen.replace('Z', ''), '%Y-%m-%dT%H:%M:%S')
            age_h = (datetime.datetime.utcnow() - when).total_seconds() / 3600
            if age_h > 72:
                out.append(('WARN', 'event feed',
                            f'events.json is {age_h/24:.1f} days old while signals '
                            f'are current — the event fetch has been failing quietly'))
        except ValueError:
            pass
    return out


def run(rows, js, base_rows=None, only='all', events_doc=None):
    findings = []
    findings += check_no_data(rows)
    findings += check_events(events_doc)
    findings += check_phantoms(rows, js)
    findings += check_degenerate(rows)
    findings += check_orphans(rows, js)
    findings += check_ghost_reads(rows, js)
    findings += check_drift(rows, base_rows)
    if only != 'all':
        findings = [f for f in findings
                    if CHECK_FAMILY.get(f[1], 'data') == only]
    return findings


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--snapshot', help='local signals CSV instead of live R2')
    ap.add_argument('--baseline', help='previous snapshot, enables the drift check')
    ap.add_argument('--app-js', default=DEFAULT_APP_JS)
    ap.add_argument('--only', choices=('all', 'data', 'code'), default='all',
                    help="'data' gates the daily publish; 'code' gates a code "
                         "push. See CHECK_FAMILY for why they are separate.")
    ap.add_argument('--json', action='store_true', help='machine-readable output')
    ap.add_argument('--warn-only', action='store_true', help='always exit 0')
    args = ap.parse_args()

    rows, label = load_rows(args.snapshot)
    base_rows = load_rows(args.baseline)[0] if args.baseline else None
    with open(args.app_js, encoding='utf-8') as fh:
        js = fh.read()

    # The event feed lives beside signals.json and fails independently of it.
    # Never fatal to FETCH: a missing file is itself a finding, not a crash.
    events_doc = None
    if not args.snapshot:
        try:
            events_doc = _fetch_json('events.json')
        except Exception:
            events_doc = None

    findings = run(rows, js, base_rows, only=args.only, events_doc=events_doc)

    if args.json:
        print(json.dumps([{'level': l, 'check': c, 'detail': d}
                          for l, c, d in findings], indent=2))
    else:
        print(f'Shape audit — {label}')
        print(f'  {len(rows)} rows x {len(rows[0]) if rows else 0} columns'
              f'  vs  {os.path.basename(args.app_js)}\n')
        fails = [f for f in findings if f[0] == 'FAIL']
        warns = [f for f in findings if f[0] == 'WARN']
        for level, check, detail in fails + warns:
            print(f'  {level}  [{check}]  {detail}\n')
        if not findings:
            print('  Clean — no structural problems found.')
        else:
            print(f'  {len(fails)} failure(s), {len(warns)} warning(s).')

    hard = any(f[0] == 'FAIL' for f in findings)
    return 1 if (hard and not args.warn_only) else 0


if __name__ == '__main__':
    sys.exit(main())
