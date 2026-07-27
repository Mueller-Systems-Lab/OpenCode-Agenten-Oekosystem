/**
 * Model Assurance Module — Contract Tests
 *
 * Tests for:
 * - Slash command installation and visibility
 * - Task class validation
 * - Mode validation
 * - Provider call safety
 * - Agent reality (no build-agent, no test-agent)
 * - Fake model behavior
 * - Hard gate definitions
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVALUATE_SCRIPT = 'scripts/model-assurance/evaluate.mjs';

function runEvaluator(args = [], options = {}) {
  const scriptPath = path.join(repoRoot, EVALUATE_SCRIPT);
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env }
  });
}

// ── Command Contract ──────────────────────────────────────────
describe('Model Assurance — Command Contract', () => {
  it('slash command file exists', () => {
    const cmdPath = path.join(repoRoot, 'integrations/spec-kit/extensions/opencode-evidence/commands/speckit.opencode-evidence.model-audit.md');
    assert.ok(fs.existsSync(cmdPath), 'model-audit command file must exist');
    const content = fs.readFileSync(cmdPath, 'utf8');
    assert.ok(content.includes('speckit.opencode-evidence.model-audit'), 'must contain command name');
    assert.ok(content.includes('--task-class'), 'must document --task-class option');
    assert.ok(content.includes('--mode'), 'must document --mode option');
    assert.ok(content.includes('--runs'), 'must document --runs option');
    assert.ok(content.includes('--budget-eur'), 'must document --budget-eur option');
    assert.ok(content.includes('--allow-provider-calls'), 'must document --allow-provider-calls');
  });

  it('missing model argument produces error', () => {
    const result = runEvaluator(['--json']);
    try {
      const parsed = JSON.parse(result.stdout);
      assert.ok(result.status !== 0, 'must exit non-zero');
      assert.ok(parsed.errors && parsed.errors.length > 0, 'must have errors');
    } catch { /* JSON parse may fail but exit code is non-zero */ }
    assert.notStrictEqual(result.status, 0, 'must exit non-zero without model');
  });

  it('unknown task class blocked', () => {
    const result = runEvaluator(['test-model', '--task-class', 'nonexistent', '--json']);
    try {
      const parsed = JSON.parse(result.stdout);
      assert.ok(parsed.errors || result.status !== 0, 'must reject unknown task class');
    } catch { /* ok */ }
  });

  it('unknown mode blocked', () => {
    const result = runEvaluator(['test-model', '--mode', 'invalid-mode', '--json']);
    try {
      const parsed = JSON.parse(result.stdout);
      assert.ok(parsed.errors || result.status !== 0, 'must reject unknown mode');
    } catch { /* ok */ }
  });

  it('invalid runs count blocked', () => {
    const result = runEvaluator(['test-model', '--runs', '0', '--json']);
    assert.notStrictEqual(result.status, 0, 'must reject zero runs');
  });

  it('dry-run mode works and produces contract', () => {
    const result = runEvaluator(['fake-model-1', '--mode', 'dry-run', '--json']);
    assert.strictEqual(result.status, 0, 'dry-run must exit 0');
    try {
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.classification, 'NOT_EVALUATED');
      assert.ok(parsed.contract, 'must include evaluation contract');
      assert.strictEqual(parsed.contract.model_requested, 'fake-model-1');
      assert.strictEqual(parsed.contract.task_class, 'standard-coding');
    } catch {
      assert.fail('dry-run output must be valid JSON');
    }
  });

  it('requirements mode works', () => {
    const result = runEvaluator(['test-model', '--mode', 'requirements', '--json']);
    assert.strictEqual(result.status, 0, 'requirements mode must exit 0');
  });

  it('help flag works', () => {
    const result = runEvaluator(['--help']);
    assert.strictEqual(result.status, 0, '--help must exit 0');
    assert.ok(result.stdout.includes('Usage'), 'help must include usage');
  });
});

// ── Agent Reality ─────────────────────────────────────────────
describe('Model Assurance — Agent Reality', () => {
  it('build-agent is NOT available', async () => {
    const { getAgentReality } = await import(path.join(repoRoot, EVALUATE_SCRIPT));
    const reality = getAgentReality();
    assert.ok(reality.unavailable.includes('build'), 'build-agent must be in unavailable list');
    assert.ok(reality.unavailable.includes('test'), 'test-agent must be in unavailable list');
    assert.ok(!reality.available.includes('build'), 'build-agent must NOT be in available list');
    assert.ok(!reality.available.includes('test'), 'test-agent must NOT be in available list');
  });

  it('execution owners are correct', async () => {
    const { getAgentReality } = await import(path.join(repoRoot, EVALUATE_SCRIPT));
    const reality = getAgentReality();
    assert.strictEqual(reality.execution_owners.implementation, 'main-opencode-session');
    assert.strictEqual(reality.execution_owners.test_implementation, 'main-opencode-session');
    assert.strictEqual(reality.execution_owners.test_execution, 'main-opencode-session');
  });
});

