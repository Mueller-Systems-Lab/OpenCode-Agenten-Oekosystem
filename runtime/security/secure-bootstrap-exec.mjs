import crypto from "node:crypto"
import fs from "node:fs/promises"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"

import { classifySecretPath } from "./secret-path-policy.mjs"
import { buildActionSandboxArgs } from "./secure-bootstrap-sandbox.mjs"
import { gateToolResult } from "./tool-result-egress-gate.mjs"

const BWRAP = "bwrap"
const MANAGED_PREFIXES = [
  ".agent-governance",
  ".opencode/ecosystem-installation.json",
  ".opencode/backups",
]
const MANAGED_EXACT_PATHS = new Set([".opencode"])

function normalizeRelative(relativePath) {
  return relativePath.split(path.sep).join("/")
}

async function walkTarget(targetRoot, relative = "") {
  const absolute = path.join(targetRoot, relative)
  const entries = await fs.readdir(absolute, { withFileTypes: true })
  const records = []
  for (const entry of entries) {
    const relativePath = normalizeRelative(path.join(relative, entry.name))
    const absolutePath = path.join(targetRoot, relativePath)
    const stat = await fs.lstat(absolutePath)
    records.push({ relativePath, absolutePath, stat, entry })
    if (entry.isDirectory() && !entry.isSymbolicLink() && relativePath !== ".git") {
      records.push(...await walkTarget(targetRoot, relativePath))
    }
  }
  return records
}

export async function discoverSandboxMasks(targetRoot) {
  const records = await walkTarget(targetRoot)
  const secretInodes = new Set()
  const masks = new Set([".git"])
  for (const record of records) {
    const policy = classifySecretPath(record.relativePath)
    if (policy.decision === "ABSOLUTE_DENY") {
      masks.add(record.relativePath)
      if (record.stat.isFile()) secretInodes.add(`${record.stat.dev}:${record.stat.ino}`)
    }
  }
  for (const record of records) {
    if (record.stat.isFile() && secretInodes.has(`${record.stat.dev}:${record.stat.ino}`)) {
      masks.add(record.relativePath)
    }
  }
  return [...masks].filter((relativePath) => records.some((record) => record.relativePath === relativePath))
}

async function prepareSandboxState() {
  const sandboxState = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-bootstrap-sandbox-"))
  const deniedFile = path.join(sandboxState, "denied-file")
  const deniedDir = path.join(sandboxState, "denied-dir")
  await fs.writeFile(deniedFile, "")
  await fs.mkdir(deniedDir)
  await fs.chmod(deniedFile, 0o000)
  await fs.chmod(deniedDir, 0o000)
  return sandboxState
}

function runBwrap(args, { timeout = 120_000 } = {}) {
  return spawnSync(BWRAP, args, {
    encoding: "utf8",
    env: {},
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  })
}

export function secureSandboxUnavailable(result) {
  return result.error?.code === "ENOENT" ||
    ((result.status ?? 1) !== 0 && !(result.stdout || "").trim())
}

function redactPaths(value, roots) {
  if (typeof value === "string") {
    let output = value
    for (const [root, replacement] of roots) output = output.split(root).join(replacement)
    return output
  }
  if (Array.isArray(value)) return value.map((item) => redactPaths(item, roots))
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactPaths(item, roots)]))
  }
  return value
}

async function snapshotTargetMetadata(targetRoot) {
  const records = await walkTarget(targetRoot)
  return new Map(records.map(({ relativePath, stat, entry }) => [
    relativePath,
    `${entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : "f"}:${stat.size}:${stat.mtimeNs ?? BigInt(Math.trunc(stat.mtimeMs * 1e6))}:${stat.ino}`,
  ]))
}

function changedPaths(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((relativePath) => before.get(relativePath) !== after.get(relativePath))
    .sort()
}

