import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { runNodeScript } from "../helpers.mjs"

test("ocae help advertises the canonical lifecycle and registry operations", () => {
  const result = runNodeScript("scripts/ocae.mjs", ["--help"])
  assert.equal(result.status, 0, result.stderr)
  for (const operation of ["inspect", "plan", "install", "update", "verify", "status", "rollback", "register", "list", "remove", "export"]) {
    assert.match(result.stdout, new RegExp(`\\b${operation}\\b`))
  }
})

test("ocae emits machine-readable fail-closed output for a missing target", () => {
  const result = runNodeScript("scripts/ocae.mjs", ["inspect", "--target", "/tmp/ocae-target-that-does-not-exist", "--json"])
  assert.equal(result.status, 2)
  const output = JSON.parse(result.stdout)
  assert.equal(output.classification, "RED_BLOCK")
  assert.ok(output.blockers.length > 0)
})

test("registry export never includes a local absolute target reference", async () => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-cli-contract-"))
  const registry = path.join(target, "registry.json")
  try {
    const register = runNodeScript("scripts/ocae.mjs", ["register", "--target", target, "--registry", registry, "--json"])
    assert.equal(register.status, 0, register.stderr)
    const exported = runNodeScript("scripts/ocae.mjs", ["export", "--registry", registry, "--json"])
    assert.equal(exported.status, 0, exported.stderr)
    assert.equal(exported.stdout.includes(target), false)
  } finally {
    await fs.rm(target, { recursive: true, force: true })
  }
})
