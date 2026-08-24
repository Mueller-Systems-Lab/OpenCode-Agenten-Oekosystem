import { createHash } from "node:crypto"
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs"
import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ADAPTER_ID = "ocae-opencode-handoff"
const CANONICAL_REPOSITORY = "https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem"
const CANONICAL_URL_RE = /https:\/\/github\.com\/xxammaxx\/OpenCode-Agenten-Oekosystem(?:\.git)?\/?(?=$|[\s"'<>),.!?])/iu
const RUNTIME_STATE_SCHEMA_VERSION = "ocae-project-runtime-state.1"
const GOVERNANCE_RUNTIME_VERSION = "governance-v2.runtime.1"
const TASK_BOOTSTRAP_CONTRACT_VERSION = "governance-v2.task-bootstrap.1"
const INSTALLER_CONTRACT_VERSION = "url-only-v1.installer.1"
const DEVELOPMENT_RE = /(?:\b(?:develop|edit|fix|modify|work\s+on|open|bearbeite|entwickl|aendere|ändere|arbeite|oeffne|öffne)\b)[\s\S]{0,120}(?:OCAE|OpenCode-Agenten-Oekosystem|repository|installer)|(?:OCAE|OpenCode-Agenten-Oekosystem|repository|installer)[\s\S]{0,120}(?:\b(?:develop|edit|fix|modify|work\s+on|open|bearbeite|entwickl|aendere|ändere|arbeite|oeffne|öffne)\b)/iu

const adapterDirectory = path.dirname(fileURLToPath(import.meta.url))
const configDirectory = path.dirname(adapterDirectory)
const manifestPath = path.join(configDirectory, "ocae-opencode-integration.json")
const inFlight = new Map()

function recordHash(value) {
  return createHash("sha256").update(value).digest("hex")
}

function canonicalJson(value) {
  return JSON.stringify(value)
}

function fileHash(file) {
  return recordHash(readFileSync(file))
}

function fileHashMatches(expected, file) {
  const actual = fileHash(file)
  return expected === actual || expected === `sha256:${actual}`
}

function jsonHash(value) {
  return `sha256:${recordHash(canonicalJson(value))}`
}

function versionTuple(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || "").trim())
  return match ? match.slice(1).map(Number) : null
}

function compareVersions(left, right) {
  const a = versionTuple(left)
  const b = versionTuple(right)
  if (!a || !b) return null
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}

function pathExecutable(name) {
  const pathEntries = String(process.env.PATH || "").split(path.delimiter).filter(Boolean)
  const candidates = process.platform === "win32" ? [`${name}.exe`, name] : [name]
  for (const entry of pathEntries) {
    for (const candidate of candidates) {
      const value = path.resolve(entry, candidate)
      try {
        if (existsSync(value) && !lstatSync(value).isSymbolicLink()) return path.normalize(realpathSync(value))
      } catch {}
    }
  }
  return null
}

function loadManifest() {
  if (!existsSync(manifestPath)) throw new Error("RED_BLOCK_INTEGRATION_MANIFEST_MISSING")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  if (manifest.integration_id !== ADAPTER_ID || manifest.adapter_path !== path.join(adapterDirectory, "opencode-handoff.js")) {
    throw new Error("RED_BLOCK_INTEGRATION_MANIFEST_SCOPE")
  }
  if (manifest.adapter_sha256 !== fileHash(manifest.adapter_path)) {
    throw new Error("RED_BLOCK_INTEGRATION_TAMPERED")
  }
  if (!path.isAbsolute(manifest.cli_path) || !existsSync(manifest.cli_path) || lstatSync(manifest.cli_path).isSymbolicLink()) {
    throw new Error("RED_BLOCK_CLI_BINDING_MISSING")
  }
  const pathCli = pathExecutable("ocae")
  const normalizedPathCli = pathCli ? path.normalize(pathCli).toLowerCase() : null
  const normalizedManifestCli = path.normalize(realpathSync(manifest.cli_path)).toLowerCase()
  if (normalizedPathCli && normalizedPathCli !== normalizedManifestCli) {
    throw new Error("RED_BLOCK_CLI_BINDING_CHANGED")
  }
  if (manifest.cli_sha256 !== fileHash(manifest.cli_path)) {
    throw new Error("RED_BLOCK_CLI_BINDING_CHANGED")
  }
  return manifest
}

