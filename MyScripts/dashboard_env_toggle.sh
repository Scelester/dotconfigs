#!/usr/bin/env bash

# Toggle AGS dashboard when AGS is running; otherwise fall back to Caelestia sidebar.

if pgrep -x "ags" >/dev/null 2>&1; then
  ags toggle dashboard
elif command -v caelestia >/dev/null 2>&1; then
  caelestia shell drawers toggle sidebar
else
  notify-send "Dashboard/Sidebar" "Neither AGS nor Caelestia found"
fi
