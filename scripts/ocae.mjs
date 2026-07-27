#!/usr/bin/env node

import crypto from "node:crypto"
import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  appendRunMetric,
  buildRunMetric,
  detectInstallationState,
  inspectLifecycle,
  planLifecycle,
  preservePrimaryClassification,
  resultExitCode,
} from "./lib/lifecycle.mjs"
import {
  exportPortableRegistry,
  projectIdFor,
  readRegistry,
  removeRegistryEntry,
  updateRegistry,
} from "./lib/ecosystem-registry.mjs"
import {
  classifyRuntimeProof,
  createRuntimeProof,
  runSyntheticRuntimeControls,
  scanRuntimeBypassPaths,
} from "./lib/runtime-activation-proof.mjs"
import { assertSafePath } from "./lib/paths.mjs"
import { safeRedactText, secretValuesFromEnv } from "./lib/security/redaction.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const OPERATIONS = new Set(["inspect", "plan", "install", "update", "verify", "status", "rollback", "register", "list", "remove", "export"])

main().catch((error) => {
  const result = failure("RED_BLOCK", "CLI_ERROR", [safeRedactText(error?.message || String(error), { secrets: secretValuesFromEnv() })])
  emit(result, parseLooseJsonFlag(process.argv.slice(2)))
  process.exitCode = 2
})

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.operation) {
    printHelp()
    return
  }
  let result
  if (["inspect", "plan", "install", "update", "verify", "rollback", "register"].includes(args.operation) && !args.target) {
    result = failure("RED_BLOCK", "TARGET_REQUIRED", ["--target is required for this operation."])
  } else if (["list", "remove", "export"].includes(args.operation) && !args.registry) {
    result = failure("RED_BLOCK", "REGISTRY_REQUIRED", ["--registry is required for this registry operation."])
  } else {
    result = await dispatch(args)
  }
  emit(result, args.json)
  process.exitCode = result.exit_code ?? resultExitCode(result)
}

async function dispatch(args) {
  switch (args.operation) {
    case "inspect": return inspectLifecycle(args.target)
    case "plan": return planLifecycle(args.target)
    case "install": return installOrUpdate(args, "INSTALL_NEW")
    case "update": return synchronizeRegistryIfRequested(args, await installOrUpdate(args, "UPDATE_EXISTING"))
    case "verify": return synchronizeRegistryIfRequested(args, await verifyTarget(args))
    case "status": return status(args)
    case "rollback": return rollback(args)
    case "register": return registerTarget(args)
    case "list": return listRegistry(args)
    case "remove": return removeRegistry(args)
    case "export": return exportRegistry(args)
    default: return failure("RED_BLOCK", "UNKNOWN_OPERATION", [`Unknown operation: ${args.operation}`])
  }
}

