import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { copyFixture, repoRoot, runNodeScript, snapshotTree, readJson } from "../helpers.mjs"
import { discoverProject } from "../../scripts/lib/discovery.mjs"
import { loadManifest, selectManifestRecommendations } from "../../scripts/lib/manifest.mjs"
import { selectMcpCandidates } from "../../scripts/lib/mcp.mjs"

const manifest = await loadManifest(path.join(repoRoot, "ecosystem.manifest.json"))

const fixtureExpectations = {
  "node-typescript": async (context) => {
    assert.equal(context.discovery.language, "javascript/typescript")
    assert.equal(context.discovery.package_manager, null)
    assert.ok(context.discovery.frameworks.includes("vitest"))
    assert.ok(context.discovery.test_frameworks.includes("vitest"))
    assert.ok(context.selection.skills.includes("project-bootstrap"))
  },
  python: async (context) => {
    assert.equal(context.discovery.language, "python")
    assert.equal(context.discovery.package_manager, "python")
    assert.ok(context.discovery.frameworks.includes("pytest"))
    assert.ok(context.discovery.frameworks.includes("ruff"))
    assert.ok(context.discovery.test_frameworks.includes("pytest"))
    assert.ok(context.selection.skills.includes("project-bootstrap"))
  },
  "frontend-playwright": async (context) => {
    assert.ok(context.discovery.frameworks.includes("react"))
    assert.ok(context.discovery.frameworks.includes("vite"))
    assert.ok(context.discovery.frameworks.includes("playwright"))
    assert.ok(context.selection.agents.includes("playwright-agent"))
    assert.ok(context.selection.skills.includes("playwright-visual-review"))
    assert.ok(context.mcpCandidates.some((candidate) => candidate.name === "playwright"))
  },
  sqlite: async (context) => {
    assert.ok(context.discovery.databases.includes("sqlite"))
    assert.ok(context.selection.agents.includes("migration-agent"))
    assert.ok(context.selection.skills.includes("migration-review"))
    assert.ok(context.mcpCandidates.some((candidate) => candidate.name === "sqlite"))
  },
  docker: async (context) => {
    assert.ok(context.discovery.databases.includes("postgresql"))
    assert.ok(context.mcpCandidates.some((candidate) => candidate.name === "docker"))
  },
  "existing-agents": async (context) => {
    assert.equal(context.discovery.existing.agents, true)
    assert.equal(context.discovery.classification, "AMBER_REVIEW")
  },
  "existing-opencode": async (context) => {
    assert.equal(context.discovery.existing.opencode, true)
    assert.equal(context.discovery.classification, "AMBER_REVIEW")
  },
  "existing-hermes": async (context) => {
    assert.equal(context.discovery.existing.hermes, true)
    assert.equal(context.discovery.classification, "AMBER_REVIEW")
  },
  "civic-tech-pii": async (context) => {
    assert.ok(context.discovery.signals.some((signal) => signal.id === "pii-signals"))
    assert.ok(context.selection.agents.includes("compliance-agent"))
    assert.ok(context.selection.skills.includes("privacy-data-minimization"))
    assert.equal(context.selection.skills.includes("tierheim-compliance"), false, "generic PII should not get tierheim-compliance")
  },
  "tierheim-civipet": async (context) => {
    assert.ok(context.discovery.signals.some((signal) => signal.id === "tierheim-signals"))
    assert.ok(context.selection.agents.includes("compliance-agent"))
    assert.ok(context.selection.skills.includes("tierheim-compliance"))
  },
  "generic-no-dsgvo": async (context) => {
    assert.equal(context.discovery.language, "markdown")
    assert.equal(context.discovery.signals.some((signal) => signal.id === "pii-signals"), false)
    assert.equal(context.selection.agents.includes("compliance-agent"), false)
  },
  monorepo: async (context) => {
    assert.equal(context.discovery.monorepo, true)
  },
  empty: async (context) => {
    assert.equal(context.discovery.language, "unknown")
    assert.equal(context.discovery.frameworks.length, 0)
    assert.equal(context.discovery.test_frameworks.length, 0)
  },
}

test("discovery covers all fixture shapes", async () => {
  for (const [fixtureName, expectation] of Object.entries(fixtureExpectations)) {
    const target = await copyFixture(fixtureName)
    const discovery = await discoverProject(target)
    const selection = selectManifestRecommendations(manifest, discovery, { includeRemoteCI: false })
    const mcpCandidates = selectMcpCandidates(discovery, { includeRemoteCI: false }).candidates
    await expectation({ discovery, selection, mcpCandidates })
  }
})

