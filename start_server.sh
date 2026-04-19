#!/bin/bash
cd "$(dirname "$0")/swing_generator"
exec /usr/bin/python3 webapp/server.py