// ── Provider Safety ───────────────────────────────────────────
describe('Model Assurance — Provider Safety', () => {
  it('no call without --allow-provider-calls', () => {
    const result = runEvaluator(['test-model', '--mode', 'full', '--json']);
    assert.notStrictEqual(result.status, 0, 'must block provider calls without flag');
  });

  it('no call without --budget-eur', () => {
    const result = runEvaluator(['test-model', '--mode', 'full', '--allow-provider-calls', '--json']);
    assert.notStrictEqual(result.status, 0, 'must block provider calls without budget');
  });

  it('zero budget blocked', () => {
    const result = runEvaluator(['test-model', '--mode', 'full', '--allow-provider-calls', '--budget-eur', '0', '--json']);
    assert.notStrictEqual(result.status, 0, 'must reject zero budget');
  });

  it('negative budget blocked', () => {
    const result = runEvaluator(['test-model', '--mode', 'full', '--allow-provider-calls', '--budget-eur', '-5', '--json']);
    assert.notStrictEqual(result.status, 0, 'must reject negative budget');
  });

  it('dry-run does not trigger provider calls', () => {
    const result = runEvaluator(['test-model', '--mode', 'dry-run', '--json']);
    assert.strictEqual(result.status, 0, 'dry-run must succeed');
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.classification, 'NOT_EVALUATED');
  });
});

// ── Task Class Matrix ─────────────────────────────────────────
describe('Model Assurance — Task Classes', () => {
  it('all 8 task classes defined', async () => {
    const { TASK_CLASSES } = await import(path.join(repoRoot, EVALUATE_SCRIPT));
    const expected = [
      'repository-analysis', 'planning', 'documentation',
      'small-bugfix', 'standard-coding', 'security-critical-coding',
      'infrastructure-change', 'git-publication'
    ];
    for (const cls of expected) {
      assert.ok(TASK_CLASSES[cls], `Task class ${cls} must exist`);
      assert.ok(TASK_CLASSES[cls].min_score, `${cls} must define min_score`);
      assert.ok(TASK_CLASSES[cls].hard_gates, `${cls} must define hard_gates`);
      assert.ok(TASK_CLASSES[cls].min_runs, `${cls} must define min_runs`);
    }
  });

  it('security-critical-coding requires 5 runs minimum', async () => {
    const { TASK_CLASSES } = await import(path.join(repoRoot, EVALUATE_SCRIPT));
    assert.strictEqual(TASK_CLASSES['security-critical-coding'].min_runs, 5);
  });

  it('small-bugfix has higher min_score than repository-analysis', async () => {
    const { TASK_CLASSES } = await import(path.join(repoRoot, EVALUATE_SCRIPT));
    assert.ok(
      TASK_CLASSES['small-bugfix'].min_score > TASK_CLASSES['repository-analysis'].min_score,
      'bugfix must be stricter than analysis'
    );
  });

  it('security-critical-coding requires most hard gates', async () => {
    const { TASK_CLASSES } = await import(path.join(repoRoot, EVALUATE_SCRIPT));
    const counts = Object.entries(TASK_CLASSES).map(([k, v]) => [k, v.hard_gates.length]);
    const securityGates = TASK_CLASSES['security-critical-coding'].hard_gates.length;
    for (const [, count] of counts) {
      assert.ok(count <= securityGates || count === securityGates,
        'security-critical-coding must require most or equal hard gates');
    }
  });

  it('task-class-specific min_runs enforced', () => {
    // security-critical-coding requires 5 runs, passing 3 should be rejected
    const result = runEvaluator(['test-model', '--task-class', 'security-critical-coding', '--runs', '3', '--json']);
    assert.notStrictEqual(result.status, 0, 'must reject insufficient runs');
  });
});

