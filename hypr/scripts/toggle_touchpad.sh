#!/bin/bash

# Define the file path
source /home/scelester/MyScripts/database_accesser.sh

name="TouchPadState"

if [ "$(db_get)" == "f" ]; then
  state="true"
  db_set

  # If the current state is "off," change it to "on" and run the command
  hyprctl keyword "device:elan1203:00-04f3:307a-touchpad:enabled" true
  hyprctl reload
  notify-send "Touchpad Enabled"

else
  state="false"
  db_set

  # If the current state is not "off," change it to "off" and run the command
  hyprctl keyword "device:elan1203:00-04f3:307a-touchpad:enabled" false
  echo "off" > "$file"

  notify-send "Touchpad Disabled"

fi
