import { createCapabilityDenial } from "./bootstrap-denial.mjs"

export const BOOTSTRAP_TOOL_NAMES = Object.freeze([
  "bootstrap_discover_source",
  "bootstrap_inspect_target",
  "bootstrap_dry_run",
  "bootstrap_apply",
  "bootstrap_verify",
  "bootstrap_second_apply",
  "bootstrap_rollback",
  "bootstrap_get_status",
])

const NEXT_PHASE = {
  bootstrap_discover_source: "SOURCE_DISCOVERED",
  bootstrap_inspect_target: "TARGET_INSPECTED",
  bootstrap_dry_run: "DRY_RUN_COMPLETE",
  bootstrap_apply: "APPLY_COMPLETE",
  bootstrap_verify: "VERIFY_COMPLETE",
  bootstrap_second_apply: "SECOND_APPLY_COMPLETE",
  bootstrap_rollback: "ROLLBACK_COMPLETE",
}

const REQUIRED_PHASE = {
  bootstrap_discover_source: ["START"],
  bootstrap_inspect_target: ["SOURCE_DISCOVERED", "TARGET_INSPECTED", "DRY_RUN_COMPLETE", "APPLY_COMPLETE", "VERIFY_COMPLETE"],
  bootstrap_dry_run: ["TARGET_INSPECTED", "DRY_RUN_COMPLETE", "APPLY_COMPLETE", "VERIFY_COMPLETE"],
  bootstrap_apply: ["DRY_RUN_COMPLETE", "ROLLBACK_COMPLETE"],
  bootstrap_verify: ["APPLY_COMPLETE", "VERIFY_COMPLETE", "SECOND_APPLY_COMPLETE"],
  bootstrap_second_apply: ["VERIFY_COMPLETE"],
  bootstrap_rollback: ["SECOND_APPLY_COMPLETE"],
  bootstrap_get_status: ["*"],
}

export function buildBootstrapAgentPermissions() {
  return {
    "*": "deny",
    read: "deny",
    glob: "deny",
    grep: "deny",
    list: "deny",
    bash: "deny",
    edit: "deny",
    write: "deny",
    apply_patch: "deny",
    task: "deny",
    skill: "deny",
    lsp: "deny",
    webfetch: "deny",
    websearch: "deny",
    question: "deny",
    external_directory: "deny",
    todowrite: "deny",
    todoread: "deny",
    doom_loop: "deny",
    "bootstrap_*": "allow",
  }
}

export function createBootstrapCapabilityState() {
  return {
    phase: "START",
    history: [],
    denied_keys: [],
    recovery_pending: false,
    metrics: {
      REPEATED_DENIED_ACTION_COUNT: 0,
      INVALID_TOOL_CALL_COUNT: 0,
      RECOVERY_ACTION_COUNT: 0,
    },
  }
}

export function evaluateBootstrapCapability({ state, toolName }) {
  if (!BOOTSTRAP_TOOL_NAMES.includes(toolName)) {
    const shell = toolName === "bash" || toolName === "shell" || toolName === "exec"
    return {
      allowed: false,
      ...createCapabilityDenial({
        action: toolName,
        status: shell ? "RED_BLOCK_UNSAFE_GENERIC_SHELL" : "RED_BLOCK_CAPABILITY_DENIED",
      }),
    }
  }
  const phases = REQUIRED_PHASE[toolName]
  const allowed = phases.includes("*") || phases.includes(state.phase)
  if (!allowed) {
    return {
      allowed: false,
      ...createCapabilityDenial({ action: toolName, status: "RED_BLOCK_INVALID_BOOTSTRAP_SEQUENCE" }),
    }
  }
  return { allowed: true, status: "VERIFIED_IN_SCOPE", tool: toolName }
}

export function recordBootstrapResult(state, toolName, result) {
  const next = structuredClone(state)
  next.history.push({ tool: toolName, status: result.status })
  if (result.status === "RED_BLOCK_SECRET_PATH") {
    const key = result.denial_key || `${toolName}:TARGET_SECRET`
    if (next.denied_keys.includes(key)) next.metrics.REPEATED_DENIED_ACTION_COUNT += 1
    else next.denied_keys.push(key)
    next.recovery_pending = true
    return next
  }
  if (result.status === "VERIFIED_IN_SCOPE" || result.status === "NOOP_IDEMPOTENT") {
    if (
      next.recovery_pending &&
      ["bootstrap_inspect_target", "bootstrap_dry_run", "bootstrap_get_status"].includes(toolName)
    ) {
      next.metrics.RECOVERY_ACTION_COUNT += 1
      next.recovery_pending = false
    }
    if (NEXT_PHASE[toolName]) next.phase = NEXT_PHASE[toolName]
  }
  return next
}
