#!/bin/sh


source /home/scelester/MyScripts/database_accesser.sh

name="last brightness lvl"

data=$(brightnessctl get)


if [[ $data -eq 0 ]];then
    last_br=$(db_get_data)
    hyprctl dispatch dpms on
else
    db_set_data
    hyprctl dispatch dpms off
fi