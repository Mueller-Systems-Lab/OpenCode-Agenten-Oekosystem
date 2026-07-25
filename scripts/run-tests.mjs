#!/usr/bin/env node

import fs from "node:fs/promises"
import fsSync from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const manifestPath = path.join(repoRoot, "test", "test-manifest.json")
const requiredGroups = ["unit", "contract", "integration", "bootstrap", "governance", "e2e", "provider_optional"]
const defaultTimeoutMs = 120_000
const timeoutGraceMs = 2_000
const diagnosticMaxBytes = 16 * 1024

const args = parseArgs(process.argv.slice(2))
const manifest = await loadManifest()
const filesByGroup = validateManifest(manifest)
const availableGroups = Object.keys(filesByGroup)
const canonicalGroups = process.env.OCAE_SECURE_SANDBOX_NOT_APPLICABLE === "1"
  ? requiredGroups.map((group) => group === "integration" ? "integration_portable" : group)
  : requiredGroups
const groups = args.all ? canonicalGroups.filter((group) => filesByGroup[group].length > 0) : args.groups

if (groups.length === 0) fail("No test groups selected")
for (const group of groups) {
  if (!availableGroups.includes(group)) fail(`Unknown test group: ${group}`)
  if (filesByGroup[group].length === 0) fail(`Selected test group is empty: ${group}`)
}

const results = []
for (const group of groups) {
  const startedAt = Date.now()
  const result = await runGroup(group, filesByGroup[group], args)
  results.push({ group, duration_ms: Date.now() - startedAt, ...result })
  if (result.exit_code !== 0) break
}

const totals = results.reduce((acc, result) => {
  for (const key of ["tests", "passed", "failed", "skipped", "cancelled", "todo"]) acc[key] += result[key] || 0
  acc.duration_ms += result.duration_ms
  return acc
}, { tests: 0, passed: 0, failed: 0, skipped: 0, cancelled: 0, todo: 0, duration_ms: 0 })
const complete = results.length === groups.length
const exitCode = complete && results.every((result) => result.exit_code === 0) && totals.tests > 0 ? 0 : 1

if (args.json) {
  console.log(JSON.stringify({
    manifest: path.relative(repoRoot, manifestPath),
    groups,
    expected_test_files: groups.flatMap((group) => filesByGroup[group]),
    executed_test_files: results.flatMap((result) => result.files),
    totals,
    groups_result: results,
    exit_code: exitCode,
  }, null, 2))
} else {
  console.log(`CANONICAL_TEST_MANIFEST: ${path.relative(repoRoot, manifestPath)}`)
  console.log(`EXPECTED_TEST_FILES: ${groups.flatMap((group) => filesByGroup[group]).length}`)
  console.log(`EXECUTED_TEST_FILES: ${results.flatMap((result) => result.files).length}`)
  console.log(`TESTS: ${totals.tests}`)
  console.log(`PASSED: ${totals.passed}`)
  console.log(`FAILED: ${totals.failed}`)
  console.log(`SKIPPED: ${totals.skipped}`)
  console.log(`CANCELLED: ${totals.cancelled}`)
  console.log(`TODO: ${totals.todo}`)
  console.log(`DURATION_MS: ${totals.duration_ms}`)
  console.log(`EXIT_CODE: ${exitCode}`)
}
process.exitCode = exitCode

