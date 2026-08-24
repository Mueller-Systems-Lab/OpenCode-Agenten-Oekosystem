// SPDX-License-Identifier: MIT
import { test } from 'node:test'
import assert from 'node:assert'
import {
  verifyCapabilityActivation,
  verifyViewportProfileAuthorization, 
  guardAgainstScopeExpansion,
  getCapabilityScopeAuthorityState
} from '../../runtime/gates/capability-scope-guard.mjs'
import {
  checkScopeAuthorityInvariants
} from '../../runtime/invariants/scope-authority-invariant.mjs'

test.describe('CAPABILITY_DOES_NOT_CREATE_REQUIREMENT', () => {
  test('Playwright capability requires explicit issue reference', async () => {
    const taskContextWithBrowserIssue = {
      issue: {
        title: 'Fix navigation menu on mobile devices',
        body: 'The navigation menu does not work properly on mobile viewports. Need to test with browser automation.'
      }
    }

    const taskContextWithoutBrowserIssue = {
      issue: {
        title: 'Update API documentation',
        body: 'Need to update the API docs to reflect new endpoints.'
      }
    }

    const withIssue = verifyCapabilityActivation({
      capability: 'PLAYWRIGHT_BROWSER',
      task_context: taskContextWithBrowserIssue,
      activation_type: 'automatic'
    })

    const withoutIssue = verifyCapabilityActivation({
      capability: 'PLAYWRIGHT_BROWSER', 
      task_context: taskContextWithoutBrowserIssue,
      activation_type: 'automatic'
    })

    assert.ok(withIssue.authorized, 'Should be authorized when issue mentions browser')
    assert.ok(!withoutIssue.authorized, 'Should not be authorized when issue lacks browser requirement')
    assert.equal(withoutIssue.reason, 'CAPABILITY_REQUIRES_EXPLICIT_REQUIREMENT')
  })

  test('Multi-viewport requires explicit spec acceptance criterion', async () => {
    const taskContextWithResponsiveSpec = {
      spec: {
        acceptance_criteria: 'Application must render correctly on mobile, tablet, and desktop viewports'
      }
    }

    const taskContextWithoutResponsiveSpec = {
      spec: {
        acceptance_criteria: 'API must return 200 status code'
      }
    }

    const withSpec = verifyCapabilityActivation({
      capability: 'MULTI_VIEWPORT_RESPONSIVE',
      task_context: taskContextWithResponsiveSpec,
      activation_type: 'automatic'
    })

    const withoutSpec = verifyCapabilityActivation({
      capability: 'MULTI_VIEWPORT_RESPONSIVE',
      task_context: taskContextWithoutResponsiveSpec,
      activation_type: 'automatic'
    })

    assert.ok(withSpec.authorized, 'Should be authorized when spec requires responsive validation')
    assert.ok(!withoutSpec.authorized, 'Should not be authorized when spec lacks responsive requirement')
    assert.equal(withoutSpec.reason, 'CAPABILITY_REQUIRES_EXPLICIT_REQUIREMENT');
  })
})

test.describe('RESPONSIVE_CORE_NOT_IMPLICIT_DEFAULT', () => {
  test('Responsive core requires explicit requirement', async () => {
    const taskContextWithResponsiveRequirement = {
      spec: {
        acceptance_criteria: 'Must work on mobile, tablet, and desktop viewports'
      }
    }

    const taskContextWithoutResponsiveRequirement = {
      spec: {
        acceptance_criteria: 'Must load correctly in desktop browser'
      }
    }

    const withRequirement = verifyViewportProfileAuthorization({
      proposed_profile: 'responsive_core',
      task_context: taskContextWithResponsiveRequirement
    })

    const withoutRequirement = verifyViewportProfileAuthorization({
      proposed_profile: 'responsive_core',
      task_context: taskContextWithoutResponsiveRequirement
    })

    assert.ok(withRequirement.authorized, 'Should authorize responsive_core with explicit requirement')
    assert.ok(!withoutRequirement.authorized, 'Should reject responsive_core without explicit requirement')
    assert.equal(withoutRequirement.reason, 'RESPONSIVE_CORE_REQUIRES_EXPLICIT_REQUIREMENT')
    assert.equal(withoutRequirement.suggested_profile, 'desktop_only')
  })

  test('Default viewport is not responsive_core', async () => {
    const state = getCapabilityScopeAuthorityState()
    assert.equal(state.RESPONSIVE_CORE_NOT_IMPLICIT_DEFAULT, 'ENFORCED')
  })
})

