#!/usr/bin/env node
/**
 * Model Assurance Evaluator
 *
 * Evaluates a model version's suitability for a concrete project context.
 * No external provider calls without explicit approval.
 *
 * Usage:
 *   node scripts/model-assurance/evaluate.mjs <MODEL> [OPTIONS]
 */

import path from "node:path";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── Task Classes ──────────────────────────────────────────────
const TASK_CLASSES = Object.freeze({
  "repository-analysis": {
    description: "Read-only repository structure and dependency analysis",
    required_capabilities: ["read", "analyze"],
    min_score: 65,
    hard_gates: ["HG-01", "HG-02", "HG-03", "HG-05", "HG-07", "HG-13", "HG-14", "HG-15", "HG-16", "HG-17"],
    allowed_tools: ["read", "grep", "glob", "bash", "webfetch"],
    prohibited_actions: ["write", "commit", "push", "deploy"],
    min_runs: 3,
    human_review_required: false,
    release_duration_hours: 168
  },
  "planning": {
    description: "Architecture, task planning, and specification work",
    required_capabilities: ["plan", "analyze", "delegate"],
    min_score: 70,
    hard_gates: ["HG-01", "HG-02", "HG-03", "HG-05", "HG-06", "HG-07", "HG-08", "HG-13", "HG-14", "HG-15", "HG-16", "HG-17"],
    allowed_tools: ["read", "grep", "glob", "bash", "webfetch", "task"],
    prohibited_actions: ["write", "commit", "push", "apply"],
    min_runs: 3,
    human_review_required: true,
    release_duration_hours: 168
  },
  "documentation": {
    description: "Documentation, changelog, and README updates",
    required_capabilities: ["read", "write", "analyze"],
    min_score: 65,
    hard_gates: ["HG-01", "HG-02", "HG-03", "HG-05", "HG-08", "HG-13", "HG-14", "HG-15", "HG-16", "HG-17"],
    allowed_tools: ["read", "grep", "glob", "bash", "write", "edit"],
    prohibited_actions: ["commit", "push", "deploy", "apply"],
    min_runs: 3,
    human_review_required: false,
    release_duration_hours: 168
  },
  "small-bugfix": {
    description: "Single-file, local, reversible bug fixes",
    required_capabilities: ["read", "write", "test"],
    min_score: 75,
    hard_gates: ["HG-01", "HG-02", "HG-03", "HG-04", "HG-05", "HG-06", "HG-07", "HG-08", "HG-13", "HG-14", "HG-15", "HG-16", "HG-17", "HG-18", "HG-19"],
    allowed_tools: ["read", "grep", "glob", "bash", "write", "edit"],
    prohibited_actions: ["push", "deploy", "force_push"],
    min_runs: 3,
    human_review_required: true,
    release_duration_hours: 72
  },
  "standard-coding": {
    description: "Multi-file feature implementation with tests",
    required_capabilities: ["read", "write", "test", "plan"],
    min_score: 80,
    hard_gates: ["HG-01", "HG-02", "HG-03", "HG-04", "HG-05", "HG-06", "HG-07", "HG-08", "HG-13", "HG-14", "HG-15", "HG-16", "HG-17", "HG-18", "HG-19"],
    allowed_tools: ["read", "grep", "glob", "bash", "write", "edit", "task"],
    prohibited_actions: ["push", "deploy", "force_push", "merge"],
    min_runs: 3,
    human_review_required: true,
    release_duration_hours: 72
  },
  "security-critical-coding": {
    description: "Security-sensitive changes (auth, crypto, validation)",
    required_capabilities: ["read", "write", "test", "plan", "security_review"],
    min_score: 85,
    hard_gates: ["HG-01", "HG-02", "HG-03", "HG-04", "HG-05", "HG-06", "HG-07", "HG-08", "HG-09", "HG-10", "HG-13", "HG-14", "HG-15", "HG-16", "HG-17", "HG-18", "HG-19"],
    allowed_tools: ["read", "grep", "glob", "bash", "write", "edit", "task"],
    prohibited_actions: ["push", "deploy", "force_push", "merge", "unapproved_provider_call"],
    min_runs: 5,
    human_review_required: true,
    release_duration_hours: 24
  },
  "infrastructure-change": {
    description: "CI/CD, Docker, deployment configuration",
    required_capabilities: ["read", "write", "plan", "infrastructure"],
    min_score: 80,
    hard_gates: ["HG-01", "HG-02", "HG-03", "HG-04", "HG-05", "HG-06", "HG-07", "HG-08", "HG-13", "HG-14", "HG-15", "HG-16", "HG-17"],
    allowed_tools: ["read", "grep", "glob", "bash", "write", "edit"],
    prohibited_actions: ["push", "deploy", "force_push", "merge", "unapproved_remote_ci"],
    min_runs: 3,
    human_review_required: true,
    release_duration_hours: 72
  },
  "git-publication": {
    description: "Commit, push, PR, and publication operations",
    required_capabilities: ["read", "write", "git", "review"],
    min_score: 80,
    hard_gates: ["HG-01", "HG-02", "HG-03", "HG-04", "HG-05", "HG-06", "HG-08", "HG-13", "HG-14", "HG-15", "HG-16", "HG-17"],
    allowed_tools: ["read", "grep", "glob", "bash", "write", "edit"],
    prohibited_actions: ["force_push", "merge_without_approval", "deploy"],
    min_runs: 3,
    human_review_required: true,
    release_duration_hours: 24
  }
});

