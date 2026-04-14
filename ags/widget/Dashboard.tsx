import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { execAsync, subprocess } from "ags/process"
import { createPoll, timeout } from "ags/time"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Pango from "gi://Pango"
import { hideDashboard, registerDashboard } from "./dashboardState"
import { resolveWindowIcon } from "./iconResolver"

// Profile info shown in the top-left card
type Profile = {
  name: string
  title: string
  location: string
  status: string
  email: string
  handles?: Record<string, string>
  bio?: string
}

// Minimal window snapshot from hyprctl output
type WindowInfo = {
  title: string
  app: string
  workspace: string | number
  pid: number
  lastFocus: number
}

type EmailConfig = {
  starttls: boolean
  host: string
  port?: number
  user: string
  password: string
  mailbox?: string
  limit?: number
  ssl?: boolean
}

type EmailItem = {
  from: string
  subject: string
  date: string
}

// Gauge widget glue to update circular meters
type Gauge = {
  widget: Gtk.Widget
  update: (percent: number, detail?: string) => void
}

type DiskVolume = {
  mount: string
  fstype: string
  used: number
  size: number
  pct: number
}

type PlaybackItem = {
  id: number
  name: string
  volume: number
  muted: boolean
}

type NotificationEntry = {
  id: number
  app: string
  summary: string
  body: string
  timestamp: number
}

type PowerProfileState = {
  active: string
  available: string[]
  details: Record<string, string[]>
  error?: string
}

type DashboardSectionId = "overview" | "controls" | "notifications" | "windows" | "calendar"

// Paths to local data
const PROFILE_PATH = GLib.build_filenamev([
  GLib.get_home_dir(),
  ".config",
  "ags",
  "data",
  "profile.json"
])
const FACE_PATH = GLib.build_filenamev([GLib.get_home_dir(), ".face"])
const TODO_PATH = "/home/scelester/Obsidian/HOMEPAGE/TODO.md"
const OBSIDIAN_URI = `obsidian://open?path=${encodeURIComponent(TODO_PATH)}`
const EMAIL_CONFIG_PATH = GLib.build_filenamev([
  GLib.get_home_dir(),
  ".config",
  "ags",
  "data",
  "email.json"
])
const NOTIFICATION_STORE_PATH = GLib.build_filenamev([
  GLib.get_home_dir(),
  ".config",
  "ags",
  "data",
  "notifications.json"
])

// Default profile data if user has not set data/profile.json
const fallbackProfile: Profile = {
  name: "Scelester",
  title: "Builder / Systems",
  location: "Planet Earth",
  status: "Ship mode",
  email: "nabinpauudel664@gmail.com",
  handles: {
    github: "scelester",
    discord: "@scelester",
    matrix: "@scelester:matrix.org"
  },
  bio: "Tune this profile in data/profile.json to make it yours."
}

// Default windows block to show an empty state
const fallbackWindows: WindowInfo[] = [
  { title: "No windows detected", app: "hyprctl", workspace: "-", pid: 0, lastFocus: 0 }
]

// Layout sizing and storage filters
const MODAL_WIDTH = 1380
const MODAL_HEIGHT = 820
const SECTION_STAGE_HEIGHT = MODAL_HEIGHT - 214
const DASHBOARD_HERO_HEIGHT = 96
const DASHBOARD_TABS_HEIGHT = 48
const DASHBOARD_SURFACE_PADDING = 18
const SECTION_ROW_GAP = 14
const OVERVIEW_TOP_ROW_HEIGHT = 278
const OVERVIEW_BOTTOM_ROW_HEIGHT = SECTION_STAGE_HEIGHT - SECTION_ROW_GAP - OVERVIEW_TOP_ROW_HEIGHT
const CONTROLS_TOP_ROW_HEIGHT = 360
const CONTROLS_BOTTOM_ROW_HEIGHT = SECTION_STAGE_HEIGHT - SECTION_ROW_GAP - CONTROLS_TOP_ROW_HEIGHT
const PROFILE_CARD_HEIGHT = OVERVIEW_TOP_ROW_HEIGHT
const SUMMARY_CARD_HEIGHT = 88
const SUMMARY_STRIP_HEIGHT = OVERVIEW_TOP_ROW_HEIGHT - SUMMARY_CARD_HEIGHT - SECTION_ROW_GAP
const METRICS_CARD_HEIGHT = OVERVIEW_BOTTOM_ROW_HEIGHT
const ACTIONS_CARD_HEIGHT = OVERVIEW_BOTTOM_ROW_HEIGHT
const CONTROLS_CARD_HEIGHT = CONTROLS_TOP_ROW_HEIGHT
const POWER_CARD_HEIGHT = CONTROLS_TOP_ROW_HEIGHT
const STORAGE_CARD_HEIGHT = CONTROLS_BOTTOM_ROW_HEIGHT
const TODO_LIST_HEIGHT = 220
const WINDOWS_LIST_HEIGHT = SECTION_STAGE_HEIGHT - 158
const STORAGE_LIST_HEIGHT = Math.max(72, STORAGE_CARD_HEIGHT - 122)
const NOTIFICATION_LIST_HEIGHT = SECTION_STAGE_HEIGHT - 158
const TODO_PREVIEW_MAX = 8
const GAUGE_SIZE = 70
const STORAGE_EXCLUDED = ["tmpfs", "devtmpfs", "overlay", "squashfs"]
const STORAGE_WHITELIST = ["/", "/home", "/home/scelester/Container"]
const NOTIFICATION_HISTORY_LIMIT = 500
const POWER_PROFILE_ORDER = ["performance", "balanced", "power-saver"] as const
const DASHBOARD_SURFACE_HEIGHT =
  DASHBOARD_HERO_HEIGHT +
  DASHBOARD_TABS_HEIGHT +
  SECTION_STAGE_HEIGHT +
  SECTION_ROW_GAP * 2 +
  DASHBOARD_SURFACE_PADDING * 2
const DASHBOARD_DEFAULT_SECTION: DashboardSectionId = "overview"
const DASHBOARD_SECTIONS: { id: DashboardSectionId; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "󰍹" },
  { id: "controls", label: "Controls", icon: "󰒓" },
  { id: "notifications", label: "Notifications", icon: "󰂚" },
  { id: "windows", label: "Windows", icon: "󱂬" },
  { id: "calendar", label: "Calendar", icon: "󰃭" }
]

// Convert absolute mounts into nicer labels
const prettyMount = (mount: string) => {
  if (mount === "/") return "/"
  if (mount === "/home") return "~/"
  if (mount === "/home/scelester/Container") return "~/Container"
  return mount.replace(GLib.get_home_dir(), "~")
}

const clampPercent = (value: number) => {
  const safe = Number.isFinite(value) ? value : 0
  return Math.max(0, Math.min(100, Math.round(safe)))
}

// Helper to decode GLib byte arrays
const decodeBuffer = (bytes: Uint8Array) => {
  const decoder = new TextDecoder()
  return decoder.decode(bytes)
}

const safePoll = <T,>(init: T, interval: number, fn: (prev: T) => T | Promise<T>) =>
  createPoll(init, interval, async (prev) => {
    try {
      return await fn(prev)
    } catch (err) {
      console.error("Dashboard poll failed:", err)
      return prev
    }
  })

// Notification capture (dbus-monitor)
const notificationHistory: NotificationEntry[] = []
const notificationListeners = new Set<() => void>()
let notificationWatcherStarted = false
let notificationStoreLoaded = false
let lastNotificationId = 0

const nextNotificationId = () => {
  const now = Date.now()
  lastNotificationId = Math.max(now, lastNotificationId + 1)
  return lastNotificationId
}

const emitNotificationUpdate = () => {
  notificationListeners.forEach((cb) => cb())
}

const onNotificationUpdate = (cb: () => void) => {
  notificationListeners.add(cb)
  return () => notificationListeners.delete(cb)
}

const persistNotificationHistory = () => {
  try {
    GLib.file_set_contents(NOTIFICATION_STORE_PATH, JSON.stringify(notificationHistory))
  } catch (err) {
    console.error("Notification store save failed:", err)
  }
}

