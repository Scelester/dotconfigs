import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import { execAsync, subprocess } from "ags/process"
import { createPoll } from "ags/time"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Pango from "gi://Pango"
import { hideDashboard, registerDashboard } from "./dashboardState"
import { resolveWindowIcon } from "./iconResolver"

type Profile = {
  name: string
  title: string
  location: string
  status: string
  email: string
  handles?: Record<string, string>
  bio?: string
}

type WindowInfo = {
  title: string
  app: string
  workspace: string | number
  pid: number
  lastFocus: number
  address: string
}

type NotificationEntry = {
  id: number
  app: string
  summary: string
  body: string
  timestamp: number
}

type NotificationThread = {
  app: string
  summary: string
  items: NotificationEntry[]
  latestTimestamp: number
}

type PlaybackItem = {
  id: number
  name: string
  volume: number
  muted: boolean
}

type PowerProfileState = {
  active: string
  available: string[]
  details: Record<string, string[]>
  error?: string
}

type DiskVolume = {
  mount: string
  fstype: string
  used: number
  size: number
  pct: number
}

type Gauge = {
  widget: Gtk.Widget
  update: (percent: number, detail?: string) => void
}

type ClockState = {
  time: string
  day: string
  stamp: string
  dateLong: string
}

const PROFILE_PATH = GLib.build_filenamev([
  GLib.get_home_dir(),
  ".config",
  "ags",
  "data",
  "profile.json"
])
const FACE_PATH = GLib.build_filenamev([GLib.get_home_dir(), ".face"])
const NOTIFICATION_STORE_PATH = GLib.build_filenamev([
  GLib.get_home_dir(),
  ".config",
  "ags",
  "data",
  "notifications.json"
])

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

const fallbackWindows: WindowInfo[] = [
  {
    title: "No windows detected",
    app: "hyprctl",
    workspace: "-",
    pid: 0,
    lastFocus: 0,
    address: ""
  }
]

const MODAL_WIDTH = 1572
const MODAL_HEIGHT = 970
const PROFILE_CARD_HEIGHT = 316
const POWER_CARD_HEIGHT = 176
const UTILITY_CARD_HEIGHT = 236
const METRICS_CARD_HEIGHT = 292
const CONTROLS_CARD_HEIGHT = 272
const STORAGE_CARD_HEIGHT = 118
const NOTIFICATION_CARD_HEIGHT = 932
const COLUMN_GAP = 14
const LEFT_COLUMN_WIDTH = 322
const RIGHT_COLUMN_WIDTH = 530
const CENTER_COLUMN_WIDTH = MODAL_WIDTH - LEFT_COLUMN_WIDTH - RIGHT_COLUMN_WIDTH - COLUMN_GAP * 2 - 32
const NOTIFICATION_LIST_HEIGHT = 866
const STORAGE_LIST_HEIGHT = 54
const PLAYBACK_LIST_HEIGHT = 118
const GAUGE_SIZE = 76
const MAX_NET_SAMPLES = 64
const STORAGE_EXCLUDED = ["tmpfs", "devtmpfs", "overlay", "squashfs"]
const STORAGE_WHITELIST = ["/", "/home", "/home/scelester/Container"]
const NOTIFICATION_HISTORY_LIMIT = 500
const POWER_PROFILE_ORDER = ["performance", "balanced", "power-saver"] as const
const DASHBOARD_OPEN_DURATION_MS = 260
const DASHBOARD_CLOSE_DURATION_MS = 220
const DASHBOARD_LIVE_REFRESH_MS = 2400
const WIFI_CACHE_MS = 12000
const UPTIME_CACHE_MS = 60000
const UPDATES_CACHE_MS = 15 * 60 * 1000
const MEDIA_CACHE_MS = 2500
const GPU_CACHE_MS = 5000

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

const decodeBuffer = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

const readTextFile = (path: string) => {
  try {
    const [ok, data] = GLib.file_get_contents(path)
    if (ok && data) return decodeBuffer(data)
  } catch {}

  return ""
}

const safePoll = <T,>(init: T, interval: number, fn: (prev: T) => T | Promise<T>) =>
  createPoll(init, interval, (prev) =>
    Promise.resolve()
      .then(() => fn(prev))
      .catch((err) => {
        console.error("Dashboard poll failed:", err)
        return prev
      })
  )

const titleCaseProfile = (name: string) =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")

