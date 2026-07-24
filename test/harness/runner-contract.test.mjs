import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { repoRoot } from "../helpers.mjs"

const manifestPath = path.join(repoRoot, "test", "test-manifest.json")
const runnerPath = path.join(repoRoot, "scripts", "run-tests.mjs")

test("canonical test runner and explicit manifest are published", () => {
  assert.equal(fs.existsSync(runnerPath), true, "canonical test runner must exist")
  assert.equal(fs.existsSync(manifestPath), true, "canonical test manifest must exist")

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  const files = Object.values(manifest.groups).flat()
  assert.ok(files.length > 0, "manifest must contain test files")
  assert.equal(new Set(files).size, files.length, "manifest must not contain duplicate test files")
  assert.equal(files.some((file) => file.includes("/fixtures/")), false, "fixtures must not be test entries")
  assert.equal(files.includes("test/helpers.mjs"), false, "helpers must not be test entries")
  for (const file of files) assert.equal(fs.existsSync(path.join(repoRoot, file)), true, `missing manifest test: ${file}`)
})
