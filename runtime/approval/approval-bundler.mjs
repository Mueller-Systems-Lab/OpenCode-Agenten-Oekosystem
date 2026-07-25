// SPDX-License-Identifier: MIT

export function bundleApprovalRequests(requests = []) {
  const decisions = requests.map((request, index) => ({
    decision_id: request.decision_id || `decision-${index + 1}`,
    effect: request.effect,
    resource: request.resource,
    reason: request.reason,
    recommended: request.recommended !== false,
    impact: request.impact || { security: 'assess', data: 'assess', cost: 'none declared', downtime: 'unknown', reversibility: 'assess' },
  }))
  return Object.freeze({
    type: 'OWNER_DECISION_PACKET',
    goal: 'Authorize only the concrete effects listed below.',
    recommended_decision: 'APPROVE RECOMMENDED',
    decisions,
    allowed_effects: decisions.map((item) => item.effect),
    denied_effects: ['SECRET_ACCESS', 'APPROVAL_ENGINE_MUTATION', 'CAPABILITY_REGISTRY_MUTATION'],
    alternatives: requests.filter((request) => request.alternatives).flatMap((request) => request.alternatives),
    options: ['APPROVE RECOMMENDED', 'APPROVE ALTERNATIVE <ID>', 'REJECT'],
    metrics: { bundled_request_count: decisions.length, packet_count: decisions.length ? 1 : 0 },
  })
}
