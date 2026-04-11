#!/bin/bash
# /bin/battery_saver_mode - ACPI action script for battery/AC modes in a Wayland session

# Function for logging messages
log_message() {
    logger "$1"
}

# Get the active user (assumes one active session)
USER=$(who | awk '{print $1}' | head -n 1)
if [ -z "$USER" ]; then
    log_message "No logged-in user found."
    exit 1
fi

# Retrieve environment variables from the active user's session
XDG_RUNTIME_DIR=$(sudo -u "$USER" printenv XDG_RUNTIME_DIR)
WAYLAND_DISPLAY=$(sudo -u "$USER" printenv WAYLAND_DISPLAY)
DISPLAY=$(sudo -u "$USER" printenv DISPLAY)
HYPRLAND_INSTANCE_SIGNATURE=$(sudo -u "$USER" printenv HYPRLAND_INSTANCE_SIGNATURE)
XAUTHORITY=$(sudo -u "$USER" printenv XAUTHORITY)

# Export the necessary environment variables
export XDG_RUNTIME_DIR
export WAYLAND_DISPLAY
export DISPLAY
export HYPRLAND_INSTANCE_SIGNATURE
export XAUTHORITY

# Log the retrieved environment variables for debugging
log_message "Battery Saver: USER=$USER"
log_message "Battery Saver: XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR"
log_message "Battery Saver: WAYLAND_DISPLAY=$WAYLAND_DISPLAY"
log_message "Battery Saver: DISPLAY=$DISPLAY"
if [ -z "$HYPRLAND_INSTANCE_SIGNATURE" ]; then
    log_message "Battery Saver: HYPRLAND_INSTANCE_SIGNATURE not set! (is hyprland running?)"
else
    log_message "Battery Saver: HYPRLAND_INSTANCE_SIGNATURE=$HYPRLAND_INSTANCE_SIGNATURE"
fi
if [ -z "$XAUTHORITY" ]; then
    log_message "Battery Saver: XAUTHORITY not set (this is fine for Wayland)"
else
    log_message "Battery Saver: XAUTHORITY=$XAUTHORITY"
fi

# Define action functions

on_battery() {
    log_message "Power disconnected, switching to battery mode..."
    sudo -u "$USER" ags -r "asusctl.setProfile('Quiet')"
    sudo -u "$USER" hyprctl keyword monitor eDP-1,1920x1080,60,1
    sudo -u "$USER" hyprctl keyword decoration:drop_shadow false
    sudo -u "$USER" hyprctl keyword misc:vfr true
    sudo -u "$USER" systemd-run --user --scope /usr/local/bin/ags -r 'toggleChargingMode(0)'
}

on_ac() {
    log_message "Power connected, reverting to AC mode..."
    sudo -u "$USER" ags -r "asusctl.setProfile('Balanced')"
    sudo -u "$USER" hyprctl keyword decoration:drop_shadow true
    sudo -u "$USER" hyprctl keyword misc:vfr false
    sudo -u "$USER" hyprctl keyword monitor eDP-1,preferred,144,1
    sudo -u "$USER" systemd-run --user --scope /usr/local/bin/ags -r 'toggleChargingMode(1)'
}

# Determine the current power state (0 = unplugged, 1 = plugged)
power_state=$(cat /sys/class/power_supply/ACAD/online 2>/dev/null)
log_message "Current power state: $power_state"

if [[ "$power_state" -eq 0 ]]; then
    on_battery
else
    on_ac
fi

