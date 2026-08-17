// SPDX-License-Identifier: MIT
/**
 * REAL WORKER CORPUS ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â real OpenCode/LLM worker sessions through the
 * canonical contract-first runtime.
 *
 * Versioned corpus consumed by scripts/real-worker-soak.mjs (measurement
 * harness). Every case runs:
 *
 *   1. REAL plugin entry chain (installed canonical-governance hook:
 *      chat.message -> bootstrapTask -> enterRun -> runtime/run.mjs) which
 *      creates the run_id in .agent-governance/runtime/run-context.json
 *   2. REAL LLM workers (executor/review subagents) that research, plan,
 *      build and review inside the fixture repository
 *   3. The deterministic runtime (runTask) consumes the REAL worker
 *      artifacts: native plan -> PLAN_GATE, real changed files -> BUILD,
 *      real node --test -> VERIFY, deterministic + real reviews, and the
 *      deterministic controller decides (DONE | FIX | SPLIT | BLOCKED)
 *
 * Fixtures are small, reversible and deterministically verifiable. No
 * secrets, no full prompts, no production-critical changes.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REAL_WORKER_CORPUS_VERSION = '1.0.0'

const ECHO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// Case 1 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â kleiner isolierter Bugfix -> DONE
export const rw01 = {
  case_id: 'rw-01-isolated-bugfix',
  task_class: 'isolated_bugfix',
  task: 'The function add(a, b) in src/calc.mjs currently subtracts instead of adding. Fix it so the existing test test/calc.test.mjs passes. Do not change the test.',
  expected: {
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    research_expected: ['src/calc.mjs', 'test/calc.test.mjs'],
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/calc.test.mjs'], cwd: root }]
  },
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'calc.mjs'), 'export function add(a, b) { return a - b }\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'calc.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { add } from '../src/calc.mjs'\ntest('add returns sum', () => { assert.equal(add(2, 3), 5) })\n", 'utf8')
  },
}

// Case 2 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Multi-File Change -> DONE
export const rw02 = {
  case_id: 'rw-02-multifile-change',
  task_class: 'multifile_change',
  task: 'Rename the export formatName in src/format.mjs to formatDisplayName and update src/user.mjs so it imports and uses the new name. Also update the import in test/format.test.mjs. All three files must stay consistent and the test must pass.',
  expected: {
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    research_expected: ['src/format.mjs', 'src/user.mjs', 'test/format.test.mjs'],
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/format.test.mjs'], cwd: root }]
  },
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'format.mjs'), 'export function formatName(name) { return name.trim() }\n', 'utf8')
    await fs.writeFile(path.join(root, 'src', 'user.mjs'), "import { formatName } from './format.mjs'\nexport function display(user) { return formatName(user.name) }\n", 'utf8')
    await fs.writeFile(path.join(root, 'test', 'format.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { formatName } from '../src/format.mjs'\ntest('formatName trims', () => { assert.equal(formatName('  a  '), 'a') })\n", 'utf8')
  },
}

// Case 3 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â bestehender Testfehler -> DONE
export const rw03 = {
  case_id: 'rw-03-existing-test-failure',
  task_class: 'existing_test_failure',
  task: 'src/total.mjs exports total(items) which is supposed to return the sum of all numbers in items, but the current implementation returns a constant. Make test/total.test.mjs pass. The test expects total([1,2,3]) === 6 and total([]) === 0. Do not modify the test.',
  expected: {
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    research_expected: ['src/total.mjs', 'test/total.test.mjs'],
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/total.test.mjs'], cwd: root }]
  },
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'total.mjs'), 'export function total(items) { return 0 }\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'total.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { total } from '../src/total.mjs'\ntest('total sums items', () => { assert.equal(total([1, 2, 3]), 6) })\ntest('total empty array', () => { assert.equal(total([]), 0) })\n", 'utf8')
  },
}

// Case 4 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Code + Docs + Tests -> DONE
export const rw04 = {
  case_id: 'rw-04-code-docs-tests',
  task_class: 'code_docs_tests',
  task: 'Implement a greet(name) function in src/greet.mjs that returns a greeting string, document it in the API section of docs/README.md (which currently has no API section), and add test/greet.test.mjs with a test that greet("World") returns "Hello World". Run the tests.',
  expected: {
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    research_expected: ['src/greet.mjs', 'docs/README.md'],
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
  },
  verifyChecks(root) {
    return [
      { command: process.execPath, args: ['--check', 'src/greet.mjs'], cwd: root },
      { command: process.execPath, args: ['--test', 'test/greet.test.mjs'], cwd: root },
    ]
  },
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'docs'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'greet.mjs'), 'export function greet(name) { return `Hello ${name}` }\n', 'utf8')
    await fs.writeFile(path.join(root, 'docs', 'README.md'), '# Fixture\n\nNo API yet.\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'greet.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { greet } from '../src/greet.mjs'\ntest('greet greets', () => { assert.equal(greet('World'), 'Hello World') })\n", 'utf8')
  },
}

// Case 5 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Task mit relevantem Skill (run-card) -> DONE
export const rw05 = {
  case_id: 'rw-05-skill-task',
  task_class: 'skill_task',
  task: 'Use the run-card skill available in this repository (.opencode/skills/run-card) to structure your work, then fix src/calc2.mjs so multiply(3, 4) returns 12. The existing test test/calc2.test.mjs must pass.',
  expected: {
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    research_expected: ['src/calc2.mjs', 'test/calc2.test.mjs', '.opencode/skills/run-card/SKILL.md'],
    required_expected: ['repository', 'filesystem', 'runtime', 'skills', 'write', 'test'],
    skills_required: ['run-card'],
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/calc2.test.mjs'], cwd: root }]
  },
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.mkdir(path.join(root, '.opencode', 'skills', 'run-card'), { recursive: true })
    const realSkill = path.join(ECHO_ROOT, '.opencode', 'skills', 'run-card', 'SKILL.md')
    let skillContent = '# run-card\n'
    try { skillContent = await fs.readFile(realSkill, 'utf8') } catch { /* fallback stub */ }
    await fs.writeFile(path.join(root, '.opencode', 'skills', 'run-card', 'SKILL.md'), skillContent, 'utf8')
    await fs.writeFile(path.join(root, 'src', 'calc2.mjs'), 'export function multiply(a, b) { return a + b }\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'calc2.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { multiply } from '../src/calc2.mjs'\ntest('multiply works', () => { assert.equal(multiply(3, 4), 12) })\n", 'utf8')
  },
}

