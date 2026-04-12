import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { createPoll } from "ags/time"
import TrayWidget from "./Tray"
import { toggleDashboard } from "./dashboardState"
import { getFallbackIcon, resolveWindowIcon } from "./iconResolver"
import Pango from "gi://Pango"

type MusicState = {
  status: string
  metadata: string
  source: "playerctl" | "mpc" | "none"
}

type ActiveWindow = {
  title: string
  app: string
  icon: string
}

type WorkspaceSummary = {
  id: number
  icons: string[]
}

export default function Bar(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor

  const fallbackIcon = getFallbackIcon()

  const safePoll = <T,>(init: T, interval: number, fn: (prev: T) => T | Promise<T>) =>
    createPoll(init, interval, async (prev) => {
      try {
        return await fn(prev)
      } catch (err) {
        console.error("Bar poll failed:", err)
        return prev
      }
    })

  const time = safePoll("", 1000, async () => {
    try {
      return (await execAsync("date +'%H:%M'")).trim()
    } catch {
      return "--:--"
    }
  })
  const date = safePoll("", 1000, async () => {
    try {
      return (await execAsync("date +'%a %d %b'")).trim()
    } catch {
      return "Date"
    }
  })

  const activeWorkspace = safePoll(
    "1",
    300,
    async () => {
      try {
        const active = await execAsync("hyprctl activeworkspace -j")
        const json = JSON.parse(active)
        return json.id.toString()
      } catch {
        return "1"
      }
    }
  )

  const workspaceIcons = safePoll<WorkspaceSummary[]>(
    [],
    800,
    async () => {
      try {
        const clients = await execAsync("hyprctl clients -j")
        const json = JSON.parse(clients)
        const grouped = new Map<number, string[]>()

        json.forEach((c: any) => {
          const ws = c.workspace?.id
          if (typeof ws !== "number" || ws < 1 || ws > 7) return
          const app = c.class || c.app || c.initialClass || "App"
          const title = c.title || c.initialTitle || app
          const icon = resolveWindowIcon(app, title)
          const list = grouped.get(ws) || []
          if (!list.includes(icon)) list.push(icon)
          grouped.set(ws, list.slice(0, 3))
        })

        return Array.from(grouped.entries())
          .map(([id, icons]) => ({ id, icons }))
          .sort((a, b) => a.id - b.id)
      } catch {
        return []
      }
    }
  )

  const activeWindowStatus = safePoll<ActiveWindow>(
    { title: "Desktop", app: "Desktop", icon: fallbackIcon },
    500,
    async () => {
      try {
        const active = await execAsync("hyprctl activewindow -j")
        const json = JSON.parse(active)
        const app = json.class || json.initialClass || json.app || "Desktop"
        const title = json.title || json.initialTitle || app || "Desktop"
        return { title, app, icon: resolveWindowIcon(app, title) }
      } catch {
        return { title: "Desktop", app: "Desktop", icon: fallbackIcon }
      }
    }
  )

  const activeWindowIcon = new Gtk.Image({
    icon_name: fallbackIcon,
    pixel_size: 16,
    css_classes: ["active-window-icon"]
  })
  const activeWindowTitle = new Gtk.Label({
    label: "Desktop",
    xalign: 0,
    hexpand: true,
    ellipsize: Pango.EllipsizeMode.END,
    max_width_chars: 22,
    css_classes: ["active-window-title"]
  })
  const activeWindowBox = new Gtk.Box({
    spacing: 6,
    css_classes: ["active-window"],
    valign: Gtk.Align.CENTER
  })
  activeWindowBox.append(activeWindowIcon)
  activeWindowBox.append(activeWindowTitle)

  const updateActiveWindow = () => {
    const state = activeWindowStatus.get()
    activeWindowTitle.label = state.title || state.app || "Desktop"
    activeWindowIcon.icon_name = state.icon || fallbackIcon
  }
  updateActiveWindow()
  activeWindowStatus.subscribe(updateActiveWindow)
  activeWindowStatus.subscribe(() => renderWorkspaceIcons(workspaceIcons.get()))

  const workspaceIconBoxes: Gtk.Box[] = []
  const workspaceButtons: Gtk.Button[] = []
  const setWorkspaceButtonState = (button: Gtk.Button, wsId: number, hasIcons: boolean) => {
    const cssClasses = ["workspace-btn"]
    if (hasIcons) cssClasses.push("occupied")
    else cssClasses.push("empty")
    if (activeWorkspace.get() === wsId.toString()) cssClasses.push("active")
    button.set_css_classes(cssClasses)
  }

  const renderWorkspaceIcons = (summaries: WorkspaceSummary[]) => {
    const summaryMap = new Map(summaries.map((s) => [s.id, s.icons]))
    const activeWsId = parseInt(activeWorkspace.get() || "0", 10) || 0

    workspaceIconBoxes.forEach((box, idx) => {
      const wsId = idx + 1
      const icons = summaryMap.get(wsId) || []
      const button = workspaceButtons[idx]
      const isActive = wsId === activeWsId
      let child = box.get_first_child()
      while (child) {
        box.remove(child)
        child = box.get_first_child()
      }

      box.append(
        new Gtk.Label({
          label: `${wsId}`,
          css_classes: ["workspace-number", isActive ? "active" : "inactive"]
        })
      )

      if (icons.length) {
        icons.slice(0, isActive ? 2 : 3).forEach((iconName) => {
          box.append(
            new Gtk.Image({
              icon_name: iconName,
              pixel_size: 13,
              css_classes: ["workspace-icon"]
            })
          )
        })
      }

      if (button) setWorkspaceButtonState(button, wsId, icons.length > 0)
    })
  }

  const readPlayerctl = async (): Promise<MusicState> => {
    try {
      const status = await execAsync("playerctl status --ignore-player=chromium")
      const metadata = await execAsync("playerctl metadata --format '{{artist}} - {{title}}' --ignore-player=chromium")
      return { status: status.trim(), metadata: metadata.trim(), source: "playerctl" }
    } catch {
      return { status: "NoPlayer", metadata: "No music", source: "none" }
    }
  }

  const readMpc = async (): Promise<MusicState | null> => {
    try {
      const out = await execAsync("mpc status")
      const lines = out.split("\n").filter((l) => l.trim().length > 0)
      if (!lines.length) return null
      const title = lines[0]?.trim() || ""
      const stateLine = lines[1] || ""
      const status = stateLine.includes("[playing]")
        ? "Playing"
        : stateLine.includes("[paused]")
        ? "Paused"
        : "Stopped"
      return { status, metadata: title || "mpc", source: "mpc" }
    } catch {
      return null
    }
  }

  const runMediaAction = async (playerctlCommand: string, mpcCommand?: string) => {
    const current = musicStatus.get()

    if (current?.source === "mpc" && mpcCommand) {
      await execAsync(mpcCommand).catch(console.error)
      return
    }

    try {
      await execAsync(playerctlCommand)
    } catch (err) {
      if (mpcCommand) {
        await execAsync(mpcCommand).catch(console.error)
        return
      }
      console.error("Media action failed:", err)
    }
  }

  const adjustMediaVolume = async (direction: "up" | "down") => {
    const current = musicStatus.get()

    if (current?.source === "mpc") {
      await execAsync(direction === "up" ? "mpc volume +5" : "mpc volume -5").catch(console.error)
      return
    }

    await execAsync(direction === "up" ? "playerctl volume 0.05+" : "playerctl volume 0.05-").catch(console.error)
  }

  const musicStatus = safePoll<MusicState>(
    { status: "NoPlayer", metadata: "No music", source: "none" },
    1000,
    async () => {
      const [playerctl, mpc] = await Promise.all([readPlayerctl(), readMpc()])
      if (playerctl.status === "Playing") return playerctl
      if (mpc?.status === "Playing") return mpc
      if (playerctl.status !== "NoPlayer" && playerctl.status !== "Stopped" && playerctl.metadata && playerctl.metadata !== "No music") {
        return playerctl
      }
      if (mpc) return mpc
      return { status: "NoPlayer", metadata: "No music", source: "none" }
    }
  )

  // System status polls with OSD integration
  const volumeStatus = safePoll(
    { volume: "100", isMuted: false },
    300,
    async () => {
      try {
        const vol = await execAsync("pamixer --get-volume")
        const muted = await execAsync("pamixer --get-mute")
        return { volume: vol.trim(), isMuted: muted.trim() === "true" }
      } catch {
        return { volume: "100", isMuted: false }
      }
    }
  )

  const brightnessStatus = safePoll(
    100,
    300,
    async () => {
      try {
        const bright = await execAsync("brightnessctl g")
        const max = await execAsync("brightnessctl m")
        return Math.round((parseInt(bright) / parseInt(max)) * 100)
      } catch {
        return 100
      }
    }
  )

  // Microphone status polling
  const microphoneStatus = safePoll(
    { isMuted: false },
    500,
    async () => {
      try {
        const muted = await execAsync("pamixer --default-source --get-mute")
        return { isMuted: muted.trim() === "true" }
      } catch {
        return { isMuted: false }
      }
    }
  )

  const batteryStatus = safePoll(
    { percentage: 100, status: "Full", isCharging: false },
    10000,
    async () => {
      try {
        const battery = await execAsync(
          "sh -c 'cat /sys/class/power_supply/BAT*/capacity 2>/dev/null | head -n1'"
        );
        const status = await execAsync(
          "sh -c 'cat /sys/class/power_supply/BAT*/status 2>/dev/null | head -n1'"
        );

        const percentage = parseInt(battery.trim(), 10);
        const stat = status.trim();

        return {
          percentage: percentage || 0,
          status: stat || "Unknown",
          isCharging: stat === "Charging"
        };
      } catch (err) {
        console.error("ERROR reading battery:", err);
        return { percentage: 100, status: "Full", isCharging: false };
      }
    }
  );


  const barWindow = (
    // Main Bar Window
    <window
      visible={true}
      name="bar"
      class="bar"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      anchor={TOP | LEFT | RIGHT}
      application={app}
    >
      <centerbox
        class="bar-content"
        startWidget={
          <box class="left-section" spacing={12}>
            <button
              class="launcher"
              valign={Gtk.Align.CENTER}
              vexpand={false}
              onClicked={() => execAsync("/home/scelester/.config/rofi/scripts/launcher_t1").catch(console.error)}
            >
              <label label="x" />
            </button>

            <box class="workspaces" spacing={4}>
              {Array.from({ length: 7 }, (_, i) => i + 1).map((ws) => {
                const iconsBox = new Gtk.Box({
                  spacing: 3,
                  css_classes: ["workspace-icons"],
                  halign: Gtk.Align.CENTER,
                  valign: Gtk.Align.CENTER
                })
                workspaceIconBoxes[ws - 1] = iconsBox
                const button = new Gtk.Button({
                  css_classes: ["workspace-btn"],
                  valign: Gtk.Align.CENTER,
                  vexpand: false
                })
                workspaceButtons[ws - 1] = button
                button.connect("clicked", () => execAsync(`hyprctl dispatch workspace ${ws}`).catch(console.error))
                button.set_child(iconsBox)
                return button
              })}
            </box>

            {activeWindowBox}
          </box>
        }
        center_widget={
          <box class="center-section">
            <button
              onClicked={() => runMediaAction("playerctl play-pause", "mpc toggle")}
              class="music-player"
              tooltip_text="Left click: play/pause • Right click: next • Middle click: previous • Scroll: volume"
              onRealize={(self) => {
                const scroll = Gtk.EventControllerScroll.new(
                  Gtk.EventControllerScrollFlags.VERTICAL | Gtk.EventControllerScrollFlags.DISCRETE
                )
                scroll.connect("scroll", async (_ctrl, _dx, dy) => {
                  if (dy < 0) await adjustMediaVolume("up")
                  if (dy > 0) await adjustMediaVolume("down")
                  return Gdk.EVENT_STOP
                })

                const nextClick = new Gtk.GestureClick()
                nextClick.set_button(Gdk.BUTTON_SECONDARY)
                nextClick.connect("released", () => runMediaAction("playerctl next", "mpc next"))

                const prevClick = new Gtk.GestureClick()
                prevClick.set_button(Gdk.BUTTON_MIDDLE)
                prevClick.connect("released", () => runMediaAction("playerctl previous", "mpc prev"))

                self.add_controller(scroll)
                self.add_controller(nextClick)
                self.add_controller(prevClick)
              }}
            >
              <box spacing={8}>
                <label
                  label={musicStatus((m) => {
                    if (m?.status === "Playing") return "󰏤"
                    if (m?.status === "Paused") return "󰐊"
                    return "󰎈"
                  })}
                  class="music-icon"
                />
                <label
                  label={musicStatus((m) => {
                    const base = m?.metadata || "No music"
                    const tagged = m?.source === "mpc" ? `${base} · mpc` : base
                    return tagged.length > 40 ? tagged.substring(0, 39) + "…" : tagged
                  })}
                  class="music-info"
                />
              </box>
            </button>
          </box>
        }
        end_widget={
          <box class="right-section" spacing={12}>
            <box class="system-indicators" spacing={2}>


              {/* Brightness with OSD */}
              <box
                onRealize={(self) => {
                  const controller = Gtk.EventControllerScroll.new(
                    Gtk.EventControllerScrollFlags.VERTICAL
                  )
                  controller.connect("scroll", async (_ctrl, dx, dy) => {
                    if (dy < 0) {
                      await execAsync("brightnessctl set 5%+").catch(console.error)
                      const bright = await brightnessStatus.get()
                    } else if (dy > 0) {
                      await execAsync("brightnessctl set 5%-").catch(console.error)
                      const bright = await brightnessStatus.get()
                    }
                  })
                  self.add_controller(controller)
                }}
              >
                <button class="indicator">
                  <label
                    label={brightnessStatus((b) => {
                      const bright = b || 100
                      if (bright < 25) return "󰃞"
                      if (bright < 50) return "󰃟"
                      if (bright < 75) return "󰃝"
                      return "󰃠"
                    })}
                  />
                </button>
              </box>

              {/* Microphone Toggle with OSD */}
              <button
                class="indicator"
                onClicked={async () => {
                  await execAsync("pamixer --default-source -t").catch(console.error)
                  const mic = await microphoneStatus.get()
                }}
              >
                <label
                  label={microphoneStatus((m) => m?.isMuted ? "󰍭" : "󰍬")}
                />
              </button>

              {/* Volume with OSD */}
              <box
                onRealize={(self) => {
                  const controller = Gtk.EventControllerScroll.new(
                    Gtk.EventControllerScrollFlags.VERTICAL
                  )
                  controller.connect("scroll", async (_ctrl, dx, dy) => {
                    if (dy < 0) {
                      await execAsync("pamixer -i 5").catch(console.error)
                      const vol = await volumeStatus.get()
                    } else if (dy > 0) {
                      await execAsync("pamixer -d 5").catch(console.error)
                      const vol = await volumeStatus.get()
                    }
                  })
                  self.add_controller(controller)
                }}
              >
                <button
                  class="indicator"
                  onClicked={async () => {
                    await execAsync("pamixer -t").catch(console.error)
                    const vol = await volumeStatus.get()
                    // For toggle, we want to show the new state, so we pass the inverted muted state
                  }}

                >
                  <label
                    label={volumeStatus((v) => {
                      if (v?.isMuted) return "󰖁"
                      const vol = parseInt(v?.volume || "100")
                      if (vol === 0) return "󰕿"
                      if (vol < 50) return "󰖀"
                      return "󰕾"
                    })}
                  />
                </button>
              </box>

              {/* Battery Indicator with Percentage */}
              <button class="indicator battery">
                <box spacing={6}>
                  <label
                    label={batteryStatus((b) => {
                      if (b?.isCharging) return "󰂄"
                      const percentage = b?.percentage || 100
                      if (percentage >= 90) return "󰁹"
                      if (percentage >= 70) return "󰂀"
                      if (percentage >= 50) return "󰁾"
                      if (percentage >= 30) return "󰁻"
                      if (percentage >= 10) return "󰁺"
                      return "󰂎"
                    })}
                  />
                  <label
                    class="battery-percentage"
                    label={batteryStatus((b) => `${b?.percentage || 100}%`)}
                  />
                </box>
              </button>



            </box>

            <box class="tray-container">
              <TrayWidget />
            </box>

            <button class="datetime" onClicked={() => toggleDashboard()}>
              <box spacing={8}>
                <label label={time} class="time" />
                <label label={date} class="date" />
              </box>
            </button>
          </box>
        }
      />
    </window>
  )

  workspaceIcons.subscribe(renderWorkspaceIcons)
  activeWorkspace.subscribe(() => renderWorkspaceIcons(workspaceIcons.get()))
  renderWorkspaceIcons(workspaceIcons.get())

  return [barWindow]
}
