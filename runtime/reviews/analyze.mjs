// SPDX-License-Identifier: MIT
/**
 * Deterministic review analyzers.
 *
 * Correctness, Security and Quality reviews are produced by real deterministic
 * analyzers over the build result and verification output. They reuse the
 * shared ecosystem.review.v1 contract. These are independent jobs, not three
 * new permanent agents.
 */
import fs from 'node:fs'
import path from 'node:path'
import { create as createReview } from '../contracts/review.mjs'

const SECRET_ASSIGNMENT = /(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{12,}['"]/i
const PRIVATE_KEY_BLOCK = /BEGIN (?:RSA|EC|OPENSSH|DSA|PGP|PRIVATE) KEY/
const HARDCODED_SECRET_HEADER = /(?:authorization|api-key|x-api-key)\s*:\s*['"][A-Za-z0-9+/=_-]{12,}['"]/i
const DANGEROUS_EXEC = /\b(?:eval|child_process\.exec|child_process\.execSync)\s*\(/
const PATH_TRAVERSAL = /\.\.(?:[\\/]\.\.)+/

const QUALITY_MARKERS = [/\bTODO\b/, /\bFIXME\b/, /\bHACK\b/, /\bXXX\b/]

function readChangedFiles({ repoRoot, changedFiles }) {
  const contents = {}
  for (const relative of changedFiles || []) {
    const resolved = path.resolve(repoRoot || '.', relative)
    if (!resolved.startsWith(path.resolve(repoRoot || '.'))) continue
    try { contents[relative] = fs.readFileSync(resolved, 'utf8') } catch { /* not found */ }
  }
  return contents
}

export function reviewCorrectness({ run_id, buildResult, verification } = {}) {
  const passed = buildResult?.status === 'SUCCESS' && verification?.verification?.passed === true
  const findings = []
  if (buildResult?.status !== 'SUCCESS') {
    findings.push({ severity: 'HIGH', message: `build failed: ${(buildResult?.errors || []).join('; ')}` })
  }
  if (verification?.verification?.passed !== true) {
    findings.push({ severity: 'HIGH', message: `verification failed: ${verification?.verification?.failure_signature || 'no signature'}` })
  }
  return createReview({
    run_id,
    review_type: 'correctness',
    review: {
      status: passed ? 'PASS' : 'FAIL',
      severity: passed ? 'INFO' : 'HIGH',
      blocking: !passed,
      recommendation: passed ? 'PASS' : 'FIX',
      findings,
    },
  })
}

export function reviewSecurity({ run_id, buildResult, repoRoot, changedFiles } = {}) {
  const files = readChangedFiles({ repoRoot, changedFiles: changedFiles || buildResult?.changed_files })
  const findings = []
  for (const [relative, content] of Object.entries(files)) {
    if (SECRET_ASSIGNMENT.test(content)) {
      findings.push({ severity: 'CRITICAL', file: relative, message: 'credential-like assignment detected' })
    }
    if (HARDCODED_SECRET_HEADER.test(content)) {
      findings.push({ severity: 'CRITICAL', file: relative, message: 'hardcoded secret header detected' })
    }
    if (PRIVATE_KEY_BLOCK.test(content)) {
      findings.push({ severity: 'CRITICAL', file: relative, message: 'embedded private key block detected' })
    }
    if (DANGEROUS_EXEC.test(content)) {
      findings.push({ severity: 'MEDIUM', file: relative, message: 'dynamic code execution detected' })
    }
    if (PATH_TRAVERSAL.test(content)) {
      findings.push({ severity: 'MEDIUM', file: relative, message: 'path traversal pattern detected' })
    }
  }
  const blocking = findings.some((finding) => ['HIGH', 'CRITICAL'].includes(finding.severity))
  return createReview({
    run_id,
    review_type: 'security',
    review: {
      status: blocking ? 'FAIL' : 'PASS',
      severity: blocking ? 'CRITICAL' : 'INFO',
      blocking,
      recommendation: blocking ? 'BLOCK' : 'PASS',
      findings,
    },
  })
}

export function reviewQuality({ run_id, buildResult, repoRoot, changedFiles } = {}) {
  const files = readChangedFiles({ repoRoot, changedFiles: changedFiles || buildResult?.changed_files })
  const findings = []
  for (const [relative, content] of Object.entries(files)) {
    for (const marker of QUALITY_MARKERS) {
      if (marker.test(content)) {
        findings.push({ severity: 'LOW', file: relative, message: `quality marker ${content.match(marker)[0]} present` })
        break
      }
    }
    if (content.split(/\r?\n/).length > 500) {
      findings.push({ severity: 'MEDIUM', file: relative, message: 'file exceeds 500 lines' })
    }
  }
  return createReview({
    run_id,
    review_type: 'quality',
    review: {
      status: findings.length > 0 ? 'FAIL' : 'PASS',
      severity: findings.some((finding) => finding.severity === 'MEDIUM') ? 'MEDIUM' : findings.length ? 'LOW' : 'INFO',
      blocking: false,
      recommendation: findings.length > 0 ? 'FIX' : 'PASS',
      findings,
    },
  })
}

export const defaultReviewAnalyzers = Object.freeze([
  ['correctness', reviewCorrectness],
  ['security', reviewSecurity],
  ['quality', reviewQuality],
])
