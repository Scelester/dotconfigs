#!/bin/bash

# Set the path to the directory containing the .so file
plugin_dir="$HOME/.local/share/hyprpm/hyprland-plugins"

# Load the .so file
if [[ -f "$plugin_dir/hyprexpo.so" ]]; then
    echo "Loading hyprexpo.so..."
    sleep 0.2
    LD_LIBRARY_PATH="$plugin_dir" hyprctl dispatch hyprexpo:expo toggle
else
    echo "Error: hyprexpo.so not found in $plugin_dir"
    exit 1
fi

