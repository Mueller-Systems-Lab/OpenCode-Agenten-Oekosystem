// coordinate-blackboard-swarm: managed adapter
// Thin mapping to the canonical engine (blackboard.py). No state logic here.
import { tool } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const resolveScript = (directory: string) => {
  const candidates = [
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "blackboard.py"),
    resolve(directory, ".agents", "skills", "coordinate-blackboard-swarm", "scripts", "blackboard.py"),
    `${process.env.HOME}/.config/opencode/skills/coordinate-blackboard-swarm/scripts/blackboard.py`,
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

const run = async (args: string[], directory: string) => {
  const script = resolveScript(directory)
  const db = `${directory}/.agent/board.sqlite`
  const p = Bun.spawn(["python3", script, "--db", db, ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (code !== 0) throw new Error((err || out).trim() || `blackboard exit ${code}`)
  return out.trim()
}

export default tool({
  description: "Canonical SQLite Blackboard adapter. State transitions are performed only by blackboard.py.",
  args: {
    action: tool.schema.enum([
      "next", "status", "snapshot", "watch", "init",
      "add", "propose", "admit", "reject",
      "claim", "renew", "dep", "run-create", "run-current",
      "fact", "result", "block", "fail", "retry", "done",
      "gate", "green",
      "signal", "inhibit", "vote", "quorum", "scout", "scout-confirm", "match",
    ]),
    task: tool.schema.string().optional(), key: tool.schema.string().optional(), value: tool.schema.string().optional(),
    evidence: tool.schema.string().optional(), reason: tool.schema.string().optional(), source: tool.schema.string().optional(),
    delta: tool.schema.string().optional(), ttl: tool.schema.string().optional(), confidence: tool.schema.string().optional(), requires: tool.schema.string().optional(), voter: tool.schema.string().optional(), status: tool.schema.string().optional(),
    title: tool.schema.string().optional(), acceptance: tool.schema.string().optional(), ref: tool.schema.string().optional(),
    priority: tool.schema.string().optional(), quorum: tool.schema.string().optional(), taskClass: tool.schema.string().optional(),
    parent: tool.schema.string().optional(), lease: tool.schema.string().optional(), on: tool.schema.string().optional(),
    run: tool.schema.string().optional(),
    reviewer: tool.schema.string().optional(), fingerprint: tool.schema.string().optional(),
    name: tool.schema.string().optional(), state: tool.schema.string().optional(), require: tool.schema.string().optional(),
    persistent: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const id = args.task
    const worker = context.sessionID
    const common = args.action === "next" ? ["next"] : args.action === "status" ? ["status"] : [args.action]
    const idActions = ["claim", "renew", "fact", "result", "block", "fail", "done", "vote", "quorum", "scout", "match", "dep", "admit", "reject", "retry", "scout-confirm"]
    if (idActions.includes(args.action) && !id) throw new Error("task is required")
    if (args.action === "claim") common.push(id!, "--worker", worker, ...(args.lease === undefined ? [] : ["--lease", String(args.lease)]))
    else if (args.action === "renew") common.push(id!, "--worker", worker, ...(args.lease === undefined ? [] : ["--lease", String(args.lease)]))
    else if (args.action === "fact") common.push(id!, args.key ?? "fact", args.value ?? "", ...(args.evidence ? ["--ref", args.evidence] : []))
    else if (args.action === "result") common.push(id!, args.key ?? "check", args.value ?? "PASS", "--ref", args.evidence ?? "opencode-session:" + worker)
    else if (args.action === "block") common.push(id!, args.reason ?? "blocked")
    else if (args.action === "fail") common.push(id!, args.reason ?? "failed")
    else if (args.action === "done") common.push(id!)
    else if (args.action === "watch") common.push("--once")
    else if (args.action === "signal") common.push(args.task ?? "", String(args.delta ?? 0), args.reason ?? "signal", "--source", args.source ?? worker, ...(args.ttl === undefined ? [] : ["--ttl", String(args.ttl)]), ...(args.persistent === "true" ? ["--persistent"] : []))
    else if (args.action === "inhibit") common.push(args.source ?? worker, args.key ?? "general", String(args.delta ?? 0), args.reason ?? "temporary-routing-penalty", "--source", worker, "--ttl", String(args.ttl ?? 3600))
    else if (args.action === "vote") common.push(id!, args.voter ?? worker, args.status ?? "PASS", "--ref", args.evidence ?? "opencode-session:" + worker, ...(args.ttl === undefined ? [] : ["--ttl", String(args.ttl)]), ...(args.fingerprint === undefined ? [] : ["--fingerprint", args.fingerprint]))
    else if (args.action === "quorum") common.push(id!, ...(args.name ? ["--gate", args.name] : []))
    else if (args.action === "scout") common.push(id!, worker, args.value ?? "scout-fact", String(args.confidence ?? 0.5), "--ref", args.evidence ?? "opencode-session:" + worker)
    else if (args.action === "scout-confirm") common.push(id!, "--reviewer", args.reviewer ?? worker, "--ref", args.evidence ?? "opencode-session:" + worker)
    else if (args.action === "match") common.push(id!, "--requires", args.requires ?? "")
    else if (args.action === "dep") common.push(id!, "--on", String(args.on ?? ""))
    else if (args.action === "admit") common.push(id!, "--evidence", args.evidence ?? "")
    else if (args.action === "reject") common.push(id!, "--reason", args.reason ?? "rejected")
    else if (args.action === "retry") common.push(id!)
    else if (args.action === "add" || args.action === "propose") {
      if (!args.title || !args.acceptance) throw new Error("title and acceptance are required")
      common.push(args.title, "--acceptance", args.acceptance,
        ...(args.ref ? ["--ref", args.ref] : []),
        ...(args.priority === undefined ? [] : ["--priority", String(args.priority)]),
        ...(args.quorum === undefined ? [] : ["--quorum", String(args.quorum)]),
        ...(args.taskClass ? ["--task-class", args.taskClass] : []),
        ...(args.run === undefined ? [] : ["--run", String(args.run)]),
        ...(args.action === "propose" && args.parent !== undefined ? ["--parent", String(args.parent)] : []))
    }
    else if (args.action === "gate") {
      if (!args.name || !args.state) throw new Error("name and state are required")
      common.push(args.name, args.state, ...(args.evidence ? ["--evidence", args.evidence] : []))
    }
    else if (args.action === "green") {
      if (!args.require) throw new Error("require is required")
      common.push("--require", args.require)
    }
    else if (args.action === "run-create") common.push(...(args.value ? ["--note", args.value] : []))
    return { title: `swarm:${args.action}`, output: await run(common, context.directory), metadata: { sessionID: worker, agent: context.agent, worktree: context.worktree } }
  },
})
