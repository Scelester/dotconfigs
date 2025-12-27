#!/usr/bin/env bash

# Path to the state file
STATE_FILE="$HOME/.env_mode"
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

# Read current state from the state file (ags or quickshell)
if [[ -f "$STATE_FILE" ]]; then
    MODE=$(cat "$STATE_FILE")
else
    # Default to "ags" if no state file exists
    MODE="ags"
fi

# Function to apply AGS configuration
apply_ags_config() {
    echo "Applying AGS configuration..."

    # Apply window rules for AGS mode
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

# Function to apply QuickShell configuration
apply_quickshell_config() {
    echo "Applying QuickShell configuration..."

    # Apply window rules for Quickshell mode
    hyprctl keyword workspace "w[tv1], gapsout:0, gapsin:0"
    hyprctl keyword workspace "f[1], gapsout:0, gapsin:0"
    hyprctl keyword windowrulev2 "bordersize 3, floating:0, onworkspace:w[tv1]"
    hyprctl keyword windowrulev2 "rounding 20, floating:0, onworkspace:w[tv1]"
    hyprctl keyword windowrulev2 "bordersize 0, floating:0, onworkspace:f[1]"
    hyprctl keyword windowrulev2 "rounding 20, floating:0, onworkspace:f[1]"

    # Stop AGS and related services
    pkill nm-applet 2>/dev/null
    ags quit
    killall blueman-applet

    # Start Quickshell
    qs -c caelestia &
}

# Apply the correct configuration based on the current state
if [[ "$MODE" == "ags" ]]; then
    apply_ags_config
else
    apply_quickshell_config
fi
