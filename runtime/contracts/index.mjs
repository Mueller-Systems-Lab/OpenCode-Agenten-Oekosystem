// SPDX-License-Identifier: MIT
/**
 * Runtime contract layer index.
 *
 * All versioned runtime pipeline contracts are exported here with their
 * canonical contract IDs. run_id is owned by the task contract and only
 * passed through by every other contract.
 */
export { CONTRACT_ID as TASK_CONTRACT, create as createTask, validate as validateTask, DEFAULT_MAX_ATTEMPTS } from './task.mjs'
export { CONTRACT_ID as BASELINE_CONTRACT, create as createBaseline, validate as validateBaseline, CAPABILITY_STATUSES } from './baseline.mjs'
export { CONTRACT_ID as RESEARCH_CONTRACT, create as createResearch, validate as validateResearch, RESEARCH_FOCUSES } from './research.mjs'
export { CONTRACT_ID as PLAN_CONTRACT, create as createPlan, validate as validatePlan } from './plan.mjs'
export {
  BUILD_INPUT_CONTRACT_ID, BUILD_RESULT_CONTRACT_ID,
  createBuildInput, validateBuildInput,
  createBuildResult, validateBuildResult,
} from './build.mjs'
export { CONTRACT_ID as VERIFICATION_CONTRACT, create as createVerification, validate as validateVerification } from './verification.mjs'
export { CONTRACT_ID as REVIEW_CONTRACT, create as createReview, validate as validateReview, REVIEW_TYPES, SEVERITIES } from './review.mjs'
export { CONTRACT_ID as DECISION_CONTRACT, create as createDecision, validate as validateDecision, TERMINAL_STATES, NEXT_PATHS, nextPathFor } from './decision.mjs'
export { CONTRACT_ID as RUN_EVENT_CONTRACT, create as createRunEventContract, validate as validateRunEventContract, RUN_PHASES } from './run-event.mjs'

export const CONTRACT_IDS = Object.freeze({
  task: 'ecosystem.task.v1',
  baseline: 'ecosystem.baseline.v1',
  research: 'ecosystem.research.v1',
  plan: 'ecosystem.plan.v1',
  build_input: 'ecosystem.build-input.v1',
  build_result: 'ecosystem.build-result.v1',
  verification: 'ecosystem.verification.v1',
  review: 'ecosystem.review.v1',
  decision: 'ecosystem.decision.v1',
  run_event: 'ecosystem.run-event.v1',
})

import { validate as validateTask } from './task.mjs'
import { validate as validateBaseline } from './baseline.mjs'
import { validate as validateResearch } from './research.mjs'
import { validate as validatePlan } from './plan.mjs'
import { validateBuildInput, validateBuildResult } from './build.mjs'
import { validate as validateVerification } from './verification.mjs'
import { validate as validateReview } from './review.mjs'
import { validate as validateDecision } from './decision.mjs'
import { validate as validateRunEvent } from './run-event.mjs'

const VALIDATORS = Object.freeze({
  'ecosystem.task.v1': validateTask,
  'ecosystem.baseline.v1': validateBaseline,
  'ecosystem.research.v1': validateResearch,
  'ecosystem.plan.v1': validatePlan,
  'ecosystem.build-input.v1': validateBuildInput,
  'ecosystem.build-result.v1': validateBuildResult,
  'ecosystem.verification.v1': validateVerification,
  'ecosystem.review.v1': validateReview,
  'ecosystem.decision.v1': validateDecision,
  'ecosystem.run-event.v1': validateRunEvent,
})

export function validateContract({ contract, value }) {
  const validator = VALIDATORS[contract]
  if (!validator) return { ok: false, issues: [`unknown contract: ${contract}`] }
  const result = validator(value)
  if (result.ok && value?.contract !== contract) return { ok: false, issues: [`contract must be ${contract}`] }
  return result
}