function capturedTarget(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("RED_BLOCK_TARGET_UNCLEAR")
  const initial = path.resolve(directory)
  const stat = lstatSync(initial)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("RED_BLOCK_TARGET_SYMLINK")
  return path.normalize(requireRealPath(initial))
}

function resolveOpenCodeTarget(context = {}) {
  for (const candidate of [context?.directory, context?.worktree]) {
    if (typeof candidate !== "string" || !path.isAbsolute(candidate)) continue
    return capturedTarget(candidate)
  }
  throw new Error("RED_BLOCK_TARGET_UNCLEAR")
}

function requireRealPath(value) {
  return path.normalize(realpathSync(path.resolve(value)))
}

function repositoryUrl(value) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  if (raw.startsWith("git@github.com:")) return `https://github.com/${raw.slice("git@github.com:".length)}`.replace(/\.git\/?$/iu, "")
  return raw.replace(/\.git\/?$/iu, "").replace(/\/$/u, "")
}

function sourceCollision(targetRoot) {
  const marker = path.join(targetRoot, ".git")
  if (!existsSync(marker)) return false
  if (lstatSync(marker).isSymbolicLink()) throw new Error("RED_BLOCK_TARGET_GIT_SYMLINK")
  const config = lstatSync(marker).isDirectory() ? path.join(marker, "config") : null
  if (!config || !existsSync(config)) return false
  let inOrigin = false
  for (const line of readFileSync(config, "utf8").split(/\r?\n/u)) {
    const section = line.match(/^\s*\[remote\s+"([^"]+)"\]\s*$/u)
    if (section) {
      inOrigin = section[1] === "origin"
      continue
    }
    if (inOrigin) {
      const url = line.match(/^\s*url\s*=\s*(.+?)\s*$/u)?.[1]
      if (repositoryUrl(url) === CANONICAL_REPOSITORY) return true
    }
  }
  return false
}

function regularJsonMetadata(file, label) {
  try {
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink()) return { value: null, error: `${label}_SYMLINK_OR_NOT_FILE` }
    const value = JSON.parse(readFileSync(file, "utf8"))
    return { value, error: null }
  } catch {
    return { value: null, error: `${label}_UNREADABLE` }
  }
}

