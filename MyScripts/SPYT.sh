#!/bin/bash

# Prompt for a search query
read -p "Enter YouTube search query: " query

# Search YouTube and get video titles and ids
results=$(yt-dlp "ytsearch5:$query" --flat-playlist --skip-download --quiet --get-title --get-id)

# Check if results are empty
if [ -z "$results" ]; then
  echo "No results found."
  exit 1
fi

# Format results with unit separator (ASCII 31) as delimiter
formatted_results=$(echo "$results" | paste -d$'\x1F' - -)

# Use fzf to select a video with safe delimiter
selected=$(echo "$formatted_results" | fzf --delimiter $'\x1F' --with-nth 1)

# Check if a selection was made
if [ -z "$selected" ]; then
  echo "No selection made."
  exit 1
fi

# Extract the video ID using the same delimiter
video_id=$(echo "$selected" | awk -F$'\x1F' '{print $2}')

# Construct the YouTube URL
url="https://www.youtube.com/watch?v=$video_id"
echo "video id: $url"

# Fetch the best audio URL using yt-dlp
audio_url=$(yt-dlp -f bestaudio --get-url "$url")
echo "audio url: $audio_url"

# Add the audio URL to MPD's playlist and start playing
mpc add "$audio_url"
mpc play