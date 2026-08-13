-- Autostart
-- See https://wiki.hypr.land/Configuring/Basics/Autostart/
-- exec-once only ever ran once per Hyprland startup (not on reload), so
-- everything here is wrapped in the hyprland.start event.

hl.on("hyprland.start", function()
    local function run(cmd, rule)
        hl.dispatch(hl.dsp.exec_cmd(cmd, rule))
    end

    run("gnome-keyring-daemon --start --components=secrets")
    run("/usr/lib/polkit-gnome/polkit-gnome-authentication-agent-1 || /usr/libexec/polkit-gnome-authentication-agent-1")

    run("dbus-update-activation-environment --all")
    run("systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XDG_CURRENT_DESKTOP QT_STYLE_OVERRIDE QT_QPA_PLATFORMTHEME QT_QUICK_CONTROLS_STYLE")
    run("dbus-update-activation-environment --systemd DISPLAY WAYLAND_DISPLAY XDG_CURRENT_DESKTOP QT_STYLE_OVERRIDE QT_QPA_PLATFORMTHEME QT_QUICK_CONTROLS_STYLE")

    run("hyprpm reload")

    run("hyprshade on vibrance")

    run("/home/scelester/.config/hypr/scripts/custom_script_starter")

    -- Ferdium: launch into the special:f8 workspace, silently
    run("sleep 10 && Ferdium &", { workspace = "special:f8 silent" })
    run("sleep 10 && org.ferdium.Ferdium &", { workspace = "special:f8 silent" })

    run("copyq &")

    run("bash /home/scelester/.config/hypr/scripts/mpd_bootstrap.sh")

    run("/home/scelester/MyScripts/battery_warrning &")
    run("/home/scelester/.config/hypr/scripts/use_last_widget.sh &")
    run("hyprctl setcursor Fluentt 27")

    run("awww-daemon &")
    run('awww img -o "HDMI-A-1" Pictures/Wallpapers/wallpaper_darker.jpg &')
    run("awww img /home/scelester/Pictures/Wallpapers/wallhaven-jevqpy_1920x1080.png &")

    run("sleep 1 && battery_saver_mode &")

    run("mega-cmd &")
end)
