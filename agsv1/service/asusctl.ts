import { sh } from "lib/utils"

type Profile = "Performance" | "Balanced" | "Quiet"
type Mode = "Hybrid" | "Integrated"

class Asusctl extends Service {
    static {
        Service.register(this, {}, {
            "profile": ["string", "r"],
            "mode": ["string", "r"],
        })
    }

    get available() {
        return Utils.exec("which asusctl", () => true, () => false)
    }

    #profile: Profile = "Balanced"
    #mode: Mode = "Hybrid"

    async nextProfile() {
        await sh("asusctl profile -n")
        const profile = await sh("asusctl profile -p")
        const profilefilter = profile.split('\n').filter(line => line.includes("Active profile is"))[0].split(' ').slice(-1)[0];
        const p = profilefilter as Profile
        this.#profile = p
        this.changed("profile")
    }

    async setProfile(prof: Profile) {
        await sh(`asusctl profile --profile-set ${prof}`)
        this.#profile = prof
        this.changed("profile")
    }

    async nextMode() {
        await sh(`supergfxctl -m ${this.#mode === "Hybrid" ? "Integrated" : "Hybrid"}`)
        this.#mode = await sh("supergfxctl -g") as Mode
        this.changed("profile")
    }

    constructor() {
        super()

        if (this.available) {
            sh("asusctl profile -p").then(p => this.#profile = p.split('\n').filter(line => line.includes("Active profile is"))[0].split(' ').slice(-1)[0] as Profile)
            sh("supergfxctl -g").then(m => this.#mode = m as Mode)
        }
    }

    get profiles(): Profile[] { return ["Performance", "Balanced", "Quiet"] }
    get profile() { return this.#profile }
    get mode() { return this.#mode }
}


const asusctl = new Asusctl
Object.assign(globalThis, { asusctl })
export default asusctl

// export default new Asusctl
