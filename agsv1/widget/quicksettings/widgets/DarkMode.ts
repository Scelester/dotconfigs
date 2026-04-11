import { SimpleToggleButton } from "../ToggleButton"
import icons from "lib/icons"
import options from "options"
import {sh} from "../../../lib/utils"

const { eyecare } = options.theme

export const DarkModeToggle = () => SimpleToggleButton({
    icon: eyecare.bind().as(s => icons.custom[s]),
    label: eyecare.bind().as(s => s === "eyecare" ? "Eyecare" : "Normal"),
    toggle: () => {eyecare.value = eyecare.value === "eyecare" ? "normal" : "eyecare";sh("nightlight")},
    connection: [eyecare, () => eyecare.value === "eyecare"],
})
