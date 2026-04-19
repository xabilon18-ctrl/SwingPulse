#!/bin/bash
# Cron watchdog: restart Flask if it's not responding
if ! curl -s -o /dev/null -w '' --max-time 3 http://localhost:5050/ 2>/dev/null; then
  # Kill any zombie process on the port
  lsof -ti:5050 | xargs kill -9 2>/dev/null
  sleep 1
  cd "/Users/zabmbandze/Documents/Trading/Swing Trading Strategy/swing_generator"
  nohup /usr/bin/python3 webapp/server.py >> /tmp/swingpulse.log 2>&1 &
  echo "[$(date)] Server restarted by watchdog" >> /tmp/swingpulse.log
fi
