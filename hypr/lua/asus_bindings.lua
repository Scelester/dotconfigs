-- ROG G15 Strix (2021) specific binds

-- bind = ,code:156, exec, rog-control-center -- ASUS Armory crate key (disabled)

-- Fan Profile key: switch between power profiles (FN key)
hl.bind("ALT + P", hl.dsp.exec_cmd("ags -r 'asusctl.nextProfile()'; pkill -SIGRTMIN+8 waybar"))

hl.bind("XF86AudioMute", hl.dsp.exec_cmd("~/.config/hypr/scripts/volume mute"), { locked = true })                    -- Speaker Mute FN+F1
hl.bind("XF86AudioRaiseVolume", hl.dsp.exec_cmd("~/.config/hypr/scripts/volume up"), { locked = true, repeating = true })   -- Volume higher key
hl.bind("XF86AudioLowerVolume", hl.dsp.exec_cmd("~/.config/hypr/scripts/volume down"), { locked = true, repeating = true }) -- Volume lower key
hl.bind("XF86AudioMicMute", hl.dsp.exec_cmd("~/.config/hypr/scripts/volume mic_mute"), { locked = true })             -- Mic mute key

hl.bind("ALT + V", hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SOURCE@ 0"))
hl.bind("ALT + V", hl.dsp.exec_cmd("wpctl set-mute @DEFAULT_AUDIO_SOURCE@ 1"), { release = true })

hl.bind("XF86MonBrightnessDown", hl.dsp.exec_cmd("brightnessctl -s set 2%-"), { locked = true }) -- Screen brightness down FN+F7
hl.bind("XF86MonBrightnessUp", hl.dsp.exec_cmd("brightnessctl -s set 2%+"), { locked = true })   -- Screen brightness up FN+F8

-- bind = ,code:237, exec, brightnessctl -d asus::kbd_backlight set 33%- -- Keyboard brightness down FN+F2 (disabled)
-- bind = ,code:238, exec, brightnessctl -d asus::kbd_backlight set 33%+ -- Keyboard brightness up FN+F3 (disabled)

hl.bind("code:211", hl.dsp.exec_cmd("asusctl led-mode -n"), { locked = true }) -- Switch keyboard RGB profile next FN+right-arrow
hl.bind("code:248", hl.dsp.exec_cmd("asusctl led-mode -p"), { locked = true }) -- Switch keyboard RGB profile prev FN+left-arrow
hl.bind("code:198", hl.dsp.exec_cmd("pamixer --default-source -t 5"), { locked = true }) -- toggle microphone mute

hl.bind("XF86Launch1", hl.dsp.exec_cmd("/home/scelester/.config/hypr/scripts/toggle_shaders"))

hl.bind("code:160", hl.dsp.exec_cmd("brightnessctl -s set 0%"), { locked = true })

hl.bind("XF86TouchpadToggle", hl.dsp.exec_cmd("/home/scelester/.config/hypr/scripts/toggle_touchpad.sh"))
hl.bind("XF86Calculator", hl.dsp.exec_cmd("galculator"))
