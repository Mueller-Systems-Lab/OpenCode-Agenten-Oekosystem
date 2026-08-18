import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"
import { repoRoot } from "../helpers.mjs"

const manifestPath = path.join(repoRoot, "test", "test-manifest.json")
const runnerPath = path.join(repoRoot, "scripts", "run-tests.mjs")

// run-tests.mjs streams child test progress to stdout and writes the --json
// aggregate as the final block; parse that trailing report out of stdout.
function parseRunnerJsonReport(stdout) {
  const closeIndex = stdout.lastIndexOf("}")
  if (closeIndex === -1) throw new Error("no JSON report in runner stdout")
  let depth = 0
  for (let index = closeIndex; index >= 0; index -= 1) {
    const char = stdout[index]
    if (char === "}") depth += 1
    else if (char === "{") {
      depth -= 1
      if (depth === 0) return JSON.parse(stdout.slice(index, closeIndex + 1))
    }
  }
  throw new Error("no JSON report in runner stdout")
}

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
  assert.match(postMergeSource, /timeout:\s*1800_000/)
  assert.match(postMergeSource, /\{\s*timeout:\s*1900_000\s*\}/)
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
    timeout: 600_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const records = result.stderr
    .split("\n")
    .filter((line) => line.startsWith("DIAGNOSTIC_FILE_RESULT "))
    .map((line) => JSON.parse(line.slice("DIAGNOSTIC_FILE_RESULT ".length)))
  const unitTestFiles = JSON.parse(fs.readFileSync(manifestPath, "utf8")).groups.unit
  assert.equal(records.length, unitTestFiles.length)
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
        // os.tmpdir() reads TEMP/TMP on Windows and TMPDIR on POSIX; point all
        // of them at the missing root so the runner must create it.
        TMPDIR: isolatedRoot,
        TEMP: isolatedRoot,
        TMP: isolatedRoot,
      },
      encoding: "utf8",
      timeout: 600_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(fs.statSync(isolatedRoot).isDirectory(), true)
  } finally {
    fs.rmSync(path.dirname(isolatedRoot), { recursive: true, force: true })
  }
})

test("runner executes all groups even when an earlier group fails and still fails at the end", () => {
  const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ocae-runner-fixture-"))
  try {
    const manifestDir = path.join(suiteRoot, "test")
    fs.mkdirSync(manifestDir, { recursive: true })
    const manifest = {
      version: 1,
      groups: {
        unit: ["test/g0-fail.test.mjs"],
        contract: ["test/g1-pass.test.mjs"],
        bootstrap: ["test/g2-pass.test.mjs"],
        integration: [],
        governance: [],
        e2e: [],
        provider_optional: [],
      },
    }
    fs.writeFileSync(path.join(manifestDir, "test-manifest.json"), JSON.stringify(manifest))
    fs.writeFileSync(path.join(manifestDir, "g0-fail.test.mjs"), "import test from 'node:test'\nimport assert from 'node:assert/strict'\ntest('must fail', () => { assert.equal(1, 2) })\n")
    fs.writeFileSync(path.join(manifestDir, "g1-pass.test.mjs"), "import test from 'node:test'\ntest('passes', () => {})\n")
    fs.writeFileSync(path.join(manifestDir, "g2-pass.test.mjs"), "import test from 'node:test'\ntest('passes', () => {})\n")
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, "scripts", "run-tests.mjs"),
      "--manifest", path.join(manifestDir, "test-manifest.json"),
      "--json",
    ], {
      cwd: repoRoot,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT")),
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    assert.notEqual(result.status, 0, "final exit code must be non-zero when a group fails")
    const report = parseRunnerJsonReport(result.stdout)
    assert.equal(report.final_status, "FAIL")
    assert.deepEqual(report.failed_groups, ["unit"])
    assert.equal(report.groups_result.length, 3, "all three groups must have been executed")
    const executedGroups = report.groups_result.map((entry) => entry.group).sort()
    assert.deepEqual(executedGroups, ["bootstrap", "contract", "unit"])
    const contract = report.groups_result.find((entry) => entry.group === "contract")
    assert.ok(contract.passed >= 1, "a later group must still run after an earlier failure")
  } finally {
    fs.rmSync(suiteRoot, { recursive: true, force: true })
  }
})