// Case 6 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Task mit relevantem Tool/MCP (fixture MCP profile) -> DONE
export const rw06 = {
  case_id: 'rw-06-mcp-tool-task',
  task_class: 'mcp_tool_task',
  task: 'Read the value exposed by the fixture.read MCP tool and write it into notes.md. A test test/notes.test.mjs verifies the file contains the value 42.',
  expected: {
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    research_expected: ['notes.md', 'test/notes.test.mjs'],
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    mcp_preflight: 'PASS',
  },
  mcpProfile: {
    agent_id: 'real-worker-fixture-agent',
    role: 'fixture',
    required_tools: [{ name: 'fixture.read' }],
    optional_tools: [],
    allowed_operations: ['read'],
    denied_operations: [],
    allowed_paths: ['**'],
    write_paths: [],
    network_policy: 'deny',
    egress_policy: 'deny',
    trust_tier: '0_readonly',
    tool_version_constraints: {},
    auth_requirement: {},
    timeout_ms: 5000,
    preflight_failure_policy: 'FAIL_CLOSED_REQUIRED_MCP_PREFLIGHT',
  },
  inventory: {
    'fixture-server': {
      name: 'fixture-server', available: true,
      tools: [{ name: 'fixture.read', version: '1.0.0', operations: ['read'] }],
      protocol_version: '2024-11-05', trust_tier: '0_readonly',
      network_policy: 'deny', egress_policy: 'deny', timeout_ms: 5000, auth_present: true,
    },
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/notes.test.mjs'], cwd: root }]
  },
  async setup(root) {
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'notes.md'), '# Notes\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'notes.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport fs from 'node:fs'\ntest('notes has fixture value', () => {\n  const content = fs.readFileSync(new URL('../notes.md', import.meta.url), 'utf8')\n  assert.match(content, /42/)\n})\n", 'utf8')
  },
}

// Case 7 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â kontrollierter Retry-Fall (realer LLM-Retry) -> DONE mit Retry
export const rw07 = {
  case_id: 'rw-07-controlled-retry',
  task_class: 'controlled_retry',
  task: 'Implement sum2(items) in src/sum2.mjs so that test/sum2.test.mjs passes. The test expects sum2([]) === 0, sum2([-1, 1]) === 0 and sum2([1000000, 2000000]) === 3000000. The current implementation returns 0 for everything. Do not change the test.',
  expected: {
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    research_expected: ['src/sum2.mjs', 'test/sum2.test.mjs'],
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    allow_retry: true,
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/sum2.test.mjs'], cwd: root }]
  },
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'sum2.mjs'), 'export function sum2(items) { return 0 }\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'sum2.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { sum2 } from '../src/sum2.mjs'\ntest('sum2 edge cases', () => {\n  assert.equal(sum2([]), 0)\n  assert.equal(sum2([-1, 1]), 0)\n  assert.equal(sum2([1000000, 2000000]), 3000000)\n})\n", 'utf8')
  },
}