function inspectProjectMetadata(targetRoot, desired = {}) {
  const installationPath = path.join(targetRoot, ".opencode", "ecosystem-installation.json")
  if (!existsSync(installationPath)) return { state: "NOT_INSTALLED", reason: "OCAE installation manifest is absent" }
  const installationResult = regularJsonMetadata(installationPath, "INSTALLATION_MANIFEST")
  if (installationResult.error || !installationResult.value || Array.isArray(installationResult.value)) {
    return { state: "CORRUPT", reason: installationResult.error || "INSTALLATION_MANIFEST_INVALID" }
  }

  const governanceRoot = path.join(targetRoot, ".agent-governance")
  try {
    const stat = lstatSync(governanceRoot)
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { state: "CORRUPT", reason: "GOVERNANCE_ROOT_SYMLINK_OR_NOT_DIRECTORY" }
  } catch {
    return { state: "CORRUPT", reason: "GOVERNANCE_ROOT_MISSING" }
  }

  const sourceLockPath = path.join(governanceRoot, "source-lock.json")
  const lockResult = regularJsonMetadata(sourceLockPath, "SOURCE_LOCK")
  if (lockResult.error || !lockResult.value || !Array.isArray(lockResult.value.files)) {
    return { state: "CORRUPT", reason: lockResult.error || "SOURCE_LOCK_INVALID" }
  }
  const expectedLockHash = installationResult.value.file_hashes?.[".agent-governance/source-lock.json"]
  if (expectedLockHash && !fileHashMatches(expectedLockHash, sourceLockPath)) {
    return { state: "CORRUPT", reason: "SOURCE_LOCK_TAMPERED" }
  }

  const markerPath = path.join(governanceRoot, "runtime-state.json")
  if (!existsSync(markerPath)) {
    return { state: "MIGRATION_REQUIRED", reason: "RUNTIME_STATE_MISSING", installed_source_commit: lockResult.value.source_commit || null }
  }
  const markerResult = regularJsonMetadata(markerPath, "RUNTIME_STATE")
  if (markerResult.error || !markerResult.value || Array.isArray(markerResult.value)) {
    return { state: "CORRUPT", reason: markerResult.error || "RUNTIME_STATE_INVALID" }
  }
  const marker = markerResult.value
  const { integrity, ...body } = marker
  if (!integrity || integrity.algorithm !== "sha256" || integrity.value !== jsonHash(body)) {
    return { state: "CORRUPT", reason: "RUNTIME_STATE_INTEGRITY_FAILED" }
  }
  const expectedMarkerHash = installationResult.value.file_hashes?.[".agent-governance/runtime-state.json"]
  if (expectedMarkerHash && !fileHashMatches(expectedMarkerHash, markerPath)) {
    return { state: "MIGRATION_REQUIRED", reason: "RUNTIME_STATE_MANAGED_DRIFT", marker: body }
  }
  const expectedContract = {
    schema_version: RUNTIME_STATE_SCHEMA_VERSION,
    governance_runtime_version: GOVERNANCE_RUNTIME_VERSION,
    task_bootstrap_contract_version: TASK_BOOTSTRAP_CONTRACT_VERSION,
    installer_contract_version: INSTALLER_CONTRACT_VERSION,
    runtime_state: "CURRENT",
  }
  if (Object.entries(expectedContract).some(([key, value]) => body[key] !== value)) {
    return { state: "MIGRATION_REQUIRED", reason: "RUNTIME_STATE_CONTRACT_STALE", marker: body }
  }

  const desiredVersion = desired.ocae_version || null
  const versionComparison = compareVersions(body.ocae_version, desiredVersion)
  if (versionComparison === null) return { state: "CORRUPT", reason: "RUNTIME_STATE_VERSION_INVALID", marker: body }
  if (versionComparison > 0) return { state: "INCOMPATIBLE", reason: "PROJECT_VERSION_NEWER_THAN_TRUSTED_CLI", marker: body }
  if (versionComparison < 0 || (desired.source_commit && body.source_commit !== desired.source_commit)) {
    return { state: "MIGRATION_REQUIRED", reason: "PROJECT_RUNTIME_STALE", marker: body }
  }
  if (!/^[0-9a-f]{40}$/iu.test(String(body.source_commit || ""))) {
    return { state: "CORRUPT", reason: "RUNTIME_STATE_SOURCE_COMMIT_INVALID", marker: body }
  }
  if (lockResult.value.source_commit !== body.source_commit) {
    return { state: "MIGRATION_REQUIRED", reason: "SOURCE_LOCK_OLDER_THAN_RUNTIME_MARKER", marker: body }
  }
  const markerLock = lockResult.value.files.find((entry) => entry.kind === "runtime_state")
  if (markerLock?.installed_sha256 && !fileHashMatches(markerLock.installed_sha256, markerPath)) {
    return { state: "MIGRATION_REQUIRED", reason: "RUNTIME_STATE_MANAGED_DRIFT", marker: body }
  }

  const requiredRuntime = [
    path.join(governanceRoot, "runtime", "bootstrap", "task-bootstrap.mjs"),
    path.join(governanceRoot, "policies", "task-bootstrap-policy.json"),
    path.join(governanceRoot, "runtime", "governance", "owner-intent.schema.json"),
    path.join(governanceRoot, "runtime", "governance", "task-capsule.schema.json"),
  ]
  if (requiredRuntime.some((file) => !existsSync(file) || lstatSync(file).isSymbolicLink())) {
    return { state: "MIGRATION_REQUIRED", reason: "TASK_BOOTSTRAP_RUNTIME_INCOMPLETE", marker: body }
  }
  return { state: "CURRENT", reason: "RUNTIME_STATE_CURRENT", marker: body }
}

