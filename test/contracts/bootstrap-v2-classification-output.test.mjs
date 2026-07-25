import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const ACTIVE_BOOTSTRAP_RUNTIME = [
  "bootstrap.mjs",
  "bootstrap/verify.mjs",
  "scripts/install-governance.mjs",
  "scripts/bootstrap-project.mjs",
  "scripts/apply-repository-overlay.mjs",
  "scripts/lib/discovery.mjs",
  "runtime/security",
]

async function filesUnder(relativePath) {
  const absolute = path.join(root, relativePath)
  const stat = await fs.stat(absolute)
  if (stat.isFile()) return [relativePath]
  const output = []
  for (const entry of await fs.readdir(absolute, { withFileTypes: true })) {
    const child = path.posix.join(relativePath, entry.name)
    if (entry.isDirectory()) output.push(...await filesUnder(child))
    else if (entry.isFile() && entry.name.endsWith(".mjs")) output.push(child)
  }
  return output
}

test("active bootstrap runtime never emits GREEN_SAFE", async () => {
  const files = (await Promise.all(ACTIVE_BOOTSTRAP_RUNTIME.map(filesUnder))).flat()
  const violations = []
  for (const relativePath of files) {
    const content = await fs.readFile(path.join(root, relativePath), "utf8")
    const emitsLegacy = [
      /console\.(?:log|warn|error)\([^)]*["'`]GREEN_SAFE/,
      /return\s+["'`]GREEN_SAFE["'`]/,
      /classification\s*:\s*["'`]GREEN_SAFE["'`]/,
    ].some((pattern) => pattern.test(content))
    if (emitsLegacy) violations.push(relativePath)
  }
  assert.deepEqual(violations, [])
})

test("bootstrap manifests advertise V2 classifications and explicit legacy input aliases", async () => {
  const ecosystem = JSON.parse(await fs.readFile(path.join(root, "ecosystem.manifest.json"), "utf8"))
  const installer = JSON.parse(await fs.readFile(path.join(root, "governance-install.json"), "utf8"))
  assert.deepEqual(ecosystem.bootstrap.classification_states, [
    "VERIFIED_IN_SCOPE",
    "NEEDS_REVIEW",
    "RED_BLOCK",
    "TOOL_GAP",
  ])
  assert.deepEqual(installer.classification_states, ecosystem.bootstrap.classification_states)
  assert.equal(installer.legacy_input_aliases.GREEN_SAFE, "VERIFIED_IN_SCOPE")
})
