#!/bin/bash
# SwingPulse Tunnel — managed by launchd (auto-restarts on failure)
exec ssh -o StrictHostKeyChecking=no \
        -o ServerAliveInterval=30 \
        -o ServerAliveCountMax=3 \
        -o ExitOnForwardFailure=yes \
        -N -R 80:localhost:5050 serveo.net
