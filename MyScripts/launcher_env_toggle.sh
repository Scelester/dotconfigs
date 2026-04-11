#!/usr/bin/env bash

# Decide whether to use AGS or Caelestia launcher on SUPER+R
# If AGS is running, use its launcher; otherwise fall back to Caelestia.

if pgrep -x "ags" >/dev/null 2>&1; then
  # AGS v1 CLI: toggle the "launcher" window in the running instance
  /home/scelester/.config/rofi/scripts/launcher_t6
elif command -v caelestia >/dev/null 2>&1; then
  caelestia shell drawers toggle launcher
else
  notify-send "Launcher" "Neither AGS nor Caelestia found"
fi
