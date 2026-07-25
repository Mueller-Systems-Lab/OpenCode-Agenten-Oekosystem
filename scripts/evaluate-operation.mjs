#!/usr/bin/env node
/**
 * Stable Spec-Kit operation bridge.
 *
 * This module deliberately contains no gate policy. It validates the bridge
 * input, delegates to the canonical evaluator, and normalizes its result for
 * Spec-Kit consumers. The kernel remains authoritative.
 */
import { existsSync, lstatSync, realpathSync, statSync, writeSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { evaluateAllGates, CLASSIFICATIONS, KNOWN_RUNTIMES } from './lib/gates/evaluate-all.mjs';
import * as opencodeAdapter from './lib/runtimes/opencode.mjs';
import { redactValue, safeRedactText, safeSerialize, secretValuesFromEnv } from './lib/security/redaction.mjs';

const EXIT_CODES = Object.freeze({
  GREEN_SAFE: 0,
  AMBER_REVIEW: 10,
  TOOL_GAP: 20,
  RED_BLOCK: 30,
  INVALID_INPUT: 40,
  INTERNAL_ERROR: 50
});

const PHASES = Object.freeze([
  'reality', 'route', 'before-implement', 'after-implement',
  'verify', 'close', 'runtime-smoke', 'bootstrap'
]);
const RISK_TIERS = Object.freeze(['LOW_LOCAL', 'MEDIUM_REVIEW', 'HIGH_HUMAN_GATE', 'CRITICAL_BLOCK']);
const REDACTION_OPTIONS = Object.freeze({ secrets: secretValuesFromEnv() });

function redact(value) {
  return redactValue(value, REDACTION_OPTIONS);
}

class InvalidInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

function parseArgs(argv) {
  const out = {
    project: null,
    phase: null,
    runtime: null,
    action: 'evaluate',
    riskTier: 'MEDIUM_REVIEW',
    json: false,
    dryRun: true,
    approvalFile: null,
    evidenceFile: null,
    projectPolicy: null,
    command: null,
    writePaths: [],
    scope: [],
    agentRole: null,
    help: false
  };
  const takesValue = new Set([
    '--project', '--phase', '--runtime', '--action', '--risk-tier',
    '--approval-file', '--evidence-file', '--project-policy', '--command',
    '--write-path', '--scope', '--agent-role'
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') { out.json = true; continue; }
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (arg === '--apply') { out.dryRun = false; continue; }
    if (arg === '--help' || arg === '-h') { out.help = true; continue; }
    if (!takesValue.has(arg)) throw new InvalidInputError(`Unknown argument: ${arg}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new InvalidInputError(`Missing value for ${arg}`);
    if (arg === '--write-path') out.writePaths.push(value);
    else if (arg === '--scope') out.scope.push(value);
    else out[{ '--project': 'project', '--phase': 'phase', '--runtime': 'runtime', '--action': 'action', '--risk-tier': 'riskTier', '--approval-file': 'approvalFile', '--evidence-file': 'evidenceFile', '--project-policy': 'projectPolicy', '--command': 'command', '--agent-role': 'agentRole' }[arg]] = value;
  }
  return out;
}

function assertSafeProject(project) {
  if (!project || !isAbsolute(project)) throw new InvalidInputError('--project must be an absolute path');
  if (!existsSync(project) || !statSync(project).isDirectory()) throw new InvalidInputError('Project directory does not exist');
  const projectStat = lstatSync(project);
  if (projectStat.isSymbolicLink()) throw new InvalidInputError('Project root must not be a symlink');
  const canonical = realpathSync(project);
  if (canonical !== resolve(project)) throw new InvalidInputError('Project root canonicalization mismatch');
  return canonical;
}

function assertSafePath(pathValue, projectRoot, label) {
  if (!isAbsolute(pathValue)) throw new InvalidInputError(`${label} must be an absolute path`);
  const canonical = existsSync(pathValue) ? realpathSync(pathValue) : resolve(pathValue);
  const rel = relative(projectRoot, canonical);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new InvalidInputError(`${label} escapes project scope`);
  return canonical;
}

function validateArgs(args) {
  if (!args.project || !args.phase || !args.runtime) throw new InvalidInputError('--project, --phase and --runtime are required');
  if (!PHASES.includes(args.phase)) throw new InvalidInputError(`Unknown phase: ${args.phase}`);
  if (!KNOWN_RUNTIMES.includes(args.runtime)) throw new InvalidInputError(`Unknown runtime: ${args.runtime}`);
  if (!RISK_TIERS.includes(args.riskTier)) throw new InvalidInputError(`Unknown risk tier: ${args.riskTier}`);
  const projectRoot = assertSafeProject(args.project);
  for (const writePath of args.writePaths) assertSafePath(writePath, projectRoot, 'write path');
  for (const optional of ['approvalFile', 'evidenceFile', 'projectPolicy']) {
    if (args[optional]) assertSafePath(args[optional], projectRoot, optional);
  }
  return projectRoot;
}

function normalizeDecision(decision, args, classification, exitCode, overrides = {}) {
  return redactValue({
    schema_version: '1.0',
    classification,
    allowed: classification === CLASSIFICATIONS.GREEN_SAFE,
    phase: args.phase,
    runtime: decision?.runtime || args.runtime,
    risk_tier: decision?.riskTier || args.riskTier,
    verification_level: decision?.verificationLevel || 'FAILED',
    blocked_by: decision?.blockedBy || [],
    required_approvals: decision?.requiredApprovals || [],
    consumed_approvals: decision?.consumedApprovals || [],
    required_evidence: decision?.requiredEvidence || [],
    present_evidence: decision?.presentEvidence || [],
    warnings: decision?.warnings || [],
    tool_gaps: decision?.toolGaps || [],
    decision_timestamp: new Date().toISOString(),
    exit_code: exitCode,
    ...overrides
  }, REDACTION_OPTIONS);
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/evaluate-operation.mjs --project <absolute-path> --phase <phase> --runtime <runtime> [options]\n\nPhases: ${PHASES.join(', ')}\nRuntimes: ${KNOWN_RUNTIMES.join(', ')}\nExit codes: 0 GREEN_SAFE, 10 AMBER_REVIEW, 20 TOOL_GAP, 30 RED_BLOCK, 40 INVALID_INPUT, 50 INTERNAL_ERROR\n`);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help) { printHelp(); return 0; }
    const projectRoot = validateArgs(args);
    const decision = await evaluateAllGates({
      targetRoot: projectRoot,
      runtime: args.runtime,
      action: args.action,
      riskTier: args.riskTier,
      dryRun: args.dryRun,
      approvalFile: args.approvalFile,
      evidenceFile: args.evidenceFile,
      projectPolicyFile: args.projectPolicy,
      command: args.command,
      writePaths: args.writePaths,
      agentRole: args.agentRole,
      worktreeRoot: projectRoot,
      enforcementContext: { phase: args.phase, scope: args.scope }
    });
    let smoke = null;
    if (args.phase === 'runtime-smoke') {
      if (args.runtime !== 'opencode') {
        smoke = { passed: false, toolGaps: ['RUNTIME_ADAPTER_NOT_IMPLEMENTED'] };
      } else {
        smoke = await opencodeAdapter.runtimeSmoke({ targetRoot: projectRoot, runtime: args.runtime });
      }
    }
    const classification = smoke?.toolGaps?.length
      ? CLASSIFICATIONS.TOOL_GAP
      : smoke && !smoke.passed
        ? CLASSIFICATIONS.RED_BLOCK
        : Object.values(CLASSIFICATIONS).includes(decision.classification)
      ? decision.classification : CLASSIFICATIONS.RED_BLOCK;
    const exitCode = EXIT_CODES[classification] ?? EXIT_CODES.INTERNAL_ERROR;
    await emitJson(normalizeDecision(decision, args, classification, exitCode, smoke ? {
      verification_level: smoke.passed ? 'RUNTIME_SMOKE_PASS' : 'TOOL_GAP',
      tool_gaps: smoke.toolGaps || [],
      warnings: [...(decision.warnings || []), ...(smoke.failures || [])],
      present_evidence: smoke.passed ? ['runtime_smoke'] : []
    } : {}));
    return exitCode;
  } catch (error) {
    const fallback = {
      schema_version: '1.0',
      classification: CLASSIFICATIONS.RED_BLOCK,
      allowed: false,
      phase: args?.phase || null,
      runtime: args?.runtime || null,
      risk_tier: args?.riskTier || null,
      verification_level: 'FAILED',
      blocked_by: [{ code: 'BRIDGE_FAILURE', message: 'Bridge rejected the operation.' }],
      required_approvals: [], consumed_approvals: [], required_evidence: [], present_evidence: [],
      warnings: [], tool_gaps: [], decision_timestamp: new Date().toISOString(),
      exit_code: error instanceof InvalidInputError ? EXIT_CODES.INVALID_INPUT : EXIT_CODES.INTERNAL_ERROR
    };
    writeSync(2, `${safeRedactText(error?.message || 'Bridge rejected the operation.', REDACTION_OPTIONS)}\n`);
    await emitJson(fallback);
    return fallback.exit_code;
  }
}

function emitJson(value) {
  writeSync(1, `${safeSerialize(value, REDACTION_OPTIONS)}\n`);
}

const exitCode = await main();
process.exitCode = exitCode;

export { EXIT_CODES, PHASES, redact, assertSafeProject, assertSafePath };
