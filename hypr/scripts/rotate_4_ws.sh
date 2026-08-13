#!/usr/bin/env bash

MONITOR="eDP-1"
TARGET_WS="4"

# Function to check current workspace and set monitor orientation
update_orientation() {
    local active_ws
    active_ws=$(hyprctl activeworkspace -j | jq -r '.id')
    
    if [ "$active_ws" = "$TARGET_WS" ]; then
        # Workspace 4: Rotate 90 degrees
        hyprctl keyword monitor "$MONITOR,preferred,auto,1,transform,1" > /dev/null
    else
        # Any other workspace: Normal orientation
        hyprctl keyword monitor "$MONITOR,preferred,auto,1,transform,0" > /dev/null
    fi
}

# Run once on startup
update_orientation

# Listen to Hyprland's socket2 event stream
SOC2="$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.socket2.sock"

socat -U - UNIX-CONNECT:"$SOC2" | while read -r line; do
    case "$line" in
        workspace>*)
            update_orientation
            ;;
    esac
done
