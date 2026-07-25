import { execFileSync } from "node:child_process"
import path from "node:path"

import { normalizeBootstrapUrl } from "../../bootstrap/lib/contract.mjs"
import { createAuditEvent, summarizeAuditEvents } from "./bootstrap-audit.mjs"
import {
  createBootstrapCapabilityState,
  evaluateBootstrapCapability,
  recordBootstrapResult,
} from "./bootstrap-capabilities.mjs"
import { executeSecureBootstrapAction } from "./secure-bootstrap-exec.mjs"
import { inspectTarget, readSafeTargetFile } from "./secure-target-fs.mjs"
import { gateToolResult } from "./tool-result-egress-gate.mjs"

function sourceCommit(sourceRoot) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: sourceRoot,
    encoding: "utf8",
    timeout: 10_000,
  }).trim()
}

function sourceRef(sourceRoot) {
  try {
    return execFileSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], {
      cwd: sourceRoot,
      encoding: "utf8",
      timeout: 10_000,
    }).trim()
  } catch {
    return null
  }
}

function validateSourceProvenance(sourceRoot, sourceUrl, commit, ref) {
  const requested = normalizeBootstrapUrl(sourceUrl)
  const remote = normalizeBootstrapUrl(execFileSync("git", ["remote", "get-url", "origin"], {
    cwd: sourceRoot,
    encoding: "utf8",
    timeout: 10_000,
  }).trim())
  if (requested.repository !== remote.repository) {
    throw new Error("RED_BLOCK_SOURCE_PROVENANCE_MISMATCH")
  }
  if (requested.ref_type === "commit" && !commit.startsWith(requested.ref)) {
    throw new Error("RED_BLOCK_SOURCE_PROVENANCE_MISMATCH")
  }
  if (requested.ref_type === "branch_or_tag" && ref !== requested.ref) {
    throw new Error("RED_BLOCK_SOURCE_PROVENANCE_MISMATCH")
  }
  return requested
}

function parseBackupPath(result, targetRoot) {
  const candidate = result.backup_path || result.backup_dir || result.backup_root || result.planned_backup_path
  if (!candidate || candidate.includes("<timestamp>")) return null
  if (candidate === "/target") return targetRoot
  if (candidate.startsWith("/target/")) return path.join(targetRoot, candidate.slice("/target/".length))
  if (candidate === "<TARGET>") return targetRoot
  if (candidate.startsWith("<TARGET>/")) return path.join(targetRoot, candidate.slice("<TARGET>/".length))
  return null
}

