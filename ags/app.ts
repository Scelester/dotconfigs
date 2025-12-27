import app from "ags/gtk4/app"
import style from "./style.scss"
import Bar from "./widget/Bar"
import OSD from "./widget/OSD"
import Dashboard from "./widget/Dashboard"
import Notifications from "./widget/Notifications"

app.start({
  css: style,
  main() {
    app.get_monitors().map(Bar),
    app.get_monitors().map(OSD),
    app.get_monitors().map(Dashboard),
    app.get_monitors().map(Notifications)
  },
})