const formatTimeShort = (ts: number) => {
  if (!Number.isFinite(ts)) return "--:--"
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

const notificationThreadKey = (entry: Pick<NotificationEntry, "app" | "summary">) =>
  `${entry.app.trim().toLowerCase()}::${entry.summary.trim().toLowerCase()}`

const groupNotifications = (items: NotificationEntry[]): NotificationThread[] => {
  const groups = new Map<string, NotificationThread>()

  items.forEach((item) => {
    const key = notificationThreadKey(item)
    const existing = groups.get(key)

    if (existing) {
      existing.items.push(item)
      return
    }

    groups.set(key, {
      app: item.app,
      summary: item.summary || "(no title)",
      items: [item],
      latestTimestamp: item.timestamp
    })
  })

  return Array.from(groups.values())
}

const formatBytes = (bytes: number) => {
  const value = Math.max(0, bytes)
  if (value >= 1024 ** 4) return `${(value / 1024 ** 4).toFixed(1)} TiB`
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${value.toFixed(0)} B`
}

const formatSpeed = (bps: number) => {
  const abs = Math.max(0, bps)
  if (abs >= 1024 ** 3) return `${(abs / 1024 ** 3).toFixed(2)} GiB/s`
  if (abs >= 1024 ** 2) return `${(abs / 1024 ** 2).toFixed(2)} MiB/s`
  if (abs >= 1024) return `${(abs / 1024).toFixed(1)} KiB/s`
  return `${abs.toFixed(0)} B/s`
}

const formatUptimeSeconds = (totalSeconds: number) => {
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  if (days > 0) return `up ${days}d ${hours}h`
  if (hours > 0) return `up ${hours}h ${minutes}m`
  return `up ${minutes}m`
}

const setLabelIfChanged = (label: Gtk.Label, value: string) => {
  if (label.label === value) return
  label.label = value
}

const runDashboardCommand = (command: string, hideAfter = true) => {
  if (hideAfter) hideDashboard()
  execAsync(command).catch((err) => console.error(`Dashboard command failed: ${command}`, err))
}

const TOGGLE_NIGHT_LIGHT_COMMAND =
  "sh -lc 'if pgrep -x gammastep >/dev/null; then pkill -x gammastep; elif command -v gammastep >/dev/null; then gammastep -O 4500 >/dev/null 2>&1 & disown; else exit 1; fi'"

const TOGGLE_KEYBOARD_BACKLIGHT_COMMAND =
  "sh -lc 'if [ -x /usr/bin/toggle-laptop-kb ]; then /usr/bin/toggle-laptop-kb; else exit 1; fi'"

const notificationHistory: NotificationEntry[] = []
const notificationListeners = new Set<() => void>()
let notificationWatcherStarted = false
let notificationStoreLoaded = false
let lastNotificationId = 0
const uptimeCache = { value: "up 0m", timestamp: 0 }
const updatesCache = { value: "Updates: n/a", timestamp: 0 }
const mediaCache = { value: "No media", timestamp: 0 }
const wifiCache = { value: "", timestamp: 0 }
const gpuCache = {
  value: { pct: 0, detail: "GPU N/A" },
  timestamp: 0
}

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
      .map((entry: any) => {
        const timestamp = typeof entry.timestamp === "number" ? entry.timestamp : Date.now()
        let id = typeof entry.id === "number" ? entry.id : nextNotificationId()
        if (seenIds.has(id)) id = nextNotificationId()
        seenIds.add(id)
        lastNotificationId = Math.max(lastNotificationId, id)

        return {
          id,
          app: typeof entry.app === "string" && entry.app.length ? entry.app : "Notification",
          summary:
            typeof entry.summary === "string" && entry.summary.length
              ? entry.summary
              : "(no title)",
          body: typeof entry.body === "string" ? entry.body : "",
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
        if (
          line.startsWith("method call") ||
          line.startsWith("method return") ||
          line.startsWith("error")
        ) {
          capture = null
          return
        }

        if (line.startsWith("string ")) {
          const match = line.match(/string \"(.*)\"/)
          if (match) capture.push(match[1])
        }

        if (capture.length >= 4) {
          const [appName, _icon, summary, body] = capture
          pushNotification({
            app: appName || "Notification",
            summary: summary || "(no title)",
            body: body || "",
            timestamp: Date.now()
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

const clockState = safePoll<ClockState>(
  { time: "--:--", day: "Today", stamp: "Now", dateLong: "" },
  60000,
  async () => {
    try {
      return {
        time: (await execAsync("date +'%H:%M'")).trim(),
        day: (await execAsync("date +'%A'")).trim(),
        stamp: (await execAsync("date +'%A · %d %b · %H:%M'")).trim(),
        dateLong: (await execAsync("date +'%d %B %Y'")).trim()
      }
    } catch {
      const now = new Date()
      return {
        time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        day: now.toLocaleDateString([], { weekday: "long" }),
        stamp: "Now",
        dateLong: now.toLocaleDateString([], {
          day: "2-digit",
          month: "long",
          year: "numeric"
        })
      }
    }
  }
)

const loadProfile = (): Profile => {
  try {
    const file = Gio.File.new_for_path(PROFILE_PATH)
    const [ok, contents] = file.load_contents(null)
    if (ok && contents) return JSON.parse(decodeBuffer(contents))
  } catch (err) {
    console.error("Dashboard profile read failed:", err)
  }

  return fallbackProfile
}

const fetchWindows = async (): Promise<WindowInfo[]> => {
  try {
    const raw = await execAsync("hyprctl clients -j")
    const parsed = JSON.parse(raw)

    const cleaned: WindowInfo[] = parsed.map((client: any) => ({
      title: client.title || client.initialTitle || "Untitled",
      app: client.class || client.app || client.initialClass || "App",
      workspace: client.workspace?.id ?? client.workspace?.name ?? "?",
      pid: client.pid ?? 0,
      lastFocus: client.focusHistoryID ?? client.last_focus_time ?? client.at ?? Date.now(),
      address: typeof client.address === "string" ? client.address : ""
    }))

    return cleaned.sort((a, b) => b.lastFocus - a.lastFocus).slice(0, 14)
  } catch (err) {
    console.error("Dashboard windows fetch failed:", err)
    return fallbackWindows
  }
}

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

  items.forEach((item, index) => box.append(render(item, index)))
}

export default function Dashboard(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT, BOTTOM } = Astal.WindowAnchor
  const monitorGeometry = gdkmonitor.get_geometry()
  const surfaceX = Math.max(0, Math.floor((monitorGeometry.width - MODAL_WIDTH) / 2))
  const surfaceY = 18

  loadNotificationHistory()
  startNotificationWatcher()

  const profileName = new Gtk.Label({
    css_classes: ["profile-name"],
    xalign: 0,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 22
  })
  const profileTitle = new Gtk.Label({
    css_classes: ["profile-title"],
    xalign: 0,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 26
  })
  const profileMeta = new Gtk.Label({
    css_classes: ["profile-meta"],
    xalign: 0,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 34
  })
  const profileStatus = new Gtk.Label({
    css_classes: ["profile-status"],
    xalign: 0,
    wrap: true,
    wrap_mode: Pango.WrapMode.WORD_CHAR
  })
  const profileBio = new Gtk.Label({
    css_classes: ["profile-bio"],
    xalign: 0,
    wrap: true,
    wrap_mode: Pango.WrapMode.WORD_CHAR,
    max_width_chars: 40
  })
  const avatarInitial = new Gtk.Label({
    label: "S",
    css_classes: ["profile-avatar-initial"]
  })
  const avatarWrapper = new Gtk.Box({
    css_classes: ["profile-avatar"],
    halign: Gtk.Align.START,
    valign: Gtk.Align.CENTER
  })
  avatarWrapper.set_size_request(92, 92)

  if (GLib.file_test(FACE_PATH, GLib.FileTest.EXISTS)) {
    const img = Gtk.Image.new_from_file(FACE_PATH)
    img.set_pixel_size(68)
    img.add_css_class("profile-avatar-img")
    avatarWrapper.append(img)
  } else {
    avatarWrapper.append(avatarInitial)
  }

  const windowsBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    css_classes: ["dashboard-list"]
  })
  const storageBox = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 8,
    homogeneous: true,
    hexpand: true,
    css_classes: ["dashboard-list", "storage-strip"]
  })
  const playbackBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 8,
    css_classes: ["dashboard-list"]
  })
  const notificationBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 8,
    css_classes: ["dashboard-list", "notification-list"]
  })

  const notificationCount = new Gtk.Label({
    label: "0 items",
    css_classes: ["card-kicker"],
    xalign: 1,
    halign: Gtk.Align.END
  })
  const storageSummary = new Gtk.Label({
    label: "Mounts",
    css_classes: ["card-kicker"],
    xalign: 1,
    halign: Gtk.Align.END
  })
  const notificationClear = new Gtk.Button({
    label: "Clear All",
    css_classes: ["pill-button", "notification-clear"],
    halign: Gtk.Align.END
  })
  notificationClear.connect("clicked", () => clearNotificationHistory())

  const notificationScroll = new Gtk.ScrolledWindow({
    vexpand: false,
    min_content_height: NOTIFICATION_LIST_HEIGHT,
    max_content_height: NOTIFICATION_LIST_HEIGHT,
    height_request: NOTIFICATION_LIST_HEIGHT,
    hscrollbar_policy: Gtk.PolicyType.NEVER,
    vscrollbar_policy: Gtk.PolicyType.AUTOMATIC
  })
  notificationScroll.set_child(notificationBox)

  const storageScroll = new Gtk.ScrolledWindow({
    vexpand: false,
    min_content_height: STORAGE_LIST_HEIGHT,
    max_content_height: STORAGE_LIST_HEIGHT,
    height_request: STORAGE_LIST_HEIGHT,
    hscrollbar_policy: Gtk.PolicyType.NEVER,
    vscrollbar_policy: Gtk.PolicyType.NEVER
  })
  storageScroll.set_child(storageBox)

  const playbackScroll = new Gtk.ScrolledWindow({
    vexpand: false,
    min_content_height: PLAYBACK_LIST_HEIGHT,
    max_content_height: PLAYBACK_LIST_HEIGHT,
    height_request: PLAYBACK_LIST_HEIGHT,
    hscrollbar_policy: Gtk.PolicyType.NEVER,
    vscrollbar_policy: Gtk.PolicyType.AUTOMATIC
  })
  playbackScroll.set_child(playbackBox)

  const netSSID = new Gtk.Label({
    label: "WiFi unavailable",
    css_classes: ["insight-value", "network-name"],
    xalign: 0,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 28
  })
  const netDetail = new Gtk.Label({
    label: "Down 0 B/s · Up 0 B/s",
    css_classes: ["dashboard-note", "network-detail"],
    xalign: 0
  })
  const uptimeValue = new Gtk.Label({
    label: "—",
    css_classes: ["insight-value"],
    xalign: 0
  })
  const updatesValue = new Gtk.Label({
    label: "Updates: —",
    css_classes: ["insight-value"],
    xalign: 0
  })
  const mediaValue = new Gtk.Label({
    label: "No media",
    css_classes: ["insight-value"],
    xalign: 0,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 36
  })
  const cpuMetaValue = new Gtk.Label({ label: "—", css_classes: ["insight-value"], xalign: 0 })
  const ramMetaValue = new Gtk.Label({ label: "—", css_classes: ["insight-value"], xalign: 0 })
  const gpuMetaValue = new Gtk.Label({
    label: "—",
    css_classes: ["insight-value"],
    xalign: 0,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 24
  })
  const storageMetaValue = new Gtk.Label({
    label: "—",
    css_classes: ["insight-value"],
    xalign: 0,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 28
  })

  const netHistoryDown: number[] = []
  const netHistoryUp: number[] = []
  const netGraph = new Gtk.DrawingArea({
    width_request: 300,
    height_request: 62,
    css_classes: ["network-graph"]
  })
  netGraph.set_draw_func((_area, cr, width, height) => {
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

    cr.setLineWidth(1)
    cr.setSourceRGBA(0.9, 0.93, 0.98, 0.07)
    for (let i = 0; i < 3; i++) {
      const y = pad + (i / 2) * h
      cr.moveTo(pad, y)
      cr.lineTo(pad + w, y)
      cr.stroke()
    }

    const drawCurve = (arr: number[], color: [number, number, number], fill = false) => {
      cr.setLineWidth(1.7)
      const [r, g, b] = color
      const step = w / Math.max(1, samples - 1)
      if (fill) cr.moveTo(pad, pad + h)
      arr.forEach((value, index) => {
        const x = pad + index * step
        const y = pad + h - (Math.max(0, value) / maxVal) * h
        cr.lineTo(x, y)
      })
      if (fill) {
        cr.lineTo(pad + w, pad + h)
        cr.closePath()
        cr.setSourceRGBA(r, g, b, 0.13)
        cr.fillPreserve()
      }
      cr.setSourceRGBA(r, g, b, 0.95)
      cr.stroke()
    }

    drawCurve(down, [0.23, 0.71, 0.95], true)
    drawCurve(up, [0.89, 0.62, 0.32], false)
  })

  const volumeStatus = safePoll(
    { volume: 100, isMuted: false },
    1200,
    async () => {
      try {
        const volume = clampPercent(parseInt((await execAsync("pamixer --get-volume")).trim(), 10))
        const isMuted = (await execAsync("pamixer --get-mute")).trim() === "true"
        return { volume, isMuted }
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
        const volume = clampPercent(
          parseInt((await execAsync("pamixer --default-source --get-volume")).trim(), 10)
        )
        const isMuted =
          (await execAsync("pamixer --default-source --get-mute")).trim() === "true"
        return { volume, isMuted }
      } catch {
        return { volume: 100, isMuted: false }
      }
    }
  )

  const brightnessStatus = safePoll(100, 1500, async () => {
    try {
      const bright = parseInt(await execAsync("brightnessctl g"), 10)
      const max = parseInt(await execAsync("brightnessctl m"), 10)
      return clampPercent((bright / max) * 100)
    } catch {
      return 100
    }
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

          if (!current || !trimmed.includes(":")) continue
          details[current]?.push(trimmed.replace(/\s+/g, " "))
        }

        if (!available.length) {
          return { active: "unknown", available, details, error: "No power profiles detected" }
        }

        return {
          active: active === "unknown" ? available[0] : active,
          available,
          details,
          error: ""
        }
      } catch (err) {
        console.error("Power profiles read failed:", err)
        return {
          active: "unknown",
          available: [],
          details: {},
          error: "powerprofilesctl unavailable"
        }
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
    execAsync(`pamixer --set-volume ${clampPercent(scale.get_value())}`).catch(console.error)
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
    execAsync(
      `pamixer --default-source --set-volume ${clampPercent(scale.get_value())}`
    ).catch(console.error)
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
    css_classes: ["control-slider", "brightness-slider"]
  })
  brightnessScale.connect("value-changed", (scale) => {
    if (brightnessSync) return
    execAsync(`brightnessctl set ${clampPercent(scale.get_value())}%`).catch(console.error)
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

  const makeGauge = (title: string, colorClass: string): Gauge => {
    let percent = 0
    const percentLabel = new Gtk.Label({ label: "0%", css_classes: ["gauge-percent"] })
    const detailLabel = new Gtk.Label({
      label: "",
      css_classes: ["gauge-detail"],
      ellipsize: Pango.EllipsizeMode.END,
      xalign: 0.5,
      width_chars: 14,
      max_width_chars: 14
    })
    detailLabel.set_size_request(96, 16)

    const area = new Gtk.DrawingArea({
      width_request: GAUGE_SIZE,
      height_request: GAUGE_SIZE,
      css_classes: ["gauge-area", colorClass]
    })

    const getColorForClass = (cssClass: string, intensity: number) => {
      const alpha = Math.max(0.42, intensity / 100)
      switch (cssClass) {
        case "gauge-cyan":
          return [0.23, 0.71, 0.95, alpha]
        case "gauge-green":
          return [0.42, 0.78, 0.58, alpha]
        case "gauge-orange":
          return [0.89, 0.62, 0.32, alpha]
        case "gauge-purple":
          return [0.69, 0.56, 0.88, alpha]
        default:
          return [0.56, 0.76, 0.92, alpha]
      }
    }

    area.set_draw_func((_a, cr, width, height) => {
      const radius = Math.min(width, height) / 2 - 7
      const cx = width / 2
      const cy = height / 2
      const pct = clampPercent(percent)
      const angle = (pct / 100) * Math.PI * 2

      cr.setSourceRGBA(0.07, 0.1, 0.16, 0.36)
      cr.setLineWidth(8)
      cr.arc(cx, cy, radius, 0, Math.PI * 2)
      cr.stroke()

      const [r, g, b, a] = getColorForClass(colorClass, pct)
      cr.setSourceRGBA(r, g, b, a)
      cr.setLineWidth(9)
      cr.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + angle)
      cr.stroke()

      if (pct > 12) {
        cr.setSourceRGBA(r, g, b, a * 0.22)
        cr.setLineWidth(15)
        cr.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + angle)
        cr.stroke()
      }
    })

    const update = (pct: number, detail?: string) => {
      percent = clampPercent(pct)
      percentLabel.label = `${percent}%`
      detailLabel.label = detail || ""
      area.queue_draw()
    }

    const box = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 5,
      halign: Gtk.Align.CENTER,
      css_classes: ["gauge-card"]
    })
    box.append(new Gtk.Label({ label: title, css_classes: ["gauge-title"] }))
    box.append(area)
    box.append(percentLabel)
    box.append(detailLabel)

    return { widget: box, update }
  }

  const cpuGauge = makeGauge("CPU", "gauge-cyan")
  const ramGauge = makeGauge("RAM", "gauge-green")
  const gpuGauge = makeGauge("GPU", "gauge-orange")
  const storageGauge = makeGauge("Disk", "gauge-purple")

  const applyProfile = (profile: Profile) => {
    profileName.label = profile.name
    profileTitle.label = profile.title
    profileMeta.label = `${profile.location} • ${profile.email}`
    profileStatus.label = profile.status

    const handles = profile.handles
      ? Object.entries(profile.handles)
          .map(([key, value]) => `${key}: ${value}`)
          .join(" / ")
      : ""

    profileBio.label = profile.bio ? `${profile.bio}${handles ? ` • ${handles}` : ""}` : handles
    avatarInitial.label = profile.name?.slice(0, 1).toUpperCase() || "S"
  }

  const renderStorageList = (volumes: DiskVolume[]) => {
    renderList(storageBox, volumes, (volume) => {
      const row = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 10,
        hexpand: true,
        valign: Gtk.Align.CENTER,
        css_classes: ["dashboard-list-row", "storage-row"]
      })

      const iconWrap = new Gtk.Box({
        css_classes: ["storage-icon-wrap"],
        valign: Gtk.Align.CENTER
      })
      iconWrap.append(
        new Gtk.Image({
          icon_name: volume.mount === "/" ? "drive-harddisk-system-symbolic" : "drive-harddisk-symbolic",
          pixel_size: 16,
          css_classes: ["storage-icon"]
        })
      )

      const meta = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 1,
        hexpand: true,
        valign: Gtk.Align.CENTER
      })
      const mount = new Gtk.Label({
        label: prettyMount(volume.mount),
        xalign: 0,
        hexpand: true,
        ellipsize: Pango.EllipsizeMode.END,
        max_width_chars: 10,
        css_classes: ["storage-mount"]
      })
      const usage = new Gtk.Label({
        label: `${formatBytes(volume.used)} / ${formatBytes(volume.size)}`,
        xalign: 0,
        ellipsize: Pango.EllipsizeMode.END,
        max_width_chars: 18,
        css_classes: ["storage-usage"]
      })
      const pct = new Gtk.Label({
        label: `${volume.pct}%`,
        xalign: 1,
        halign: Gtk.Align.END,
        css_classes: ["storage-pct"]
      })

      meta.append(mount)
      meta.append(usage)

      row.append(iconWrap)
      row.append(meta)
      row.append(pct)
      return row
    })
  }

  const readPlaybackStreams = async (): Promise<PlaybackItem[]> => {
    try {
      const out = await execAsync("pactl -f json list sink-inputs")
      const parsed = JSON.parse(out)
      if (!Array.isArray(parsed)) throw new Error("Unexpected pactl json")

      return parsed
        .map((entry: any) => {
          const id =
            typeof entry.index === "number" ? entry.index : parseInt(String(entry.index), 10)
          if (!Number.isFinite(id)) return null

          const props = entry.properties || {}
          const name =
            props["application.name"] ||
            props["media.name"] ||
            props["application.process.binary"] ||
            `App ${id}`

          const channelPercents = Object.values(entry.volume || {})
            .map((value: any) => {
              if (!value || typeof value === "number") return null
              if (typeof value === "string") {
                const match = value.match(/(\d+)%/)
                return match ? parseInt(match[1], 10) : null
              }
              if (typeof value === "object" && typeof value.value_percent === "string") {
                const match = value.value_percent.match(/(\d+)%/)
                return match ? parseInt(match[1], 10) : null
              }
              if (typeof value === "object" && typeof value.value_percent === "number") {
                return value.value_percent
              }
              return null
            })
            .filter((n) => typeof n === "number") as number[]

          const volume = channelPercents.length
            ? clampPercent(channelPercents.reduce((a, b) => a + b, 0) / channelPercents.length)
            : 0

          return {
            id,
            name: String(name).trim() || `App ${id}`,
            volume,
            muted: Boolean(entry.mute ?? entry.muted ?? false)
          }
        })
        .filter((item: PlaybackItem | null): item is PlaybackItem => Boolean(item))
    } catch {}

    try {
      const out = await execAsync("pactl list sink-inputs")
      return out
        .split(/Sink Input #/)
        .slice(1)
        .map((block) => {
          const lines = block.split("\n")
          const id = parseInt(lines[0]?.trim() || "", 10)
          if (!Number.isFinite(id)) return null

          const nameLine =
            lines.find((line) => line.includes("application.name")) ||
            lines.find((line) => line.includes("media.name")) ||
            lines.find((line) => line.includes("application.process.binary"))
          const name = nameLine?.match(/=\s*\"(.+)\"/)?.[1] || `App ${id}`
          const muted = lines.find((line) => line.trim().startsWith("Mute:"))?.includes("yes") || false
          const volume = clampPercent(
            parseInt(lines.find((line) => line.trim().startsWith("Volume:"))?.match(/(\d+)%/)?.[1] || "0", 10)
          )

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
          label: "No active app streams",
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
        css_classes: ["mixer-item", "playback-item"]
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
        css_classes: ["control-value", "inline-value"]
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
        execAsync(`pactl set-sink-input-volume ${item.id} ${clampPercent(widget.get_value())}%`).catch(
          console.error
        )
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
        ? items.map((item) => `${item.id}:${item.volume}:${item.muted}:${item.name}`).join("|")
        : "empty"
      if (key === lastPlaybackKey) return
      lastPlaybackKey = key
      renderPlaybackList(items)
    } catch (err) {
      console.error("Playback refresh failed:", err)
    }
  }

  let lastCpu = { idle: 0, total: 0 }
  const readCpuUsage = async () => {
    try {
      const statLine = readTextFile("/proc/stat")
        .split("\n")
        .find((line) => line.startsWith("cpu "))
      if (!statLine) return 0

      const parts = statLine.trim().split(/\s+/).slice(1).map((n) => parseInt(n, 10))
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

  const readRamUsage = async () => {
    try {
      const meminfo = readTextFile("/proc/meminfo")
      const total = parseInt(meminfo.match(/^MemTotal:\s+(\d+)/m)?.[1] || "0", 10)
      const available = parseInt(meminfo.match(/^MemAvailable:\s+(\d+)/m)?.[1] || "0", 10)
      const used = Math.max(0, total - available)
      if (!total || Number.isNaN(total)) return { pct: 0, used: 0, total: 0 }
      return {
        pct: clampPercent((used / total) * 100),
        used: Number.isNaN(used) ? 0 : used,
        total
      }
    } catch (err) {
      console.error("RAM read failed:", err)
      return { pct: 0, used: 0, total: 0 }
    }
  }

  const readStorageAll = async (): Promise<{ totalPct: number; volumes: DiskVolume[] }> => {
    try {
      const out = await execAsync(
        "df -B1 --output=target,fstype,size,used -x tmpfs -x devtmpfs -x overlay -x squashfs"
      )
      const lines = out
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean)

      const volumes: DiskVolume[] = []
      for (const line of lines) {
        const parts = line.split(/\s+/)
        if (parts.length < 4) continue
        const [mount, fstype, sizeStr, usedStr] = parts
        if (!mount || !fstype || STORAGE_EXCLUDED.includes(fstype)) continue

        const size = parseInt(sizeStr, 10) || 0
        const used = parseInt(usedStr, 10) || 0
        if (!size) continue
        volumes.push({
          mount,
          fstype,
          used,
          size,
          pct: clampPercent((used / size) * 100)
        })
      }

      const filtered = volumes.filter((volume) => STORAGE_WHITELIST.includes(volume.mount))
      const chosen = filtered.length ? filtered : volumes.slice(0, 3)
      const totalSize = chosen.reduce((sum, volume) => sum + volume.size, 0)
      const totalUsed = chosen.reduce((sum, volume) => sum + volume.used, 0)

      return {
        totalPct: totalSize ? clampPercent((totalUsed / totalSize) * 100) : 0,
        volumes: chosen
      }
    } catch (err) {
      console.error("Storage read failed:", err)
      return { totalPct: 0, volumes: [] }
    }
  }

  const readWifiName = async () => {
    const now = Date.now()
    if (now - wifiCache.timestamp < WIFI_CACHE_MS) return wifiCache.value

    let ssid = ""

    try {
      const out = await execAsync("iwgetid -r")
      ssid = out.trim()
    } catch {}

    if (!ssid) {
      try {
        const out = await execAsync("nmcli -t -f active,ssid dev wifi")
        const line = out
          .split("\n")
          .map((entry) => entry.trim())
          .find((entry) => entry.startsWith("yes:"))
        if (line) ssid = line.split(":").slice(1).join(":").trim()
      } catch {}
    }

    wifiCache.value = ssid
    wifiCache.timestamp = now
    return ssid
  }

  let lastNet = { rx: 0, tx: 0, ts: 0 }
  const readNetwork = async () => {
    let ssid = ""
    try {
      ssid = await readWifiName()
    } catch {}

    try {
      const out = readTextFile("/proc/net/dev")
      const lines = out.split("\n").slice(2).filter((line) => line.trim().length > 0)
      let rx = 0
      let tx = 0

      for (const line of lines) {
        const [ifacePart, rest] = line.split(":")
        const iface = ifacePart.trim()
        if (!iface || iface === "lo") continue
        const parts = rest.trim().split(/\s+/)
        rx += parseInt(parts[0] || "0", 10) || 0
        tx += parseInt(parts[8] || "0", 10) || 0
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

      netHistoryDown.push(down)
      netHistoryUp.push(up)
      if (netHistoryDown.length > MAX_NET_SAMPLES) netHistoryDown.shift()
      if (netHistoryUp.length > MAX_NET_SAMPLES) netHistoryUp.shift()

      return { down, up, ssid }
    } catch (err) {
      console.error("Network read failed:", err)
      return { down: 0, up: 0, ssid }
    }
  }

  const readUptime = async () => {
    const now = Date.now()
    if (now - uptimeCache.timestamp < UPTIME_CACHE_MS) return uptimeCache.value

    try {
      const seconds = Math.floor(parseFloat(readTextFile("/proc/uptime").split(/\s+/)[0] || "0"))
      if (seconds > 0) {
        uptimeCache.value = formatUptimeSeconds(seconds)
        uptimeCache.timestamp = now
        return uptimeCache.value
      }
    } catch {}

    try {
      uptimeCache.value = (await execAsync("uptime -p")).trim()
    } catch {
      uptimeCache.value = formatUptimeSeconds(Math.floor(GLib.get_monotonic_time() / 1_000_000))
    }

    uptimeCache.timestamp = now
    return uptimeCache.value
  }

  const readUpdates = async () => {
    const now = Date.now()
    if (now - updatesCache.timestamp < UPDATES_CACHE_MS) return updatesCache.value

    try {
      const out = await execAsync("/usr/bin/checkupdates")
      updatesCache.value = out.trim()
        ? `Updates: ${out.trim().split("\n").filter(Boolean).length}`
        : "Updates: 0"
    } catch {
      updatesCache.value = "Updates: n/a"
    }

    updatesCache.timestamp = now
    return updatesCache.value
  }

  const readMpcTrack = async () => {
    try {
      const out = await execAsync("mpc status")
      const lines = out.split("\n").filter((line) => line.trim().length > 0)
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

  const readMedia = async () => {
    const now = Date.now()
    if (now - mediaCache.timestamp < MEDIA_CACHE_MS) return mediaCache.value

    let playerctlTrack = ""
    let playerctlStatus = "NoPlayer"

    try {
      playerctlStatus = (await execAsync("playerctl status --ignore-player=chromium")).trim()
      if (playerctlStatus !== "NoPlayer") {
        playerctlTrack = (
          await execAsync(
            "playerctl metadata --format '{{title}} — {{artist}}' --ignore-player=chromium"
          )
        ).trim()
        if (playerctlStatus === "Playing" && playerctlTrack) {
          mediaCache.value = playerctlTrack
          mediaCache.timestamp = now
          return mediaCache.value
        }
      }
    } catch {}

    const mpc = await readMpcTrack()
    if (mpc) {
      const suffix = mpc.status === "paused" ? " · mpc (paused)" : " · mpc"
      if (mpc.status === "playing") {
        mediaCache.value = `${mpc.title}${suffix}`
        mediaCache.timestamp = now
        return mediaCache.value
      }
      if (!playerctlTrack) {
        mediaCache.value = `${mpc.title}${suffix}`
        mediaCache.timestamp = now
        return mediaCache.value
      }
    }

    mediaCache.value = playerctlTrack || "No media"
    mediaCache.timestamp = now
    return mediaCache.value
  }

  const readGpu = async () => {
    const now = Date.now()
    if (now - gpuCache.timestamp < GPU_CACHE_MS) return gpuCache.value

    try {
      for (const node of ["renderD128", "renderD129", "renderD130"]) {
        const trimmed =
          readTextFile(`/sys/class/drm/${node}/device/gpu_busy_percent`).trim() ||
          readTextFile(`/sys/class/drm/${node}/device/gt_busy_percent`).trim()
        if (trimmed) {
          gpuCache.value = { pct: clampPercent(parseInt(trimmed, 10)), detail: node }
          gpuCache.timestamp = now
          return gpuCache.value
        }
      }

      for (const card of [0, 1, 2]) {
        const trimmed =
          readTextFile(`/sys/class/drm/card${card}/device/gpu_busy_percent`).trim() ||
          readTextFile(`/sys/class/drm/card${card}/device/gt_busy_percent`).trim()
        if (trimmed) {
          gpuCache.value = { pct: clampPercent(parseInt(trimmed, 10)), detail: `card${card}` }
          gpuCache.timestamp = now
          return gpuCache.value
        }
      }

      try {
        const out = await execAsync(
          "/usr/bin/nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits"
        )
        const parts = out.trim().split(",").map((value) => value.trim())
        if (parts.length >= 3) {
          const pct = parseInt(parts[0] || "0", 10)
          const used = parseInt(parts[1] || "0", 10)
          const total = parseInt(parts[2] || "0", 10)
          gpuCache.value = {
            pct: clampPercent(pct),
            detail: total ? `${used}/${total}MB` : "NVIDIA"
          }
          gpuCache.timestamp = now
          return gpuCache.value
        }
      } catch {}

      gpuCache.value = { pct: 0, detail: "GPU N/A" }
      gpuCache.timestamp = now
      return gpuCache.value
    } catch (err) {
      console.error("GPU read failed:", err)
      return gpuCache.value
    }
  }

  let lastStorage = { totalPct: 0, volumes: [] as DiskVolume[] }
  let lastStorageKey = ""
  let lastWindowsKey = ""
  let lastNotificationKey = ""
  let dashboardRefreshActive = false
  let dashboardRefreshQueued = false

  const refreshGauges = async () => {
    try {
      const cpu = await readCpuUsage()
      cpuGauge.update(cpu, cpu >= 75 ? "high load" : cpu >= 45 ? "busy" : "steady")
      setLabelIfChanged(cpuMetaValue, `${cpu}% current load`)

      const ram = await readRamUsage()
      const ramUsedGiB = ram.used / 1024 / 1024
      const ramTotalGiB = ram.total / 1024 / 1024
      ramGauge.update(ram.pct, `${ramUsedGiB.toFixed(1)} / ${ramTotalGiB.toFixed(1)} GiB`)
      setLabelIfChanged(ramMetaValue, `${ramUsedGiB.toFixed(1)} / ${ramTotalGiB.toFixed(1)} GiB`)
      storageGauge.update(
        lastStorage.totalPct,
        lastStorage.volumes.length ? `${lastStorage.volumes.length} mounts` : "n/a"
      )

      void readGpu()
        .then((gpu) => {
          gpuGauge.update(gpu.pct, gpu.detail)
          setLabelIfChanged(gpuMetaValue, gpu.detail || "GPU N/A")
        })
        .catch((err) => console.error("GPU refresh failed:", err))
    } catch (err) {
      console.error("Gauge refresh failed:", err)
    }
  }

  const refreshStorage = async () => {
    try {
      lastStorage = await readStorageAll()
      const storageKey = lastStorage.volumes
        .map((volume) => `${volume.mount}:${volume.used}:${volume.size}:${volume.pct}`)
        .join("|")

      if (storageKey !== lastStorageKey) {
        lastStorageKey = storageKey
        renderStorageList(lastStorage.volumes)
      }

      storageGauge.update(
        lastStorage.totalPct,
        lastStorage.volumes.length ? `${lastStorage.volumes.length} mounts` : "n/a"
      )

      const totalBytes = lastStorage.volumes.reduce((sum, volume) => sum + volume.size, 0)
      const usedBytes = lastStorage.volumes.reduce((sum, volume) => sum + volume.used, 0)
      setLabelIfChanged(
        storageMetaValue,
        totalBytes ? `${formatBytes(usedBytes)} / ${formatBytes(totalBytes)}` : "No disks detected"
      )
      setLabelIfChanged(
        storageSummary,
        lastStorage.volumes.length ? `${lastStorage.volumes.length} mounts` : "No disks"
      )
    } catch (err) {
      console.error("Storage refresh failed:", err)
    }
  }

  const refreshNetwork = async () => {
    try {
      const net = await readNetwork()
      setLabelIfChanged(netSSID, net.ssid ? `Connected to ${net.ssid}` : "WiFi unavailable")
      setLabelIfChanged(netDetail, `Down ${formatSpeed(net.down)} · Up ${formatSpeed(net.up)}`)
      netGraph.queue_draw()
    } catch (err) {
      console.error("Network refresh failed:", err)
    }
  }

  const refreshMeta = async () => {
    try {
      const [uptime, media] = await Promise.all([readUptime(), readMedia()])
      setLabelIfChanged(uptimeValue, uptime)
      setLabelIfChanged(mediaValue, media)

      void readUpdates()
        .then((updates) => setLabelIfChanged(updatesValue, updates))
        .catch((err) => console.error("Updates refresh failed:", err))
    } catch (err) {
      console.error("Meta refresh failed:", err)
    }
  }

  const refreshNotifications = () => {
    const items = getNotificationHistory()
    const threads = groupNotifications(items)
    const notificationKey = items.length
      ? items.map((item) => `${item.id}:${item.timestamp}`).join("|")
      : "empty"
    notificationCount.label = items.length === 1 ? "1 item" : `${items.length} items`
    notificationClear.sensitive = items.length > 0

    if (notificationKey === lastNotificationKey) return
    lastNotificationKey = notificationKey

    let child = notificationBox.get_first_child()
    while (child) {
      notificationBox.remove(child)
      child = notificationBox.get_first_child()
    }

    if (!items.length) {
      notificationBox.append(
        new Gtk.Label({
          label: "Nothing waiting here.",
          css_classes: ["dashboard-note"],
          xalign: 0
        })
      )
      return
    }

    threads.forEach((thread, index) => {
      const newest = thread.items[0]
      const isRecent = Date.now() - thread.latestTimestamp < 15 * 60 * 1000 || index < 3
      const row = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        css_classes: ["dashboard-list-row", "notification-row", isRecent ? "recent" : ""]
      })

      const header = new Gtk.Box({ spacing: 10, hexpand: true })
      const iconWrap = new Gtk.Box({ css_classes: ["notification-app-icon-wrap"] })
      iconWrap.append(
        new Gtk.Image({
          icon_name: resolveWindowIcon(thread.app, thread.summary),
          pixel_size: 16,
          css_classes: ["notification-app-icon"]
        })
      )

      const meta = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 2,
        hexpand: true
      })
      meta.append(
        new Gtk.Label({
          label: thread.app,
          css_classes: ["notification-app"],
          xalign: 0,
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 18
        })
      )
      meta.append(
        new Gtk.Label({
          label: thread.summary || "(no title)",
          css_classes: ["notification-title"],
          xalign: 0,
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 34
        })
      )

      const timeLabel = new Gtk.Label({
        label: formatTimeShort(thread.latestTimestamp),
        css_classes: ["notification-time"],
        xalign: 1,
        halign: Gtk.Align.END
      })

      const newBadge = new Gtk.Label({
        label: "new",
        css_classes: ["notification-badge"],
        visible: isRecent
      })

      const threadCount = new Gtk.Label({
        label: thread.items.length > 1 ? `${thread.items.length} replies` : "single",
        css_classes: ["notification-thread-count"]
      })

      const dismissBtn = new Gtk.Button({
        css_classes: ["notification-dismiss"],
        tooltip_text:
          thread.items.length > 1 ? "Dismiss this thread" : "Dismiss this notification"
      })
      dismissBtn.set_child(new Gtk.Image({ icon_name: "window-close-symbolic", pixel_size: 14 }))
      dismissBtn.connect("clicked", () => thread.items.forEach((entry) => removeNotification(entry.id)))

      header.append(iconWrap)
      header.append(meta)
      header.append(newBadge)
      header.append(threadCount)
      header.append(timeLabel)
      header.append(dismissBtn)

      row.append(header)

      if (thread.items.length === 1) {
        const body = new Gtk.Label({
          label: newest.body,
          css_classes: ["notification-body"],
          xalign: 0,
          wrap: true,
          wrap_mode: Pango.WrapMode.WORD_CHAR,
          max_width_chars: 44,
          visible: Boolean(newest.body)
        })

        row.add_controller(
          (() => {
            const click = new Gtk.GestureClick()
            click.connect("released", () => removeNotification(newest.id))
            return click
          })()
        )

        row.append(body)
      } else {
        const repliesBox = new Gtk.Box({
          orientation: Gtk.Orientation.VERTICAL,
          spacing: 6,
          css_classes: ["notification-thread-list"]
        })

        thread.items.forEach((entry) => {
          const reply = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            css_classes: ["notification-thread-item"]
          })

          const replyHeader = new Gtk.Box({ spacing: 8, hexpand: true })
          replyHeader.append(
            new Gtk.Label({
              label: formatTimeShort(entry.timestamp),
              css_classes: ["notification-thread-time"],
              xalign: 0
            })
          )

          const replyDismiss = new Gtk.Button({
            css_classes: ["notification-thread-dismiss"],
            halign: Gtk.Align.END,
            hexpand: true,
            tooltip_text: "Dismiss this reply"
          })
          replyDismiss.set_child(new Gtk.Image({ icon_name: "window-close-symbolic", pixel_size: 12 }))
          replyDismiss.connect("clicked", () => removeNotification(entry.id))
          replyHeader.append(replyDismiss)

          const replyBody = new Gtk.Label({
            label: entry.body || "(no body)",
            css_classes: ["notification-body", "notification-thread-body"],
            xalign: 0,
            wrap: true,
            wrap_mode: Pango.WrapMode.WORD_CHAR,
            max_width_chars: 42
          })

          reply.append(replyHeader)
          reply.append(replyBody)
          repliesBox.append(reply)
        })

        const threadScroll = new Gtk.ScrolledWindow({
          min_content_height: Math.min(180, 66 * thread.items.length),
          max_content_height: 180,
          hscrollbar_policy: Gtk.PolicyType.NEVER,
          vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
          css_classes: ["notification-thread-scroll"]
        })
        threadScroll.set_child(repliesBox)

        row.append(threadScroll)
      }

      notificationBox.append(row)
    })
  }

  const renderWindows = (windows: WindowInfo[]) => {
    renderList(windowsBox, windows, (item) => {
      const row = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        css_classes: ["dashboard-list-row", "windows-row"],
        hexpand: true
      })

      const iconWrap = new Gtk.Box({
        css_classes: ["window-app-icon-wrap"],
        valign: Gtk.Align.CENTER
      })
      iconWrap.append(
        new Gtk.Image({
          icon_name: resolveWindowIcon(item.app, item.title),
          pixel_size: 22,
          css_classes: ["window-app-icon"]
        })
      )

      const meta = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 1,
        hexpand: true
      })
      meta.append(
        new Gtk.Label({
          label: item.app,
          css_classes: ["window-app"],
          xalign: 0,
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 18
        })
      )
      meta.append(
        new Gtk.Label({
          label: item.title,
          css_classes: ["window-title"],
          xalign: 0,
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 40
        })
      )

      const workspace = new Gtk.Label({
        label: `WS ${item.workspace}`,
        css_classes: ["window-workspace"],
        xalign: 1,
        halign: Gtk.Align.END
      })

      row.add_controller(
        (() => {
          const click = new Gtk.GestureClick()
          click.connect("released", () => {
            if (!item.address) return
            execAsync(`hyprctl dispatch focuswindow address:${item.address}`)
              .catch(console.error)
              .finally(() => hideDashboard())
          })
          return click
        })()
      )

      row.append(iconWrap)
      row.append(meta)
      row.append(workspace)
      return row
    })
  }

  const refreshWindows = async () => {
    try {
      const windows = await fetchWindows()
      const key = windows
        .map((item) => `${item.address}:${item.workspace}:${item.title}:${item.app}`)
        .join("|")

      if (key === lastWindowsKey) return
      lastWindowsKey = key
      renderWindows(windows)
    } catch (err) {
      console.error("Window refresh failed:", err)
    }
  }

  const refreshLiveCards = async () => {
    await Promise.all([refreshGauges(), refreshNetwork(), refreshMeta()])
  }

  const refreshSupportCards = async () => {
    await Promise.all([refreshWindows(), refreshPlayback(), refreshStorage()])
  }

  const refreshDashboard = async () => {
    if (dashboardRefreshActive) {
      dashboardRefreshQueued = true
      return
    }

    dashboardRefreshActive = true
    applyProfile(loadProfile())
    refreshNotifications()

    try {
      await Promise.all([refreshLiveCards(), refreshSupportCards()])
    } catch (err) {
      console.error("Dashboard refresh failed:", err)
    } finally {
      dashboardRefreshActive = false
      if (dashboardRefreshQueued) {
        dashboardRefreshQueued = false
        void refreshDashboard().catch((err) =>
          console.error("Queued dashboard refresh failed:", err)
        )
      }
    }
  }

  const POWER_PROFILE_ICONS: Record<string, string> = {
    performance: "󰓅",
    balanced: "󰾆",
    "power-saver": "󰔏"
  }

  const actionButtons = [
    {
      icon: "󰕾",
      label: "Audio",
      command:
        "sh -lc 'if command -v pavucontrol >/dev/null; then pavucontrol; elif command -v pwvucontrol >/dev/null; then pwvucontrol; else exit 1; fi'"
    },
    {
      icon: "󰂯",
      label: "Bluetooth",
      command: "sh -lc 'if command -v blueman-manager >/dev/null; then blueman-manager; else exit 1; fi'"
    }
  ]

  const profileCard = (
    <box
      class="dashboard-card profile-card"
      orientation={Gtk.Orientation.VERTICAL}
      spacing={12}
      width_request={LEFT_COLUMN_WIDTH}
      height_request={PROFILE_CARD_HEIGHT}
    >
      <box spacing={8} valign={Gtk.Align.START}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand={true}>
          <label label="Operator" class="card-title" xalign={0} />
          <label label={clockState((state) => state.day || "Today")} class="card-subtitle" xalign={0} />
        </box>
        <label
          label={clockState((state) => state.time || "--:--")}
          class="profile-clock"
          xalign={1}
          width_chars={5}
          max_width_chars={5}
        />
      </box>
      <box class="profile-top" spacing={10}>
        {avatarWrapper}
        <box orientation={Gtk.Orientation.VERTICAL} spacing={3} valign={Gtk.Align.CENTER} hexpand={true}>
          {profileName}
          {profileTitle}
          {profileMeta}
        </box>
      </box>
      {profileStatus}
      {profileBio}
      <box class="quick-actions" spacing={8} homogeneous={true}>
        {actionButtons.map((action) => (
          <button class="quick-action" onClicked={() => runDashboardCommand(action.command)}>
            <box orientation={Gtk.Orientation.VERTICAL} spacing={4} halign={Gtk.Align.CENTER}>
              <label label={action.icon} class="quick-action-icon" />
              <label label={action.label} class="quick-action-label" />
            </box>
          </button>
        ))}
      </box>
    </box>
  )

  const powerCard = (
    <box
      class="dashboard-card power-card"
      orientation={Gtk.Orientation.VERTICAL}
      spacing={10}
      width_request={LEFT_COLUMN_WIDTH}
      height_request={POWER_CARD_HEIGHT}
    >
      <box spacing={8} valign={Gtk.Align.CENTER}>
        <label label="Power Profiles" class="card-title" xalign={0} hexpand={true} />
        <label
          label={powerProfileStatus((state) =>
            state.active === "unknown" ? "Syncing" : titleCaseProfile(state.active)
          )}
          class="card-kicker"
          xalign={1}
        />
      </box>
      <box class="power-switcher" spacing={8} homogeneous={true}>
        {POWER_PROFILE_ORDER.map((profile) => (
          <button
            class={powerProfileStatus((state) => {
              const active = state.active === profile
              const available = state.available.includes(profile)
              return `power-option${active ? " active" : ""}${available ? "" : " disabled"}`
            })}
            sensitive={powerProfileStatus((state) => state.available.includes(profile))}
            onClicked={() => setPowerProfile(profile)}
          >
            <box orientation={Gtk.Orientation.VERTICAL} spacing={4} halign={Gtk.Align.CENTER}>
              <label label={POWER_PROFILE_ICONS[profile] || "󰓅"} class="power-option-icon" />
              <label label={titleCaseProfile(profile)} class="power-option-label" />
            </box>
          </button>
        ))}
      </box>
    </box>
  )

  const utilityActions = [
    {
      icon: "󰖔",
      label: "Night Light",
      command: TOGGLE_NIGHT_LIGHT_COMMAND,
      hideAfter: false
    },
    {
      icon: "󰌌",
      label: "Keyboard Toggle",
      command: TOGGLE_KEYBOARD_BACKLIGHT_COMMAND,
      hideAfter: false
    },
    {
      icon: "󰦝",
      label: "VPN",
      command:
        "sh -lc 'if command -v mullvad-vpn >/dev/null; then mullvad-vpn; elif command -v protonvpn-app >/dev/null; then protonvpn-app; elif command -v nm-connection-editor >/dev/null; then nm-connection-editor; elif command -v kitty >/dev/null && command -v nordvpn >/dev/null; then kitty -e nordvpn; elif command -v foot >/dev/null && command -v nordvpn >/dev/null; then foot -e nordvpn; else exit 1; fi'"
    },
    {
      icon: "󰌾",
      label: "Lock",
      command:
        "sh -lc 'if command -v hyprlock >/dev/null; then hyprlock; elif command -v loginctl >/dev/null; then loginctl lock-session; else exit 1; fi'"
    },
    {
      icon: "󰤨",
      label: "Wi-Fi",
      command:
        "sh -lc 'if command -v nmtui >/dev/null; then if command -v kitty >/dev/null; then kitty -e nmtui; elif command -v foot >/dev/null; then foot -e nmtui; elif command -v alacritty >/dev/null; then alacritty -e nmtui; else exit 1; fi; elif command -v nm-connection-editor >/dev/null; then nm-connection-editor; else exit 1; fi'"
    }
  ]

  const utilityCard = (
    <box
      class="dashboard-card utility-card"
      orientation={Gtk.Orientation.VERTICAL}
      spacing={10}
      width_request={LEFT_COLUMN_WIDTH}
      height_request={UTILITY_CARD_HEIGHT}
    >
      <label label="System Actions" class="card-title" xalign={0} />
      <box class="utility-grid" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
        {[
          utilityActions.slice(0, 2),
          utilityActions.slice(2, 4),
          utilityActions.slice(4, 6)
        ].filter((row) => row.length > 0).map((row) => (
          <box spacing={8} homogeneous={true}>
            {row.map((action) => (
              <button
                class="utility-action"
                onClicked={() => runDashboardCommand(action.command, action.hideAfter ?? true)}
              >
                <box spacing={8} halign={Gtk.Align.CENTER}>
                  <label label={action.icon} class="utility-action-icon" />
                  <label label={action.label} class="utility-action-label" />
                </box>
              </button>
            ))}
          </box>
        ))}
      </box>
    </box>
  )

  const metricsCard = (
    <box
      class="dashboard-card metrics-card"
      orientation={Gtk.Orientation.VERTICAL}
      spacing={14}
      width_request={CENTER_COLUMN_WIDTH}
      height_request={METRICS_CARD_HEIGHT}
    >
      <label label="System Pulse" class="card-title" xalign={0} />
      <box class="metrics-layout" spacing={14} hexpand={true}>
        <box class="gauge-grid" orientation={Gtk.Orientation.VERTICAL} spacing={10}>
          <box class="gauge-row" spacing={10}>
            {cpuGauge.widget}
            {ramGauge.widget}
          </box>
          <box class="gauge-row" spacing={10}>
            {gpuGauge.widget}
            {storageGauge.widget}
          </box>
        </box>
        <box class="metrics-insights" orientation={Gtk.Orientation.VERTICAL} spacing={10} hexpand={true}>
          <box class="insight-grid" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
            <box class="insight-row" spacing={10}>
              <label label="Uptime" class="insight-label" xalign={0} />
              {uptimeValue}
            </box>
            <box class="insight-row" spacing={10}>
              <label label="Updates" class="insight-label" xalign={0} />
              {updatesValue}
            </box>
            <box class="insight-row" spacing={10}>
              <label label="CPU" class="insight-label" xalign={0} />
              {cpuMetaValue}
            </box>
            <box class="insight-row" spacing={10}>
              <label label="Memory" class="insight-label" xalign={0} />
              {ramMetaValue}
            </box>
            <box class="insight-row" spacing={10}>
              <label label="GPU" class="insight-label" xalign={0} />
              {gpuMetaValue}
            </box>
            <box class="insight-row" spacing={10}>
              <label label="Storage" class="insight-label" xalign={0} />
              {storageMetaValue}
            </box>
            <box class="insight-row" spacing={10}>
              <label label="Now Playing" class="insight-label" xalign={0} />
              {mediaValue}
            </box>
          </box>
          <box class="network-panel" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
            {netSSID}
            {netDetail}
            {netGraph}
          </box>
        </box>
      </box>
    </box>
  )

  const controlsCard = (
    <box
      class="dashboard-card controls-card"
      orientation={Gtk.Orientation.VERTICAL}
      spacing={10}
      width_request={CENTER_COLUMN_WIDTH}
      height_request={CONTROLS_CARD_HEIGHT}
    >
      <box spacing={8} valign={Gtk.Align.CENTER}>
        <label label="Mixer & Display" class="card-title" xalign={0} hexpand={true} />
        <label label="Live control" class="card-kicker" xalign={1} />
      </box>
      <box class="control-clusters" spacing={10} hexpand={true}>
        <box class="control-column" orientation={Gtk.Orientation.VERTICAL} spacing={10} hexpand={true}>
          <box class="control-section" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
            <label label="Output" class="control-label" xalign={0} />
            {volumeScale}
            <label label={volumeValueLabel} class="control-value" xalign={1} />
          </box>
          <box class="control-section" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
            <label label="Microphone" class="control-label" xalign={0} />
            {micScale}
            <label label={micValueLabel} class="control-value" xalign={1} />
          </box>
        </box>
        <box class="control-column" orientation={Gtk.Orientation.VERTICAL} spacing={10} hexpand={true}>
          <box class="control-section" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
            <label label="Brightness" class="control-label" xalign={0} />
            {brightnessScale}
            <label label={brightnessValueLabel} class="control-value" xalign={1} />
          </box>
          <box class="control-section playback-section" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
            <label label="App Streams" class="control-label" xalign={0} />
            {playbackScroll}
          </box>
        </box>
      </box>
    </box>
  )

  const storageCard = (
    <box
      class="dashboard-card storage-card"
      orientation={Gtk.Orientation.VERTICAL}
      spacing={10}
      width_request={CENTER_COLUMN_WIDTH}
      height_request={STORAGE_CARD_HEIGHT}
    >
      <box spacing={8} valign={Gtk.Align.CENTER}>
        <label label="Disks" class="card-title" xalign={0} hexpand={true} />
        {storageSummary}
      </box>
      {storageScroll}
    </box>
  )

  const notificationCard = (
    <box
      class="dashboard-card notification-card"
      orientation={Gtk.Orientation.VERTICAL}
      spacing={10}
      width_request={RIGHT_COLUMN_WIDTH}
      height_request={NOTIFICATION_CARD_HEIGHT}
    >
      <box spacing={8} valign={Gtk.Align.CENTER}>
        <label label="Notifications" class="card-title" xalign={0} hexpand={true} />
        {notificationCount}
        {notificationClear}
      </box>
      {notificationScroll}
    </box>
  )

  const surface = (
    <box
      class="dashboard-surface"
      orientation={Gtk.Orientation.VERTICAL}
      width_request={MODAL_WIDTH}
      height_request={MODAL_HEIGHT}
    >
      <box class="dashboard-main" spacing={COLUMN_GAP} valign={Gtk.Align.START}>
        <box
          class="dashboard-column dashboard-column-left"
          orientation={Gtk.Orientation.VERTICAL}
          spacing={COLUMN_GAP}
          width_request={LEFT_COLUMN_WIDTH}
          valign={Gtk.Align.START}
        >
          {profileCard}
          {powerCard}
          {utilityCard}
        </box>
        <box
          class="dashboard-column dashboard-column-center"
          orientation={Gtk.Orientation.VERTICAL}
          spacing={COLUMN_GAP}
          width_request={CENTER_COLUMN_WIDTH}
          valign={Gtk.Align.START}
        >
          {metricsCard}
          {controlsCard}
          {storageCard}
        </box>
        <box
          class="dashboard-column dashboard-column-right"
          orientation={Gtk.Orientation.VERTICAL}
          spacing={COLUMN_GAP}
          width_request={RIGHT_COLUMN_WIDTH}
          valign={Gtk.Align.START}
        >
          {notificationCard}
        </box>
      </box>
    </box>
  ) as Gtk.Widget

  const surfaceShell = (
    <box
      class="dashboard-surface-shell"
      orientation={Gtk.Orientation.VERTICAL}
      width_request={MODAL_WIDTH}
      height_request={MODAL_HEIGHT}
      onRealize={(self) => {
        self.set_size_request(MODAL_WIDTH, MODAL_HEIGHT)
        if ("set_overflow" in self) {
          try {
            // @ts-expect-error gtk4 overflow API
            self.set_overflow(Gtk.Overflow.HIDDEN)
          } catch {}
        }
      }}
    >
      {surface}
    </box>
  ) as Gtk.Widget

  const surfaceViewport = new Gtk.ScrolledWindow({
    width_request: MODAL_WIDTH,
    height_request: MODAL_HEIGHT,
    min_content_width: MODAL_WIDTH,
    max_content_width: MODAL_WIDTH,
    min_content_height: MODAL_HEIGHT,
    max_content_height: MODAL_HEIGHT,
    hscrollbar_policy: Gtk.PolicyType.NEVER,
    vscrollbar_policy: Gtk.PolicyType.NEVER,
    css_classes: ["dashboard-viewport"]
  })
  surfaceViewport.set_child(surfaceShell)

  const surfaceRevealer = new Gtk.Revealer({
    transition_type: Gtk.RevealerTransitionType.SLIDE_UP,
    transition_duration: DASHBOARD_OPEN_DURATION_MS,
    reveal_child: false
  })
  surfaceRevealer.set_child(surfaceViewport)

  const overlayStage = new Gtk.Fixed({
    hexpand: true,
    vexpand: true,
    css_classes: ["dashboard-overlay", "dashboard-stage"]
  })
  overlayStage.put(surfaceRevealer, surfaceX, surfaceY)

  const closeButton = new Gtk.Button({
    css_classes: ["dashboard-close"],
    halign: Gtk.Align.END,
    valign: Gtk.Align.START
  })
  closeButton.set_child(new Gtk.Image({ icon_name: "window-close-symbolic", pixel_size: 14 }))
  closeButton.connect("clicked", () => hideDashboard())
  const closeRevealer = new Gtk.Revealer({
    transition_type: Gtk.RevealerTransitionType.CROSSFADE,
    transition_duration: 160,
    reveal_child: false
  })
  closeRevealer.set_child(closeButton)
  overlayStage.put(closeRevealer, surfaceX + MODAL_WIDTH + 45, Math.max(0, surfaceY - 90))

  const overlayRevealer = new Gtk.Revealer({
    transition_type: Gtk.RevealerTransitionType.CROSSFADE,
    transition_duration: 160,
    reveal_child: false
  })
  overlayRevealer.set_child(overlayStage)

  const overlay = overlayRevealer as Gtk.Widget

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

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, DASHBOARD_LIVE_REFRESH_MS, () => {
          if (self.visible && isDashboardOpen) {
            void refreshLiveCards().catch((err) => console.error("Live dashboard refresh failed:", err))
          }
          return GLib.SOURCE_CONTINUE
        })
      }}
    >
      {overlay}
    </window>
  ) as Astal.Window
  let hideTransitionId = 0
  let refreshKickoffId = 0
  let isDashboardOpen = false

  const clearHideTransition = () => {
    if (!hideTransitionId) return
    GLib.source_remove(hideTransitionId)
    hideTransitionId = 0
  }

  const clearRefreshKickoff = () => {
    if (!refreshKickoffId) return
    GLib.source_remove(refreshKickoffId)
    refreshKickoffId = 0
  }

  const presentDashboard = () => {
    if (isDashboardOpen && win.visible) return

    clearHideTransition()
    clearRefreshKickoff()
    isDashboardOpen = true

    if (!win.visible) win.visible = true

    try {
      win.grab_focus()
    } catch (err) {
      console.error("Dashboard present failed:", err)
    }

    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      overlayRevealer.reveal_child = true
      return GLib.SOURCE_REMOVE
    })

    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 24, () => {
      if (!isDashboardOpen) return GLib.SOURCE_REMOVE
      surfaceRevealer.reveal_child = true
      closeRevealer.reveal_child = true
      return GLib.SOURCE_REMOVE
    })

    refreshKickoffId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      refreshKickoffId = 0
      if (isDashboardOpen) {
        void refreshDashboard().catch((err) =>
          console.error("Visible dashboard refresh failed:", err)
        )
      }
      return GLib.SOURCE_REMOVE
    })
  }

  const dismissDashboard = () => {
    if (!win.visible && !isDashboardOpen) return

    isDashboardOpen = false
    clearHideTransition()
    clearRefreshKickoff()
    surfaceRevealer.reveal_child = false
    closeRevealer.reveal_child = false
    overlayRevealer.reveal_child = false

    hideTransitionId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      DASHBOARD_CLOSE_DURATION_MS + 40,
      () => {
        hideTransitionId = 0
        if (!isDashboardOpen) win.visible = false
        return GLib.SOURCE_REMOVE
      }
    )
  }

  const toggleDashboardVisibility = () => {
    if (isDashboardOpen || win.visible) {
      dismissDashboard()
      return
    }

    presentDashboard()
  }

  const stopNotificationsListener = onNotificationUpdate(() => {
    if (!isDashboardOpen) return
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      refreshNotifications()
      return GLib.SOURCE_REMOVE
    })
  })

  win.connect("destroy", () => {
    clearHideTransition()
    clearRefreshKickoff()
    stopNotificationsListener()
  })

  registerDashboard(win, {
    show: presentDashboard,
    hide: dismissDashboard,
    toggle: toggleDashboardVisibility
  })
  applyProfile(loadProfile())
  refreshNotifications()

  return win
}