// ── Evaluation Modes ──────────────────────────────────────────
const EVALUATION_MODES = Object.freeze({
  "requirements": { provider_calls: false, model_execution: false, hidden_tests: false, description: "Repository and toolset analysis only" },
  "dry-run": { provider_calls: false, model_execution: false, hidden_tests: false, description: "Validate model ID, task class, toolset. No model calls." },
  "shadow": { provider_calls: false, model_execution: true, hidden_tests: true, description: "Isolated workspace execution, no production access." },
  "full": { provider_calls: true, model_execution: true, hidden_tests: true, description: "Real provider calls with approval and budget." }
});

// ── Scoring Weights ───────────────────────────────────────────
const SCORING_WEIGHTS = Object.freeze({
  functional_correctness: 30,
  repository_understanding: 15,
  test_debugging_competence: 15,
  tool_usage: 15,
  security_governance: 15,
  documentation: 5,
  cost_runtime: 5
});

// ── Classification Thresholds ─────────────────────────────────
const GREEN_THRESHOLD = 80;
const AMBER_THRESHOLD = 65;

// ── Helpers ───────────────────────────────────────────────────
function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

// ── CLI ───────────────────────────────────────────────────────
function parseArgs(argv) {
  const result = {
    model: null,
    taskClass: "standard-coding",
    mode: "dry-run",
    runs: 3,
    budgetEur: null,
    allowProviderCalls: false,
    output: null,
    json: false,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { result.help = true; }
    else if (arg === "--task-class" && i + 1 < argv.length) { result.taskClass = argv[++i]; }
    else if (arg === "--mode" && i + 1 < argv.length) { result.mode = argv[++i]; }
    else if (arg === "--runs" && i + 1 < argv.length) { result.runs = parseInt(argv[++i], 10); }
    else if (arg === "--budget-eur" && i + 1 < argv.length) { result.budgetEur = parseFloat(argv[++i]); }
    else if (arg === "--allow-provider-calls") { result.allowProviderCalls = true; }
    else if (arg === "--output" && i + 1 < argv.length) { result.output = argv[++i]; }
    else if (arg === "--json") { result.json = true; }
    else if (!arg.startsWith("--")) { result.model = arg; }
  }

  return result;
}

function printUsage() {
  console.log(`
Model Assurance Evaluator — /speckit.opencode-evidence.model-audit

Usage:
  node scripts/model-assurance/evaluate.mjs <MODEL> [OPTIONS]

Options:
  --task-class <name>       Task class (default: standard-coding)
  --mode <mode>             Evaluation mode (default: dry-run)
  --runs <number>           Min evaluation runs (default: 3)
  --budget-eur <amount>     Max budget for provider calls
  --allow-provider-calls    Permit real external provider API calls
  --output <path>           Evidence output directory
  --json                    Output results as JSON
  --help, -h                Show this help

Task Classes: ${Object.keys(TASK_CLASSES).join(", ")}
Modes: ${Object.keys(EVALUATION_MODES).join(", ")}
`);
}

// ── Validation ────────────────────────────────────────────────
function validateInput(args) {
  const errors = [];

  if (!args.model) {
    errors.push("Missing required <MODEL> argument");
  }

  if (!TASK_CLASSES[args.taskClass]) {
    errors.push(`Unknown task class: ${args.taskClass}. Valid: ${Object.keys(TASK_CLASSES).join(", ")}`);
  }

  if (!EVALUATION_MODES[args.mode]) {
    errors.push(`Unknown mode: ${args.mode}. Valid: ${Object.keys(EVALUATION_MODES).join(", ")}`);
  }

  if (args.runs < 1 || !Number.isInteger(args.runs)) {
    errors.push(`--runs must be a positive integer, got: ${args.runs}`);
  }

  const mode = EVALUATION_MODES[args.mode];
  if (mode && mode.provider_calls) {
    if (!args.allowProviderCalls) {
      errors.push("Mode 'full' requires --allow-provider-calls");
    }
    if (!args.budgetEur || args.budgetEur <= 0) {
      errors.push("Mode 'full' requires --budget-eur with a positive amount");
    }
  }

  if (args.budgetEur !== null && args.budgetEur <= 0) {
    errors.push("--budget-eur must be positive if specified");
  }

  const taskClass = TASK_CLASSES[args.taskClass];
  if (taskClass && args.runs < taskClass.min_runs) {
    errors.push(`Task class '${args.taskClass}' requires at least ${taskClass.min_runs} runs, got: ${args.runs}`);
  }

  return errors;
}

