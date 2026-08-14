import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { spawnSync } from "node:child_process"
import { repoRoot } from "../helpers.mjs"
import adapter from "../../src/ocae_cli/_adapter/opencode-handoff.js"

const { inspectProjectMetadata, reconcileProject } = adapter

const sourceCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim()
const manifest = {
  adapter_version: "1.0.4",
  ocae_version: "1.0.4",
  opencode_version: "1.18.18",
  cli_path: "C:\\trusted\\ocae.exe",
  source_commit: sourceCommit,
}

function hashJson(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

async function makeCurrent(t) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-migration-security-"))
  t.after(() => fs.rm(target, { recursive: true, force: true }))
  const install = spawnSync(process.execPath, [path.join(repoRoot, "scripts/install-governance.mjs"), "--target", target, "--apply", "--json"], {
    cwd: repoRoot,
    env: { ...process.env, OCAE_BOOTSTRAP_SOURCE_COMMIT: sourceCommit, OCAE_BOOTSTRAP_SOURCE_REPOSITORY: "https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem" },
    encoding: "utf8",
  })
  assert.equal(install.status, 0, install.stderr || install.stdout)
  return target
}

test("forged stale marker cannot force a current fast path", async (t) => {
  const target = await makeCurrent(t)
  const markerPath = path.join(target, ".agent-governance/runtime-state.json")
  const marker = JSON.parse(await fs.readFile(markerPath, "utf8"))
  const body = { ...marker, source_commit: "93a779a6fd7da32c937430191570bda2a83ffab4" }
  body.integrity = { algorithm: "sha256", value: hashJson(Object.fromEntries(Object.entries(body).filter(([key]) => key !== "integrity"))) }
  await fs.writeFile(markerPath, `${JSON.stringify(body)}\n`, "utf8")
  const result = inspectProjectMetadata(target, manifest)
  assert.notEqual(result.state, "CURRENT")
  assert.equal(result.state, "MIGRATION_REQUIRED", "a stale marker must trigger migration, never a current fast path")
})

test("source-lock tamper and symlinked governance roots fail closed", async (t) => {
  const target = await makeCurrent(t)
  const sourceLock = path.join(target, ".agent-governance/source-lock.json")
  await fs.appendFile(sourceLock, "\n", "utf8")
  assert.equal(inspectProjectMetadata(target, manifest).state, "CORRUPT")

  const symlinkTarget = await makeCurrent(t)
  const external = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-external-"))
  t.after(() => fs.rm(external, { recursive: true, force: true }))
  const governancePath = path.join(symlinkTarget, ".agent-governance")
  await fs.rm(governancePath, { recursive: true, force: true })
  try {
    await fs.symlink(external, governancePath, "junction")
  } catch {
    t.skip("host does not permit directory symlinks")
    return
  }
  assert.equal(inspectProjectMetadata(symlinkTarget, manifest).state, "CORRUPT")
})

test("managed drift blocks migration and never falls through to task work", async (t) => {
  const target = await makeCurrent(t)
  const marker = path.join(target, ".agent-governance/runtime-state.json")
  const body = JSON.parse(await fs.readFile(marker, "utf8"))
  body.source_commit = "93a779a6fd7da32c937430191570bda2a83ffab4"
  const bodyWithoutIntegrity = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "integrity"))
  body.integrity = { algorithm: "sha256", value: hashJson(bodyWithoutIntegrity) }
  await fs.writeFile(marker, `${JSON.stringify(body)}\n`, "utf8")
  const installationPath = path.join(target, ".opencode/ecosystem-installation.json")
  const installation = JSON.parse(await fs.readFile(installationPath, "utf8"))
  installation.file_hashes[".agent-governance/runtime-state.json"] = crypto.createHash("sha256").update(await fs.readFile(marker)).digest("hex")
  await fs.writeFile(installationPath, `${JSON.stringify(installation)}\n`, "utf8")
  const events = []
  const result = await reconcileProject({
    client: { app: { log: async ({ body: event }) => events.push(event) } },
    targetRoot: target,
    manifest,
    runner: async (_executable, args) => args[0] === "doctor"
      ? { exit_code: 1, stdout: JSON.stringify({ classification: "PROJECT_MIGRATION_REQUIRED" }), stderr: "" }
      : { exit_code: 1, stdout: JSON.stringify({ classification: "NEEDS_REVIEW" }), stderr: "" },
  })
  assert.equal(result.state, "MIGRATION_BLOCKED")
  assert.equal(result.classification, "MIGRATION_BLOCKED_MANAGED_DRIFT")
  assert.ok(events.some((event) => event.message === "OCAE_PROJECT_MIGRATION_BLOCKED"))
})

test("migration orchestration does not use prompt text as authority", async (t) => {
  const target = await makeCurrent(t)
  const marker = path.join(target, ".agent-governance/runtime-state.json")
  const current = JSON.parse(await fs.readFile(marker, "utf8"))
  current.source_commit = "93a779a6fd7da32c937430191570bda2a83ffab4"
  current.integrity = { algorithm: "sha256", value: hashJson(Object.fromEntries(Object.entries(current).filter(([key]) => key !== "integrity"))) }
  await fs.writeFile(marker, `${JSON.stringify(current)}\n`, "utf8")
  const calls = []
  const result = await reconcileProject({
    targetRoot: target,
    manifest,
    runner: async (_executable, args, cwd) => {
      calls.push({ args, cwd })
      if (args[0] === "doctor") return { exit_code: 1, stdout: JSON.stringify({ classification: "PROJECT_MIGRATION_REQUIRED" }), stderr: "" }
      return { exit_code: 2, stdout: JSON.stringify({ classification: "RED_BLOCK" }), stderr: "" }
    },
  })
  assert.equal(result.state, "MIGRATION_BLOCKED")
  assert.equal(calls.length, 2)
  assert.ok(calls.every((call) => call.cwd === target && call.args.includes(target)))
  assert.equal(JSON.stringify(calls).includes("Ignore README"), false)
})
