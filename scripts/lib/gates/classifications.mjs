// SPDX-License-Identifier: MIT
/**
 * Classification System
 *
 * Defines the classification hierarchy and priority rules.
 *
 * Classification Priority (immutable, kernel-enforced):
 *   RED_BLOCK > TOOL_GAP > AMBER_REVIEW > GREEN_SAFE
 *
 * Verification Levels (structural vs. live):
 *   FAILED > TOOL_GAP > NOT_CHECKED > STRUCTURAL_PASS > CLI_PASS > RUNTIME_SMOKE_PASS > LIVE_INTEGRATION_PASS
 */

// ── Classification Constants ──────────────────────────────────────

/** @enum {string} Valid run classifications, ordered by severity (highest first). */
export const CLASSIFICATIONS = Object.freeze({
  RED_BLOCK: 'RED_BLOCK',
  TOOL_GAP: 'TOOL_GAP',
  AMBER_REVIEW: 'AMBER_REVIEW',
  GREEN_SAFE: 'GREEN_SAFE'
});

/**
 * Priority ordering for classifications.
 * Lower index = higher priority (overrides everything below it).
 * RED_BLOCK has absolute priority — no other classification can coexist with it.
 */
export const CLASSIFICATION_PRIORITY = Object.freeze([
  CLASSIFICATIONS.RED_BLOCK,
  CLASSIFICATIONS.TOOL_GAP,
  CLASSIFICATIONS.AMBER_REVIEW,
  CLASSIFICATIONS.GREEN_SAFE
]);

// ── Verification Levels ───────────────────────────────────────────

/** @enum {string} Verification levels from none to full live integration. */
export const VERIFICATION_LEVELS = Object.freeze({
  NOT_CHECKED: 'NOT_CHECKED',
  STRUCTURAL_PASS: 'STRUCTURAL_PASS',
  CLI_PASS: 'CLI_PASS',
  RUNTIME_SMOKE_PASS: 'RUNTIME_SMOKE_PASS',
  LIVE_INTEGRATION_PASS: 'LIVE_INTEGRATION_PASS',
  TOOL_GAP: 'TOOL_GAP',
  FAILED: 'FAILED'
});

/**
 * Priority ordering for verification levels.
 * FAILED and TOOL_GAP are terminal states in the verification chain.
 * Lower index = more severe / less validated.
 */
export const VERIFICATION_LEVEL_PRIORITY = Object.freeze([
  VERIFICATION_LEVELS.FAILED,
  VERIFICATION_LEVELS.TOOL_GAP,
  VERIFICATION_LEVELS.NOT_CHECKED,
  VERIFICATION_LEVELS.STRUCTURAL_PASS,
  VERIFICATION_LEVELS.CLI_PASS,
  VERIFICATION_LEVELS.RUNTIME_SMOKE_PASS,
  VERIFICATION_LEVELS.LIVE_INTEGRATION_PASS
]);

// ── Classification Resolution ─────────────────────────────────────

/**
 * Combine multiple classifications into a single result.
 * Follows priority rules:
 *   - Any RED_BLOCK → overall RED_BLOCK (absolute veto)
 *   - Any TOOL_GAP + no RED_BLOCK → overall TOOL_GAP
 *   - Any AMBER_REVIEW + no higher → overall AMBER_REVIEW
 *   - All GREEN_SAFE → overall GREEN_SAFE
 *
 * @param {Array<{ classification: string, verificationLevel?: string }>} results
 * @returns {{ classification: string, verificationLevel: string }}
 */
export function resolveClassification(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return {
      classification: CLASSIFICATIONS.GREEN_SAFE,
      verificationLevel: VERIFICATION_LEVELS.NOT_CHECKED
    };
  }

  let hasRedBlock = false;
  let hasToolGap = false;
  let hasAmberReview = false;
  let allGreen = true;

  for (const result of results) {
    const c = result.classification;
    if (c === CLASSIFICATIONS.RED_BLOCK) {
      hasRedBlock = true;
    } else if (c === CLASSIFICATIONS.TOOL_GAP) {
      hasToolGap = true;
      allGreen = false;
    } else if (c === CLASSIFICATIONS.AMBER_REVIEW) {
      hasAmberReview = true;
      allGreen = false;
    } else if (c !== CLASSIFICATIONS.GREEN_SAFE) {
      // Unknown classification — treat as AMBER_REVIEW for safety
      hasAmberReview = true;
      allGreen = false;
    }
  }

  // Resolve verification level: worst level across all results
  let resolvedLevel = VERIFICATION_LEVELS.NOT_CHECKED;
  for (const result of results) {
    const vl = result.verificationLevel || VERIFICATION_LEVELS.NOT_CHECKED;
    resolvedLevel = worstVerificationLevel(resolvedLevel, vl);
  }

  let classification;
  if (hasRedBlock) {
    classification = CLASSIFICATIONS.RED_BLOCK;
  } else if (hasToolGap) {
    classification = CLASSIFICATIONS.TOOL_GAP;
  } else if (hasAmberReview) {
    classification = CLASSIFICATIONS.AMBER_REVIEW;
  } else if (allGreen) {
    classification = CLASSIFICATIONS.GREEN_SAFE;
  } else {
    classification = CLASSIFICATIONS.AMBER_REVIEW; // safety default
  }

  return { classification, verificationLevel: resolvedLevel };
}

/**
 * Return the worse of two verification levels.
 */
function worstVerificationLevel(a, b) {
  const aIdx = VERIFICATION_LEVEL_PRIORITY.indexOf(a);
  const bIdx = VERIFICATION_LEVEL_PRIORITY.indexOf(b);
  const aValid = aIdx >= 0;
  const bValid = bIdx >= 0;

  if (!aValid && !bValid) return VERIFICATION_LEVELS.TOOL_GAP;
  if (!aValid) return b;
  if (!bValid) return a;
  return aIdx <= bIdx ? a : b;
}

/**
 * Determine if a classification allows the operation to proceed.
 */
export function isAllowed(classification) {
  return classification === CLASSIFICATIONS.GREEN_SAFE;
}

/**
 * Deep-freeze an object to prevent mutation (immutable by convention).
 * This is NOT cryptographic — it prevents accidental mutation at runtime.
 * For kernel gate protection, combine with structural validation.
 */
export function deepFreeze(obj) {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  // Handle arrays
  if (Array.isArray(obj)) {
    obj.forEach(item => deepFreeze(item));
  } else {
    Object.keys(obj).forEach(key => deepFreeze(obj[key]));
  }
  return Object.freeze(obj);
}

/**
 * Assert that a value is a valid classification.
 * Throws if not valid.
 */
export function assertValidClassification(value) {
  if (!Object.values(CLASSIFICATIONS).includes(value)) {
    throw new Error(`Invalid classification: "${value}". Must be one of: ${Object.values(CLASSIFICATIONS).join(', ')}`);
  }
  return value;
}

/**
 * Determine exit code from classification.
 */
export function classificationToExitCode(classification) {
  switch (classification) {
    case CLASSIFICATIONS.GREEN_SAFE:
      return 0;
    case CLASSIFICATIONS.AMBER_REVIEW:
    case CLASSIFICATIONS.TOOL_GAP:
      return 1;
    case CLASSIFICATIONS.RED_BLOCK:
      return 2;
    default:
      return 2; // unknown = RED_BLOCK (safety)
  }
}
