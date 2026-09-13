import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { repoRoot, runNodeScript } from "../helpers.mjs"
import { parseJsonc } from "../../scripts/lib/jsonc.mjs"
import { validateAgentFrontmatter, validateSkillFrontmatter } from "../../scripts/lib/frontmatter.mjs"
import { loadManifest, validateManifest } from "../../scripts/lib/manifest.mjs"

// `.tmp/` contains disposable local tool installations and test artifacts;
// it is intentionally outside the repository's source/documentation truth
// surface and may contain vendor paths from those tools.
const IGNORE_DIRS = new Set([".git", "node_modules", ".opencode/backups", ".opencode-runtime", ".tmp"])

test("repository validation passes", async () => {
  const manifest = await loadManifest(path.join(repoRoot, "ecosystem.manifest.json"))
  assert.deepEqual(validateManifest(manifest), [])

  const validator = runNodeScript("scripts/validate-ecosystem.mjs")
  assert.equal(validator.status, 0, validator.stderr)

  const files = await collectFiles(repoRoot)
  const mjsFiles = files.filter((file) => file.endsWith(".mjs"))
  const jsonFiles = files.filter((file) => file.endsWith(".json"))
  const jsoncFiles = files.filter((file) => file.endsWith(".jsonc"))

  for (const file of mjsFiles) {
    const result = spawnSync(process.execPath, ["--check", path.join(repoRoot, file)], {
      cwd: repoRoot,
      encoding: "utf8",
    })
    assert.equal(result.status, 0, `${file} failed syntax check: ${result.stderr}`)
  }

  for (const file of jsonFiles) {
    const text = await fs.readFile(path.join(repoRoot, file), "utf8")
    assert.doesNotThrow(() => JSON.parse(text), `${file} is invalid JSON`)
  }

  for (const file of jsoncFiles) {
    const text = await fs.readFile(path.join(repoRoot, file), "utf8")
    assert.doesNotThrow(() => parseJsonc(text), `${file} is invalid JSONC`)
  }

  const skillEntries = await fs.readdir(path.join(repoRoot, ".opencode", "skills"), { withFileTypes: true })
  const agentEntries = await fs.readdir(path.join(repoRoot, ".opencode", "agents"), { withFileTypes: true })
  const skillNames = new Set()
  const agentNames = new Set()

  for (const entry of skillEntries) {
    if (!entry.isDirectory()) continue
    const file = path.join(repoRoot, ".opencode", "skills", entry.name, "SKILL.md")
    const text = await fs.readFile(file, "utf8")
    const issues = validateSkillFrontmatter(file, text, entry.name)
    assert.deepEqual(issues, [], `${file} frontmatter invalid: ${issues.join(", ")}`)
    assert.ok(!skillNames.has(entry.name), `duplicate skill directory name: ${entry.name}`)
    skillNames.add(entry.name)
  }

  for (const entry of agentEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const file = path.join(repoRoot, ".opencode", "agents", entry.name)
    const text = await fs.readFile(file, "utf8")
    const issues = validateAgentFrontmatter(file, text, entry.name.replace(/\.md$/, ""))
    assert.deepEqual(issues, [], `${file} frontmatter invalid: ${issues.join(", ")}`)
    assert.ok(!agentNames.has(entry.name), `duplicate agent file name: ${entry.name}`)
    agentNames.add(entry.name)
  }

  for (const file of files) {
    const text = await fs.readFile(path.join(repoRoot, file), "utf8")
    const absolutePathPattern = /\/home\/[A-Za-z0-9._-]+|\/Users\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/
    assert.equal(absolutePathPattern.test(text), false, `${file} contains an absolute user path`)
  }
})

async function collectFiles(root) {
  const files = []

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const relative = path.relative(root, path.join(current, entry.name)).split(path.sep).join("/")
      if (IGNORE_DIRS.has(entry.name) || [...IGNORE_DIRS].some((prefix) => relative.startsWith(`${prefix}/`))) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
      } else if (/\.(md|mjs|json|jsonc|toml|yml|yaml|ts|tsx|py)$/i.test(entry.name)) {
        files.push(relative)
      }
    }
  }

  await walk(root)
  return files.sort()
}
