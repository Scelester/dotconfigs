import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { createPoll } from "ags/time"
import TrayWidget from "./Tray"
import { toggleDashboard } from "./dashboardState"

type MusicState = {
  status: string
  metadata: string
  source: "playerctl" | "mpc" | "none"
}

export default function Bar(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor

  const time = createPoll("", 1000, "date +'%H:%M'")
  const date = createPoll("", 1000, "date +'%a %d %b'")

  const activeWorkspace = createPoll(
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

  const workspacesWithWindows = createPoll(
    [] as number[],
    500,
    async () => {
      try {
        const clients = await execAsync("hyprctl clients -j")
        const json = JSON.parse(clients)
        const workspaces = [...new Set(json.map((c: any) => c.workspace.id))]
        return workspaces.filter((w: number) => w >= 1 && w <= 7)
      } catch {
        return []
      }
    }
  )

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

  const musicStatus = createPoll<MusicState>(
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
  const volumeStatus = createPoll(
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

  const brightnessStatus = createPoll(
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
  const microphoneStatus = createPoll(
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

  const batteryStatus = createPoll(
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


  return [
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
              onClicked={() => execAsync("/home/scelester/.config/rofi/scripts/launcher_t1").catch(console.error)}
            >
              <label label="󰣇" />
            </button>

            <box class="workspaces" spacing={4}>
              {Array.from({ length: 7 }, (_, i) => i + 1).map((ws) => (
                <button
                  class={activeWorkspace((active) =>
                    active === ws.toString() ? "workspace-btn active" : "workspace-btn"
                  )}
                  onClicked={() => execAsync(`hyprctl dispatch workspace ${ws}`).catch(console.error)}
                >
                  <label
                    class="ws-circle"
                    label={workspacesWithWindows((windows) =>
                      windows.includes(ws) ? "■" : "□"
                    )}
                  />
                </button>
              ))}
            </box>
          </box>
        }
        center_widget={
          <box class="center-section">
            <button
              onClicked={async () => {
                try {
                  const current = musicStatus.get()
                  if (current?.source === "mpc") {
                    await execAsync("mpc toggle")
                  } else {
                    await execAsync("playerctl play-pause")
                  }
                } catch (err) {
                  console.error("Music toggle failed:", err)
                }
              }}
              class="music-player"
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
                    return tagged.length > 30 ? tagged.substring(0, 30) + "..." : tagged
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
  ]
}
