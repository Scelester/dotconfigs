const eyecaremode = PanelButton({
    class_name: "eyecaremode",
    child: Widget.Icon({ icon: eyecare.bind().as(s => icons.custom[s]) }),
    on_clicked: () => eyecare.value = eyecare.value === "eyecare" ? "normal" : "eyecare", sh("notify-send gg"),
})