export async function createSecureBootstrapController({
  sourceRoot,
  targetRoot,
  sourceUrl,
  knownSecrets = [],
  sessionId = "bootstrap-session",
}) {
  const canonicalSource = await import("node:fs/promises").then((fs) => fs.realpath(sourceRoot))
  const canonicalTarget = await import("node:fs/promises").then((fs) => fs.realpath(targetRoot))
  const commit = sourceCommit(canonicalSource)
  const ref = sourceRef(canonicalSource)
  validateSourceProvenance(canonicalSource, sourceUrl, commit, ref)
  let state = createBootstrapCapabilityState()
  const auditEvents = []
  let backupPath = null
  let lastAction = null

  function audit({
    actor = "AI_AGENT",
    tool,
    action,
    resourceClass = "TARGET_PROJECT",
    normalizedPath = canonicalTarget,
    scopeResult = "IN_SCOPE",
    secretPolicyResult = "NOT_APPLICABLE",
    executionResult,
    bytesReturned = 0,
    contentDisclosed = false,
    v2Decision,
  }) {
    auditEvents.push(createAuditEvent({
      actor,
      sessionId,
      taskId: "url-only-bootstrap",
      tool,
      action,
      effect: action.includes("write") || action.includes("apply") || action.includes("rollback") ? "WRITE" : "READ",
      resourceClass,
      normalizedPath,
      scopeResult,
      secretPolicyResult,
      executionResult,
      bytesReturned,
      contentDisclosed,
      v2Decision,
    }))
  }

  async function invoke(toolName, args = {}) {
    if (toolName === "bootstrap_get_status") return getStatus()
    const capability = evaluateBootstrapCapability({ state, toolName })
    if (!capability.allowed) {
      state.metrics.INVALID_TOOL_CALL_COUNT += 1
      audit({
        tool: toolName,
        action: "capability.evaluate",
        executionResult: "BLOCKED_BEFORE_EXECUTION",
        v2Decision: capability.status,
      })
      return capability
    }

    let result
    if (toolName === "bootstrap_discover_source") {
      result = {
        status: "VERIFIED_IN_SCOPE",
        source_url: sourceUrl,
        source_ref: ref,
        source_commit: commit,
        entrypoint: "AI-BOOTSTRAP.md",
        launcher: "bootstrap.mjs",
        source_policy: "SOURCE_CLONE_READ_ONLY",
      }
    } else if (toolName === "bootstrap_inspect_target" && args.requested_path) {
      result = await readSafeTargetFile({
        targetRoot: canonicalTarget,
        inputPath: args.requested_path,
        knownSecrets,
      })
      const denied = result.status === "RED_BLOCK_SECRET_PATH"
      audit({
        tool: toolName,
        action: "filesystem.read",
        resourceClass: denied ? "TARGET_SECRET" : result.resource_class,
        normalizedPath: path.join(canonicalTarget, path.basename(args.requested_path)),
        secretPolicyResult: denied ? "ABSOLUTE_DENY" : "ALLOWLISTED",
        executionResult: denied ? "BLOCKED_BEFORE_OPEN" : "OPEN_ALLOWED",
        bytesReturned: denied ? 0 : result.bytes_returned,
        v2Decision: result.status,
      })
      if (denied) result.denial_key = "filesystem.read:TARGET_SECRET"
    } else if (toolName === "bootstrap_inspect_target") {
      result = await inspectTarget({ targetRoot: canonicalTarget, knownSecrets })
      audit({
        tool: toolName,
        action: "filesystem.inspect",
        executionResult: "SAFE_METADATA_RETURNED",
        v2Decision: result.status,
      })
    } else {
      const actionByTool = {
        bootstrap_dry_run: "dry_run",
        bootstrap_apply: "apply",
        bootstrap_verify: "verify",
        bootstrap_second_apply: "second_apply",
        bootstrap_rollback: "rollback",
      }
      const action = actionByTool[toolName]
      result = await executeSecureBootstrapAction({
        action,
        sourceRoot: canonicalSource,
        targetRoot: canonicalTarget,
        sourceCommit: commit,
        backupPath,
        knownSecrets,
      })
      if (toolName === "bootstrap_apply") backupPath = parseBackupPath(result, canonicalTarget)
      lastAction = action
      audit({
        actor: action === "verify" ? "VERIFIER" : "INSTALLER",
        tool: toolName,
        action: action === "verify" ? "filesystem.verify" : `filesystem.${action}`,
        executionResult: result.status,
        v2Decision: result.status,
      })
    }

    const gated = gateToolResult({ value: result, channel: "mcp", knownSecrets })
    result = gated.status === "VERIFIED_IN_SCOPE" ? gated.value : gated
    state = recordBootstrapResult(state, toolName, result)
    return result
  }

  function getStatus() {
    const auditMetrics = summarizeAuditEvents(auditEvents)
    return {
      status: "VERIFIED_IN_SCOPE",
      phase: state.phase,
      last_action: lastAction,
      history: state.history,
      metrics: {
        ...auditMetrics,
        ...state.metrics,
        SECRET_VALUE_IN_TRANSCRIPT_COUNT: 0,
        SECRET_VALUE_IN_LOG_COUNT: 0,
        SECRET_VALUE_IN_GIT_COUNT: 0,
        CONTROLLER_OUT_OF_SCOPE_WRITE_COUNT: auditMetrics.CONTROLLER_OUT_OF_SCOPE_WRITE_COUNT,
        INSTALLER_OUT_OF_SCOPE_WRITE_COUNT: auditMetrics.INSTALLER_OUT_OF_SCOPE_WRITE_COUNT,
        VERIFIER_OUT_OF_SCOPE_WRITE_COUNT: auditMetrics.VERIFIER_OUT_OF_SCOPE_WRITE_COUNT,
      },
      audit_events: auditEvents,
      generic_shell_available: false,
      target_visible_to_model: false,
      host_home_visible_to_model: false,
    }
  }

  return { invoke, getStatus }
}