function textParts(output) {
  return (Array.isArray(output?.parts) ? output.parts : [])
    .filter((part) => part?.type === "text" && part.synthetic !== true)
    .map((part) => String(part.text || ""))
    .join("\n")
    .trim()
}

function intentFor(text) {
  if (!CANONICAL_URL_RE.test(text)) return "NEEDS_REVIEW_UNRELATED_INPUT"
  if (DEVELOPMENT_RE.test(text)) return "DEVELOP_OCAE"
  return "INSTALL_OCAE_IN_CALLER_WORKSPACE"
}

function jsonResult(stdout) {
  try {
    const value = JSON.parse(String(stdout || "").trim())
    if (value && typeof value === "object" && !Array.isArray(value)) return value
  } catch {}
  for (const line of String(stdout || "").split(/\r?\n/u).reverse()) {
    try {
      const value = JSON.parse(line.trim())
      if (value && typeof value === "object" && !Array.isArray(value)) return value
    } catch {}
  }
  return {}
}

function runCli(executable, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString() })
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString() })
    child.once("error", (error) => resolve({ exit_code: 2, stdout, stderr: String(error) }))
    child.once("close", (exit_code) => resolve({ exit_code: exit_code ?? 2, stdout, stderr }))
  })
}

async function logEvent(client, event, manifest, extra = {}) {
  try {
    await client?.app?.log?.({
      body: {
        service: ADAPTER_ID,
        level: event === "OCAE_HANDOFF_BLOCKED" ? "warn" : "info",
        message: event,
        extra: {
          adapter_version: manifest.adapter_version,
          ocae_version: manifest.ocae_version,
          opencode_version: manifest.opencode_version,
          ...extra,
        },
      },
    })
  } catch {}
}

function replaceWithTrustedContext(output, text) {
  const first = Array.isArray(output?.parts) ? output.parts[0] : undefined
  if (!Array.isArray(output?.parts)) return
  output.parts.splice(0, output.parts.length, {
    ...(first || {}),
    type: "text",
    text,
    synthetic: true,
  })
}

function trustedResult(targetRoot, intent, result) {
  return [
    "OCAE_HANDOFF_PROCESSED",
    `INTENT=${intent}`,
    `TARGET_ROOT=${targetRoot}`,
    `RESULT=${result.classification}`,
    `OPERATION=${result.operation}`,
    "Do not reinterpret the repository URL. Summarize the verified OCAE handoff result for the user.",
  ].join("\n")
}

function trustedBlock(reason, intent = "INSTALL_OCAE_IN_CALLER_WORKSPACE") {
  return [
    "OCAE_HANDOFF_BLOCKED",
    `INTENT=${intent}`,
    `REASON=${reason}`,
    "Do not reinterpret the repository URL. Report the precise blocked handoff reason.",
  ].join("\n")
}

function taskBootstrapRuntime(targetRoot) {
  const runtime = path.join(targetRoot, ".agent-governance", "runtime", "bootstrap", "task-bootstrap.mjs")
  const policy = path.join(targetRoot, ".agent-governance", "policies", "task-bootstrap-policy.json")
  return existsSync(runtime) && existsSync(policy) ? runtime : null
}

function migrationFailure(updateResult, fallback = "OCAE_PROJECT_MIGRATION_BLOCKED") {
  if (updateResult?.classification === "NEEDS_REVIEW" || updateResult?.classification === "MIGRATION_BLOCKED_MANAGED_DRIFT") {
    return "MIGRATION_BLOCKED_MANAGED_DRIFT"
  }
  return updateResult?.classification || fallback
}