const loadNotificationHistory = () => {
  if (notificationStoreLoaded) return
  notificationStoreLoaded = true
  try {
    if (!GLib.file_test(NOTIFICATION_STORE_PATH, GLib.FileTest.EXISTS)) return
    const [ok, data] = GLib.file_get_contents(NOTIFICATION_STORE_PATH)
    if (!ok || !data) return
    const parsed = JSON.parse(decodeBuffer(data))
    if (!Array.isArray(parsed)) return
    const seenIds = new Set<number>()
    const cleaned = parsed
      .map((n: any) => {
        const timestamp = typeof n.timestamp === "number" ? n.timestamp : Date.now()
        let id = typeof n.id === "number" ? n.id : nextNotificationId()
        if (seenIds.has(id)) id = nextNotificationId()
        seenIds.add(id)
        lastNotificationId = Math.max(lastNotificationId, id)
        return {
          id,
          app: typeof n.app === "string" && n.app.length ? n.app : "Notification",
          summary: typeof n.summary === "string" && n.summary.length ? n.summary : "(no title)",
          body: typeof n.body === "string" ? n.body : "",
          timestamp
        }
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, NOTIFICATION_HISTORY_LIMIT)

    notificationHistory.splice(0, notificationHistory.length, ...cleaned)
  } catch (err) {
    console.error("Notification store load failed:", err)
  }
}

const pushNotification = (entry: Omit<NotificationEntry, "id">) => {
  const withId = { ...entry, id: nextNotificationId() }
  notificationHistory.unshift(withId)
  if (notificationHistory.length > NOTIFICATION_HISTORY_LIMIT) {
    notificationHistory.pop()
  }
  persistNotificationHistory()
  emitNotificationUpdate()
}

const getNotificationHistory = () => notificationHistory.slice()

const removeNotification = (entry: NotificationEntry | number) => {
  const targetId = typeof entry === "number" ? entry : entry.id
  const idx = notificationHistory.findIndex((n) => n.id === targetId)
  if (idx < 0) return

  notificationHistory.splice(idx, 1)
  persistNotificationHistory()
  emitNotificationUpdate()
}

const clearNotificationHistory = () => {
  if (!notificationHistory.length) return
  notificationHistory.splice(0, notificationHistory.length)
  persistNotificationHistory()
  emitNotificationUpdate()
}

const formatTimeShort = (ts: number) => {
  if (!Number.isFinite(ts)) return "--:--"
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

const startNotificationWatcher = () => {
  if (notificationWatcherStarted) return
  notificationWatcherStarted = true

  try {
    let capture: string[] | null = null
    subprocess(
      "dbus-monitor \"type='method_call',interface='org.freedesktop.Notifications',member='Notify'\"",
      (line) => {
        if (line.includes("member=Notify")) {
          capture = []
          return
        }

        if (!capture) return

        if (line.startsWith("method call") || line.startsWith("method return") || line.startsWith("error")) {
          capture = null
          return
        }

        if (line.startsWith("string ")) {
          const match = line.match(/string \"(.*)\"/)
          if (match) {
            capture.push(match[1])
          }
        }

        if (capture.length >= 4) {
          const [appName, _icon, summary, body] = capture
          const now = Date.now()
          pushNotification({
            app: appName || "Notification",
            summary: summary || "(no title)",
            body: body || "",
            timestamp: now
          })
          capture = null
        }
      },
      (err) => console.error("Notification watcher error:", err)
    )
  } catch (err) {
    console.error("Failed to start notification watcher:", err)
  }
}

const titleCaseProfile = (name: string) => {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

const dashboardStamp = safePoll("", 1000, async () => {
  try {
    return (await execAsync("date +'%A · %d %b · %H:%M'")).trim()
  } catch {
    return "Now"
  }
})

// Read profile JSON or fall back
const loadProfile = (): Profile => {
  try {
    const file = Gio.File.new_for_path(PROFILE_PATH)
    const [ok, contents] = file.load_contents(null)
    if (ok && contents) {
      return JSON.parse(decodeBuffer(contents))
    }
  } catch (err) {
    console.error("Dashboard profile read failed:", err)
  }

  return fallbackProfile
}

// Pull window list from Hyprland and sort by last focus
const fetchWindows = async (): Promise<WindowInfo[]> => {
  try {
    const raw = await execAsync("hyprctl clients -j")
    const parsed = JSON.parse(raw)

    const cleaned: WindowInfo[] = parsed.map((c: any) => ({
      title: c.title || c.initialTitle || "Untitled",
      app: c.class || c.app || "App",
      workspace: c.workspace?.id ?? c.workspace?.name ?? "?",
      pid: c.pid ?? 0,
      lastFocus: c.focusHistoryID ?? c.last_focus_time ?? c.at ?? Date.now()
    }))

    return cleaned
      .sort((a, b) => b.lastFocus - a.lastFocus)
      .slice(0, 20)
  } catch (err) {
    console.error("Dashboard windows fetch failed:", err)
    return fallbackWindows
  }
}

// Utility to redraw a GTK box with rendered children
const renderList = <T,>(
  box: Gtk.Box,
  items: T[],
  render: (item: T, index: number) => Gtk.Widget
) => {
  let child = box.get_first_child()
  while (child) {
    box.remove(child)
    child = box.get_first_child()
  }

  items.forEach((item, idx) => {
    box.append(render(item, idx))
  })
}

export default function Dashboard(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT, BOTTOM } = Astal.WindowAnchor

  loadNotificationHistory()
  startNotificationWatcher()

  // Profile elements (updated on refresh)
  const profileName = new Gtk.Label({
    css_classes: ["profile-name"],
    hexpand: true,
    xalign: 0,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 24,
    valign: Gtk.Align.CENTER
  })
  const profileTitle = new Gtk.Label({
    css_classes: ["profile-title"],
    hexpand: true,
    xalign: 0,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 30,
    valign: Gtk.Align.CENTER
  })
  const profileMeta = new Gtk.Label({
    css_classes: ["profile-meta"],
    hexpand: true,
    xalign: 0,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 40,
    valign: Gtk.Align.CENTER
  })
  const profileStatus = new Gtk.Label({
    css_classes: ["profile-status"],
    hexpand: true,
    xalign: 0,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 40,
    valign: Gtk.Align.CENTER
  })
  const profileBio = new Gtk.Label({
    css_classes: ["profile-bio"],
    wrap: true,
    wrap_mode: Pango.WrapMode.WORD_CHAR,
    hexpand: true,
    xalign: 0,
    margin_start: 4,
    max_width_chars: 60,
    margin_bottom: 6
  })
  const avatarInitial = new Gtk.Label({ label: "S", css_classes: ["profile-avatar-initial"] })
  const avatarWrapper = new Gtk.Box({ css_classes: ["profile-avatar"], halign: Gtk.Align.START })
  avatarWrapper.set_valign(Gtk.Align.CENTER)
  avatarWrapper.set_size_request(92, 92)
  const hasFace = GLib.file_test(FACE_PATH, GLib.FileTest.EXISTS)

  if (hasFace) {
    // Prefer the user's face image when available
    const img = Gtk.Image.new_from_file(FACE_PATH)
    img.set_pixel_size(64)
    img.set_halign(Gtk.Align.CENTER)
    img.set_valign(Gtk.Align.CENTER)
    img.add_css_class("profile-avatar-img")
    avatarWrapper.append(img)
  } else {
    avatarWrapper.append(avatarInitial)
  }

  // Live sections
  const windowsBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    css_classes: ["dashboard-list"]
  })

  const emailBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    css_classes: ["dashboard-list"]
  })
  const emailItems: EmailItem[] = []
  const emailStatus = new Gtk.Label({
    label: "IMAP: set data/email.json then refresh",
    css_classes: ["dashboard-note"],
    xalign: 0,
    wrap: true,
    wrap_mode: Pango.WrapMode.WORD_CHAR,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 60
  })

  const notificationBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    css_classes: ["dashboard-list", "notification-list"]
  })

  const notificationEmpty = new Gtk.Label({
    label: "No notifications yet",
    css_classes: ["dashboard-note", "notification-empty"],
    xalign: 0
  })
  notificationEmpty.visible = false
  const notificationClear = new Gtk.Button({
    label: "Clear",
    css_classes: ["pill-button", "notification-clear"],
    halign: Gtk.Align.END
  })
  notificationClear.set_sensitive(false)
  notificationClear.connect("clicked", () => clearNotificationHistory())
  const notificationScroll = new Gtk.ScrolledWindow({
    vexpand: false,
    min_content_height: NOTIFICATION_LIST_HEIGHT,
    max_content_height: NOTIFICATION_LIST_HEIGHT,
    height_request: NOTIFICATION_LIST_HEIGHT
  })
  notificationScroll.set_child(notificationBox)

  // Static widgets
  const calendar = new Gtk.Calendar({
    css_classes: ["dashboard-calendar"]
  })

  // Make today's highlight darker via application-level CSS provider and mark today
  try {
    const calCss = new Gtk.CssProvider()
    calCss.load_from_data(`
      .dashboard-calendar button:checked,
      .dashboard-calendar .selected,
      .dashboard-calendar .calendar-day.selected {
        background-color: rgba(30,30,30,0.85);
        color: rgba(255,255,255,0.98);
        border-radius: 6px;
      }
    `, -1)
    const disp = Gdk.Display.get_default && Gdk.Display.get_default()
    if (disp) Gtk.StyleContext.add_provider_for_display(disp, calCss, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
  } catch (e) {
    console.error("Calendar CSS provider failed:", e)
  }

  try {
    const today = new Date()
    calendar.mark_day && (calendar as any).mark_day(today.getDate())
  } catch (e) {
    // ignore on runtimes without mark_day
  }

  const todoList = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 4,
    css_classes: ["dashboard-list"]
  })

  const storageBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    css_classes: ["dashboard-list"]
  })

  const playbackBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    css_classes: ["dashboard-list"]
  })

  const playbackScroll = new Gtk.ScrolledWindow({
    vexpand: false,
    min_content_height: 140,
    max_content_height: 200,
    height_request: 160
  })
  playbackScroll.set_child(playbackBox)

  const storageStatus = new Gtk.Label({
    label: "Loading disks…",
    css_classes: ["dashboard-note"],
    xalign: 0,
    visible: false
  })

  const netLabel = new Gtk.Label({
    label: "Network",
    css_classes: ["card-title"],
    xalign: 0
  })
  const netSSID = new Gtk.Label({
    label: "WiFi: —",
    css_classes: ["network-info"],
    xalign: 0,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 28
  })
  const netDetail = new Gtk.Label({
    label: "Down 0B/s · Up 0B/s",
    css_classes: ["dashboard-note"],
    xalign: 0
  })

  // Network history + simple sparkline drawing area
  const MAX_NET_SAMPLES = 60
  const netHistoryDown: number[] = []
  const netHistoryUp: number[] = []
  const netGraph = new Gtk.DrawingArea({
    width_request: 220,
    height_request: 44,
    css_classes: ["network-graph"]
  })

  netGraph.set_draw_func((_area, cr, width, height) => {
    // transparent background
    cr.setSourceRGBA(0, 0, 0, 0)
    cr.paint()

    const down = netHistoryDown.slice(-MAX_NET_SAMPLES)
    const up = netHistoryUp.slice(-MAX_NET_SAMPLES)
    const samples = Math.max(down.length, up.length)
    if (!samples) return

    const all = down.concat(up)
    const maxVal = Math.max(1, ...all)
    const pad = 6
    const w = Math.max(1, width - pad * 2)
    const h = Math.max(1, height - pad * 2)

    // subtle grid
    cr.setLineWidth(1)
    cr.setSourceRGBA(0.85, 0.85, 0.85, 0.08)
    for (let i = 0; i < 3; i++) {
      const y = pad + (i / 2) * h
      cr.moveTo(pad, y)
      cr.lineTo(pad + w, y)
      cr.stroke()
    }

    const drawCurve = (arr: number[], r: number, g: number, b: number, fill = false, alpha = 1) => {
      cr.setLineWidth(1.5)
      cr.setSourceRGBA(r, g, b, alpha)
      const step = w / Math.max(1, samples - 1)
      if (fill) cr.moveTo(pad, pad + h)
      arr.forEach((v, i) => {
        const x = pad + i * step
        const y = pad + h - (Math.max(0, v) / maxVal) * h
        if (i === 0) cr.lineTo(x, y)
        else cr.lineTo(x, y)
      })
      if (fill) {
        cr.lineTo(pad + w, pad + h)
        cr.closePath()
        cr.setSourceRGBA(r, g, b, 0.12)
        cr.fillPreserve()
      }
      cr.setSourceRGBA(r, g, b, Math.min(1, alpha))
      cr.stroke()
    }

    drawCurve(down, 0.09, 0.53, 0.91, true, 1) // down = cyan area
    drawCurve(up, 0.95, 0.45, 0.18, false, 1) // up = orange line
  })

  const uptimeLabel = new Gtk.Label({ label: "Uptime", css_classes: ["card-title"], xalign: 0 })
  const uptimeDetail = new Gtk.Label({ label: "—", css_classes: ["dashboard-note"], xalign: 0 })
  const updatesDetail = new Gtk.Label({ label: "Updates: —", css_classes: ["dashboard-note"], xalign: 0 })

  const mediaLabel = new Gtk.Label({
    label: "Now Playing",
    css_classes: ["card-title"],
    xalign: 0
  })
  const mediaDetail = new Gtk.Label({
    label: "No media",
    css_classes: ["dashboard-note"],
    xalign: 0,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 30
  })

  const volumeStatus = safePoll(
    { volume: 100, isMuted: false },
    1200,
    async () => {
      try {
        const volStr = await execAsync("pamixer --get-volume")
        const mutedStr = await execAsync("pamixer --get-mute")
        const volume = clampPercent(parseInt(volStr.trim(), 10))
        return { volume, isMuted: mutedStr.trim() === "true" }
      } catch {
        return { volume: 100, isMuted: false }
      }
    }
  )

  const micStatus = safePoll(
    { volume: 100, isMuted: false },
    1500,
    async () => {
      try {
        const volStr = await execAsync("pamixer --default-source --get-volume")
        const mutedStr = await execAsync("pamixer --default-source --get-mute")
        const volume = clampPercent(parseInt(volStr.trim(), 10))
        return { volume, isMuted: mutedStr.trim() === "true" }
      } catch {
        return { volume: 100, isMuted: false }
      }
    }
  )

  const brightnessStatus = safePoll(
    100,
    1500,
    async () => {
      try {
        const bright = await execAsync("brightnessctl g")
        const max = await execAsync("brightnessctl m")
        const pct = Math.round((parseInt(bright, 10) / parseInt(max, 10)) * 100)
        return clampPercent(pct)
      } catch {
        return 100
      }
    }
  )

  const volumeAdjustment = new Gtk.Adjustment({
    lower: 0,
    upper: 100,
    step_increment: 1,
    page_increment: 5,
    value: 100
  })
  let volumeSync = false
  const volumeScale = new Gtk.Scale({
    orientation: Gtk.Orientation.HORIZONTAL,
    adjustment: volumeAdjustment,
    draw_value: false,
    hexpand: true,
    css_classes: ["control-slider", "mixer-slider"]
  })
  volumeScale.connect("value-changed", (scale) => {
    if (volumeSync) return
    const value = clampPercent(scale.get_value())
    execAsync(`pamixer --set-volume ${value}`).catch(console.error)
  })

  const micAdjustment = new Gtk.Adjustment({
    lower: 0,
    upper: 100,
    step_increment: 1,
    page_increment: 5,
    value: 100
  })
  let micSync = false
  const micScale = new Gtk.Scale({
    orientation: Gtk.Orientation.HORIZONTAL,
    adjustment: micAdjustment,
    draw_value: false,
    hexpand: true,
    css_classes: ["control-slider", "mixer-slider"]
  })
  micScale.connect("value-changed", (scale) => {
    if (micSync) return
    const value = clampPercent(scale.get_value())
    execAsync(`pamixer --default-source --set-volume ${value}`).catch(console.error)
  })

  const brightnessAdjustment = new Gtk.Adjustment({
    lower: 0,
    upper: 100,
    step_increment: 1,
    page_increment: 5,
    value: 100
  })
  let brightnessSync = false
  const brightnessScale = new Gtk.Scale({
    orientation: Gtk.Orientation.HORIZONTAL,
    adjustment: brightnessAdjustment,
    draw_value: false,
    hexpand: true,
    css_classes: ["control-slider"]
  })
  brightnessScale.connect("value-changed", (scale) => {
    if (brightnessSync) return
    const value = clampPercent(scale.get_value())
    execAsync(`brightnessctl set ${value}%`).catch(console.error)
  })

  const volumeValueLabel = volumeStatus((state) => {
    const value = clampPercent(state.volume)
    volumeSync = true
    volumeScale.set_value(value)
    volumeSync = false
    return state.isMuted ? "Muted" : `${value}%`
  })

  const micValueLabel = micStatus((state) => {
    const value = clampPercent(state.volume)
    micSync = true
    micScale.set_value(value)
    micSync = false
    return state.isMuted ? "Muted" : `${value}%`
  })

  const brightnessValueLabel = brightnessStatus((value) => {
    const pct = clampPercent(value)
    brightnessSync = true
    brightnessScale.set_value(pct)
    brightnessSync = false
    return `${pct}%`
  })

  const powerProfileStatus = safePoll<PowerProfileState>(
    { active: "unknown", available: [], details: {}, error: "" },
    5000,
    async () => {
      try {
        const out = await execAsync("powerprofilesctl list")
        const lines = out.split("\n")
        let current: string | null = null
        let active = "unknown"
        const available: string[] = []
        const details: Record<string, string[]> = {}

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          const header = trimmed.match(/^(\*?)\s*([A-Za-z0-9\-]+):/)
          if (header) {
            current = header[2]
            available.push(current)
            details[current] = []
            if (header[1] === "*") active = current
            continue
          }

          if (!current) continue
          if (!trimmed.includes(":")) continue
          details[current]?.push(trimmed.replace(/\s+/g, " "))
        }

        if (!available.length) {
          return { active: "unknown", available, details, error: "No power profiles detected" }
        }

        return { active: active === "unknown" ? available[0] : active, available, details, error: "" }
      } catch (err) {
        console.error("Power profiles read failed:", err)
        return { active: "unknown", available: [], details: {}, error: "powerprofilesctl unavailable" }
      }
    }
  )

  const setPowerProfile = async (profile: string) => {
    try {
      await execAsync(`powerprofilesctl set ${profile}`)
    } catch (err) {
      console.error("Power profile set failed:", err)
    }
  }

  // Factory to create a circular usage gauge with update hook
  const makeGauge = (title: string, colorClass: string): Gauge => {
    let percent = 0
    const percentLabel = new Gtk.Label({ label: "0%", css_classes: ["gauge-percent"] })
    const detailLabel = new Gtk.Label({
      label: "",
      css_classes: ["gauge-detail"],
      wrap: true,
      wrap_mode: Pango.WrapMode.WORD_CHAR,
      xalign: 0.5,
      justify: Gtk.Justification.CENTER,
      max_width_chars: 20
    })

    const area = new Gtk.DrawingArea({
      width_request: GAUGE_SIZE,
      height_request: GAUGE_SIZE,
      css_classes: ["gauge-area", colorClass]
    })

    const getColorForClass = (cls: string, intensity: number) => {
      const alpha = Math.max(0.4, intensity / 100)
      switch (cls) {
        case "gauge-cyan": return [0, 0.85, 1, alpha]
        case "gauge-green": return [0.22, 1, 0.08, alpha]
        case "gauge-orange": return [1, 0.42, 0.21, alpha]
        case "gauge-purple": return [0.71, 0.29, 1, alpha]
        default: return [0.64, 1, 0, alpha]
      }
    }

    // Lightweight canvas arc gauge
    area.set_draw_func((_a, cr, width, height) => {
      const r = Math.min(width, height) / 2 - 6
      const cx = width / 2
      const cy = height / 2
      const pct = Math.max(0, Math.min(100, percent))
      const ang = (pct / 100) * Math.PI * 2

      cr.setSourceRGBA(0.05, 0.08, 0.12, 0.22)
      cr.setLineWidth(8)
      cr.arc(cx, cy, r, 0, Math.PI * 2)
      cr.stroke()

      const [r_, g_, b_, a_] = getColorForClass(colorClass, pct)
      cr.setSourceRGBA(r_, g_, b_, a_)
      cr.setLineWidth(10)
      cr.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + ang)
      cr.stroke()

      if (pct > 10) {
        cr.setSourceRGBA(r_, g_, b_, a_ * 0.3)
        cr.setLineWidth(16)
        cr.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + ang)
        cr.stroke()
      }
    })

    const update = (pct: number, detail?: string) => {
      percent = Math.round(Math.max(0, Math.min(100, pct)))
      percentLabel.label = `${percent}%`
      detailLabel.label = detail || ""
      area.queue_draw()
    }

    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 4,
      halign: Gtk.Align.CENTER,
      css_classes: ["gauge-card"]
    })
    box.append(new Gtk.Label({ label: title, css_classes: ["gauge-title"], halign: Gtk.Align.CENTER }))
    box.append(area)
    box.append(percentLabel)
    box.append(detailLabel)

    return { widget: box, update }
  }

  const cpuGauge = makeGauge("CPU", "gauge-cyan")
  const ramGauge = makeGauge("RAM", "gauge-green")
  const gpuGauge = makeGauge("GPU", "gauge-orange")
  const storageGauge = makeGauge("Storage", "gauge-purple")

  // Render TODO.md preview (first TODO_PREVIEW_MAX items)
  const loadTodo = () => {
    let text = "- [ ] this is a todo task\n"
    try {
      const [ok, data] = GLib.file_get_contents(TODO_PATH)
      if (ok && data) {
        text = decodeBuffer(data)
      }
    } catch (err) {
      console.error("TODO read failed:", err)
    }

    const lines = text.split("\n").filter((l) => l.trim().length > 0).slice(0, TODO_PREVIEW_MAX)

    let child = todoList.get_first_child()
    while (child) {
      todoList.remove(child)
      child = todoList.get_first_child()
    }

    lines.forEach((line) => {
      const unchecked = line.trim().startsWith("- [ ]")
      const checked = line.trim().startsWith("- [x]") || line.trim().startsWith("- [X]")
      const labelText = line.replace(/^- \[[ xX]\]\s?/, "")

      const row = new Gtk.Box({ spacing: 8, css_classes: ["dashboard-list-row", "todo-item", checked ? "checked" : unchecked ? "unchecked" : ""] })
      const icon = new Gtk.Label({ label: checked ? "󰄴" : unchecked ? "" : "•", css_classes: ["muted", "todo-icon"], width_chars: 2, xalign: 0 })
      const lbl = new Gtk.Label({
        label: labelText.length ? labelText : line,
        xalign: 0,
        hexpand: true,
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD_CHAR,
        max_width_chars: 50
      })
      row.set_margin_start(4)
      row.set_margin_end(4)
      row.set_margin_top(2)
      row.set_margin_bottom(2)
      icon.set_margin_start(2)
      lbl.set_margin_start(2)
      row.append(icon)
      row.append(lbl)
      todoList.append(row)
    })
  }