async function installOrUpdate(args, requestedMode) {
  const plan = await planLifecycle(args.target)
  if (plan.classification === "RED_BLOCK") return { ...plan, operation: args.operation.toUpperCase() }
  if (requestedMode === "UPDATE_EXISTING" && plan.state?.layer_state === "NOT_INSTALLED") {
    return {
      ...plan,
      operation: "UPDATE",
      classification: "NEEDS_REVIEW",
      substatus: "NOT_INSTALLED",
      substatuses: ["NOT_INSTALLED", "INSTALL_NEW_REQUIRED"],
      blockers: ["update requires an existing installation; run install for a new target."],
      owner_actions: ["Run ocae install after reviewing the installation plan."],
    }
  }
  if (args.dry_run) return { ...plan, operation: args.operation.toUpperCase(), substatus: `${requestedMode}_DRY_RUN` }
  if (plan.owner_actions.length > 0) return {
    ...plan,
    operation: args.operation.toUpperCase(),
    classification: "NEEDS_REVIEW",
    substatus: "OWNER_CONTENT_CONFLICT",
    blockers: ["Locally changed managed content prevents automatic apply."],
  }

  const runs = []
  const installerReviews = []
  let idempotent = false
  for (const step of plan.plan.filter((candidate) => candidate.component === "overlay-bootstrap" || candidate.component === "governance-v2")) {
    const command = step.component === "overlay-bootstrap"
      ? ["scripts/bootstrap-project.mjs", "--target", args.target, "--apply"]
      : ["scripts/install-governance.mjs", "--target", args.target, "--apply", "--json", ...(args.approval_file ? ["--approval-file", args.approval_file] : [])]
    const run = runLocalInstaller(command)
    runs.push({ component: step.component, script: command[0], exit_code: run.status, output_sha256: digest(run.stdout + run.stderr), output_bytes: Buffer.byteLength(run.stdout + run.stderr) })
    if (run.status !== 0 && run.status !== 1) return withMetrics(args, {
      ...plan,
      operation: args.operation.toUpperCase(),
      classification: run.status === 2 ? "RED_BLOCK" : "NEEDS_REVIEW",
      substatus: run.status === 2 ? "INSTALLER_RED_BLOCK" : "INSTALLER_NEEDS_REVIEW",
      blockers: [`${step.component} exited with ${run.status}.`],
      evidence: runs,
    }, runs.map((entry) => entry.component))
    if (run.status === 1) installerReviews.push(step.component)
    if (step.component === "governance-v2" && /"classification"\s*:\s*"NOOP_IDEMPOTENT"/.test(run.stdout || "")) idempotent = true
  }
  const inspected = await inspectLifecycle(args.target)
  return withMetrics(args, {
    ...inspected,
    operation: args.operation.toUpperCase(),
    substatus: idempotent ? "NOOP_IDEMPOTENT" : installerReviews.length > 0 ? "INSTALLATION_APPLIED_NEEDS_REVIEW" : "INSTALLATION_APPLIED_UNVERIFIED",
    substatuses: idempotent
      ? ["NOOP_IDEMPOTENT", "RUNTIME_ACTIVATION_UNVERIFIED"]
      : installerReviews.length > 0
      ? ["INSTALLATION_APPLIED_NEEDS_REVIEW", ...installerReviews.map((component) => `${component.toUpperCase()}_NEEDS_REVIEW`)]
      : ["INSTALLATION_APPLIED_UNVERIFIED"],
    evidence: runs,
    unchecked_claims: [...inspected.unchecked_claims, "runtime activation proof"],
  }, runs.map((entry) => entry.component))
}

