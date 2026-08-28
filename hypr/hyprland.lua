-- Hyprland Lua config (migrated from the deprecated hyprlang .conf format)
-- See https://wiki.hypr.land/Configuring/Start/

require("lua.env")

------------------
---- MONITORS ----
------------------

-- monitor right
-- monitor = HDMI-A-1, 1920x1090@60, 1920x0, 1
-- monitor = eDP-1, 1920x1080@144, 0x0, 1

-- monitor left
hl.monitor({ output = "HDMI-A-1", mode = "1680x1050@59.954", position = "-1680x0", scale = 1 })
hl.monitor({ output = "eDP-1", mode = "1920x1080@144", position = "0x0", scale = 1 })

require("lua.autostart")
require("lua.input")
require("lua.asus_bindings")
require("lua.window_rules")
require("lua.keybindings")

-----------------------
---- LOOK AND FEEL ----
-----------------------

hl.config({
    general = {
        border_size = 1,
        col = {
            active_border = "rgba(22fff8cc)",
        },
        layout = "dwindle",
        allow_tearing = true,
    },

    decoration = {
        rounding = 10,

        shadow = {
            enabled      = false,
            range        = 10,
            render_power = 2,
            color        = "rgba(1,1,1,1)",
        },

        blur = {
            enabled           = true,
            size              = 8,
            passes            = 3,
            new_optimizations = true,
        },

        dim_special   = 0.6,
        dim_inactive  = false,
        dim_strength  = 0.3,
    },

    misc = {
        disable_hyprland_logo = true,
        focus_on_activate     = true,
    },

    dwindle = {
        preserve_split = true, -- you probably want this
    },

    master = {
        new_status = "master",
    },

    gestures = {
        workspace_swipe_use_r    = false,
        workspace_swipe_forever  = false,
    },
})

-- Touchpad swipes (3 and 4 finger) are handled entirely by libinput-gestures
-- (~/.config/libinput-gestures.conf), which dispatches the custom e+1/e-1/
-- empty/fullscreen bindings. A native hl.gesture() registration for 3-finger
-- horizontal used to live here too, but it fought libinput-gestures for the
-- same swipe (both reacting to one physical gesture), causing erratic/
-- inconsistent behavior - removed so libinput-gestures is the sole owner.

-- Bezier used for the border angle animation
hl.curve("linear", { type = "bezier", points = { { 0.0, 0.0 }, { 1.0, 1.0 } } })
hl.animation({ leaf = "borderangle", enabled = true, speed = 100, bezier = "linear", style = "loop" })

-- Beziers/animations that give windows/workspaces their springy, slower feel
-- (ported from the old hyprland.conf `animations {}` block, which is no
-- longer read now that hyprland.lua is the active config)
hl.curve("springy", { type = "bezier", points = { { 0.25, 1.25 }, { 0.5, 1.0 } } })
hl.curve("myBezier", { type = "bezier", points = { { 0.42, 0.0 }, { 0.58, 1.0 } } })

hl.animation({ leaf = "specialWorkspace", enabled = true, speed = 2, bezier = "springy", style = "slidefadevert 50%" })
hl.animation({ leaf = "windows", enabled = true, speed = 2, bezier = "myBezier", style = "slide" })
hl.animation({ leaf = "windowsOut", enabled = true, speed = 2, bezier = "myBezier", style = "slide" })
hl.animation({ leaf = "layers", enabled = true, speed = 2, bezier = "myBezier", style = "fade" })
hl.animation({ leaf = "border", enabled = true, speed = 1, bezier = "default" })
hl.animation({ leaf = "fade", enabled = true, speed = 2, bezier = "default" })
hl.animation({ leaf = "workspaces", enabled = true, speed = 2, bezier = "default" })

----------------------
-- Grouping behavior --
----------------------

hl.config({
    group = {
        -- Automatically group new windows with the focused unlocked group
        auto_group = true,

        -- Insert new windows after the current one in the group
        insert_after_current = true,

        -- Focus on the window removed from the group
        focus_removed_window = true,

        -- Dragging windows into a group behavior: 0 = disabled, 1 = enabled, 2 = only via groupbar
        drag_into_group = 1,

        -- Allow merging of window groups by dragging
        merge_groups_on_drag = true,

        -- Merge groups when dragging into the groupbar
        merge_groups_on_groupbar = true,

        -- Merge floating windows into tiled groups via groupbar
        merge_floated_into_tiled_on_groupbar = false,

        -- Merge window into workspace's solitary unlocked group on movetoworkspace
        group_on_movetoworkspace = false,

        groupbar = {
            enabled = true,

            font_family = "YourPreferredFont", -- Replace with your chosen font
            font_size   = 10,

            render_titles = true,

            height = 12,

            -- Catppuccin Mocha "text" - softer than pure white, matches the rest of the theme
            text_color = 0xFFCDD6F4,

            scrolling = true,

            indicator_height = 0,

            rounding          = 0,
            gradient_rounding = 5,

            stacked          = false,
            round_only_edges = false,

            gradients = true,

            -- active is Catppuccin Mocha's own muted teal (not the neon border
            -- accent - full-bar neon was too much) fading into surface1; inactive
            -- uses surface0/base instead of flat greys
            col = {
                active   = { colors = { "0xFF94E2D5", "0xFF45475A" }, angle = 180 },
                inactive = { colors = { "0xFF313244", "0xFF1E1E2E" }, angle = 10 },
            },

            gaps_in  = 4,
            gaps_out = 5,
        },
    },
})