test("dry-run is the default and does not modify files", async () => {
  const target = await copyFixture("node-typescript")
  const before = await snapshotTree(target)
  const result = runNodeScript("scripts/bootstrap-project.mjs", ["--target", target])

  const allowedStatuses = [0, 1]
  assert.ok(allowedStatuses.includes(result.status), `dry-run exit code ${result.status} not in ${allowedStatuses}: ${result.stderr}`)

  const after = await snapshotTree(target)
  assert.deepEqual(after, before)
})

test("bootstrap preserves existing OpenCode settings and stays idempotent", async () => {
  const target = await copyFixture("existing-opencode")
  const before = await snapshotTree(target)

  const first = runNodeScript("scripts/bootstrap-project.mjs", ["--target", target, "--apply"])
  assert.notEqual(first.status, 2, first.stderr)

  const merged = await readJson(path.join(target, "opencode.jsonc"))
  assert.equal(merged.model, "fixture/custom-model")
  assert.equal(merged.provider.custom.baseURL, "http://127.0.0.1:9999/v1")
  assert.equal(merged.shell, "bash")
  assert.ok(merged.instructions.includes("CUSTOM.md"))
  assert.ok(merged.instructions.includes("BOOTSTRAP.md"))
  assert.ok(await exists(path.join(target, ".hermes.md")))
  assert.ok(await exists(path.join(target, ".hermes", "skills", "README.md")))

  const reportPlan = await readJson(path.join(target, ".opencode", "reports", "bootstrap", "plan.json"))
  assert.ok(reportPlan.backup_root, "apply should record a backup directory")

  const afterFirst = await snapshotTree(target)
  const second = runNodeScript("scripts/bootstrap-project.mjs", ["--target", target, "--apply"])
  assert.notEqual(second.status, 2, second.stderr)

  const afterSecond = await snapshotTree(target)
  assert.deepEqual(afterSecond, afterFirst)

  const rollback = runNodeScript("scripts/bootstrap-project.mjs", ["--target", target, "--rollback", reportPlan.backup_root])
  assert.equal(rollback.status, 0, rollback.stderr)

  const afterRollback = await snapshotTree(target)
  assert.deepEqual(afterRollback, before)
})

test("remote CI is opt-in", async () => {
  const noCiTarget = await copyFixture("generic-no-dsgvo")
  const withoutCi = runNodeScript("scripts/bootstrap-project.mjs", ["--target", noCiTarget, "--apply"])
  assert.notEqual(withoutCi.status, 2, withoutCi.stderr)
  assert.equal(await exists(path.join(noCiTarget, ".github", "workflows")), false)

  const withCiTarget = await copyFixture("generic-no-dsgvo")
  const withCi = runNodeScript("scripts/bootstrap-project.mjs", ["--target", withCiTarget, "--apply", "--include-remote-ci"])
  assert.notEqual(withCi.status, 2, withCi.stderr)
  assert.equal(await exists(path.join(withCiTarget, ".github", "workflows")), true)
})

test("GitHub remote detection enables the GitHub MCP recommendation", async () => {
  const target = await copyFixture("node-typescript")
  spawnSync("git", ["init"], { cwd: target, encoding: "utf8" })
  spawnSync("git", ["remote", "add", "origin", "https://github.com/example/bootstrap-fixture.git"], {
    cwd: target,
    encoding: "utf8",
  })

  const discovery = await discoverProject(target)
  const selection = selectManifestRecommendations(manifest, discovery, { includeRemoteCI: false })
  const mcpCandidates = selectMcpCandidates(discovery, { includeRemoteCI: false }).candidates

  assert.equal(discovery.existing.github_remote, true)
  assert.ok(discovery.existing.github_remote_url.includes("github.com"))
  assert.ok(selection.mcp.some((entry) => entry.name === "github"))
  assert.ok(mcpCandidates.some((entry) => entry.name === "github"))
})

test("symlinked destinations are rejected", async () => {
  const target = await copyFixture("generic-no-dsgvo")
  const externalFile = path.join(target, "..", "outside.txt")
  await fs.writeFile(externalFile, "outside", "utf8")
  await fs.symlink(externalFile, path.join(target, "opencode.jsonc"))

  const result = runNodeScript("scripts/bootstrap-project.mjs", ["--target", target, "--apply"])
  assert.notEqual(result.status, 0)
})

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
