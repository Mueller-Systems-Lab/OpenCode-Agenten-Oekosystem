import assert from "node:assert/strict"
import test from "node:test"

import {
  COMMAND_EFFECT_CLASSES,
  classifyCommand,
} from "../../runtime/gates/command-effect-classifier.mjs"
import { commandDescriptor, evaluateAction } from "../../runtime/gates/evaluate-action.mjs"
import { CanonicalGovernancePlugin } from "../../.opencode/plugins/canonical-governance.mjs"

const capsule = {
  task_id: "compatibility-task",
  read_scope: ["**"],
  write_scope: ["**"],
  external_effect_scope: ["network://read/**"],
  forbidden_scope: [".env", "**/.env", "**/.env.*", ".git/**", ".agent-governance/**"],
  allowed_effects: [
    "LOCAL_READ", "LOCAL_WRITE", "LOCAL_DELETE", "LOCAL_EXECUTE", "TEST_EXECUTION",
    "LOCAL_COMMIT", "NETWORK", "DELEGATE",
  ],
}

const localCommands = [
  ["pwd", COMMAND_EFFECT_CLASSES.LOCAL_INSPECTION],
  ["Get-ChildItem -LiteralPath 'src'", COMMAND_EFFECT_CLASSES.LOCAL_INSPECTION],
  ["Get-Content \"README.md\"", COMMAND_EFFECT_CLASSES.LOCAL_INSPECTION],
  ["Test-Path package.json", COMMAND_EFFECT_CLASSES.LOCAL_INSPECTION],
  ["git status", COMMAND_EFFECT_CLASSES.LOCAL_GIT_READ],
  ["git diff --stat", COMMAND_EFFECT_CLASSES.LOCAL_GIT_READ],
  ["git log -5", COMMAND_EFFECT_CLASSES.LOCAL_GIT_READ],
  ["git branch --show-current", COMMAND_EFFECT_CLASSES.LOCAL_GIT_READ],
  ["git rev-parse HEAD", COMMAND_EFFECT_CLASSES.LOCAL_GIT_READ],
  ["git fetch", COMMAND_EFFECT_CLASSES.NETWORK_READ],
  ["cargo check", COMMAND_EFFECT_CLASSES.LOCAL_BUILD],
  ["cargo build", COMMAND_EFFECT_CLASSES.LOCAL_BUILD],
  ["cargo tauri build", COMMAND_EFFECT_CLASSES.LOCAL_BUILD],
  ["pnpm build", COMMAND_EFFECT_CLASSES.LOCAL_BUILD],
  ["npm run build", COMMAND_EFFECT_CLASSES.LOCAL_BUILD],
  ["tsc", COMMAND_EFFECT_CLASSES.LOCAL_BUILD],
  ["npm test", COMMAND_EFFECT_CLASSES.LOCAL_TEST],
  ["pnpm test", COMMAND_EFFECT_CLASSES.LOCAL_TEST],
  ["pytest", COMMAND_EFFECT_CLASSES.LOCAL_TEST],
  ["node --test", COMMAND_EFFECT_CLASSES.LOCAL_TEST],
  ["npm install", COMMAND_EFFECT_CLASSES.LOCAL_PACKAGE_OPERATION],
  ["git add src/index.js", COMMAND_EFFECT_CLASSES.LOCAL_GIT_WRITE],
  ["git tag local-baseline", COMMAND_EFFECT_CLASSES.LOCAL_GIT_WRITE],
  ["Get-FileHash README.md", COMMAND_EFFECT_CLASSES.LOCAL_INSPECTION],
  ["Resolve-Path README.md", COMMAND_EFFECT_CLASSES.LOCAL_INSPECTION],
  ["Copy-Item src.txt dst.txt", COMMAND_EFFECT_CLASSES.LOCAL_GENERATION],
  ["Move-Item src.txt dst.txt", COMMAND_EFFECT_CLASSES.LOCAL_GENERATION],
  ["Remove-Item build/output.txt", COMMAND_EFFECT_CLASSES.LOCAL_GENERATION],
]