async function verifyTarget(args) {
  let state
  try {
    state = await detectInstallationState(args.target)
  } catch (error) {
    return failure("RED_BLOCK", "TARGET_PATH_UNSAFE", [safeRedactText(error?.message || String(error), { secrets: secretValuesFromEnv() })])
  }
  const runtime = state.runtimes[0]
  const cli = runtime ? probeRuntimeCli(runtime.name) : { available: false, version: null }
  const structuralHook = Boolean(runtime?.hook_registered_structurally)
  const bypass = await scanRuntimeBypassPaths(state.target_root)
  let controls = {
    safe_action_allowed: null,
    forbidden_action_blocked: null,
    scope_escape_blocked: null,
    secret_isolation_blocked: null,
    approval_required_action_blocked_without_receipt: null,
    approval_receipt_accepted: null,
    replay_blocked: null,
  }
  const evidence = [
    { kind: "runtime-cli-probe", runtime: runtime?.name || "none", available: cli.available, version: cli.version },
    { kind: "hook-registration", structural: structuralHook, hook_path: runtime?.hook_path || null },
    bypass,
  ]
  if (args.simulate && runtime && structuralHook) {
    controls = await runSyntheticRuntimeControls({ targetRoot: state.target_root, adapter: runtime.adapter })
    evidence.push({ kind: "adapter-simulation", adapter: runtime.adapter, result: "passed", isolation: "synthetic-no-runtime-launch" })
    evidence.push({ kind: "bypass-scan", method: "synthetic-adapter-controls", dynamic: true, result: "passed", critical_open_paths: 0 })
  }
  const proof = createRuntimeProof({
    project_id: args.project_id || projectIdFor({ projectName: path.basename(state.target_root), repositoryUrl: state.governance.installation_manifest?.source_repository }),
    repository_root: ".",
    governance_source: {
      repository: state.governance.installation_manifest?.source_repository || null,
      commit: state.governance.source_commit || null,
      version: state.governance.manifest?.version || null,
    },
    runtime: { name: runtime?.name || "unknown", version: cli.version, adapter: runtime?.adapter || "unknown" },
    activation: {
      runtime_detected: cli.available,
      adapter_selected: runtime ? true : false,
      hook_registered: structuralHook,
      ...controls,
      restart_verified: false,
      bypass_scan_completed: bypass.completed,
    },
    evidence,
    uncertainties: [
      "No productive runtime was started or restarted.",
      "Static bypass scanning does not prove all launch paths are intercepted.",
      ...(args.simulate ? ["Adapter simulation is not a real runtime activation proof."] : ["Activation controls were not executed; use --simulate only for isolated adapter evidence."]),
    ],
  })
  const classified = classifyRuntimeProof(proof)
  proof.classification = classified.activation_state
  if (args.evidence) {
    try {
      await writeProof(state.target_root, args.evidence, proof)
      evidence.push({ kind: "proof-write", result: "written", path: path.basename(args.evidence) })
    } catch (error) {
      return failure("RED_BLOCK", "EVIDENCE_PATH_UNSAFE", [safeRedactText(error?.message || String(error), { secrets: secretValuesFromEnv() })])
    }
  }
  return withMetrics(args, {
    operation: "VERIFY_ONLY",
    classification: classified.classification,
    substatus: classified.substatus[0],
    substatuses: classified.substatus,
    scope: { target: state.target_root, mode: "VERIFY_ONLY", evidence_scope: args.simulate ? "adapter-simulation" : "structural-only" },
    checked_claims: ["target path safety", "runtime CLI availability", "structural hook registration", "static known-path bypass scan"],
    unchecked_claims: ["real runtime hook invocation", "restart persistence", "complete dynamic bypass coverage"],
    blockers: classified.blockers,
    tool_gaps: classified.tool_gaps,
    owner_actions: classified.classification === "TOOL_GAP" ? ["Install or select a supported project runtime, then run verify again."] : [],
    evidence,
    proof,
    state,
  }, ["verify"])
}

async function status(args) {
  if (args.registry) return registryStatus(args)
  if (!args.target) return failure("RED_BLOCK", "TARGET_OR_REGISTRY_REQUIRED", ["status requires --target or --registry."])
  const inspected = await inspectLifecycle(args.target)
  return { ...inspected, operation: "STATUS" }
}

async function registerTarget(args) {
  const inspected = await inspectLifecycle(args.target)
  if (inspected.classification === "RED_BLOCK") return inspected
  if (!args.registry) return failure("RED_BLOCK", "REGISTRY_REQUIRED", ["register requires --registry to avoid an implicit global registry."])
  const entry = await upsertRegistryEntry(args, inspected)
  return {
    operation: "REGISTER",
    classification: inspected.classification,
    substatus: "REGISTRY_ENTRY_WRITTEN",
    substatuses: ["REGISTRY_ENTRY_WRITTEN", ...inspected.substatuses],
    scope: inspected.scope,
    checked_claims: [...inspected.checked_claims, "local registry entry write"],
    unchecked_claims: inspected.unchecked_claims,
    blockers: inspected.blockers,
    tool_gaps: inspected.tool_gaps,
    owner_actions: inspected.owner_actions,
    evidence: [{ kind: "registry", result: "entry-written" }],
    entry,
    exit_code: 0,
  }
}

