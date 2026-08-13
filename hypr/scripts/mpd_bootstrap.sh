#!/usr/bin/env bash
set -euo pipefail

socket="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/mpd/socket"
mpd_conf="$HOME/.config/mpd/mpd.conf"
socket_dir="$(dirname "$socket")"

# MPD does not create the parent directory for its Unix socket, so recreate it
# on every login before starting the daemon.
mkdir -p "$socket_dir"

# Wait for the daemon/socket, starting MPD only if nothing is listening yet.
if ! mpc -h "$socket" status >/dev/null 2>&1; then
  if ! pgrep -x mpd >/dev/null 2>&1; then
    mpd "$mpd_conf" >/dev/null 2>&1 &
  fi

  for _ in $(seq 1 10); do
    if mpc -h "$socket" status >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

# Load the whole library into the queue and start playback.
mpc -h "$socket" clear >/dev/null 2>&1 || true
mpc -h "$socket" update >/dev/null 2>&1 || true
mpc -h "$socket" add / >/dev/null 2>&1
mpc -h "$socket" shuffle >/dev/null 2>&1 || true
mpc -h "$socket" play >/dev/null 2>&1 || true
