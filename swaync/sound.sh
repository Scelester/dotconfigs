#!/bin/bash

if [ $(swaync-client -D) = "false" ]; then
	paplay /usr/share/sounds/freedesktop/stereo/message.oga
fi
