// SPDX-License-Identifier: MIT
/**
 * Scope Authority Invariant Check
 * 
 * ENFORCES: SCOPE_AUTHORITY = ISSUE | SPEC | AUTHORIZED_CONTROLLER_CONTEXT
 * PREVENTS: WORKER | BUILDER | TOOL | CAPABILITY_DISCOVERY from creating new requirements
 * 
 * This invariant ensures that scope authority comes only from legitimate sources:
 * - GitHub Issues (explicit user requirements)
 * - Specifications (formal acceptance criteria)
 * - Authorized Controller Context (deterministic runtime policy)
 * 
 * It prevents scope authority from:
 * - Workers (they implement, don't define scope)
 * - Builders (they compile, don't define scope)  
 * - Tools (they execute, don't define scope)
 * - Capability Discovery (availability ≠ requirement)
 */

import { 
  verifyCapabilityActivation,
  verifyViewportProfileAuthorization,
  guardAgainstScopeExpansion,
  getCapabilityScopeAuthorityState,
  CAPABILITY_REGISTRY,
  CAPABILITY_STATUS
} from '../gates/capability-scope-guard.mjs'

/**
 * Run all scope authority invariant checks
 * 
 * @param {Object} params - Check parameters
 * @param {Object} params.task_context - Task context with issue/spec info
 * @param {Object} params.proposed_scope - Scope proposed by worker/builder
 * @param {string} params.capability - Specific capability to check (optional)
 * @returns {Object} Invariant check results
 */
export async function checkScopeAuthorityInvariants({ task_context, proposed_scope, capability }) {
  const results = {
    timestamp: new Date().toISOString(),
    all_passed: true,
    invariants: {},
    violations: [],
    capability_state: getCapabilityScopeAuthorityState()
  }

  // INVARIANT 1: CAPABILITY_DOES_NOT_CREATE_REQUIREMENT
  results.invariants.CAPABILITY_DOES_NOT_CREATE_REQUIREMENT = 
    await checkCapabilityDoesNotCreateRequirement({ task_context, capability })
  
  if (!results.invariants.CAPABILITY_DOES_NOT_CREATE_REQUIREMENT.passed) {
    results.all_passed = false
    results.violations.push({
      invariant: 'CAPABILITY_DOES_NOT_CREATE_REQUIREMENT',
      ...results.invariants.CAPABILITY_DOES_NOT_CREATE_REQUIREMENT
    })
  }

  // INVARIANT 2: SCOPE_AUTHORITY_LEGITIMATE_SOURCE
  results.invariants.SCOPE_AUTHORITY_LEGITIMATE_SOURCE = 
    await checkScopeAuthorityLegitimateSource({ task_context })
  
  if (!results.invariants.SCOPE_AUTHORITY_LEGITIMATE_SOURCE.passed) {
    results.all_passed = false
    results.violations.push({
      invariant: 'SCOPE_AUTHORITY_LEGITIMATE_SOURCE',
      ...results.invariants.SCOPE_AUTHORITY_LEGITIMATE_SOURCE
    })
  }

  // INVARIANT 3: WORKER_CANNOT_EXPAND_SCOPE
  results.invariants.WORKER_CANNOT_EXPAND_SCOPE = 
    await checkWorkerCannotExpandScope({ proposed_scope, task_context })
  
  if (!results.invariants.WORKER_CANNOT_EXPAND_SCOPE.passed) {
    results.all_passed = false
    results.violations.push({
      invariant: 'WORKER_CANNOT_EXPAND_SCOPE',
      ...results.invariants.WORKER_CANNOT_EXPAND_SCOPE
    })
  }

  // INVARIANT 4: CORE_AND_CAPABILITY_STATUS_SEPARATED
  results.invariants.CORE_AND_CAPABILITY_STATUS_SEPARATED = 
    await checkCoreAndCapabilityStatusSeparated()
  
  if (!results.invariants.CORE_AND_CAPABILITY_STATUS_SEPARATED.passed) {
    results.all_passed = false
    results.violations.push({
      invariant: 'CORE_AND_CAPABILITY_STATUS_SEPARATED',
      ...results.invariants.CORE_AND_CAPABILITY_STATUS_SEPARATED
    })
  }

  // INVARIANT 5: OPTIONAL_CAPABILITY_CANNOT_PROMOTE_CORE
  results.invariants.OPTIONAL_CAPABILITY_CANNOT_PROMOTE_CORE = 
    await checkOptionalCapabilityCannotPromoteCore({ task_context })
  
  if (!results.invariants.OPTIONAL_CAPABILITY_CANNOT_PROMOTE_CORE.passed) {
    results.all_passed = false
    results.violations.push({
      invariant: 'OPTIONAL_CAPABILITY_CANNOT_PROMOTE_CORE',
      ...results.invariants.OPTIONAL_CAPABILITY_CANNOT_PROMOTE_CORE
    })
  }

  // INVARIANT 6: RESPONSIVE_CORE_NOT_IMPLICIT_DEFAULT
  results.invariants.RESPONSIVE_CORE_NOT_IMPLICIT_DEFAULT = 
    await checkResponsiveCoreNotImplicitDefault({ task_context, proposed_scope })
  
  if (!results.invariants.RESPONSIVE_CORE_NOT_IMPLICIT_DEFAULT.passed) {
    results.all_passed = false
    results.violations.push({
      invariant: 'RESPONSIVE_CORE_NOT_IMPLICIT_DEFAULT',
      ...results.invariants.RESPONSIVE_CORE_NOT_IMPLICIT_DEFAULT
    })
  }

  return results
}

