#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import { argv, exit } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--target') {
      result.target = args[++i];
    } else if (arg === '--runtime') {
      result.runtime = args[++i];
    } else if (arg === '--action') {
      result.action = args[++i];
    } else if (arg === '--tool') {
      result.tool = args[++i];
    } else if (arg === '--command') {
      result.command = args[++i];
    } else if (arg === '--write-path') {
      if (!result.writePaths) result.writePaths = [];
      result.writePaths.push(args[++i]);
    } else if (arg === '--json') {
      result.json = true;
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(argv.slice(2));

  if (args.help) {
    console.log(`evaluate.mjs — Agent Governance Gate Evaluation

Usage:
  node .agent-governance/bin/evaluate.mjs --target <path> [options]

Options:
  --target <path>       Target project root (required)
  --runtime <name>      Runtime identifier (default: auto)
  --action <action>     Action to evaluate (default: evaluate)
  --tool <name>         Tool name being used (e.g., bash, edit, write)
  --command <cmd>       Command being executed
  --write-path <p>      Path being written to (repeatable)
  --json                Output machine-readable JSON
  --help                Show this help

Exit Codes:
  0  GREEN_SAFE — all gates passed
  1  AMBER_REVIEW or TOOL_GAP — review required
  2  RED_BLOCK — blocked by kernel or policy gates`);
    exit(0);
  }

  if (!args.target) {
    console.error('ERROR: --target is required. Use --help for usage.');
    exit(2);
  }

  const targetRoot = resolve(args.target);
  if (!existsSync(targetRoot)) {
    console.error(`ERROR: Target directory does not exist: ${targetRoot}`);
    exit(2);
  }

  try {
    const mod = await import('../runtime/gates/evaluate-all.mjs');

    if (!mod || typeof mod.evaluateAllGates !== 'function') {
      console.error('ERROR: Runtime loaded but evaluateAllGates function not found.');
      exit(2);
    }

    const result = await mod.evaluateAllGates({
      targetRoot,
      runtime: args.runtime || 'auto',
      action: args.action || 'evaluate',
      tool: args.tool || null,
      command: args.command || null,
      writePaths: args.writePaths || [],
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHumanReadable(result);
    }

    exit(typeof result.exitCode === 'number' ? result.exitCode : 2);
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error('ERROR: Runtime not found. The .agent-governance/runtime/ directory may be missing or incomplete.');
      console.error('Install the governance runtime first: node scripts/install-governance.mjs --target <project> --apply');
    } else {
      console.error('ERROR:', err.message);
    }
    exit(2);
  }
}

function printHumanReadable(result) {
  const lines = [];
  lines.push(`Classification: ${result.classification}`);
  lines.push(`Runtime: ${result.runtime || 'unknown'}`);
  lines.push(`Risk Tier: ${result.riskTier || 'N/A'}`);
  lines.push(`Allowed: ${result.allowed}`);
  lines.push(`Verification Level: ${result.verificationLevel}`);

  if (result.blockedBy && result.blockedBy.length > 0) {
    lines.push(`\nBlocked By (${result.blockedBy.length}):`);
    for (const block of result.blockedBy) {
      lines.push(`  - [${block.layer}] ${block.message}`);
    }
  }

  if (result.warnings && result.warnings.length > 0) {
    lines.push(`\nWarnings (${result.warnings.length}):`);
    for (const w of result.warnings) {
      lines.push(`  - ${w}`);
    }
  }

  if (result.toolGaps && result.toolGaps.length > 0) {
    lines.push(`\nTool Gaps (${result.toolGaps.length}):`);
    for (const gap of result.toolGaps) {
      lines.push(`  - ${gap}`);
    }
  }

  console.log(lines.join('\n'));
}

main();
