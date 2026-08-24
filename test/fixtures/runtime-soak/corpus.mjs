// SPDX-License-Identifier: MIT
/**
 * SOAK CORPUS — contract-first runtime behavior under real task diversity.
 *
 * Versioned corpus consumed by scripts/runtime-soak.mjs (measurement harness).
 * Every case runs through the CANONICAL ENTRY (runtime/run.mjs -> runTask);
 * the harness never calls the controller directly.
 *
 * Each case:
 *   - isolated temp fixture repo (setup writes files, cleanup removes)
 *   - exactly one run_id (created by runTask)
 *   - real verify checks (node --test / node --check)
 *   - deterministic build executor simulating the worker seam
 *
 * No secrets. No full prompts. Fake credential values are fixture-only.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SOAK_CORPUS_VERSION = '1.0.0'

const ECHO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

// ---------------------------------------------------------------------------
// Case 1 — kleiner isolierter Bugfix  ->  DONE
// ---------------------------------------------------------------------------
export const case01 = {
  case_id: 'case-01-isolated-bugfix',
  task_class: 'isolated_bugfix',
  task: 'Fix the bug in src/calc.mjs so that add(2, 3) returns 5. Keep the existing test green.',
  max_attempts: 2,
  expected: {
    research_expected: ['src/calc.mjs','test/calc.test.mjs'],
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: true,
    plan_gate_approved: true,
    build_status: 'SUCCESS',
    verify_passed: true,
    phase: 'PIPELINE',
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
  },
  planText: `# Plan
## Targets
- src/calc.mjs — fix add to return a + b
## Acceptance Criteria
- add(2, 3) returns 5
- existing test test/calc.test.mjs passes
## Required Tests
- node --test test/calc.test.mjs
## Risks
- none
## Build Scope
- files: src/calc.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'calc.mjs'), 'export function add(a, b) { return a - b }\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'calc.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { add } from '../src/calc.mjs'\ntest('add returns sum', () => { assert.equal(add(2, 3), 5) })\n", 'utf8')
  },
  buildExecutor() {
    return async (buildInput) => {
      const root = buildInput.task.repository
      await fs.writeFile(path.join(root, 'src', 'calc.mjs'), 'export function add(a, b) { return a + b }\n', 'utf8')
      return { changed_files: ['src/calc.mjs'], errors: [], strategy_delta: null }
    }
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/calc.test.mjs'], cwd: root }]
  },
}

// ---------------------------------------------------------------------------
// Case 2 — Multi-File Change  ->  DONE
// ---------------------------------------------------------------------------
export const case02 = {
  case_id: 'case-02-multifile-change',
  task_class: 'multifile_change',
  task: 'Rename formatName to formatDisplayName in src/format.mjs and update src/user.mjs to use the new export. Update the test to the new name. Keep tests green.',
  max_attempts: 2,
  expected: {
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: true,
    plan_gate_approved: true,
    build_status: 'SUCCESS',
    verify_passed: true,
    phase: 'PIPELINE',
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    research_expected: ['src/format.mjs', 'src/user.mjs', 'test/format.test.mjs'],
  },
  planText: `# Plan
## Targets
- src/format.mjs — rename formatName to formatDisplayName
- src/user.mjs — import formatDisplayName
- test/format.test.mjs — update import
## Acceptance Criteria
- src/format.mjs exports formatDisplayName
- src/user.mjs uses formatDisplayName
- test/format.test.mjs passes
## Required Tests
- node --test test/format.test.mjs
## Risks
- low: import mismatch
## Build Scope
- files: src/format.mjs, src/user.mjs, test/format.test.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'format.mjs'), 'export function formatName(name) { return name.trim() }\n', 'utf8')
    await fs.writeFile(path.join(root, 'src', 'user.mjs'), "import { formatName } from './format.mjs'\nexport function display(user) { return formatName(user.name) }\n", 'utf8')
    await fs.writeFile(path.join(root, 'test', 'format.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { formatName } from '../src/format.mjs'\ntest('formatName trims', () => { assert.equal(formatName('  a  '), 'a') })\n", 'utf8')
  },
  buildExecutor() {
    return async (buildInput) => {
      const root = buildInput.task.repository
      await fs.writeFile(path.join(root, 'src', 'format.mjs'), 'export function formatDisplayName(name) { return name.trim() }\n', 'utf8')
      await fs.writeFile(path.join(root, 'src', 'user.mjs'), "import { formatDisplayName } from './format.mjs'\nexport function display(user) { return formatDisplayName(user.name) }\n", 'utf8')
      await fs.writeFile(path.join(root, 'test', 'format.test.mjs'),
        "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { formatDisplayName } from '../src/format.mjs'\ntest('formatDisplayName trims', () => { assert.equal(formatDisplayName('  a  '), 'a') })\n", 'utf8')
      return { changed_files: ['src/format.mjs', 'src/user.mjs', 'test/format.test.mjs'], errors: [], strategy_delta: null }
    }
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/format.test.mjs'], cwd: root }]
  },
}

// ---------------------------------------------------------------------------
// Case 3 — Testfehler analysieren, Retry, dann DONE
// ---------------------------------------------------------------------------
export const case03 = {
  case_id: 'case-03-test-failure-retry',
  task_class: 'test_failure_retry',
  task: 'Implement total(items) in src/total.mjs so that test/total.test.mjs passes. total sums all items.',
  max_attempts: 2,
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    research_expected: ['src/total.mjs','test/total.test.mjs'],
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    attempt_count: 2,
    retry_count: 1,
    baseline_approved: true,
    plan_gate_approved: true,
    build_status: 'SUCCESS',
    verify_passed: true,
    phase: 'PIPELINE',
    retry_classification: 'RETRY_EFFECTIVE',
  },
  planText: `# Plan
## Targets
- src/total.mjs — implement total(items)
## Acceptance Criteria
- total([1, 2, 3]) returns 6
- test/total.test.mjs passes
## Required Tests
- node --test test/total.test.mjs
## Risks
- sum semantics
## Build Scope
- files: src/total.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'total.mjs'), 'export function total(items) { return 0 }\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'total.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { total } from '../src/total.mjs'\ntest('total sums items', () => { assert.equal(total([1, 2, 3]), 6) })\n", 'utf8')
  },
  buildExecutor() {
    return async (buildInput) => {
      const root = buildInput.task.repository
      if (buildInput.attempt === 0) {
        await fs.writeFile(path.join(root, 'src', 'total.mjs'), 'export function total(items) { return items.length }\n', 'utf8')
        return { changed_files: ['src/total.mjs'], errors: [], strategy_delta: 'switch to summing the items instead of counting them' }
      }
      await fs.writeFile(path.join(root, 'src', 'total.mjs'), 'export function total(items) { return items.reduce((a, b) => a + b, 0) }\n', 'utf8')
      return { changed_files: ['src/total.mjs'], errors: [], strategy_delta: null }
    }
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/total.test.mjs'], cwd: root }]
  },
}

// ---------------------------------------------------------------------------
// Case 4 — Fehler ohne sinnvolle Retry-Strategie (build crash, no delta)  ->  SPLIT
// ---------------------------------------------------------------------------
export const case04 = {
  case_id: 'case-04-no-retry-strategy',
  task_class: 'no_retry_strategy',
  task: 'Make test/parse.test.mjs pass. The test reads data.json which is missing from the fixture.',
  max_attempts: 2,
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    research_expected: ['src/parse.mjs','test/parse.test.mjs'],
    decision: 'SPLIT',
    reason_code: 'RETRY_DENIED_NO_STRATEGY_DELTA',
    first_bad_boundary: 'BUILD',
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: true,
    plan_gate_approved: true,
    build_status: 'FAILURE',
    verify_passed: false,
    phase: 'PIPELINE',
    retry_classification: 'RETRY_SHOULD_HAVE_SPLIT',
  },
  planText: `# Plan
## Targets
- src/parse.mjs — implement parse(data)
## Acceptance Criteria
- test/parse.test.mjs passes
## Required Tests
- node --test test/parse.test.mjs
## Risks
- external fixture missing
## Build Scope
- files: src/parse.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'parse.mjs'), 'export function parse(data) { return JSON.parse(data) }\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'parse.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport fs from 'node:fs'\nimport path from 'node:path'\nimport { parse } from '../src/parse.mjs'\ntest('parse reads fixture', () => {\n  const raw = fs.readFileSync(path.join(import.meta.dirname, 'data.json'), 'utf8')\n  assert.equal(parse(raw).ok, true)\n})\n", 'utf8')
  },
  buildExecutor() {
    return async () => {
      throw new Error('external fixture data.json unavailable')
    }
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/parse.test.mjs'], cwd: root }]
  },
}

// ---------------------------------------------------------------------------
// Case 5 — Dokumentation + Code-Konsistenz  ->  DONE (research must find all 3)
// ---------------------------------------------------------------------------
export const case05 = {
  case_id: 'case-05-docs-code-consistency',
  task_class: 'docs_code_consistency',
  task: 'Add a greet(name) function to src/greet.mjs, document it in docs/README.md and add a test in test/greet.test.mjs.',
  max_attempts: 2,
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: true,
    plan_gate_approved: true,
    build_status: 'SUCCESS',
    verify_passed: true,
    phase: 'PIPELINE',
    research_expected: ['src/greet.mjs', 'docs/README.md', 'test/greet.test.mjs'],
    research_classification: 'RESEARCH_COMPLETE',
  },
  planText: `# Plan
## Targets
- src/greet.mjs — implement greet(name)
- docs/README.md — document greet
- test/greet.test.mjs — add test
## Acceptance Criteria
- greet('World') returns 'Hello World'
- docs/README.md mentions greet
- test/greet.test.mjs passes
## Required Tests
- node --test test/greet.test.mjs
## Risks
- none
## Build Scope
- files: src/greet.mjs, docs/README.md, test/greet.test.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'docs'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'greet.mjs'), 'export function greet(name) { return `Hello ${name}` }\n', 'utf8')
    await fs.writeFile(path.join(root, 'docs', 'README.md'), '# Fixture\n\nNo API yet.\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'greet.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { greet } from '../src/greet.mjs'\ntest('greet greets', () => { assert.equal(greet('World'), 'Hello World') })\n", 'utf8')
  },
  buildExecutor() {
    return async (buildInput) => {
      const root = buildInput.task.repository
      await fs.writeFile(path.join(root, 'src', 'greet.mjs'), 'export function greet(name) { return `Hello ${name}` }\n', 'utf8')
      await fs.writeFile(path.join(root, 'docs', 'README.md'), '# Fixture\n\n## API\n\n- `greet(name)` returns `Hello ${name}`\n', 'utf8')
      await fs.writeFile(path.join(root, 'test', 'greet.test.mjs'),
        "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { greet } from '../src/greet.mjs'\ntest('greet greets', () => { assert.equal(greet('World'), 'Hello World') })\n", 'utf8')
      return { changed_files: ['src/greet.mjs', 'docs/README.md', 'test/greet.test.mjs'], errors: [], strategy_delta: null }
    }
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/greet.test.mjs'], cwd: root }]
  },
}

// ---------------------------------------------------------------------------
// Case 6 — erforderlicher Skill (run-card real skill copied into fixture)
// ---------------------------------------------------------------------------
export const case06 = {
  case_id: 'case-06-required-skill',
  task_class: 'required_skill',
  task: 'Use the run-card skill to plan and fix the bug in src/calc2.mjs. The skill is required for this task.',
  max_attempts: 2,
  required_skills: ['run-card'],
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'skills', 'write', 'test'],
    research_expected: ['src/calc2.mjs','test/calc2.test.mjs'],
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: true,
    plan_gate_approved: true,
    build_status: 'SUCCESS',
    verify_passed: true,
    phase: 'PIPELINE',
    skills_required: ['run-card'],
  },
  planText: `# Plan
## Targets
- src/calc2.mjs — fix multiply
## Acceptance Criteria
- multiply(3, 4) returns 12
- test/calc2.test.mjs passes
## Required Tests
- node --test test/calc2.test.mjs
## Risks
- none
## Build Scope
- files: src/calc2.mjs
`,
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
  buildExecutor() {
    return async (buildInput) => {
      const root = buildInput.task.repository
      const skillPath = path.join(root, '.opencode', 'skills', 'run-card', 'SKILL.md')
      const skillUsed = await fs.readFile(skillPath, 'utf8').then(() => true).catch(() => false)
      if (!skillUsed) return { changed_files: [], errors: ['required skill run-card unavailable'], strategy_delta: null }
      await fs.writeFile(path.join(root, 'src', 'calc2.mjs'), 'export function multiply(a, b) { return a * b }\n', 'utf8')
      return { changed_files: ['src/calc2.mjs'], errors: [], strategy_delta: null, capabilities_used: ['skills:run-card'] }
    }
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/calc2.test.mjs'], cwd: root }]
  },
}

// ---------------------------------------------------------------------------
// Case 7a — erforderliches MCP-Tool vorhanden  ->  PREFLIGHT PASS -> DONE
// Case 7b — erforderliches MCP-Tool fehlt      ->  BLOCKED before worker
// ---------------------------------------------------------------------------
function fixtureMcpProfile() {
  return {
    agent_id: 'soak-fixture-agent',
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
  }
}

export const case07a = {
  case_id: 'case-07a-mcp-required-present',
  task_class: 'mcp_required',
  task: 'Read the value from the fixture.read MCP tool and write it into notes.md in the fixture repo.',
  max_attempts: 2,
  mcpProfile: fixtureMcpProfile(),
  inventory: {
    'fixture-server': {
      name: 'fixture-server', available: true,
      tools: [{ name: 'fixture.read', version: '1.0.0', operations: ['read'] }],
      protocol_version: '2024-11-05', trust_tier: '0_readonly',
      network_policy: 'deny', egress_policy: 'deny', timeout_ms: 5000, auth_present: true,
    },
  },
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    research_expected: ['notes.md','test/notes.test.mjs'],
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: true,
    plan_gate_approved: true,
    build_status: 'SUCCESS',
    verify_passed: true,
    phase: 'PIPELINE',
    mcp_preflight: 'PASS',
  },
  planText: `# Plan
## Targets
- notes.md — record fixture value
## Acceptance Criteria
- notes.md exists and contains the fixture value
## Required Tests
- node --test test/notes.test.mjs
## Risks
- mcp availability
## Build Scope
- files: notes.md, test/notes.test.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'notes.md'), '# Notes\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'notes.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport fs from 'node:fs'\ntest('notes has fixture value', () => {\n  const content = fs.readFileSync(new URL('../notes.md', import.meta.url), 'utf8')\n  assert.match(content, /42/)\n})\n", 'utf8')
  },
  buildExecutor() {
    return async (buildInput) => {
      const root = buildInput.task.repository
      await fs.writeFile(path.join(root, 'notes.md'), '# Notes\n\nfixture value: 42\n', 'utf8')
      return { changed_files: ['notes.md'], errors: [], strategy_delta: null }
    }
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/notes.test.mjs'], cwd: root }]
  },
}

export const case07b = {
  case_id: 'case-07b-mcp-required-missing',
  task_class: 'mcp_required_missing',
  task: 'Read the value from the fixture.read MCP tool and write it into notes.md in the fixture repo.',
  max_attempts: 2,
  mcpProfile: fixtureMcpProfile(),
  inventory: {},
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    research_expected: ['notes.md','test/notes.test.mjs'],
    decision: 'BLOCKED',
    reason_code: 'BLOCKED_MISSING_REQUIRED_CAPABILITY',
    first_bad_boundary: 'BASELINE',
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: false,
    phase: 'BLOCKED_ENTRY',
    worker_called: false,
    mcp_preflight: 'FAIL',
  },
  planText: `# Plan
## Targets
- notes.md — record fixture value
## Acceptance Criteria
- notes.md exists
## Required Tests
- node --test test/notes.test.mjs
## Risks
- mcp availability
## Build Scope
- files: notes.md, test/notes.test.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'notes.md'), '# Notes\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'notes.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport fs from 'node:fs'\ntest('notes has fixture value', () => {\n  const content = fs.readFileSync(new URL('../notes.md', import.meta.url), 'utf8')\n  assert.match(content, /42/)\n})\n", 'utf8')
  },
  buildExecutor() {
    return async () => ({ changed_files: [], errors: ['worker must never be called'], strategy_delta: null })
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/notes.test.mjs'], cwd: root }]
  },
}

// ---------------------------------------------------------------------------
// Case 8 — fehlende optionale Capability (github)  ->  DEGRADED, NOT BLOCKED
// ---------------------------------------------------------------------------
export const case08 = {
  case_id: 'case-08-optional-capability-missing',
  task_class: 'optional_capability_missing',
  task: 'Fix the typo in README.md of the fixture and mention the GitHub issue reference in the commit notes for a future PR.',
  max_attempts: 2,
  env_remove: ['GITHUB_TOKEN'],
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    research_expected: ['README.md','test/readme.test.mjs'],
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: true,
    plan_gate_approved: true,
    build_status: 'SUCCESS',
    verify_passed: true,
    phase: 'PIPELINE',
    optional_degradations_nonempty: true,
  },
  planText: `# Plan
## Targets
- README.md — fix typo
## Acceptance Criteria
- README.md contains corrected heading
## Required Tests
- node --test test/readme.test.mjs
## Risks
- none
## Build Scope
- files: README.md
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'README.md'), '# Fixture\n\n## Terible Heading\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'readme.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport fs from 'node:fs'\ntest('readme has fixed heading', () => {\n  const content = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8')\n  assert.match(content, /## Terrible Heading/)\n})\n", 'utf8')
  },
  buildExecutor() {
    return async (buildInput) => {
      const root = buildInput.task.repository
      await fs.writeFile(path.join(root, 'README.md'), '# Fixture\n\n## Terrible Heading\n', 'utf8')
      return { changed_files: ['README.md'], errors: [], strategy_delta: null }
    }
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/readme.test.mjs'], cwd: root }]
  },
}

// ---------------------------------------------------------------------------
// Case 9 — Aufgabe benötigt SPLIT (repeat failure detection)  ->  SPLIT
// ---------------------------------------------------------------------------
export const case09 = {
  case_id: 'case-09-split-required',
  task_class: 'split_required',
  task: 'Make test/sum2.test.mjs pass. The test expects sum2 to handle empty arrays, negatives and large numbers.',
  max_attempts: 2,
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    research_expected: ['src/sum2.mjs','test/sum2.test.mjs'],
    decision: 'SPLIT',
    reason_code: 'RETRY_DENIED_REPEATED_IDENTICAL_FAILURE',
    first_bad_boundary: 'VERIFY',
    attempt_count: 2,
    retry_count: 1,
    baseline_approved: true,
    plan_gate_approved: true,
    build_status: 'SUCCESS',
    verify_passed: false,
    phase: 'PIPELINE',
    retry_classification: 'RETRY_SHOULD_HAVE_SPLIT',
  },
  planText: `# Plan
## Targets
- src/sum2.mjs — implement sum2(items)
## Acceptance Criteria
- sum2([]) returns 0
- sum2([-1, 1]) returns 0
- test/sum2.test.mjs passes
## Required Tests
- node --test test/sum2.test.mjs
## Risks
- multiple edge cases
## Build Scope
- files: src/sum2.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'sum2.mjs'), 'export function sum2(items) { return 0 }\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'sum2.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { sum2 } from '../src/sum2.mjs'\ntest('sum2 edge cases', () => {\n  assert.equal(sum2([]), 0)\n  assert.equal(sum2([-1, 1]), 0)\n  assert.equal(sum2([1000000, 2000000]), 3000000)\n})\n", 'utf8')
  },
  buildExecutor() {
    return async (buildInput) => {
      const root = buildInput.task.repository
      await fs.writeFile(path.join(root, 'src', 'sum2.mjs'), 'export function sum2(items) { return 0 }\n', 'utf8')
      return { changed_files: ['src/sum2.mjs'], errors: [], strategy_delta: 'handle the empty array case with a reduce guard' }
    }
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/sum2.test.mjs'], cwd: root }]
  },
}

// ---------------------------------------------------------------------------
// Case 10 — Security calibration (4 sub-cases)
// ---------------------------------------------------------------------------
export const case10a = {
  case_id: 'case-10a-security-hard-block',
  task_class: 'security_hard_block',
  task: 'Add a config module src/config.mjs that reads settings and keep the existing test green.',
  max_attempts: 2,
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    research_expected: ['src/config.mjs'],
    decision: 'BLOCKED',
    reason_code: 'BLOCKING_HIGH_OR_CRITICAL_FINDING',
    first_bad_boundary: 'REVIEWS',
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: true,
    plan_gate_approved: true,
    build_status: 'SUCCESS',
    verify_passed: true,
    phase: 'PIPELINE',
    security_review: 'FAIL',
    security_blocking: true,
  },
  planText: `# Plan
## Targets
- src/config.mjs — add config module
## Acceptance Criteria
- src/config.mjs loads without syntax errors
## Required Tests
- node --check src/config.mjs
## Risks
- none
## Build Scope
- files: src/config.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'config.mjs'), 'export const mode = "prod"\n', 'utf8')
  },
  buildExecutor() {
    return async (buildInput) => {
      const root = buildInput.task.repository
      await fs.writeFile(path.join(root, 'src', 'config.mjs'), 'export const api_key = "sk-fixture-test-only-0123456789abcdef"\n', 'utf8')
      return { changed_files: ['src/config.mjs'], errors: [], strategy_delta: null }
    }
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--check', 'src/config.mjs'], cwd: root }]
  },
}

export const case10b = {
  case_id: 'case-10b-security-nonblocking-low',
  task_class: 'security_nonblocking',
  task: 'Add a small helper src/helper.mjs with a TODO for a future optimization. Keep syntax valid.',
  max_attempts: 2,
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    research_expected: ['src/helper.mjs'],
    decision: 'FIX',
    reason_code: 'NON_BLOCKING_REVIEW_FINDINGS',
    first_bad_boundary: 'REVIEWS',
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: true,
    plan_gate_approved: true,
    build_status: 'SUCCESS',
    verify_passed: true,
    phase: 'PIPELINE',
    security_review: 'PASS',
    security_blocking: false,
  },
  planText: `# Plan
## Targets
- src/helper.mjs — add helper
## Acceptance Criteria
- src/helper.mjs is syntactically valid
## Required Tests
- node --check src/helper.mjs
## Risks
- none
## Build Scope
- files: src/helper.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'helper.mjs'), 'export function helper() { return 1 }\n', 'utf8')
  },
  buildExecutor() {
    return async (buildInput) => {
      const root = buildInput.task.repository
      await fs.writeFile(path.join(root, 'src', 'helper.mjs'), '// TODO: optimize later\nexport function helper() { return 1 }\n', 'utf8')
      return { changed_files: ['src/helper.mjs'], errors: [], strategy_delta: null }
    }
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--check', 'src/helper.mjs'], cwd: root }]
  },
}

export const case10c = {
  case_id: 'case-10c-security-nonblocking-medium',
  task_class: 'security_nonblocking',
  task: 'Add a calculator src/eval-calc.mjs that evaluates an expression. Keep syntax valid.',
  max_attempts: 2,
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    research_expected: ['src/eval-calc.mjs'],
    decision: 'FIX',
    reason_code: 'NON_BLOCKING_REVIEW_FINDINGS',
    first_bad_boundary: 'REVIEWS',
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: true,
    plan_gate_approved: true,
    build_status: 'SUCCESS',
    verify_passed: true,
    phase: 'PIPELINE',
    security_review: 'PASS',
    security_blocking: false,
  },
  planText: `# Plan
## Targets
- src/eval-calc.mjs — add expression evaluator
## Acceptance Criteria
- src/eval-calc.mjs is syntactically valid
## Required Tests
- node --check src/eval-calc.mjs
## Risks
- none
## Build Scope
- files: src/eval-calc.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'eval-calc.mjs'), 'export function evaluate(expression) { return Number(expression) }\n', 'utf8')
  },
  buildExecutor() {
    return async (buildInput) => {
      const root = buildInput.task.repository
      await fs.writeFile(path.join(root, 'src', 'eval-calc.mjs'), 'export function evaluate(expression) { return eval(expression) }\n', 'utf8')
      return { changed_files: ['src/eval-calc.mjs'], errors: [], strategy_delta: null }
    }
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--check', 'src/eval-calc.mjs'], cwd: root }]
  },
}

export const case10d = {
  case_id: 'case-10d-security-clean',
  task_class: 'security_clean',
  task: 'Add a pure function src/clean.mjs with no external side effects. Keep syntax valid.',
  max_attempts: 2,
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    research_expected: ['src/clean.mjs'],
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: true,
    plan_gate_approved: true,
    build_status: 'SUCCESS',
    verify_passed: true,
    phase: 'PIPELINE',
    security_review: 'PASS',
    security_blocking: false,
  },
  planText: `# Plan
## Targets
- src/clean.mjs — add pure function
## Acceptance Criteria
- src/clean.mjs is syntactically valid
## Required Tests
- node --check src/clean.mjs
## Risks
- none
## Build Scope
- files: src/clean.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'clean.mjs'), 'export function identity(value) { return value }\n', 'utf8')
  },
  buildExecutor() {
    return async (buildInput) => {
      const root = buildInput.task.repository
      await fs.writeFile(path.join(root, 'src', 'clean.mjs'), 'export function identity(value) { return value }\n', 'utf8')
      return { changed_files: ['src/clean.mjs'], errors: [], strategy_delta: null }
    }
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--check', 'src/clean.mjs'], cwd: root }]
  },
}

// ---------------------------------------------------------------------------
// Case 11 — Contract invalid  ->  BLOCKED CONTRACT_INVALID (TASK boundary)
// ---------------------------------------------------------------------------
export const case11 = {
  case_id: 'case-11-contract-invalid',
  task_class: 'contract_invalid',
  task: '',
  max_attempts: 2,
  expected: {
    required_expected: [],
    research_expected: [],
    decision: 'BLOCKED',
    reason_code: 'CONTRACT_INVALID',
    first_bad_boundary: 'TASK',
    attempt_count: 1,
    retry_count: 0,
    phase: 'FAILED_ENTRY',
    worker_called: false,
  },
  planText: `# Plan
## Targets
- src/x.mjs
## Acceptance Criteria
- x exists
## Required Tests
- node --check src/x.mjs
## Risks
- none
## Build Scope
- files: src/x.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'x.mjs'), 'export const x = 1\n', 'utf8')
  },
  buildExecutor() {
    return async () => ({ changed_files: [], errors: ['worker must never be called'], strategy_delta: null })
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--check', 'src/x.mjs'], cwd: root }]
  },
}

// ---------------------------------------------------------------------------
// Case 12 — Plan Gate rejection  ->  BLOCKED at PLAN_GATE, build never invoked
// ---------------------------------------------------------------------------
export const case12 = {
  case_id: 'case-12-plan-gate-reject',
  task_class: 'plan_gate_reject',
  task: 'Implement double(x) in src/double.mjs so double(4) returns 8.',
  max_attempts: 2,
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    research_expected: ['src/double.mjs','test/double.test.mjs'],
    decision: 'BLOCKED',
    reason_code: 'ACCEPTANCE_CRITERIA_MISSING',
    first_bad_boundary: 'PLAN_GATE',
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: true,
    plan_gate_approved: false,
    phase: 'PIPELINE',
    worker_called: false,
  },
  planText: `# Plan
## Targets
- src/double.mjs — implement double
## Required Tests
- node --test test/double.test.mjs
## Risks
- none
## Build Scope
- files: src/double.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'double.mjs'), 'export function double(x) { return x * 2 }\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'double.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { double } from '../src/double.mjs'\ntest('double works', () => { assert.equal(double(4), 8) })\n", 'utf8')
  },
  buildExecutor() {
    return async () => ({ changed_files: [], errors: ['worker must never be called'], strategy_delta: null })
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/double.test.mjs'], cwd: root }]
  },
}

// ---------------------------------------------------------------------------
// Case 13 — fehlende required capability (git)  ->  BLOCKED at BASELINE
// ---------------------------------------------------------------------------
export const case13 = {
  case_id: 'case-13-missing-required-capability',
  task_class: 'missing_required_capability',
  task: 'Commit the fix to the feature branch and prepare the change summary. Keep the file change minimal.',
  max_attempts: 2,
  capability_status: { git: 'MISSING' },
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'git', 'write', 'test'],
    research_expected: ['src/note.mjs'],
    decision: 'BLOCKED',
    reason_code: 'BLOCKED_MISSING_REQUIRED_CAPABILITY',
    first_bad_boundary: 'BASELINE',
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: false,
    phase: 'BLOCKED_ENTRY',
    worker_called: false,
  },
  planText: `# Plan
## Targets
- src/note.mjs — add note
## Acceptance Criteria
- note exists
## Required Tests
- node --check src/note.mjs
## Risks
- git unavailable
## Build Scope
- files: src/note.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'note.mjs'), 'export const note = "x"\n', 'utf8')
  },
  buildExecutor() {
    return async () => ({ changed_files: [], errors: ['worker must never be called'], strategy_delta: null })
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--check', 'src/note.mjs'], cwd: root }]
  },
}

// ---------------------------------------------------------------------------
// Case 14 — run_id replacement by worker  ->  CONTRACT_INVALID abort
// ---------------------------------------------------------------------------
export const case14 = {
  case_id: 'case-14-run-id-replacement',
  task_class: 'run_id_replacement',
  task: 'Implement negate(x) in src/negate.mjs so negate(5) returns -5.',
  max_attempts: 2,
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    research_expected: ['src/negate.mjs','test/negate.test.mjs'],
    decision: 'BLOCKED',
    reason_code: 'CONTRACT_INVALID',
    first_bad_boundary: null,
    attempt_count: 1,
    retry_count: 0,
    phase: 'ABORTED',
    worker_called: true,
  },
  planText: `# Plan
## Targets
- src/negate.mjs — implement negate
## Acceptance Criteria
- negate(5) returns -5
## Required Tests
- node --test test/negate.test.mjs
## Risks
- none
## Build Scope
- files: src/negate.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'negate.mjs'), 'export function negate(x) { return -x }\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'negate.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { negate } from '../src/negate.mjs'\ntest('negate works', () => { assert.equal(negate(5), -5) })\n", 'utf8')
  },
  buildExecutor() {
    return async () => ({ run_id: 'worker-replaced-run-id', changed_files: [], errors: [], strategy_delta: null })
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/negate.test.mjs'], cwd: root }]
  },
}

// ---------------------------------------------------------------------------
// Case 15 — CLI canonical entry (scripts/run-task.mjs subprocess)  ->  DONE
// ---------------------------------------------------------------------------
export const case15 = {
  case_id: 'case-15-cli-canonical-entry',
  task_class: 'cli_entry',
  task: 'Fix the bug in src/calc3.mjs so that triple(3) returns 9. Keep the test green.',
  max_attempts: 2,
  cli: true,
  executorSource: `import fs from 'node:fs/promises'
import path from 'node:path'
export async function execute(buildInput) {
  const root = buildInput.task.repository
  await fs.writeFile(path.join(root, 'src', 'calc3.mjs'), 'export function triple(x) { return x * 3 }\\n', 'utf8')
  return { changed_files: ['src/calc3.mjs'], errors: [], strategy_delta: null }
}
`,
  expected: {
    required_expected: ['repository', 'filesystem', 'runtime', 'write', 'test'],
    research_expected: ['src/calc3.mjs','test/calc3.test.mjs'],
    decision: 'DONE',
    reason_code: 'ALL_HARD_GATES_GREEN',
    first_bad_boundary: null,
    attempt_count: 1,
    retry_count: 0,
    baseline_approved: true,
    plan_gate_approved: true,
    build_status: 'SUCCESS',
    verify_passed: true,
    phase: 'PIPELINE',
  },
  planText: `# Plan
## Targets
- src/calc3.mjs — fix triple
## Acceptance Criteria
- triple(3) returns 9
- test/calc3.test.mjs passes
## Required Tests
- node --test test/calc3.test.mjs
## Risks
- none
## Build Scope
- files: src/calc3.mjs
`,
  async setup(root) {
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.mkdir(path.join(root, 'test'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'calc3.mjs'), 'export function triple(x) { return x + 3 }\n', 'utf8')
    await fs.writeFile(path.join(root, 'test', 'calc3.test.mjs'),
      "import test from 'node:test'\nimport assert from 'node:assert/strict'\nimport { triple } from '../src/calc3.mjs'\ntest('triple works', () => { assert.equal(triple(3), 9) })\n", 'utf8')
  },
  buildExecutor() {
    return async (buildInput) => {
      const root = buildInput.task.repository
      await fs.writeFile(path.join(root, 'src', 'calc3.mjs'), 'export function triple(x) { return x * 3 }\n', 'utf8')
      return { changed_files: ['src/calc3.mjs'], errors: [], strategy_delta: null }
    }
  },
  verifyChecks(root) {
    return [{ command: process.execPath, args: ['--test', 'test/calc3.test.mjs'], cwd: root }]
  },
}

export const CORPUS = [
  case01, case02, case03, case04, case05, case06,
  case07a, case07b, case08, case09,
  case10a, case10b, case10c, case10d,
  case11, case12, case13, case14, case15,
]

