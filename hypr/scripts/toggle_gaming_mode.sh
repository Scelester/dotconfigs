#!/usr/bin/env bash

set -u

USER_HOME="/home/scelester"
STATE_DIR="${XDG_CACHE_HOME:-$USER_HOME/.cache}/gaming-mode"
STATE_FILE="$STATE_DIR/state.json"
ARCADE_DIR="$USER_HOME/ARCADE"
HYPRIDLE_CONF="$USER_HOME/.config/hypr/hypridle.conf"

mkdir -p "$STATE_DIR"

json_escape() {
  local value="${1//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/ }"
  printf '%s' "$value"
}

json_bool() {
  if [ "$1" = "1" ]; then
    printf 'true'
  else
    printf 'false'
  fi
}

read_json_bool() {
  local key="$1"
  if [ -f "$STATE_FILE" ] && grep -q "\"$key\"[[:space:]]*:[[:space:]]*true" "$STATE_FILE"; then
    printf '1'
  else
    printf '0'
  fi
}

read_json_string() {
  local key="$1"
  if [ ! -f "$STATE_FILE" ]; then
    return
  fi

  sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$STATE_FILE" | head -n1
}

read_json_int() {
  local key="$1"
  if [ ! -f "$STATE_FILE" ]; then
    printf '0'
    return
  fi

  sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\\([0-9]\\+\\).*/\\1/p" "$STATE_FILE" | head -n1
}

