import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import { repoRoot } from "../helpers.mjs"

const legacyInstance = ["CT", "108"].join("")
const legacyAddress = ["192", "168", "1", "210"].join(".")
const obsoleteStates = [
  ["RUNTIME", "CLOSURE", "PENDING"].join("_"),
  [legacyInstance, "PENDING"].join("_"),
  ["HERMES", legacyInstance, "PENDING"].join("_"),
  ["OWNER", legacyInstance, "ACTION", "REQUIRED"].join("_"),
]

function withoutLegacyRuntimeEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  for (const key of [legacyInstance, `${legacyInstance}_RUNTIME`, `${legacyInstance}_HOST`]) delete env[key]
  return env
}

function runValidator(extraEnv = {}) {
  return spawnSync(process.execPath, ["scripts/validate-ecosystem.mjs"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: withoutLegacyRuntimeEnv({ OCAE_CANONICAL_TEST_RUNNER: "1", ...extraEnv }),
  })
}

async function activeContractFiles() {
  const files = ["README.md", "BOOTSTRAP.md", "AI-BOOTSTRAP.md", "ecosystem.manifest.json"]
  for (const root of ["docs/architecture", "docs/run-cards", "governance", "runtime", "scripts", "test"]) {
    await walk(path.join(repoRoot, root), files)
  }
  return files
}

async function walk(directory, files) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) await walk(absolute, files)
    else if (/\.(md|json|jsonc|mjs|yml|yaml|py)$/i.test(entry.name)) files.push(absolute)
  }
}

test("C1/C6: unreachable legacy infrastructure cannot affect validation or active gates", async () => {
  const result = runValidator({
    [`${legacyInstance}_HOST`]: `unreachable.${legacyInstance.toLowerCase()}.invalid`,
    [`${legacyInstance}_RUNTIME`]: "missing",
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const activeText = (await activeContractFiles())
    .map((file) => fs.readFile(file, "utf8"))
  const texts = await Promise.all(activeText)
  const joined = texts.join("\n")
  assert.doesNotMatch(joined, new RegExp(legacyInstance))
  assert.doesNotMatch(joined, new RegExp(legacyAddress.replaceAll(".", "\\.")))
  for (const state of obsoleteStates) assert.doesNotMatch(joined, new RegExp(state))
})

test("C2/C3: installation and URL-only bootstrap do not require legacy runtime configuration", async () => {
  const installer = await fs.readFile(path.join(repoRoot, "scripts/install-governance.mjs"), "utf8")
  assert.doesNotMatch(installer, new RegExp(legacyInstance))
  assert.doesNotMatch(installer, new RegExp(legacyAddress.replaceAll(".", "\\.")))
  const targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-runtime-neutral-install-"))
  try {
    const result = spawnSync(process.execPath, ["scripts/install-governance.mjs", "--target", targetRoot, "--apply", "--json", "--runtime", "opencode"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: withoutLegacyRuntimeEnv({ OCAE_BOOTSTRAP_SOURCE_REPOSITORY: "https://github.com/Mueller-Systems-Lab/OpenCode-Agenten-Oekosystem" }),
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    await fs.access(path.join(targetRoot, ".opencode/plugins/governance-v2.mjs"))
  } finally {
    await fs.rm(targetRoot, { recursive: true, force: true })
  }
})

test("C4: OpenCode runtime verification remains independent of a concrete adapter host", async () => {
  const { evaluateAction } = await import(pathToFileURL(path.join(repoRoot, "runtime/gates/evaluate-action.mjs")).href)
  const result = await evaluateAction({ runtime: "opencode", tool: "read", action: "read", resource: "fixtures/readme.md" })
  assert.equal(result.allowed, true)
  assert.equal(result.v2_enforced, true)
})

test("C5: Hermes support remains an optional runtime adapter", async () => {
  const hermes = await import(pathToFileURL(path.join(repoRoot, "scripts/lib/runtimes/hermes.mjs")).href)
  const targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-hermes-optional-"))
  try {
    const detection = hermes.detect({ targetRoot })
    assert.equal(detection.runtime, "hermes")
    assert.equal(hermes.generateHandoff().canGenerate, false)
    assert.equal(hermes.capabilities({ targetRoot }).runtime, "hermes")
  } finally {
    await fs.rm(targetRoot, { recursive: true, force: true })
  }
})

test("C7: historical evidence text is non-blocking and does not create validator drift", async () => {
  const historicalPath = path.join(os.tmpdir(), `${legacyInstance}-historical-evidence.txt`)
  await fs.writeFile(historicalPath, `HISTORICAL / NON-BLOCKING: ${legacyInstance} ${legacyAddress}\n`, "utf8")
  try {
    const result = runValidator({ OCAE_HISTORICAL_EVIDENCE_PATH: historicalPath })
    assert.equal(result.status, 0, result.stderr || result.stdout)
  } finally {
    await fs.rm(historicalPath, { force: true })
  }
})

test("C8: text-to-speech remains outside the project scope", async () => {
  const architecture = await fs.readFile(path.join(repoRoot, "docs/architecture/local-completion-runtime.md"), "utf8")
  assert.match(architecture, /Text-to-speech[\s\S]+outside this project's scope/)
  assert.match(architecture, /not\s+production components, capabilities, runtime hooks, observability events,\s+completion gates, or owner actions/)
})
