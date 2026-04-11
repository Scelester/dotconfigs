// tray.tsx - FIXED VERSION
import GLib from "gi://GLib"
import AstalTray from "gi://AstalTray"
import { Gtk } from "ags/gtk4"

export default function TrayWidget() {
  const tray = AstalTray.get_default()
  const container = new Gtk.Box({ spacing: 5 })
  const signalMap = new Map<any, number[]>()
  let rebuildScheduled = false

  const disconnectAllSignals = () => {
    signalMap.forEach((handlers, item) => {
      handlers.forEach((id) => {
        try {
          item.disconnect(id)
        } catch {}
      })
    })
    signalMap.clear()
  }

  const attachItemSignals = (
    item: any,
    button: Gtk.MenuButton,
    image: Gtk.Image,
    applyActionGroup: () => void
  ) => {
    const handlerIds = [
      item.connect("notify::gicon", () => {
        image.gicon = item.gicon ?? null
      }),
      item.connect("notify::action-group", () => {
        applyActionGroup()
      }),
      item.connect("notify::menu-model", () => {
        button.menu_model = item.menu_model
      }),
    ]
    signalMap.set(item, handlerIds)
  }

  const rebuild = () => {
    disconnectAllSignals()

    let child = container.get_first_child()
    while (child) {
      container.remove(child)
      child = container.get_first_child()
    }

    tray.items.forEach((item) => {
      const button = new Gtk.MenuButton({
        tooltip_text: item.title,
        css_classes: ["tray-item"],
      })

      const image = new Gtk.Image({
        gicon: item.gicon ?? null,
        pixel_size: 16,
      })

      const applyActionGroup = () => {
        try {
          button.remove_action_group("dbusmenu")
        } catch {}
        if (item.action_group) {
          button.insert_action_group("dbusmenu", item.action_group)
        }
      }

      button.set_child(image)
      button.menu_model = item.menu_model
      applyActionGroup()
      attachItemSignals(item, button, image, applyActionGroup)
      container.append(button)
    })

    container.visible = tray.items.length > 0
  }

  const scheduleRebuild = () => {
    if (rebuildScheduled) return
    rebuildScheduled = true
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      rebuildScheduled = false
      rebuild()
      return GLib.SOURCE_REMOVE
    })
  }

  rebuild()
  tray.connect("notify::items", scheduleRebuild)

  return container
}