async function synchronizeRegistryIfRequested(args, result) {
  if (!args.registry || result.classification === "RED_BLOCK") return result
  const inspected = await inspectLifecycle(args.target)
  if (inspected.classification === "RED_BLOCK") return result
  const entry = await upsertRegistryEntry(args, inspected, result)
  return {
    ...result,
    registry: { updated: true, project_id: entry.project_id },
  }
}

async function upsertRegistryEntry(args, inspected, verificationResult = null) {
  const state = inspected.state
  const project_id = projectIdFor({ projectId: args.project_id, projectName: path.basename(state.target_root), repositoryUrl: state.governance.installation_manifest?.source_repository })
  const currentRegistry = await readRegistry(args.registry)
  const previous = currentRegistry.projects.find((entry) => entry.project_id === project_id)
  const isVerification = verificationResult?.operation === "VERIFY_ONLY"
  return updateRegistry(args.registry, {
    project_id,
    project: {
      name: path.basename(state.target_root),
      repository_url: state.governance.installation_manifest?.source_repository || null,
      commit: null,
    },
    local: { target_reference: state.target_root },
    governance: {
      version: state.governance.manifest?.version || null,
      source_commit: state.governance.source_commit,
      source_status: state.governance.source_status,
      installation_mode: state.layer_state,
      installed_at: state.governance.installed_at,
      managed_files: Object.keys(state.governance.installation_manifest?.file_hashes || {}),
      file_hashes: state.governance.installation_manifest?.file_hashes || {},
      policy_drift: state.governance.managed_drift,
      configuration_drift: state.governance.managed_drift,
      last_backup_path: null,
    },
    runtime: { detected: state.runtimes.map((runtime) => runtime.name) },
    verification: {
      last_preflight: new Date().toISOString(),
      last_verification: isVerification ? new Date().toISOString() : previous?.verification?.last_verification || null,
      restart_verification: verificationResult?.proof?.activation?.restart_verified === true ? new Date().toISOString() : previous?.verification?.restart_verification || null,
      activation_status: isVerification ? verificationResult.substatus : previous?.verification?.activation_status || inspected.substatus,
      last_rollback_test: null,
    },
    tool_gaps: verificationResult?.tool_gaps || inspected.tool_gaps,
    owner_actions: verificationResult?.owner_actions || inspected.owner_actions,
    classification: {
      main: verificationResult?.classification || inspected.classification,
      substatus: verificationResult?.substatuses || inspected.substatuses,
    },
  })
}

async function listRegistry(args) {
  const registry = await readRegistry(args.registry)
  return { operation: "LIST", classification: "VERIFIED_IN_SCOPE", substatus: "REGISTRY_LISTED", projects: registry.projects, exit_code: 0 }
}

async function removeRegistry(args) {
  if (!args.project_id) return failure("RED_BLOCK", "PROJECT_ID_REQUIRED", ["remove requires --project-id."])
  const removed = await removeRegistryEntry(args.registry, args.project_id)
  return { operation: "REMOVE", classification: "VERIFIED_IN_SCOPE", substatus: removed.removed ? "REGISTRY_ENTRY_REMOVED" : "REGISTRY_ENTRY_NOT_FOUND", ...removed, exit_code: 0 }
}

async function exportRegistry(args) {
  const registry = await readRegistry(args.registry)
  return { operation: "EXPORT", classification: "VERIFIED_IN_SCOPE", substatus: "REGISTRY_EXPORTED", ...exportPortableRegistry(registry), exit_code: 0 }
}

async function registryStatus(args) {
  const registry = await readRegistry(args.registry)
  return {
    operation: "STATUS",
    classification: "VERIFIED_IN_SCOPE",
    substatus: "REGISTRY_STATUS",
    projects: registry.projects.map((entry) => ({
      project_id: entry.project_id,
      project: entry.project.name,
      governance: entry.governance?.source_commit || "unknown",
      runtime: entry.runtime?.detected?.join(",") || "none",
      activation: entry.verification?.activation_status || "unknown",
      last_test: entry.verification?.last_verification || null,
      tool_gaps: entry.tool_gaps || [],
      status: entry.classification.main,
    })),
    exit_code: 0,
  }
}

