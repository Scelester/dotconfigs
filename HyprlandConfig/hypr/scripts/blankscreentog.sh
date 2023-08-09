#!/bin/sh

LF="/home/scelester/.config/hypr/scripts/lastbrighnesslvl"

C_br=$(brightnessctl get)


if [[ $C_br -eq 0 ]];then
    last_br=$(cat $LF)
    brightnessctl set $last_br
else
    echo "$C_br" > $LF
    brightnessctl set 0
fi