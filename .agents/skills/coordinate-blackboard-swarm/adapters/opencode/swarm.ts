// coordinate-blackboard-swarm: managed adapter
import { tool } from "@opencode-ai/plugin"

const run = async (args: string[], directory: string) => {
  const skillRoot = `${process.env.HOME}/.config/opencode/skills/coordinate-blackboard-swarm`
  const script = `${skillRoot}/scripts/blackboard.py`
  const db = `${directory}/.agent/board.sqlite`
  const p = Bun.spawn(["python3", script, "--db", db, ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (code !== 0) throw new Error((err || out).trim() || `blackboard exit ${code}`)
  return out.trim()
}

export default tool({
  description: "Canonical SQLite Blackboard adapter. State transitions are performed only by blackboard.py.",
  args: {
    action: tool.schema.enum(["next", "claim", "fact", "result", "block", "done", "status", "watch"]),
    task: tool.schema.string().optional(), key: tool.schema.string().optional(), value: tool.schema.string().optional(),
    evidence: tool.schema.string().optional(), reason: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const id = args.task
    const worker = context.sessionID
    const common = args.action === "next" ? ["next"] : args.action === "status" ? ["status"] : [args.action]
    if (["claim", "fact", "result", "block", "done"].includes(args.action) && !id) throw new Error("task is required")
    if (args.action === "claim") common.push(id!, "--worker", worker)
    else if (args.action === "fact") common.push(id!, args.key ?? "fact", args.value ?? "", ...(args.evidence ? ["--ref", args.evidence] : []))
    else if (args.action === "result") common.push(id!, args.key ?? "check", args.value ?? "PASS", "--ref", args.evidence ?? "opencode-session:" + worker)
    else if (args.action === "block") common.push(id!, args.reason ?? "blocked")
    else if (args.action === "done") common.push(id!)
    else if (args.action === "watch") common.push("--once")
    return { title: `swarm:${args.action}`, output: await run(common, context.directory), metadata: { sessionID: worker, agent: context.agent, worktree: context.worktree } }
  },
})
