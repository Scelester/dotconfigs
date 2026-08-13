-- Environment variables
-- See https://wiki.hypr.land/Configuring/Advanced-and-Cool/Environment-variables/

hl.env("XCURSOR_THEME", "Fluentt")
hl.env("XCURSOR_SIZE", "27")
hl.env("HYPRCURSOR_THEME", "Fluentt")
hl.env("HYPRCURSOR_SIZE", "27")

-- Input method (fcitx5)
hl.env("QT_IM_MODULE", "fcitx")
hl.env("XMODIFIERS", "@im=fcitx")
hl.env("SDL_IM_MODULE", "fcitx")
hl.env("GLFW_IM_MODULE", "ibus")

hl.env("XDG_CURRENT_DESKTOP", "Hyprland")
hl.env("XDG_SESSION_TYPE", "wayland")
hl.env("XDG_SESSION_DESKTOP", "Hyprland")

hl.env("QT_STYLE_OVERRIDE", "kvantum")
hl.env("QT_QPA_PLATFORMTHEME", "qt6ct")

hl.env("ELECTRON_OZONE_PLATFORM_HINT", "auto")

hl.env("GDK_BACKEND", "wayland,x11,*")

-- Nvidia
hl.env("LIBVA_DRIVER_NAME", "nvidia")
hl.env("__GLX_VENDOR_LIBRARY_NAME", "nvidia")
hl.env("GBM_BACKEND", "nvidia-drm")
hl.env("ENABLE_VKBASALT", "1")
hl.env("WLR_NO_HARDWARE_CURSORS", "1")

-- gamescope
hl.env("GAMESCOPE_WSI_HIDE_PRESENT_WAIT_EXT", "1")

-- MPD fix
hl.env("MPD_HOST", "/run/user/1000/mpd/socket")
