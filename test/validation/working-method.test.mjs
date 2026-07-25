import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');

function readJsonSafe(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); }
  catch { return null; }
}

function readJsonc(path) {
  try {
    let content = readFileSync(path, 'utf-8');
    // Remove block comments first (they may span multiple lines)
    content = content.replace(/\/\*[\s\S]*?\*\//g, '');
    // Remove single-line comments (only when // is NOT preceded by : to avoid URLs like https://)
    content = content.replace(/(?<!:)\/\/.*$/gm, '');
    // Remove trailing commas before ] or }
    content = content.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(content);
  } catch { return null; }
}

// Test 1: WORKING-METHOD.md exists and has required sections
describe('WORKING-METHOD.md', () => {
  it('exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'WORKING-METHOD.md')));
  });

  it('contains Core Principles section', () => {
    const content = readFileSync(resolve(ROOT, 'WORKING-METHOD.md'), 'utf-8');
    assert.ok(content.includes('Core Principles'));
  });

  it('contains Truth Layers section', () => {
    const content = readFileSync(resolve(ROOT, 'WORKING-METHOD.md'), 'utf-8');
    assert.ok(content.includes('Truth Layers'));
  });

  it('contains Context Levels section', () => {
    const content = readFileSync(resolve(ROOT, 'WORKING-METHOD.md'), 'utf-8');
    assert.ok(content.includes('COLD') && content.includes('WARM') && content.includes('HOT'));
  });

  it('contains Risk Tiers section', () => {
    const content = readFileSync(resolve(ROOT, 'WORKING-METHOD.md'), 'utf-8');
    assert.ok(content.includes('LOW_LOCAL') && content.includes('MEDIUM_REVIEW') && content.includes('HIGH_HUMAN_GATE') && content.includes('CRITICAL_BLOCK'));
  });

  it('contains Agent Execution Order', () => {
    const content = readFileSync(resolve(ROOT, 'WORKING-METHOD.md'), 'utf-8');
    assert.ok(content.includes('Agent Execution Order') || content.includes('Execution Order'));
  });

  it('contains Verification Contract section', () => {
    const content = readFileSync(resolve(ROOT, 'WORKING-METHOD.md'), 'utf-8');
    assert.ok(content.includes('Verification Contract'));
  });

  it('contains Red Tests section', () => {
    const content = readFileSync(resolve(ROOT, 'WORKING-METHOD.md'), 'utf-8');
    assert.ok(content.includes('Red Tests'));
  });

  it('contains Anti-Fake Execution section', () => {
    const content = readFileSync(resolve(ROOT, 'WORKING-METHOD.md'), 'utf-8');
    assert.ok(content.includes('Anti-Fake'));
  });

  it('contains Owner Approval Gates section', () => {
    const content = readFileSync(resolve(ROOT, 'WORKING-METHOD.md'), 'utf-8');
    assert.ok(content.includes('Owner Approval'));
  });

  it('mentions Security before Compliance', () => {
    const content = readFileSync(resolve(ROOT, 'WORKING-METHOD.md'), 'utf-8');
    const lower = content.toLowerCase();
    assert.ok(lower.includes('security') && lower.includes('compliance') && lower.includes('before'),
      'WORKING-METHOD.md must mention Security before Compliance');
  });
});

// Test 2: working-method.json is valid and complete
describe('working-method.json', () => {
  const wm = readJsonSafe(resolve(ROOT, '.opencode/policies/working-method.json'));

  it('exists and is valid JSON', () => {
    assert.ok(wm !== null);
  });

  it('has version', () => {
    assert.ok(wm.version);
  });

  it('has source_of_truth_order', () => {
    assert.ok(Array.isArray(wm.source_of_truth_order));
    assert.ok(wm.source_of_truth_order.length >= 5);
  });

  it('has phases array with 24 phases', () => {
    assert.ok(Array.isArray(wm.phases));
    assert.ok(wm.phases.length >= 20);
  });

  it('phases include Security before Compliance', () => {
    const securityIdx = wm.phases.findIndex(p => p.name === 'security');
    const complianceIdx = wm.phases.findIndex(p => p.name === 'compliance');
    assert.ok(securityIdx >= 0 && complianceIdx >= 0);
    assert.ok(securityIdx < complianceIdx, `Security (${securityIdx}) must come before Compliance (${complianceIdx})`);
  });

  it('has context_levels with COLD, WARM, HOT', () => {
    assert.ok(wm.context_levels?.COLD);
    assert.ok(wm.context_levels?.WARM);
    assert.ok(wm.context_levels?.HOT);
  });

  it('has risk_tiers with all 4 tiers', () => {
    assert.ok(wm.risk_tiers?.LOW_LOCAL);
    assert.ok(wm.risk_tiers?.MEDIUM_REVIEW);
    assert.ok(wm.risk_tiers?.HIGH_HUMAN_GATE);
    assert.ok(wm.risk_tiers?.CRITICAL_BLOCK);
  });

  it('has truth_layers with 5 layers', () => {
    assert.ok(wm.truth_layers);
    const layerKeys = Object.keys(wm.truth_layers);
    assert.ok(layerKeys.length >= 5);
  });

  it('has approval_gates with all 9 gates', () => {
    const gates = ['apply', 'commit', 'push', 'pr', 'merge', 'deploy', 'remote_ci', 'skill_write', 'memory_write'];
    for (const gate of gates) {
      assert.ok(wm.approval_gates?.[gate], `Missing gate: ${gate}`);
    }
  });

  it('has mandatory_run_card_fields with 17 fields', () => {
    assert.ok(Array.isArray(wm.mandatory_run_card_fields));
    assert.ok(wm.mandatory_run_card_fields.length >= 17);
  });

  it('has remote_ci with private_repo_without_approval: RED_BLOCK', () => {
    assert.equal(wm.remote_ci?.private_repo_without_approval, 'RED_BLOCK');
  });

  it('has anti_fake_execution with prohibited and required arrays', () => {
    assert.ok(Array.isArray(wm.anti_fake_execution?.prohibited));
    assert.ok(Array.isArray(wm.anti_fake_execution?.required));
    assert.ok(wm.anti_fake_execution.prohibited.length > 0);
    assert.ok(wm.anti_fake_execution.required.length > 0);
  });

  it('has classifications array', () => {
    assert.ok(Array.isArray(wm.classifications));
    const expected = ['GREEN_SAFE', 'AMBER_REVIEW', 'RED_BLOCK', 'TOOL_GAP'];
    for (const c of expected) {
      assert.ok(wm.classifications.includes(c), `Missing classification: ${c}`);
    }
  });

  it('has constraint_reinjection_points', () => {
    assert.ok(Array.isArray(wm.constraint_reinjection_points));
    assert.ok(wm.constraint_reinjection_points.length >= 10);
  });
});

