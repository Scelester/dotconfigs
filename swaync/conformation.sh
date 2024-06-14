#!/bin/bash

# toggle swaync-client to show the notification center
swaync-client -t -sw

# Function to display a confirmation dialog
confirm_action() {
    local message="$1"
    zenity --question --text="$message" --title="Confirm Action"
}

# Function to execute a command if confirmed
execute_command() {
    local command="$1"
    local message="$2"

    if confirm_action "$message"; then
        eval "$command"
    fi
}

# Define the command and message for each action
case "$1" in
    poweroff)
        execute_command "systemctl poweroff" "Are you sure you want to 💤 power off?"
        ;;
    reboot)
        execute_command "systemctl reboot" "Are you sure you want to 🔄 reboot?"
        ;;
    suspend)
        execute_command "systemctl suspend" "Are you sure you want to ⏸ suspend?"
        ;;
    obs)
	obs
	;;
    *)
        echo "Unknown action: $1"
        exit 1
        ;;
esac

