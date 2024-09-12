#!/bin/bash

# Define the path to the profiles.ini file
PROFILES_INI="$HOME/.mozilla/firefox/profiles.ini"

# Check if the profiles.ini file exists
if [[ ! -f $PROFILES_INI ]]; then
  echo "Profiles file not found."
  exit 1
fi

# Extract all profile names from the profiles.ini file
awk -F '=' '
  /^\[Profile[0-9]+\]/ { profile = 1 }
  profile && $1 == "Name" { print $2; profile = 0 }
' "$PROFILES_INI"
