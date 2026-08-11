import path from "node:path"
import { fileURLToPath } from "node:url"
import { executeResumableRun } from "./run-state.mjs"
import { loadAgentCapabilityProfile } from "../../scripts/lib/mcp-preflight.mjs"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export async function startAgent({ agentId, manifestPath = path.join(repositoryRoot, "ecosystem.manifest.json"), ...options } = {}) {
  if (!agentId) return { classification: "RED_BLOCK", code: "FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT", reasons: ["agentId is required"] }
  let profile
  try { profile = await loadAgentCapabilityProfile(manifestPath, agentId) } catch (error) {
    return { classification: "RED_BLOCK", code: "FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT", reasons: [error.message] }
  }
  return executeResumableRun({ ...options, profile })
}
