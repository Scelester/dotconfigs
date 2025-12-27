import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { execAsync, subprocess } from "ags/process"
import { createPoll, timeout } from "ags/time"
import Gio from "gi://Gio"
import GLib from "gi://GLib"
import Pango from "gi://Pango"
import { hideDashboard, registerDashboard } from "./dashboardState"

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
const TODO_LIST_HEIGHT = 220
const WINDOWS_LIST_HEIGHT = 300
const STORAGE_LIST_HEIGHT = 160
const NOTIFICATION_LIST_HEIGHT = 360
const TODO_PREVIEW_MAX = 8
const GAUGE_SIZE = 70
const STORAGE_EXCLUDED = ["tmpfs", "devtmpfs", "overlay", "squashfs"]
const STORAGE_WHITELIST = ["/", "/home", "/home/scelester/Container"]
const NOTIFICATION_HISTORY_LIMIT = 500
const POWER_PROFILE_ORDER = ["performance", "balanced", "power-saver"] as const

// Convert absolute mounts into nicer labels
const prettyMount = (mount: string) => {
  if (mount === "/") return "/"
  if (mount === "/home") return "~/"
  if (mount === "/home/scelester/Container") return "~/Container"
  return mount.replace(GLib.get_home_dir(), "~")
}

// Helper to decode GLib byte arrays
const decodeBuffer = (bytes: Uint8Array) => {
  const decoder = new TextDecoder()
  return decoder.decode(bytes)
}

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
  const notificationClear = new Gtk.Button({
    label: "Clear",
    css_classes: ["pill-button", "notification-clear"],
    halign: Gtk.Align.END
  })
  notificationClear.set_sensitive(false)
  notificationClear.connect("clicked", () => clearNotificationHistory())
  const notificationScroll = new Gtk.ScrolledWindow({
    vexpand: true,
    min_content_height: NOTIFICATION_LIST_HEIGHT
  })
  notificationScroll.set_child(notificationBox)

  // Static widgets
  const calendar = new Gtk.Calendar({
    css_classes: ["dashboard-calendar"]
  })

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

  const storageStatus = new Gtk.Label({
    label: "Loading disks…",
    css_classes: ["dashboard-note"],
    xalign: 0
  })

  const netLabel = new Gtk.Label({
    label: "Network",
    css_classes: ["card-title"],
    xalign: 0
  })
  const netDetail = new Gtk.Label({
    label: "Down 0B/s · Up 0B/s",
    css_classes: ["dashboard-note"],
    xalign: 0
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
    wrap: true,
    wrap_mode: Pango.WrapMode.WORD_CHAR,
    max_width_chars: 30
  })

  const powerProfileStatus = createPoll<PowerProfileState>(
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
        const type = new Gtk.Label({
          label: vol.fstype,
          xalign: 0,
          css_classes: ["muted", "storage-type"],
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 8
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
        row.attach(type, 1, 0, 1, 1)
        row.attach(usage, 2, 0, 1, 1)
        row.attach(pct, 3, 0, 1, 1)
        return row
      }
    )
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
    notificationScroll.visible = items.length > 0

    let child = notificationBox.get_first_child()
    while (child) {
      notificationBox.remove(child)
      child = notificationBox.get_first_child()
    }

    if (!items.length) {
      notificationEmpty.visible = true
      notificationBox.visible = false
      return
    }

    notificationEmpty.visible = false
    notificationBox.visible = true

    items.forEach((item) => {
      const row = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        css_classes: ["dashboard-list-row", "notification-row"]
      })

      const header = new Gtk.Box({ spacing: 8, hexpand: true })
      const appLabel = new Gtk.Label({
        label: item.app,
        css_classes: ["muted", "notification-app"],
        xalign: 0,
        hexpand: true,
        ellipsize: Pango.EllipsizeMode.END,
        max_width_chars: 18
      })
      const timeLabel = new Gtk.Label({
        label: formatTimeShort(item.timestamp),
        css_classes: ["notification-time", "muted"],
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
      dismissBtn.set_child(new Gtk.Image({ icon_name: "window-close-symbolic", pixel_size: 12 }))
      dismissBtn.connect("clicked", () => removeNotification(item.id))

      header.append(appLabel)
      header.append(timeLabel)
      header.append(dismissBtn)

      const summary = new Gtk.Label({
        label: item.summary || "(no title)",
        css_classes: ["notification-title"],
        xalign: 0,
        ellipsize: Pango.EllipsizeMode.END,
        max_width_chars: 48,
        hexpand: true
      })

      const body = new Gtk.Label({
        label: item.body,
        css_classes: ["notification-body"],
        xalign: 0,
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD_CHAR,
        max_width_chars: 64,
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
      row.append(summary)
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
  // Human readable network speeds
  const formatSpeed = (bps: number) => {
    const abs = Math.max(0, bps)
    if (abs > 1e9) return `${(abs / 1e9).toFixed(2)} GiB/s`
    if (abs > 1e6) return `${(abs / 1e6).toFixed(2)} MiB/s`
    if (abs > 1e3) return `${(abs / 1e3).toFixed(1)} KiB/s`
    return `${abs.toFixed(0)} B/s`
  }

  // Aggregate rx/tx across interfaces (excluding lo)
  const readNetwork = async () => {
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
        return { down: 0, up: 0 }
      }
      const dt = Math.max(0.5, now - lastNet.ts)
      const down = (rx - lastNet.rx) / dt
      const up = (tx - lastNet.tx) / dt
      lastNet = { rx, tx, ts: now }
      return { down, up }
    } catch (err) {
      console.error("Network read failed:", err)
      return { down: 0, up: 0 }
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
    const cpu = await readCpuUsage()
    cpuGauge.update(cpu, "")

    const ram = await readRamUsage()
    ramGauge.update(ram.pct, "")

    const gpu = await readGpu()
    gpuGauge.update(gpu.pct, gpu.detail || "n/a")

    const storage = await readStorageAll()
    storageGauge.update(storage.totalPct, storage.volumes.length ? `${storage.volumes.length} vols` : "n/a")
    renderStorageList(storage.volumes)
    storageStatus.label = storage.volumes.length
      ? `Total ${storage.totalPct}% across ${storage.volumes.length} vols`
      : "No disks detected"
  }

  // Update network card
  const refreshNetwork = async () => {
    const net = await readNetwork()
    netLabel.label = "Network"
    netDetail.label = `Down ${formatSpeed(net.down)} · Up ${formatSpeed(net.up)}`
  }

  // Update uptime/updates/media cards
  const refreshMeta = async () => {
    uptimeDetail.label = await readUptime()
    updatesDetail.label = await readUpdates()
    mediaDetail.label = await readMedia()
  }

  const refreshNotifications = () => {
    renderNotificationList(getNotificationHistory())
  }

  // Full dashboard refresh flow
  const refreshDashboard = async () => {
    applyProfile(loadProfile())
    loadTodo()
    refreshGauges()
    refreshNetwork()
    refreshMeta()
    refreshNotifications()

    const windows = await fetchWindows()
    renderList(
      windowsBox,
      windows,
      (item) => {
        const row = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8, css_classes: ["dashboard-list-row", "windows-row"], hexpand: true })
        const appLabel = new Gtk.Label({
          label: item.app,
          xalign: 0,
          css_classes: ["muted", "window-app"],
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 12,
          width_chars: 12
        })
        const titleLabel = new Gtk.Label({
          label: item.title,
          xalign: 0,
          hexpand: true,
          ellipsize: Pango.EllipsizeMode.END,
          max_width_chars: 44,
          css_classes: ["window-title"]
        })
        const wsLabel = new Gtk.Label({
          label: `WS ${item.workspace}`,
          xalign: 1,
          halign: Gtk.Align.END,
          ellipsize: Pango.EllipsizeMode.END,
          width_chars: 6,
          max_width_chars: 6,
          css_classes: ["window-workspace"]
        })
        wsLabel.set_hexpand(false)
        row.append(appLabel)
        row.append(titleLabel)
        row.append(wsLabel)
        return row
      }
    )
  }

  const stopNotificationsListener = onNotificationUpdate(() => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      refreshNotifications()
      return GLib.SOURCE_REMOVE
    })
  })

  // Profile summary card
  const profileCard = (
    <box
      class="dashboard-card profile-card"
      orientation={Gtk.Orientation.VERTICAL}
      valign={Gtk.Align.START}
    >
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
    <box class="dashboard-card" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
      <box spacing={8} valign={Gtk.Align.CENTER}>
        <label label="Disks" class="card-title" xalign={0} hexpand />
      </box>
      {storageStatus}
      <scrolledwindow 
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
    <box class="dashboard-card" orientation={Gtk.Orientation.VERTICAL} spacing={4}>
      {netLabel}
      {netDetail}
    </box>
  )

  // Uptime/updates card
  const uptimeCard = (
    <box class="dashboard-card" orientation={Gtk.Orientation.VERTICAL} spacing={4}>
      {uptimeLabel}
      {uptimeDetail}
      {updatesDetail}
    </box>
  )

  // Media now-playing card
  const mediaCard = (
    <box class="dashboard-card" orientation={Gtk.Orientation.VERTICAL} spacing={6} height_request={72}>
      {mediaLabel}
      {mediaDetail}
    </box>
  )

  // Calendar widget card
  const calendarCard = (
    <box class="dashboard-card" orientation={Gtk.Orientation.VERTICAL} spacing={6} height_request={190} valign={Gtk.Align.START}>
      {calendar}
    </box>
  )

  const POWER_PROFILE_ICONS: Record<string, string> = {
    performance: "󰓅",
    balanced: "󰾆",
    "power-saver": "󰔏"
  }

  const powerCard = (
    <box class="dashboard-card power-card" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
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
    <box class="dashboard-card notification-card" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box class="notification-card-header" spacing={8} valign={Gtk.Align.CENTER}>
        <label label="Notifications" class="card-title" xalign={0} hexpand={true} />
        {notificationClear}
      </box>
      {notificationScroll}
      {notificationEmpty}
    </box>
  )

  // TODO preview with Obsidian link
  const todoCard = (
    <box class="dashboard-card" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
      <label label="Obsidian TODO" class="card-title" xalign={0} />
      <scrolledwindow 
        vexpand={true} 
        min_content_height={TODO_LIST_HEIGHT}
      >
        {todoList}
      </scrolledwindow>
      <box halign={Gtk.Align.END}>
        <button
          class="pill-button"
          onClicked={() =>
            execAsync(`obsidian "${OBSIDIAN_URI}"`).catch(() =>
              execAsync(`xdg-open "${TODO_PATH}"`).catch(console.error)
            ).finally(() => hideDashboard())
          }
        >
          <label label="Open" />
        </button>
      </box>
    </box>
  )

  // Running windows list
  const activityCard = (
    <box class="dashboard-card" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
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

  // Close button to hide the dashboard
  const closeButton = (
    <button class="dashboard-close" onClicked={hideDashboard}>
      <label label="✕ CLOSE" />
    </button>
  )

  const columnGroup = new Gtk.SizeGroup({ mode: Gtk.SizeGroupMode.VERTICAL })

  // Column stack: profile + utilities
  const leftColumn = (
    <box class="dashboard-column left" orientation={Gtk.Orientation.VERTICAL} spacing={8} width_request={400}>
      {profileCard}
      {mediaCard}
      {todoCard}
      {uptimeCard}
      {networkCard}
    </box>
  ) as Gtk.Widget
  columnGroup.add_widget(leftColumn)

  // Column stack: gauges
  const middleColumn = (
    <box class="dashboard-column middle" orientation={Gtk.Orientation.VERTICAL} spacing={10} width_request={190} hexpand={true}>
      <box class="gauge-stack" orientation={Gtk.Orientation.VERTICAL} spacing={10} valign={Gtk.Align.START} halign={Gtk.Align.CENTER} margin_top={-4}>
        {cpuGauge.widget}
        {ramGauge.widget}
        {gpuGauge.widget}
        {storageGauge.widget}
      </box>
    </box>
  ) as Gtk.Widget
  columnGroup.add_widget(middleColumn)

  // Column stack: calendar + disks + windows
  const rightColumn = (
    <box class="dashboard-column right" orientation={Gtk.Orientation.VERTICAL} spacing={8} width_request={400}>
      {calendarCard}
      {storageCard}
      {activityCard}
    </box>
  ) as Gtk.Widget
  columnGroup.add_widget(rightColumn)

  // Column stack: power + notifications
  const extraColumn = (
    <box class="dashboard-column extra" orientation={Gtk.Orientation.VERTICAL} spacing={8} width_request={360}>
      {powerCard}
      {notificationCard}
    </box>
  ) as Gtk.Widget
  columnGroup.add_widget(extraColumn)

  // Main surface containing top controls and columns
  const layout = (
    <box
      class="dashboard-surface"
      orientation={Gtk.Orientation.VERTICAL}
      spacing={10}
      hexpand={true}
      vexpand={true}
    >
      <box halign={Gtk.Align.END} class="top-controls">
        {closeButton}
      </box>
      <box class="dashboard-columns" spacing={8} hexpand={true}>
        {leftColumn}
        {middleColumn}
        {rightColumn}
        {extraColumn}
      </box>
    </box>
  )

  // Centered overlay on the monitor
  const overlay = (
    <box
      class="dashboard-overlay"
      hexpand={true}
      vexpand={true}
      halign={Gtk.Align.CENTER}
      valign={Gtk.Align.CENTER}
    >
      {layout}
    </box>
  )

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
      // Handle focus/esc + periodic refreshes
      onRealize={(self) => {
        try {
          self.set_focusable(true)
          if ("set_focus_on_map" in self) {
            // @ts-expect-error gtk4 types
            self.set_focus_on_map(true)
          }
          self.grab_focus()
        } catch (err) {
          console.error("Dashboard focus setup failed:", err)
        }

        const keyController = new Gtk.EventControllerKey()
        keyController.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        keyController.connect("key-pressed", (_ctrl, keyval) => {
          if (keyval === Gdk.KEY_Escape) {
            hideDashboard()
            return true
          }
          return false
        })
        self.add_controller(keyController)

        const focusController = new Gtk.EventControllerFocus()
        focusController.connect("leave", () => hideDashboard())
        self.add_controller(focusController)

        // Keep gauges warm while window stays open
        timeout(500, () => {
          refreshGauges()
          return true
        })

        // Network poll
        timeout(1000, () => {
          refreshNetwork()
          return true
        })

        // Slower meta poll (uptime/updates/media)
        timeout(3000, () => {
          refreshMeta()
          return true
        })
      }}
    >
      {overlay}
    </window>
  ) as Astal.Window

  win.connect("destroy", () => stopNotificationsListener())

  // Expose refresh + show/hide hooks to the rest of the app
  registerDashboard(win, refreshDashboard)
  refreshDashboard()

  return win
}
