#!/bin/bash
# SwingPulse Server — managed by launchd
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
exec /usr/bin/python3 webapp/server.py