test("native local commands have deterministic non-unknown classifications", () => {
  for (const [command, expected] of localCommands) {
    const result = classifyCommand(command)
    assert.equal(result.effect_class, expected, command)
    assert.notEqual(result.reversibility, "UNKNOWN_REVERSIBILITY", command)
  }
})

test("PowerShell, cmd wrappers, quoting, pipes, and chains use the maximal effect", () => {
  assert.equal(classifyCommand("Get-Content 'README.md' | Select-Object -First 1").effect_class, COMMAND_EFFECT_CLASSES.LOCAL_INSPECTION)
  assert.equal(classifyCommand("cmd.exe /c \"git status & git push\"").governance_effect, "PUSH")
  assert.equal(classifyCommand("git status; git push").effect_class, COMMAND_EFFECT_CLASSES.EXTERNAL_WRITE)
  assert.equal(classifyCommand("Get-Content '.env.local'").effect_class, COMMAND_EFFECT_CLASSES.SECRET_ACCESS)
  assert.equal(classifyCommand("rm -rf /").effect_class, COMMAND_EFFECT_CLASSES.DESTRUCTIVE)
})

test("cold local inspection and safe delegation pass without a Task Capsule", async () => {
  const inspection = await evaluateAction({ tool: "bash", command: "git status", runtime: "opencode" })
  assert.equal(inspection.allowed, true)
  assert.equal(inspection.command_effect_class, COMMAND_EFFECT_CLASSES.LOCAL_GIT_READ)

  const delegation = await evaluateAction({ tool: "task", resource: "plan-agent", runtime: "opencode" })
  assert.equal(delegation.allowed, true)
  assert.equal(delegation.effect, "DELEGATE")
})

test("Reality Refresh git fetch remains available before Task Capsule bootstrap", async () => {
  const command = "git fetch origin --prune; git status --short; git branch --show-current; git rev-parse HEAD; git rev-parse origin/master"
  const result = await evaluateAction({ tool: "bash", command, runtime: "opencode" })
  assert.equal(result.allowed, true)
  assert.equal(result.effect, "NETWORK")
  assert.equal(result.command_effect_class, COMMAND_EFFECT_CLASSES.NETWORK_READ)
  assert.equal(result.task_id, "cold-network-read")

  const remoteUrl = await evaluateAction({ tool: "bash", command: "git fetch https://example.invalid/repo.git", runtime: "opencode" })
  assert.equal(remoteUrl.allowed, false)
  assert.equal(remoteUrl.code, "RED_BLOCK_TASK_CAPSULE_MISSING_OR_INVALID")

  const mixedUnknown = await evaluateAction({ tool: "bash", command: "git fetch origin --prune; unknown-command", runtime: "opencode" })
  assert.equal(mixedUnknown.allowed, false)
  assert.equal(mixedUnknown.code, "RED_BLOCK_TASK_CAPSULE_MISSING_OR_INVALID")
})

test("source OpenCode plugin delegates bash reads to the effect gate before install", async () => {
  const hooks = await CanonicalGovernancePlugin({ directory: process.cwd(), worktree: process.cwd() })
  const output = { args: { command: "git fetch origin --prune; git status --short" } }
  await hooks["tool.execute.before"]({ tool: "bash", callID: "cold-reality-refresh" }, output)
  assert.equal(output.__governanceDecision.allowed, true)
  assert.equal(output.__governanceDecision.task_id, "cold-network-read")

  await assert.rejects(
    hooks["tool.execute.before"]({ tool: "bash", callID: "cold-write" }, { args: { command: "git add README.md" } }),
    /RED_BLOCK_TASK_CAPSULE_MISSING_OR_INVALID/u,
  )
})

