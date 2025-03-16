import { musicBG } from "./musicBg/musicIndex";

export const desktopWidgets = () => {
    return Widget.Window({
        name: 'desktop-overlay',
        monitor: 0,
        anchor: ['top', 'bottom', 'left', 'right'],
        exclusivity: 'ignore',
        layer: 'background',
        visible: true,
        setup: (self) => {
            self.css = `
                background: transparent;
                box-shadow: none;
                border: none;
            `;
        },
        child: Widget.Box({
            vertical: true,
            expand: true,
            children: [
                // Spacer: takes up the available space at the top.
                Widget.Box({ expand: true }),
                // Wrap musicBG in a Box that centers it horizontally.
                Widget.Box({
                    halign: "center",
                    css:"margin:20px",
                    child: musicBG()
                })
            ],
        }),
    });
};

export default desktopWidgets;
