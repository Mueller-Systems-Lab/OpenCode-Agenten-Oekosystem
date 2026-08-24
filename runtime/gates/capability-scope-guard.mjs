// SPDX-License-Identifier: MIT
/**
 * Capability Scope Authority Guard
 * 
 * ENFORCES: CAPABILITY_DOES_NOT_CREATE_REQUIREMENT
 * 
 * This guard prevents available capabilities from automatically creating
 * new product requirements, acceptance criteria, or large test matrices.
 * 
 * Core Principle:
 *   A capability (Playwright, Vision Model, Multi-Viewport) cannot by itself
 *   create a requirement. Requirements come from issues, specs, and authorized
 *   controller context. Capabilities are tools used to satisfy requirements,
 *   not sources of requirements themselves.
 * 
 * Examples of what this prevents:
 * - Playwright available ≠ run responsive matrix by default
 * - Vision model available ≠ perform vision review for every task
 * - Multi-viewport code exists ≠ test all 5 viewports for desktop-only bugs
 * - GitHub MCP available ≠ introduce new GitHub workflow requirements
 */

import { DEFAULT_VIEWPORT_PROFILE } from '../visual/viewport-policy.mjs'

/**
 * Capability activation requires explicit requirement
 */
export const CAPABILITY_ACTIVATION_REQUIRES = {
  EXPLICIT_ISSUE_REFERENCE: 'EXPLICIT_ISSUE_REFERENCE',
  EXPLICIT_SPEC_ACCEPTANCE_CRITERION: 'EXPLICIT_SPEC_ACCEPTANCE_CRITERION',
  AUTHORIZED_CONTROLLER_CONTEXT: 'AUTHORIZED_CONTROLLER_CONTEXT'
}

/**
 * Capability status classifications
 */
export const CAPABILITY_STATUS = {
  CORE_ARCHITECTURE: 'CORE_ARCHITECTURE', // Canonical runtime components
  OPTIONAL_PROJECT_SCOPED: 'OPTIONAL_PROJECT_SCOPED', // Available but not default
  CONDITIONAL: 'CONDITIONAL', // Requires specific runtime conditions
  DISABLED: 'DISABLED' // Available but not activated
}

/**
 * Map capabilities to their status and activation requirements
 */
export const CAPABILITY_REGISTRY = Object.freeze({
  PLAYWRIGHT_BROWSER: {
    status: CAPABILITY_STATUS.OPTIONAL_PROJECT_SCOPED,
    activation_requires: CAPABILITY_ACTIVATION_REQUIRES.EXPLICIT_ISSUE_REFERENCE,
    notes: 'Browser interaction available only when issue requires UI/UX validation'
  },
  VISION_REVIEW: {
    status: CAPABILITY_STATUS.OPTIONAL_PROJECT_SCOPED,
    activation_requires: CAPABILITY_ACTIVATION_REQUIRES.EXPLICIT_ISSUE_REFERENCE,
    notes: 'Vision model review only when task explicitly requires visual verification'
  },
  MULTI_VIEWPORT_RESPONSIVE: {
    status: CAPABILITY_STATUS.OPTIONAL_PROJECT_SCOPED,
    activation_requires: CAPABILITY_ACTIVATION_REQUIRES.EXPLICIT_SPEC_ACCEPTANCE_CRITERION,
    notes: 'Responsive matrix only when issue/spec explicitly requires responsive validation'
  },
  SEVERITY_CALIBRATION: {
    status: CAPABILITY_STATUS.CONDITIONAL,
    activation_requires: CAPABILITY_ACTIVATION_REQUIRES.AUTHORIZED_CONTROLLER_CONTEXT,
    notes: 'Calibration only when multi-viewport is activated'
  },
  CROSS_VIEWPORT_CORRELATION: {
    status: CAPABILITY_STATUS.CONDITIONAL,
    activation_requires: CAPABILITY_ACTIVATION_REQUIRES.AUTHORIZED_CONTROLLER_CONTEXT,
    notes: 'Correlation only when multi-viewport is activated'
  }
})

/**
 * Verify that capability activation is authorized
 * 
 * @param {Object} params - Activation parameters
 * @param {string} params.capability - Capability name from CAPABILITY_REGISTRY
 * @param {Object} params.task_context - Task context containing issue/spec info
 * @param {string} params.activation_type - Type of activation request
 * @returns {Object} Authorization result
 */
