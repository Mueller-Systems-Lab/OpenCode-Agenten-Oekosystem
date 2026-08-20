// SPDX-License-Identifier: MIT
/**
 * OCAE Production Sentinel — deterministic drift-watcher for the frozen runtime.
 *
 * The sentinel is the third completion piece of the production baseline freeze.
 * It guards the canonical contract-first runtime against structural drift:
 *   - canonical runtime entry is mandatory and fail-fast
 *   - no silent legacy execution fallback can be reintroduced
 *   - the deterministic controller keeps sole terminal authority
 *   - plan gate, verify, retry, security hard block, run_id, first-bad-boundary
 *     semantics stay canonical
 *   - the test harness stays exhaustive and machine-readable
 *   - the installer keeps installing exactly the canonical runtime artifact set
 *
 * Checks are structural: module resolution, imports/exports, contract IDs,
 * runtime file lists, installer manifests, and existing validator outputs.
 * Fragile string/comment matches are avoided — a comment change must never
 * raise production drift.
 *
 * This module is used by scripts/validate-ecosystem.mjs (integration point) and
 * by test/controller/production-sentinel.test.mjs (positive + negative drift).
 */
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const SENTINEL_VERSION = 1

/**
 * The canonical critical invariant set. These IDs are the stable property
 * backbone of the baseline fingerprint; changing them is a runtime-critical
 * change (see docs/production-baseline.md).
 */
export const SENTINEL_INVARIANTS = Object.freeze([
  'CANONICAL_RUNTIME_MANDATORY',
  'NO_SILENT_LEGACY_FALLBACK',
  'CONTROLLER_SOLE_TERMINAL_AUTHORITY',
  'PLAN_GATE_UNBYPASSABLE',
  'VERIFY_MANDATORY',
  'RETRY_AUTHORITY_CANONICAL',
  'SECURITY_HARD_BLOCK',
  'RUN_ID_IMMUTABLE',
  'FIRST_BAD_BOUNDARY_STABLE',
  'NO_SECRET_LEAK',
  'WORKER_SUCCESS_NOT_TERMINAL_EVIDENCE',
  'TEST_RUNNER_EXHAUSTIVE',
  // MCP worker tool integration invariants (runtime-critical, additive)
  'MCP_REQUIRED_CAPABILITY_FAILS_CLOSED',
  'MCP_TOOL_SCOPE_LEAST_PRIVILEGE',
  'MCP_TOOL_RESULT_NOT_TERMINAL_AUTHORITY',
  'MCP_TOOL_CALL_BOUNDED',
  'MCP_TOOL_OBSERVABILITY',
  'MCP_NO_SECRET_LEAK',
  // deterministic model routing invariants (runtime-critical, additive)
  'MODEL_ROUTING_RUNTIME_AUTHORITY',
  'WORKER_CANNOT_SELF_SELECT_MODEL',
  'RETRY_ESCALATION_SEPARATION',
  'MODEL_ESCALATION_BOUNDED',
  'ROUTING_CAPABILITY_COMPATIBLE',
  'RUN_ID_STABLE_ACROSS_MODEL_ROUTE',
  'MCP_GRANT_STABLE_ACROSS_MODEL_ROUTE',
  'ROUTING_NO_SECRET_LEAK',
  // availability & cost governance invariants (runtime-critical, additive)
  'LIVE_AVAILABILITY_RUNTIME_AUTHORITY',
  'HEALTH_STATE_TTL_BOUNDED',
  'UNKNOWN_MODEL_PROBED_BEFORE_ROUTE',
  'UNHEALTHY_MODEL_NOT_ROUTED',
  'NO_HEALTHY_MODEL_FAILS_CLOSED',
  'HEALTH_PROBE_BOUNDED',
  'COST_POLICY_RUNTIME_AUTHORITY',
  'HIGH_COST_ESCALATION_POLICY_GATED',
  'ROUTING_BUDGET_BOUNDED',
  'USAGE_OBSERVABILITY',
  'USAGE_NO_SECRET_LEAK',
])

export const REQUIRED_CONTRACT_IDS = Object.freeze([
  'ecosystem.task.v1',
  'ecosystem.baseline.v1',
  'ecosystem.research.v1',
  'ecosystem.plan.v1',
  'ecosystem.build-input.v1',
  'ecosystem.build-result.v1',
  'ecosystem.verification.v1',
  'ecosystem.review.v1',
  'ecosystem.decision.v1',
  'ecosystem.run-event.v1',
])

export const REQUIRED_TERMINAL_STATES = Object.freeze(['DONE', 'FIX', 'SPLIT', 'BLOCKED'])

export const TERMINAL_NEXT_PATHS = Object.freeze({
  DONE: 'FINALIZE',
  FIX: 'TARGETED_FIX',
  SPLIT: 'DECOMPOSE_INTO_SUBTASKS',
  BLOCKED: 'HUMAN_OR_POLICY_INTERVENTION',
})

export const CANONICAL_TEST_COMMAND = 'npm test'

/**
 * Canonical runtime artifacts the installer must ship (dest names as produced
 * by scripts/install-governance.mjs getRuntimeFileList()). These are the
 * structural artifacts that make the installed runtime a runtime at all.
 */
export const INSTALLER_REQUIRED_ARTIFACTS = Object.freeze([
  'run.mjs',
  'contracts/index.mjs',
  'contracts/task.mjs',
  'contracts/baseline.mjs',
  'contracts/research.mjs',
  'contracts/plan.mjs',
  'contracts/build.mjs',
  'contracts/verification.mjs',
  'contracts/review.mjs',
  'contracts/decision.mjs',
  'contracts/run-event.mjs',
  'controller/controller.mjs',
  'controller/plan-gate.mjs',
  'controller/retry-policy.mjs',
  'controller/review-decision.mjs',
  'controller/severity.mjs',
  'controller/verify.mjs',
  'controller/first-bad-boundary.mjs',
  'pipeline/pipeline.mjs',
  'pipeline/research.mjs',
  'baseline/capability-preflight.mjs',
  'baseline/capability-detector.mjs',
  'adapters/native-opencode.mjs',
  'reviews/analyze.mjs',
  'observability/run-events.mjs',
  'observability/events.mjs',
  'mcp/error-classifier.mjs',
  'mcp/tool-grant.mjs',
  'mcp/tool-executor.mjs',
  'mcp/server-registry.mjs',
  // availability & cost governance runtime artifacts (runtime-critical, additive)
  'routing/health-state.mjs',
  'routing/health-probe.mjs',
  'routing/usage.mjs',
])

/** Legacy execution components that must never rejoin the installed path. */
export const LEGACY_EXECUTION_MARKERS = Object.freeze([
  'run-state.mjs',
  'agent/start.mjs',
  'startAgent',
  'runLegacy',
  'legacyRuntime',
  'LEGACY_COMPATIBILITY_PATH',
  'legacyExecution',
  'runLegacyExecution',
])

const DEFAULT_BASELINE_MANIFEST_PATH = 'runtime/production-baseline.json'
const DEFAULT_TEST_MANIFEST_PATH = 'test/test-manifest.json'

// ---------------------------------------------------------------------------
// Structural source analysis helpers
// ---------------------------------------------------------------------------

/**
 * Replace strings and comments with blanks so brace/`catch` structure analysis
 * is never confused by literals or comments (a comment change cannot drift).
 */
function sanitizeForStructure(source) {
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const c = source[i]
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') { out += ' '; i += 1 }
      continue
    }
    if (c === '/' && source[i + 1] === '*') {
      out += '  '
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) { out += ' '; i += 1 }
      out += '  '
      i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += ' '
      i += 1
      while (i < n) {
        if (source[i] === '\\') { out += '  '; i += 2; continue }
        if (source[i] === quote) { out += ' '; i += 1; break }
        if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
          out += '  '
          i += 2
          let depth = 1
          while (i < n && depth > 0) {
            if (source[i] === '{') depth += 1
            else if (source[i] === '}') depth -= 1
            out += source[i] === '\n' ? '\n' : ' '
            i += 1
          }
          continue
        }
        out += source[i] === '\n' ? '\n' : ' '
        i += 1
      }
      continue
    }
    out += c
    i += 1
  }
  return out
}

/** Return the body text of every `catch { ... }` block (structure-clean). */
function findCatchBlockBodies(source) {
  const sanitized = sanitizeForStructure(source)
  const bodies = []
  const re = /\bcatch\s*(?:\([^)]*\))?\s*\{/g
  let m
  while ((m = re.exec(sanitized)) !== null) {
    const start = m.index + m[0].length - 1
    let depth = 1
    let i = start + 1
    while (i < sanitized.length && depth > 0) {
      if (sanitized[i] === '{') depth += 1
      else if (sanitized[i] === '}') depth -= 1
      i += 1
    }
    if (depth === 0) bodies.push(sanitized.slice(start + 1, i - 1))
  }
  return bodies
}

/** Extract import specifiers (static + dynamic) from a module source. */
function extractImportSpecifiers(source) {
  const specifiers = []
  const staticRe = /\bimport\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g
  let m
  while ((m = staticRe.exec(source)) !== null) specifiers.push(m[1])
  const dynamicRe = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = dynamicRe.exec(source)) !== null) specifiers.push(m[1])
  return specifiers
}

