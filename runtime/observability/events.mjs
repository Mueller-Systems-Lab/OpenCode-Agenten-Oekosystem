import fs from "node:fs/promises"
import path from "node:path"

export const GOVERNANCE_EVENTS = Object.freeze([
  "agent.start", "agent.preflight.start", "agent.preflight.result", "agent.task.start",
  "agent.task.result", "agent.resume", "policy.allow", "policy.deny",
  // MCP worker-tool integration observability (additive — no contract bump)
  "mcp.preflight",
  "mcp.tool-call.start",
  "mcp.tool-call.result",
  "mcp.tool-call.failure",
  // Model routing observability (additive — no contract bump)
  "model.route.selected",
  "model.route.rejected",
  "model.escalation",
  "provider.fallback",
  "model.worker.start",
  "model.worker.result",
  "model.worker.failure",
  // Availability & cost governance observability (additive — no contract bump)
  "model.health.probe.start",
  "model.health.probe.result",
  "model.health.state.changed",
  "model.usage",
])

export function governanceAttributes(input = {}) {
  const allowed = [
    "project.id", "run.id", "task.id", "agent.role", "agent.execution.id",
    "run_card.sha256", "source.commit", "target.environment", "classification",
    "status", "code", "step", "tool", "reason", "mode",
    // MCP worker-tool integration attributes (additive)
    "server", "capability", "attempt", "duration.ms", "failure.class",
    "input.fingerprint", "output.fingerprint", "tool.call.id", "required",
    // model routing attributes (additive)
    "provider", "model", "routing.reason", "route.index", "from.provider", "from.model",
    "escalation.count", "fallback.count", "worker.attempt", "route.policy.revision",
    // availability & cost governance attributes (additive)
    "health.status", "usage.status", "usage.input.tokens", "usage.output.tokens",
    "cost.tier", "routing.budget.remaining",
  ]
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => allowed.includes(key) && value !== undefined && value !== null))
}

export function createGovernanceEvent({ name, trace_id = null, span_id = null, parent_span_id = null, attributes = {}, timestamp = new Date().toISOString() } = {}) {
  if (!GOVERNANCE_EVENTS.includes(name)) throw new Error(`Unknown governance event: ${name}`)
  return {
    timestamp,
    name,
    trace_id,
    span_id,
    parent_span_id,
    attributes: governanceAttributes(attributes),
  }
}

export async function appendGovernanceEvent(filePath, event) {
  const target = path.resolve(filePath)
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  await fs.appendFile(target, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 })
  return target
}

export async function recordGovernanceEvent(filePath, input) {
  const event = createGovernanceEvent(input)
  await appendGovernanceEvent(filePath, event)
  return event
}
