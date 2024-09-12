#!/bin/bash

# Function to handle actions when power is disconnected (battery mode)
on_battery() {
    echo "Power disconnected, switching to battery mode..."
    # Set the Asus performance profile to Quiet
    ags -r "asusctl.setProfile('Quiet')"

    # Set the display configuration (e.g., refresh rate or resolution)
    hyprctl keyword monitor eDP-1,1920x1080,60,1

    # Kill hypridle and load the battery-specific config
    pkill hypridle
    nohup hypridle -c ~/.config/hypr/hypridle_battery.conf &

    # Change Hyprland settings for better battery life
    hyprctl keyword decoration:drop_shadow false
    hyprctl keyword misc:vfr true

    ags -r 'toggleChargingMode(0)'

}

# Function to handle actions when power is connected (AC mode)
on_ac() {
    echo "Power connected, reverting to AC mode..."
    # Revert Asus profile or display settings if necessary
    ags -r "asusctl.setProfile('Balanced')"  # Example revert to Balanced
    
    # Re-enable Hyprland shadow settings for performance on AC
    hyprctl keyword decoration:drop_shadow true
    hyprctl keyword misc:vfr false

    # Set the display configuration (e.g., resolution and refresh rate)
    hyprctl keyword monitor eDP-1,preferred,144,1

    pkill hypridle
    nohup hypridle -c ~/.config/hypr/hypridle.conf &
    ags -r 'toggleChargingMode(1)'
}

# Check and apply the initial power state
initialize_state() {
    sleep 3
    current_state=$(cat /sys/class/power_supply/ACAD/online)
    
    if [[ "$current_state" -eq 0 ]]; then
        # Power is disconnected (on battery)
        on_battery
    else
        # Power is connected (on AC)
        on_ac
    fi
}

# Monitor the power supply state and trigger actions on change
monitor_power_state() {
    last_state=$(cat /sys/class/power_supply/ACAD/online)

    while true; do
        current_state=$(cat /sys/class/power_supply/ACAD/online)

        if [[ "$current_state" != "$last_state" ]]; then
            if [[ "$current_state" -eq 0 ]]; then
                # Power is disconnected (on battery)
                on_battery
            else
                # Power is connected (on AC)
                on_ac
            fi
            last_state="$current_state"
        fi

        # Sleep for 5 seconds before checking again
        sleep 3
    done
}

# Initialize based on the current power state
initialize_state

# Start monitoring the power state for changes
monitor_power_state
