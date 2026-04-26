import { Astal, Gtk, Gdk } from "ags/gtk4"
import app from "ags/gtk4/app"
import { execAsync } from "ags/process"
import { timeout } from "ags/time"
import { getGamingModeState, subscribeGamingMode } from "./gamingModeState"

export default function GamingModeOverlay(gdkmonitor: Gdk.Monitor) {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

  const modeLabel = new Gtk.Label({
    label: "DESKTOP MODE",
    css_classes: ["gaming-mode-mode", "disabled"]
  })
  const iconLabel = new Gtk.Label({
    label: "󰮯",
    css_classes: ["gaming-mode-orb-icon"]
  })
  const stateLabel = new Gtk.Label({
    label: "STANDBY",
    css_classes: ["gaming-mode-orb-state"]
  })
  const orbCore = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 6,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
    css_classes: ["gaming-mode-orb-core"]
  })
  orbCore.append(iconLabel)
  orbCore.append(stateLabel)

  const orbRing = new Gtk.Box({
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
    css_classes: ["gaming-mode-orb-ring"]
  })
  orbRing.append(orbCore)

  const orbShell = new Gtk.Box({
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
    css_classes: ["gaming-mode-orb-shell", "disabled", "flash-a"]
  })
  orbShell.append(orbRing)

  const titleLabel = new Gtk.Label({
    label: "Gaming mode disabled",
    xalign: 0,
    css_classes: ["gaming-mode-title"]
  })
  const summaryLabel = new Gtk.Label({
    label: "Desktop profile active.",
    xalign: 0,
    wrap: true,
    css_classes: ["gaming-mode-summary"]
  })
  const arcadeLabel = new Gtk.Label({
    label: getGamingModeState().arcadeDir,
    xalign: 0,
    css_classes: ["gaming-mode-arcade"]
  })

  const copy = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 5,
    halign: Gtk.Align.CENTER,
    css_classes: ["gaming-mode-copy", "disabled"]
  })
  copy.append(modeLabel)
  copy.append(titleLabel)
  copy.append(summaryLabel)
  copy.append(arcadeLabel)

  const stage = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 18,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
    css_classes: ["gaming-mode-stage", "disabled", "flash-a"]
  })
  stage.append(orbShell)
  stage.append(copy)

  const win = (
    <window
      name="gaming-mode"
      class="gaming-mode"
      gdkmonitor={gdkmonitor}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      application={app}
      visible={false}
      exclusivity={Astal.Exclusivity.IGNORE}
    >
      <box halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER}>
        {stage}
      </box>
    </window>
  ) as Astal.Window

  let hideTimer: number | null = null
  let animationFlip = false
  const playOverlaySound = (enabled: boolean) => {
    const command = enabled
      ? "sh -c 'command -v canberra-gtk-play >/dev/null 2>&1 && canberra-gtk-play -i complete >/dev/null 2>&1 || paplay /home/scelester/MyScripts/game_mode_on.wav >/dev/null 2>&1 || true'"
      : "sh -c 'command -v canberra-gtk-play >/dev/null 2>&1 && canberra-gtk-play -i service-logout >/dev/null 2>&1 || paplay /home/scelester/MyScripts/game_mode_off.wav >/dev/null 2>&1 || true'"
    execAsync(command).catch(() => {})
  }

  const applyState = (announce: boolean) => {
    const state = getGamingModeState()
    const enabled = state.enabled
    const flipClass = animationFlip ? "flash-a" : "flash-b"

    iconLabel.label = enabled ? "󰮯" : "󰊴"
    stateLabel.label = enabled ? "PURE POWER" : "DESKTOP"
    modeLabel.label = enabled ? "GAMING MODE" : "DESKTOP MODE"
    modeLabel.set_css_classes(["gaming-mode-mode", enabled ? "enabled" : "disabled"])
    titleLabel.label = state.title
    summaryLabel.label = state.summary
    arcadeLabel.label = state.arcadeDir
    orbShell.set_css_classes([
      "gaming-mode-orb-shell",
      enabled ? "enabled" : "disabled",
      flipClass
    ])
    copy.set_css_classes(["gaming-mode-copy", enabled ? "enabled" : "disabled", flipClass])
    stage.set_css_classes(["gaming-mode-stage", enabled ? "enabled" : "disabled", flipClass])

    if (!announce) return

    animationFlip = !animationFlip
    win.visible = true
    playOverlaySound(enabled)

    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = timeout(2300, () => {
      win.visible = false
      hideTimer = null
    })
  }

  subscribeGamingMode((_state, changed) => applyState(changed))

  return win
}