test("runner JSON aggregate exposes final status, failed groups, and per-group skip counts", () => {
  const result = spawnSync(process.execPath, [
    path.join(repoRoot, "scripts", "run-tests.mjs"),
    "--group", "unit",
    "--json",
  ], {
    cwd: repoRoot,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT")),
    encoding: "utf8",
    timeout: 600_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const report = parseRunnerJsonReport(result.stdout)
  assert.ok(["PASS", "FAIL"].includes(report.final_status))
  assert.ok(Array.isArray(report.failed_groups))
  assert.ok(Array.isArray(report.skipped_groups))
  assert.ok(Array.isArray(report.groups_result))
  const unit = report.groups_result.find((entry) => entry.group === "unit")
  assert.ok(unit, "unit group must be reported")
  assert.equal(typeof unit.passed, "number")
  assert.equal(typeof unit.failed, "number")
  assert.equal(typeof unit.skipped, "number")
  assert.ok(["PASS", "FAIL", "PASS_WITH_UNSUPPORTED"].includes(unit.status), "per-group status must be canonical")
  assert.equal(report.exit_code, report.final_status === "PASS" ? 0 : 1, "exit code must match final status")
})

test("symlink capability probe reports a well-formed real host capability", async () => {
  const { probeSymlinkCapability } = await import("../lib/symlink-capability.mjs")
  for (const type of ["file", "dir", "junction"]) {
    const probe = await probeSymlinkCapability({ type })
    assert.equal(typeof probe.supported, "boolean", `probe(${type}).supported`)
    assert.ok(
      ["HOST_SYMLINK_CAPABILITY_AVAILABLE", "HOST_SYMLINK_CAPABILITY_UNAVAILABLE"].includes(probe.code),
      `probe(${type}).code must be a canonical capability code, got ${probe.code}`,
    )
    if (!probe.supported) {
      assert.ok(typeof probe.reason === "string" && probe.reason.length > 0, `probe(${type}).reason must explain the limitation`)
    }
  }
})

test("runner honors per-file timeout overrides from the manifest", () => {
  const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ocae-runner-timeout-"))
  try {
    const manifestDir = path.join(suiteRoot, "test")
    fs.mkdirSync(manifestDir, { recursive: true })
    const manifest = {
      version: 1,
      timeouts: { "test/tiny-timeout.test.mjs": 1, "test/normal-timeout.test.mjs": 60_000 },
      groups: {
        unit: ["test/tiny-timeout.test.mjs", "test/normal-timeout.test.mjs"],
        contract: [],
        bootstrap: [],
        integration: [],
        governance: [],
        e2e: [],
        provider_optional: [],
      },
    }
    fs.writeFileSync(path.join(manifestDir, "test-manifest.json"), JSON.stringify(manifest))
    fs.writeFileSync(path.join(manifestDir, "tiny-timeout.test.mjs"), "import test from 'node:test'\ntest('runs', () => {})\n")
    fs.writeFileSync(path.join(manifestDir, "normal-timeout.test.mjs"), "import test from 'node:test'\ntest('runs', () => {})\n")
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, "scripts", "run-tests.mjs"),
      "--manifest", path.join(manifestDir, "test-manifest.json"),
      "--json",
    ], {
      cwd: repoRoot,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT")),
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    const report = parseRunnerJsonReport(result.stdout)
    // The 1ms override must make the tiny-timeout file time out → group FAIL.
    assert.equal(report.final_status, "FAIL")
    assert.deepEqual(report.failed_groups, ["unit"])
    // The normal file with a 60s override must still run (group attempted both files).
    const unit = report.groups_result.find((entry) => entry.group === "unit")
    assert.equal(unit.files.length, 2)
    assert.ok(unit.passed >= 1, "the normal-timeout file must still pass")
  } finally {
    fs.rmSync(suiteRoot, { recursive: true, force: true })
  }
})


test("runner reports a fully-skipped group as PASS_WITH_UNSUPPORTED without failing the suite", () => {
  const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ocae-runner-skip-"))
  try {
    const manifestDir = path.join(suiteRoot, "test")
    fs.mkdirSync(manifestDir, { recursive: true })
    const manifest = {
      version: 1,
      groups: {
        unit: ["test/skip-all.test.mjs", "test/pass.test.mjs"],
        contract: [],
        bootstrap: [],
        integration: [],
        governance: [],
        e2e: [],
        provider_optional: [],
      },
    }
    fs.writeFileSync(path.join(manifestDir, "test-manifest.json"), JSON.stringify(manifest))
    fs.writeFileSync(path.join(manifestDir, "skip-all.test.mjs"), "import test from 'node:test'\ntest('unsupported', (t) => { t.skip('HOST_SYMLINK_CAPABILITY_UNAVAILABLE') })\ntest('unsupported too', (t) => { t.skip('unsupported') })\n")
    fs.writeFileSync(path.join(manifestDir, "pass.test.mjs"), "import test from 'node:test'\ntest('passes', () => {})\n")
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, "scripts", "run-tests.mjs"),
      "--manifest", path.join(manifestDir, "test-manifest.json"),
      "--json",
    ], {
      cwd: repoRoot,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT")),
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    assert.equal(result.status, 0, "suite with only explicit skips and real passes must exit 0")
    const report = parseRunnerJsonReport(result.stdout)
    assert.equal(report.final_status, "PASS")
    const unit = report.groups_result.find((entry) => entry.group === "unit")
    assert.equal(unit.status, "PASS_WITH_UNSUPPORTED", "mixed skip+pass group must carry the unsupported status")
    assert.equal(unit.skipped, 2)
    assert.equal(unit.passed, 1)
    assert.deepEqual(report.skipped_groups, ["unit"], "any group carrying explicit unsupported skips is reported as skipped")
  } finally {
    fs.rmSync(suiteRoot, { recursive: true, force: true })
  }
})

