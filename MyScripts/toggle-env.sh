#!/usr/bin/env bash

STATE_FILE="$HOME/.env_mode"
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Read current state
if [[ -f "$STATE_FILE" ]]; then
    MODE=$(cat "$STATE_FILE")
else
    MODE="ags"
fi

# Function to switch to AGS mode
toggle_to_ags() {
    echo "ags" > "$STATE_FILE"
    echo "Switching to AGS..."

    # Set window rules for AGS mode
    hyprctl keyword workspace "w[tv1], gapsout:0, gapsin:0"
    hyprctl keyword workspace "f[1], gapsout:0, gapsin:0"
    hyprctl keyword windowrulev2 "bordersize 0, floating:0, onworkspace:w[tv1]"
    hyprctl keyword windowrulev2 "rounding 0, floating:0, onworkspace:w[tv1]"
    hyprctl keyword windowrulev2 "bordersize 0, floating:0, onworkspace:f[1]"
    hyprctl keyword windowrulev2 "rounding 0, floating:0, onworkspace:f[1]"

    # Start AGS and related services
    ags run &
    nm-applet --indicator &
    blueman-applet &
    pkill -f "qs -c caelestia" 2>/dev/null
}

# Function to switch to Quickshell mode
toggle_to_quickshell() {
    echo "quickshell" > "$STATE_FILE"
    echo "Switching to Quickshell..."

    # Set window rules for Quickshell mode
    hyprctl keyword workspace "w[tv1], gapsout:0, gapsin:0"
    hyprctl keyword workspace "f[1], gapsout:0, gapsin:0"
    hyprctl keyword windowrulev2 "bordersize 3, floating:0, onworkspace:w[tv1]"
    hyprctl keyword windowrulev2 "rounding 20, floating:0, onworkspace:w[tv1]"
    hyprctl keyword windowrulev2 "bordersize 0, floating:0, onworkspace:f[1]"
    hyprctl keyword windowrulev2 "rounding 20, floating:0, onworkspace:f[1]"

    # Stop AGS and related services
    pkill nm-applet 2>/dev/null
    killall blueman-applet
    ags quit

    # Start Quickshell
    qs -c caelestia &
}

# Toggle between AGS and Quickshell based on current mode
if [[ "$MODE" == "ags" ]]; then
    toggle_to_quickshell
else
    toggle_to_ags
fi