/**
 * INVARIANT 1: CAPABILITY_DOES_NOT_CREATE_REQUIREMENT
 * 
 * Available capabilities should not automatically create new requirements.
 * Requirements come from issues, specs, or authorized controller context.
 */
async function checkCapabilityDoesNotCreateRequirement({ task_context, capability }) {
  const capabilitiesToCheck = capability ? [capability] : Object.keys(CAPABILITY_REGISTRY)
  const violations = []

  for (const cap of capabilitiesToCheck) {
    const authResult = verifyCapabilityActivation({
      capability: cap,
      task_context,
      activation_type: 'automatic'
    })

    const capDef = CAPABILITY_REGISTRY[cap]
    if (capDef?.status === CAPABILITY_STATUS.OPTIONAL_PROJECT_SCOPED) {
      if (authResult.authorized && !authResult.message.includes('explicit')) {
        violations.push({
          capability: cap,
          reason: 'OPTIONAL_CAPABILITY_ACTIVATED_WITHOUT_EXPLICIT_REQUIREMENT',
          message: `Optional capability "${cap}" was activated without explicit requirement`
        })
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    message: violations.length === 0 ? 
      'All capabilities properly require explicit activation' :
      `${violations.length} capabilities activated without explicit requirement`
  }
}

/**
 * INVARIANT 2: SCOPE_AUTHORITY_LEGITIMATE_SOURCE
 * 
 * Scope authority must come from legitimate sources only.
 */
async function checkScopeAuthorityLegitimateSource({ task_context }) {
  const legitimateSources = [
    'issue',           // GitHub Issue
    'spec',            // Formal Specification  
    'controller'       // Authorized Controller Context
  ]

  const illegitimateSources = [
    'worker',          // Workers implement, don't define scope
    'builder',         // Builders compile, don't define scope
    'tool',            // Tools execute, don't define scope
    'capability'       // Capability discovery
  ]

  const violations = []
  const taskSources = Object.keys(task_context || {})

  // Check for presence of legitimate sources
  const hasLegitimateSource = legitimateSources.some(source => 
    taskSources.includes(source) && task_context[source]
  )

  if (!hasLegitimateSource) {
    violations.push({
      reason: 'NO_LEGITIMATE_SCOPE_AUTHORITY_SOURCE',
      message: 'Task context lacks issue, spec, or authorized controller context'
    })
  }

  // Check for presence of illegitimate sources defining scope
  for (const illegitimate of illegitimateSources) {
    if (task_context[illegitimate]?.scope || task_context[illegitimate]?.requirements) {
      violations.push({
        reason: 'ILLEGITIMATE_SCOPE_AUTHORITY_SOURCE',
        source: illegitimate,
        message: `${illegitimate} is defining scope, which is not a legitimate authority source`
      })
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    message: violations.length === 0 ?
      'Scope authority comes only from legitimate sources' :
      `${violations.length} illegitimate scope authority sources detected`
  }
}

/**
 * INVARIANT 3: WORKER_CANNOT_EXPAND_SCOPE
 * 
 * Workers may implement but cannot expand authorized scope.
 */
async function checkWorkerCannotExpandScope({ proposed_scope, task_context }) {
  const authorized_scope = {
    allows_responsive_validation: task_context?.spec?.acceptance_criteria?.toLowerCase().includes('responsive'),
    capabilities: extractRequiredCapabilities(task_context)
  }

  const guardResult = guardAgainstScopeExpansion({
    worker_proposed_scope: proposed_scope,
    authorized_scope
  })

  return {
    passed: !guardResult.blocked,
    violations: guardResult.blocked ? guardResult.expansions : [],
    message: guardResult.blocked ?
      `Worker scope expansion blocked: ${guardResult.message}` :
      'Worker did not attempt to expand authorized scope'
  }
}

/**
 * INVARIANT 4: CORE_AND_CAPABILITY_STATUS_SEPARATED
 * 
 * Core architecture status must be separate from optional capability status.
 */
async function checkCoreAndCapabilityStatusSeparated() {
  const violations = []

  // Check that capabilities are properly classified
  for (const [name, def] of Object.entries(CAPABILITY_REGISTRY)) {
    if (!Object.values(CAPABILITY_STATUS).includes(def.status)) {
      violations.push({
        capability: name,
        reason: 'INVALID_CAPABILITY_STATUS',
        message: `Capability "${name}" has invalid status: ${def.status}`
      })
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    message: violations.length === 0 ?
      'All capabilities have valid status classifications' :
      `${violations.length} capabilities have invalid status classifications`
  }
}

/**
 * INVARIANT 5: OPTIONAL_CAPABILITY_CANNOT_PROMOTE_CORE
 * 
 * Optional capability success cannot promote core baseline.
 */
async function checkOptionalCapabilityCannotPromoteCore({ task_context }) {
  // This is a policy check - optional capabilities should not claim core status
  const violations = []

  // Check if any optional capabilities are being treated as core requirements
  for (const [name, def] of Object.entries(CAPABILITY_REGISTRY)) {
    if (def.status === CAPABILITY_STATUS.OPTIONAL_PROJECT_SCOPED) {
      // Check if task is treating this as a core requirement
      if (task_context?.core_requirements?.includes(name)) {
        violations.push({
          capability: name,
          reason: 'OPTIONAL_CAPABILITY_TREATED_AS_CORE',
          message: `Optional capability "${name}" is being treated as a core requirement`
        })
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    message: violations.length === 0 ?
      'No optional capabilities are being treated as core requirements' :
      `${violations.length} optional capabilities are being treated as core requirements`
  }
}

/**
 * INVARIANT 6: RESPONSIVE_CORE_NOT_IMPLICIT_DEFAULT
 * 
 * Multi-viewport responsive_core should not be the implicit default.
 */
async function checkResponsiveCoreNotImplicitDefault({ task_context, proposed_scope }) {
  const violations = []

  // Check if responsive_core is being used without explicit requirement
  const proposedProfile = proposed_scope?.viewport_profile || task_context?.viewport_profile
  
  if (proposedProfile === 'responsive_core') {
    const authResult = verifyViewportProfileAuthorization({
      proposed_profile: 'responsive_core',
      task_context
    })

    if (!authResult.authorized) {
      violations.push({
        reason: 'RESPONSIVE_CORE_WITHOUT_EXPLICIT_REQUIREMENT',
        message: authResult.message,
        suggested_profile: authResult.suggested_profile
      })
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    message: violations.length === 0 ?
      'Responsive core is not being used without explicit requirement' :
      'Responsive core is being used without explicit requirement'
  }
}

/**
 * Extract capabilities required by task context
 */
function extractRequiredCapabilities(task_context) {
  const capabilities = []
  const issueText = `${task_context?.issue?.title || ''} ${task_context?.issue?.body || ''}`.toLowerCase()
  const specText = task_context?.spec?.acceptance_criteria || ''

  // Check for explicit capability requirements in issue/spec
  for (const [name, def] of Object.entries(CAPABILITY_REGISTRY)) {
    const requirementPatterns = {
      PLAYWRIGHT_BROWSER: ['browser', 'screenshot', 'ui', 'ux', 'visual'],
      VISION_REVIEW: ['vision', 'visual review', 'image analysis'],
      MULTI_VIEWPORT_RESPONSIVE: ['responsive', 'viewport', 'mobile', 'tablet']
    }

    const patterns = requirementPatterns[name] || []
    const hasRequirement = patterns.some(pattern => 
      issueText.includes(pattern) || specText.toLowerCase().includes(pattern)
    )

    if (hasRequirement && def.status === CAPABILITY_STATUS.OPTIONAL_PROJECT_SCOPED) {
      capabilities.push(name)
    }
  }

  return capabilities
}
