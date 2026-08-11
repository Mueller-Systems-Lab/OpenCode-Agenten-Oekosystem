import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"
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

test("canonical runner accepts the documented --reporter=dot syntax", () => {
  const source = fs.readFileSync(runnerPath, "utf8")
  assert.match(source, /arg\.startsWith\("--reporter="\)/)
})

test("canonical runner publishes bounded per-file diagnostics and audits", () => {
  const source = fs.readFileSync(runnerPath, "utf8")
  assert.match(source, /--diagnostics/)
  assert.match(source, /--process-audit/)
  assert.match(source, /--temp-audit/)
  assert.match(source, /DIAGNOSTIC_FILE_RESULT/)
  assert.match(source, /child_processes_before/)
  assert.match(source, /child_processes_after/)
  assert.match(source, /open_handles_before/)
  assert.match(source, /open_handles_after/)
  assert.match(source, /temp_files_created/)
  assert.match(source, /temp_files_remaining/)
  assert.match(source, /diagnosticMaxBytes/)
  assert.match(source, /SIGKILL/)
  assert.match(source, /timeoutGraceMs/)
  assert.match(source, /defaultTimeoutMs\s*=\s*300_000/)
  const postMergeSource = fs.readFileSync(path.join(repoRoot, "test/integration/post-merge-default-branch.test.mjs"), "utf8")
  assert.match(postMergeSource, /timeout:\s*240_000/)
  assert.match(postMergeSource, /\{\s*timeout:\s*270_000\s*\}/)
})

test("canonical runner emits parseable bounded diagnostics and cleans capture files", () => {
  const result = spawnSync(process.execPath, [
    runnerPath,
    "--group", "unit",
    "--reporter=dot",
    "--diagnostics",
    "--process-audit",
    "--temp-audit",
  ], {
    cwd: repoRoot,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT")),
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const records = result.stderr
    .split("\n")
    .filter((line) => line.startsWith("DIAGNOSTIC_FILE_RESULT "))
    .map((line) => JSON.parse(line.slice("DIAGNOSTIC_FILE_RESULT ".length)))
  assert.equal(records.length, 8)
  for (const record of records) {
    assert.ok(Buffer.byteLength(JSON.stringify(record)) <= 16 * 1024)
    assert.equal(record.exit_code, 0)
    assert.equal(record.signal, null)
    assert.deepEqual(record.child_processes_after, [])
    assert.deepEqual(record.temp_files_remaining, [])
  }
})

test("canonical runner creates a missing isolated temporary root", () => {
  const isolatedRoot = path.join(
    fs.mkdtempSync(path.join(fs.realpathSync.native(process.env.TMPDIR || os.tmpdir()), "ocae-runner-contract-")),
    "fresh-temp-root",
  )
  try {
    const result = spawnSync(process.execPath, [
      runnerPath,
      "--group", "unit",
      "--reporter=dot",
    ], {
      cwd: repoRoot,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT")),
        TMPDIR: isolatedRoot,
      },
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(fs.statSync(isolatedRoot).isDirectory(), true)
  } finally {
    fs.rmSync(path.dirname(isolatedRoot), { recursive: true, force: true })
  }
})
