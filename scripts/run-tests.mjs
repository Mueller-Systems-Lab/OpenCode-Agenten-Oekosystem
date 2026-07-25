#!/usr/bin/env node

import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const manifestPath = path.join(repoRoot, "test", "test-manifest.json")
const requiredGroups = ["unit", "contract", "integration", "bootstrap", "governance", "e2e", "provider_optional"]
const defaultTimeoutMs = 120_000

const args = parseArgs(process.argv.slice(2))
const manifest = await loadManifest()
const filesByGroup = validateManifest(manifest)
const availableGroups = Object.keys(filesByGroup)
const groups = args.all ? requiredGroups.filter((group) => filesByGroup[group].length > 0) : args.groups

if (groups.length === 0) fail("No test groups selected")
for (const group of groups) {
  if (!availableGroups.includes(group)) fail(`Unknown test group: ${group}`)
  if (filesByGroup[group].length === 0) fail(`Selected test group is empty: ${group}`)
}

const results = []
for (const group of groups) {
  const startedAt = Date.now()
  const result = await runGroup(group, filesByGroup[group], args.reporter, args.timeoutMs)
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
  const out = { all: false, groups: [], reporter: "spec", timeoutMs: defaultTimeoutMs, json: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--all") out.all = true
    else if (arg === "--group") out.groups.push(argv[++index])
    else if (arg === "--reporter") out.reporter = argv[++index] || "spec"
    else if (arg.startsWith("--reporter=")) out.reporter = arg.slice("--reporter=".length) || "spec"
    else if (arg === "--timeout-ms") out.timeoutMs = Number(argv[++index])
    else if (arg === "--json") out.json = true
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/run-tests.mjs [--all | --group <name>] [--reporter spec|dot] [--json]")
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

function runGroup(group, files, reporter, timeoutMs) {
  const child = spawnSync(process.execPath, ["--test", `--test-reporter=${reporter === "dot" ? "spec" : reporter}`, "--test-concurrency=1", ...files], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: "SIGTERM",
    stdio: ["ignore", "pipe", "pipe"],
  })
  const stdout = child.stdout || ""
  const stderr = child.stderr || ""
  if (reporter === "spec") process.stdout.write(stdout)
  else process.stdout.write(renderDot(stdout))
  if (stderr) process.stderr.write(stderr)
  return {
    files,
    exit_code: child.status ?? 1,
    signal: child.signal || null,
    error: child.error?.message || null,
    ...parseSummary(stdout),
  }
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