test("runner marks a group whose tests are all explicitly skipped as skipped, still green overall", () => {
  const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ocae-runner-skipall-"))
  try {
    const manifestDir = path.join(suiteRoot, "test")
    fs.mkdirSync(manifestDir, { recursive: true })
    const manifest = {
      version: 1,
      groups: {
        unit: ["test/pass.test.mjs"],
        contract: ["test/skip-all.test.mjs"],
        bootstrap: [],
        integration: [],
        governance: [],
        e2e: [],
        provider_optional: [],
      },
    }
    fs.writeFileSync(path.join(manifestDir, "test-manifest.json"), JSON.stringify(manifest))
    fs.writeFileSync(path.join(manifestDir, "pass.test.mjs"), "import test from 'node:test'\ntest('passes', () => {})\n")
    fs.writeFileSync(path.join(manifestDir, "skip-all.test.mjs"), "import test from 'node:test'\ntest('unsupported', (t) => { t.skip('HOST_SYMLINK_CAPABILITY_UNAVAILABLE') })\n")
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, "scripts", "run-tests.mjs"),
      "--manifest", path.join(manifestDir, "test-manifest.json"),
      "--json",
    ], {
      cwd: repoRoot,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "NODE_TEST_CONTEXT")),
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    assert.equal(result.status, 0, "explicit skips must not fail the suite")
    const report = parseRunnerJsonReport(result.stdout)
    assert.equal(report.final_status, "PASS")
    assert.deepEqual(report.skipped_groups, ["contract"])
    const contract = report.groups_result.find((entry) => entry.group === "contract")
    assert.equal(contract.status, "PASS_WITH_UNSUPPORTED")
  } finally {
    fs.rmSync(suiteRoot, { recursive: true, force: true })
  }
})

test("validator outer suite timeout is manifest-aware and never a hard 120s cut", () => {
  const validatorSource = fs.readFileSync(path.join(repoRoot, "scripts", "validate-ecosystem.mjs"), "utf8")
  assert.match(validatorSource, /computeSuiteOuterTimeoutMs/, "validator must compute a manifest-aware outer suite timeout")
  assert.match(validatorSource, /DEFAULT_FILE_TIMEOUT_MS\s*=\s*300_000/, "validator must share the runner's default per-file timeout")
  assert.match(validatorSource, /test-manifest\.json/, "validator timeout must read the canonical test manifest")
  assert.doesNotMatch(validatorSource, /timeout:\s*120000/, "validator must not hard-code the old 120s suite cutoff")
  assert.match(validatorSource, /timeout:\s*suiteOuterTimeoutMs/, "validator must pass the computed suite timeout to the runner")

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  const timeouts = manifest.timeouts || {}
  let worstCaseSum = 0
  let fileCount = 0
  let largestOverride = 0
  for (const group of Object.values(manifest.groups)) {
    for (const file of group) {
      fileCount += 1
      const override = timeouts[file]
      const effective = Number.isFinite(override) && override > 0 ? override : 300_000
      worstCaseSum += effective
      if (effective > largestOverride) largestOverride = effective
    }
  }
  assert.ok(largestOverride >= 1_800_000, "manifest must carry the 30-minute post-merge override that the old 120s cutoff would have killed")
  assert.ok(worstCaseSum >= largestOverride, "worst-case sum must cover the largest legitimately allowed inner run")
  assert.ok(fileCount > 0, "manifest must declare test files for timeout accounting")
})

test("history-gated automigration fixture never hard-fails a clean single-commit checkout", () => {
  const source = fs.readFileSync(path.join(repoRoot, "test/bootstrap/existing-installation-automigration.test.mjs"), "utf8")
  assert.match(source, /OLD_COMMIT_AVAILABLE/, "automigration fixture availability must be probed, not assumed")
  assert.match(source, /spawnSync\("git", \["cat-file", "-t", OLD_COMMIT\]/, "the probe must check real git object availability")
  assert.match(source, /GIT_HISTORY_UNAVAILABLE/, "an absent history object must yield an explicit unsupported skip")
  assert.ok(
    source.indexOf("if (!OLD_COMMIT_AVAILABLE)") < source.indexOf("const target = await makeOldInstallation(t)"),
    "the explicit skip gate must precede the fixture construction in every test",
  )
})

