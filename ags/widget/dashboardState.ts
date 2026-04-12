import { Astal } from "ags/gtk4"

let dashboardWindow: Astal.Window | null = null

export const registerDashboard = (win: Astal.Window) => {
  dashboardWindow = win
}

export const toggleDashboard = () => {
  if (!dashboardWindow) return

  dashboardWindow.visible = !dashboardWindow.visible
}

export const hideDashboard = () => {
  if (!dashboardWindow) return
  dashboardWindow.visible = false
}

export const showDashboard = () => {
  if (!dashboardWindow) return
  dashboardWindow.visible = true
}