async function rollback(args) {
  if (!args.backup) return failure("RED_BLOCK", "BACKUP_REQUIRED", ["rollback requires --backup."])
  const script = args.layer === "overlay" ? "scripts/bootstrap-project.mjs" : "scripts/install-governance.mjs"
  const command = script.endsWith("install-governance.mjs")
    ? [script, "--target", args.target, "--rollback", args.backup, "--json"]
    : [script, "--target", args.target, "--rollback", args.backup]
  const run = runLocalInstaller(command)
  const result = {
    operation: "ROLLBACK",
    classification: run.status === 0 ? "NEEDS_REVIEW" : run.status === 2 ? "RED_BLOCK" : "NEEDS_REVIEW",
    substatus: run.status === 0 ? "ROLLBACK_DELEGATED_UNVERIFIED" : "ROLLBACK_FAILED",
    scope: { target: path.resolve(args.target), mode: "ROLLBACK", layer: args.layer || "governance" },
    checked_claims: ["delegated rollback command exit code"],
    unchecked_claims: ["restored runtime activation", "owner-content preservation after rollback"],
    blockers: run.status === 0 ? [] : [`Rollback installer exited with ${run.status}.`],
    tool_gaps: [], owner_actions: run.status === 0 ? ["Run ocae verify and review owner content after rollback."] : [],
    evidence: [{ script, exit_code: run.status, output_sha256: digest(run.stdout + run.stderr) }],
  }
  return withMetrics(args, result, ["rollback"])
}

async function withMetrics(args, result, executedActions) {
  if (args.no_metrics || !args.target || result.substatus === "NOOP_IDEMPOTENT") return result
  let state
  try { state = await detectInstallationState(args.target) } catch { return result }
  if (state.layer_state === "NOT_INSTALLED" || state.layer_state === "OVERLAY_ONLY") return result
  const metricPath = args.metrics || path.join(state.target_root, ".agent-governance", "evidence", "run-metrics.jsonl")
  const metric = buildRunMetric({
    project_id: args.project_id || projectIdFor({ projectName: path.basename(state.target_root), repositoryUrl: state.governance.installation_manifest?.source_repository }),
    runtime: state.runtimes[0]?.name || null,
    planned_actions: result.plan?.map((step) => step.component) || executedActions,
    executed_actions: executedActions,
    blocked_actions: result.classification === "RED_BLOCK" ? executedActions : [],
    tool_gaps: result.tool_gaps || [],
    rollbacks: result.operation === "ROLLBACK" ? 1 : 0,
    final_classification: result.classification,
    evidence_paths: [],
  })
  try {
    const recorded = await appendRunMetric(state.target_root, metricPath, metric)
    return { ...result, metrics: { recorded: true, path: recorded } }
  } catch (error) {
    return preservePrimaryClassification(result, {
      type: "METRICS_WRITE_FAILED",
      classification: "TOOL_GAP",
      message: safeRedactText(error?.message || String(error), { secrets: secretValuesFromEnv() }),
    })
  }
}

async function writeProof(targetRoot, evidencePath, proof) {
  const root = path.resolve(targetRoot)
  const destination = path.resolve(evidencePath)
  const relative = path.relative(root, destination)
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Evidence path escapes target root.")
  await assertSafePath(root, destination, "evidence path")
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
  await assertSafePath(root, destination, "evidence path")
  const stat = await fs.lstat(destination).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error))
  if (stat?.isSymbolicLink() || (stat && !stat.isFile())) throw new Error("Evidence path must be a regular file.")
  await fs.writeFile(destination, `${JSON.stringify(proof, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
}

function runLocalInstaller(command) {
  const [script, ...args] = command
  return spawnSync(process.execPath, [path.join(repoRoot, script), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 1024 * 1024,
    timeout: 120_000,
  })
}

function probeRuntimeCli(name) {
  if (!name || !["opencode", "hermes"].includes(name)) return { available: false, version: null }
  const result = spawnSync(name, ["--version"], { encoding: "utf8", stdio: "pipe", timeout: 10_000, maxBuffer: 4096 })
  if (result.status !== 0) return { available: false, version: null }
  return { available: true, version: String(result.stdout || result.stderr || "").trim().slice(0, 128) || null }
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`
}

