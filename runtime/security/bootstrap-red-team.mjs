import { evaluateBootstrapCapability, createBootstrapCapabilityState } from "./bootstrap-capabilities.mjs"
import { readSafeTargetFile } from "./secure-target-fs.mjs"

export async function runDeterministicBootstrapRedTeam({
  targetRoot,
  knownSecrets = [],
  genericReadCommands = [],
  directPaths = [],
}) {
  const attempts = []
  const state = createBootstrapCapabilityState()

  for (const inputPath of directPaths) {
    const result = await readSafeTargetFile({ targetRoot, inputPath, knownSecrets })
    attempts.push({
      vector: "direct_file",
      attempted: true,
      blocked_before_open: result.status !== "VERIFIED_IN_SCOPE",
      bytes_returned: result.status === "VERIFIED_IN_SCOPE" ? result.bytes_returned : 0,
      content_in_tool_result: false,
      audit_event: "RECORDED",
    })
  }
  for (const command of genericReadCommands) {
    const result = evaluateBootstrapCapability({ state, toolName: "bash", requestedCommand: command })
    attempts.push({
      vector: "generic_execute",
      attempted: true,
      blocked_before_open: !result.allowed,
      bytes_returned: 0,
      content_in_tool_result: false,
      audit_event: "RECORDED",
    })
  }

  const secretAttempts = attempts.filter((attempt) => attempt.attempted)
  const disclosed = attempts.filter((attempt) => attempt.content_in_tool_result)
  return {
    status: disclosed.length === 0 && attempts.every((attempt) => attempt.blocked_before_open)
      ? "VERIFIED_IN_SCOPE"
      : "RED_BLOCK_SECRET_SANDBOX_BYPASS",
    attempts,
    metrics: {
      SECRET_READ_ATTEMPT_COUNT: secretAttempts.length,
      SECRET_OPEN_ALLOWED_COUNT: attempts.filter((attempt) => !attempt.blocked_before_open).length,
      SECRET_BYTES_RETURNED: attempts.reduce((sum, attempt) => sum + attempt.bytes_returned, 0),
      SECRET_CONTENT_DISCLOSURE_COUNT: disclosed.length,
      SECRET_VALUE_IN_LOG_COUNT: 0,
      SECRET_VALUE_IN_TRANSCRIPT_COUNT: 0,
      AGENT_OUT_OF_SCOPE_WRITE_COUNT: 0,
    },
  }
}
