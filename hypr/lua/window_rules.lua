-- Window / layer / workspace rules
-- See https://wiki.hypr.land/Configuring/Basics/Window-Rules/
-- and https://wiki.hypr.land/Configuring/Basics/Workspace-Rules/

----------------------------
-- Global / visual fixes
----------------------------

-- Fix blurry dropdowns/menus (layer surfaces often have empty title/class)
hl.window_rule({
    name = "fix-empty-blur",
    match = { title = "^()$", class = "^()$" },
    no_blur = true,
})

-- Color border for any floating window
hl.window_rule({
    name = "float-border-color",
    match = { float = true },
    border_color = "rgb(A020F0)",
})

-- Utility popups should follow the workspace where they are opened, rather
-- than staying tied to workspace 1 (some are started as tray services on login)
for _, class in ipairs({ "com\\.github\\.hluk\\.copyq", "blueman-manager", "pavucontrol", "nm-connection-editor" }) do
    hl.window_rule({
        name = "current-workspace-" .. class,
        match = { class = "^(" .. class .. ")$" },
        workspace = "current",
    })
end

----------------------------
-- Steam (dropdown / menus)
----------------------------

hl.window_rule({
    name = "steam-dropdown",
    match = { title = "^()$", class = "^(steam)$" },
    stay_focused = true,
    min_size = "1 1",
})

hl.window_rule({
    name = "steam-workspace",
    match = { class = "(.*)(steam)(.*)" },
    workspace = "special:Games",
})

----------------------------
-- CopyQ
----------------------------

hl.window_rule({
    name = "copyq",
    match = { class = "^(com\\.github\\.hluk\\.copyq)$" },
    float = true,
    size = "55% 65%",
    center = true,
    stay_focused = true,
})

----------------------------
-- Chat / social workspaces
----------------------------

-- Discord + Ferdium -> special:f8
hl.window_rule({
    name = "discord-workspace",
    match = { class = "(.*)(discord)(.*)" },
    workspace = "special:f8 silent",
})
hl.window_rule({
    name = "ferdium-workspace",
    match = { class = "(.*)(Ferdium)(.*)" },
    workspace = "special:f8 silent",
})

----------------------------
-- Notes / writing
----------------------------

-- Obsidian -> special:f7
hl.window_rule({
    name = "obsidian-workspace",
    match = { class = "^(obsidian)$" },
    workspace = "special:f7 silent",
})

----------------------------
-- Audio / music
----------------------------

-- Spotube -> float/size/center + special:f9
hl.window_rule({
    name = "spotube",
    match = { class = "^(spotube)$" },
    float = true,
    size = "85% 85%",
    center = true,
    workspace = "special:f9 silent",
})

----------------------------
-- Terminals / utilities (float helpers)
----------------------------

hl.window_rule({
    name = "kitty-float",
    match = { class = "^(kitty)$" },
    float = true,
    center = true,
    size = "80% 80%",
})

for _, class in ipairs({ "pavucontrol", "blueman-manager", "nm-connection-editor", "nwg-look", "gcolor3", "galculator", "franz" }) do
    hl.window_rule({
        name = "float-" .. class,
        match = { class = "^(" .. class .. ")$" },
        float = true,
    })
end

-- Calendar window by title
hl.window_rule({
    name = "calendar-float",
    match = { title = "^(Calendar)$" },
    float = true,
})

----------------------------
-- Title-based special behavior
----------------------------

-- Any window with title "float" should float
hl.window_rule({
    name = "title-float",
    match = { title = "^(float)$" },
    float = true,
})

----------------------------
-- Games
----------------------------

hl.window_rule({
    name = "cs2",
    match = { class = "^(cs2)$" },
    immediate = true,
    fullscreen = true,
})

hl.window_rule({
    name = "supertuxkart",
    match = { class = "^(supertuxcart)$" },
    fullscreen = true,
})

----------------------------
-- Animations / opacity
----------------------------

hl.window_rule({
    name = "alacritty-opacity",
    match = { class = "^(Alacritty)$" },
    opacity = "0.7 0.7",
})

hl.window_rule({
    name = "thunar-style",
    match = { class = "^(thunar)$" },
    animation = "popin",
    opacity = "0.9 0.9",
})

hl.window_rule({
    name = "vscode-animation",
    match = { class = "^(Code)$" },
    animation = "popin",
})

----------------------------
-- Layer rules
----------------------------

hl.layer_rule({
    name = "rofi-blur",
    match = { namespace = "rofi" },
    blur = true,
})
hl.layer_rule({
    name = "dashboard-slide",
    match = { namespace = "^(dashboard)$" },
    animation = "slide bottom",
})

----------------------------
-- Workspace rules
----------------------------

hl.workspace_rule({ workspace = "special:f7", on_created_empty = "obsidian" })

-- Discord Lofi wallpaper
hl.workspace_rule({ workspace = "special:wallpaper", on_created_empty = "firefox" })

hl.workspace_rule({ workspace = "w[tv1]", gaps_out = 0, gaps_in = 0 })
hl.workspace_rule({ workspace = "f[1]", gaps_out = 0, gaps_in = 0 })

for _, ws in ipairs({ "w[tv1]", "f[1]" }) do
    hl.window_rule({
        name = "no-gaps-" .. ws,
        match = { float = false, workspace = ws },
        border_size = 0,
        rounding = 0,
    })
end

----------------------------
-- Window group setup
----------------------------

hl.window_rule({
    name = "vscode-group",
    match = { class = "^(Code)$" },
    group = "set",
})

hl.window_rule({
    name = "qs-group",
    match = { workspace = "special:QS" },
    group = "set always",
})
