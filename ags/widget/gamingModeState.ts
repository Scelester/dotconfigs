import Gio from "gi://Gio?version=2.0"
import GLib from "gi://GLib?version=2.0"

export type GamingModeState = {
  enabled: boolean
  changedAt: number
  title: string
  summary: string
  arcadeDir: string
  previousProfile: string
  animations: number
  blur: number
  vfr: number
  hypridleWasRunning: boolean
  copyqWasRunning: boolean
  megaWasRunning: boolean
  hyprshadeWasEnabled: boolean
  awwwWasRunning: boolean
  killedProcesses: string[]
}

const stateDir = GLib.build_filenamev([GLib.get_user_cache_dir(), "gaming-mode"])
export const gamingModeStatePath = GLib.build_filenamev([stateDir, "state.json"])

const DEFAULT_STATE: GamingModeState = {
  enabled: false,
  changedAt: 0,
  title: "Gaming mode disabled",
  summary: "Desktop profile active.",
  arcadeDir: GLib.build_filenamev([GLib.get_home_dir(), "ARCADE"]),
  previousProfile: "balanced",
  animations: 1,
  blur: 1,
  vfr: 0,
  hypridleWasRunning: false,
  copyqWasRunning: false,
  megaWasRunning: false,
  hyprshadeWasEnabled: false,
  awwwWasRunning: false,
  killedProcesses: []
}

type GamingModeListener = (state: GamingModeState, changed: boolean) => void

const listeners = new Set<GamingModeListener>()
let fileMonitor: Gio.FileMonitor | null = null
let refreshTimer = 0
let currentState = DEFAULT_STATE

const writeDefaultState = () => {
  GLib.mkdir_with_parents(stateDir, 0o755)
  if (!GLib.file_test(gamingModeStatePath, GLib.FileTest.EXISTS)) {
    GLib.file_set_contents(gamingModeStatePath, JSON.stringify(DEFAULT_STATE, null, 2))
  }
}

const sanitizeState = (value: unknown): GamingModeState => {
  const parsed = typeof value === "object" && value ? value as Record<string, unknown> : {}

  return {
    enabled: parsed.enabled === true,
    changedAt: typeof parsed.changedAt === "number" ? parsed.changedAt : 0,
    title: typeof parsed.title === "string" && parsed.title.trim().length
      ? parsed.title
      : parsed.enabled === true
      ? "Gaming mode enabled"
      : "Gaming mode disabled",
    summary: typeof parsed.summary === "string" && parsed.summary.trim().length
      ? parsed.summary
      : parsed.enabled === true
      ? "Performance profile active."
      : "Desktop profile active.",
    arcadeDir: typeof parsed.arcadeDir === "string" && parsed.arcadeDir.trim().length
      ? parsed.arcadeDir
      : DEFAULT_STATE.arcadeDir,
    previousProfile: typeof parsed.previousProfile === "string" && parsed.previousProfile.trim().length
      ? parsed.previousProfile
      : DEFAULT_STATE.previousProfile,
    animations: typeof parsed.animations === "number" ? parsed.animations : DEFAULT_STATE.animations,
    blur: typeof parsed.blur === "number" ? parsed.blur : DEFAULT_STATE.blur,
    vfr: typeof parsed.vfr === "number" ? parsed.vfr : DEFAULT_STATE.vfr,
    hypridleWasRunning: parsed.hypridleWasRunning === true,
    copyqWasRunning: parsed.copyqWasRunning === true,
    megaWasRunning: parsed.megaWasRunning === true,
    hyprshadeWasEnabled: parsed.hyprshadeWasEnabled === true,
    awwwWasRunning: parsed.awwwWasRunning === true,
    killedProcesses: Array.isArray(parsed.killedProcesses)
      ? parsed.killedProcesses.filter((item): item is string => typeof item === "string")
      : []
  }
}

const readState = () => {
  writeDefaultState()

  try {
    const [ok, contents] = GLib.file_get_contents(gamingModeStatePath)
    if (!ok) return DEFAULT_STATE
    const decoded = Array.from(contents as Uint8Array, (value) => String.fromCharCode(value)).join("")
    return sanitizeState(JSON.parse(decoded))
  } catch (err) {
    console.error("Gaming mode state read failed:", err)
    return DEFAULT_STATE
  }
}

const notifyListeners = (changed: boolean) => {
  listeners.forEach((listener) => listener(currentState, changed))
}

const refreshState = () => {
  const next = readState()
  const changed =
    next.changedAt !== currentState.changedAt ||
    next.enabled !== currentState.enabled ||
    next.summary !== currentState.summary

  currentState = next
  notifyListeners(changed)
}

const queueRefresh = () => {
  if (refreshTimer) return

  refreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
    refreshTimer = 0
    refreshState()
    return GLib.SOURCE_REMOVE
  })
}

const ensureMonitor = () => {
  writeDefaultState()
  if (fileMonitor) return

  try {
    currentState = readState()
    const file = Gio.File.new_for_path(gamingModeStatePath)
    fileMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null)
    fileMonitor.connect("changed", queueRefresh)
  } catch (err) {
    console.error("Gaming mode state monitor failed:", err)
  }
}

export const getGamingModeState = () => {
  ensureMonitor()
  return currentState
}

export const subscribeGamingMode = (listener: GamingModeListener) => {
  ensureMonitor()
  listeners.add(listener)
  listener(currentState, false)
  return () => listeners.delete(listener)
}
