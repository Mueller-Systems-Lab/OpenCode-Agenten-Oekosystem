import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")
const manifest = JSON.parse(read("ecosystem.manifest.json"))
const release = JSON.parse(read("docs/release-data.json"))
const landing = read("docs/index.html")

test("final publication metadata is coherent", () => {
  assert.equal(release.version, String(manifest.version))
  assert.equal(release.tag, `v${manifest.version}`)
  assert.match(release.releaseCommit, /^[0-9a-f]{40}$/)
  assert.equal(release.installCommand, `uv tool install ocae-cli --from git+https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem.git@v${manifest.version}`)
  assert.equal(release.agentCount, fs.readdirSync(path.join(root, ".opencode/agents")).filter((name) => name.endsWith(".md")).length)
  assert.equal(release.capabilityProfileCount, release.agentCount)
})

test("landing page exposes the stable product contract", () => {
  for (const id of ["quick-start", "agents", "governance", "how-it-works", "capabilities", "cli", "release", "requirements", "docs"]) {
    assert.match(landing, new RegExp(`id="${id}"`))
  }
  assert.match(landing, /assets\/site\.css/)
  assert.match(landing, /assets\/site\.js/)
  assert.match(landing, /13 governed agents/)
  assert.match(landing, /generic\.v1/)
  assert.doesNotMatch(landing, /<section id="release"[\s\S]*?\b(?:pending|unknown)\b/i)
})
