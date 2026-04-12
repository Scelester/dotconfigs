import { Gtk } from "ags/gtk4"
import Gdk from "gi://Gdk?version=4.0"

const FALLBACK_ICON = "applications-system-symbolic"

const normalizeIconName = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")

let cachedTheme: Gtk.IconTheme | null | undefined

const getIconTheme = () => {
  if (cachedTheme !== undefined) return cachedTheme

  try {
    const display = Gdk.Display.get_default()
    cachedTheme = display ? Gtk.IconTheme.get_for_display(display) : null
  } catch {
    cachedTheme = null
  }

  return cachedTheme
}

const hasThemeIcon = (name: string | undefined) => {
  if (!name) return false
  const theme = getIconTheme()
  return !!theme?.has_icon(name)
}

const pickIcon = (candidates: string[], fallback = FALLBACK_ICON) => {
  for (const candidate of candidates) {
    if (hasThemeIcon(candidate)) return candidate
  }

  return fallback
}

const matchTitleApp = (value: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(value))

const resolveTerminalChildIcon = (title: string) => {
  const lowerTitle = title.toLowerCase()

  if (matchTitleApp(lowerTitle, [/\b(?:n?vim|neovim|vim)\b/, /\blazyvim\b/])) {
    return pickIcon(["nvim-symbolic", "nvim", "neovim", "vim", "applications-development-symbolic"])
  }

  if (matchTitleApp(lowerTitle, [/\blazygit\b/, /\bgitui\b/])) {
    return pickIcon(["gitg-symbolic", "gitg", "git", "applications-development-symbolic"])
  }

  if (matchTitleApp(lowerTitle, [/\byazi\b/, /\branger\b/, /\blf\b/])) {
    return pickIcon(["system-file-manager-symbolic", "folder-symbolic", "folder"])
  }

  if (matchTitleApp(lowerTitle, [/\bbtop\b/, /\bhtop\b/])) {
    return pickIcon(["utilities-system-monitor-symbolic", "org.gnome.SystemMonitor-symbolic"])
  }

  if (matchTitleApp(lowerTitle, [/\bncmpcpp\b/, /\bspotify-tui\b/])) {
    return pickIcon(["audio-x-generic-symbolic", "multimedia-player-symbolic"])
  }

  return null
}

export const resolveWindowIcon = (app = "", title = "") => {
  const lowerApp = app.toLowerCase()
  const lowerTitle = title.toLowerCase()
  const cleaned = normalizeIconName(app)

  if (/firefox|librewolf/.test(lowerApp)) {
    return pickIcon(["firefox-symbolic", "firefox", "applications-internet-symbolic"])
  }

  if (/brave/.test(lowerApp)) {
    return pickIcon(["brave-browser-symbolic", "brave-browser", "applications-internet-symbolic"])
  }

  if (/chrome|chromium/.test(lowerApp)) {
    return pickIcon([
      "google-chrome-symbolic",
      "chromium-symbolic",
      "google-chrome",
      "chromium",
      "applications-internet-symbolic"
    ])
  }

  if (/code|vscode|vscodium|codium|cursor/.test(lowerApp)) {
    return pickIcon([
      "visual-studio-code-symbolic",
      "visual-studio-code",
      "code",
      "code-oss",
      "vscodium",
      "applications-development-symbolic"
    ])
  }

  if (/zed/.test(lowerApp)) {
    return pickIcon(["zed-symbolic", "zed", "applications-development-symbolic"])
  }

  if (/spotify/.test(lowerApp)) {
    return pickIcon(["spotify-symbolic", "spotify", "multimedia-player-symbolic"])
  }

  if (/discord|vesktop|equibop|legcord/.test(lowerApp)) {
    return pickIcon(["discord-symbolic", "discord", "im-message-new-symbolic"])
  }

  if (/slack/.test(lowerApp)) {
    return pickIcon(["slack-symbolic", "slack", "im-message-new-symbolic"])
  }

  if (/obsidian/.test(lowerApp)) {
    return pickIcon(["obsidian-symbolic", "obsidian", "text-x-generic-symbolic"])
  }

  if (/thunar|dolphin|nautilus|files/.test(lowerApp)) {
    return pickIcon(["system-file-manager-symbolic", "folder-symbolic", "folder"])
  }

  if (/wezterm|kitty|alacritty|foot|ghostty|terminal|tmux/.test(lowerApp)) {
    const childIcon = resolveTerminalChildIcon(lowerTitle)
    if (childIcon) return childIcon
    return pickIcon(["utilities-terminal-symbolic"])
  }

  if (matchTitleApp(`${lowerApp} ${lowerTitle}`, [/\b(?:n?vim|neovim|vim)\b/])) {
    return pickIcon(["nvim-symbolic", "nvim", "neovim", "vim", "applications-development-symbolic"])
  }

  return pickIcon(
    [
      `${cleaned}-symbolic`,
      cleaned,
      `${lowerApp}-symbolic`,
      lowerApp,
      "application-x-executable-symbolic"
    ],
    FALLBACK_ICON
  )
}

export const getFallbackIcon = () => FALLBACK_ICON
