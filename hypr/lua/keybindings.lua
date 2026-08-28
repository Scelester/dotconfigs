local mainMod = "SUPER"

local function exec(cmd)
    return hl.dsp.exec_cmd(cmd)
end

hl.bind(mainMod .. " + Space", exec("alacritty"))                              -- open the terminal
hl.bind(mainMod .. " + SHIFT + Space", exec("alacritty --title=float"))        -- open the terminal (floating)
hl.bind("ALT + F4", hl.dsp.window.close())                                     -- close the active window
hl.bind(mainMod .. " + L", exec("pidof hyprlock || hyprlock && sleep 0.5"))    -- lock the screen
hl.bind(mainMod .. " + M", exec("ags toggle datemenu"))                        -- show the logout window
hl.bind(mainMod .. " + SHIFT + M", hl.dsp.exit())                              -- exit Hyprland entirely (force quit)
hl.bind(mainMod .. " + E", exec("thunar"))                                     -- graphical file browser
hl.bind(mainMod .. " + V", exec("copyq toggle"))
hl.bind(mainMod .. " + P", hl.dsp.window.float({ action = "toggle" }))
hl.bind(mainMod .. " + O", hl.dsp.window.set_prop({ prop = "opaque", value = "toggle" }))
hl.bind(mainMod .. " + J", hl.dsp.layout("togglesplit"))                       -- dwindle only

hl.bind("Print", exec('wayfreeze --after-freeze-cmd \'grim -g "$(slurp)" - | tee ~/Pictures/Screenshots/"$(date +%Y-%m-%d_%H-%M-%S)".png | wl-copy; killall wayfreeze\''))
hl.bind("CTRL + Print", exec("ags request 'recorder.screenshot(true)'"))
hl.bind(mainMod .. " + ALT + R", exec("ags request 'recorder.start()'"))
hl.bind(mainMod .. " + W", exec("ags toggle 'bar0'"))
hl.bind(mainMod .. " + grave", exec("/home/scelester/MyScripts/dashboard_env_toggle.sh"))
hl.bind(mainMod .. " + S", exec('ags request "openSearchOverlay()"'))

-- rofi / launcher
hl.bind(mainMod .. " + R", exec("/home/scelester/MyScripts/launcher_env_toggle.sh"))
hl.bind("ALT + R", exec("/home/scelester/.config/rofi/scripts/launcher_t4"))

-- gmail
hl.bind(mainMod .. " + G", exec("gmail-desktop"))
hl.bind(mainMod .. " + SHIFT + G", exec("/home/scelester/.local/bin/gaming-mode-toggle"))

-- mpd
hl.bind("ALT + SHIFT + Space", exec("mpc toggle"))
hl.bind("ALT + SHIFT + comma", exec("mpc prev"))
hl.bind("ALT + SHIFT + period", exec("mpc next"))
hl.bind("ALT + SHIFT + right", exec("mpc seek +5"))
hl.bind("ALT + SHIFT + left", exec("mpc seek -5"))
hl.bind("ALT + SHIFT + down", exec("mpc volume -10"))
hl.bind("ALT + SHIFT + up", exec("mpc volume +10"))

hl.bind(mainMod .. " + Y", exec("firefox --new-window 'youtube.com'"))

-- note: SUPER+G is bound twice in the original config (gmail-desktop above, and
-- the Games special workspace below) - both fire, kept as-is
hl.bind(mainMod .. " + G", hl.dsp.workspace.toggle_special("Games"))

hl.bind("F7", hl.dsp.workspace.toggle_special("f7"))
hl.bind("F8", hl.dsp.workspace.toggle_special("f8"))

hl.bind(mainMod .. " + A", hl.dsp.workspace.toggle_special("QS"))
hl.bind(mainMod .. " + SHIFT + A", hl.dsp.window.move({ workspace = "special:QS" }))

hl.bind(mainMod .. " + period", exec("rofimoji"))

hl.bind("F9", hl.dsp.workspace.toggle_special("f9"))

-- Move focus with mainMod + arrow keys
hl.bind(mainMod .. " + left", hl.dsp.focus({ direction = "left" }))
hl.bind(mainMod .. " + right", hl.dsp.focus({ direction = "right" }))
hl.bind(mainMod .. " + up", hl.dsp.focus({ direction = "up" }))
hl.bind(mainMod .. " + down", hl.dsp.focus({ direction = "down" }))

hl.bind("ALT + SHIFT + A", hl.dsp.focus({ direction = "left" }))
hl.bind("ALT + SHIFT + D", hl.dsp.focus({ direction = "right" }))
hl.bind("ALT + SHIFT + W", hl.dsp.focus({ direction = "up" }))
hl.bind("ALT + SHIFT + S", hl.dsp.focus({ direction = "down" }))

