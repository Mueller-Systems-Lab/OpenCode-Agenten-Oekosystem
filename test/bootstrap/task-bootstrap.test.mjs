import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { repoRoot, runNodeScript } from "../helpers.mjs"

async function makeTarget(t) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-task-bootstrap-"))
  t.after(() => fs.rm(target, { recursive: true, force: true }))
  await fs.writeFile(path.join(target, "README.md"), "# disposable target\n", "utf8")
  spawnSync("git", ["init", "--initial-branch=master"], { cwd: target, stdio: "ignore" })
  spawnSync("git", ["config", "user.email", "test@example.invalid"], { cwd: target, stdio: "ignore" })
  spawnSync("git", ["config", "user.name", "Bootstrap Test"], { cwd: target, stdio: "ignore" })
  spawnSync("git", ["add", "README.md"], { cwd: target, stdio: "ignore" })
  spawnSync("git", ["commit", "-m", "initial"], { cwd: target, stdio: "ignore" })
  const install = runNodeScript("scripts/install-governance.mjs", ["--target", target, "--apply", "--json"])
  assert.equal(install.status, 0, install.stderr || install.stdout)
  return target
}

test("fresh install automatically compiles a complete task context before the first write", async (t) => {
  const target = await makeTarget(t)
  const runtimePath = path.join(target, ".agent-governance", "runtime", "bootstrap", "task-bootstrap.mjs")
  const runtime = await import(pathToFileURL(runtimePath).href)
  const result = await runtime.bootstrapTask({
    targetRoot: target,
    sessionId: "session-fresh-1",
    messageId: "message-fresh-1",
    userMessage: "Implement a small local feature and run the tests.",
  })
  assert.equal(result.state, "TASK_READY")
  const context = await runtime.readTaskContext(target)
  assert.ok(context?.intent)
  assert.ok(context?.capsule)
  assert.equal(context.capsule.owner_intent_id, context.intent.intent_id)
  assert.deepEqual(context.capsule.active_approval_receipts, [])
  assert.ok(context.capsule.required_fields_present)
  assert.ok(context.capsule.allowed_effects.includes("LOCAL_WRITE"))
  assert.ok(!context.capsule.allowed_effects.includes("PUSH"))
  assert.ok(context.capsule.forbidden_scope.includes(".env"))
  assert.equal(context.metadata.target_root, path.resolve(target))
})

test("installed OpenCode chat hook bootstraps the first top-level owner task", async (t) => {
  const target = await makeTarget(t)
  const pluginPath = path.join(target, ".agent-governance/hooks/opencode/canonical-governance.mjs")
  const plugin = await import(pathToFileURL(pluginPath).href)
  const hooks = await plugin.default({ directory: target, worktree: target })
  await hooks["chat.message"](
    { sessionID: "hook-session", messageID: "hook-message" },
    {
      message: { role: "user", id: "hook-message", sessionID: "hook-session" },
      parts: [{ type: "text", text: "Implement the local feature and run its tests." }],
    },
  )
  const runtime = await import(pathToFileURL(path.join(target, ".agent-governance/runtime/bootstrap/task-bootstrap.mjs")).href)
  const context = await runtime.readTaskContext(target)
  assert.equal(context.metadata.session_id, "hook-session")
  assert.equal(context.metadata.message_id, "hook-message")
})

test("release preparation bootstraps local work without pre-authorizing external effects", async (t) => {
  const target = await makeTarget(t)
  const runtimePath = path.join(target, ".agent-governance", "runtime", "bootstrap", "task-bootstrap.mjs")
  const runtime = await import(pathToFileURL(runtimePath).href)
  await runtime.bootstrapTask({
    targetRoot: target,
    sessionId: "session-release-1",
    messageId: "message-release-1",
    userMessage: "Prepare the project for release, build it, test it, and publish it.",
  })
  const context = await runtime.readTaskContext(target)
  const { evaluateAction } = await import(pathToFileURL(path.join(repoRoot, "runtime/gates/evaluate-action.mjs")).href)
  const local = await evaluateAction({
    targetRoot: target,
    runtime: "opencode",
    tool: "write",
    resource: "dist/release.txt",
    capsule: context.capsule,
    intent: context.intent,
  })
  const push = await evaluateAction({
    targetRoot: target,
    runtime: "opencode",
    tool: "git",
    action: "push",
    resource: "git-remote",
    capsule: context.capsule,
    intent: context.intent,
  })
  assert.equal(local.allowed, true)
  assert.notEqual(push.decision_class, "A_AUTONOMOUS")
  assert.equal(push.requires_owner, true)
})