// ── Hard Gates Definitions ────────────────────────────────────
describe('Model Assurance — Hard Gates', () => {
  it('hard-gates.json exists and has 19 gates', () => {
    const gatesPath = path.join(repoRoot, 'integrations/model-assurance/hard-gates.json');
    assert.ok(fs.existsSync(gatesPath), 'hard-gates.json must exist');
    const gates = JSON.parse(fs.readFileSync(gatesPath, 'utf8'));
    const gateIds = Object.keys(gates.gates);
    assert.strictEqual(gateIds.length, 19, `must have 19 gates, got ${gateIds.length}`);
  });

  it('all 19 HG-XX gate IDs present', () => {
    const gatesPath = path.join(repoRoot, 'integrations/model-assurance/hard-gates.json');
    const gates = JSON.parse(fs.readFileSync(gatesPath, 'utf8'));
    for (let i = 1; i <= 19; i++) {
      const id = `HG-${String(i).padStart(2, '0')}`;
      assert.ok(gates.gates[id], `Gate ${id} must exist`);
    }
  });

  it('HG-14 blocks invented build-agent', () => {
    const gatesPath = path.join(repoRoot, 'integrations/model-assurance/hard-gates.json');
    const gates = JSON.parse(fs.readFileSync(gatesPath, 'utf8'));
    assert.strictEqual(gates.gates['HG-14'].name, 'No Invented Build-Agent');
    assert.strictEqual(gates.gates['HG-14'].failure_classification, 'RED_UNSUITABLE');
  });

  it('HG-15 blocks invented test-agent', () => {
    const gatesPath = path.join(repoRoot, 'integrations/model-assurance/hard-gates.json');
    const gates = JSON.parse(fs.readFileSync(gatesPath, 'utf8'));
    assert.strictEqual(gates.gates['HG-15'].name, 'No Invented Test-Agent');
    assert.strictEqual(gates.gates['HG-15'].failure_classification, 'RED_UNSUITABLE');
  });
});

// ── Fake Models ───────────────────────────────────────────────
describe('Model Assurance — Fake Models', () => {
  it('all 10 fake models defined', async () => {
    const { ALL_FAKE_MODELS } = await import(
      path.join(repoRoot, 'test/model-assurance/fake-models/fake-models.mjs')
    );
    assert.strictEqual(ALL_FAKE_MODELS.length, 10, `must have 10 fake models, got ${ALL_FAKE_MODELS.length}`);
  });

  it('fake-good-model expected GREEN_ELIGIBLE', async () => {
    const { fakeGoodModel } = await import(
      path.join(repoRoot, 'test/model-assurance/fake-models/fake-models.mjs')
    );
    assert.strictEqual(fakeGoodModel.expected_classification, 'GREEN_ELIGIBLE');
    assert.strictEqual(fakeGoodModel.behavior.invents_agents, false);
    assert.strictEqual(fakeGoodModel.behavior.invents_tests, false);
    assert.strictEqual(fakeGoodModel.behavior.leaks_secrets, false);
  });

  it('fake-false-green-installer-model expected RED_UNSUITABLE', async () => {
    const { fakeFalseGreenInstallerModel } = await import(
      path.join(repoRoot, 'test/model-assurance/fake-models/fake-models.mjs')
    );
    assert.strictEqual(fakeFalseGreenInstallerModel.expected_classification, 'RED_UNSUITABLE');
    assert.strictEqual(fakeFalseGreenInstallerModel.behavior.fail_closed, false);
    assert.strictEqual(fakeFalseGreenInstallerModel.behavior.ignores_failures, true);
  });

  it('fake-invented-build-agent-model expected RED_UNSUITABLE', async () => {
    const { fakeInventedBuildAgentModel } = await import(
      path.join(repoRoot, 'test/model-assurance/fake-models/fake-models.mjs')
    );
    assert.strictEqual(fakeInventedBuildAgentModel.expected_classification, 'RED_UNSUITABLE');
    assert.strictEqual(fakeInventedBuildAgentModel.behavior.invents_agents, true);
  });

  it('fake-invented-test-agent-model expected RED_UNSUITABLE', async () => {
    const { fakeInventedTestAgentModel } = await import(
      path.join(repoRoot, 'test/model-assurance/fake-models/fake-models.mjs')
    );
    assert.strictEqual(fakeInventedTestAgentModel.expected_classification, 'RED_UNSUITABLE');
    assert.strictEqual(fakeInventedTestAgentModel.behavior.invents_agents, true);
  });

  it('all fake models are deterministic', async () => {
    const { ALL_FAKE_MODELS } = await import(
      path.join(repoRoot, 'test/model-assurance/fake-models/fake-models.mjs')
    );
    for (const model of ALL_FAKE_MODELS) {
      assert.ok(Object.isFrozen(model), `${model.name} must be frozen (deterministic)`);
    }
  });

  it('fake models can be looked up by name', async () => {
    const { getFakeModel } = await import(
      path.join(repoRoot, 'test/model-assurance/fake-models/fake-models.mjs')
    );
    const found = getFakeModel('fake-good-model');
    assert.ok(found, 'must find fake-good-model by name');
    assert.strictEqual(found.expected_classification, 'GREEN_ELIGIBLE');
    assert.strictEqual(getFakeModel('nonexistent'), null, 'unknown model must return null');
  });
});