// Apply profile data to GTK labels
const applyProfile = (profile: Profile) => {
    profileName.label = profile.name
    profileTitle.label = profile.title
    profileMeta.label = `${profile.location} • ${profile.email}`
    profileStatus.label = profile.status

    const handles = profile.handles
      ? Object.entries(profile.handles)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" / ")
      : ""

    profileBio.label = profile.bio
      ? `${profile.bio}${handles ? ` — ${handles}` : ""}`
      : handles

    avatarInitial.label = profile.name?.slice(0, 1).toUpperCase() || "S"
  }

  // Rebuild the disks list with current volumes
  const renderStorageList = (volumes: DiskVolume[]) => {
    renderList(
      storageBox,
      volumes,
      (vol) => {
        const row = new Gtk.Grid({ column_spacing: 3, hexpand: true, css_classes: ["dashboard-list-row", "storage-row"] })
        const mount = new Gtk.Label({
          label: prettyMount(vol.mount),
          xalign: 0,
          hexpand: true,
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 18,
          css_classes: ["storage-mount"]
        })
        const usage = new Gtk.Label({
          label: `${(vol.used / 1024 / 1024 / 1024).toFixed(0)} / ${(vol.size / 1024 / 1024 / 1024).toFixed(0)} GiB`,
          xalign: 1,
          halign: Gtk.Align.END,
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 16,
          width_chars: 12,
          css_classes: ["storage-usage"]
        })
        const pct = new Gtk.Label({
          label: `${vol.pct}%`,
          xalign: 1,
          halign: Gtk.Align.END,
          css_classes: ["muted", "storage-pct"],
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 6,
          width_chars: 5
        })
        row.attach(mount, 0, 0, 1, 1)
        row.attach(usage, 1, 0, 1, 1)
        row.attach(pct, 2, 0, 1, 1)
        return row
      }
    )
  }

  const readPlaybackStreams = async (): Promise<PlaybackItem[]> => {
    try {
      const out = await execAsync("pactl -f json list sink-inputs")
      const parsed = JSON.parse(out)
      if (!Array.isArray(parsed)) throw new Error("Unexpected pactl json")

      return parsed
        .map((entry: any) => {
          const id = typeof entry.index === "number" ? entry.index : parseInt(entry.index, 10)
          const props = entry.properties || {}
          const name =
            props["application.name"] ||
            props["media.name"] ||
            props["application.process.binary"] ||
            `App ${Number.isFinite(id) ? id : "?"}`

          const volumeObj = entry.volume || {}
          const channelPercents = Object.values(volumeObj)
            .map((v: any) => {
              if (!v) return null
              if (typeof v === "number") return null
              if (typeof v === "string") {
                const match = v.match(/(\d+)%/)
                return match ? parseInt(match[1], 10) : null
              }
              if (typeof v === "object" && typeof v.value_percent === "string") {
                const match = v.value_percent.match(/(\d+)%/)
                return match ? parseInt(match[1], 10) : null
              }
              if (typeof v === "object" && typeof v.value_percent === "number") {
                return v.value_percent
              }
              return null
            })
            .filter((n) => typeof n === "number") as number[]

          const volume = channelPercents.length
            ? clampPercent(channelPercents.reduce((a, b) => a + b, 0) / channelPercents.length)
            : 0

          const muted = Boolean(entry.mute ?? entry.muted ?? false)

          if (!Number.isFinite(id)) return null
          return { id, name: String(name).trim() || `App ${id}`, volume, muted }
        })
        .filter((item: PlaybackItem | null): item is PlaybackItem => Boolean(item))
    } catch {
      // fallback to plain text parsing
    }

    try {
      const out = await execAsync("pactl list sink-inputs")
      const blocks = out.split(/Sink Input #/).slice(1)
      return blocks
        .map((block) => {
          const lines = block.split("\n")
          const id = parseInt(lines[0]?.trim() || "", 10)
          if (!Number.isFinite(id)) return null

          const nameLine =
            lines.find((l) => l.includes("application.name")) ||
            lines.find((l) => l.includes("media.name")) ||
            lines.find((l) => l.includes("application.process.binary"))
          const nameMatch = nameLine?.match(/=\s*\"(.+)\"/)
          const name = nameMatch?.[1] || `App ${id}`

          const muteLine = lines.find((l) => l.trim().startsWith("Mute:"))
          const muted = muteLine?.includes("yes") || false

          const volumeLine = lines.find((l) => l.trim().startsWith("Volume:")) || ""
          const volMatch = volumeLine.match(/(\d+)%/)
          const volume = volMatch ? clampPercent(parseInt(volMatch[1], 10)) : 0

          return { id, name, volume, muted }
        })
        .filter((item: PlaybackItem | null): item is PlaybackItem => Boolean(item))
    } catch {
      return []
    }
  }

  let lastPlaybackKey = ""
  const renderPlaybackList = (items: PlaybackItem[]) => {
    let child = playbackBox.get_first_child()
    while (child) {
      playbackBox.remove(child)
      child = playbackBox.get_first_child()
    }

    if (!items.length) {
      playbackBox.append(
        new Gtk.Label({
          label: "No active audio apps",
          css_classes: ["dashboard-note"],
          xalign: 0
        })
      )
      return
    }

    items.forEach((item) => {
      const row = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        css_classes: ["mixer-item"]
      })

      const header = new Gtk.Box({ spacing: 8 })
      const nameLabel = new Gtk.Label({
        label: item.name,
        xalign: 0,
        hexpand: true,
        ellipsize: Pango.EllipsizeMode.END,
        max_width_chars: 28,
        css_classes: ["mixer-name"]
      })
      const valueLabel = new Gtk.Label({
        label: item.muted ? "Muted" : `${item.volume}%`,
        xalign: 1,
        halign: Gtk.Align.END,
        css_classes: ["control-value"]
      })
      header.append(nameLabel)
      header.append(valueLabel)

      const adjustment = new Gtk.Adjustment({
        lower: 0,
        upper: 100,
        step_increment: 1,
        page_increment: 5,
        value: item.volume
      })
      let sync = false
      const scale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment,
        draw_value: false,
        hexpand: true,
        css_classes: ["control-slider", "mixer-slider"]
      })
      scale.connect("value-changed", (widget) => {
        if (sync) return
        const value = clampPercent(widget.get_value())
        execAsync(`pactl set-sink-input-volume ${item.id} ${value}%`).catch(console.error)
      })
      sync = true
      scale.set_value(item.volume)
      sync = false

      row.append(header)
      row.append(scale)
      playbackBox.append(row)
    })
  }

  const refreshPlayback = async () => {
    try {
      const items = await readPlaybackStreams()
      const key = items.length
        ? items.map((i) => `${i.id}:${i.volume}:${i.muted}:${i.name}`).join("|")
        : "empty"
      if (key === lastPlaybackKey) return
      lastPlaybackKey = key
      renderPlaybackList(items)
    } catch (err) {
      console.error("Playback refresh failed:", err)
    }
  }

  const renderEmailList = (items: EmailItem[]) => {
    renderList(
      emailBox,
      items,
      (item) => {
        const row = new Gtk.Box({ spacing: 8, css_classes: ["dashboard-list-row"] })
        row.append(new Gtk.Label({
          label: item.from || "Unknown",
          xalign: 0,
          css_classes: ["muted"],
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 20
        }))
        row.append(new Gtk.Label({
          label: item.subject || "(no subject)",
          xalign: 0,
          hexpand: true,
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 40
        }))
        row.append(new Gtk.Label({
          label: item.date || "",
          xalign: 1,
          css_classes: ["muted"],
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 18
        }))
        return row
      }
    )
  }

  const renderNotificationList = (items: NotificationEntry[]) => {
    notificationClear.sensitive = items.length > 0
    notificationScroll.visible = true

    let child = notificationBox.get_first_child()
    while (child) {
      notificationBox.remove(child)
      child = notificationBox.get_first_child()
    }

    if (!items.length) {
      notificationBox.visible = true
      notificationBox.append(
        new Gtk.Label({
          label: "No notifications yet",
          css_classes: ["dashboard-note", "notification-empty"],
          xalign: 0
        })
      )
      return
    }

    notificationBox.visible = true

    items.forEach((item) => {
      const row = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        css_classes: ["dashboard-list-row", "notification-row"]
      })

      const iconWrap = new Gtk.Box({ css_classes: ["notification-app-icon-wrap"] })
      iconWrap.append(
        new Gtk.Image({
          icon_name: resolveWindowIcon(item.app, item.summary),
          pixel_size: 16,
          css_classes: ["notification-app-icon"]
        })
      )

      const meta = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        hexpand: true
      })
      const appLabel = new Gtk.Label({
        label: item.app,
        css_classes: ["muted", "notification-app"],
        xalign: 0,
        hexpand: true,
        ellipsize: Pango.EllipsizeMode.END,
        max_width_chars: 22
      })
      const summary = new Gtk.Label({
        label: item.summary || "(no title)",
        css_classes: ["notification-title"],
        xalign: 0,
        ellipsize: Pango.EllipsizeMode.END,
        max_width_chars: 42,
        hexpand: true
      })
      meta.append(appLabel)
      meta.append(summary)

      const header = new Gtk.Box({ spacing: 10, hexpand: true, valign: Gtk.Align.START })
      const timeLabel = new Gtk.Label({
        label: formatTimeShort(item.timestamp),
        css_classes: ["notification-time"],
        xalign: 1,
        halign: Gtk.Align.END,
        width_chars: 6
      })

      const dismissBtn = new Gtk.Button({
        css_classes: ["notification-dismiss"],
        halign: Gtk.Align.END,
        valign: Gtk.Align.START,
        tooltip_text: "Dismiss"
      })
      dismissBtn.set_child(new Gtk.Image({ icon_name: "window-close-symbolic", pixel_size: 15 }))
      dismissBtn.connect("clicked", () => removeNotification(item.id))

      header.append(iconWrap)
      header.append(meta)
      header.append(timeLabel)
      header.append(dismissBtn)

      const body = new Gtk.Label({
        label: item.body,
        css_classes: ["notification-body"],
        xalign: 0,
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD_CHAR,
        max_width_chars: 52,
        visible: !!item.body
      })

      row.add_controller(
        (() => {
          const click = new Gtk.GestureClick()
          click.connect("released", () => removeNotification(item.id))
          return click
        })()
      )

      row.append(header)
      row.append(body)
      notificationBox.append(row)
    })
  }

  const updateEmailState = (items: EmailItem[]) => {
    emailItems.splice(0, emailItems.length, ...items)
    if (!items.length || items[0].from === "error") {
      renderEmailList([])
      emailStatus.label = "No mail"
      return
    }

    renderEmailList(emailItems)
    emailStatus.label = `Showing ${items.length} messages`
  }

  const loadEmailConfig = (): EmailConfig | null => {
    try {
      const [ok, data] = GLib.file_get_contents(EMAIL_CONFIG_PATH)
      if (ok && data) {
        const parsed = JSON.parse(decodeBuffer(data))
        if (parsed && parsed.host && parsed.user && parsed.password) return parsed
      }
    } catch (err) {
      console.error("Email config load failed:", err)
    }
    return null
  }


  let lastCpu = { idle: 0, total: 0 }

  // CPU usage from /proc/stat delta
  const readCpuUsage = async () => {
    try {
      const stat = await execAsync("grep 'cpu ' /proc/stat")
      const parts = stat.trim().split(/\s+/).slice(1).map((n) => parseInt(n, 10))
      const idle = (parts[3] || 0) + (parts[4] || 0)
      const total = parts.reduce((a, b) => a + b, 0)
      if (lastCpu.total === 0) {
        lastCpu = { idle, total }
        return 0
      }
      const diffIdle = idle - lastCpu.idle
      const diffTotal = total - lastCpu.total
      lastCpu = { idle, total }
      if (diffTotal <= 0) return 0
      return Math.max(0, Math.min(100, Math.round(100 * (1 - diffIdle / diffTotal))))
    } catch (err) {
      console.error("CPU read failed:", err)
      return 0
    }
  }

  // RAM usage from /proc/meminfo
  const readRamUsage = async () => {
    try {
      const out = await execAsync("awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {print (t-a)\" \"t}' /proc/meminfo")
      const [usedStr, totalStr] = out.trim().split(/\s+/)
      const used = parseInt(usedStr, 10)
      const total = parseInt(totalStr, 10)
      if (!total || isNaN(total)) return { pct: 0, used: 0, total: 0 }
      const pct = Math.max(0, Math.min(100, Math.round((used / total) * 100)))
      return { pct, used: isNaN(used) ? 0 : used, total }
    } catch (err) {
      console.error("RAM read failed:", err)
      return { pct: 0, used: 0, total: 0 }
    }
  }

  // Root filesystem usage for the gauge summary
  const readStorage = async () => {
    try {
      const out = await execAsync("/usr/bin/df -B1 /")
      const trimmed = out.trim()
      if (!trimmed) return { pct: 0, detail: "N/A" }

      const lines = trimmed.split("\n").filter((l) => l.trim().length > 0)
      const line = lines[lines.length - 1] || ""
      const parts = line.trim().split(/\s+/)
      if (parts.length < 3) return { pct: 0, detail: "N/A" }

      const total = parseInt(parts[1] || "0", 10) || 0
      const used = parseInt(parts[2] || "0", 10) || 0
      if (!total) return { pct: 0, detail: "N/A" }

      const pctRaw = (used / total) * 100
      const pct = Math.round(Math.max(0, Math.min(100, pctRaw)))
      const toGB = (n: number) => (n / 1e9).toFixed(1)
      const detail = `${toGB(used)}/${toGB(total)}GB`

      return { pct, detail }
    } catch (err) {
      console.error("Storage read failed:", err)
      return { pct: 0, detail: "N/A" }
    }
  }

  // Expanded storage data for the disks list
  const readStorageAll = async (): Promise<{ totalPct: number; volumes: DiskVolume[] }> => {
    try {
      const out = await execAsync("df -B1 --output=target,fstype,size,used -x tmpfs -x devtmpfs -x overlay -x squashfs")
      const trimmed = out.trim()
      if (!trimmed) return { totalPct: 0, volumes: [] }

      const lines = trimmed.split("\n").slice(1).map((l) => l.trim()).filter((l) => l.length > 0)
      const vols: DiskVolume[] = []

      for (const line of lines) {
        const parts = line.split(/\s+/)
        if (parts.length < 4) continue
        const [mount, fstype, sizeStr, usedStr] = parts
        if (!mount || !fstype) continue
        if (STORAGE_EXCLUDED.includes(fstype)) continue
        const size = parseInt(sizeStr, 10) || 0
        const used = parseInt(usedStr, 10) || 0
        if (!size) continue
        const pct = Math.round(Math.max(0, Math.min(100, (used / size) * 100)))
        vols.push({ mount, fstype, used, size, pct })
      }

      const filtered = vols.filter((v) => STORAGE_WHITELIST.includes(v.mount))
      const chosen = filtered.length ? filtered : vols.slice(0, 3)

      const totalSize = chosen.reduce((a, v) => a + v.size, 0)
      const totalUsed = chosen.reduce((a, v) => a + v.used, 0)
      const totalPct = totalSize ? Math.round(Math.max(0, Math.min(100, (totalUsed / totalSize) * 100))) : 0
      return { totalPct, volumes: chosen }
    } catch (err) {
      console.error("Storage read failed:", err)
      return { totalPct: 0, volumes: [] }
    }
  }

  let lastNet = { rx: 0, tx: 0, ts: 0 }
  let lastStorage = { totalPct: 0, volumes: [] as DiskVolume[] }
  let storageTick = 0
  // Human readable network speeds
  const formatSpeed = (bps: number) => {
    const abs = Math.max(0, bps)
    if (abs > 1e9) return `${(abs / 1e9).toFixed(2)} GiB/s`
    if (abs > 1e6) return `${(abs / 1e6).toFixed(2)} MiB/s`
    if (abs > 1e3) return `${(abs / 1e3).toFixed(1)} KiB/s`
    return `${abs.toFixed(0)} B/s`
  }

  const readWifiName = async () => {
    try {
      const out = await execAsync("iwgetid -r")
      const ssid = out.trim()
      if (ssid) return ssid
    } catch {}

    try {
      const out = await execAsync("nmcli -t -f active,ssid dev wifi")
      const line = out
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("yes:"))
      if (line) return line.split(":").slice(1).join(":").trim()
    } catch {}

    try {
      const out = await execAsync("iw dev")
      const match = out.match(/ssid\s+(.+)/i)
      if (match?.[1]) return match[1].trim()
    } catch {}

    return ""
  }

  // Aggregate rx/tx across interfaces (excluding lo)
  const readNetwork = async () => {
    let ssid = ""
    try {
      ssid = await readWifiName()
    } catch {}

    try {
      const out = await execAsync("cat /proc/net/dev")
      const lines = out.split("\n").slice(2).filter((l) => l.trim().length > 0)
      let rx = 0
      let tx = 0
      for (const line of lines) {
        const [ifacePart, rest] = line.split(":")
        const iface = ifacePart.trim()
        if (!iface || iface === "lo") continue
        const parts = rest.trim().split(/\s+/)
        const rxBytes = parseInt(parts[0] || "0", 10)
        const txBytes = parseInt(parts[8] || "0", 10)
        rx += isNaN(rxBytes) ? 0 : rxBytes
        tx += isNaN(txBytes) ? 0 : txBytes
      }

      const now = Date.now() / 1000
      if (lastNet.ts === 0) {
        lastNet = { rx, tx, ts: now }
        return { down: 0, up: 0, ssid }
      }
      const dt = Math.max(0.5, now - lastNet.ts)
      const down = (rx - lastNet.rx) / dt
      const up = (tx - lastNet.tx) / dt
      lastNet = { rx, tx, ts: now }
      // update sparkline history and redraw
      try {
        netHistoryDown.push(down)
        netHistoryUp.push(up)
        if (netHistoryDown.length > MAX_NET_SAMPLES) netHistoryDown.shift()
        if (netHistoryUp.length > MAX_NET_SAMPLES) netHistoryUp.shift()
        netGraph.queue_draw()
      } catch (e) {
        // ignore if histories are not yet available for some reason
      }

      return { down, up, ssid }
    } catch (err) {
      console.error("Network read failed:", err)
      return { down: 0, up: 0, ssid }
    }
  }

  // Friendly uptime string from system
  const readUptime = async () => {
    try {
      const out = await execAsync("uptime -p")
      return out.trim()
    } catch {
      const seconds = Math.floor(GLib.get_monotonic_time() / 1_000_000)
      const hours = Math.floor(seconds / 3600)
      const mins = Math.floor((seconds % 3600) / 60)
      return `up ${hours}h ${mins}m`
    }
  }

  // Pacman checkupdates count (Arch-centric)
  const readUpdates = async () => {
    try {
      const out = await execAsync("/usr/bin/checkupdates")
      if (!out.trim()) return "Updates: 0"
      const count = out.trim().split("\n").filter((l) => l.length > 0).length
      return `Updates: ${count}`
    } catch {
      return "Updates: n/a"
    }
  }

  const readMpcTrack = async () => {
    try {
      const out = await execAsync("mpc status")
      const lines = out.split("\n").filter((l) => l.trim().length > 0)
      if (!lines.length) return null
      const title = lines[0]?.trim() || ""
      const stateLine = lines[1] || ""
      const status = stateLine.includes("[playing]")
        ? "playing"
        : stateLine.includes("[paused]")
        ? "paused"
        : "stopped"
      if (!title) return null
      return { title, status }
    } catch {
      return null
    }
  }

  // Now-playing info via playerctl
  const readMedia = async () => {
    let playerctlTrack = ""
    let playerctlStatus = "NoPlayer"

    try {
      const status = await execAsync("playerctl status --ignore-player=chromium")
      playerctlStatus = status.trim()
      if (playerctlStatus !== "NoPlayer") {
        const out = await execAsync("playerctl metadata --format '{{title}} — {{artist}}' --ignore-player=chromium")
        playerctlTrack = out.trim()
        if (playerctlStatus === "Playing" && playerctlTrack) return playerctlTrack
      }
    } catch {}

    // fall back to mpc
    const mpc = await readMpcTrack()
    if (mpc) {
      const suffix = mpc.status === "paused" ? " · mpc (paused)" : " · mpc"
      if (mpc.status === "playing") return `${mpc.title}${suffix}`
      if (!playerctlTrack) return `${mpc.title}${suffix}`
    }

    if (playerctlTrack) return playerctlTrack

    if (mpc) {
      const suffix = mpc.status === "paused" ? " · mpc (paused)" : " · mpc"
      return `${mpc.title}${suffix}`
    }
    return "No media"
  }

  // GPU usage across common vendor paths
  const readGpu = async () => {
    try {
      try {
        const out = await execAsync(
          "/usr/bin/nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits"
        )
        const trimmed = out.trim()
        if (trimmed) {
          const parts = trimmed.split(",").map((s) => s.trim())
          const pct = parseInt(parts[0] || "0", 10)
          const used = parseInt(parts[1] || "0", 10)
          const total = parseInt(parts[2] || "0", 10)
          const detail = total ? `${used}/${total}MB` : "NVIDIA"
          return {
            pct: isNaN(pct) ? 0 : Math.max(0, Math.min(100, pct)),
            detail
          }
        }
      } catch (err) {
        console.error("GPU NVIDIA path failed:", err)
      }

      const renderNodes = ["renderD128", "renderD129", "renderD130"]
      for (const node of renderNodes) {
        try {
          const busy = await execAsync(
            `cat /sys/class/drm/${node}/device/gpu_busy_percent 2>/dev/null || cat /sys/class/drm/${node}/device/gt_busy_percent 2>/dev/null || echo ""`
          )
          const trimmed = busy.trim()
          if (trimmed) {
            const pctBusy = parseInt(trimmed, 10)
            if (!isNaN(pctBusy) && pctBusy >= 0) {
              return { pct: Math.max(0, Math.min(100, pctBusy)), detail: node }
            }
          }
        } catch (e) {
          console.log(`GPU node ${node} not available`)
        }
      }

      for (const card of [0, 1, 2]) {
        try {
          const busy = await execAsync(
            `cat /sys/class/drm/card${card}/device/gpu_busy_percent 2>/dev/null || cat /sys/class/drm/card${card}/device/gt_busy_percent 2>/dev/null || echo ""`
          )
          const trimmed = busy.trim()
          if (trimmed) {
            const pctBusy = parseInt(trimmed, 10)
            if (!isNaN(pctBusy) && pctBusy >= 0) {
              return { pct: Math.max(0, Math.min(100, pctBusy)), detail: `card${card}` }
            }
          }

          try {
            const pmInfo = await execAsync(
              `cat /sys/kernel/debug/dri/${card}/amdgpu_pm_info 2>/dev/null || echo ""`
            )
            const match = pmInfo.match(/GPU Load:\s*(\d+)%/)
            if (match) {
              const pct = parseInt(match[1], 10)
              if (!isNaN(pct)) return { pct: Math.max(0, Math.min(100, pct)), detail: `AMD card${card}` }
            }
          } catch {}
        } catch (e) {
          console.log(`GPU card${card} not available`)
        }
      }

      return { pct: 0, detail: "GPU N/A" }
    } catch (err) {
      console.error("GPU read failed:", err)
      return { pct: 0, detail: "GPU N/A" }
    }
  }

  // Update gauges + disks list
  const refreshGauges = async () => {
    try {
      const cpu = await readCpuUsage()
      cpuGauge.update(cpu, "")

      const ram = await readRamUsage()
      ramGauge.update(ram.pct, "")

      const gpu = await readGpu()
      gpuGauge.update(gpu.pct, gpu.detail || "n/a")

      storageTick += 1
      if (storageTick % 10 === 0 || !lastStorage.volumes.length) {
        lastStorage = await readStorageAll()
        renderStorageList(lastStorage.volumes)
        storageStatus.label = lastStorage.volumes.length
          ? `Total ${lastStorage.totalPct}% across ${lastStorage.volumes.length} vols`
          : "No disks detected"
        storageStatus.visible = !lastStorage.volumes.length
        queueDashboardSizing()
      }

      storageGauge.update(
        lastStorage.totalPct,
        lastStorage.volumes.length ? `${lastStorage.volumes.length} vols` : "n/a"
      )
    } catch (err) {
      console.error("Gauge refresh failed:", err)
    }
  }

  // Update network card
  const refreshNetwork = async () => {
    try {
      const net = await readNetwork()
      netLabel.label = "Network"
      netSSID.label = net.ssid ? `WiFi: ${net.ssid}` : "WiFi: —"
      netDetail.label = `Down ${formatSpeed(net.down)} · Up ${formatSpeed(net.up)}`
      netGraph.queue_draw()
    } catch (err) {
      console.error("Network refresh failed:", err)
    }
  }

  // Update uptime/updates/media cards
  const refreshMeta = async () => {
    try {
      uptimeDetail.label = await readUptime()
      updatesDetail.label = await readUpdates()
      mediaDetail.label = await readMedia()
    } catch (err) {
      console.error("Meta refresh failed:", err)
    }
  }

  const refreshNotifications = () => {
    renderNotificationList(getNotificationHistory())
  }

  const renderWindows = (windows: WindowInfo[]) => {
    renderList(
      windowsBox,
      windows,
      (item) => {
        const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, css_classes: ["dashboard-list-row", "windows-row"], hexpand: true })
        const appIconName = resolveWindowIcon(item.app, item.title)
        const appBox = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          spacing: 6,
          valign: Gtk.Align.CENTER
        })
        const appIcon = new Gtk.Image({
          icon_name: appIconName,
          pixel_size: 18
        })
        appIcon.add_css_class("window-app-icon")
        const appLabel = new Gtk.Label({
          label: item.app,
          xalign: 0,
          css_classes: ["muted", "window-app"],
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 12,
          width_chars: 12
        })
        appBox.append(appIcon)
        appBox.append(appLabel)
        appBox.set_hexpand(false)
        const titleLabel = new Gtk.Label({
          label: item.title,
          xalign: 0,
          hexpand: true,
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 44,
          css_classes: ["window-title"]
        })
        const wsBox = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          spacing: 6,
          css_classes: ["window-workspace"],
          halign: Gtk.Align.END,
          valign: Gtk.Align.CENTER
        })
        const wsIcon = new Gtk.Image({
          icon_name: appIconName,
          pixel_size: 14
        })
        wsIcon.add_css_class("window-workspace-icon")
        const wsLabel = new Gtk.Label({
          label: `WS ${item.workspace}`,
          xalign: 1,
          halign: Gtk.Align.END,
          ellipsize: Pango.EllipsizeMode.END,
          width_chars: 6,
          max_width_chars: 6
        })
        wsBox.append(wsIcon)
        wsBox.append(wsLabel)
        wsBox.set_hexpand(false)
        row.append(appBox)
        row.append(titleLabel)
        row.append(wsBox)
        return row
      }
    )
  }

  let dashboardRefreshActive = false
  let dashboardRefreshQueued = false

  // Full dashboard refresh flow
  const refreshDashboard = async () => {
    if (dashboardRefreshActive) {
      dashboardRefreshQueued = true
      return
    }

    dashboardRefreshActive = true

    applyProfile(loadProfile())
    refreshNotifications()

    try {
      const [windows] = await Promise.all([
        fetchWindows(),
        refreshGauges(),
        refreshNetwork(),
        refreshMeta(),
        refreshPlayback()
      ])

      renderWindows(windows)
    } catch (err) {
      console.error("Dashboard refresh failed:", err)
    } finally {
      dashboardRefreshActive = false

      if (dashboardRefreshQueued) {
        dashboardRefreshQueued = false
        void refreshDashboard().catch((err) => console.error("Queued dashboard refresh failed:", err))
      }
    }
  }

  let stopNotificationsListener = () => {}
  let currentSection: DashboardSectionId = DASHBOARD_DEFAULT_SECTION
  let sectionStack: Gtk.Stack | null = null
  let storageScroll: Gtk.ScrolledWindow | null = null
  const sectionButtons = new Map<DashboardSectionId, Gtk.Button>()
  let dashboardSizingSource = 0
  let lastSizingSnapshot = ""

  const measureNaturalHeight = (widget: Gtk.Widget | null, forWidth = -1) => {
    if (!widget) return 0
    try {
      const [_minimum, natural] = widget.measure(Gtk.Orientation.VERTICAL, forWidth)
      return natural
    } catch (err) {
      console.error("Dashboard height measure failed:", err)
      return 0
    }
  }

  const syncDashboardSizing = () => {
    const sectionWidth = MODAL_WIDTH - 120 - DASHBOARD_SURFACE_PADDING * 2

    if (!storageScroll) return

    const storageNatural = measureNaturalHeight(storageBox, sectionWidth)
    const desiredStorageHeight = Math.max(72, Math.min(storageNatural + 12, 260))
    storageScroll.set_min_content_height(desiredStorageHeight)
    storageScroll.set_max_content_height(desiredStorageHeight)
    storageScroll.set_size_request(-1, desiredStorageHeight)

    const snapshot = JSON.stringify({
      currentSection,
      sectionWidth,
      storageNatural,
      desiredStorageHeight
    })
    if (snapshot !== lastSizingSnapshot) {
      lastSizingSnapshot = snapshot
      console.log(`[dashboard-size] ${snapshot}`)
    }
  }

  const queueDashboardSizing = () => {
    if (dashboardSizingSource) return
    dashboardSizingSource = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      dashboardSizingSource = 0
      syncDashboardSizing()
      return GLib.SOURCE_REMOVE
    })
  }

  const setSectionButtonState = (id: DashboardSectionId, button: Gtk.Button) => {
    button.set_css_classes([
      "dashboard-tab",
      currentSection === id ? "active" : "inactive"
    ])
  }

  const syncSectionButtons = () => {
    sectionButtons.forEach((button, id) => setSectionButtonState(id, button))
  }

  const activateSection = (id: DashboardSectionId) => {
    currentSection = id
    sectionStack?.set_visible_child_name(id)
    syncSectionButtons()
    queueDashboardSizing()
  }

  // Profile summary card
  const profileCard = (
    <box
      class="dashboard-card profile-card profile-hero"
      orientation={Gtk.Orientation.VERTICAL}
      spacing={10}
      valign={Gtk.Align.START}
      height_request={PROFILE_CARD_HEIGHT}
    >
      <label label="Profile" class="card-title" xalign={0} />
      <box class="profile-top" spacing={8}>
        {avatarWrapper}
        <box orientation={Gtk.Orientation.VERTICAL} spacing={1}  valign={Gtk.Align.START}>
          {profileName}
          {profileTitle}
          {profileMeta}
        </box>
      </box>
      {profileStatus}
      {profileBio}
    </box>
  )

  // Disks overview card
  const storageCard = (
    <box class="dashboard-card storage-card" orientation={Gtk.Orientation.VERTICAL} spacing={6} vexpand={false}>
      <box spacing={8} valign={Gtk.Align.CENTER}>
        <label label="Disks" class="card-title" xalign={0} hexpand />
      </box>
      {storageStatus}
      <scrolledwindow 
        onRealize={(self) => {
          storageScroll = self
          queueDashboardSizing()
        }}
        vexpand={false}
        min_content_height={STORAGE_LIST_HEIGHT}
        max_content_height={STORAGE_LIST_HEIGHT}
        height_request={STORAGE_LIST_HEIGHT}
      >
        {storageBox}
      </scrolledwindow>
    </box>
  )

  // Network summary card
  const networkCard = (
    <box class="dashboard-card network-card" orientation={Gtk.Orientation.VERTICAL} spacing={6} height_request={SUMMARY_STRIP_HEIGHT}>
      {netLabel}
      {netSSID}
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6}>
        {netDetail}
        {netGraph}
      </box>
    </box>
  )

  // Uptime/updates card
  const uptimeCard = (
    <box class="dashboard-card status-card" orientation={Gtk.Orientation.VERTICAL} spacing={6} height_request={SUMMARY_STRIP_HEIGHT}>
      {uptimeLabel}
      {uptimeDetail}
      {updatesDetail}
    </box>
  )

  // Media now-playing card
  const mediaCard = (
    <box class="dashboard-card media-card" orientation={Gtk.Orientation.VERTICAL} spacing={6} height_request={SUMMARY_CARD_HEIGHT}>
      {mediaLabel}
      {mediaDetail}
    </box>
  )

  // Calendar widget card
  const calendarCard = (
    <box
      class="dashboard-card calendar-card"
      orientation={Gtk.Orientation.VERTICAL}
      spacing={8}
      height_request={SECTION_STAGE_HEIGHT - 148}
      hexpand={true}
      vexpand={false}
      valign={Gtk.Align.START}
    >
      <label label="Calendar" class="card-title" xalign={0} />
      {calendar}
    </box>
  )

  const POWER_PROFILE_ICONS: Record<string, string> = {
    performance: "󰓅",
    balanced: "󰾆",
    "power-saver": "󰔏"
  }

  const powerCard = (
    <box class="dashboard-card power-card" orientation={Gtk.Orientation.VERTICAL} spacing={8} height_request={POWER_CARD_HEIGHT}>
      <label label="Power Profiles" class="card-title" xalign={0} />
      <box orientation={Gtk.Orientation.VERTICAL} spacing={6}>
        {POWER_PROFILE_ORDER.map((profile) => (
          <button
            class={powerProfileStatus((state) => {
              const isActive = state.active === profile
              const available = state.available.includes(profile)
              return `power-row${isActive ? " active" : ""}${available ? "" : " disabled"}`
            })}
            sensitive={powerProfileStatus((state) => state.available.includes(profile))}
            onClicked={() => setPowerProfile(profile)}
          >
            <box spacing={8} valign={Gtk.Align.CENTER} hexpand={true}>
              <label label={POWER_PROFILE_ICONS[profile] || "󰓅"} class="power-icon" />
              <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand={true}>
                <label label={titleCaseProfile(profile)} class="power-label" xalign={0} />
                <label
                  label={powerProfileStatus((state) => {
                    const detail = state.details[profile]?.[0] || ""
                    return detail || (state.available.includes(profile) ? "Tap to switch" : "Unavailable")
                  })}
                  class="power-hint"
                  xalign={0}
                  ellipsize={Pango.EllipsizeMode.END}
                  max_width_chars={32}
                />
              </box>
              <label
                label={powerProfileStatus((state) => (state.active === profile ? "󰄬" : "󰝦"))}
                class="power-active"
              />
            </box>
          </button>
        ))}
      </box>
      <label
        label={powerProfileStatus((state) => state.error || "")}
        class="dashboard-note"
        xalign={0}
        visible={powerProfileStatus((state) => !!state.error)}
      />
    </box>
  )

  const notificationCard = (
    <box class="dashboard-card notification-card" orientation={Gtk.Orientation.VERTICAL} spacing={8} hexpand={true} vexpand={false} height_request={SECTION_STAGE_HEIGHT}>
      <box class="notification-card-header" spacing={8} valign={Gtk.Align.CENTER}>
        <label label="Notifications" class="card-title" xalign={0} hexpand={true} />
        {notificationClear}
      </box>
      {notificationScroll}
      {notificationEmpty}
    </box>
  )

  const playbackWrapper = (
    <box class="playback-list" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
      <label label="Active Apps" class="mixer-name" xalign={0} />
      {playbackScroll}
    </box>
  )

  const audioMixerSection = (
    <box class="control-section" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <label label="Audio Mixer" class="control-label" xalign={0} />
      <box class="mixer-item" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
        <label label="Output" class="mixer-name" xalign={0} />
        {volumeScale}
        <label label={volumeValueLabel} class="control-value" xalign={1} />
        {playbackWrapper}
      </box>
      <box class="mixer-item" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
        <label label="Microphone" class="mixer-name" xalign={0} />
        {micScale}
        <label label={micValueLabel} class="control-value" xalign={1} />
      </box>
    </box>
  )

  const brightnessSection = (
    <box class="control-section" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
      <label label="Brightness" class="control-label" xalign={0} />
      {brightnessScale}
      <label label={brightnessValueLabel} class="control-value" xalign={1} />
    </box>
  )

  const controlPanel = (
    <box class="control-panel cockpit-controls" orientation={Gtk.Orientation.VERTICAL} spacing={10} vexpand={false}>
      {audioMixerSection}
      {brightnessSection}
    </box>
  )

  // // TODO preview with Obsidian link
  // const todoCard = (
  //   <box class="dashboard-card" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
  //     <label label="Obsidian TODO" class="card-title" xalign={0} />
  //     <scrolledwindow 
  //       vexpand={false}
  //       min_content_height={TODO_LIST_HEIGHT}
  //       max_content_height={TODO_LIST_HEIGHT}
  //       height_request={TODO_LIST_HEIGHT}
  //     >
  //       {todoList}
  //     </scrolledwindow>
  //     <box halign={Gtk.Align.END}>
  //       <button
  //         class="pill-button"
  //         onClicked={() =>
  //           execAsync(`obsidian "${OBSIDIAN_URI}"`).catch(() =>
  //             execAsync(`xdg-open "${TODO_PATH}"`).catch(console.error)
  //           ).finally(() => hideDashboard())
  //         }
  //       >
  //         <label label="Open" />
  //       </button>
  //     </box>
  //   </box>
  // )

  // Running windows list
  const activityCard = (
    <box class="dashboard-card activity-card" orientation={Gtk.Orientation.VERTICAL} spacing={6} hexpand={true} vexpand={false} height_request={SECTION_STAGE_HEIGHT}>
      <label label="Running Windows" class="card-title" xalign={0} />
      <scrolledwindow 
        vexpand={false}
        min_content_height={WINDOWS_LIST_HEIGHT}
        max_content_height={WINDOWS_LIST_HEIGHT}
        height_request={WINDOWS_LIST_HEIGHT}
      >
        {windowsBox}
      </scrolledwindow>
    </box>
  )

  // Close button removed - use ESC or click away to close dashboard

  const metricsCard = (
    <box class="dashboard-card metrics-card" orientation={Gtk.Orientation.VERTICAL} spacing={10} height_request={METRICS_CARD_HEIGHT}>
      <label label="System Load" class="card-title" xalign={0} />
      <box class="gauge-grid" orientation={Gtk.Orientation.VERTICAL} spacing={10} valign={Gtk.Align.START}>
        <box class="gauge-row" orientation={Gtk.Orientation.HORIZONTAL} spacing={10}>
          {cpuGauge.widget}
          {ramGauge.widget}
        </box>
        <box class="gauge-row" orientation={Gtk.Orientation.HORIZONTAL} spacing={10}>
          {gpuGauge.widget}
          {storageGauge.widget}
        </box>
      </box>
    </box>
  )

  const controlsCard = (
    <box class="dashboard-card controls-card" orientation={Gtk.Orientation.VERTICAL} spacing={10} hexpand={true} vexpand={false} height_request={CONTROLS_CARD_HEIGHT}>
      <label label="Mixer & Display" class="card-title" xalign={0} />
      {controlPanel}
    </box>
  )

  const overviewActionsCard = (
    <box class="dashboard-card overview-actions-card" orientation={Gtk.Orientation.VERTICAL} spacing={12} height_request={ACTIONS_CARD_HEIGHT}>
      <label label="Jump To" class="card-title" xalign={0} />
      <label
        label="Swap sections from here or the top tab row. Every view is focused now, so you should not have to scroll the whole dashboard to find one thing."
        class="dashboard-subcopy"
        xalign={0}
        wrap={true}
        wrap_mode={Pango.WrapMode.WORD_CHAR}
        max_width_chars={42}
      />
      <box class="overview-shortcuts" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
        {[["controls", "notifications"], ["windows", "calendar"]].map((row) => (
          <box class="overview-shortcut-row" orientation={Gtk.Orientation.HORIZONTAL} spacing={8} hexpand={true}>
            {row.map((id) => {
              const section = DASHBOARD_SECTIONS.find((entry) => entry.id === id)!
              return (
                <button class="section-shortcut" hexpand={true} onClicked={() => activateSection(section.id)}>
                  <box spacing={8} hexpand={true}>
                    <label label={section.icon} class="section-shortcut-icon" />
                    <label label={section.label} class="section-shortcut-label" xalign={0} />
                  </box>
                </button>
              )
            })}
          </box>
        ))}
      </box>
      <label
        label={powerProfileStatus((state) =>
          state.active === "unknown" ? "Power profile is syncing." : `Current profile: ${titleCaseProfile(state.active)}`
        )}
        class="overview-actions-hint"
        xalign={0}
      />
    </box>
  )

  const calendarSpotlightCard = (
    <box class="dashboard-card calendar-spotlight-card" orientation={Gtk.Orientation.VERTICAL} spacing={12} height_request={SECTION_STAGE_HEIGHT - 148}>
      <label label="Today" class="card-title" xalign={0} />
      <label label={dashboardStamp((value) => value || "Now")} class="calendar-spotlight-time" xalign={0} wrap={true} />
      <label
        label={powerProfileStatus((state) =>
          state.active === "unknown" ? "Power profile syncing" : `System is running in ${titleCaseProfile(state.active)} mode`
        )}
        class="calendar-spotlight-note"
        xalign={0}
        wrap={true}
        wrap_mode={Pango.WrapMode.WORD_CHAR}
      />
      <label
        label="The calendar gets its own view now instead of being crammed into a side rail. Use the top tabs to jump straight to the next thing."
        class="dashboard-subcopy"
        xalign={0}
        wrap={true}
        wrap_mode={Pango.WrapMode.WORD_CHAR}
        max_width_chars={34}
      />
    </box>
  )

  const dashboardHero = (
    <box class="dashboard-hero" spacing={16} hexpand={true} height_request={DASHBOARD_HERO_HEIGHT}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={4} hexpand={true}>
        <label label="Dashboard Deck" class="dashboard-heading" xalign={0} />
        <label
          label="One focused section at a time. Start on Overview, then jump to Controls, Notifications, Windows, or Calendar from the top row without scrolling the whole dashboard."
          class="dashboard-subheading"
          xalign={0}
          wrap={true}
          wrap_mode={Pango.WrapMode.WORD_CHAR}
          max_width_chars={66}
        />
      </box>
      <box
        class="dashboard-badges"
        orientation={Gtk.Orientation.VERTICAL}
        spacing={8}
        halign={Gtk.Align.END}
        width_request={248}
      >
        <label
          label={dashboardStamp((value) => value || "Now")}
          class="dashboard-badge accent"
          xalign={1}
          ellipsize={Pango.EllipsizeMode.END}
          max_width_chars={26}
          width_chars={26}
        />
        <label
          label={powerProfileStatus((state) =>
            state.active === "unknown" ? "Power · Syncing" : `Power · ${titleCaseProfile(state.active)}`
          )}
          class="dashboard-badge"
          xalign={1}
          ellipsize={Pango.EllipsizeMode.END}
          max_width_chars={26}
          width_chars={26}
        />
      </box>
    </box>
  )

  const overviewSummary = (
    <box class="dashboard-section-column overview-summary" orientation={Gtk.Orientation.VERTICAL} spacing={14} hexpand={true}>
      {mediaCard}
      <box class="dashboard-section-row summary-strip" orientation={Gtk.Orientation.HORIZONTAL} spacing={14} hexpand={true}>
        <box class="dashboard-section-cell" hexpand={true}>{uptimeCard}</box>
        <box class="dashboard-section-cell" hexpand={true}>{networkCard}</box>
      </box>
    </box>
  ) as Gtk.Widget

  const overviewSection = (
    <box class="dashboard-section overview-section" 
      orientation={Gtk.Orientation.VERTICAL} 
      spacing={14}
      hexpand={true} 
      vexpand={false}
      height_request={SECTION_STAGE_HEIGHT} >
      <box
        class="dashboard-section-row"
        orientation={Gtk.Orientation.HORIZONTAL}
        spacing={14}
        hexpand={true}
        height_request={OVERVIEW_TOP_ROW_HEIGHT}
      >
        <box class="dashboard-section-cell profile-stage" width_request={372} hexpand={false}>
          {profileCard}
        </box>
        <box class="dashboard-section-cell" hexpand={true}>
          {overviewSummary}
        </box>
      </box>
      <box
        class="dashboard-section-row"
        orientation={Gtk.Orientation.HORIZONTAL}
        spacing={14}
        hexpand={true}
        vexpand={false}
        height_request={OVERVIEW_BOTTOM_ROW_HEIGHT}
      >
        <box class="dashboard-section-cell metrics-stage" width_request={430} hexpand={false}>
          {metricsCard}
        </box>
        <box class="dashboard-section-cell" hexpand={true}>
          {overviewActionsCard}
        </box>
      </box>
    </box>
  ) as Gtk.Widget

  const controlsSectionContent = (
    <box
      class="dashboard-section controls-section"
      orientation={Gtk.Orientation.VERTICAL}
      spacing={14}
      hexpand={true}
      vexpand={false}
    >
      <box
        class="dashboard-section-row"
        orientation={Gtk.Orientation.HORIZONTAL}
        spacing={14}
        hexpand={true}
        height_request={CONTROLS_TOP_ROW_HEIGHT}
      >
        <box class="dashboard-section-cell controls-stage" hexpand={true}>
          {controlsCard}
        </box>
        <box class="dashboard-section-cell power-stage" width_request={386} hexpand={false}>
          {powerCard}
        </box>
      </box>
      <box
        class="dashboard-section-row"
        orientation={Gtk.Orientation.HORIZONTAL}
        spacing={14}
        hexpand={true}
      >
        <box class="dashboard-section-cell" hexpand={true}>
          {storageCard}
        </box>
      </box>
    </box>
  ) as Gtk.Widget

  const controlsSection = (
    <scrolledwindow
      class="controls-section-scroll"
      hscrollbar_policy={Gtk.PolicyType.NEVER}
      vscrollbar_policy={Gtk.PolicyType.AUTOMATIC}
      min_content_height={SECTION_STAGE_HEIGHT}
      max_content_height={SECTION_STAGE_HEIGHT}
      height_request={SECTION_STAGE_HEIGHT}
      onRealize={() => queueDashboardSizing()}
    >
      {controlsSectionContent}
    </scrolledwindow>
  ) as Gtk.Widget

  const notificationsSection = (
    <box
      class="dashboard-section focused-section"
      orientation={Gtk.Orientation.VERTICAL}
      spacing={14}
      hexpand={true}
      vexpand={false}
    >
      {notificationCard}
    </box>
  ) as Gtk.Widget

  const windowsSection = (
    <box
      class="dashboard-section focused-section"
      orientation={Gtk.Orientation.VERTICAL}
      spacing={14}
      hexpand={true}
      vexpand={false}
    >
      {activityCard}
    </box>
  ) as Gtk.Widget

  const calendarSection = (
    <box
      class="dashboard-section calendar-section"
      orientation={Gtk.Orientation.HORIZONTAL}
      spacing={14}
      hexpand={true}
      vexpand={false}
    >
      <box class="dashboard-section-cell calendar-stage" hexpand={true}>
        {calendarCard}
      </box>
      <box class="dashboard-section-cell calendar-side-stage" width_request={340} hexpand={false}>
        {calendarSpotlightCard}
      </box>
    </box>
  ) as Gtk.Widget

  sectionStack = new Gtk.Stack({
    transition_type: Gtk.StackTransitionType.NONE,
    transition_duration: 0
  })
  sectionStack.set_hexpand(true)
  sectionStack.set_vexpand(false)
  sectionStack.set_hhomogeneous(true)
  sectionStack.set_vhomogeneous(true)
  // Keep the stack on a fixed footprint during transitions.
  if ("set_interpolate_size" in sectionStack) {
    // @ts-expect-error gtk4 stack API
    sectionStack.set_interpolate_size(false)
  }
  sectionStack.set_size_request(-1, SECTION_STAGE_HEIGHT)
  sectionStack.add_named(overviewSection, "overview")
  sectionStack.add_named(controlsSection, "controls")
  sectionStack.add_named(notificationsSection, "notifications")
  sectionStack.add_named(windowsSection, "windows")
  sectionStack.add_named(calendarSection, "calendar")
  sectionStack.set_visible_child_name(DASHBOARD_DEFAULT_SECTION)

  const dashboardTabs = (
    <box
      class="dashboard-tabs"
      orientation={Gtk.Orientation.HORIZONTAL}
      spacing={10}
      hexpand={true}
      homogeneous={true}
      height_request={DASHBOARD_TABS_HEIGHT}
    >
      {DASHBOARD_SECTIONS.map((section) => (
        <button
          class="dashboard-tab"
          hexpand={true}
          onClicked={() => activateSection(section.id)}
          onRealize={(self) => {
            sectionButtons.set(section.id, self)
            setSectionButtonState(section.id, self)
          }}
        >
          <box spacing={8} halign={Gtk.Align.CENTER}>
            <label label={section.icon} class="dashboard-tab-icon" />
            <label label={section.label} class="dashboard-tab-label" />
          </box>
        </button>
      ))}
    </box>
  ) as Gtk.Widget

  const sectionStage = (
    <box
      class="dashboard-stage"
      orientation={Gtk.Orientation.VERTICAL}
      hexpand={true}
      vexpand={false}
      height_request={SECTION_STAGE_HEIGHT}
    >
      {sectionStack}
    </box>
  ) as Gtk.Widget

  // Main surface containing columns
  const surface = (
    <box
      class="dashboard-surface"
      orientation={Gtk.Orientation.VERTICAL}
      spacing={14}
      width_request={MODAL_WIDTH - 120}
      height_request={DASHBOARD_SURFACE_HEIGHT}
      hexpand={false}
      vexpand={false}
      halign={Gtk.Align.END}
      valign={Gtk.Align.START}
    >
      {dashboardHero}
      {dashboardTabs}
      {sectionStage}
    </box>
  )

  const overlay = (
    <box
      class="dashboard-overlay"
      hexpand={true}
      vexpand={false}
      halign={Gtk.Align.FILL}
      valign={Gtk.Align.FILL}
    >
      <box
        class="dashboard-frame"
        orientation={Gtk.Orientation.HORIZONTAL}
        height_request={DASHBOARD_SURFACE_HEIGHT}
        hexpand={true}
        vexpand={false}
        halign={Gtk.Align.END}
        valign={Gtk.Align.START}
      >
        <box
          class="dashboard-shell"
          orientation={Gtk.Orientation.VERTICAL}
          height_request={DASHBOARD_SURFACE_HEIGHT}
          hexpand={false}
          vexpand={false}
          halign={Gtk.Align.END}
          valign={Gtk.Align.START}
        >
          {surface}
        </box>
      </box>
    </box>
  ) as Gtk.Widget

  // The actual dashboard window
  const win = (
    <window
      name="dashboard"
      class="dashboard"
      gdkmonitor={gdkmonitor}
      anchor={TOP | LEFT | RIGHT | BOTTOM}
      application={app}
      visible={false}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.ON_DEMAND}
      onRealize={(self) => {
        try {
          self.set_focusable(true)
          if ("set_focus_on_map" in self) {
            // @ts-expect-error gtk4 types
            self.set_focus_on_map(true)
          }
        } catch (err) {
          console.error("Dashboard focus setup failed:", err)
        }

        const keyController = new Gtk.EventControllerKey()
        keyController.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        keyController.connect("key-pressed", (_controller, keyval) => {
          if (keyval === Gdk.KEY_Escape) {
            hideDashboard()
            return Gdk.EVENT_STOP
          }
          return Gdk.EVENT_PROPAGATE
        })
        self.add_controller(keyController)

        timeout(30000, () => {
          if (self.visible) {
            void refreshDashboard().catch((err) => console.error("Timed dashboard refresh failed:", err))
          }
          return true
        })
      }}
    >
      {overlay}
    </window>
  ) as Astal.Window

  win.connect("notify::visible", () => {
    if (win.visible) {
      activateSection(DASHBOARD_DEFAULT_SECTION)
      try {
        win.grab_focus()
      } catch (err) {
        console.error("Dashboard present failed:", err)
      }

      void refreshDashboard().catch((err) => console.error("Visible dashboard refresh failed:", err))
    }
  })

  stopNotificationsListener = onNotificationUpdate(() => {
    if (!win.visible) return
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      refreshNotifications()
      return GLib.SOURCE_REMOVE
    })
  })

  win.connect("destroy", () => stopNotificationsListener())

  // Expose refresh + show/hide hooks to the rest of the app
  registerDashboard(win)
  applyProfile(loadProfile())
  refreshNotifications()

  return win
}
