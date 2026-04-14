import app from "ags/gtk4/app"
import style from "./style.scss"
import Bar from "./widget/Bar"
import OSD from "./widget/OSD"
import Dashboard from "./widget/Dashboard"
import Notifications from "./widget/Notifications"
import GamingModeOverlay from "./widget/GamingModeOverlay"
import Gio from "gi://Gio"
import { hideDashboard, showDashboard, toggleDashboard } from "./widget/dashboardState"

const CONTROL_IFACE_XML = `
<node>
  <interface name="org.scelester.AGS">
    <method name="ToggleDashboard" />
    <method name="ShowDashboard" />
    <method name="HideDashboard" />
  </interface>
</node>
`

const controlNodeInfo = Gio.DBusNodeInfo.new_for_xml(CONTROL_IFACE_XML)
const controlIfaceInfo = controlNodeInfo.interfaces[0]
let controlExported: Gio.DBusExportedObject | null = null
let controlNameOwnerId: number | null = null

app.start({
  css: style,
  main() {
    const monitors = app.get_monitors()

    monitors.map(Bar)
    monitors.map(OSD)
    monitors.map(GamingModeOverlay)
    if (monitors[0]) Dashboard(monitors[0])
    monitors.map(Notifications)

    try {
      const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null)
      controlExported = Gio.DBusExportedObject.wrapJSObject(controlIfaceInfo, {
        ToggleDashboard() {
          toggleDashboard()
        },
        ShowDashboard() {
          showDashboard()
        },
        HideDashboard() {
          hideDashboard()
        }
      })

      controlExported.export(bus, "/org/scelester/AGS")
      controlNameOwnerId = Gio.bus_own_name_on_connection(
        bus,
        "org.scelester.AGS",
        Gio.BusNameOwnerFlags.NONE,
        null,
        null
      )
    } catch (err) {
      console.error("Dashboard control service start failed:", err)
    }
  },
})