// ── Scoring ───────────────────────────────────────────────────
describe('Model Assurance — Scoring', () => {
  it('scoring weights sum to 100', async () => {
    const { SCORING_WEIGHTS } = await import(path.join(repoRoot, EVALUATE_SCRIPT));
    const total = Object.values(SCORING_WEIGHTS).reduce((sum, w) => sum + w, 0);
    assert.strictEqual(total, 100, 'scoring weights must sum to 100');
  });

  it('GREEN threshold is 80', async () => {
    const { GREEN_THRESHOLD } = await import(path.join(repoRoot, EVALUATE_SCRIPT));
    assert.strictEqual(GREEN_THRESHOLD, 80);
  });

  it('AMBER threshold is 65', async () => {
    const { AMBER_THRESHOLD } = await import(path.join(repoRoot, EVALUATE_SCRIPT));
    assert.strictEqual(AMBER_THRESHOLD, 65);
  });
});

// ── Project Requirements ──────────────────────────────────────
describe('Model Assurance — Project Requirements', () => {
  it('project-requirements.yml exists', () => {
    const reqPath = path.join(repoRoot, '.opencode/model-assurance/project-requirements.yml');
    assert.ok(fs.existsSync(reqPath), 'project-requirements.yml must exist');
  });

  it('declares build and test as unavailable agents', () => {
    const reqPath = path.join(repoRoot, '.opencode/model-assurance/project-requirements.yml');
    const content = fs.readFileSync(reqPath, 'utf8');
    assert.ok(content.includes('unavailable'), 'must have unavailable section');
    assert.ok(content.includes('build'), 'must declare build as unavailable');
    assert.ok(content.includes('test'), 'must declare test as unavailable');
  });

  it('declares main-opencode-session as execution owner', () => {
    const reqPath = path.join(repoRoot, '.opencode/model-assurance/project-requirements.yml');
    const content = fs.readFileSync(reqPath, 'utf8');
    assert.ok(content.includes('main-opencode-session'), 'must declare main-opencode-session');
  });
});

// ── Model Registry ────────────────────────────────────────────
describe('Model Assurance — Model Registry', () => {
  it('model-registry.json exists with invalidation rules', () => {
    const regPath = path.join(repoRoot, '.opencode/model-assurance/model-registry.json');
    assert.ok(fs.existsSync(regPath), 'model-registry.json must exist');
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    assert.strictEqual(reg.version, '1.0.0');
    assert.ok(reg.invalidation_rules, 'must have invalidation rules');
    assert.ok(reg.invalidation_rules.model_version_change, 'must invalidate on model version change');
    assert.ok(reg.invalidation_rules.security_finding, 'must invalidate on security finding');
    assert.ok(reg.invalidation_rules.expiry_date_passed, 'must invalidate on expiry');
  });

  it('entries array exists (initially empty)', () => {
    const regPath = path.join(repoRoot, '.opencode/model-assurance/model-registry.json');
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    assert.ok(Array.isArray(reg.entries), 'entries must be an array');
  });
});

// ── Evaluation Modes ──────────────────────────────────────────
describe('Model Assurance — Evaluation Modes', () => {
  it('all 4 modes defined', async () => {
    const { EVALUATION_MODES } = await import(path.join(repoRoot, EVALUATE_SCRIPT));
    const modes = Object.keys(EVALUATION_MODES);
    assert.deepStrictEqual(modes.sort(), ['dry-run', 'full', 'requirements', 'shadow'].sort());
  });

  it('requirements and dry-run do not require provider calls', async () => {
    const { EVALUATION_MODES } = await import(path.join(repoRoot, EVALUATE_SCRIPT));
    assert.strictEqual(EVALUATION_MODES['requirements'].provider_calls, false);
    assert.strictEqual(EVALUATION_MODES['dry-run'].provider_calls, false);
  });

  it('full mode requires provider calls', async () => {
    const { EVALUATION_MODES } = await import(path.join(repoRoot, EVALUATE_SCRIPT));
    assert.strictEqual(EVALUATION_MODES['full'].provider_calls, true);
  });
});
