-- Mouse & keyboard input
-- See https://wiki.hypr.land/Configuring/Variables/#input

hl.config({
    input = {
        kb_layout  = "us",
        kb_variant = "",
        kb_model   = "",
        kb_options = "",
        kb_rules   = "",

        accel_profile = "flat",

        follow_mouse = 0,

        touchpad = {
            natural_scroll = true,
            scroll_factor  = 0.4,
        },

        sensitivity = 0, -- -1.0 - 1.0, 0 means no modification.
    },
})

local touchpadEnabled = true
hl.device({
    name          = "elan1203:00-04f3:307a-touchpad",
    enabled       = touchpadEnabled,
    sensitivity   = 0.4,
    accel_profile = "adaptive", -- accel_profile only for touchpad
})

local laptopKbEnabled = true
hl.device({
    name    = "at-translated-set-2-keyboard",
    enabled = laptopKbEnabled,
})

hl.config({
    cursor = {
        inactive_timeout   = 10,
        no_hardware_cursors = true,
    },
})