test.describe('WORKER_SCOPE_EXPANSION_GUARDED', () => {
  test('Worker cannot expand to multi-viewport without authorization', async () => {
    const authorizedScope = {
      allows_responsive_validation: false,
      capabilities: ['CORE_ARCHITECTURE']
    }

    const workerProposedScope = {
      viewport_profile: 'responsive_core',
      capabilities: ['PLAYWRIGHT_BROWSER', 'MULTI_VIEWPORT_RESPONSIVE']
    }

    const taskContext = {
      spec: {
        acceptance_criteria: 'Fix desktop UI layout issue'
      }
    }

    const guardResult = guardAgainstScopeExpansion({
      worker_proposed_scope: workerProposedScope,
      authorized_scope: authorizedScope
    })

    assert.ok(guardResult.blocked, 'Should block worker scope expansion')
    assert.ok(guardResult.expansions.length > 0, 'Should detect expansions')
    
    const viewportExpansion = guardResult.expansions.find(e => 
      e.type === 'VIEWPORT_SCOPE_EXPANSION')
    assert.ok(viewportExpansion, 'Should detect viewport scope expansion')
  })

  test('Worker cannot add optional capabilities without authorization', async () => {
    const authorizedScope = {
      allows_responsive_validation: false,
      capabilities: ['CORE_ARCHITECTURE']
    }

    const workerProposedScope = {
      viewport_profile: 'desktop_only',
      capabilities: ['CORE_ARCHITECTURE', 'VISION_REVIEW', 'SEVERITY_CALIBRATION']
    }

    const guardResult = guardAgainstScopeExpansion({
      worker_proposed_scope: workerProposedScope,
      authorized_scope: authorizedScope
    })

    assert.ok(guardResult.blocked, 'Should block unauthorized capability additions')
    
    const capabilityExpansions = guardResult.expansions.filter(e => 
      e.type === 'CAPABILITY_SCOPE_EXPANSION')
    assert.ok(capabilityExpansions.length > 0, 'Should detect capability scope expansions')
  })
})

test.describe('SCOPE_AUTHORITY_INTEGRATION', () => {
  test('All scope authority invariants pass with valid context', async () => {
    const taskContext = {
      issue: {
        title: 'Fix mobile navigation menu',
        body: 'Navigation menu broken on mobile devices - need browser testing'
      },
      spec: {
        acceptance_criteria: 'Navigation menu works correctly on mobile viewport (390x844)'
      },
      proposed_scope: {
        viewport_profile: 'mobile_only',
        capabilities: ['PLAYWRIGHT_BROWSER']
      }
    }

    // Test that capabilities are properly authorized when explicitly required
    const authResult = verifyCapabilityActivation({
      capability: 'PLAYWRIGHT_BROWSER',
      task_context: taskContext,
      activation_type: 'automatic'
    })
    assert.ok(authResult.authorized, 'Capability should be authorized with explicit requirement')
    
    // Test that responsive_core is not used without authorization
    const viewportResult = verifyViewportProfileAuthorization({
      proposed_profile: 'responsive_core',
      task_context: taskContext
    })
    assert.ok(!viewportResult.authorized, 'Responsive core should not be authorized without explicit responsive requirement')
    
    // Test state
    const state = getCapabilityScopeAuthorityState()
    assert.equal(state.RESPONSIVE_CORE_NOT_IMPLICIT_DEFAULT, 'ENFORCED')
    assert.equal(state.CAPABILITY_DOES_NOT_CREATE_REQUIREMENT, 'ENFORCED')
  })

  test('Scope authority invariants fail with invalid context', async () => {
    const taskContext = {
      issue: {
        title: 'Update backend API',
        body: 'Need to add new endpoint for user data'
      },
      spec: {
        acceptance_criteria: 'API returns 200 status'
      },
      proposed_scope: {
        viewport_profile: 'responsive_core',
        capabilities: ['PLAYWRIGHT_BROWSER', 'MULTI_VIEWPORT_RESPONSIVE']
      }
    }

    const guardResult = guardAgainstScopeExpansion({
      worker_proposed_scope: taskContext.proposed_scope,
      authorized_scope: {
        allows_responsive_validation: false,
        capabilities: ['CORE_ARCHITECTURE']
      }
    })
    
    assert.ok(guardResult.blocked, 'Should block when worker attempts unauthorized expansion')
    assert.ok(guardResult.expansions.length > 0, 'Should detect violations')
    
    // Check specific violations
    const viewportExpansion = guardResult.expansions.find(e => 
      e.type === 'VIEWPORT_SCOPE_EXPANSION')
    assert.ok(viewportExpansion, 'Should detect viewport scope expansion')
  })
})
