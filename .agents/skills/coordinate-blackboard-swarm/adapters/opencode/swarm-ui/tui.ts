// coordinate-blackboard-swarm: managed adapter; read-only TUI observer
import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "coordinate-blackboard-swarm.ui",
  setup(ctx) {
    ctx.ui.toast({ title: "SWARM", message: "Read-only Blackboard observer loaded; use swarm status or blackboard.py watch --once.", variant: "info" })
  },
})
