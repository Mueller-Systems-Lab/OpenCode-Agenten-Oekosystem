// SPDX-License-Identifier: MIT
/**
 * Harness Apply Layer — deterministic, pure application of an effective
 * harness to worker input. No LLM, no randomness, no authority.
 *
 * - composeWorkerTaskText: renders the policy vocabulary honestly as text
 *   (section order, verbosity, compression hints, anchoring, planning).
 * - applyToolExposure: HIDE-ONLY tool shaping. FULL_TOOLSET exposes exactly
 *   the granted tools; TASK_MINIMAL_TOOLSET filters the grant to the policy's
 *   task-relevant tools. A result can NEVER contain a tool absent from
 *   grantedTools — a policy referencing an ungranted tool throws
 *   SECURITY_VIOLATION (fail closed, loud).
 * - harnessEvidenceFields: flat, secret-free evidence fields for run events.
 */

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function headerFor(title, { scaffolding_verbosity: verbosity, framing_style: framing, ordered_instructions: ordered }, index) {
  const numbered = ordered === true ? `${index}. ${title}` : title
  return verbosity === 'SHORT' || framing === 'CONCISE' ? `${numbered}:` : `## ${numbered}`
}

const PLANNING_DIRECTIVES = Object.freeze({
  COMPACT: 'Planning: keep the plan compact — one short line per step.',
  DETAILED: 'Planning: produce a detailed plan with concrete targets and acceptance criteria before building.',
  STEPWISE: 'Planning: proceed stepwise — complete and verify one step before starting the next.',
})

const ANCHORING_LINES = Object.freeze({
  STRICT: 'Final check: produce exactly the required output format as specified above — no extra text around it.',
  FINAL_ANSWER: 'End with the final artifact content only.',
})

/**
 * Deterministically compose the worker task text from the task and the
 * effective harness. Same inputs → byte-identical string. Pure function.
 */
export function composeWorkerTaskText({ taskText, effectiveHarness, toolContractFraming = 'BASELINE' }) {
  if (typeof taskText !== 'string' || !isPlainObject(effectiveHarness)) {
    throw new Error('CONTRACT_INVALID:compose-worker-task-text:expected { taskText: string, effectiveHarness: object }')
  }
  if (!['BASELINE', 'SHORT_EXPLICIT', 'EXAMPLE_ASSISTED'].includes(toolContractFraming)) {
    throw new Error(`CONTRACT_INVALID:compose-worker-task-text:unknown tool contract framing "${String(toolContractFraming)}"`)
  }
  const contextPolicy = isPlainObject(effectiveHarness.context_policy) ? effectiveHarness.context_policy : {}
  const toolPolicy = isPlainObject(effectiveHarness.tool_policy) ? effectiveHarness.tool_policy : {}
  const resultPolicy = isPlainObject(effectiveHarness.result_policy) ? effectiveHarness.result_policy : {}
  const planningPolicy = isPlainObject(effectiveHarness.planning_policy) ? effectiveHarness.planning_policy : {}
  const mitigations = Array.isArray(effectiveHarness.known_failure_mitigations) ? effectiveHarness.known_failure_mitigations : []

  const order = Array.isArray(contextPolicy.instruction_order) && contextPolicy.instruction_order.length > 0
    ? contextPolicy.instruction_order
    : ['task', 'constraints', 'output_format']

  const taskLines = [taskText]
  if (typeof contextPolicy.emphasis === 'string' && contextPolicy.emphasis) taskLines.push(`Emphasis: ${contextPolicy.emphasis}`)

  const constraintLines = []
  if (resultPolicy.truncation_hint === 'SUMMARIZE') constraintLines.push('Summarize verbose tool output instead of repeating it in full.')
  for (const mitigation of mitigations) {
    if (isPlainObject(mitigation) && typeof mitigation.failure_signature === 'string' && typeof mitigation.adjustment === 'string') {
      constraintLines.push(`Known failure ${mitigation.failure_signature}: ${mitigation.adjustment}`)
    }
  }

  const outputFormatLines = []
  if (resultPolicy.structured_output_anchoring === 'STRICT') outputFormatLines.push('Produce exactly the required output format — no extra text around it.')
  else outputFormatLines.push('Follow the output format specified by the task.')

  const actionBoundaryLines = []
  if (toolPolicy.action_boundaries === 'EXPLICIT') {
    actionBoundaryLines.push('Action boundary: use only tools explicitly required by the task; never invent file contents or tool results.')
    if (toolPolicy.explicit_tool_contracts === true) {
      actionBoundaryLines.push('Invoke each tool exactly as documented and verify its result before proceeding.')
    }
  }

  const stepsLines = ['Work stepwise: complete and verify one step before starting the next.']

  const sections = {
    task: taskLines,
    constraints: constraintLines,
    output_format: outputFormatLines,
    action_boundary: actionBoundaryLines,
    steps: stepsLines,
  }

  const blocks = []
  let position = 0
  for (const key of order) {
    const lines = sections[key]
    if (!lines || lines.length === 0) continue
    position += 1
    blocks.push([headerFor(sectionTitle(key), contextPolicy, position), ...lines].join('\n'))
  }

  const hints = Array.isArray(contextPolicy.compression_hints) ? contextPolicy.compression_hints.filter((hint) => typeof hint === 'string' && hint) : []
  if (hints.length > 0) {
    blocks.push(['Efficiency:', ...hints.map((hint) => `- ${hint}`)].join('\n'))
  }

  if (toolContractFraming !== 'BASELINE') {
    const contractLines = toolContractFraming === 'EXAMPLE_ASSISTED'
      ? [
          'Tool contract: read, write, and edit use filePath:string; grep uses pattern:string and path:string; glob uses pattern:string; list uses path:string.',
          'All paths are relative to the project root; use only the arguments required by the selected tool.',
          'Valid example: {"filePath":"data/input.txt"}.',
        ]
      : [
          'Tool contract: read, write, and edit use filePath:string; grep uses pattern:string and path:string; glob uses pattern:string; list uses path:string.',
          'All paths are relative to the project root and must be strings.',
        ]
    blocks.push(['Tool contract:', ...contractLines].join('\n'))
  }

  const planningGranularity = planningPolicy.emit_directive === false
    ? null
    : planningPolicy.granularity === 'STANDARD' && contextPolicy.framing_style === 'CONCISE'
    ? 'COMPACT'
    : planningPolicy.granularity
  const planningDirective = PLANNING_DIRECTIVES[planningGranularity]
  if (planningDirective) blocks.push(planningDirective)

  const anchoringLines = []
  if (resultPolicy.structured_output_anchoring === 'STRICT') anchoringLines.push(ANCHORING_LINES.STRICT)
  if (resultPolicy.final_answer_anchoring === true) anchoringLines.push(ANCHORING_LINES.FINAL_ANSWER)
  if (anchoringLines.length > 0) blocks.push(anchoringLines.join('\n'))

  return blocks.join('\n\n')
}

