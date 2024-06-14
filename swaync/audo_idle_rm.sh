#!/bin/bash

if pgrep -x "hypridle" > /dev/null; then
    killall hypridle
    notify-send "💻: I WON'T SLEEP"
else
    nohup hypridle >/dev/null 2>&1 &
    notify-send "💻: I will SLEEP"
fi