/** Extract every `ecosystem.<name>.v1` string literal from source text. */
function extractEcosystemIds(source) {
  const ids = new Set()
  const re = /['"]ecosystem\.[a-z0-9-]+\.v1['"]/g
  let m
  while ((m = re.exec(source)) !== null) ids.add(m[0].slice(1, -1))
  return ids
}

/** Extract a frozen array literal assigned to `const NAME = Object.freeze([...])`. */
function extractFrozenArray(source, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*Object\\.freeze\\(\\[([^\\]]*)\\]\\)`)
  const m = source.match(re)
  if (!m) return null
  return [...m[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
}

async function pathExists(abs) {
  try { await fs.access(abs); return true } catch { return false }
}

async function readIfExists(abs) {
  try { return await fs.readFile(abs, 'utf8') } catch { return null }
}

function normalizeSlash(rel) {
  return rel.split(path.sep).join('/')
}

// ---------------------------------------------------------------------------
// Invariant checks — each returns { ok, issues }
// ---------------------------------------------------------------------------

export async function checkCanonicalRuntime({ repoRoot, runSource = null, pluginSource = null }) {
  const issues = []
  const runPath = path.join(repoRoot, 'runtime', 'run.mjs')
  const pluginPath = path.join(repoRoot, '.opencode', 'plugins', 'canonical-governance.mjs')

  const runFile = runSource ?? await readIfExists(runPath)
  if (!runFile && !runSource) {
    issues.push('CANONICAL_RUNTIME_MANDATORY: runtime/run.mjs missing')
  } else {
    const runSource = runFile
    for (const exportName of ['enterRun', 'enterTask', 'runTask']) {
      if (!runSource || !new RegExp(`export\\s+(?:async\\s+)?function\\s+${exportName}\\b`).test(runSource)) {
        issues.push(`CANONICAL_RUNTIME_MANDATORY: runtime/run.mjs must export ${exportName}`)
      }
    }
  }

  if (!pluginSource && !(await pathExists(pluginPath))) {
    issues.push('CANONICAL_RUNTIME_MANDATORY: canonical plugin entry missing')
  } else {
    const plugin = pluginSource ?? await readIfExists(pluginPath)
    if (!plugin) {
      issues.push('CANONICAL_RUNTIME_MANDATORY: canonical plugin unreadable')
    } else {
      const specifiers = extractImportSpecifiers(plugin)
      if (!specifiers.some((spec) => spec.includes('runtime/run.mjs'))) {
        issues.push('CANONICAL_RUNTIME_MANDATORY: canonical plugin does not import runtime/run.mjs')
      }
      if (!plugin.includes('enterRun')) {
        issues.push('CANONICAL_RUNTIME_MANDATORY: canonical plugin does not reach enterRun')
      }
      if (!/['"]chat\.message['"]\s*:/.test(plugin)) {
        issues.push('CANONICAL_RUNTIME_MANDATORY: canonical plugin lacks the chat.message entry hook')
      }
      if (!plugin.includes('CANONICAL_RUNTIME_UNAVAILABLE')) {
        issues.push('CANONICAL_RUNTIME_MANDATORY: canonical plugin lacks the CANONICAL_RUNTIME_UNAVAILABLE fail-fast reason')
      }
      if (!plugin.includes('RUNTIME_ENTRY_BLOCKED')) {
        issues.push('CANONICAL_RUNTIME_MANDATORY: canonical plugin lacks the RUNTIME_ENTRY_BLOCKED marker')
      }
      if (!plugin.includes('runtimeEntryUnavailable(')) {
        issues.push('CANONICAL_RUNTIME_MANDATORY: runtime import failure must be fail-fast via runtimeEntryUnavailable')
      }
      if (!plugin.includes('fallback_attempted')) {
        issues.push('CANONICAL_RUNTIME_MANDATORY: entry failure records must carry fallback_attempted=false')
      }
    }
  }
  return { ok: issues.length === 0, issues }
}

export async function checkContractIds({ repoRoot }) {
  const issues = []
  const contractsDir = path.join(repoRoot, 'runtime', 'contracts')
  if (!(await pathExists(contractsDir))) {
    issues.push('CONTRACT_SENTINEL: runtime/contracts/ directory missing')
    return { ok: false, issues }
  }
  const found = new Set()
  const entries = await fs.readdir(contractsDir)
  for (const file of entries) {
    if (!file.endsWith('.mjs')) continue
    const source = await readIfExists(path.join(contractsDir, file))
    if (source) for (const id of extractEcosystemIds(source)) found.add(id)
  }
  for (const required of REQUIRED_CONTRACT_IDS) {
    if (!found.has(required)) {
      issues.push(`CONTRACT_SENTINEL: required contract missing: ${required}`)
    }
  }
  return { ok: issues.length === 0, issues }
}

export async function checkNoSilentLegacyFallback({ repoRoot, pluginSource = null, installerSource = null, runSource = null }) {
  const issues = []
  const pluginPath = path.join(repoRoot, '.opencode', 'plugins', 'canonical-governance.mjs')
  const installerPath = path.join(repoRoot, 'scripts', 'install-governance.mjs')
  const runPath = path.join(repoRoot, 'runtime', 'run.mjs')

  const plugin = pluginSource ?? await readIfExists(pluginPath)
  if (plugin) {
    const specifiers = extractImportSpecifiers(plugin)
    for (const spec of specifiers) {
      if (spec.includes('runtime/agent') || spec.includes('agent/start.mjs') || spec.includes('run-state.mjs')) {
        issues.push(`NO_SILENT_LEGACY_FALLBACK: canonical plugin imports legacy execution module (${spec})`)
      }
    }
    for (const marker of LEGACY_EXECUTION_MARKERS) {
      if (plugin.includes(marker)) {
        issues.push(`NO_SILENT_LEGACY_FALLBACK: canonical plugin references legacy execution marker "${marker}"`)
      }
    }
    // Semantic scan: a catch block may never invoke or import legacy execution.
    for (const [index, body] of findCatchBlockBodies(plugin).entries()) {
      const legacyImport = body.match(/import\(\s*['"][^'"]*(?:run-state|agent\/start|runtime\/agent)[^'"]*['"]\s*\)/)
      const legacyCall = LEGACY_EXECUTION_MARKERS
        .filter((marker) => /[A-Za-z]/.test(marker))
        .find((marker) => new RegExp(`\\b${marker}\\s*\\(`).test(body))
      if (legacyImport || legacyCall) {
        issues.push(`NO_SILENT_LEGACY_FALLBACK: catch block ${index + 1} attempts legacy execution fallback`)
      }
    }
  }

  const installer = installerSource ?? await readIfExists(installerPath)
  if (installer) {
    if (!installer.includes('CANONICAL_RUNTIME_UNAVAILABLE')) {
      issues.push('NO_SILENT_LEGACY_FALLBACK: installer generated hook template lacks the CANONICAL_RUNTIME_UNAVAILABLE fail-fast reason')
    }
    for (const marker of ['run-state.mjs', 'agent/start.mjs']) {
      if (installer.includes(marker)) {
        issues.push(`NO_SILENT_LEGACY_FALLBACK: installer references legacy execution artifact "${marker}"`)
      }
    }
  }

  const runModule = runSource ?? await readIfExists(runPath)
  if (runModule) {
    const specifiers = extractImportSpecifiers(runSource)
    for (const spec of specifiers) {
      if (spec.includes('runtime/agent') || spec.includes('agent/start.mjs') || spec.includes('run-state.mjs')) {
        issues.push(`NO_SILENT_LEGACY_FALLBACK: runtime/run.mjs imports legacy execution module (${spec})`)
      }
    }
  }

  return { ok: issues.length === 0, issues }
}

export async function checkControllerTerminalAuthority({ repoRoot }) {
  const issues = []
  const decisionPath = path.join(repoRoot, 'runtime', 'contracts', 'decision.mjs')
  const controllerPath = path.join(repoRoot, 'runtime', 'controller', 'controller.mjs')
  const pipelinePath = path.join(repoRoot, 'runtime', 'pipeline', 'pipeline.mjs')
  const runPath = path.join(repoRoot, 'runtime', 'run.mjs')

  const decision = await readIfExists(decisionPath)
  if (!decision) {
    issues.push('CONTROLLER_SOLE_TERMINAL_AUTHORITY: runtime/contracts/decision.mjs missing')
  } else {
    const states = extractFrozenArray(decision, 'TERMINAL_STATES')
    if (!states || states.join(',') !== REQUIRED_TERMINAL_STATES.join(',')) {
      issues.push(`CONTROLLER_SOLE_TERMINAL_AUTHORITY: terminal states must be exactly ${REQUIRED_TERMINAL_STATES.join(',')}`)
    }
    const nextRe = decision.match(/NEXT_PATHS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/)
    if (nextRe) {
      for (const [state, expected] of Object.entries(TERMINAL_NEXT_PATHS)) {
        const valueMatch = nextRe[1].match(new RegExp(`\\b${state}\\s*:\\s*'([^']+)'`))
        if (!valueMatch || valueMatch[1] !== expected) {
          issues.push(`CONTROLLER_SOLE_TERMINAL_AUTHORITY: terminal state ${state} must map to ${expected}`)
        }
      }
    } else {
      issues.push('CONTROLLER_SOLE_TERMINAL_AUTHORITY: NEXT_PATHS mapping missing')
    }
  }

  const controller = await readIfExists(controllerPath)
  if (!controller || !controller.includes('export function decide')) {
    issues.push('CONTROLLER_SOLE_TERMINAL_AUTHORITY: deterministic controller module missing decide()')
  } else {
    if (!controller.includes("import { evaluateReviews } from './review-decision.mjs'")) {
      issues.push('CONTROLLER_SOLE_TERMINAL_AUTHORITY: controller must aggregate reviews via review-decision')
    }
  }

  // The terminal decision must be produced from the controller only (never
  // from a worker/build outcome claim).
  const pipeline = await readIfExists(pipelinePath)
  if (pipeline) {
    if (!pipeline.includes('import { decide } from')) {
      issues.push('CONTROLLER_SOLE_TERMINAL_AUTHORITY: pipeline must import the deterministic controller')
    }
    if (!/createDecisionContract\(\{[\s\S]*?decision:\s*decision\.decision/.test(pipeline)) {
      issues.push('CONTROLLER_SOLE_TERMINAL_AUTHORITY: final decision must be created from the controller decision')
    }
  }

  const runSource = await readIfExists(runPath)
  if (runSource && !runSource.includes('validateDecision(result.decision)')) {
    issues.push('CONTROLLER_SOLE_TERMINAL_AUTHORITY: run.mjs must validate the controller decision contract')
  }

  return { ok: issues.length === 0, issues }
}

export async function checkPlanGateUnbypassable({ repoRoot }) {
  const issues = []
  const gatePath = path.join(repoRoot, 'runtime', 'controller', 'plan-gate.mjs')
  const pipelinePath = path.join(repoRoot, 'runtime', 'pipeline', 'pipeline.mjs')
  const controllerPath = path.join(repoRoot, 'runtime', 'controller', 'controller.mjs')

  const gate = await readIfExists(gatePath)
  if (!gate || !gate.includes('export function evaluatePlanGate')) {
    issues.push('PLAN_GATE_UNBYPASSABLE: runtime/controller/plan-gate.mjs missing evaluatePlanGate')
  }

  const pipeline = await readIfExists(pipelinePath)
  if (!pipeline) {
    issues.push('PLAN_GATE_UNBYPASSABLE: runtime/pipeline/pipeline.mjs missing')
  } else {
    if (!pipeline.includes("import { evaluatePlanGate } from '../controller/plan-gate.mjs'")) {
      issues.push('PLAN_GATE_UNBYPASSABLE: pipeline must import evaluatePlanGate')
    }
    if (!pipeline.includes('!planGate.approved')) {
      issues.push('PLAN_GATE_UNBYPASSABLE: build must be unreachable after a rejected plan gate')
    }
  }

  const controller = await readIfExists(controllerPath)
  if (controller && !controller.includes("'PLAN_GATE'")) {
    issues.push('PLAN_GATE_UNBYPASSABLE: controller must block on a rejected plan gate')
  }

  return { ok: issues.length === 0, issues }
}

export async function checkVerifyMandatory({ repoRoot }) {
  const issues = []
  const verifyPath = path.join(repoRoot, 'runtime', 'controller', 'verify.mjs')
  const pipelinePath = path.join(repoRoot, 'runtime', 'pipeline', 'pipeline.mjs')
  const controllerPath = path.join(repoRoot, 'runtime', 'controller', 'controller.mjs')

  const verify = await readIfExists(verifyPath)
  if (!verify || !verify.includes('export function runVerification')) {
    issues.push('VERIFY_MANDATORY: runtime/controller/verify.mjs missing runVerification')
  }

  const pipeline = await readIfExists(pipelinePath)
  if (pipeline && !pipeline.includes("import { runVerification } from '../controller/verify.mjs'")) {
    issues.push('VERIFY_MANDATORY: pipeline must import runVerification')
  }

  const controller = await readIfExists(controllerPath)
  if (controller) {
    if (!controller.includes('verification?.verification?.passed')) {
      issues.push('VERIFY_MANDATORY: controller must gate on verification result')
    }
    if (!controller.includes("reviews.length === 0") || !controller.includes("'REVIEWS_NOT_PERFORMED'")) {
      issues.push('VERIFY_MANDATORY: DONE must not be reachable without reviews after verify')
    }
  }

  return { ok: issues.length === 0, issues }
}

export async function checkRetryAuthorityCanonical({ repoRoot }) {
  const issues = []
  const retryPath = path.join(repoRoot, 'runtime', 'controller', 'retry-policy.mjs')
  const controllerPath = path.join(repoRoot, 'runtime', 'controller', 'controller.mjs')

  const retry = await readIfExists(retryPath)
  if (!retry || !retry.includes('export function evaluateRetry')) {
    issues.push('RETRY_AUTHORITY_CANONICAL: runtime/controller/retry-policy.mjs missing evaluateRetry')
  }

  const controller = await readIfExists(controllerPath)
  if (controller && !controller.includes("import { evaluateRetry } from './retry-policy.mjs'")) {
    issues.push('RETRY_AUTHORITY_CANONICAL: controller must be the only retry evaluator consumer')
  }

  // A second retry controller must not exist anywhere in the runtime surface.
  const surfaceDirs = ['runtime', '.opencode/plugins']
  for (const dir of surfaceDirs) {
    const abs = path.join(repoRoot, dir)
    if (!(await pathExists(abs))) continue
    const entries = await fs.readdir(abs, { recursive: true, withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue
      const fileAbs = path.join(entry.parentPath, entry.name)
      if (fileAbs.includes(path.join('controller', 'retry-policy.mjs'))) continue
      if (fileAbs.includes('.opencode') || fileAbs.includes('runtime')) {
        const source = await readIfExists(fileAbs)
        if (source && source.includes('evaluateRetry') && !fileAbs.endsWith('controller.mjs')) {
          issues.push(`RETRY_AUTHORITY_CANONICAL: retry evaluation escaped the controller (${normalizeSlash(path.relative(repoRoot, fileAbs))})`)
        }
      }
    }
  }

  return { ok: issues.length === 0, issues }
}

export async function checkSecurityHardBlock({ repoRoot }) {
  const issues = []
  const severityPath = path.join(repoRoot, 'runtime', 'controller', 'severity.mjs')
  const reviewDecisionPath = path.join(repoRoot, 'runtime', 'controller', 'review-decision.mjs')
  const controllerPath = path.join(repoRoot, 'runtime', 'controller', 'controller.mjs')

  const severity = await readIfExists(severityPath)
  if (!severity || !severity.includes('export function severityRank')) {
    issues.push('SECURITY_HARD_BLOCK: runtime/controller/severity.mjs missing severityRank')
  }

  const reviewDecision = await readIfExists(reviewDecisionPath)
  if (!reviewDecision) {
    issues.push('SECURITY_HARD_BLOCK: runtime/controller/review-decision.mjs missing')
  } else {
    if (!reviewDecision.includes('export function securityHardBlock')) {
      issues.push('SECURITY_HARD_BLOCK: security hard-block function missing')
    }
    if (!/blocking\s*===\s*true\s*&&\s*severityRank\([\s\S]*?\)\s*>=\s*severityRank\(['"]HIGH['"]\)/.test(reviewDecision)) {
      issues.push('SECURITY_HARD_BLOCK: blocking=true and severity>=HIGH must trigger the hard block')
    }
    if (/\b(majority|vote|override)\b/i.test(sanitizeForStructure(reviewDecision))) {
      issues.push('SECURITY_HARD_BLOCK: review aggregation must not use majority vote or worker override')
    }
  }

  if (!reviewDecision?.includes('BLOCKING_HIGH_OR_CRITICAL_FINDING')) {
    issues.push('SECURITY_HARD_BLOCK: hard block must map to the BLOCKING_HIGH_OR_CRITICAL_FINDING reason')
  }

  return { ok: issues.length === 0, issues }
}

export async function checkRunIdImmutable({ repoRoot }) {
  const issues = []
  const taskPath = path.join(repoRoot, 'runtime', 'contracts', 'task.mjs')
  const pipelinePath = path.join(repoRoot, 'runtime', 'pipeline', 'pipeline.mjs')
  const runPath = path.join(repoRoot, 'runtime', 'run.mjs')

  const task = await readIfExists(taskPath)
  if (!task || !/run_id\s*=\s*crypto\.randomUUID\(\)/.test(task || '')) {
    issues.push('RUN_ID_IMMUTABLE: task contract must create the run_id exactly once')
  }

  const pipeline = await readIfExists(pipelinePath)
  if (pipeline && !pipeline.includes('CONTRACT_INVALID')) {
    issues.push('RUN_ID_IMMUTABLE: pipeline must abort deterministically on run_id replacement')
  }

  const runSource = await readIfExists(runPath)
  if (runSource && !runSource.includes('normalizeTaskInput')) {
    issues.push('RUN_ID_IMMUTABLE: run.mjs must normalize the task (single run_id origin)')
  }

  return { ok: issues.length === 0, issues }
}

export async function checkFirstBadBoundaryStable({ repoRoot }) {
  const issues = []
  const fbbPath = path.join(repoRoot, 'runtime', 'controller', 'first-bad-boundary.mjs')
  const pipelinePath = path.join(repoRoot, 'runtime', 'pipeline', 'pipeline.mjs')
  const controllerPath = path.join(repoRoot, 'runtime', 'controller', 'controller.mjs')

  const fbb = await readIfExists(fbbPath)
  if (!fbb || !fbb.includes('export function firstBadBoundary')) {
    issues.push('FIRST_BAD_BOUNDARY_STABLE: runtime/controller/first-bad-boundary.mjs missing firstBadBoundary')
  }

  const pipeline = await readIfExists(pipelinePath)
  if (pipeline && !pipeline.includes('firstBadBoundary(phaseHistory)')) {
    issues.push('FIRST_BAD_BOUNDARY_STABLE: final decision must derive first_bad_boundary from the collapsed phase history')
  }

  const controller = await readIfExists(controllerPath)
  if (controller && !controller.includes('firstBadBoundary(boundaries)')) {
    issues.push('FIRST_BAD_BOUNDARY_STABLE: controller must retain the first bad boundary')
  }

  return { ok: issues.length === 0, issues }
}

const SECRET_PATTERNS = [
  { name: 'PEM private key', re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |)PRIVATE KEY-----/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
]

export async function checkNoSecretLeak({ repoRoot }) {
  const issues = []
  const scanDirs = ['runtime', '.opencode/plugins', 'scripts/lib', 'governance', 'scripts/install-governance.mjs']
  for (const rel of scanDirs) {
    const abs = path.join(repoRoot, rel)
    if (!(await pathExists(abs))) continue
    const stat = await fs.lstat(abs)
    if (stat.isFile()) {
      const text = await readIfExists(abs)
      if (text) checkTextForSecrets(text, rel, issues)
      continue
    }
    const entries = await fs.readdir(abs, { recursive: true, withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!/\.(mjs|js|json|jsonc|md|yaml|yml)$/.test(entry.name)) continue
      const fileAbs = path.join(entry.parentPath, entry.name)
      const text = await readIfExists(fileAbs)
      if (text) checkTextForSecrets(text, normalizeSlash(path.relative(repoRoot, fileAbs)), issues)
    }
  }
  return { ok: issues.length === 0, issues }
}

function checkTextForSecrets(text, rel, issues) {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(text)) {
      issues.push(`NO_SECRET_LEAK: high-confidence ${pattern.name} pattern in ${rel}`)
    }
  }
}

export async function checkWorkerSuccessNotTerminal({ repoRoot }) {
  const issues = []
  const controllerPath = path.join(repoRoot, 'runtime', 'controller', 'controller.mjs')
  const pipelinePath = path.join(repoRoot, 'runtime', 'pipeline', 'pipeline.mjs')

  const controller = await readIfExists(controllerPath)
  if (controller) {
    // DONE can only emerge when reviews pass AND verification passed.
    if (!controller.includes("reviewDecision.decision !== 'DONE'")) {
      issues.push('WORKER_SUCCESS_NOT_TERMINAL_EVIDENCE: controller must require a DONE review decision')
    }
    if (!controller.includes("terminal('DONE', 'ALL_HARD_GATES_GREEN'")) {
      issues.push('WORKER_SUCCESS_NOT_TERMINAL_EVIDENCE: DONE must be the hard-gates-green terminal')
    }
  }

  const pipeline = await readIfExists(pipelinePath)
  if (pipeline) {
    // The build worker outcome must never become the terminal decision.
    if (/decision:\s*['"]DONE['"]/.test(pipeline)) {
      issues.push('WORKER_SUCCESS_NOT_TERMINAL_EVIDENCE: pipeline must not hard-code a worker DONE')
    }
  }

  return { ok: issues.length === 0, issues }
}

export async function checkTestRunnerExhaustive({ repoRoot, manifest = null }) {
  const issues = []
  const manifestPath = path.join(repoRoot, 'test', 'test-manifest.json')
  const runnerPath = path.join(repoRoot, 'scripts', 'run-tests.mjs')
  const packagePath = path.join(repoRoot, 'package.json')

  const pkg = await readIfExists(packagePath)
  if (pkg) {
    let parsed = null
    try { parsed = JSON.parse(pkg) } catch { /* handled below */ }
    const testScript = parsed?.scripts?.test
    if (testScript !== 'node scripts/run-tests.mjs --all --reporter spec') {
      issues.push(`TEST_RUNNER_EXHAUSTIVE: npm test must be the canonical runner command (got "${testScript}")`)
    }
  }

  const manifestData = manifest ?? JSON.parse(await readIfExists(manifestPath) || 'null')
  if (!manifestData || manifestData.version !== 1 || !manifestData.groups || typeof manifestData.groups !== 'object') {
    issues.push('TEST_RUNNER_EXHAUSTIVE: test/test-manifest.json must be a version-1 group manifest')
  } else {
    const requiredGroups = ['unit', 'contract', 'integration', 'bootstrap', 'governance', 'e2e', 'provider_optional']
    for (const group of requiredGroups) {
      if (!Array.isArray(manifestData.groups[group])) {
        issues.push(`TEST_RUNNER_EXHAUSTIVE: manifest missing group "${group}"`)
      }
    }
    const seen = new Set()
    let nonEmpty = 0
    for (const [group, files] of Object.entries(manifestData.groups)) {
      if (!Array.isArray(files)) {
        issues.push(`TEST_RUNNER_EXHAUSTIVE: manifest group "${group}" must be an array`)
        continue
      }
      if (files.length > 0) nonEmpty += 1
      for (const file of files) {
        if (!/^test\/.+\.test\.mjs$/.test(file)) issues.push(`TEST_RUNNER_EXHAUSTIVE: manifest entry is not a test file: ${file}`)
        if (seen.has(file)) issues.push(`TEST_RUNNER_EXHAUSTIVE: duplicate manifest entry: ${file}`)
        seen.add(file)
        if (file.includes('/fixtures/') || file === 'test/helpers.mjs') {
          issues.push(`TEST_RUNNER_EXHAUSTIVE: fixture/helper must not be a manifest entry: ${file}`)
        }
        if (!(await pathExists(path.join(repoRoot, file)))) {
          issues.push(`TEST_RUNNER_EXHAUSTIVE: manifest test file missing: ${file}`)
        }
      }
    }
    if (nonEmpty === 0) issues.push('TEST_RUNNER_EXHAUSTIVE: manifest must declare at least one non-empty group')
  }

  const runner = await readIfExists(runnerPath)
  if (!runner) {
    issues.push('TEST_RUNNER_EXHAUSTIVE: scripts/run-tests.mjs missing')
  } else {
    if (!runner.includes('filesByGroup[group].length > 0')) {
      issues.push('TEST_RUNNER_EXHAUSTIVE: --all must execute all non-empty manifest groups')
    }
    if (!runner.includes('for (const group of groups)')) {
      issues.push('TEST_RUNNER_EXHAUSTIVE: runner must iterate all groups')
    }
    if (!runner.includes('--json')) {
      issues.push('TEST_RUNNER_EXHAUSTIVE: machine-readable --json aggregate must exist')
    }
    if (!/finalStatus\s*=\s*complete\s*&&\s*failedGroups\.length\s*===\s*0\s*&&\s*totals\.tests\s*>\s*0/.test(runner)) {
      issues.push('TEST_RUNNER_EXHAUSTIVE: final status must aggregate all groups at the end')
    }
    if (!/exitCode\s*=\s*finalStatus\s*===\s*['\"]PASS['\"]\s*\?\s*0\s*:\s*1/.test(runner)) {
      issues.push('TEST_RUNNER_EXHAUSTIVE: a real failure must produce a final nonzero exit')
    }
  }

  return { ok: issues.length === 0, issues }
}

export async function checkInstallerBaseline({ repoRoot, runtimeFileList = null }) {
  const issues = []
  const installerPath = path.join(repoRoot, 'scripts', 'install-governance.mjs')
  if (!(await pathExists(installerPath))) {
    issues.push('INSTALLER_SENTINEL: scripts/install-governance.mjs missing')
    return { ok: false, issues }
  }

  let list = runtimeFileList
  if (list === null) {
    try {
      const installer = await import(pathToFileURLFor(installerPath))
      list = installer.getRuntimeFileList?.() || []
    } catch (error) {
      issues.push(`INSTALLER_SENTINEL: cannot load getRuntimeFileList (${error instanceof Error ? error.message : String(error)})`)
      return { ok: false, issues }
    }
  }

  const dests = new Set(list.map((entry) => normalizeSlash(entry.dest || '')))
  for (const artifact of INSTALLER_REQUIRED_ARTIFACTS) {
    if (!dests.has(artifact)) {
      issues.push(`INSTALLER_SENTINEL: required runtime artifact absent from install set: ${artifact}`)
    }
  }
  for (const marker of ['run-state', 'agent/start']) {
    for (const entry of list) {
      const dest = normalizeSlash(entry.dest || '')
      if (dest.includes(marker)) {
        issues.push(`INSTALLER_SENTINEL: legacy execution artifact must not be installed: ${dest}`)
      }
    }
  }
  for (const entry of list) {
    if (!entry.source || !(await pathExists(path.join(repoRoot, entry.source)))) {
      issues.push(`INSTALLER_SENTINEL: installer source file missing: ${entry.source}`)
    }
  }

  const installer = await readIfExists(installerPath)
  if (installer && !/canonical-governance/i.test(installer)) {
    issues.push('INSTALLER_SENTINEL: installer must install the canonical governance plugin hook')
  }

  return { ok: issues.length === 0, issues }
}

export async function checkLinuxSymlinkInvariant({ repoRoot }) {
  const issues = []
  const validatorPath = path.join(repoRoot, 'scripts', 'validate-ecosystem.mjs')
  const validator = await readIfExists(validatorPath)
  if (!validator) {
    issues.push('LINUX_SYMLINK_INVARIANT: scripts/validate-ecosystem.mjs missing')
    return { ok: false, issues }
  }
  // The Windows EPERM mask may only ever apply on win32; a Linux EPERM must
  // stay a real failure.
  if (!/process\.platform\s*!==\s*['"]win32['"]/.test(validator)) {
    issues.push('LINUX_SYMLINK_INVARIANT: symlink capability gap must be gated to win32 (no Linux EPERM masking)')
  }
  return { ok: issues.length === 0, issues }
}

export async function checkValidatorTimeoutInvariant({ repoRoot }) {
  const issues = []
  const validatorPath = path.join(repoRoot, 'scripts', 'validate-ecosystem.mjs')
  const validator = await readIfExists(validatorPath)
  if (!validator) {
    issues.push('VALIDATOR_TIMEOUT_INVARIANT: scripts/validate-ecosystem.mjs missing')
    return { ok: false, issues }
  }
  if (!validator.includes('computeSuiteOuterTimeoutMs')) {
    issues.push('VALIDATOR_TIMEOUT_INVARIANT: manifest-aware outer timeout missing')
  }
  if (/timeout:\s*120000\b/.test(validator)) {
    issues.push('VALIDATOR_TIMEOUT_INVARIANT: hard 120s whole-suite timeout must not return')
  }
  return { ok: issues.length === 0, issues }
}

export async function checkBaselineManifest({ repoRoot, baselineManifest = null }) {
  const issues = []
  const manifestPath = path.join(repoRoot, DEFAULT_BASELINE_MANIFEST_PATH)
  let data = baselineManifest
  if (data === null) {
    try {
      data = JSON.parse(await readIfExists(manifestPath) || 'null')
    } catch {
      data = null
    }
  }
  if (!data) {
    issues.push('BASELINE_MANIFEST: runtime/production-baseline.json missing or unparseable')
    return { ok: false, issues }
  }
  if (data.baseline_version !== SENTINEL_VERSION) {
    issues.push(`BASELINE_MANIFEST: baseline_version must be ${SENTINEL_VERSION}`)
  }
  if (data.canonical_entry !== 'runtime/run.mjs') {
    issues.push('BASELINE_MANIFEST: canonical_entry must be runtime/run.mjs')
  }
  if (data.canonical_test_command !== CANONICAL_TEST_COMMAND) {
    issues.push(`BASELINE_MANIFEST: canonical_test_command must be "${CANONICAL_TEST_COMMAND}"`)
  }
  if (data.legacy_execution_status !== 'RETIRED') {
    issues.push('BASELINE_MANIFEST: legacy_execution_status must be RETIRED')
  }
  if (data.terminal_states?.join(',') !== REQUIRED_TERMINAL_STATES.join(',')) {
    issues.push('BASELINE_MANIFEST: terminal_states must match the canonical set')
  }
  for (const contract of REQUIRED_CONTRACT_IDS) {
    if (!(data.contracts || []).includes(contract)) {
      issues.push(`BASELINE_MANIFEST: required contract missing: ${contract}`)
    }
  }
  for (const invariant of SENTINEL_INVARIANTS) {
    if (!(data.critical_invariants || []).includes(invariant)) {
      issues.push(`BASELINE_MANIFEST: required critical invariant missing: ${invariant}`)
    }
  }
  return { ok: issues.length === 0, issues }
}

// ---------------------------------------------------------------------------
// MCP worker tool integration invariant checks (structural)
// ---------------------------------------------------------------------------

async function readRuntimeMcpSource(repoRoot, name) {
  return readIfExists(path.join(repoRoot, 'runtime', 'mcp', name))
}

export async function checkMcpRequiredCapabilityFailsClosed({ repoRoot }) {
  const issues = []
  const baseline = await readIfExists(path.join(repoRoot, 'runtime', 'baseline', 'capability-preflight.mjs'))
  if (!baseline || !baseline.includes('runMcpPreflight')) {
    issues.push('MCP_REQUIRED_CAPABILITY_FAILS_CLOSED: capability-preflight must run MCP preflight')
  }
  if (baseline && !/errors\.push\(`required mcp \$\{failure\.tool\}: \$\{failure\.code\}`\)/.test(baseline)) {
    issues.push('MCP_REQUIRED_CAPABILITY_FAILS_CLOSED: required MCP failure must fail the baseline')
  }
  const run = await readIfExists(path.join(repoRoot, 'runtime', 'run.mjs'))
  if (run && !run.includes("if (!baseline.approved)")) {
    issues.push('MCP_REQUIRED_CAPABILITY_FAILS_CLOSED: baseline failure must block the run')
  }
  const executor = await readRuntimeMcpSource(repoRoot, 'tool-executor.mjs')
  if (executor && !executor.includes('assertToolAllowed')) {
    issues.push('MCP_REQUIRED_CAPABILITY_FAILS_CLOSED: tool executor must enforce the grant before any call')
  }
  return { ok: issues.length === 0, issues }
}

export async function checkMcpToolScopeLeastPrivilege({ repoRoot }) {
  const issues = []
  const grant = await readRuntimeMcpSource(repoRoot, 'tool-grant.mjs')
  if (!grant) {
    issues.push('MCP_TOOL_SCOPE_LEAST_PRIVILEGE: runtime/mcp/tool-grant.mjs missing')
    return { ok: false, issues }
  }
  if (!grant.includes('resolveToolGrant')) issues.push('MCP_TOOL_SCOPE_LEAST_PRIVILEGE: resolveToolGrant missing')
  if (!grant.includes('assertToolAllowed')) issues.push('MCP_TOOL_SCOPE_LEAST_PRIVILEGE: call-time assertion missing')
  if (!grant.includes('MCP_TOOL_SCOPE_DENIED')) issues.push('MCP_TOOL_SCOPE_LEAST_PRIVILEGE: tool scope denial code missing')
  if (!grant.includes('MCP_SERVER_SCOPE_DENIED')) issues.push('MCP_TOOL_SCOPE_LEAST_PRIVILEGE: server scope denial code missing')
  const run = await readIfExists(path.join(repoRoot, 'runtime', 'run.mjs'))
  if (run && !run.includes('resolveToolGrant')) {
    issues.push('MCP_TOOL_SCOPE_LEAST_PRIVILEGE: canonical run must resolve the tool grant')
  }
  return { ok: issues.length === 0, issues }
}

export async function checkMcpToolResultNotTerminalAuthority({ repoRoot }) {
  const issues = []
  const executor = await readRuntimeMcpSource(repoRoot, 'tool-executor.mjs')
  if (!executor) {
    issues.push('MCP_TOOL_RESULT_NOT_TERMINAL_AUTHORITY: runtime/mcp/tool-executor.mjs missing')
    return { ok: false, issues }
  }
  // The executor may never emit a terminal decision as an authoritative result.
  if (/terminal\s*=\s*(['"]DONE['"]|['"]FIX['"]|['"]SPLIT['"]|['"]BLOCKED['"])/.test(executor)) {
    issues.push('MCP_TOOL_RESULT_NOT_TERMINAL_AUTHORITY: executor must not assign a terminal decision')
  }
  if (executor.includes('export function decide')) {
    issues.push('MCP_TOOL_RESULT_NOT_TERMINAL_AUTHORITY: executor must not implement a controller')
  }
  if (!executor.includes('mcp.tool-call.evidence.v1')) {
    issues.push('MCP_TOOL_RESULT_NOT_TERMINAL_AUTHORITY: tool calls must produce evidence records')
  }
  return { ok: issues.length === 0, issues }
}

export async function checkMcpToolCallBounded({ repoRoot }) {
  const issues = []
  const executor = await readRuntimeMcpSource(repoRoot, 'tool-executor.mjs')
  if (!executor) {
    issues.push('MCP_TOOL_CALL_BOUNDED: runtime/mcp/tool-executor.mjs missing')
    return { ok: false, issues }
  }
  if (!executor.includes('timeout_ms')) issues.push('MCP_TOOL_CALL_BOUNDED: tool calls must carry a bounded timeout')
  if (!executor.includes('MCP_TIMEOUT')) issues.push('MCP_TOOL_CALL_BOUNDED: timeout must be classified as MCP_TIMEOUT')
  if (!executor.includes('watchdog')) issues.push('MCP_TOOL_CALL_BOUNDED: a watchdog must bound the call')
  if (!executor.includes('duration_ms')) issues.push('MCP_TOOL_CALL_BOUNDED: duration must be observable')
  return { ok: issues.length === 0, issues }
}

export async function checkMcpToolObservability({ repoRoot }) {
  const issues = []
  const executor = await readRuntimeMcpSource(repoRoot, 'tool-executor.mjs')
  if (!executor) {
    issues.push('MCP_TOOL_OBSERVABILITY: runtime/mcp/tool-executor.mjs missing')
    return { ok: false, issues }
  }
  for (const marker of ['mcp.tool-call.start', 'mcp.tool-call.result', 'mcp.tool-call.failure']) {
    if (!executor.includes(marker)) issues.push(`MCP_TOOL_OBSERVABILITY: missing event marker ${marker}`)
  }
  if (!executor.includes('run_id')) issues.push('MCP_TOOL_OBSERVABILITY: tool calls must carry the run_id')
  const events = await readIfExists(path.join(repoRoot, 'runtime', 'observability', 'events.mjs'))
  if (events && !events.includes('mcp.tool-call.start')) {
    issues.push('MCP_TOOL_OBSERVABILITY: governance events must declare MCP tool-call events')
  }
  return { ok: issues.length === 0, issues }
}

export async function checkMcpNoSecretLeak({ repoRoot }) {
  const issues = []
  const executor = await readRuntimeMcpSource(repoRoot, 'tool-executor.mjs')
  if (!executor) {
    issues.push('MCP_NO_SECRET_LEAK: runtime/mcp/tool-executor.mjs missing')
    return { ok: false, issues }
  }
  if (!executor.includes('gateToolResult')) issues.push('MCP_NO_SECRET_LEAK: tool output must pass the secret egress gate')
  if (!executor.includes('knownSecrets')) issues.push('MCP_NO_SECRET_LEAK: executor must accept known secrets for redaction')
  if (!executor.includes('input_fingerprint')) issues.push('MCP_NO_SECRET_LEAK: inputs must be fingerprinted, not persisted raw')
  if (!executor.includes('output_fingerprint')) issues.push('MCP_NO_SECRET_LEAK: outputs must be fingerprinted, not persisted raw')
  return { ok: issues.length === 0, issues }
}

// ---------------------------------------------------------------------------
// Deterministic model routing invariant checks (structural)
// ---------------------------------------------------------------------------

async function readRoutingSource(repoRoot, name) {
  return readIfExists(path.join(repoRoot, 'runtime', 'routing', name))
}

export async function checkModelRoutingRuntimeAuthority({ repoRoot }) {
  const issues = []
  const policy = await readRoutingSource(repoRoot, 'routing-policy.mjs')
  if (!policy) {
    issues.push('MODEL_ROUTING_RUNTIME_AUTHORITY: runtime/routing/routing-policy.mjs missing')
    return { ok: false, issues }
  }
  const catalog = await readRoutingSource(repoRoot, 'model-catalog.mjs')
  if (!catalog) issues.push('MODEL_ROUTING_RUNTIME_AUTHORITY: runtime/routing/model-catalog.mjs missing')
  if (!policy.includes('selectRoute')) issues.push('MODEL_ROUTING_RUNTIME_AUTHORITY: selectRoute missing')
  if (!policy.includes('MODEL_SELECTION_AUTHORITY') || !policy.includes('DETERMINISTIC_RUNTIME_POLICY')) issues.push('MODEL_ROUTING_RUNTIME_AUTHORITY: deterministic runtime authority marker missing')
  const run = await readIfExists(path.join(repoRoot, 'runtime', 'run.mjs'))
  if (run && !run.includes('selectRoute')) issues.push('MODEL_ROUTING_RUNTIME_AUTHORITY: canonical run must wire the routing policy')
  if (run && !run.includes('routeSelectedEvent')) issues.push('MODEL_ROUTING_RUNTIME_AUTHORITY: route selection must be observable')
  return { ok: issues.length === 0, issues }
}

export async function checkWorkerCannotSelfSelectModel({ repoRoot }) {
  const issues = []
  const policy = await readRoutingSource(repoRoot, 'routing-policy.mjs')
  if (!policy) {
    issues.push('WORKER_CANNOT_SELF_SELECT_MODEL: runtime/routing/routing-policy.mjs missing')
    return { ok: false, issues }
  }
  if (!policy.includes('worker_requested_model')) issues.push('WORKER_CANNOT_SELF_SELECT_MODEL: worker model request must be inspected')
  if (!policy.includes("worker_self_selection: 'DENIED'")) issues.push('WORKER_CANNOT_SELF_SELECT_MODEL: worker self-selection must be DENIED')
  if (/worker_requested_model[^)]*provider\s*===\s*worker_requested_model/.test(policy) && !policy.includes('explicit_override')) {
    issues.push('WORKER_CANNOT_SELF_SELECT_MODEL: worker request must never bypass policy selection')
  }
  const run = await readIfExists(path.join(repoRoot, 'runtime', 'run.mjs'))
  if (run && !run.includes('WORKER_SELF_SELECTION_DENIED')) issues.push('WORKER_CANNOT_SELF_SELECT_MODEL: run must observe the denial')
  return { ok: issues.length === 0, issues }
}

export async function checkRetryEscalationSeparation({ repoRoot }) {
  const issues = []
  const pipeline = await readIfExists(path.join(repoRoot, 'runtime', 'pipeline', 'pipeline.mjs'))
  if (!pipeline) {
    issues.push('RETRY_ESCALATION_SEPARATION: runtime/pipeline/pipeline.mjs missing')
    return { ok: false, issues }
  }
  if (!pipeline.includes("intermediate.decision === 'RETRY'")) issues.push('RETRY_ESCALATION_SEPARATION: same-route retry path missing')
  if (!pipeline.includes('onWorkerFailure')) issues.push('RETRY_ESCALATION_SEPARATION: escalation seam missing')
  if (!pipeline.includes('providerFallbackEvent') || !pipeline.includes('escalationEvent')) {
    issues.push('RETRY_ESCALATION_SEPARATION: escalation and fallback must be distinct observable events')
  }
  const policy = await readRoutingSource(repoRoot, 'routing-policy.mjs')
  if (policy && !policy.includes('RETRY_SAME_MODEL')) issues.push('RETRY_ESCALATION_SEPARATION: retry action must be distinct from escalation')
  if (policy && !policy.includes('PROVIDER_FALLBACK')) issues.push('RETRY_ESCALATION_SEPARATION: provider fallback must be a distinct action')
  return { ok: issues.length === 0, issues }
}

export async function checkModelEscalationBounded({ repoRoot }) {
  const issues = []
  const policySource = await readRoutingSource(repoRoot, 'routing-policy.mjs')
  if (!policySource) {
    issues.push('MODEL_ESCALATION_BOUNDED: runtime/routing/routing-policy.mjs missing')
    return { ok: false, issues }
  }
  if (!policySource.includes('max_model_escalations')) issues.push('MODEL_ESCALATION_BOUNDED: max_model_escalations budget missing')
  if (!policySource.includes('max_provider_fallbacks')) issues.push('MODEL_ESCALATION_BOUNDED: max_provider_fallbacks budget missing')
  if (!policySource.includes('ROUTING_BUDGET_EXHAUSTED')) issues.push('MODEL_ESCALATION_BOUNDED: budget exhaustion must be a terminal class')
  const pipeline = await readIfExists(path.join(repoRoot, 'runtime', 'pipeline', 'pipeline.mjs'))
  if (pipeline && !pipeline.includes('escalationCount')) issues.push('MODEL_ESCALATION_BOUNDED: pipeline must track the escalation budget')
  if (pipeline && !pipeline.includes('fallbackCount')) issues.push('MODEL_ESCALATION_BOUNDED: pipeline must track the fallback budget')
  return { ok: issues.length === 0, issues }
}

export async function checkRoutingCapabilityCompatible({ repoRoot }) {
  const issues = []
  const policy = await readRoutingSource(repoRoot, 'routing-policy.mjs')
  if (!policy) {
    issues.push('ROUTING_CAPABILITY_COMPATIBLE: runtime/routing/routing-policy.mjs missing')
    return { ok: false, issues }
  }
  if (!policy.includes('modelMeetsRequirements')) issues.push('ROUTING_CAPABILITY_COMPATIBLE: capability compatibility filter missing')
  if (!policy.includes('needs_mcp') || !policy.includes('entry.mcp_support !== true')) {
    issues.push('ROUTING_CAPABILITY_COMPATIBLE: MCP capability must gate model selection')
  }
  if (!policy.includes('ROUTING_CAPABILITY_INCOMPATIBLE')) issues.push('ROUTING_CAPABILITY_COMPATIBLE: incompatible route must be rejected')
  const run = await readIfExists(path.join(repoRoot, 'runtime', 'run.mjs'))
  if (run && !run.includes('model.route.rejected')) issues.push('ROUTING_CAPABILITY_COMPATIBLE: rejection must be observable before worker invocation')
  return { ok: issues.length === 0, issues }
}

export async function checkRunIdStableAcrossModelRoute({ repoRoot }) {
  const issues = []
  const policy = await readRoutingSource(repoRoot, 'routing-policy.mjs')
  if (!policy) {
    issues.push('RUN_ID_STABLE_ACROSS_MODEL_ROUTE: runtime/routing/routing-policy.mjs missing')
    return { ok: false, issues }
  }
  if (!policy.includes('enforceRouteRunId')) issues.push('RUN_ID_STABLE_ACROSS_MODEL_ROUTE: run_id guard missing')
  if (!policy.includes('CONTRACT_INVALID')) issues.push('RUN_ID_STABLE_ACROSS_MODEL_ROUTE: run_id replacement must be CONTRACT_INVALID')
  const run = await readIfExists(path.join(repoRoot, 'runtime', 'run.mjs'))
  if (run && !run.includes('enforceRouteRunId(runId')) issues.push('RUN_ID_STABLE_ACROSS_MODEL_ROUTE: canonical run must enforce route run_id')
  const events = await readRoutingSource(repoRoot, 'routing-events.mjs')
  if (events && !events.includes('SAME run_id')) issues.push('RUN_ID_STABLE_ACROSS_MODEL_ROUTE: routing events must document run_id stability')
  return { ok: issues.length === 0, issues }
}

export async function checkMcpGrantStableAcrossModelRoute({ repoRoot }) {
  const issues = []
  const policy = await readRoutingSource(repoRoot, 'routing-policy.mjs')
  if (!policy) {
    issues.push('MCP_GRANT_STABLE_ACROSS_MODEL_ROUTE: runtime/routing/routing-policy.mjs missing')
    return { ok: false, issues }
  }
  if (!policy.includes('assertGrantStableAcrossRoute')) issues.push('MCP_GRANT_STABLE_ACROSS_MODEL_ROUTE: grant stability guard missing')
  if (!policy.includes('MCP_GRANT_STABLE_ACROSS_MODEL_ROUTE')) issues.push('MCP_GRANT_STABLE_ACROSS_MODEL_ROUTE: stability code missing')
  const grant = await readIfExists(path.join(repoRoot, 'runtime', 'mcp', 'tool-grant.mjs'))
  if (grant && !grant.includes('assertToolAllowed')) issues.push('MCP_GRANT_STABLE_ACROSS_MODEL_ROUTE: call-time tool scope assertion must stay in force')
  return { ok: issues.length === 0, issues }
}

export async function checkRoutingNoSecretLeak({ repoRoot }) {
  const issues = []
  const events = await readRoutingSource(repoRoot, 'routing-events.mjs')
  if (!events) {
    issues.push('ROUTING_NO_SECRET_LEAK: runtime/routing/routing-events.mjs missing')
    return { ok: false, issues }
  }
  if (!events.includes('redactFailureReason')) issues.push('ROUTING_NO_SECRET_LEAK: failure reasons must be redacted')
  const classifier = await readRoutingSource(repoRoot, 'failure-classifier.mjs')
  if (classifier && !classifier.includes('redactFailureReason')) issues.push('ROUTING_NO_SECRET_LEAK: classifier must provide redaction')
  for (const file of ['routing-policy.mjs', 'routing-events.mjs', 'model-catalog.mjs']) {
    const source = await readRoutingSource(repoRoot, file)
    if (!source) continue
    // Only flag real secret-bearing shapes, not harmless metadata labels like
    // auth_type: 'api_key'.
    const stripped = source.replace(/['"][^'"]*['"]/g, `"str"`).replace(/`[^`]*`/g, '`tpl`')
    if (/(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}|Authorization\s*:\s*(?:Bearer|Basic)|OAuth\s+(?:token|client_secret)|api[_-]?key\s*[:=]\s*["'][A-Za-z0-9._-]{12,}/i.test(stripped)) {
      issues.push(`ROUTING_NO_SECRET_LEAK: ${file} must not reference credential material`)
    }
  }
  return { ok: issues.length === 0, issues }
}

// ---------------------------------------------------------------------------
// Availability & cost governance invariant checks (structural)
// ---------------------------------------------------------------------------

export async function checkLiveAvailabilityRuntimeAuthority({ repoRoot, healthStateSource = null, runSource = null }) {
  const issues = []
  const healthState = healthStateSource ?? await readRoutingSource(repoRoot, 'health-state.mjs')
  if (!healthState) {
    issues.push('LIVE_AVAILABILITY_RUNTIME_AUTHORITY: runtime/routing/health-state.mjs missing')
    return { ok: false, issues }
  }
  for (const marker of ['HealthStore', 'applyProbeResult', 'RUNTIME_EVIDENCE']) {
    if (!healthState.includes(marker)) issues.push(`LIVE_AVAILABILITY_RUNTIME_AUTHORITY: health-state.mjs must contain ${marker}`)
  }
  if (healthState.includes('applyWorkerStatus')) {
    issues.push('LIVE_AVAILABILITY_RUNTIME_AUTHORITY: health-state.mjs must not expose a raw worker write path (applyWorkerStatus)')
  }
  const run = runSource ?? await readIfExists(path.join(repoRoot, 'runtime', 'run.mjs'))
  if (run && !run.includes('resolveCandidateHealth')) {
    issues.push('LIVE_AVAILABILITY_RUNTIME_AUTHORITY: canonical run must wire the probe pass (resolveCandidateHealth)')
  }
  return { ok: issues.length === 0, issues }
}

export async function checkHealthStateTtlBounded({ repoRoot, healthStateSource = null }) {
  const issues = []
  const source = healthStateSource ?? await readRoutingSource(repoRoot, 'health-state.mjs')
  if (!source) {
    issues.push('HEALTH_STATE_TTL_BOUNDED: runtime/routing/health-state.mjs missing')
    return { ok: false, issues }
  }
  for (const marker of ['HEALTH_TTL_BOUNDS', 'clampTtl', 'expires_at', 'TTL_EXPIRED']) {
    if (!source.includes(marker)) issues.push(`HEALTH_STATE_TTL_BOUNDED: health-state.mjs must contain ${marker}`)
  }
  return { ok: issues.length === 0, issues }
}

export async function checkUnknownModelProbedBeforeRoute({ repoRoot, runSource = null }) {
  const issues = []
  const run = runSource ?? await readIfExists(path.join(repoRoot, 'runtime', 'run.mjs'))
  if (!run) {
    issues.push('UNKNOWN_MODEL_PROBED_BEFORE_ROUTE: runtime/run.mjs missing')
    return { ok: false, issues }
  }
  if (!run.includes('resolveCandidateHealth')) issues.push('UNKNOWN_MODEL_PROBED_BEFORE_ROUTE: canonical run must run the probe pass')
  const probeIdx = run.indexOf('resolveCandidateHealth')
  const selectIdx = run.indexOf('selectRoute({')
  if (probeIdx === -1 || selectIdx === -1 || probeIdx >= selectIdx) {
    issues.push('UNKNOWN_MODEL_PROBED_BEFORE_ROUTE: probe pass must be ordered before route selection')
  }
  if (!run.includes('probeProviderModel') && !run.includes('probe_fn')) {
    issues.push('UNKNOWN_MODEL_PROBED_BEFORE_ROUTE: a real probe path (probeProviderModel / probe_fn) must be wired')
  }
  return { ok: issues.length === 0, issues }
}

export async function checkUnhealthyModelNotRouted({ repoRoot, routingPolicySource = null }) {
  const issues = []
  const policy = routingPolicySource ?? await readRoutingSource(repoRoot, 'routing-policy.mjs')
  if (!policy) {
    issues.push('UNHEALTHY_MODEL_NOT_ROUTED: runtime/routing/routing-policy.mjs missing')
    return { ok: false, issues }
  }
  if (!policy.includes('healthRoutable')) issues.push('UNHEALTHY_MODEL_NOT_ROUTED: healthRoutable gate missing')
  if (!policy.includes('NO_HEALTHY_ELIGIBLE_MODEL')) issues.push('UNHEALTHY_MODEL_NOT_ROUTED: fail-closed denial code missing')
  return { ok: issues.length === 0, issues }
}

export async function checkNoHealthyModelFailsClosed({ repoRoot, routingPolicySource = null }) {
  const issues = []
  const policy = routingPolicySource ?? await readRoutingSource(repoRoot, 'routing-policy.mjs')
  if (!policy) {
    issues.push('NO_HEALTHY_MODEL_FAILS_CLOSED: runtime/routing/routing-policy.mjs missing')
    return { ok: false, issues }
  }
  if (!policy.includes('NO_HEALTHY_ELIGIBLE_MODEL')) issues.push('NO_HEALTHY_MODEL_FAILS_CLOSED: fail-closed code missing')
  if (!policy.includes('no healthy eligible model')) issues.push('NO_HEALTHY_MODEL_FAILS_CLOSED: fail-closed reason missing')
  return { ok: issues.length === 0, issues }
}

export async function checkHealthProbeBounded({ repoRoot, healthProbeSource = null }) {
  const issues = []
  const source = healthProbeSource ?? await readRoutingSource(repoRoot, 'health-probe.mjs')
  if (!source) {
    issues.push('HEALTH_PROBE_BOUNDED: runtime/routing/health-probe.mjs missing')
    return { ok: false, issues }
  }
  for (const marker of ['max_probe_attempts', 'probe_timeout_ms', 'max_candidates_probed_per_route']) {
    if (!source.includes(marker)) issues.push(`HEALTH_PROBE_BOUNDED: health-probe.mjs must contain ${marker}`)
  }
  return { ok: issues.length === 0, issues }
}

export async function checkCostPolicyRuntimeAuthority({ repoRoot, routingPolicySource = null }) {
  const issues = []
  const policy = routingPolicySource ?? await readRoutingSource(repoRoot, 'routing-policy.mjs')
  if (!policy) {
    issues.push('COST_POLICY_RUNTIME_AUTHORITY: runtime/routing/routing-policy.mjs missing')
    return { ok: false, issues }
  }
  for (const marker of ['cost_policy', 'allow_cost_escalation']) {
    if (!policy.includes(marker)) issues.push(`COST_POLICY_RUNTIME_AUTHORITY: routing-policy.mjs must contain ${marker}`)
  }
  if (!policy.includes("worker_self_selection: 'DENIED'")) {
    issues.push('COST_POLICY_RUNTIME_AUTHORITY: worker self-selection must be DENIED')
  }
  if (!policy.includes('MODEL_SELECTION_AUTHORITY')) issues.push('COST_POLICY_RUNTIME_AUTHORITY: runtime selection authority marker missing')
  return { ok: issues.length === 0, issues }
}

export async function checkHighCostEscalationPolicyGated({ repoRoot, routingPolicySource = null }) {
  const issues = []
  const policy = routingPolicySource ?? await readRoutingSource(repoRoot, 'routing-policy.mjs')
  if (!policy) {
    issues.push('HIGH_COST_ESCALATION_POLICY_GATED: runtime/routing/routing-policy.mjs missing')
    return { ok: false, issues }
  }
  for (const marker of ['allow_high_cost_escalation', 'COST_GATE_DENIED', 'costGateAllows']) {
    if (!policy.includes(marker)) issues.push(`HIGH_COST_ESCALATION_POLICY_GATED: routing-policy.mjs must contain ${marker}`)
  }
  return { ok: issues.length === 0, issues }
}

export async function checkRoutingBudgetBounded({ repoRoot, routingPolicySource = null }) {
  const issues = []
  const policy = routingPolicySource ?? await readRoutingSource(repoRoot, 'routing-policy.mjs')
  if (!policy) {
    issues.push('ROUTING_BUDGET_BOUNDED: runtime/routing/routing-policy.mjs missing')
    return { ok: false, issues }
  }
  for (const marker of ['max_high_cost_routes', 'max_model_escalations', 'ROUTING_BUDGET_EXHAUSTED']) {
    if (!policy.includes(marker)) issues.push(`ROUTING_BUDGET_BOUNDED: routing-policy.mjs must contain ${marker}`)
  }
  return { ok: issues.length === 0, issues }
}

export async function checkUsageObservability({ repoRoot, usageSource = null, routingEventsSource = null }) {
  const issues = []
  const usage = usageSource ?? await readRoutingSource(repoRoot, 'usage.mjs')
  if (!usage) {
    issues.push('USAGE_OBSERVABILITY: runtime/routing/usage.mjs missing')
    return { ok: false, issues }
  }
  for (const marker of ['parseUsage', 'aggregateUsage', 'UNAVAILABLE']) {
    if (!usage.includes(marker)) issues.push(`USAGE_OBSERVABILITY: usage.mjs must contain ${marker}`)
  }
  const events = routingEventsSource ?? await readRoutingSource(repoRoot, 'routing-events.mjs')
  if (events) {
    if (!events.includes("'model.usage'")) issues.push("USAGE_OBSERVABILITY: routing-events.mjs must declare the 'model.usage' job")
    if (!events.includes('usageEvent')) issues.push('USAGE_OBSERVABILITY: routing-events.mjs must export usageEvent')
  }
  return { ok: issues.length === 0, issues }
}

export async function checkUsageNoSecretLeak({ repoRoot, usageSource = null, routingEventsSource = null }) {
  const issues = []
  const usage = usageSource ?? await readRoutingSource(repoRoot, 'usage.mjs')
  if (!usage) {
    issues.push('USAGE_NO_SECRET_LEAK: runtime/routing/usage.mjs missing')
    return { ok: false, issues }
  }
  if (!usage.includes('usageRedacted')) issues.push('USAGE_NO_SECRET_LEAK: usageRedacted must exist')
  if (!usage.includes('no prompts')) issues.push('USAGE_NO_SECRET_LEAK: usage.mjs must document that records carry no prompts/outputs')
  if (usage.includes('output: raw') || usage.includes('prompt: raw')) {
    issues.push('USAGE_NO_SECRET_LEAK: usage records must not emit raw prompt/output fields')
  }
  return { ok: issues.length === 0, issues }
}

// ---------------------------------------------------------------------------
// Baseline fingerprint — structural drift only, never file-byte drift
// ---------------------------------------------------------------------------

/**
 * Compute a structural fingerprint from stable runtime properties: contract
 * IDs, terminal states + next paths, invariant IDs, installer artifacts, and
 * non-empty manifest groups. Harmless text/formatting changes never drift the
 * fingerprint; removing/changing a contract, terminal state, invariant,
 * artifact, or manifest group does.
 */
export async function computeBaselineFingerprint({ repoRoot }) {
  const properties = {}

  const contractsDir = path.join(repoRoot, 'runtime', 'contracts')
  const contractIds = new Set()
  if (await pathExists(contractsDir)) {
    const entries = await fs.readdir(contractsDir)
    for (const file of entries) {
      if (!file.endsWith('.mjs')) continue
      const source = await readIfExists(path.join(contractsDir, file))
      if (source) for (const id of extractEcosystemIds(source)) contractIds.add(id)
    }
  }
  properties.contracts = [...contractIds].sort()

  const decisionSource = await readIfExists(path.join(repoRoot, 'runtime', 'contracts', 'decision.mjs')) || ''
  properties.terminal_states = (extractFrozenArray(decisionSource, 'TERMINAL_STATES') || []).sort()
  const nextMatch = decisionSource.match(/NEXT_PATHS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/)
  properties.terminal_next_paths = {}
  if (nextMatch) {
    for (const m of nextMatch[1].matchAll(/([A-Z]+)\s*:\s*'([^']+)'/g)) {
      properties.terminal_next_paths[m[1]] = m[2]
    }
  }

  properties.invariants = [...SENTINEL_INVARIANTS].sort()

  let installerArtifacts = []
  try {
    const installer = await import(pathToFileURLFor(path.join(repoRoot, 'scripts', 'install-governance.mjs')))
    installerArtifacts = (installer.getRuntimeFileList?.() || []).map((entry) => normalizeSlash(entry.dest || '')).sort()
  } catch { /* installer may be unavailable in a fixture — artifacts stay empty */ }
  properties.installer_artifacts = installerArtifacts

  const manifestPath = path.join(repoRoot, DEFAULT_TEST_MANIFEST_PATH)
  const groups = []
  try {
    const manifest = JSON.parse(await readIfExists(manifestPath) || 'null')
    if (manifest?.groups) {
      for (const [group, files] of Object.entries(manifest.groups)) {
        if (Array.isArray(files) && files.length > 0) groups.push(group)
      }
    }
  } catch { /* unreadable manifest — groups stay empty */ }
  properties.manifest_groups = groups.sort()

  const canonical = JSON.stringify(properties, Object.keys(properties).sort(), 0)
  const fingerprint = crypto.createHash('sha256').update(canonical).digest('hex')
  return { fingerprint, properties }
}

export async function checkBaselineFingerprint({ repoRoot, baselineManifest = null }) {
  const issues = []
  let data = baselineManifest
  if (data === null) {
    try {
      data = JSON.parse(await readIfExists(path.join(repoRoot, DEFAULT_BASELINE_MANIFEST_PATH)) || 'null')
    } catch {
      data = null
    }
  }
  if (!data?.baseline_fingerprint) {
    issues.push('BASELINE_FINGERPRINT: recorded fingerprint missing from runtime/production-baseline.json')
    return { ok: false, issues }
  }
  const { fingerprint } = await computeBaselineFingerprint({ repoRoot })
  if (fingerprint !== data.baseline_fingerprint) {
    issues.push('BASELINE_FINGERPRINT: structural fingerprint drift detected (contracts, terminal states, invariants, artifacts, or manifest groups changed)')
  }
  return { ok: fingerprint === data.baseline_fingerprint, issues }
}

// ---------------------------------------------------------------------------
// Aggregated sentinel run
// ---------------------------------------------------------------------------

export async function runProductionSentinel({ repoRoot }) {
  const results = []
  const pushResult = (name, result) => results.push({ invariant: name, ok: result.ok, issues: result.issues })

  pushResult('CANONICAL_RUNTIME_MANDATORY', await checkCanonicalRuntime({ repoRoot }))
  pushResult('NO_SILENT_LEGACY_FALLBACK', await checkNoSilentLegacyFallback({ repoRoot }))
  pushResult('CONTROLLER_SOLE_TERMINAL_AUTHORITY', await checkControllerTerminalAuthority({ repoRoot }))
  pushResult('PLAN_GATE_UNBYPASSABLE', await checkPlanGateUnbypassable({ repoRoot }))
  pushResult('VERIFY_MANDATORY', await checkVerifyMandatory({ repoRoot }))
  pushResult('RETRY_AUTHORITY_CANONICAL', await checkRetryAuthorityCanonical({ repoRoot }))
  pushResult('SECURITY_HARD_BLOCK', await checkSecurityHardBlock({ repoRoot }))
  pushResult('RUN_ID_IMMUTABLE', await checkRunIdImmutable({ repoRoot }))
  pushResult('FIRST_BAD_BOUNDARY_STABLE', await checkFirstBadBoundaryStable({ repoRoot }))
  pushResult('NO_SECRET_LEAK', await checkNoSecretLeak({ repoRoot }))
  pushResult('WORKER_SUCCESS_NOT_TERMINAL_EVIDENCE', await checkWorkerSuccessNotTerminal({ repoRoot }))
  pushResult('MCP_REQUIRED_CAPABILITY_FAILS_CLOSED', await checkMcpRequiredCapabilityFailsClosed({ repoRoot }))
  pushResult('MCP_TOOL_SCOPE_LEAST_PRIVILEGE', await checkMcpToolScopeLeastPrivilege({ repoRoot }))
  pushResult('MCP_TOOL_RESULT_NOT_TERMINAL_AUTHORITY', await checkMcpToolResultNotTerminalAuthority({ repoRoot }))
  pushResult('MCP_TOOL_CALL_BOUNDED', await checkMcpToolCallBounded({ repoRoot }))
  pushResult('MCP_TOOL_OBSERVABILITY', await checkMcpToolObservability({ repoRoot }))
  pushResult('MCP_NO_SECRET_LEAK', await checkMcpNoSecretLeak({ repoRoot }))
  pushResult('MODEL_ROUTING_RUNTIME_AUTHORITY', await checkModelRoutingRuntimeAuthority({ repoRoot }))
  pushResult('WORKER_CANNOT_SELF_SELECT_MODEL', await checkWorkerCannotSelfSelectModel({ repoRoot }))
  pushResult('RETRY_ESCALATION_SEPARATION', await checkRetryEscalationSeparation({ repoRoot }))
  pushResult('MODEL_ESCALATION_BOUNDED', await checkModelEscalationBounded({ repoRoot }))
  pushResult('ROUTING_CAPABILITY_COMPATIBLE', await checkRoutingCapabilityCompatible({ repoRoot }))
  pushResult('RUN_ID_STABLE_ACROSS_MODEL_ROUTE', await checkRunIdStableAcrossModelRoute({ repoRoot }))
  pushResult('MCP_GRANT_STABLE_ACROSS_MODEL_ROUTE', await checkMcpGrantStableAcrossModelRoute({ repoRoot }))
  pushResult('ROUTING_NO_SECRET_LEAK', await checkRoutingNoSecretLeak({ repoRoot }))
  pushResult('CONTRACT_SENTINEL', await checkContractIds({ repoRoot }))
  pushResult('TEST_RUNNER_EXHAUSTIVE', await checkTestRunnerExhaustive({ repoRoot }))
  pushResult('INSTALLER_SENTINEL', await checkInstallerBaseline({ repoRoot }))
  pushResult('LINUX_SYMLINK_INVARIANT', await checkLinuxSymlinkInvariant({ repoRoot }))
  pushResult('VALIDATOR_TIMEOUT_INVARIANT', await checkValidatorTimeoutInvariant({ repoRoot }))
  pushResult('BASELINE_MANIFEST', await checkBaselineManifest({ repoRoot }))
  pushResult('BASELINE_FINGERPRINT', await checkBaselineFingerprint({ repoRoot }))
  // Availability & cost governance invariants (additive, after the 32 baseline)
  pushResult('LIVE_AVAILABILITY_RUNTIME_AUTHORITY', await checkLiveAvailabilityRuntimeAuthority({ repoRoot }))
  pushResult('HEALTH_STATE_TTL_BOUNDED', await checkHealthStateTtlBounded({ repoRoot }))
  pushResult('UNKNOWN_MODEL_PROBED_BEFORE_ROUTE', await checkUnknownModelProbedBeforeRoute({ repoRoot }))
  pushResult('UNHEALTHY_MODEL_NOT_ROUTED', await checkUnhealthyModelNotRouted({ repoRoot }))
  pushResult('NO_HEALTHY_MODEL_FAILS_CLOSED', await checkNoHealthyModelFailsClosed({ repoRoot }))
  pushResult('HEALTH_PROBE_BOUNDED', await checkHealthProbeBounded({ repoRoot }))
  pushResult('COST_POLICY_RUNTIME_AUTHORITY', await checkCostPolicyRuntimeAuthority({ repoRoot }))
  pushResult('HIGH_COST_ESCALATION_POLICY_GATED', await checkHighCostEscalationPolicyGated({ repoRoot }))
  pushResult('ROUTING_BUDGET_BOUNDED', await checkRoutingBudgetBounded({ repoRoot }))
  pushResult('USAGE_OBSERVABILITY', await checkUsageObservability({ repoRoot }))
  pushResult('USAGE_NO_SECRET_LEAK', await checkUsageNoSecretLeak({ repoRoot }))

  const issues = results.flatMap((result) => result.issues)
  const warnings = []
  const status = issues.length === 0 ? 'PASS' : 'FAIL'
  return { status, issues, warnings, results, fingerprint: null }
}

function pathToFileURLFor(filePath) {
  return pathToFileURL(filePath)
}
