#!/usr/bin/env sh

state_file="/tmp/hypr-window-gaps-hidden-${UID:-$(id -u)}"

if [ -f "$state_file" ]; then
    rm -f "$state_file"
    hyprctl keyword general:gaps_in 5 >/dev/null
    hyprctl keyword general:gaps_out 20 >/dev/null
else
    : > "$state_file"
    hyprctl keyword general:gaps_in 0 >/dev/null
    hyprctl keyword general:gaps_out 0 >/dev/null
fi