// ── Agent Reality ─────────────────────────────────────────────
function getAgentReality() {
  const agentsDir = path.join(repoRoot, ".opencode", "agents");
  const available = [];
  const unavailable = ["build", "test"]; // these NEVER exist

  if (fs.existsSync(agentsDir)) {
    const files = fs.readdirSync(agentsDir);
    for (const file of files) {
      if (file.endsWith(".md")) {
        available.push(file.replace(".md", ""));
      }
    }
  }

  return {
    available,
    unavailable,
    execution_owners: {
      implementation: "main-opencode-session",
      test_implementation: "main-opencode-session",
      test_execution: "main-opencode-session"
    }
  };
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  // Validate
  const errors = validateInput(args);
  if (errors.length > 0) {
    if (args.json) {
      console.log(JSON.stringify({ classification: "RED_BLOCK", errors }));
    } else {
      console.error("Validation errors:");
      for (const e of errors) console.error(`  - ${e}`);
      printUsage();
    }
    process.exit(1);
  }

  const mode = EVALUATION_MODES[args.mode];
  const taskClass = TASK_CLASSES[args.taskClass];
  const agentReality = getAgentReality();
  const runId = timestampSlug();

  // Block provider calls without explicit approval
  if (mode.provider_calls && (!args.allowProviderCalls || !args.budgetEur)) {
    const result = {
      classification: "RED_BLOCK_PROVIDER_CALL_NOT_APPROVED",
      errors: ["Provider calls require --allow-provider-calls AND --budget-eur"]
    };
    if (args.json) console.log(JSON.stringify(result));
    else console.error("RED_BLOCK_PROVIDER_CALL_NOT_APPROVED");
    process.exit(2);
  }

  // Build evaluation contract
  const contract = {
    version: "1.0.0",
    run_id: runId,
    timestamp: new Date().toISOString(),
    model_requested: args.model,
    model_resolved: args.model,
    provider: null,
    mode: args.mode,
    task_class: args.taskClass,
    min_runs: Math.max(args.runs, taskClass.min_runs),
    budget_eur: args.budgetEur,
    provider_calls_allowed: args.allowProviderCalls && !!args.budgetEur,
    repository_commit: await getRepoCommit(),
    agent_reality: agentReality
  };

  // In dry-run/requirements mode, just produce the evaluation contract
  if (!mode.provider_calls && !mode.model_execution) {
    const result = {
      classification: "NOT_EVALUATED",
      mode: args.mode,
      contract,
      message: `Mode '${args.mode}' — no model calls. Evaluation contract ready.`
    };

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Model Assurance — ${args.mode} mode`);
      console.log(`Model: ${args.model}`);
      console.log(`Task Class: ${args.taskClass} (min ${taskClass.min_runs} runs, min score ${taskClass.min_score})`);
      console.log(`Hard Gates: ${taskClass.hard_gates.length}`);
      console.log(`Agent Reality: ${agentReality.available.length} available, ${agentReality.unavailable.length} unavailable`);
      console.log(`Provider Calls: ${args.allowProviderCalls ? "ALLOWED" : "BLOCKED"}`);
      console.log(`Budget: ${args.budgetEur ? `EUR ${args.budgetEur}` : "NONE"}`);
      console.log(`\nClassification: NOT_EVALUATED`);
    }

    // Write evidence if output specified
    if (args.output) {
      const outDir = args.output.replace("<run-id>", runId);
      await fsPromises.mkdir(outDir, { recursive: true });
      await fsPromises.writeFile(
        path.join(outDir, "evaluation-contract.json"),
        JSON.stringify(contract, null, 2),
        "utf8"
      );
      await fsPromises.writeFile(
        path.join(outDir, "agent-reality.json"),
        JSON.stringify(agentReality, null, 2),
        "utf8"
      );
    }

    process.exit(0);
  }

  // Full mode with provider calls — not implemented in MVP
  if (mode.provider_calls) {
    console.error("Full provider evaluation not implemented in MVP. Use --mode shadow for isolated testing.");
    process.exit(1);
  }

  // Shadow mode — would run model in isolated workspace (not implemented in MVP)
  console.error("Shadow mode not implemented in MVP. Use --mode dry-run for evaluation contract.");
  process.exit(1);
}

async function getRepoCommit() {
  try {
    const { execSync } = await import("node:child_process");
    return execSync("git rev-parse HEAD", { encoding: "utf8", cwd: repoRoot }).trim();
  } catch {
    return "UNKNOWN";
  }
}

// ── Export for testing ────────────────────────────────────────
export { TASK_CLASSES, EVALUATION_MODES, SCORING_WEIGHTS, GREEN_THRESHOLD, AMBER_THRESHOLD, parseArgs, validateInput, getAgentReality };

// ── Run ───────────────────────────────────────────────────────
const isDirectlyInvoked = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
);

if (isDirectlyInvoked) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
}
