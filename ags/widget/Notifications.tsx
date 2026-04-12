import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { execAsync } from "ags/process"
import Gio from "gi://Gio?version=2.0"
import GLib from "gi://GLib?version=2.0"
import Pango from "gi://Pango?version=1.0"
import { resolveWindowIcon } from "./iconResolver"

type Popup = {
  id: number
  appName: string
  summary: string
  body: string
  created: number
  timeout: number
}

const IFACE_XML = `
<node>
  <interface name="org.freedesktop.Notifications">
    <method name="Notify">
      <arg type="s" name="app_name" direction="in"/>
      <arg type="u" name="replaces_id" direction="in"/>
      <arg type="s" name="app_icon" direction="in"/>
      <arg type="s" name="summary" direction="in"/>
      <arg type="s" name="body" direction="in"/>
      <arg type="as" name="actions" direction="in"/>
      <arg type="a{sv}" name="hints" direction="in"/>
      <arg type="i" name="expire_timeout" direction="in"/>
      <arg type="u" name="id" direction="out"/>
    </method>
    <method name="CloseNotification">
      <arg type="u" name="id" direction="in"/>
    </method>
    <method name="GetCapabilities">
      <arg type="as" name="caps" direction="out"/>
    </method>
    <method name="GetServerInformation">
      <arg type="s" name="name" direction="out"/>
      <arg type="s" name="vendor" direction="out"/>
      <arg type="s" name="version" direction="out"/>
      <arg type="s" name="spec_version" direction="out"/>
    </method>
  </interface>
</node>
`

const nodeInfo = Gio.DBusNodeInfo.new_for_xml(IFACE_XML)
const ifaceInfo = nodeInfo.interfaces[0]

const popups: Popup[] = []
const popupTimeouts = new Map<number, number>()
const popupRevealers = new Map<number, Gtk.Revealer>()
const popupClosures = new Map<number, number>()
const listeners = new Set<() => void>()
let nextId = 1
let exported: Gio.DBusExportedObject | null = null
let nameOwnerId: number | null = null
let popupWindow: Astal.Window | null = null

const notifyListeners = () => {
  listeners.forEach((fn) => fn())
}

const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

const clearPopupTimeout = (id: number) => {
  const tag = popupTimeouts.get(id)
  if (tag) {
    GLib.source_remove(tag)
    popupTimeouts.delete(id)
  }
}

const clearPopupClosure = (id: number) => {
  const tag = popupClosures.get(id)
  if (tag) {
    GLib.source_remove(tag)
    popupClosures.delete(id)
  }
}

const finalizePopupRemoval = (id: number) => {
  clearPopupTimeout(id)
  clearPopupClosure(id)
  popupRevealers.delete(id)
  const idx = popups.findIndex((p) => p.id === id)

  if (idx >= 0) {
    popups.splice(idx, 1)
    notifyListeners()
  }
}

const removePopup = (id: number) => {
  const revealer = popupRevealers.get(id)
  if (revealer && revealer.reveal_child) {
    clearPopupTimeout(id)
    clearPopupClosure(id)
    revealer.reveal_child = false
    const tag = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 220, () => {
      popupClosures.delete(id)
      finalizePopupRemoval(id)
      return GLib.SOURCE_REMOVE
    })
    popupClosures.set(id, tag)
    return
  }

  finalizePopupRemoval(id)
}

const clearPopups = () => {
  if (!popups.length) return
  popups.slice().forEach((popup) => removePopup(popup.id))
}

const schedulePopupTimeout = (entry: Popup) => {
  clearPopupTimeout(entry.id)
  const timeoutMs = entry.timeout > 0 ? entry.timeout : 5000
  const tag = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
    popupTimeouts.delete(entry.id)
    removePopup(entry.id)
    return GLib.SOURCE_REMOVE
  })
  popupTimeouts.set(entry.id, tag)
}

const playNotificationSound = () => {
  void execAsync(
    "sh -c 'command -v canberra-gtk-play >/dev/null 2>&1 && canberra-gtk-play -i message-new-instant >/dev/null 2>&1 || command -v canberra-gtk-play >/dev/null 2>&1 && canberra-gtk-play -i dialog-information >/dev/null 2>&1 || paplay /usr/share/sounds/freedesktop/stereo/message.oga >/dev/null 2>&1 || paplay /usr/share/sounds/freedesktop/stereo/dialog-information.oga >/dev/null 2>&1 || true'"
  ).catch(() => {})
}

const addPopup = (entry: Popup) => {
  const existing = popups.findIndex((p) => p.id === entry.id)
  if (existing >= 0) {
    popups.splice(existing, 1, entry)
  } else {
    popups.unshift(entry)
    if (popups.length > 4) {
      const dropped = popups.pop()
      if (dropped) clearPopupTimeout(dropped.id)
    }
    playNotificationSound()
  }

  notifyListeners()

  schedulePopupTimeout(entry)
}

const ensureNotificationService = () => {
  if (exported) return
  try {
    const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null)
    exported = Gio.DBusExportedObject.wrapJSObject(ifaceInfo, {
      Notify(
        app_name: string,
        replaces_id: number,
        _app_icon: string,
        summary: string,
        body: string,
        _actions: string[],
        _hints: Record<string, unknown>,
        expire_timeout: number
      ) {
        const id = replaces_id && replaces_id !== 0 ? replaces_id : nextId++
        addPopup({
          id,
          appName: app_name || "App",
          summary: summary || "(no title)",
          body: body || "",
          created: Date.now(),
          timeout: expire_timeout
        })
        return id
      },
      CloseNotification(id: number) {
        removePopup(id)
      },
      GetCapabilities() {
        return ["body", "persistence"]
      },
      GetServerInformation() {
        return ["ags-notify", "ags", "1.0", "1.2"]
      }
    })

    exported.export(bus, "/org/freedesktop/Notifications")
    nameOwnerId = Gio.bus_own_name_on_connection(
      bus,
      "org.freedesktop.Notifications",
      Gio.BusNameOwnerFlags.NONE,
      null,
      null
    )
  } catch (err) {
    console.error("Notification service start failed:", err)
  }
}

