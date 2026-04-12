#!/usr/bin/env bash

# Toggle AGS dashboard when the AGS control service is available; otherwise fall back to Caelestia sidebar.

if gdbus call --session \
  --dest org.scelester.AGS \
  --object-path /org/scelester/AGS \
  --method org.scelester.AGS.ToggleDashboard >/dev/null 2>&1; then
  exit 0
elif command -v caelestia >/dev/null 2>&1; then
  caelestia shell drawers toggle sidebar
else
  notify-send "Dashboard/Sidebar" "Neither AGS nor Caelestia found"
fi