-- Switch workspaces with mainMod + [1-8]
-- Move active window to a workspace with mainMod + SHIFT + [1-8]
for i = 1, 8 do
    hl.bind(mainMod .. " + " .. i, hl.dsp.focus({ workspace = i }))
    hl.bind(mainMod .. " + SHIFT + " .. i, hl.dsp.window.move({ workspace = i }))
end

-- Move/resize windows with mainMod + LMB/RMB and dragging
hl.bind(mainMod .. " + mouse:272", hl.dsp.window.drag(), { mouse = true })
hl.bind(mainMod .. " + mouse:273", hl.dsp.window.resize(), { mouse = true })

-- open firefox default profile (the new profile, not the old one)
hl.bind(mainMod .. " + B", exec('firefox -no-remote -profile "/home/scelester/.config/mozilla/firefox/xuscfuul.default-release"'))

-- custom workspace setup
hl.bind("CTRL + ALT + left", hl.dsp.focus({ workspace = "-1" }))
hl.bind("CTRL + ALT + right", hl.dsp.focus({ workspace = "+1" }))
hl.bind("CTRL + ALT + SHIFT + right", hl.dsp.window.move({ workspace = "+1" }))
hl.bind("CTRL + ALT + SHIFT + left", hl.dsp.window.move({ workspace = "-1" }))
hl.bind(mainMod .. " + D", hl.dsp.focus({ workspace = "empty" }))
hl.bind(mainMod .. " + N", hl.dsp.window.move({ workspace = "empty" }))
hl.bind(mainMod .. " + SHIFT + N", hl.dsp.window.move({ workspace = "empty silent" }))

-- resize windows
hl.bind("ALT + l", hl.dsp.window.resize({ x = 30, y = 0 }), { repeating = true })
hl.bind("ALT + h", hl.dsp.window.resize({ x = -30, y = 0 }), { repeating = true })
hl.bind("ALT + j", hl.dsp.window.resize({ x = 0, y = -30 }), { repeating = true })
hl.bind("ALT + k", hl.dsp.window.resize({ x = 0, y = 30 }), { repeating = true })

-- custom windows setup
hl.bind("F11", hl.dsp.window.fullscreen())
hl.bind(mainMod .. " + F", hl.dsp.window.fullscreen())
hl.bind(mainMod .. " + C", hl.dsp.window.center())

-- NOTE on hl.dsp.exec_raw: it looks like the intended passthrough for raw/
-- plugin dispatcher names, and it returns "ok" with no error - but verified
-- live against the running compositor (toggling a window group, switching
-- workspaces) it never actually performs the action. It's a no-op in this
-- Hyprland build (0.56.2). Everything below uses the typed hl.dsp.* wrappers
-- instead, each verified to actually change compositor state.
hl.bind("ALT + Tab", hl.dsp.window.cycle_next())
hl.bind("ALT + Escape", hl.dsp.group.next())      -- cycle active window within group (only fires if grouped)
hl.bind("ALT + grave", hl.dsp.group.next())
hl.bind("ALT + Tab", hl.dsp.window.bring_to_top())

-- Alt+~ (Alt+Shift+`): create/break a window group. Pairs with Alt+`/Alt+Esc
-- above, which cycle the active window once inside a group.
hl.bind("ALT + SHIFT + grave", hl.dsp.group.toggle())

-- ALT+Q used to be bound to the legacy "swapnext" (dwindle: swap active
-- window with the next one in layout order). There's no typed hl.dsp
-- wrapper for that specific dispatcher, and exec_raw can't reach it (see
-- note above) - left unbound rather than silently changing its behavior.
-- hl.dsp.window.swap({ direction = "left"/"right"/"up"/"down" }) is the
-- closest available primitive if you want directional swap instead.

hl.bind(mainMod .. " + Q", hl.dsp.window.fullscreen_state({ internal = -1, client = 2 }))

-- SUPER+Tab was previously bound to "ags -t overview", which isn't a real
-- ags command or window ("ags toggle overview" -> "no window registered
-- with name 'overview'") - it never worked. hymission:toggle would be the
-- real overview-style plugin, but it's unreachable due to the exec_raw bug
-- noted above. Left unbound until one of those is actually usable.
-- hl.bind(mainMod .. " + Tab", exec("ags toggle overview"))

-- power
hl.bind("XF86PowerOff", exec("ags toggle powermenu"))

-- monitors (hardcoded to the two monitors defined at the top of hyprland.lua:
-- HDMI-A-1 is physically positioned left of eDP-1)
hl.bind(mainMod .. " + CTRL + left", hl.dsp.workspace.move({ monitor = "HDMI-A-1" }))
hl.bind(mainMod .. " + CTRL + right", hl.dsp.workspace.move({ monitor = "eDP-1" }))

-- hymission plugin IS loaded (see `hyprctl plugin list`), but its dispatcher
-- can only be reached through the broken exec_raw (see note above), so there
-- is currently no way to call it from Lua config. Left unbound - this is an
-- upstream limitation, not a config mistake.
-- hl.bind("SUPER + Tab", hl.dsp.exec_raw("hymission:toggle"))