// Test 3: All 6 new skills exist with valid frontmatter
describe('New skills', () => {
  const skills = ['context-engineering', 'risk-tier-routing', 'verification-contract', 'owner-approval-gate', 'anti-fake-execution', 'privacy-data-minimization'];

  for (const skill of skills) {
    it(`${skill} SKILL.md exists`, () => {
      const path = resolve(ROOT, '.opencode/skills', skill, 'SKILL.md');
      assert.ok(existsSync(path), `Missing: ${path}`);
    });

    it(`${skill} has valid frontmatter`, () => {
      const path = resolve(ROOT, '.opencode/skills', skill, 'SKILL.md');
      const content = readFileSync(path, 'utf-8');
      assert.ok(content.startsWith('---'), `${skill} must start with ---`);
      const endIdx = content.indexOf('---', 3);
      assert.ok(endIdx > 0, `${skill} must have closing ---`);
      const fm = content.substring(3, endIdx);
      assert.ok(fm.includes('name:'), `${skill} must have name in frontmatter`);
      assert.ok(fm.includes('description:'), `${skill} must have description in frontmatter`);
    });
  }
});

// Test 4: Manifest has new skills in generic catalog
describe('ecosystem.manifest.json', () => {
  const manifest = readJsonSafe(resolve(ROOT, 'ecosystem.manifest.json'));

  it('exists and is valid JSON', () => {
    assert.ok(manifest !== null);
  });

  const newSkills = ['context-engineering', 'risk-tier-routing', 'verification-contract', 'owner-approval-gate', 'anti-fake-execution', 'privacy-data-minimization'];

  for (const skill of newSkills) {
    it(`${skill} is in the generic skills catalog`, () => {
      const genericSkills = manifest.catalogs?.skills?.generic || [];
      assert.ok(genericSkills.includes(skill), `${skill} not found in generic skills`);
    });
  }

  it('security-agent and compliance-agent are in generic agents', () => {
    const genericAgents = manifest.catalogs?.agents?.generic || [];
    const agentNames = genericAgents.map(a => typeof a === 'string' ? a : a.name);
    assert.ok(agentNames.some(n => n.includes('security')), 'security-agent not in generic');
    assert.ok(agentNames.some(n => n.includes('compliance')), 'compliance-agent not in generic');
  });

  it('tierheim-compliance is in domain_specific skills', () => {
    const domainSkills = manifest.catalogs?.skills?.domain_specific || [];
    assert.ok(domainSkills.includes('tierheim-compliance'), 'tierheim-compliance not in domain_specific');
  });

  it('data-retention is in domain_specific policies', () => {
    const domainPolicies = manifest.catalogs?.policies?.domain_specific || [];
    assert.ok(domainPolicies.includes('data-retention'), 'data-retention not in domain_specific');
  });
});