function sectionTitle(key) {
  if (key === 'task') return 'Task'
  if (key === 'constraints') return 'Constraints'
  if (key === 'output_format') return 'Output format'
  if (key === 'action_boundary') return 'Action boundary'
  if (key === 'steps') return 'Steps'
  return key
}

/**
 * HIDE-ONLY tool exposure. Never adds a tool: every returned tool is a member
 * of grantedTools. A TASK_MINIMAL_TOOLSET policy naming a tool that is NOT in
 * the granted set throws SECURITY_VIOLATION (a profile may never widen the
 * grant — MODEL_PROFILE_CANNOT_ESCALATE_SCOPE).
 */
export function applyToolExposure({ grantedTools = [], toolPolicy } = {}) {
  if (!Array.isArray(grantedTools) || grantedTools.some((tool) => typeof tool !== 'string')) {
    throw new Error('CONTRACT_INVALID:apply-tool-exposure:grantedTools must be an array of strings')
  }
  if (!isPlainObject(toolPolicy)) {
    throw new Error('CONTRACT_INVALID:apply-tool-exposure:toolPolicy must be an object')
  }
  const exposure = toolPolicy.tool_exposure || 'FULL_TOOLSET'
  if (exposure === 'FULL_TOOLSET') {
    return { exposed_tools: [...grantedTools], hidden_tools: [] }
  }
  if (exposure === 'TASK_MINIMAL_TOOLSET') {
    const relevant = toolPolicy.task_relevant_tools
    if (!Array.isArray(relevant) || relevant.some((tool) => typeof tool !== 'string' || !tool)) {
      throw new Error('CONTRACT_INVALID:apply-tool-exposure:TASK_MINIMAL_TOOLSET requires task_relevant_tools (array of strings)')
    }
    // Fail closed: the policy may only ever reference tools the runtime
    // granted. Naming an ungranted tool is a grant-escalation attempt.
    for (const tool of relevant) {
      if (!grantedTools.includes(tool)) {
        throw new Error(`SECURITY_VIOLATION:tool-exposure:policy names ungranted tool "${tool}"`)
      }
    }
    const relevantSet = new Set(relevant)
    const exposed = grantedTools.filter((tool) => relevantSet.has(tool))
    const hidden = grantedTools.filter((tool) => !relevantSet.has(tool))
    return { exposed_tools: exposed, hidden_tools: hidden }
  }
  throw new Error(`CONTRACT_INVALID:apply-tool-exposure:unknown tool_exposure "${String(exposure)}"`)
}

/**
 * Flat evidence fields (§28) for run events — no secrets, no prompt text.
 */
export function harnessEvidenceFields(resolution) {
  if (!isPlainObject(resolution) || typeof resolution.profile_id !== 'string' || typeof resolution.fingerprint !== 'string') {
    throw new Error('CONTRACT_INVALID:harness-evidence-fields:expected a harness resolution object')
  }
  return {
    model_profile: resolution.profile_id,
    profile_version: resolution.profile_version,
    task_role: resolution.task_role,
    effective_harness_fingerprint: resolution.fingerprint,
    harness_resolution: resolution.resolution,
  }
}