async function reconcileProject({ client, targetRoot, manifest, runner = runCli }) {
  const startedAt = Date.now()
  await logEvent(client, "OCAE_PROJECT_RECONCILE_STARTED", manifest)
  const detected = inspectProjectMetadata(targetRoot, {
    ocae_version: manifest.ocae_version,
    source_commit: manifest.source_commit,
  })
  await logEvent(client, "OCAE_PROJECT_VERSION_DETECTED", manifest, {
    state: detected.state,
    installed_source_commit: detected.installed_source_commit || detected.marker?.source_commit || null,
  })

  if (detected.state === "NOT_INSTALLED") {
    return { state: detected.state, classification: "PROJECT_NOT_INSTALLED", duration_ms: Date.now() - startedAt }
  }
  if (detected.state === "CURRENT") {
    await logEvent(client, "OCAE_PROJECT_CURRENT", manifest, { duration_ms: Date.now() - startedAt })
    return { state: detected.state, classification: "PROJECT_CURRENT", duration_ms: Date.now() - startedAt }
  }
  if (detected.state === "CORRUPT" || detected.state === "INCOMPATIBLE") {
    await logEvent(client, "OCAE_PROJECT_MIGRATION_BLOCKED", manifest, {
      classification: detected.state === "CORRUPT" ? "PROJECT_CORRUPT" : "PROJECT_INCOMPATIBLE",
      reason: detected.reason,
      duration_ms: Date.now() - startedAt,
    })
    return {
      state: detected.state,
      classification: detected.state === "CORRUPT" ? "PROJECT_CORRUPT" : "PROJECT_INCOMPATIBLE",
      reason: detected.reason,
    }
  }

  await logEvent(client, "OCAE_PROJECT_MIGRATION_REQUIRED", manifest, {
    reason: detected.reason,
    installed_source_commit: detected.installed_source_commit || detected.marker?.source_commit || null,
  })
  await logEvent(client, "OCAE_PROJECT_MIGRATION_STARTED", manifest)

  const doctor = await runner(manifest.cli_path, ["doctor", targetRoot, "--json"], targetRoot)
  const doctorResult = jsonResult(doctor.stdout)
  if (doctor.exit_code === 2 && !["PROJECT_MIGRATION_REQUIRED"].includes(doctorResult.classification)) {
    const classification = migrationFailure(doctorResult, "PROJECT_CORRUPT")
    await logEvent(client, "OCAE_PROJECT_MIGRATION_BLOCKED", manifest, { classification, duration_ms: Date.now() - startedAt })
    return { state: "MIGRATION_BLOCKED", classification, reason: doctorResult.reason || "doctor failed" }
  }

  const update = await runner(manifest.cli_path, ["update", targetRoot, "--json"], targetRoot)
  const updateResult = jsonResult(update.stdout)
  if (update.exit_code !== 0) {
    const classification = migrationFailure(updateResult)
    await logEvent(client, "OCAE_PROJECT_MIGRATION_BLOCKED", manifest, { classification, duration_ms: Date.now() - startedAt })
    return { state: "MIGRATION_BLOCKED", classification, reason: updateResult.reason || "update failed" }
  }

  const verify = await runner(manifest.cli_path, ["verify", targetRoot, "--json"], targetRoot)
  const verifyResult = jsonResult(verify.stdout)
  const after = inspectProjectMetadata(targetRoot, {
    ocae_version: manifest.ocae_version,
    source_commit: manifest.source_commit,
  })
  if (verify.exit_code !== 0 || after.state !== "CURRENT") {
    const classification = after.state === "CORRUPT" ? "PROJECT_CORRUPT" : after.state === "INCOMPATIBLE" ? "PROJECT_INCOMPATIBLE" : migrationFailure(verifyResult, "OCAE_PROJECT_VERIFY_BLOCKED")
    await logEvent(client, "OCAE_PROJECT_MIGRATION_BLOCKED", manifest, { classification, duration_ms: Date.now() - startedAt })
    return { state: "MIGRATION_BLOCKED", classification, reason: verifyResult.reason || after.reason || "verify failed" }
  }
  await logEvent(client, "OCAE_PROJECT_MIGRATION_COMPLETED", manifest, { duration_ms: Date.now() - startedAt })
  await logEvent(client, "OCAE_PROJECT_VERIFY_COMPLETED", manifest, { result: "PASS", duration_ms: Date.now() - startedAt })
  return { state: "CURRENT", classification: "PROJECT_CURRENT", migrated: true, duration_ms: Date.now() - startedAt }
}

