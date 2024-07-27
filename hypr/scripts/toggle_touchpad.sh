#!/bin/bash

# Source the database access functions
source /home/scelester/MyScripts/database_accesser.sh

# Define the name for the touchpad state
name="TouchPadState"

# Get the current state from the database
current_state=$(db_get)

# Determine the new state
if [ "$current_state" == "t" ]; then
    new_state="false"
else
    new_state="true"
fi

echo "current_state :$current_state"

# Update the state in the database
state="$new_state"
echo "new_state :$state"
db_set

# Use hyprctl to apply the new state
if [ "$new_state" == "true" ]; then
    hyprctl -r keyword '$TOUCHPAD_ENABLED' "true"
    notify-send "Touchpad is now enabled."
else
    hyprctl -r keyword '$TOUCHPAD_ENABLED' "false"
    notify-send "Touchpad is now disabled."
fi
