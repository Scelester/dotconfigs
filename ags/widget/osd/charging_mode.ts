import { icon, sh } from "lib/utils";
import icons from "lib/icons";
import options from "options";

const { charging_mode: charging_mode_state } = options.theme;
const DELAY = 2500;

function Battery_state() {
    // Create an icon widget for the OSD
    const iconWidget = Widget.Icon({
        class_name: "charging_mode", // Ensure this class is styled appropriately
    });

    // Create a revealer widget for showing the OSD
    const revealer = Widget.Revealer({
        reveal_child: false, // Start with the child hidden
        transition: "slide_up", // Transition effect
        child: iconWidget
        
    });

    // Function to update the charging mode icon
    function updateChargingMode() {
        // Update the icon based on the charging mode state
        iconWidget.icon = icons.battery[charging_mode_state.value === "charging" ? "charging" : "unplugged"];
        revealer.reveal_child = true;

        // Hide the OSD after the delay
        Utils.timeout(DELAY, () => {
            revealer.reveal_child = false;
        });
    }

    // Use a hook to listen for changes in charging_mode_state
    revealer.hook(charging_mode_state, () => {
        updateChargingMode();
    }, "notify::value");

    // Initial update
    // updateChargingMode();

    // Return the revealer to ensure it's handled by AGS
    return revealer;
}

function toggleChargingMode(x){
    if (x=="1") {
        charging_mode_state.value = "charging";
    } else {
        charging_mode_state.value = "unplugged";
    }
}

// Expose the function globally for AGS to access
Object.assign(globalThis, { toggleChargingMode });

// Export the function
export default Battery_state;
