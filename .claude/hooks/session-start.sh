#!/bin/bash
# SessionStart hook: install what CI installs, so a cloud session can run the
# same tests before it pushes. Mirrors test.yml and deploy-app.yml.
set -euo pipefail

# Cloud sessions only; a local checkout already has its own environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# A project venv, not the system interpreter: system pip refuses to replace
# Debian-installed packages (flask's blinker dependency). .venv/ is gitignored.
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --quiet --disable-pip-version-check \
  -r swing_generator/requirements.txt
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"$CLAUDE_PROJECT_DIR/.venv/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

# Same pin as deploy-app.yml. The cloud image ships the matching Chromium in
# PLAYWRIGHT_BROWSERS_PATH, so no browser download is needed here.
npm install --no-save --no-audit --no-fund --silent @playwright/test@1.56.1