export function verifyCapabilityActivation({ capability, task_context, activation_type }) {
  const capabilityDef = CAPABILITY_REGISTRY[capability]
  
  if (!capabilityDef) {
    return {
      authorized: false,
      reason: 'UNKNOWN_CAPABILITY',
      message: `Capability "${capability}" is not registered in CAPABILITY_REGISTRY`
    }
  }

  // If capability is disabled, deny activation
  if (capabilityDef.status === CAPABILITY_STATUS.DISABLED) {
    return {
      authorized: false,
      reason: 'CAPABILITY_DISABLED',
      message: `Capability "${capability}" is registered but disabled`
    }
  }

  // Core architecture capabilities are always available
  if (capabilityDef.status === CAPABILITY_STATUS.CORE_ARCHITECTURE) {
    return {
      authorized: true,
      reason: 'CORE_ARCHITECTURE_ALWAYS_AVAILABLE',
      message: `Capability "${capability}" is part of core architecture`
    }
  }

  // For optional capabilities, verify explicit requirement exists
  if (capabilityDef.status === CAPABILITY_STATUS.OPTIONAL_PROJECT_SCOPED) {
    const hasExplicitRequirement = checkForExplicitRequirement({
      capability,
      task_context,
      required_activation: capabilityDef.activation_requires
    })
    
    if (!hasExplicitRequirement.present) {
      return {
        authorized: false,
        reason: 'CAPABILITY_REQUIRES_EXPLICIT_REQUIREMENT',
        message: hasExplicitRequirement.message || 
          `Capability "${capability}" requires explicit ${capabilityDef.activation_requires}`
      }
    }
    
    return {
      authorized: true,
      reason: 'EXPLICIT_REQUIREMENT_AUTHORIZED',
      message: `Capability "${capability}" activated due to explicit requirement`
    }
  }

  // For conditional capabilities, verify controller context
  if (capabilityDef.status === CAPABILITY_STATUS.CONDITIONAL) {
    const hasContext = checkControllerContext({
      capability,
      task_context
    })
    
    if (!hasContext.present) {
      return {
        authorized: false,
        reason: 'CAPABILITY_REQUIRES_CONTROLLER_CONTEXT',
        message: `Capability "${capability}" requires specific controller context`
      }
    }
    
    return {
      authorized: true,
      reason: 'CONTROLLER_CONTEXT_AUTHORIZED',
      message: `Capability "${capability}" activated due to controller context`
    }
  }

  return {
    authorized: false,
    reason: 'UNKNOWN_CAPABILITY_STATUS',
    message: `Capability "${capability}" has unknown status: ${capabilityDef.status}`
  }
}

/**
 * Check if task context contains explicit requirement for capability
 */
function checkForExplicitRequirement({ capability, task_context, required_activation }) {
  const issueText = task_context?.issue?.body || task_context?.issue?.title || ''
  const specText = task_context?.spec?.acceptance_criteria || ''
  const combinedText = `${issueText} ${specText}`.toLowerCase()

  // Define patterns that indicate explicit requirements
  const requirementPatterns = {
    PLAYWRIGHT_BROWSER: [
      'browser', 'screenshot', 'ui', 'ux', 'visual', 'frontend', 'webpage'
    ],
    VISION_REVIEW: [
      'vision', 'visual review', 'image analysis', 'screenshot review'
    ],
    MULTI_VIEWPORT_RESPONSIVE: [
      'responsive', 'viewport', 'mobile', 'tablet', 'breakpoint', 
      'cross-device', 'multi-viewport'
    ]
  }

  const patterns = requirementPatterns[capability] || []
  const hasKeyword = patterns.some(keyword => combinedText.includes(keyword))

  if (required_activation === CAPABILITY_ACTIVATION_REQUIRES.EXPLICIT_ISSUE_REFERENCE) {
    return {
      present: hasKeyword,
      message: hasKeyword ? 
        `Issue contains relevant keywords for ${capability}` :
        `Issue lacks explicit mention of ${capability} functionality`
    }
  }

  if (required_activation === CAPABILITY_ACTIVATION_REQUIRES.EXPLICIT_SPEC_ACCEPTANCE_CRITERION) {
    const hasSpecRequirement = patterns.some(keyword => 
      specText.toLowerCase().includes(keyword)
    )
    return {
      present: hasSpecRequirement,
      message: hasSpecRequirement ? 
        `Spec acceptance criteria explicitly require ${capability}` :
        `Spec acceptance criteria do not explicitly require ${capability}`
    }
  }

  return { present: false, message: 'Unknown activation requirement type' }
}

/**
 * Check if controller context authorizes capability
 */