function parseArgs(argv) {
  const out = {
    all: false,
    groups: [],
    reporter: "spec",
    timeoutMs: defaultTimeoutMs,
    json: false,
    diagnostics: false,
    processAudit: false,
    tempAudit: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--all") out.all = true
    else if (arg === "--group") out.groups.push(argv[++index])
    else if (arg === "--reporter") out.reporter = argv[++index] || "spec"
    else if (arg.startsWith("--reporter=")) out.reporter = arg.slice("--reporter=".length) || "spec"
    else if (arg === "--timeout-ms") out.timeoutMs = Number(argv[++index])
    else if (arg === "--json") out.json = true
    else if (arg === "--diagnostics") out.diagnostics = true
    else if (arg === "--process-audit") out.processAudit = true
    else if (arg === "--temp-audit") out.tempAudit = true
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/run-tests.mjs [--all | --group <name>] [--reporter spec|dot] [--json] [--diagnostics] [--process-audit] [--temp-audit]")
      process.exit(0)
    } else fail(`Unknown argument: ${arg}`)
  }
  if (!out.all && out.groups.length === 0) out.all = true
  if (!["spec", "dot"].includes(out.reporter)) fail(`Unsupported reporter: ${out.reporter}`)
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs < 1000) fail("--timeout-ms must be at least 1000")
  return out
}

async function loadManifest() {
  try {
    return JSON.parse(await fs.readFile(manifestPath, "utf8"))
  } catch (error) {
    fail(`Cannot read test manifest: ${error.message}`)
  }
}

function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1 || !manifest.groups) fail("Invalid test manifest")
  for (const group of requiredGroups) if (!Array.isArray(manifest.groups[group])) fail(`Missing manifest group: ${group}`)
  const seen = new Set()
  const result = {}
  for (const [group, entries] of Object.entries(manifest.groups)) {
    if (!Array.isArray(entries)) fail(`Invalid manifest group: ${group}`)
    result[group] = entries.map((relative) => {
      if (!/^test\/.+\.test\.mjs$/.test(relative)) fail(`Manifest entry is not a test file: ${relative}`)
      if (seen.has(relative)) fail(`Duplicate test file in manifest: ${relative}`)
      seen.add(relative)
      const absolute = path.resolve(repoRoot, relative)
      if (!absolute.startsWith(`${path.join(repoRoot, "test")}${path.sep}`) || !fsSync.existsSync(absolute)) fail(`Manifest test file is missing or outside test/: ${relative}`)
      if (relative.includes("/fixtures/") || relative === "test/helpers.mjs") fail(`Fixture/helper included in manifest: ${relative}`)
      return relative
    })
  }
  if (seen.size === 0) fail("Test manifest is empty")
  return result
}

async function runGroup(group, files, options) {
  const results = []
  for (const file of files) {
    const result = await runTestFile(group, file, options)
    results.push(result)
  }
  const totals = results.reduce((acc, result) => {
    for (const key of ["tests", "passed", "failed", "skipped", "cancelled", "todo"]) acc[key] += result[key] || 0
    return acc
  }, { tests: 0, passed: 0, failed: 0, skipped: 0, cancelled: 0, todo: 0 })
  const failed = results.find((result) => result.exit_code !== 0)
  return {
    files,
    exit_code: failed ? failed.exit_code : 0,
    signal: failed?.signal || null,
    error: failed?.error || null,
    ...totals,
  }
}

