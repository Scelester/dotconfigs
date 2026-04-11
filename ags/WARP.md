# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project overview

This repository is an [Aylur's Gtk Shell (AGS)](https://github.com/Aylur/ags) configuration written in TypeScript/TSX using the `ags/gtk4` API. It defines the main bar, an overlay dashboard, and an on-screen display (OSD) for system feedback, intended to run under a Wayland compositor (e.g. Hyprland).

AGS itself is responsible for loading and bundling this configuration from `~/.config/ags`; there is no standalone Node "app" or build artifact produced by this repo.

## High-level architecture

### TypeScript and tooling

- `tsconfig.json` configures strict TypeScript, ES2020/ES2022 modules, and JSX via `"jsx": "react-jsx"` with `"jsxImportSource": "ags/gtk4"`. Components in `widget/` are therefore authored as TSX using AGS's JSX bindings for GTK4.
- `env.d.ts` declares ambient globals and virtual modules (e.g. `inline:*`, `*.scss`, `*.css`, `*.blp`) so TypeScript understands imports that AGS or the bundler resolves at runtime.
- `package.json` has only runtime dependencies (`ags`, `gnim`) and Prettier configuration (no scripts, no test tooling, no local TypeScript or ESLint dependency).

### Directory layout (big picture)

- Root TypeScript/JS entrypoints (e.g. `main.ts`, `app.ts`) glue together widgets and register them with AGS; they are the files AGS points at in your desktop configuration.
- `widget/`
  - `Bar.tsx` – defines the main top bar window.
  - `Dashboard.tsx` – defines a centered overlay dashboard window with system status, recent activity, email, and TODO integration.
  - `OSD.tsx` – defines a bottom OSD window for volume/brightness/microphone feedback.
  - `Tray.tsx` – implements a system tray widget using `AstalTray` and GTK4.
  - `dashboardState.ts` – central registry that stores the dashboard window instance and exposes `registerDashboard`, `toggleDashboard`, `hideDashboard`, and `showDashboard` used across widgets.
- `data/`
  - `profile.json` – user profile data (name, title, location, status, handles, bio) consumed by the dashboard.
  - `email.json` – IMAP connection details used by the dashboard's email section.
- `assets/` – icon and image assets referenced by various widgets and styles.
- Additional directories like `lib/` and `service/` contain helper modules and system-integration services (battery, GTK helpers, Hyprland, notifications, wallpaper, screen recording, etc.), which widgets import to keep system-specific logic out of UI components.

### Widget architecture

#### Bar (`widget/Bar.tsx`)

- Implements a top-anchored, exclusive AGS window named `bar`.
- Uses `createPoll` from `ags/time` to periodically sample external commands and expose them as reactive values:
  - Time and date (`date +'%H:%M'`, `date +'%a %d %b'`).
  - Active workspace and populated workspaces via `hyprctl` JSON output.
  - Music state via `playerctl` (status and "artist - title" metadata).
  - Volume, brightness, microphone mute state via `pamixer` and `brightnessctl`.
  - Battery level and charging status via `/sys/class/power_supply/BAT*`.
- Renders three main sections in a `centerbox`:
  - **Left**: launcher button (executes a Rofi script) and workspace indicators that reflect both focus and whether a workspace has any open windows.
  - **Center**: inline music control widget that toggles play/pause via `playerctl` and shows truncated metadata.
  - **Right**: a system indicator cluster (brightness, mic, volume, battery), the application tray (`TrayWidget`), and a datetime button that toggles the dashboard via `toggleDashboard()`.
- Uses GTK event controllers to attach scroll gestures for smooth volume/brightness adjustment directly from the bar icons.

#### Dashboard (`widget/Dashboard.tsx`)

- Creates a full-screen transparent overlay window (`name="dashboard"`) anchored to all screen edges and centered content, registered with `registerDashboard` from `dashboardState.ts`.
- Major responsibilities:
  - **Profile card** – reads `data/profile.json` via `Gio.File` and `GLib.file_get_contents`, falling back to a built-in profile if the file is missing or invalid. Shows name, title, location, email, status, and an optional bio/handles string.
  - **Avatar** – prefers a user `.face` image from home; otherwise shows the initial of the profile name.
  - **System gauges** – uses custom `Gtk.DrawingArea`-based gauges for CPU, RAM, GPU, and storage. Each gauge exposes an `update(percent, detail?)` API and is driven by asynchronous readers that parse `/proc/stat`, `/proc/meminfo`, `df`, `/sys/class/drm/*`, `amdgpu_pm_info`, or `nvidia-smi` output.
  - **Windows & recent apps** – shells out to `hyprctl clients -j`, normalizes and sorts by recency, and renders two scrollable lists: all recent windows and a deduplicated set of recent applications.
  - **Email panel** – optionally pulls recent email via IMAP:
    - Reads `data/email.json` to get host/port/user/password/mailbox/limit/SSL flags.
    - Generates and runs an inline Python script (via `python3 - <<'PY' ... PY'`) using `imaplib`/`email` to fetch and parse headers, then prints JSON for AGS to consume.
    - Handles errors by surfacing synthetic `EmailItem` entries with `from: "error"` and a message.
  - **TODO panel** – reads and previews tasks from an external Markdown file (`/home/scelester/Obsidian/HOMEPAGE/TODO.md`), showing the first few checkbox-style list items and providing an "Open" button that prefers an Obsidian URI, falling back to `xdg-open`.
  - **Calendar** – embeds a GTK calendar widget for quick date reference.
- `refreshDashboard()` orchestrates reloading profile, TODOs, emails, gauges, and windows and is called both on initial realization and whenever the dashboard is shown again.

When editing this file, be careful with:
- Long shell commands passed to `execAsync` (especially the inline Python heredoc) – changes to quoting, indentation, or interpolation can easily break the script.
- Error handling – the dashboard is meant to be resilient when system commands or optional config files are missing.

#### OSD (`widget/OSD.tsx`)

- Defines an `OSD` window anchored to the bottom of the monitor, used for transient system feedback.
- Maintains internal state for last known volume level/mute, brightness, and mic mute to avoid spamming the UI.
- Periodically listens to system events via `subprocess`:
  - `pactl subscribe` to detect sink (output) and source (input) changes for volume/mic.
  - `udevadm monitor` for backlight changes.
- On changes, computes the appropriate icon (volume/brightness/microphone) and percentage and calls `showOSD`, which:
  - Updates labels and a GTK progress bar.
  - Shows the window and schedules an automatic hide after a short timeout via `timeout`.

The OSD logic is tightly coupled to the set of shell tools available (`pamixer`, `brightnessctl`, PulseAudio/PipeWire via `pactl`); agents changing these commands should keep behavior and error handling consistent.

#### Tray (`widget/Tray.tsx`)

- Uses `AstalTray.get_default()` to access system tray items.
- Keeps a dedicated GTK box container and rebuilds its contents whenever `notify::items` fires on the tray proxy.
- For each tray item it creates a `Gtk.MenuButton` with a `Gtk.Image` bound to the item's `gicon` and associates the item's `menu_model` and `action_group` so right-click menus and actions function correctly.
- Avoids stale children by explicitly removing all existing children before re-adding items and toggles container visibility based on whether there are any items.

#### Dashboard state (`widget/dashboardState.ts`)

- Holds a single global `Astal.Window | null` reference for the dashboard window and an optional `refreshDashboard` callback.
- Exposes a small API:
  - `registerDashboard(win, refresh?)` – called by `Dashboard.tsx` after constructing the window.
  - `toggleDashboard()` – toggles visibility and, when opening, calls `refreshDashboard` and `present()` to focus the window.
  - `hideDashboard()` / `showDashboard()` – helpers to explicitly control visibility.
- This module is the only cross-widget global state used to coordinate the dashboard; new widgets wanting to manipulate the dashboard should go through this API instead of tracking their own window references.

## Data & configuration

- **Profile data (`data/profile.json`)** – customize profile fields here instead of editing the dashboard component directly when only content is changing.
- **Email settings (`data/email.json`)** – holds IMAP connection information; be mindful that the inline Python script expects specific keys (`host`, `user`, `password`, optional `mailbox`, etc.) and returns a list of objects with `from`, `subject`, and `date`.
- **External TODO path** – the dashboard's TODO panel reads from a hard-coded Obsidian path; if you move your vault or change note structure, update `TODO_PATH` and `OBSIDIAN_URI` in `Dashboard.tsx` accordingly.

Because some of these paths are user-specific, future edits should avoid inlining additional absolute paths unless they are clearly meant to be personalized.

## Commands and development workflow

This repo does not define Node scripts, tests, or a standalone build pipeline; development is primarily done by editing the TypeScript/TSX files and reloading AGS.

### Install dependencies

Dependencies are declared in `package.json` and locked via `yarn.lock`:

- Install JavaScript dependencies (for editor tooling, type hints, etc.):
  - `yarn install`

Note: there is no `scripts` section; `yarn` is used only for dependency management.

### Type checking and linting

- TypeScript configuration exists (`tsconfig.json`), but `typescript` is not listed as a dependency. If you want CLI-based type-checking, add `typescript` as a devDependency and run something like `npx tsc --noEmit` from the project root.
- Prettier settings (no semicolons, 2-space indentation) live under the `prettier` key in `package.json`. There is no local Prettier dependency; rely on your editor's Prettier integration or add Prettier as a devDependency before running the CLI.

### Tests

- There is no test directory and no test runner configured (no `test` script in `package.json`). There are currently no automated tests to run, so there is no "single test" command; changes should be validated by exercising AGS and the desktop UI manually.

### Running and reloading the configuration

- AGS loads this configuration from `~/.config/ags`. There are no helper scripts in this repo for starting or reloading AGS; use your desktop's standard mechanism (e.g. a keybinding or running `ags -q` from a terminal) to restart AGS after making changes.

When adding new widgets or services, follow the existing pattern:
- Implement UI as TSX components under `widget/` using `ags/gtk4`.
- Keep system-specific integration and shell command logic in dedicated helper or service modules where possible.
- Wire new windows into the main AGS entrypoint (e.g. the file that currently creates the bar, dashboard, and OSD windows) rather than spawning ad-hoc windows from unrelated modules.
