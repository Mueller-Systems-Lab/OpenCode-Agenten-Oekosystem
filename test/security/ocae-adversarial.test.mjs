import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { updateRegistry } from "../../scripts/lib/ecosystem-registry.mjs"
import { runNodeScript } from "../helpers.mjs"

test("a symlink target and a corrupted registry are RED_BLOCK, never silently followed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-adversarial-"))
  const target = path.join(root, "target")
  const linked = path.join(root, "linked-target")
  const registry = path.join(root, "registry.json")
  try {
    await fs.mkdir(target)
    await fs.symlink(target, linked)
    const symlinkResult = runNodeScript("scripts/ocae.mjs", ["inspect", "--target", linked, "--json"])
    assert.equal(symlinkResult.status, 2)
    assert.equal(JSON.parse(symlinkResult.stdout).classification, "RED_BLOCK")

    await fs.writeFile(registry, "{not-json")
    await assert.rejects(updateRegistry(registry, { project_id: "fixture" }), /registry/i)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("concurrent local registry updates preserve both project entries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-registry-lock-"))
  const registry = path.join(root, "registry.json")
  try {
    await Promise.all(Array.from({ length: 8 }, (_, index) => updateRegistry(registry, {
      project_id: `fixture-${index}`,
      project: { name: `fixture-${index}`, repository_url: "https://example.invalid/repo.git", commit: "abc" },
      local: { target_reference: `target-${index}` },
      classification: { main: "NEEDS_REVIEW", substatus: ["NOT_INSTALLED"] },
    })))
    const result = runNodeScript("scripts/ocae.mjs", ["list", "--registry", registry, "--json"])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).projects.length, 8)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test("runtime evidence cannot traverse a symlinked target subdirectory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-evidence-symlink-"))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-evidence-outside-"))
  const target = path.join(root, "target")
  try {
    await fs.mkdir(path.join(target, ".opencode", "plugins"), { recursive: true })
    await fs.mkdir(path.join(target, ".agent-governance", "hooks", "opencode"), { recursive: true })
    await fs.writeFile(path.join(target, ".opencode", "plugins", "governance-v2.mjs"), "export default async () => ({})\n")
    await fs.writeFile(path.join(target, ".agent-governance", "hooks", "opencode", "canonical-governance.mjs"), "export default async () => ({})\n")
    await fs.writeFile(path.join(target, "opencode.jsonc"), '{ "plugin": [".opencode/plugins/governance-v2.mjs"] }\n')
    await fs.symlink(outside, path.join(target, ".agent-governance", "evidence"))

    const result = runNodeScript("scripts/ocae.mjs", ["verify", "--target", target, "--simulate", "--evidence", path.join(target, ".agent-governance", "evidence", "proof.json"), "--json"])
    assert.equal(result.status, 2, result.stderr)
    assert.equal(JSON.parse(result.stdout).substatus, "EVIDENCE_PATH_UNSAFE")
    await assert.rejects(fs.access(path.join(outside, "proof.json")))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})