hypr_get_int() {
  local key="$1"
  local value
  value="$(hyprctl getoption "$key" -j 2>/dev/null | sed -n 's/.*"int":[[:space:]]*\([0-9]\+\).*/\1/p' | head -n1)"
  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '0'
  fi
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

proc_running() {
  local name="$1"
  pgrep -x "$name" >/dev/null 2>&1
}

stop_proc() {
  local name="$1"
  if proc_running "$name"; then
    pkill -x "$name" >/dev/null 2>&1 || true
    KILLED+=("$name")
  fi
}

start_in_bg() {
  nohup "$@" >/dev/null 2>&1 &
}

write_state() {
  local enabled="$1"
  local title="$2"
  local summary="$3"
  local previous_profile="$4"
  local animations="$5"
  local blur="$6"
  local vfr="$7"
  local hypridle_running="$8"
  local copyq_running="$9"
  local mega_running="${10}"
  local hyprshade_running="${11}"
  local awww_running="${12}"
  shift 12
  local killed_json=""
  local name

  for name in "$@"; do
    [ -n "$killed_json" ] && killed_json="$killed_json, "
    killed_json="$killed_json\"$(json_escape "$name")\""
  done

  cat > "$STATE_FILE" <<EOF
{
  "enabled": $(json_bool "$enabled"),
  "changedAt": $(date +%s),
  "title": "$(json_escape "$title")",
  "summary": "$(json_escape "$summary")",
  "arcadeDir": "$(json_escape "$ARCADE_DIR")",
  "previousProfile": "$(json_escape "$previous_profile")",
  "animations": $animations,
  "blur": $blur,
  "vfr": $vfr,
  "hypridleWasRunning": $(json_bool "$hypridle_running"),
  "copyqWasRunning": $(json_bool "$copyq_running"),
  "megaWasRunning": $(json_bool "$mega_running"),
  "hyprshadeWasEnabled": $(json_bool "$hyprshade_running"),
  "awwwWasRunning": $(json_bool "$awww_running"),
  "killedProcesses": [$killed_json]
}
EOF
}

enable_mode() {
  local previous_profile="balanced"
  local animations
  local blur
  local vfr
  local hypridle_running=0
  local copyq_running=0
  local mega_running=0
  local hyprshade_running=0
  local awww_running=0
  local summary

  KILLED=()

  if command_exists powerprofilesctl; then
    previous_profile="$(powerprofilesctl get 2>/dev/null || printf 'balanced')"
  fi

  animations="$(hypr_get_int "animations:enabled")"
  blur="$(hypr_get_int "decoration:blur:enabled")"
  vfr="$(hypr_get_int "misc:vfr")"

  proc_running hypridle && hypridle_running=1
  proc_running copyq && copyq_running=1
  proc_running mega-cmd-server && mega_running=1
  proc_running awww-daemon && awww_running=1
  command_exists hyprshade && hyprshade_running=1

  command_exists powerprofilesctl && powerprofilesctl set performance >/dev/null 2>&1 || true
  command_exists cpupower && cpupower frequency-set -g performance >/dev/null 2>&1 || true

  hyprctl keyword animations:enabled 0 >/dev/null 2>&1 || true
  hyprctl keyword decoration:blur:enabled 0 >/dev/null 2>&1 || true
  hyprctl keyword misc:vfr 0 >/dev/null 2>&1 || true
  hyprctl keyword decoration:dim_inactive 0 >/dev/null 2>&1 || true

  command_exists hyprshade && hyprshade off >/dev/null 2>&1 || true

  stop_proc mega-cmd-server
  stop_proc mega-cmd
  stop_proc megacmdserver
  stop_proc copyq
  stop_proc hypridle
  stop_proc awww-daemon

  summary="Performance locked. Blur and animations are off. Background junk is paused."
  write_state 1 "Gaming mode enabled" "$summary" "$previous_profile" "$animations" "$blur" "$vfr" \
    "$hypridle_running" "$copyq_running" "$mega_running" "$hyprshade_running" "$awww_running" \
    "${KILLED[@]}"
}

disable_mode() {
  local previous_profile
  local animations
  local blur
  local vfr
  local hypridle_running
  local copyq_running
  local mega_running
  local hyprshade_running
  local awww_running

  previous_profile="$(read_json_string previousProfile)"
  [ -n "$previous_profile" ] || previous_profile="balanced"

  animations="$(read_json_int animations)"
  blur="$(read_json_int blur)"
  vfr="$(read_json_int vfr)"
  hypridle_running="$(read_json_bool hypridleWasRunning)"
  copyq_running="$(read_json_bool copyqWasRunning)"
  mega_running="$(read_json_bool megaWasRunning)"
  hyprshade_running="$(read_json_bool hyprshadeWasEnabled)"
  awww_running="$(read_json_bool awwwWasRunning)"

  command_exists powerprofilesctl && powerprofilesctl set "$previous_profile" >/dev/null 2>&1 || true

  hyprctl keyword animations:enabled "${animations:-1}" >/dev/null 2>&1 || true
  hyprctl keyword decoration:blur:enabled "${blur:-1}" >/dev/null 2>&1 || true
  hyprctl keyword misc:vfr "${vfr:-0}" >/dev/null 2>&1 || true

  if [ "$hyprshade_running" = "1" ] && command_exists hyprshade; then
    hyprshade on vibrance >/dev/null 2>&1 || true
  fi

  if [ "$hypridle_running" = "1" ] && ! proc_running hypridle; then
    start_in_bg hypridle -c "$HYPRIDLE_CONF"
  fi

  if [ "$copyq_running" = "1" ] && ! proc_running copyq; then
    start_in_bg copyq
  fi

  if [ "$mega_running" = "1" ] && ! proc_running mega-cmd-server; then
    start_in_bg mega-cmd
  fi

  if [ "$awww_running" = "1" ] && ! proc_running awww-daemon; then
    start_in_bg awww-daemon
    sleep 0.4
    awww img -o "HDMI-A-1" "$USER_HOME/Pictures/Wallpapers/wallpaper_darker.jpg" >/dev/null 2>&1 || true
    awww img "$USER_HOME/Pictures/Wallpapers/wallhaven-rrvp91.jpg" >/dev/null 2>&1 || true
  fi

  write_state 0 "Gaming mode disabled" "Desktop effects and background services restored." \
    "$previous_profile" "${animations:-1}" "${blur:-1}" "${vfr:-0}" \
    "$hypridle_running" "$copyq_running" "$mega_running" "$hyprshade_running" "$awww_running"
}

current_enabled="$(read_json_bool enabled)"
mode="${1:-toggle}"

case "$mode" in
  on)
    enable_mode
    ;;
  off)
    disable_mode
    ;;
  status)
    if [ "$current_enabled" = "1" ]; then
      printf 'enabled\n'
    else
      printf 'disabled\n'
    fi
    ;;
  toggle|*)
    if [ "$current_enabled" = "1" ]; then
      disable_mode
    else
      enable_mode
    fi
    ;;
esac