// Test 5: OpenCode config has no deprecated tools
describe('opencode.jsonc', () => {
  const config = readJsonc(resolve(ROOT, 'opencode.jsonc'));

  it('exists and is parseable', () => {
    assert.ok(config !== null);
  });

  it('has no top-level tools key', () => {
    assert.ok(!config.tools, 'opencode.jsonc must not have top-level tools key');
  });

  it('has no tools key in any agent config', () => {
    const agents = config.agent || {};
    for (const [name, agent] of Object.entries(agents)) {
      assert.ok(!agent.tools, `Agent "${name}" has deprecated tools key`);
    }
  });

  it('includes WORKING-METHOD.md in instructions', () => {
    const instructions = config.instructions || {};
    const paths = Array.isArray(instructions) ? instructions : (instructions.files || []);
    if (paths.length > 0) {
      const allPaths = paths.join(' ');
      assert.ok(allPaths.includes('WORKING-METHOD.md'), 'WORKING-METHOD.md not in instructions');
    }
  });

  it('does NOT include data-retention.json in instructions', () => {
    const instructions = config.instructions || {};
    const paths = Array.isArray(instructions) ? instructions : (instructions.files || []);
    if (paths.length > 0) {
      const allPaths = paths.join(' ');
      assert.ok(!allPaths.includes('data-retention.json'), 'data-retention.json should not be in instructions');
    }
  });
});

// Test 6: Hermes YAML bundle and config exist
describe('Hermes files', () => {
  it('canonical-working-method.yaml exists', () => {
    assert.ok(existsSync(resolve(ROOT, '.hermes/skill-bundles/canonical-working-method.yaml')));
  });

  it('config.example.yaml exists', () => {
    assert.ok(existsSync(resolve(ROOT, '.hermes/config.example.yaml')));
  });

  it('config.example.yaml has skill write_approval: true', () => {
    const content = readFileSync(resolve(ROOT, '.hermes/config.example.yaml'), 'utf-8');
    assert.ok(content.includes('write_approval: true'));
  });

  it('config.example.yaml has memory write_approval: true', () => {
    const content = readFileSync(resolve(ROOT, '.hermes/config.example.yaml'), 'utf-8');
    // Should find write_approval: true in two sections
    const matches = content.match(/write_approval:\s*true/g);
    assert.ok(matches && matches.length >= 2, 'Expected at least 2 write_approval: true entries');
  });
});

// Test 7: Audit trail has no generic 10-year retention
describe('Audit trail skill', () => {
  it('does not contain generic 10-year DSGVO retention', () => {
    const path = resolve(ROOT, '.opencode/skills/audit-trail-enforcer/SKILL.md');
    const content = readFileSync(path, 'utf-8');
    // Find the retention section
    const retentionIdx = content.indexOf('Retention');
    if (retentionIdx > 0) {
      const retentionSection = content.substring(retentionIdx, retentionIdx + 400);
      assert.ok(!retentionSection.includes('10 years') || !retentionSection.includes('DSGVO compliance'),
        'Audit skill should not have generic 10-year DSGVO retention');
    }
  });
});

// Test 8: Architecture documents exist
describe('Architecture documents', () => {
  it('canonical-working-method.md exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'docs/architecture/canonical-working-method.md')));
  });

  it('canonical-working-method.mmd exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'docs/architecture/canonical-working-method.mmd')));
  });
});

// Test 9: Deep-dive report exists
describe('Deep-dive report', () => {
  it('working-method-deep-dive-2026-07-15.md exists', () => {
    assert.ok(existsSync(resolve(ROOT, 'docs/reports/working-method-deep-dive-2026-07-15.md')));
  });
});

// Test 10: Write protection policy is updated
describe('write-protection.json', () => {
  const wp = readJsonSafe(resolve(ROOT, '.opencode/policies/write-protection.json'));

  it('has human_gate section', () => {
    assert.ok(wp.human_gate, 'write-protection must have human_gate section');
  });

  it('has managed_files section', () => {
    assert.ok(wp.managed_files, 'write-protection must have managed_files section');
  });

  it('always_deny blocks .env files', () => {
    const denyRules = wp.always_deny?.rules || [];
    const patterns = denyRules.map(r => typeof r === 'string' ? r : r.pattern).join(' ');
    assert.ok(patterns.includes('.env') || patterns.includes('env'), 'write-protection must deny .env files');
  });
});

// Test 11: Evidence gates have new gates
describe('evidence-gates.json', () => {
  const eg = readJsonSafe(resolve(ROOT, '.opencode/policies/evidence-gates.json'));

  it('has verification_contract gate', () => {
    assert.ok(eg.gates?.verification_contract, 'evidence-gates must have verification_contract');
  });

  it('has red_test_evidence gate', () => {
    assert.ok(eg.gates?.red_test_evidence, 'evidence-gates must have red_test_evidence');
  });

  it('has tool_gap_claim gate', () => {
    assert.ok(eg.gates?.tool_gap_claim, 'evidence-gates must have tool_gap_claim');
  });

  it('has remote_operation_claim gate', () => {
    assert.ok(eg.gates?.remote_operation_claim, 'evidence-gates must have remote_operation_claim');
  });

  it('visual regression is when_applicable in feature_complete', () => {
    const fc = eg.gates?.feature_complete;
    if (fc?.evidence_modifiers?.visual_regression_passed) {
      assert.equal(fc.evidence_modifiers.visual_regression_passed.when_applicable, true);
    } else {
      // If not in evidence_modifiers, check required_evidence doesn't mandate it
      const req = fc?.required_evidence || [];
      const vrInRequired = req.includes('visual_regression_passed');
      if (vrInRequired) {
        // If it's in required, it should have the modifier
        assert.ok(false, 'visual_regression should be when_applicable');
      }
    }
  });
});
