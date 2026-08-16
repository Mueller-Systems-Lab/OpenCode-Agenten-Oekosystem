#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * Canonical runtime task runner.
 *
 * Executes a normal development task through the canonical contract-first
 * runtime entry point (runtime/run.mjs → runTask):
 *
 *   TASK → BASELINE → RESEARCH → PLAN → PLAN_GATE → BUILD → VERIFY →
 *   bounded RETRY → REVIEWS → CONTROLLER → DONE | FIX | SPLIT | BLOCKED
 *
 * Usage:
 *   node scripts/run-task.mjs --task "implement add(a,b) with a test" --repo .
 *     [--plan-text "# Plan\n## Targets\n- src/add.mjs\n## Acceptance Criteria\n- add(2,3)==5\n..."]
 *     [--plan-file plan.md] [--verify "node --check src/add.mjs"] [--verify "node --test test/add.test.mjs"]
 *     [--exec ./build-executor.mjs] [--event-sink path] [--max-attempts 2] [--json] [--help]
 *
 * Without a plan and build executor the run enters the canonical runtime
 * (task normalization, contract validation, capability + MCP preflight, real
 * run events) and reports ENTRY_READY — exactly the productive seam the
 * OpenCode plugin uses for real user tasks.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { runTask } from "../runtime/run.mjs"

const cwd = process.cwd()

function parseArgs(argv) {
  const out = { verify: [], requiredSkills: [], maxAttempts: 2 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case "--task": out.task = next(); break
      case "--repo": out.repo = next(); break
      case "--plan-text": out.planText = next(); break
      case "--plan-file": out.planFile = next(); break
      case "--verify": out.verify.push(next()); break
      case "--exec": out.exec = next(); break
      case "--event-sink": out.eventSink = next(); break
      case "--max-attempts": out.maxAttempts = Number(next()); break
      case "--required-skill": out.requiredSkills.push(next()); break
      case "--json": out.json = true; break
      case "--help": case "-h": out.help = true; break
      default: throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return out
}

function printHelp() {
  console.log(`Usage:
  node scripts/run-task.mjs --task "<text>" [--repo <path>] [--plan-text <md>|--plan-file <path>]
    [--verify "<command>"] [--exec <module>] [--event-sink <path>] [--max-attempts <n>]
    [--required-skill <name>] [--json] [--help]

Runs a development task through the canonical contract-first runtime:
TASK -> BASELINE -> RESEARCH -> PLAN -> PLAN_GATE -> BUILD -> VERIFY -> REVIEWS -> CONTROLLER

Flags:
  --task <text>          Task description (required). run_id is created here.
  --repo <path>          Repository root (default: current directory).
  --plan-text <md>       Native plan markdown fed through the plan gate.
  --plan-file <path>     Read the native plan from a file.
  --verify "<command>"   Real verification command (repeatable), e.g. "node --test test/x.test.mjs".
  --exec <module>        Build executor module exporting execute(buildInput).
  --event-sink <path>    Run-event JSONL sink (default: <repo>/.agent-governance/evidence/run-events.jsonl).
  --max-attempts <n>     Bounded retry budget (default: 2).
  --required-skill <n>   Required skill capability (repeatable).
  --json                 Machine-readable output.
`)
}

function tokenizeCommand(line) {
  const tokens = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = pattern.exec(line)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3])
  }
  return tokens
}

async function loadBuildExecutor(modulePath, repoRoot) {
  const absolute = path.resolve(repoRoot, modulePath)
  const mod = await import(pathToFileURL(absolute).href)
  const execute = mod.execute || mod.default?.execute
  if (typeof execute !== "function") throw new Error(`exec module ${modulePath} must export execute(buildInput)`)
  return execute
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    process.exit(0)
  }
  if (!args.task || !String(args.task).trim()) {
    console.error("Missing required --task <text>")
    printHelp()
    process.exit(2)
  }

  const repoRoot = path.resolve(args.repo || cwd)
  let planText = args.planText || null
  if (!planText && args.planFile) {
    planText = await fs.readFile(path.resolve(repoRoot, args.planFile), "utf8")
  }

  const verifyChecks = args.verify.map((line) => {
    const [command, ...rest] = tokenizeCommand(line)
    return { command, args: rest, cwd: repoRoot }
  })

  let buildExecutor = null
  if (args.exec) buildExecutor = await loadBuildExecutor(args.exec, repoRoot)

  const result = await runTask({
    taskInput: { task: args.task, repository: repoRoot },
    repoRoot,
    nativePlan: planText ? { planText } : null,
    buildExecutor,
    verifyChecks,
    eventSink: args.eventSink || undefined,
    max_attempts: Number.isInteger(args.maxAttempts) && args.maxAttempts > 0 ? args.maxAttempts : undefined,
    required_skills: args.requiredSkills,
  })

  if (args.json) {
    console.log(JSON.stringify(compactResult(result), null, 2))
  } else {
    console.log(`CANONICAL_RUNTIME_ENTRY: PASS`)
    console.log(`PHASE: ${result.phase}`)
    console.log(`RUN_ID: ${result.run_id}`)
    console.log(`TASK_CONTRACT: ${result.task?.contract}`)
    console.log(`BASELINE: ${result.baseline?.approved ? "approved" : "blocked"}`)
    if (result.baseline?.optional_degradations?.length) {
      console.log(`OPTIONAL_DEGRADATIONS: ${result.baseline.optional_degradations.join(", ")}`)
    }
    if (result.decision) {
      console.log(`DECISION: ${result.decision.decision}`)
      console.log(`REASON_CODE: ${result.decision.reason_code}`)
      console.log(`NEXT_PATH: ${result.decision.next_path}`)
      console.log(`FIRST_BAD_BOUNDARY: ${result.decision.first_bad_boundary || "null"}`)
      console.log(`PHASE_HISTORY: ${(result.decision.phase_history || []).map((b) => `${b.name}=${b.status}`).join(" -> ")}`)
      console.log(`REVIEWS: ${(result.reviews || []).map((r) => `${r.review_type}=${r.review.status}`).join(", ") || "none (entry mode)"}`)
      console.log(`EVENTS_EMITTED: ${(result.events || []).length}`)
      if (result.build_result) console.log(`BUILD: ${result.build_result.status} (${(result.build_result.changed_files || []).join(", ") || "no files"})`)
      if (result.verification?.verification) console.log(`VERIFY: ${result.verification.verification.passed ? "PASS" : `FAIL ${result.verification.verification.failure_signature}`}`)
    } else {
      console.log(`ENTRY: READY (workers will continue the run; run_id preserved)`)
    }
  }
  process.exitCode = result.decision?.decision === "DONE" ? 0 : result.decision ? 1 : 0
}

function compactResult(result) {
  return {
    phase: result.phase,
    run_id: result.run_id,
    task_contract: result.task?.contract,
    baseline: result.baseline ? {
      approved: result.baseline.approved,
      required_capabilities: result.baseline.required_capabilities,
      optional_degradations: result.baseline.optional_degradations,
      required_mcp: result.baseline.required_mcp,
      errors: result.baseline.errors,
    } : null,
    decision: result.decision,
    build_status: result.build_result?.status || null,
    changed_files: result.build_result?.changed_files || null,
    verification: result.verification?.verification || null,
    reviews: (result.reviews || []).map((review) => ({ review_type: review.review_type, status: review.review.status, severity: review.review.severity })),
    events_emitted: (result.events || []).length,
    validation_issues: result.validation_issues || null,
  }
}

main().catch((error) => {
  console.error(`RUN_TASK_ERROR: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 2
})