function inManagedScope(relativePath) {
  return MANAGED_EXACT_PATHS.has(relativePath) ||
    MANAGED_PREFIXES.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`))
}

function actionCommand({ action, sourceCommit, backupPath }) {
  const node = "/runtime/node"
  if (action === "verify") {
    return [
      node,
      "/source/bootstrap/verify.mjs",
      "--target", "/target",
      "--source", "/source",
      "--source-commit", sourceCommit,
      "--json",
    ]
  }
  const args = [node, "/source/scripts/install-governance.mjs", "--target", "/target"]
  if (["apply", "second_apply"].includes(action)) args.push("--apply")
  if (action === "rollback") args.push("--rollback", backupPath)
  args.push("--json")
  return args
}

export async function executeSecureBootstrapAction({
  action,
  sourceRoot,
  targetRoot,
  sourceCommit,
  backupPath,
  knownSecrets = [],
}) {
  const sandboxState = await prepareSandboxState()
  try {
    const masks = await discoverSandboxMasks(targetRoot)
    const before = await snapshotTargetMetadata(targetRoot)
    const writable = ["apply", "second_apply", "rollback"].includes(action)
    const sandboxBackupPath = backupPath
      ? backupPath.replace(targetRoot, "/target")
      : null
    const args = buildActionSandboxArgs({
      sourceRoot,
      targetRoot,
      sandboxState,
      maskedRelativePaths: masks,
      writable,
      command: actionCommand({ action, sourceCommit, backupPath: sandboxBackupPath }),
      environment: {
        OCAE_BOOTSTRAP_SOURCE_COMMIT: sourceCommit,
      },
    })
    const processResult = runBwrap(args)
    const sanitizedStdout = redactPaths(processResult.stdout || "", [
      [targetRoot, "<TARGET>"],
      [sourceRoot, "<SOURCE>"],
      [sandboxState, "<STATE>"],
    ])
    const sanitizedStderr = redactPaths(processResult.stderr || "", [
      [targetRoot, "<TARGET>"],
      [sourceRoot, "<SOURCE>"],
      [sandboxState, "<STATE>"],
    ])
    const stdoutGate = gateToolResult({ value: sanitizedStdout, channel: "stdout", knownSecrets })
    const stderrGate = gateToolResult({ value: sanitizedStderr, channel: "stderr", knownSecrets })
    if (stdoutGate.status !== "VERIFIED_IN_SCOPE" || stderrGate.status !== "VERIFIED_IN_SCOPE") {
      return {
        status: "RED_BLOCK_SECRET_EGRESS",
        content_returned: false,
        bytes_returned: 0,
        changed_files: [],
      }
    }
    if (secureSandboxUnavailable(processResult)) {
      return { status: "TOOL_GAP_SECURE_SANDBOX", changed_files: [] }
    }
    let parsed
    try {
      parsed = JSON.parse(sanitizedStdout.trim())
    } catch {
      return {
        status: "RED_BLOCK_BOOTSTRAP_RESULT_INVALID",
        exit_code: processResult.status ?? 1,
        changed_files: [],
        diagnostic: sanitizedStderr.trim().slice(0, 1024) || "non-JSON bootstrap result",
      }
    }
    const after = await snapshotTargetMetadata(targetRoot)
    const changed = changedPaths(before, after)
    const outOfScope = changed.filter((relativePath) => !inManagedScope(relativePath))
    if (outOfScope.length > 0) {
      return {
        status: "RED_BLOCK_OUT_OF_SCOPE_WRITE",
        changed_files: changed,
        out_of_scope_files: outOfScope,
        exit_code: processResult.status ?? 1,
      }
    }
    const result = redactPaths({
      ...parsed,
      status: parsed.classification,
      changed_files: changed,
      out_of_scope_files: [],
      exit_code: processResult.status ?? parsed.exit_code ?? 1,
      sandbox: {
        source_clone: "READ_ONLY",
        target_scope: writable ? "SCOPED_WRITE" : "READ_ONLY",
        target_git: "HIDDEN",
        secret_masks: masks.length,
        network: "NONE",
        environment: "CLEARED",
        host_home: "HIDDEN",
      },
    }, [
      [targetRoot, "<TARGET>"],
      [sourceRoot, "<SOURCE>"],
      [sandboxState, "<STATE>"],
    ])
    const finalGate = gateToolResult({ value: result, channel: action === "verify" ? "verifier" : "installer", knownSecrets })
    return finalGate.status === "VERIFIED_IN_SCOPE" ? finalGate.value : finalGate
  } finally {
    await fs.chmod(path.join(sandboxState, "denied-file"), 0o600).catch(() => {})
    await fs.chmod(path.join(sandboxState, "denied-dir"), 0o700).catch(() => {})
    await fs.rm(sandboxState, { recursive: true, force: true })
  }
}

export async function runActionSandboxProbe({ sourceRoot, targetRoot, knownSecrets = [] }) {
  const sandboxState = await prepareSandboxState()
  try {
    const masks = await discoverSandboxMasks(targetRoot)
    const probe = `
      const fs = require("node:fs");
      const candidates = ["/target/.env", "/target/.env.local", "/target/secret-link", "/target/nested-secret-link", "/target/.env.sample", "/target/.git/config"];
      const attempts = candidates.map((candidate) => {
        try {
          const value = fs.readFileSync(candidate);
          return { candidate: candidate.replace("/target/", ""), opened: true, bytes: value.length };
        } catch {
          return { candidate: candidate.replace("/target/", ""), opened: false, bytes: 0 };
        }
      });
      process.stdout.write(JSON.stringify({
        attempts,
        inherited_sensitive_env: Object.keys(process.env).some((key) => /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)),
        unexpected_home_entries: fs.readdirSync("/home"),
      }));
    `
    const args = buildActionSandboxArgs({
      sourceRoot,
      targetRoot,
      sandboxState,
      maskedRelativePaths: masks,
      writable: false,
      command: ["/runtime/node", "-e", probe],
    })
    const processResult = runBwrap(args)
    if (secureSandboxUnavailable(processResult)) return { status: "TOOL_GAP_SECURE_SANDBOX" }
    let parsed
    try {
      parsed = JSON.parse(processResult.stdout)
    } catch {
      return {
        status: "RED_BLOCK_SECRET_SANDBOX_BYPASS",
        exit_code: processResult.status ?? 1,
        diagnostic_hash: crypto.createHash("sha256").update(processResult.stderr || "").digest("hex"),
      }
    }
    const gated = gateToolResult({ value: parsed, channel: "test", knownSecrets })
    const allowed = parsed.attempts.filter((attempt) => attempt.opened)
    const bytes = parsed.attempts.reduce((sum, attempt) => sum + attempt.bytes, 0)
    const safe = gated.status === "VERIFIED_IN_SCOPE" &&
      allowed.length === 0 &&
      bytes === 0 &&
      parsed.inherited_sensitive_env === false &&
      parsed.unexpected_home_entries.length === 0
    return {
      status: safe ? "VERIFIED_IN_SCOPE" : "RED_BLOCK_SECRET_SANDBOX_BYPASS",
      secret_open_allowed_count: allowed.length,
      secret_bytes_returned: safe ? 0 : bytes,
      secret_content_disclosure_count: gated.status === "VERIFIED_IN_SCOPE" ? 0 : 1,
      attempts: parsed.attempts,
      inherited_sensitive_env: parsed.inherited_sensitive_env,
      host_home_visible: parsed.unexpected_home_entries.length > 0,
    }
  } finally {
    await fs.chmod(path.join(sandboxState, "denied-file"), 0o600).catch(() => {})
    await fs.chmod(path.join(sandboxState, "denied-dir"), 0o700).catch(() => {})
    await fs.rm(sandboxState, { recursive: true, force: true })
  }
}

export async function runModelSandboxProbe() {
  const state = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-model-sandbox-probe-"))
  try {
    const probe = `
      const fs = require("node:fs");
      process.stdout.write(JSON.stringify({
        target_visible: fs.existsSync("/target"),
        unexpected_home_entries: fs.readdirSync("/home"),
        sandbox_credentials_visible: fs.existsSync("/sandbox-home/.ssh") || fs.existsSync("/sandbox-home/.config/opencode/auth.json"),
      }));
    `
    const args = [
      "--die-with-parent",
      "--new-session",
      "--unshare-user",
      "--unshare-pid",
      "--unshare-ipc",
      "--unshare-uts",
      "--unshare-cgroup-try",
      "--clearenv",
      "--cap-drop", "ALL",
      "--ro-bind", "/usr", "/usr",
      "--ro-bind", "/bin", "/bin",
      "--ro-bind", "/lib", "/lib",
      "--ro-bind", "/lib64", "/lib64",
      "--ro-bind", process.execPath, "/runtime/node",
      "--proc", "/proc",
      "--dev", "/dev",
      "--tmpfs", "/tmp",
      "--tmpfs", "/home",
      "--bind", state, "/work",
      "--chdir", "/work",
      "--",
      "/runtime/node", "-e", probe,
    ]
    const result = runBwrap(args)
    if (secureSandboxUnavailable(result)) return { status: "TOOL_GAP_SECURE_SANDBOX" }
    let parsed
    try {
      parsed = JSON.parse(result.stdout)
    } catch {
      return { status: "RED_BLOCK_SECRET_SANDBOX_BYPASS" }
    }
    const safe = !parsed.target_visible &&
      parsed.unexpected_home_entries.length === 0 &&
      !parsed.sandbox_credentials_visible
    return {
      status: safe ? "VERIFIED_IN_SCOPE" : "RED_BLOCK_SECRET_SANDBOX_BYPASS",
      target_visible: parsed.target_visible,
      host_home_visible: parsed.unexpected_home_entries.length > 0,
      host_credentials_visible: parsed.sandbox_credentials_visible,
    }
  } finally {
    await fs.rm(state, { recursive: true, force: true })
  }
}