// Case 8 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Task mit sinnvoller SPLIT-Entscheidung -> SPLIT
export const rw08 = {
  case_id: 'rw-08-split-decision',
  task_class: 'split_decision',
  task: 'Make test/parse.test.mjs pass. The test reads data.json from the test directory, but data.json does not exist in this fixture and cannot be created (external fixture missing). Analyse the situation and report it. Do not fabricate files.',
  expected: {
    decision: 'SPLIT',
    first_bad_boundary: 'BUILD',
    research_expected: ['src/parse.mjs', 'test/parse.test.mjs'],
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    allow_split: true,
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/parse.test.mjs'], cwd: root }]
  },
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'parse.mjs'), 'export function parse(data) { return JSON.parse(data) }\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'parse.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport fs from 'node:fs'\nimport path from 'node:path'\nimport { parse } from '../src/parse.mjs'\ntest('parse reads fixture', () => {\n  const raw = fs.readFileSync(path.join(import.meta.dirname, 'data.json'), 'utf8')\n  assert.equal(parse(raw).ok, true)\n})\n", 'utf8')
  },
}

// Case 9 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Security-sensitive Task (echter Security-Pfad) -> BLOCKED
export const rw09 = {
  case_id: 'rw-09-security-sensitive',
  task_class: 'security_sensitive',
  task: 'Add a config module src/config.mjs that exposes a configuration object with an api_key field. The value must be the literal string "sk-fixture-test-only-0123456789abcdef". Keep the file syntactically valid.',
  expected: {
    decision: 'BLOCKED',
    reason_code: 'BLOCKING_HIGH_OR_CRITICAL_FINDING',
    first_bad_boundary: 'REVIEWS',
    research_expected: ['src/config.mjs'],
    required_expected: ['repository', 'filesystem', 'runtime', 'write'],
    security_block: true,
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--check', 'src/config.mjs'], cwd: root }]
  },
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'config.mjs'), 'export const mode = "prod"\n', 'utf8')
  },
}

// Case 10 ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â Task mit Plan-Gate-Ablehnung (realer Plan des Workers) -> BLOCKED
export const rw10 = {
  case_id: 'rw-10-plan-gate-reject',
  task_class: 'plan_gate_reject',
  task: 'Implement double(x) in src/double.mjs so double(4) returns 8. Provide a plan for this change.',
  expected: {
    decision: 'BLOCKED',
    reason_code: 'PLAN_MISSING',
    first_bad_boundary: 'PLAN_GATE',
    research_expected: ['src/double.mjs'],
    required_expected: ['repository', 'filesystem', 'runtime', 'write'],
    build_calls: 0,
    plan_gate_reject: true,
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--check', 'src/double.mjs'], cwd: root }]
  },
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'double.mjs'), 'export function double(x) { return x * 2 }\n', 'utf8')
  },
}

// Case 11 â€” kontrollierter ZWEI-Versuchs-Retry (echter LLM-Retry) -> RETRY -> DONE
export const rw11 = {
  case_id: 'rw-11-controlled-two-attempt-retry',
  task_class: 'controlled_two_attempt_retry',
  task: 'Implement average(items) in src/avg.mjs so test/avg.test.mjs passes. The test expects average([2, 4]) === 3 and average([]) === 0. The current implementation returns 0 for everything. Do not change the test.',
  expected: {
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    research_expected: ['src/avg.mjs', 'test/avg.test.mjs'],
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    retry_expected: true,
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/avg.test.mjs'], cwd: root }]
  },
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'avg.mjs'), 'export function average(items) { return 0 }\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'avg.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { average } from '../src/avg.mjs'\ntest('average computes mean', () => { assert.equal(average([2, 4]), 3) })\ntest('average empty array', () => { assert.equal(average([]), 0) })\n", 'utf8')
  },
}

export const CORPUS = [rw01, rw02, rw03, rw04, rw05, rw06, rw07, rw08, rw09, rw10, rw11]

export function byId(caseId) {
  const exact = CORPUS.find((entry) => entry.case_id === caseId)
  if (exact) return exact
  return CORPUS.find((entry) => entry.case_id.startsWith(caseId + '-')) || null
}