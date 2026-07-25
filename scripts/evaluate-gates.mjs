#!/usr/bin/env node
/**
 * evaluate-gates.mjs — Runtime-Neutral Gate Evaluation CLI
 *
 * Thin CLI wrapper around the canonical evaluateAllGates() entry point.
 * All gate evaluation logic lives in scripts/lib/gates/evaluate-all.mjs.
 *
 * Usage:
 *   node scripts/evaluate-gates.mjs --target /path/to/project --runtime auto --action apply
 *   node scripts/evaluate-gates.mjs --target . --runtime odysseus --action push --dry-run
 *   node scripts/evaluate-gates.mjs --target . --runtime auto --json
 *
 * Exit codes:
 *   0 = GREEN_SAFE
 *   1 = AMBER_REVIEW or TOOL_GAP
 *   2 = RED_BLOCK
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { evaluateAllGates, CLASSIFICATIONS, VERIFICATION_LEVELS, classificationToExitCode, VALID_ACTIONS, KNOWN_RUNTIMES } from './lib/gates/evaluate-all.mjs';
import { safeRedactText, safeSerialize, secretValuesFromEnv } from './lib/security/redaction.mjs';

// ── CLI Argument Parsing ──────────────────────────────────────────

function parseArgs(args) {
  const parsed = {
    target: process.cwd(),
    runtime: 'auto',
    action: 'evaluate',
    riskTier: 'MEDIUM_REVIEW',
    dryRun: true,
    json: false,
    approvalFile: null,
    evidenceFile: null,
    projectPolicy: null,
    command: null,
    writePaths: [],
    agentRole: null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--target':
        parsed.target = args[++i] || parsed.target;
        break;
      case '--runtime':
        parsed.runtime = args[++i] || 'auto';
        break;
      case '--action':
        parsed.action = args[++i] || 'evaluate';
        break;
      case '--risk-tier':
        parsed.riskTier = args[++i] || 'MEDIUM_REVIEW';
        break;
      case '--apply':
        parsed.dryRun = false;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--approval-file':
        parsed.approvalFile = args[++i];
        break;
      case '--evidence-file':
        parsed.evidenceFile = args[++i];
        break;
      case '--project-policy':
        parsed.projectPolicy = args[++i];
        break;
      case '--command':
        parsed.command = args[++i];
        break;
      case '--write-path':
        parsed.writePaths.push(args[++i]);
        break;
      case '--agent-role':
        parsed.agentRole = args[++i];
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`evaluate-gates.mjs — Runtime-Neutral Gate Evaluation CLI

Usage:
  node scripts/evaluate-gates.mjs [options]

Options:
  --target <path>      Target project root (default: current directory)
  --runtime <runtime>  Runtime adapter: auto, generic, opencode, hermes, odysseus (default: auto)
  --action <action>    Action to evaluate: apply, push, commit, merge, deploy (default: evaluate)
  --risk-tier <tier>   Risk tier: LOW_LOCAL, MEDIUM_REVIEW, HIGH_HUMAN_GATE, CRITICAL_BLOCK
  --apply              Execute (default is dry-run)
  --dry-run            Dry-run mode (default)
  --json               Output JSON decision object
  --approval-file <f>  Path to approval receipt JSON
  --evidence-file <f>  Path to evidence collection JSON
  --project-policy <f> Path to project-level gate policy JSON
  --command <cmd>      The command being evaluated (for kernel checks)
  --write-path <p>     Path being written to (repeatable)
  --agent-role <role>  Agent role for comment policy
  --help, -h           Show this help

Exit Codes:
  0  GREEN_SAFE — all gates passed
  1  AMBER_REVIEW or TOOL_GAP — review required
  2  RED_BLOCK — kernel gate violation`);

  console.log(`\nValid Actions: ${[...new Set([...VALID_ACTIONS, 'evaluate', 'review', 'validate', 'check', 'scan'])].sort().join(', ')}`);
  console.log(`Known Runtimes: ${KNOWN_RUNTIMES.join(', ')}`);
}

// ── Output Helpers ────────────────────────────────────────────────

function printHumanReadable(decision) {
  const {
    classification, runtime, verificationLevel, allowed, action,
    riskTier, blockedBy, requiredApprovals, consumedApprovals,
    warnings, toolGaps, exitCode, adapterSelection, handoff,
    approvalIssues, evidenceValidation
  } = decision;

  console.log(`\n═══ Gate Evaluation ═══`);
  console.log(`Target:   ${decision.targetRoot}`);
  console.log(`Runtime:  ${adapterSelection.detectedAs} (confidence: ${adapterSelection.confidence}%)`);
  console.log(`Action:   ${action}`);
  console.log(`Tier:     ${riskTier}`);
  console.log(`Mode:     ${decision.metadata?.dryRun !== false ? 'DRY-RUN' : 'APPLY'}`);
  console.log('');

  // Runtime detections
  if (adapterSelection.allDetections && adapterSelection.allDetections.length > 0) {
    console.log('Runtime Detections:');
    for (const d of adapterSelection.allDetections) {
      const icon = d.confidence >= 80 ? '✓' : d.confidence >= 50 ? '~' : '✗';
      console.log(`  ${icon} ${d.name}: ${d.confidence}%`);
    }
    console.log('');
  }

  // Kernel override detection
  if (decision.metadata?.kernelOverrideDetected) {
    console.log('⚠️  Adapter Kernel Override Detected:');
    for (const override of (decision.metadata.kernelOverrides || [])) {
      console.log(`    ❌ ${override.type || 'UNKNOWN'}: ${override.message || 'adapter override detected'}`);
    }
  }

  // Kernel Gates
  console.log(`Kernel Gates:          ${decision.metadata?.kernelResult?.passedGateCount || '?'}/${decision.metadata?.kernelResult?.kernelGateCount || '?'} passed`);
  if (blockedBy.some(b => b.layer === 'kernel')) {
    console.log('  BLOCKED by kernel gate(s):');
    for (const b of blockedBy.filter(b => b.layer === 'kernel')) {
      console.log(`    ❌ ${b.gateId || b.code}: ${b.message}`);
    }
  } else {
    console.log('  ✅ All kernel gates passed.');
  }

  // Policy Gates
  if (blockedBy.some(b => b.layer === 'policy')) {
    console.log(`\nPolicy Gates: BLOCKED`);
    for (const b of blockedBy.filter(b => b.layer === 'policy')) {
      console.log(`    ❌ ${b.code}: ${b.message}`);
    }
  }

  // Project Gates
  if (blockedBy.some(b => b.layer === 'project')) {
    console.log(`\nProject Gates: BLOCKED`);
    for (const b of blockedBy.filter(b => b.layer === 'project')) {
      console.log(`    ❌ ${b.code}: ${b.message}`);
    }
  }

  // Runtime Adapter
  console.log(`\nRuntime Adapter (${adapterSelection.detectedAs}):`);
  console.log(`  Classification:       ${classification}`);
  console.log(`  Verification:         ${verificationLevel}`);

  if (warnings && warnings.length > 0) {
    console.log(`  Warnings:             ${warnings.length}`);
    for (const w of warnings.slice(0, 5)) {
      console.log(`    ⚠️  ${w}`);
    }
  }

  const adapterBlocks = blockedBy.filter(b => b.layer !== 'kernel' && b.layer !== 'policy' && b.layer !== 'project');
  if (adapterBlocks.length > 0) {
    console.log(`  Blocked By:`);
    for (const b of adapterBlocks) {
      console.log(`    ❌ [${b.layer}] ${b.message}`);
    }
  }

  // Handoff (for Odysseus/generic)
  if (handoff) {
    console.log(`\nHandoff (${adapterSelection.detectedAs}):`);
    if (handoff.canGenerate) {
      console.log(`  Type:                 ${handoff.handoffType || 'N/A'}`);
      console.log(`  Native Integration:   ${handoff.nativeIntegration !== undefined ? handoff.nativeIntegration : 'N/A'}`);
      if (handoff.artifacts) {
        console.log(`  Artifacts:            ${handoff.artifacts.length}`);
        for (const a of handoff.artifacts.slice(0, 5)) {
          console.log(`    📄 ${a.path} (${a.type})`);
        }
      }
      if (handoff.notes) {
        for (const n of handoff.notes) {
          console.log(`    ℹ️  ${n}`);
        }
      }
    } else {
      console.log(`  Status:               Cannot generate handoff`);
    }
  }

  // Approvals
  if (requiredApprovals.length > 0) {
    console.log(`\nRequired Approvals:    ${requiredApprovals.length}`);
    for (const ra of requiredApprovals) {
      console.log(`    🔒 ${ra.type}${ra.gate ? ` (gate: ${ra.gate})` : ''}`);
    }
  }
  if (consumedApprovals && consumedApprovals.length > 0) {
    console.log(`Consumed Approvals:    ${consumedApprovals.length}`);
    for (const ca of consumedApprovals) {
      console.log(`    ✓ ${ca.action} (nonce: ${ca.nonce?.substring(0, 8)}...)`);
    }
  }
  if (approvalIssues && approvalIssues.length > 0) {
    console.log(`Approval Issues:       ${approvalIssues.length}`);
    for (const ai of approvalIssues.slice(0, 5)) {
      const issueDesc = ai.issues?.map(i => i.issue || i.message).join(', ') || 'unknown';
      console.log(`    ❌ nonce=${ai.nonce?.substring(0, 8)}...: ${issueDesc}`);
    }
  }

  // Evidence
  if (evidenceValidation && !evidenceValidation.valid) {
    console.log(`\nEvidence:             INCOMPLETE`);
    console.log(`    Missing: ${(evidenceValidation.missing || []).join(', ')}`);
  }

  // Tool Gaps
  if (toolGaps.length > 0) {
    console.log(`\nTool Gaps:             ${toolGaps.length}`);
    for (const tg of toolGaps) {
      console.log(`    🔧 ${tg}`);
    }
  }

  // Final Decision
  console.log(`\n═══ Decision ═══`);
  const icon = classification === CLASSIFICATIONS.GREEN_SAFE ? '✅' :
               classification === CLASSIFICATIONS.AMBER_REVIEW ? '⚠️' :
               classification === CLASSIFICATIONS.TOOL_GAP ? '🔧' : '🚫';
  console.log(`  ${icon} Classification:   ${classification}`);
  console.log(`  Allowed:              ${allowed}`);
  console.log(`  Verification:         ${verificationLevel}`);
  console.log(`  Exit Code:            ${exitCode}`);
  console.log('');
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const targetRoot = resolve(args.target);
  if (!existsSync(targetRoot)) {
    console.error(`Target directory does not exist: ${targetRoot}`);
    process.exit(2);
  }

  // Validate action
  const VALID_CLI_ACTIONS = new Set([
    ...VALID_ACTIONS, 'evaluate', 'review', 'validate', 'check', 'scan'
  ]);
  if (!VALID_CLI_ACTIONS.has(args.action)) {
    console.error(`Invalid action: "${args.action}". Valid actions: ${[...VALID_CLI_ACTIONS].sort().join(', ')}`);
    process.exit(2);
  }

  // Delegate to canonical evaluator
  const decision = await evaluateAllGates({
    targetRoot,
    runtime: args.runtime,
    action: args.action,
    riskTier: args.riskTier,
    dryRun: args.dryRun,
    approvalFile: args.approvalFile,
    evidenceFile: args.evidenceFile,
    projectPolicyFile: args.projectPolicy,
    command: args.command,
    writePaths: args.writePaths,
    agentRole: args.agentRole
  });

  // Output
  if (args.json) {
    console.log(safeSerialize(decision, { secrets: secretValuesFromEnv() }));
  } else {
    printHumanReadable(decision);
  }

  process.exit(decision.exitCode);
}

main().catch(err => {
  console.error('FATAL:', safeRedactText(err?.message || err, { secrets: secretValuesFromEnv() }));
  process.exit(2);
});
