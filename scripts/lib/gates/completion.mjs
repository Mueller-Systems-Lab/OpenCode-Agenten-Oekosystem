// SPDX-License-Identifier: MIT
import { CLASSIFICATIONS } from './classifications.mjs'

export function createVerifiedInScope({ scope, verificationLevel, testedRuntime, baseSha, headSha, uncheckedAreas = [], approvalIds = [], leaseIds = [], ownerInterruptions = 0, timestamp = new Date().toISOString() } = {}) {
  if (!Array.isArray(scope) || !scope.length) throw new Error('VERIFIED_IN_SCOPE requires a checked scope.')
  if (!verificationLevel || !testedRuntime || !baseSha || !headSha) throw new Error('VERIFIED_IN_SCOPE requires verification, runtime, and commit evidence.')
  return Object.freeze({ classification: CLASSIFICATIONS.VERIFIED_IN_SCOPE, checked_scope: [...scope], verification_level: verificationLevel, tested_runtime: testedRuntime, base_sha: baseSha, head_sha: headSha, known_unchecked_areas: [...uncheckedAreas], approval_ids: [...approvalIds], lease_ids: [...leaseIds], owner_interruptions: ownerInterruptions, timestamp })
}

export function isLegacyCompletionAlias(value) {
  return value === 'GREEN_SAFE'
}
