// tray.tsx - FIXED VERSION
import AstalTray from "gi://AstalTray"
import { Gtk } from "ags/gtk4"

export default function TrayWidget() {
  const tray = AstalTray.get_default()
  const container = new Gtk.Box({ spacing: 5 })

  const rebuild = () => {
    console.log(`Tray rebuild called. Items count: ${tray.items.length}`)
    
    // Clear old children - FIXED for GTK4
    let child = container.get_first_child()
    while (child) {
      container.remove(child)
      child = container.get_first_child()
    }

    // Log each tray item
    tray.items.forEach((item, index) => {
      console.log(`Tray item ${index}:`, {
        title: item.title,
        hasIcon: !!item.gicon,
        hasMenu: !!item.menu_model
      })
    })

    // Add current tray items
    for (const item of tray.items) {
      const button = new Gtk.MenuButton({ 
        tooltip_text: item.title,
        css_classes: ["tray-item"]
      })
      
      const image = new Gtk.Image({ 
        gicon: item.gicon, 
        pixel_size: 16
      })
      
      button.set_child(image)
      button.menu_model = item.menu_model
      
      if (item.action_group) {
        button.insert_action_group("dbusmenu", item.action_group)
      }

      // FIX: Use property assignment instead of set_gicon method
      item.connect("notify::gicon", () => {
        if (image) image.gicon = item.gicon
      })
      
      item.connect("notify::action-group", () => {
        if (item.action_group) {
          button.insert_action_group("dbusmenu", item.action_group)
        }
      })

      container.append(button)
    }

    // Show/hide container based on whether there are items
    container.visible = tray.items.length > 0
    console.log(`Container visible: ${container.visible}`)
  }

  // Initial build
  rebuild()

  // Connect to items change
  tray.connect("notify::items", rebuild)

  return container
}