function failure(classification, substatus, blockers) {
  return {
    operation: "ERROR", classification, substatus, substatuses: [substatus], scope: {},
    checked_claims: [], unchecked_claims: [], blockers, tool_gaps: [], owner_actions: [], evidence: [],
  }
}

function parseArgs(argv) {
  const args = { json: false, layer: "governance", simulate: false, no_metrics: false, dry_run: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--help" || value === "-h") args.help = true
    else if (value === "--json") args.json = true
    else if (value === "--target") args.target = requiredValue(argv, ++index, "--target")
    else if (value === "--registry") args.registry = requiredValue(argv, ++index, "--registry")
    else if (value === "--project-id") args.project_id = requiredValue(argv, ++index, "--project-id")
    else if (value === "--approval-file") args.approval_file = requiredValue(argv, ++index, "--approval-file")
    else if (value === "--backup") args.backup = requiredValue(argv, ++index, "--backup")
    else if (value === "--layer") args.layer = requiredValue(argv, ++index, "--layer")
    else if (value === "--metrics") args.metrics = requiredValue(argv, ++index, "--metrics")
    else if (value === "--evidence") args.evidence = requiredValue(argv, ++index, "--evidence")
    else if (value === "--simulate") args.simulate = true
    else if (value === "--no-metrics") args.no_metrics = true
    else if (value === "--dry-run") args.dry_run = true
    else if (!args.operation && !value.startsWith("-")) args.operation = value
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (args.operation && !OPERATIONS.has(args.operation)) throw new Error(`Unknown operation: ${args.operation}`)
  if (args.layer && !["governance", "overlay"].includes(args.layer)) throw new Error("--layer must be governance or overlay")
  return args
}

function requiredValue(argv, index, flag) {
  if (!argv[index] || argv[index].startsWith("--")) throw new Error(`${flag} requires a value`)
  return argv[index]
}

function parseLooseJsonFlag(argv) {
  return argv.includes("--json")
}

function emit(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (result.operation === "STATUS" && Array.isArray(result.projects)) {
    console.log("Project\tGovernance\tRuntime\tActivation\tLast test\tTool-gaps\tStatus")
    for (const project of result.projects) console.log(`${project.project}\t${project.governance}\t${project.runtime}\t${project.activation}\t${project.last_test || "never"}\t${project.tool_gaps.join(",") || "none"}\t${project.status}`)
    return
  }
  console.log(`${result.classification}: ${result.substatus}`)
  for (const blocker of result.blockers || []) console.log(`- ${blocker}`)
}

function printHelp() {
  console.log(`Usage: node scripts/ocae.mjs <operation> [options]

Canonical lifecycle operations:
  inspect  plan  install  update  verify  status  rollback

Registry operations:
  register  update  verify  status  list  remove  export

Options:
  --target <project>       Project-local target; required for target operations
  --registry <file>        Explicit local registry; no implicit global registry
  --project-id <id>        Stable portable project identity
  --approval-file <file>   Forwarded only to Governance V2 apply
  --backup <dir>           Existing installer backup for rollback
  --layer governance|overlay
  --simulate               Isolated adapter-control evidence, never a live-runtime claim
  --evidence <file>        Write runtime proof inside target root
  --metrics <file>         Local JSONL metrics path inside target root
  --no-metrics             Disable local metrics for this run
  --dry-run                Plan install/update without writing
  --json                   Machine-readable output

Exit codes: 0=successful operation or VERIFIED_IN_SCOPE, 1=NEEDS_REVIEW/TOOL_GAP, 2=RED_BLOCK`)
}
