#!/usr/bin/env bash

KEYBOARD_VAR="LAPTOP_KB_ENABLED"
ICON=1
TIME_MS=2000
COLOR=0

STATE=$(hyprctl keyword $KEYBOARD_VAR 2>/dev/null || echo "true")

enable_keyboard() {
     sh -c "hyprctl keyword 'device[at-translated-set-2-keyboard]:enabled' 1"
    hyprctl notify $ICON $TIME_MS $COLOR "Keyboard is now enabled."
}

disable_keyboard() {
     sh -c "hyprctl keyword 'device[at-translated-set-2-keyboard]:enabled' 0"
    hyprctl notify $ICON $TIME_MS $COLOR "Keyboard is now disabled."
}

if [[ "$STATE" == "false" ]]; then
    enable_keyboard
else
    disable_keyboard
fi

