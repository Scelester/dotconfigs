import { Astal, Gtk, Gdk } from "ags/gtk4"
import app from "ags/gtk4/app"
import { execAsync, subprocess } from "ags/process"
import { timeout } from "ags/time"
import GObject from "gi://GObject?version=2.0"

export default function OSD(gdkmonitor: Gdk.Monitor) {
  const { BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

  const ICONS = {
    volume: {
      mute: "󰖁",
      low: "󰕿",
      medium: "󰖀",
      high: "󰕾",
    },
    brightness: {
      low: "󰃞",
      medium: "󰃟",
      high: "󰃠",
    },
    microphone: {
      mute: "󰍭",
      unmute: "󰍬",
    },
  }

  // UI Elements
  const iconLabel = new Gtk.Label({ 
    label: ICONS.volume.high,
    css_classes: ["osd-icon"]
  })
  
  const progressBar = new Gtk.ProgressBar({
    css_classes: ["osd-progress"]
  })
  
  const percentLabel = new Gtk.Label({ 
    label: "50%",
    css_classes: ["osd-percent"]
  })

  let visible = false
  let hideTimeout: number | null = null

  // State tracking
  let lastVolumeMute: boolean | null = null
  let lastVolumeLevel: number | null = null
  let lastBrightness: number | null = null
  let lastMicMute: boolean | null = null

  // Create window first
  const win = (
    <window
      name="OSD"
      class="OSD"
      gdkmonitor={gdkmonitor}
      anchor={BOTTOM | LEFT | RIGHT}
      application={app}
      visible={false}
      exclusivity={Astal.Exclusivity.IGNORE}
    >
      <box 
        orientation={Gtk.Orientation.VERTICAL}
        spacing={16}
        valign={Gtk.Align.END}
        halign={Gtk.Align.CENTER}
      >
        <box 
          spacing={12}
          halign={Gtk.Align.CENTER}
          css_classes={["osd-container"]}
        >
          {iconLabel}
          {percentLabel}
        </box>
        {progressBar}
      </box>
    </window>
  ) as Astal.Window

  const showOSD = (icon: string, value: number, showProgress: boolean = true) => {
    iconLabel.label = icon
    progressBar.fraction = value / 100
    progressBar.visible = showProgress
    percentLabel.label = `${value}%`
    percentLabel.visible = showProgress
    
    win.visible = true
    
    // Clear existing timeout
    if (hideTimeout) {
      clearTimeout(hideTimeout)
    }
    
    // Set new timeout
    if (!visible) {
      visible = true
    }
    
    hideTimeout = timeout(1000, () => {
      win.visible = false
      visible = false
      hideTimeout = null
    })
  }

  // Volume monitoring
  const checkVolume = async () => {
    try {
      const volStr = await execAsync("pamixer --get-volume")
      const mutedStr = await execAsync("pamixer --get-mute")
      
      const volume = parseInt(volStr.trim())
      const isMuted = mutedStr.trim() === "true"
      
      // Show OSD on mute/unmute toggle
      if (lastVolumeMute !== null && lastVolumeMute !== isMuted) {
        const icon = isMuted ? ICONS.volume.mute : 
                     volume < 30 ? ICONS.volume.low :
                     volume < 70 ? ICONS.volume.medium : ICONS.volume.high
        showOSD(icon, isMuted ? 0 : volume)
      }
      // Show OSD on volume change
      else if (lastVolumeLevel !== null && lastVolumeLevel !== volume && !isMuted) {
        const icon = volume < 30 ? ICONS.volume.low :
                     volume < 70 ? ICONS.volume.medium : ICONS.volume.high
        showOSD(icon, volume)
      }
      
      lastVolumeMute = isMuted
      lastVolumeLevel = volume
    } catch (err) {
      console.error("Volume check error:", err)
    }
  }

  // Brightness monitoring
  const checkBrightness = async () => {
    try {
      const bright = await execAsync("brightnessctl g")
      const max = await execAsync("brightnessctl m")
      const percentage = Math.round((parseInt(bright) / parseInt(max)) * 100)
      
      if (lastBrightness !== null && lastBrightness !== percentage) {
        const icon = percentage < 30 ? ICONS.brightness.low :
                     percentage < 70 ? ICONS.brightness.medium : ICONS.brightness.high
        showOSD(icon, percentage)
      }
      
      lastBrightness = percentage
    } catch (err) {
      console.error("Brightness check error:", err)
    }
  }

  // Microphone monitoring
  const checkMic = async () => {
    try {
      const mutedStr = await execAsync("pamixer --default-source --get-mute")
      const isMuted = mutedStr.trim() === "true"
      
      if (lastMicMute !== null && lastMicMute !== isMuted) {
        showOSD(
          isMuted ? ICONS.microphone.mute : ICONS.microphone.unmute,
          isMuted ? 0 : 100,
          false // Don't show progress bar for mic
        )
      }
      
      lastMicMute = isMuted
    } catch (err) {
      console.error("Mic check error:", err)
    }
  }

  // Initialize state then start monitoring
  const initializeAndMonitor = async () => {
    // Initialize current states
    try {
      const volStr = await execAsync("pamixer --get-volume")
      const mutedStr = await execAsync("pamixer --get-mute")
      lastVolumeLevel = parseInt(volStr.trim())
      lastVolumeMute = mutedStr.trim() === "true"
    } catch {}

    try {
      const bright = await execAsync("brightnessctl g")
      const max = await execAsync("brightnessctl m")
      lastBrightness = Math.round((parseInt(bright) / parseInt(max)) * 100)
    } catch {}

    try {
      const mutedStr = await execAsync("pamixer --default-source --get-mute")
      lastMicMute = mutedStr.trim() === "true"
    } catch {}

    // Now start monitoring
    subprocess("pactl subscribe", (line) => {
      if (line.includes("sink") && !line.includes("source")) {
        checkVolume()
      }
      if (line.includes("source")) {
        checkMic()
      }
    })

    subprocess("stdbuf -oL udevadm monitor -u -s backlight", (line) => {
      if (line.includes("change")) {
        checkBrightness()
      }
    })
  }

  // Start initialization after a small delay to ensure window is ready
  timeout(100, () => {
    initializeAndMonitor()
  })

  return win
}