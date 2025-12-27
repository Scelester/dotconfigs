import { Astal } from "ags/gtk4"

let dashboardWindow: Astal.Window | null = null
let refreshDashboard: (() => void) | null = null

export const registerDashboard = (win: Astal.Window, refresh?: () => void) => {
  dashboardWindow = win
  refreshDashboard = refresh || null
}

export const toggleDashboard = () => {
  if (!dashboardWindow) return

  const nextVisible = !dashboardWindow.visible
  dashboardWindow.visible = nextVisible
  if (nextVisible) {
    refreshDashboard?.()
    dashboardWindow.present()
  }
}

export const hideDashboard = () => {
  if (!dashboardWindow) return
  dashboardWindow.visible = false
}

export const showDashboard = () => {
  if (!dashboardWindow) return
  dashboardWindow.visible = true
  refreshDashboard?.()
  dashboardWindow.present()
}