async function handleTaskBootstrap({ client, directory, worktree, input, output }) {
  if (output?.message?.role && output.message.role !== "user") return
  const text = textParts(output)
  if (!text || /https:\/\/github\.com\/xxammaxx\/OpenCode-Agenten-Oekosystem(?:\.git)?\/?/iu.test(text)) return
  let targetRoot
  try {
    targetRoot = resolveOpenCodeTarget({ directory, worktree })
  } catch (error) {
    replaceWithTrustedContext(output, trustedBlock(error instanceof Error ? error.message : "RED_BLOCK_TARGET_UNCLEAR", "TASK_BOOTSTRAP"))
    return { state: "MIGRATION_BLOCKED", classification: error instanceof Error ? error.message : "RED_BLOCK_TARGET_UNCLEAR" }
  }
  let manifest
  try { manifest = loadManifest() } catch { return }
  const reconciliation = await reconcileProject({ client, targetRoot, manifest })
  if (reconciliation.state === "NOT_INSTALLED") return
  if (reconciliation.state !== "CURRENT") {
    replaceWithTrustedContext(output, trustedBlock(reconciliation.classification, "TASK_BOOTSTRAP"))
    return reconciliation
  }
  const runtime = taskBootstrapRuntime(targetRoot)
  if (!runtime) {
    replaceWithTrustedContext(output, trustedBlock("OCAE_PROJECT_MIGRATION_BLOCKED", "TASK_BOOTSTRAP"))
    return { state: "MIGRATION_BLOCKED", classification: "OCAE_PROJECT_MIGRATION_BLOCKED" }
  }
  const key = `${input.sessionID}:${input.messageID || output?.message?.id || "unknown"}:task-bootstrap`
  if (inFlight.has(key)) return inFlight.get(key)
  const work = (async () => {
    await logEvent(client, "TASK_BOOTSTRAP_STARTED", manifest, { session_id: input.sessionID })
    const node = pathExecutable("node")
    if (!node) return { classification: "TOOL_GAP_NODE_RUNTIME", operation: "TASK_BOOTSTRAP" }
    const message = Buffer.from(text, "utf8").toString("base64url")
    const result = await runCli(node, [
      runtime,
      "--target", targetRoot,
      "--session-id", input.sessionID || "unknown-session",
      "--message-id", input.messageID || output?.message?.id || "unknown-message",
      "--message-b64", message,
    ], targetRoot)
    const payload = jsonResult(result.stdout)
    if (result.exit_code !== 0 || payload.state !== "TASK_READY") {
      const code = payload.code || "RED_BLOCK_TASK_BOOTSTRAP"
      await logEvent(client, "TASK_BOOTSTRAP_BLOCKED", manifest, { code })
      return { classification: code, operation: "TASK_BOOTSTRAP" }
    }
    await logEvent(client, "TASK_READY", manifest, { task_id: payload.task_id || null })
    return { classification: "VERIFIED_IN_SCOPE", operation: "TASK_BOOTSTRAP", task_id: payload.task_id || null }
  })()
  inFlight.set(key, work)
  try {
    const result = await work
    if (result.classification !== "VERIFIED_IN_SCOPE") replaceWithTrustedContext(output, trustedBlock(result.classification, "TASK_BOOTSTRAP"))
    return result
  } finally {
    inFlight.delete(key)
  }
}

