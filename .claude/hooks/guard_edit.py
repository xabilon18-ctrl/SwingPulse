#!/usr/bin/env python3
"""Block an edit that breaks a rule this project has already been bitten by.

PreToolUse hook on Edit|Write|MultiEdit. Reads the hook payload on stdin and
either stays silent (exit 0, no output) or denies the edit with a reason.

WHY A HOOK AND NOT A NOTE IN CLAUDE.md
Every rule below was already written in CLAUDE.md. Being written down did not
stop any of them being broken — a documented rule is one you must remember at
the exact moment you are thinking about something else.

WHAT IS DELIBERATELY *NOT* HERE, AND WHY IT MATTERS (2026-08-17)
This file started as four rules taken straight from CLAUDE.md. Writing them out
precisely enough to execute is what exposed that two were false:

  - "Lightweight Charts is pinned to v4" — the library is not in the codebase.
    Zero hits for lightweight/LightweightCharts/createChart across every
    .html/.js/.py. The rule outlived its subsystem. Replaced here by the pin
    that IS live: chart.js@4.5.1 + an SRI integrity hash.
  - "Never pass cross-TF volume columns through f()" — app.js does this 17
    times and those 17 are CORRECT. Both volume_spike_flag and
    h4_volume_spike_flag ship on every row and genuinely differ (208 daily
    spikes vs 138 4H, disagreeing on 224 of 736 rows), so f() picks the right
    one. A hook enforcing the rule as written would have fired on correct code
    and pushed the 4H board to show DAILY volume. Only the already-prefixed
    form is a real bug, and that is what is checked below.

The lesson is the same one the shape audit exists for: a rule decays as
silently as a frozen file. Grep for the thing a rule protects before you
automate it.

Only ADDED text is inspected (Edit's new_string, Write's content), so removing
an existing violation is never blocked.
"""
import json
import re
import sys


def _is_py(path):
    return path.endswith('.py')


def _is_web(path):
    return path.endswith(('.html', '.js'))


# (applies-to test, pattern, message). Patterns match what is being WRITTEN, so
# a rule fires only when the violation is going into the file.
RULES = [
    (
        _is_py,
        re.compile(r'\bfrom\s+config\s+import\b'),
        "CLAUDE.md rule 8: import `from _active_config import ...`, never "
        "`from config import ...` directly — _active_config.py is the shim that "
        "pins ACTIVE_PROFILE, and importing config.py straight bypasses it.\n"
        "`from _active_config import` does NOT trip this; only a bare "
        "`from config import` does.\n"
        "Harmless while one profile exists (the shim just re-exports), which is "
        "why instruments.py, plot_signals.py and plot_btc_signals.py have been "
        "getting away with it — don't add a fourth.",
    ),
    (
        _is_web,
        re.compile(r'cdn\.jsdelivr\.net/npm/chart\.js@(?!\d+\.\d+\.\d+)'),
        "chart.js must stay pinned to an EXACT version (chart.js@4.5.1), not a "
        "floating major like chart.js@4 — unpinned, the app silently follows "
        "every upstream release, which is how it shipped until 2026-07-29.\n"
        "Deliberately upgrading? Change the version AND regenerate the SRI "
        "integrity hash in the same edit.",
    ),
    (
        lambda p: p.endswith(('.js', '.html')),
        re.compile(r"""f\(\s*['"]h4_"""),
        "Never pass an ALREADY-PREFIXED column name through f(). f('h4_x') "
        "resolves to 'h4_h4_x' on the 4H timeframe — undefined on every row, and "
        "silent.\n"
        "Pass the unprefixed name and let f() pick the timeframe: "
        "f('volume_spike_flag'), not f('h4_volume_spike_flag').",
    ),
]


def main():
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0                    # never block on a payload we cannot read

    ti = payload.get('tool_input') or {}
    path = ti.get('file_path') or ''
    # Edit -> new_string, Write -> content, MultiEdit -> edits[].new_string
    added = ' '.join(
        str(x) for x in (
            [ti.get('new_string'), ti.get('content')]
            + [e.get('new_string') for e in (ti.get('edits') or [])]
        ) if x
    )
    if not path or not added:
        return 0

    for applies, pattern, message in RULES:
        if applies(path) and pattern.search(added):
            print(json.dumps({
                'hookSpecificOutput': {
                    'hookEventName': 'PreToolUse',
                    'permissionDecision': 'deny',
                    'permissionDecisionReason': message,
                }
            }))
            return 0
    return 0


if __name__ == '__main__':
    sys.exit(main())
