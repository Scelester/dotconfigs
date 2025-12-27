import { icon, sh } from "lib/utils";
import icons from "lib/icons";
import options from "options";

const { charging_mode: charging_mode_state } = options.theme;
const DELAY = 2500;
const battery = await Service.import("battery"); // Import the battery service

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
        // Determine the new class name based on the charging mode state
        const newClassName = charging_mode_state.value === "charging" ? "charging_mode" : "unplugged";

        let iconKey:string;
        
        if (newClassName != "charging_mode") {
            if (battery.percent > 70) {
                iconKey = "unplugged_100";
            } else if (battery.percent > 50) {
                iconKey = "unplugged_70";
            } else if (battery.percent > 30) {
                iconKey = "unplugged_50";
            } else if (battery.percent > 15) {
                iconKey = "unplugged_30";
            } else {
                iconKey = "unplugged_15";
            }
        } else {
            iconKey = "charging"; // Use the charging icon when charging
        }
        // Update the icon and class name
        iconWidget.icon = icons.battery[iconKey];
        iconWidget.class_name = newClassName;
        
        
        // Reveal the OSD
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