async function runTestFile(group, file, options) {
  const { reporter, timeoutMs, diagnostics, processAudit, tempAudit } = options
  const startTime = new Date().toISOString()
  const startedAt = Date.now()
  const childProcessesBefore = processAudit ? readChildProcesses() : []
  const openHandlesBefore = processAudit ? activeHandleCount() : null
  const captureRoot = await fs.mkdtemp(path.join(os.tmpdir(), `ocae-test-${group}-`))
  const stdoutPath = path.join(captureRoot, "stdout.log")
  const stderrPath = path.join(captureRoot, "stderr.log")
  const stdoutHandle = await fs.open(stdoutPath, "w")
  const stderrHandle = await fs.open(stderrPath, "w")
  let outcome
  let tempFilesCreated = []
  let tempFilesRemaining = []
  try {
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, ["--test-reporter=spec", file], {
        cwd: repoRoot,
        env: { ...process.env, OCAE_CANONICAL_TEST_RUNNER: "1" },
        stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
      })
      let error = null
      let timedOut = false
      let forceTimer = null
      const timer = setTimeout(() => {
        timedOut = true
        child.kill("SIGTERM")
        forceTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
        }, timeoutGraceMs)
      }, timeoutMs)
      child.once("error", (spawnError) => {
        error = spawnError.message
      })
      child.once("close", (status, signal) => {
        clearTimeout(timer)
        if (forceTimer) clearTimeout(forceTimer)
        resolve({
          exit_code: status ?? 1,
          signal: signal || null,
          error: timedOut ? `Test file timed out after ${timeoutMs}ms` : error,
        })
      })
    })
    await Promise.all([stdoutHandle.sync(), stderrHandle.sync()])
    const [stdoutBuffer, stderrBuffer] = await Promise.all([fs.readFile(stdoutPath), fs.readFile(stderrPath)])
    const maxBuffer = 50 * 1024 * 1024
    if (stdoutBuffer.length + stderrBuffer.length > maxBuffer) {
      result.exit_code = 1
      result.error = `Test output exceeded ${maxBuffer} bytes`
    }
    const stdout = stdoutBuffer.toString("utf8")
    const stderr = stderrBuffer.toString("utf8")
    if (reporter === "spec") process.stdout.write(stdout)
    else process.stdout.write(renderDot(stdout))
    if (stderr) process.stderr.write(stderr)
    if (tempAudit) tempFilesCreated = await listRelativeFiles(captureRoot)
    outcome = { file, ...result, ...parseSummary(stdout) }
  } finally {
    await Promise.all([stdoutHandle.close(), stderrHandle.close()])
    await fs.rm(captureRoot, { recursive: true, force: true })
    if (tempAudit) tempFilesRemaining = fsSync.existsSync(captureRoot) ? await listRelativeFiles(captureRoot) : []
  }
  if (diagnostics) {
    emitDiagnostic({
      file,
      start_time: startTime,
      end_time: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      exit_code: outcome.exit_code,
      signal: outcome.signal,
      test_count: outcome.tests,
      child_processes_before: childProcessesBefore,
      child_processes_after: processAudit ? readChildProcesses() : [],
      open_handles_before: openHandlesBefore,
      open_handles_after: processAudit ? activeHandleCount() : null,
      temp_files_created: tempFilesCreated,
      temp_files_remaining: tempFilesRemaining,
    })
  }
  return outcome
}

function activeHandleCount() {
  return typeof process._getActiveHandles === "function" ? process._getActiveHandles().length : null
}

function readChildProcesses() {
  try {
    const value = fsSync.readFileSync(`/proc/${process.pid}/task/${process.pid}/children`, "utf8").trim()
    return value ? value.split(/\s+/).slice(0, 64).map(Number).filter(Number.isInteger) : []
  } catch {
    return []
  }
}

async function listRelativeFiles(root) {
  try {
    return (await fs.readdir(root)).slice(0, 64).map((entry) => path.basename(entry))
  } catch {
    return []
  }
}

function emitDiagnostic(record) {
  let encoded = JSON.stringify(record)
  if (Buffer.byteLength(encoded) > diagnosticMaxBytes) {
    encoded = JSON.stringify({ file: record.file, error: "diagnostic record exceeded size limit" })
  }
  process.stderr.write(`DIAGNOSTIC_FILE_RESULT ${encoded}\n`)
}

function parseSummary(output) {
  const value = (name) => Number(output.match(new RegExp(`(?:^|\\n)(?:#|ℹ) ${name} (\\d+)`, "m"))?.[1] || 0)
  return { tests: value("tests"), passed: value("pass"), failed: value("fail"), skipped: value("skipped"), cancelled: value("cancelled"), todo: value("todo") }
}

function renderDot(output) {
  const markers = [...output.matchAll(/^[✔✖]/gm)].map(([marker]) => marker === "✔" ? "." : "X").join("")
  return `${markers || "!"}\n`
}

function fail(message) {
  console.error(`TEST_RUNNER_ERROR: ${message}`)
  process.exitCode = 2
  throw new Error(message)
}