const formatTime = (ts: number) => {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

const buildPopupRow = (popup: Popup) => {
  const box = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
    css_classes: ["notification-popup"]
  })

  const iconWrap = new Gtk.Box({
    css_classes: ["notification-app-icon-wrap"],
    valign: Gtk.Align.START
  })
  iconWrap.append(
    new Gtk.Image({
      icon_name: resolveWindowIcon(popup.appName, popup.summary),
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
    label: popup.appName || "App",
    css_classes: ["notification-app"],
    xalign: 0,
    hexpand: true,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 22
  })
  const title = new Gtk.Label({
    label: popup.summary,
    css_classes: ["notification-title"],
    xalign: 0,
    wrap: true,
    wrap_mode: Pango.WrapMode.WORD_CHAR,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 34
  })
  meta.append(appLabel)
  meta.append(title)

  const header = new Gtk.Box({ spacing: 10, hexpand: true, valign: Gtk.Align.START })
  const timeLabel = new Gtk.Label({
    label: formatTime(popup.created),
    css_classes: ["notification-time"],
    xalign: 1,
    halign: Gtk.Align.END,
    width_chars: 6
  })
  const closeBtn = new Gtk.Button({
    css_classes: ["notification-close"],
    halign: Gtk.Align.END,
    valign: Gtk.Align.START,
    tooltip_text: "Dismiss"
  })
  closeBtn.set_child(new Gtk.Image({ icon_name: "window-close-symbolic", pixel_size: 15 }))
  closeBtn.connect("clicked", () => removePopup(popup.id))

  header.append(iconWrap)
  header.append(meta)
  header.append(timeLabel)
  header.append(closeBtn)

  const body = new Gtk.Label({
    label: popup.body,
    css_classes: ["notification-body"],
    xalign: 0,
    wrap: true,
    wrap_mode: Pango.WrapMode.WORD_CHAR,
    max_width_chars: 42,
    visible: !!popup.body
  })

  box.append(header)
  box.append(body)

  box.add_controller(
    (() => {
      const click = new Gtk.GestureClick()
      click.connect("released", () => {
        removePopup(popup.id)
        return GLib.SOURCE_REMOVE
      })
      return click
    })()
  )

  const reveal = new Gtk.Revealer({
    transition_type: Gtk.RevealerTransitionType.SLIDE_DOWN,
    transition_duration: 220,
    reveal_child: false
  })
  reveal.set_child(box)
  popupRevealers.set(popup.id, reveal)
  reveal.connect("destroy", () => {
    popupRevealers.delete(popup.id)
    clearPopupClosure(popup.id)
  })
  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    reveal.reveal_child = true
    return GLib.SOURCE_REMOVE
  })

  return reveal
}

export default function Notifications(gdkmonitor: Gdk.Monitor) {
  ensureNotificationService()

  const popupList = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 8
  })

  const clearBtn = new Gtk.Button({
    label: "Clear",
    css_classes: ["pill-button", "notification-clear"],
    halign: Gtk.Align.END
  })
  clearBtn.set_sensitive(false)
  clearBtn.connect("clicked", () => clearPopups())

  const headerBar = new Gtk.Box({
    spacing: 8,
    css_classes: ["notification-popup-header"]
  })
  headerBar.append(
    new Gtk.Label({
      label: "Notifications",
      css_classes: ["notification-popup-title"],
      xalign: 0,
      hexpand: true
    })
  )
  headerBar.append(clearBtn)

  const container = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 8,
    css_classes: ["notification-popups"]
  })
  container.append(headerBar)
  container.append(popupList)

  const rebuild = () => {
    let child = popupList.get_first_child()
    while (child) {
      popupList.remove(child)
      child = popupList.get_first_child()
    }

    popups.forEach((p) => popupList.append(buildPopupRow(p)))
    const hasPopups = popups.length > 0
    popupList.visible = hasPopups
    container.visible = hasPopups
    headerBar.visible = hasPopups
    clearBtn.sensitive = hasPopups
    if (popupWindow) popupWindow.visible = hasPopups
  }

  const unsub = subscribe(() => {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      rebuild()
      return GLib.SOURCE_REMOVE
    })
  })

  rebuild()

  const win = (
    <window
      name="notifications"
      class="notifications"
      gdkmonitor={gdkmonitor}
      anchor={Astal.WindowAnchor.TOP | Astal.WindowAnchor.RIGHT}
      application={app}
      exclusivity={Astal.Exclusivity.IGNORE}
      visible={true}
    >
      <box
        valign={Gtk.Align.START}
        halign={Gtk.Align.END}
        margin_top={16}
        margin_end={16}
        margin_start={16}
        margin_bottom={16}
      >
        {container}
      </box>
    </window>
  ) as Astal.Window
  popupWindow = win

  win.connect("destroy", () => {
    unsub()
    if (nameOwnerId) {
      Gio.bus_unown_name(nameOwnerId)
      nameOwnerId = null
    }
    exported = null
  })

  return win
}
