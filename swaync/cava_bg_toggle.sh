#!/bin/bash

# Check if cava is running
if pgrep kitty > /dev/null; then
    # If cava is not running, kill all cava processes
    killall kitty

else
    # If cava is running, launch kitty with your script
    kitty --class="apped-bg" "/home/scelester/.config/hypr/scripts/apped_bg.sh"
fi
