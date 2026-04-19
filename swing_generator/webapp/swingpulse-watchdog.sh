#!/bin/bash
# SwingPulse Watchdog — keeps Flask server + Serveo tunnel alive
# Usage: nohup bash swingpulse-watchdog.sh &

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT=5050
LOG="/tmp/swingpulse.log"
TUNNEL_LOG="/tmp/serveo-tunnel.log"

start_server() {
  echo "[$(date)] Starting Flask server..." >> "$LOG"
  cd "$DIR" && /usr/bin/python3 webapp/server.py >> "$LOG" 2>&1 &
  sleep 2
}

start_tunnel() {
  echo "[$(date)] Starting Serveo tunnel..." >> "$TUNNEL_LOG"
  ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes -R 80:localhost:$PORT serveo.net >> "$TUNNEL_LOG" 2>&1 &
  sleep 5
}

# Initial start
start_server
start_tunnel

# Watchdog loop — check every 30 seconds
while true; do
  # Check Flask
  if ! lsof -ti:$PORT > /dev/null 2>&1; then
    echo "[$(date)] Flask server died — restarting" >> "$LOG"
    start_server
    sleep 2
    # Restart tunnel too since server was down
    pkill -f "ssh.*serveo" 2>/dev/null
    start_tunnel
  fi

  # Check Serveo tunnel
  if ! pgrep -f "ssh.*serveo" > /dev/null 2>&1; then
    echo "[$(date)] Serveo tunnel died — restarting" >> "$TUNNEL_LOG"
    start_tunnel
  fi

  sleep 30
done
