import { Astal } from "ags/gtk4"

let dashboardWindow: Astal.Window | null = null
let dashboardController: {
  show: () => void
  hide: () => void
  toggle: () => void
} | null = null

export const registerDashboard = (
  win: Astal.Window,
  controller?: {
    show: () => void
    hide: () => void
    toggle: () => void
  }
) => {
  dashboardWindow = win
  dashboardController = controller || null
}

export const toggleDashboard = () => {
  if (dashboardController) {
    dashboardController.toggle()
    return
  }
  if (!dashboardWindow) return

  dashboardWindow.visible = !dashboardWindow.visible
}

export const hideDashboard = () => {
  if (dashboardController) {
    dashboardController.hide()
    return
  }
  if (!dashboardWindow) return
  dashboardWindow.visible = false
}

export const showDashboard = () => {
  if (dashboardController) {
    dashboardController.show()
    return
  }
  if (!dashboardWindow) return
  dashboardWindow.visible = true
}
