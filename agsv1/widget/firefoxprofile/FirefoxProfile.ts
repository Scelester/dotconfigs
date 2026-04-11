import icons from "lib/icons";
import type Gtk from "gi://Gtk?version=3.0"

const PROFILES_INI = '/home/scelester/.mozilla/firefox/profiles.ini';

const getProfiles = () => {
    try {
        const text = Utils.readFile(PROFILES_INI);
        return Array.from(text.matchAll(/Name=(.*)/g))
            .map(m => m[1])
            .filter(Boolean);
    } catch (error) {
        console.error('Error reading profiles:', error);
        return [];
    }
};

export default () => {
    const profiles = getProfiles();

    return Widget.Window<Gtk.Widget>({
        name: "firefox-profiles",
        title: "Firefox Profiles",
        class_name: "profile-launcher",
        keymode: "on-demand",
        exclusivity: "ignore",
        visible: false,
        layer: "overlay",
        anchor: ["top", "left", "bottom", "right"],
        child: Widget.Box({
            hexpand: true,
            vexpand: true, // allow vertical expansion so each ProfileButton gets extra height
            children: profiles.flatMap((profile) => [
                Widget.Separator({ class_name: "profile-separator" }),
                ProfileButton(profile),
            ]),
        }),
        setup: (self) => {
            self.keybind("Escape", () => App.closeWindow("firefox-profiles"));
            self.hook(App, (_, winName, visible) => {
                if (winName === "firefox-profiles") {
                    self.visible = visible;
                }
            }, "window-toggled");
        },
    });
};


const ProfileButton = (profile: string) => Widget.Button({
    class_name: "profile-item",
    cursor: "pointer",
    vexpand: true,
    child: Widget.Box({
        vertical:true,
        children: [
            // Spacer: you can also add a min-height here if needed
            Widget.Box({ class_name:"test-x", vexpand: true, hexpand: true }),
            // This container stays at the bottom using explicit vertical alignment
            Widget.Box({
                class_name: "text-icon-container",
                hexpand: true,
                vexpand: false,
                // Force the container to align at the end of the parent's vertical space
                valign: "end",
                children: [
                    Widget.Icon({
                        icon: icons.firefox.profile,
                        size: 40,
                        class_name: "profile-icon",
                        hexpand: false,
                    }),
                    Widget.Label({
                        label: profile,
                        hexpand: true,

                        xalign: 0,
                        wrap: true,
                        class_name: "profile-label",
                    }),
                ],
            }),
        ],
    }),
    on_clicked: () => {
        Utils.execAsync(`firefox -P '${profile}'`);
        App.closeWindow("firefox-profiles");
    },
});




export function firefoxprofile() {
    App.toggleWindow("firefox-profiles");
}

Object.assign(globalThis, { firefoxprofile });