async function handleHandoff({ client, directory, worktree, input, output }) {
  const text = textParts(output)
  const intent = intentFor(text)
  if (intent === "NEEDS_REVIEW_UNRELATED_INPUT" || intent === "DEVELOP_OCAE") return

  let manifest
  let targetRoot
  try {
    manifest = loadManifest()
    targetRoot = resolveOpenCodeTarget({ directory, worktree })
    await logEvent(client, "OCAE_HANDOFF_DETECTED", manifest, { intent })
    await logEvent(client, "OCAE_HANDOFF_TARGET_CAPTURED", manifest, { intent, target_root: targetRoot })
    if (sourceCollision(targetRoot)) throw new Error("RED_BLOCK_SOURCE_TARGET_IDENTITY_COLLISION")

    const key = `${input.sessionID}:${input.messageID || "unknown"}`
    if (inFlight.has(key)) {
      replaceWithTrustedContext(output, trustedBlock("RED_BLOCK_DUPLICATE_HANDOFF", intent))
      return
    }
    const work = (async () => {
      await logEvent(client, "OCAE_HANDOFF_INTENT_RESOLVED", manifest, { intent })
      const doctor = await runCli(manifest.cli_path, ["doctor", targetRoot, "--json"], targetRoot)
      const doctorResult = jsonResult(doctor.stdout)
      const doctorAllowed = new Set(["VERIFIED_IN_SCOPE", "PROJECT_CURRENT", "PROJECT_NOT_INSTALLED", "PROJECT_MIGRATION_REQUIRED"])
      if ((doctor.exit_code === 2) || !doctorAllowed.has(doctorResult.classification)) {
        return { classification: doctorResult.classification || "RED_BLOCK_PREFLIGHT", operation: "PREFLIGHT" }
      }

      const verified = await runCli(manifest.cli_path, ["verify", targetRoot, "--json"], targetRoot)
      if (verified.exit_code === 0) {
        await logEvent(client, "OCAE_HANDOFF_VERIFY_COMPLETED", manifest, { intent, result: "PASS" })
        return { classification: "VERIFIED_IN_SCOPE", operation: "VERIFY" }
      }

      const existing = existsSync(path.join(targetRoot, ".opencode", "ecosystem-installation.json"))
      const operation = existing ? "UPDATE_EXISTING" : "INSTALL_NEW"
      await logEvent(client, "OCAE_HANDOFF_INSTALL_STARTED", manifest, { intent, operation })
      const applied = await runCli(manifest.cli_path, [existing ? "update" : "install", targetRoot, "--json"], targetRoot)
      const appliedResult = jsonResult(applied.stdout)
      if (applied.exit_code !== 0) return { classification: appliedResult.classification || "RED_BLOCK_INSTALL", operation }

      const finalVerify = await runCli(manifest.cli_path, ["verify", targetRoot, "--json"], targetRoot)
      const finalResult = jsonResult(finalVerify.stdout)
      if (finalVerify.exit_code !== 0) return { classification: finalResult.classification || "RED_BLOCK_VERIFY", operation }
      await logEvent(client, "OCAE_HANDOFF_INSTALL_COMPLETED", manifest, { intent, operation })
      await logEvent(client, "OCAE_HANDOFF_VERIFY_COMPLETED", manifest, { intent, result: "PASS" })
      return { classification: "VERIFIED_IN_SCOPE", operation }
    })()
    inFlight.set(key, work)
    const result = await work
    replaceWithTrustedContext(output, result.classification === "VERIFIED_IN_SCOPE"
      ? trustedResult(targetRoot, intent, result)
      : trustedBlock(result.classification, intent))
    if (result.classification === "VERIFIED_IN_SCOPE") {
      await logEvent(client, "OCAE_HANDOFF_COMPLETED", manifest, { intent, result: result.classification })
    } else {
      await logEvent(client, "OCAE_HANDOFF_BLOCKED", manifest, { intent, result: result.classification })
    }
    return
  } catch (error) {
    const reason = error instanceof Error ? error.message : "RED_BLOCK_HANDOFF_FAILURE"
    if (manifest) await logEvent(client, "OCAE_HANDOFF_BLOCKED", manifest, { intent, result: reason })
    replaceWithTrustedContext(output, trustedBlock(reason, intent))
  } finally {
    const key = `${input.sessionID}:${input.messageID || "unknown"}`
    inFlight.delete(key)
  }
}

const OcaeOpenCodeHandoff = async ({ client, directory, worktree }) => ({
  "chat.message": async (input, output) => {
    const text = textParts(output)
    const intent = intentFor(text)
    if (intent === "NEEDS_REVIEW_UNRELATED_INPUT") return handleTaskBootstrap({ client, directory, worktree, input, output })
    return handleHandoff({ client, directory, worktree, input, output })
  },
})

OcaeOpenCodeHandoff.compareVersions = compareVersions
OcaeOpenCodeHandoff.inspectProjectMetadata = inspectProjectMetadata
OcaeOpenCodeHandoff.reconcileProject = reconcileProject

export default OcaeOpenCodeHandoff
