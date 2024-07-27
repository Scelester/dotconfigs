import { SimpleToggleButton } from "../ToggleButton"
import icons from "lib/icons"
const { speaker } = await Service.import("audio")

const icon = () => speaker.is_muted || speaker.stream?.is_muted
    ? icons.audio.volume.muted
    : icons.audio.volume.high

const label = () => speaker.is_muted || speaker.stream?.is_muted
    ? "Muted"
    : "Unmuted"

export const Volmute = () => SimpleToggleButton({
    icon: Utils.watch(icon(), speaker, icon),
    label: Utils.watch(label(), speaker, label),
    toggle: () => speaker.is_muted = !speaker.is_muted,
    connection: [speaker, () => speaker?.is_muted || false],
})