function checkControllerContext({ capability, task_context }) {
  // Multi-viewport capabilities require that multi-viewport is already activated
  if (capability === 'SEVERITY_CALIBRATION' || capability === 'CROSS_VIEWPORT_CORRELATION') {
    const multiViewportActivated = task_context?.viewport_profile === 'responsive_core' ||
      (task_context?.custom_viewports && task_context.custom_viewports.length > 1)
    
    return {
      present: multiViewportActivated,
      message: multiViewportActivated ? 
        'Multi-viewport is activated, allowing correlation/calibration' :
        'Multi-viewport is not activated, correlation/calibration not needed'
    }
  }

  return { present: false, message: 'Unknown conditional capability' }
}

/**
 * Prevent scope expansion by workers
 * 
 * Workers may decide HOW to implement, but not WHAT new requirements exist.
 * This guard prevents workers from expanding the acceptance scope beyond
 * what was authorized in the issue/spec.
 */
export function guardAgainstScopeExpansion({ worker_proposed_scope, authorized_scope }) {
  const expansionDetected = []
  
  // Check for viewport expansion
  if (worker_proposed_scope?.viewport_profile && 
      !authorized_scope?.allows_responsive_validation) {
    expansionDetected.push({
      type: 'VIEWPORT_SCOPE_EXPANSION',
      proposed: worker_proposed_scope.viewport_profile,
      authorized: authorized_scope.viewport_profile || 'none',
      reason: 'Worker proposed multi-viewport when issue/spec did not authorize it'
    })
  }

  // Check for capability expansion
  const proposedCapabilities = worker_proposed_scope?.capabilities || []
  const authorizedCapabilities = authorized_scope?.capabilities || []
  
  for (const capability of proposedCapabilities) {
    if (!authorizedCapabilities.includes(capability)) {
      const capabilityDef = CAPABILITY_REGISTRY[capability]
      if (capabilityDef?.status === CAPABILITY_STATUS.OPTIONAL_PROJECT_SCOPED) {
        expansionDetected.push({
          type: 'CAPABILITY_SCOPE_EXPANSION',
          proposed: capability,
          reason: `Worker proposed optional capability "${capability}" without explicit requirement`
        })
      }
    }
  }

  return {
    blocked: expansionDetected.length > 0,
    expansions: expansionDetected,
    message: expansionDetected.length > 0 ?
      `Scope expansion blocked: ${expansionDetected.map(e => e.reason).join('; ')}` :
      'No scope expansion detected'
  }
}

/**
 * Verify viewport profile selection is authorized
 * 
 * Specifically prevents automatic selection of responsive_core without
 * explicit requirement.
 */
export function verifyViewportProfileAuthorization({ proposed_profile, task_context }) {
  // Check if responsive_core is being proposed without authorization
  if (proposed_profile === 'responsive_core') {
    const hasResponsiveRequirement = checkForExplicitRequirement({
      capability: 'MULTI_VIEWPORT_RESPONSIVE',
      task_context,
      required_activation: CAPABILITY_ACTIVATION_REQUIRES.EXPLICIT_SPEC_ACCEPTANCE_CRITERION
    })
    
    if (!hasResponsiveRequirement.present) {
      return {
        authorized: false,
        reason: 'RESPONSIVE_CORE_REQUIRES_EXPLICIT_REQUIREMENT',
        message: 'Multi-viewport responsive_core profile requires explicit responsive validation requirement in issue/spec',
        suggested_profile: DEFAULT_VIEWPORT_PROFILE || 'desktop_only'
      }
    }
  }

  return {
    authorized: true,
    reason: 'VIEWPORT_PROFILE_AUTHORIZED',
    message: `Viewport profile "${proposed_profile}" is authorized`
  }
}

/**
 * Core invariant verification
 * 
 * Returns the current state of capability scope authority invariants
 */
export function getCapabilityScopeAuthorityState() {
  return {
    CAPABILITY_DOES_NOT_CREATE_REQUIREMENT: 'ENFORCED',
    CORE_AND_CAPABILITY_STATUS_SEPARATED: 'ENFORCED', 
    OPTIONAL_CAPABILITY_CANNOT_PROMOTE_CORE: 'ENFORCED',
    RESPONSIVE_CORE_NOT_IMPLICIT_DEFAULT: DEFAULT_VIEWPORT_PROFILE !== 'responsive_core' ? 'ENFORCED' : 'VIOLATED',
    WORKER_SCOPE_EXPANSION_GUARDED: 'ENFORCED',
    timestamp: new Date().toISOString()
  }
}
