// import PopupWindow from "widget/PopupWindow";
// import icons from "lib/icons";
// import { opt } from "lib/option";
// import options from "options";
// import type Gtk from "gi://Gtk?version=3.0";
// import fs from 'fs';
// import path from 'path';

// const { layout } = options.powermenu;
// const labels = opt(true);

// const SysButton = (label: string) => Widget.Button({
//     on_clicked: () => console.log(`Clicked on profile: ${label}`), // Placeholder action
//     child: Widget.Box({
//         vertical: true,
//         class_name: "system-button",
//         children: [
//             Widget.Icon(icons.firefox["profile"]),
//             Widget.Label({
//                 label,
//                 visible: labels.bind(),
//             }),
//         ],
//     }),
// });

// // Define the path to the profiles.ini file
// const PROFILES_INI = '/home/scelester/.mozilla/firefox/profiles.ini';

// // Function to parse the profiles.ini file
// function getFirefoxProfiles(): string[] {
//     if (!fs.existsSync(PROFILES_INI)) {
//         console.error('Profiles file not found.');
//         return [];
//     }

//     const content = fs.readFileSync(PROFILES_INI, 'utf-8');
//     const profiles: string[] = [];
//     const regex = /^\[Profile(\d+)\]/gm;

//     let match: RegExpExecArray | null;
//     while ((match = regex.exec(content)) !== null) {
//         const profileIndex = match[1];
//         const profileNameMatch = content.match(new RegExp(`^\[Profile${profileIndex}\]\\s*Name=(.*)$`, 'm'));

//         if (profileNameMatch) {
//             profiles.push(profileNameMatch[1]);
//         }
//     }

//     return profiles;
// }

// // Use the function to get profiles
// const profiles = getFirefoxProfiles();
// console.log('Firefox Profiles:', profiles);

// // Create widgets based on profiles
// const widgets: any[] = [
//     Widget.Box(
//         { vertical: true },
//         ...profiles.map(profile => SysButton(profile))
//     ),
// ];

// export default () => PopupWindow({
//     name: "firefoxprofile",
//     transition: "crossfade",
//     child: Widget.Box<Gtk.Widget>({
//         class_name: "powermenu horizontal",
//         children: widgets,
//     }),
// });