test("delegation cannot expand effects or narrow forbidden scope", async () => {
  const child = {
    task_id: "child-task",
    read_scope: ["src/**"],
    write_scope: ["src/**"],
    forbidden_scope: capsule.forbidden_scope,
    allowed_effects: ["LOCAL_WRITE"],
  }
  const allowed = await evaluateAction({ tool: "task", resource: "build-agent", capsule, childCapsule: child, runtime: "opencode" })
  assert.equal(allowed.allowed, true)

  const effectExpansion = await evaluateAction({ tool: "task", resource: "build-agent", capsule, childCapsule: { ...child, allowed_effects: ["PUSH"] }, runtime: "opencode" })
  assert.equal(effectExpansion.code, "RED_BLOCK_EFFECT_EXPANSION")
  const forbiddenNarrowing = await evaluateAction({ tool: "task", resource: "build-agent", capsule, childCapsule: { ...child, forbidden_scope: [] }, runtime: "opencode" })
  assert.equal(forbiddenNarrowing.code, "RED_BLOCK_FORBIDDEN_SCOPE_NARROWING")
})

test("bootstrapped local build/test/package/Git operations are autonomous", async () => {
  for (const command of ["cargo build", "pnpm test", "npm install", "git add src/index.js", "git commit -m local"]) {
    const result = await evaluateAction({ tool: "bash", command, capsule, runtime: "opencode" })
    assert.equal(result.allowed, true, `${command}: ${result.code}`)
    assert.equal(result.decision_class, "A_AUTONOMOUS", command)
  }
})

test("all standard OpenCode tool aliases retain a governed native path", async () => {
  const coldReadTools = ["read", "grep", "glob", "lsp", "skill"]
  for (const tool of coldReadTools) {
    const result = await evaluateAction({ tool, args: { filePath: "README.md", name: "README.md" }, runtime: "opencode" })
    assert.equal(result.allowed, true, tool)
  }
  for (const tool of ["write", "edit", "apply_patch"]) {
    const result = await evaluateAction({ tool, args: { filePath: "src/example.txt" }, resource: "src/example.txt", capsule, runtime: "opencode" })
    assert.equal(result.allowed, true, tool)
  }
  for (const tool of ["webfetch", "websearch"]) {
    const result = await evaluateAction({ tool, args: { url: "https://example.invalid" }, capsule, runtime: "opencode" })
    assert.equal(result.allowed, true, tool)
    assert.equal(result.effect, "NETWORK")
  }
})

test("external, secret, and destructive effects retain governance", async () => {
  const cases = [
    ["git fetch", true, "NETWORK"],
    ["git push", false, "PUSH"],
    ["git merge main", false, "MERGE"],
    ["gh release create v1.0.0", false, "EXTERNAL_COMMUNICATION"],
    ["gh workflow run ci.yml", false, "EXTERNAL_COMMUNICATION"],
    ["cargo publish", false, "EXTERNAL_COMMUNICATION"],
    ["Get-Content .env", false, "SECRET_ACCESS"],
    ["rm -rf build", false, "IRREVERSIBLE_DELETE"],
  ]
  for (const [command, allowed, effect] of cases) {
    const result = await evaluateAction({ tool: "bash", command, capsule, runtime: "opencode" })
    assert.equal(result.allowed, allowed, `${command}: ${result.code}`)
    assert.equal(result.effect, effect, command)
    if (!allowed && ["PUSH", "MERGE", "EXTERNAL_COMMUNICATION"].includes(effect)) assert.equal(result.requires_owner, true, command)
  }
})

test("unknown shell commands remain fail-closed after known coverage", async () => {
  const descriptor = commandDescriptor("made-up-development-command --safe")
  assert.equal(descriptor.command_effect_class, COMMAND_EFFECT_CLASSES.UNKNOWN)
  const result = await evaluateAction({ tool: "bash", command: "made-up-development-command --safe", capsule, runtime: "opencode" })
  assert.equal(result.allowed, false)
  assert.equal(result.code, "RED_BLOCK_UNKNOWN_EFFECT")
})

test("shell command paths cannot escape the target root", async () => {
  const result = await evaluateAction({
    tool: "bash",
    command: "git add C:\\outside\\file.txt",
    targetRoot: "C:\\OpenCode-Agenten-Oekosystem",
    capsule,
    runtime: "opencode",
  })
  assert.equal(result.allowed, false)
  assert.equal(result.code, "RED_BLOCK_TARGET_ROOT_ESCAPE")
})
