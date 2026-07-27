// Red Tests: UX/UI Governed Layer
// These tests validate the UX/UI agent, skills, and detector.
// They are RED (fail) on any version without the UX/UI additions.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WORKTREE = process.env.OPCODE_UX_UI_WORKTREE || process.cwd();

function readJson(path) {
  let raw = readFileSync(join(WORKTREE, path), 'utf-8');
  // Use the same JSONC parsing logic as the rest of the codebase
  // Remove block comments first (they may span multiple lines)
  raw = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove single-line comments (only when // is NOT preceded by : to avoid URLs like https://)
  raw = raw.replace(/(?<!:)\/\/.*$/gm, '');
  // Remove trailing commas before ] or }
  raw = raw.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(raw);
}

function readText(path) {
  return readFileSync(join(WORKTREE, path), 'utf-8');
}

// ============================================================
// SECTION A: Detector Tests (Positive)
// ============================================================

describe('UX/UI Detector — Positive Cases', () => {

  it('A-01: frontend-ui-framework detector exists in manifest', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector, 'frontend-ui-framework detector must exist');
  });

  it('A-02: detector is conditional (not generic)', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.strictEqual(detector.domain, 'conditional', 'must be conditional, not generic');
  });

  it('A-03: detector recommends ux-flow-review skill', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.recommend.includes('ux-flow-review'), 'must recommend ux-flow-review');
  });

  it('A-04: detector recommends ui-design-system-review skill', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.recommend.includes('ui-design-system-review'), 'must recommend ui-design-system-review');
  });

  it('A-05: detector has React TSX signal', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.signals.includes('*.tsx'), 'must detect tsx files');
  });

  it('A-06: detector has Vue SFC signal', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.signals.includes('*.vue'), 'must detect vue files');
  });

  it('A-07: detector has Svelte signal', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.signals.includes('*.svelte'), 'must detect svelte files');
  });

  it('A-08: detector has Storybook signal', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.signals.includes('.storybook/'), 'must detect Storybook');
  });

  it('A-09: detector has Tailwind signal', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.signals.includes('tailwind.config.*'), 'must detect Tailwind');
  });

  it('A-10: detector has Next.js signal', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.signals.includes('next.config.*'), 'must detect Next.js');
  });

  it('A-11: detector has JSX signal', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.signals.includes('*.jsx'), 'must detect jsx files');
  });

  it('A-12: detector has stories files signal', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.signals.includes('*.stories.*'), 'must detect stories files');
  });

  it('A-13: detector has Astro signal', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.signals.includes('*.astro'), 'must detect astro files');
  });
});

// ============================================================
// SECTION B: Detector Tests (Negative — False Positive Prevention)
// ============================================================

describe('UX/UI Detector — Negative Cases (False Positive Prevention)', () => {

  it('B-01: detector does NOT trigger on package.json alone', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    // package.json is NOT in the signals list
    assert.ok(!detector.signals.includes('package.json'), 'must not trigger on package.json alone');
  });

  it('B-02: detector does NOT trigger on TypeScript alone', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    // *.ts alone is NOT in the signals list (only *.tsx)
    assert.ok(!detector.signals.includes('*.ts'), 'must not trigger on *.ts alone');
  });

  it('B-03: detector does NOT trigger on playwright.config alone (no UI)', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    // playwright.config is NOT in this detector's signals (belongs to frontend-playwright)
    assert.ok(!detector.signals.includes('playwright.config.*'), 'playwright.config alone must not trigger');
  });

  it('B-04: detector is conditional, not always active', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.notStrictEqual(detector.domain, 'generic', 'must not be generic (always active)');
  });
});

// ============================================================
// SECTION C: UX Review Agent — Definition and Permissions
// ============================================================

describe('UX Review Agent — Definition', () => {

  it('C-01: agent definition file exists', () => {
    assert.ok(existsSync(join(WORKTREE, '.opencode/agents/ux-review-agent.md')), 'ux-review-agent.md must exist');
  });

  it('C-02: agent registered in ecosystem manifest', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const agent = manifest.catalogs.agents.conditional.find(a => a.name === 'ux-review-agent');
    assert.ok(agent, 'ux-review-agent must be in conditional agents catalog');
  });

  it('C-03: agent description mentions read-only', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const agent = manifest.catalogs.agents.conditional.find(a => a.name === 'ux-review-agent');
    assert.ok(agent.description.toLowerCase().includes('read-only'), 'description must mention read-only');
  });

  it('C-04: agent registered in opencode.jsonc', () => {
    const config = readJson('opencode.jsonc');
    assert.ok(config.agent['ux-review-agent'], 'ux-review-agent must be in opencode.jsonc agent section');
  });

  it('C-05: agent mode is subagent', () => {
    const config = readJson('opencode.jsonc');
    assert.strictEqual(config.agent['ux-review-agent'].mode, 'subagent', 'must be subagent mode');
  });

  it('C-06: agent temperature is 0.0 (deterministic analysis)', () => {
    const config = readJson('opencode.jsonc');
    assert.strictEqual(config.agent['ux-review-agent'].temperature, 0.0, 'must use deterministic temperature');
  });
});

describe('UX Review Agent — Permissions (Read-Only)', () => {

  it('C-07: edit permission is deny (read-only)', () => {
    const config = readJson('opencode.jsonc');
    assert.strictEqual(config.agent['ux-review-agent'].permission.edit, 'deny', 'edit must be denied');
  });

  it('C-08: cannot delegate tasks (leaf node)', () => {
    const config = readJson('opencode.jsonc');
    const taskPerm = config.agent['ux-review-agent'].permission.task;
    assert.ok(taskPerm['*'] === 'deny', 'task delegation must be denied (leaf node)');
  });

  it('C-09: bash limited to read-only git/grep commands', () => {
    const config = readJson('opencode.jsonc');
    const bash = config.agent['ux-review-agent'].permission.bash;
    assert.ok(bash['*'] === 'deny', 'wildcard bash must be denied');
    assert.ok(Object.keys(bash).length <= 5, 'only git diff, git log, grep, rg, and wildcard deny allowed');
  });

  it('C-10: force push check — no push capability', () => {
    const config = readJson('opencode.jsonc');
    const bash = config.agent['ux-review-agent'].permission.bash;
    // No push command should be allowed
    const hasPush = Object.keys(bash).some(k => k.includes('push'));
    assert.strictEqual(hasPush, false, 'no push capability must exist');
  });

  it('C-11: can load ux-flow-review skill', () => {
    const config = readJson('opencode.jsonc');
    const skills = config.agent['ux-review-agent'].permission.skill;
    assert.strictEqual(skills['ux-flow-review'], 'allow', 'must allow ux-flow-review skill');
  });

  it('C-12: can load ui-design-system-review skill', () => {
    const config = readJson('opencode.jsonc');
    const skills = config.agent['ux-review-agent'].permission.skill;
    assert.strictEqual(skills['ui-design-system-review'], 'allow', 'must allow ui-design-system-review skill');
  });

  it('C-13: skill whitelist is closed with wildcard deny', () => {
    const config = readJson('opencode.jsonc');
    const skills = config.agent['ux-review-agent'].permission.skill;
    assert.strictEqual(skills['*'], 'deny', 'skill whitelist must be closed');
  });
});

// ============================================================
// SECTION D: UX Flow Review Skill
// ============================================================

describe('ux-flow-review Skill', () => {

  it('D-01: skill directory exists', () => {
    assert.ok(existsSync(join(WORKTREE, '.opencode/skills/ux-flow-review')), 'skill directory must exist');
  });

  it('D-02: SKILL.md exists', () => {
    assert.ok(existsSync(join(WORKTREE, '.opencode/skills/ux-flow-review/SKILL.md')), 'SKILL.md must exist');
  });

  it('D-03: has valid YAML frontmatter with name', () => {
    const content = readText('.opencode/skills/ux-flow-review/SKILL.md');
    assert.ok(content.includes('name: ux-flow-review'), 'frontmatter must have name: ux-flow-review');
  });

  it('D-04: has description in frontmatter', () => {
    const content = readText('.opencode/skills/ux-flow-review/SKILL.md');
    assert.ok(content.includes('description:'), 'frontmatter must have description');
  });

  it('D-05: has compatibility: opencode', () => {
    const content = readText('.opencode/skills/ux-flow-review/SKILL.md');
    assert.ok(content.includes('compatibility: opencode'), 'must declare opencode compatibility');
  });

  it('D-06: registered in ecosystem manifest conditional skills', () => {
    const manifest = readJson('ecosystem.manifest.json');
    assert.ok(manifest.catalogs.skills.conditional.includes('ux-flow-review'), 'must be in conditional skills');
  });

  it('D-07: contains severity classification (BLOCKER)', () => {
    const content = readText('.opencode/skills/ux-flow-review/SKILL.md');
    assert.ok(content.includes('BLOCKER'), 'must include BLOCKER severity');
  });

  it('D-08: contains evidence requirements section', () => {
    const content = readText('.opencode/skills/ux-flow-review/SKILL.md');
    assert.ok(content.includes('Evidence Requirements'), 'must have evidence requirements section');
  });

  it('D-09: prohibits vague findings', () => {
    const content = readText('.opencode/skills/ux-flow-review/SKILL.md');
    assert.ok(content.includes('Prohibited'), 'must explicitly prohibit vague findings');
  });

  it('D-10: defines mandatory workflow steps', () => {
    const content = readText('.opencode/skills/ux-flow-review/SKILL.md');
    assert.ok(content.includes('Step 1:'), 'must define step-by-step workflow');
    assert.ok(content.includes('Step 13:'), 'must have at least 13 workflow steps');
  });
});

// ============================================================
// SECTION E: UI Design System Review Skill
// ============================================================

describe('ui-design-system-review Skill', () => {

  it('E-01: skill directory exists', () => {
    assert.ok(existsSync(join(WORKTREE, '.opencode/skills/ui-design-system-review')), 'skill directory must exist');
  });

  it('E-02: SKILL.md exists', () => {
    assert.ok(existsSync(join(WORKTREE, '.opencode/skills/ui-design-system-review/SKILL.md')), 'SKILL.md must exist');
  });

  it('E-03: has valid YAML frontmatter with name', () => {
    const content = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(content.includes('name: ui-design-system-review'), 'frontmatter must have name: ui-design-system-review');
  });

  it('E-04: registered in ecosystem manifest conditional skills', () => {
    const manifest = readJson('ecosystem.manifest.json');
    assert.ok(manifest.catalogs.skills.conditional.includes('ui-design-system-review'), 'must be in conditional skills');
  });

  it('E-05: contains "Discover Before Design" principle', () => {
    const content = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(content.includes('Discover') || content.includes('discover'), 'must emphasize discovery before design');
  });

  it('E-06: defines priority rule (reuse → extend → abstract → create)', () => {
    const content = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(content.includes('REUSE'), 'must include REUSE step in priority');
    assert.ok(content.includes('EXTEND'), 'must include EXTEND step');
    assert.ok(content.includes('ABSTRACT'), 'must include ABSTRACT step');
    assert.ok(content.includes('CREATE'), 'must include CREATE step');
  });

  it('E-07: prohibits subjective language', () => {
    const content = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(content.includes('Prohibited Language'), 'must have prohibited language section');
  });

  it('E-08: lists required component states (default, hover, focus, etc.)', () => {
    const content = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(content.includes('hover'), 'must mention hover state');
    assert.ok(content.includes('focus'), 'must mention focus state');
    assert.ok(content.includes('disabled'), 'must mention disabled state');
  });

  it('E-09: includes contrast ratio requirements (WCAG AA)', () => {
    const content = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(content.includes('4.5:1') || content.includes('contrast'), 'must reference contrast requirements');
  });

  it('E-10: forbids parallel second design system', () => {
    const content = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(content.includes('parallel'), 'must explicitly forbid parallel design systems');
  });
});

// ============================================================
// SECTION F: Playwright Abgrenzung (Separation of Concerns)
// ============================================================

describe('UX/UI — Playwright Separation of Concerns', () => {

  it('F-01: ux-review-agent does NOT duplicate Playwright', () => {
    const agentContent = readText('.opencode/agents/ux-review-agent.md');
    assert.ok(!agentContent.includes('pixel-diff') && !agentContent.includes('screenshot comparison'),
      'agent must not mention pixel-diff or screenshot comparison as its own capability');
  });

  it('F-02: agent mentions delegation to Playwright for visual verification', () => {
    const agentContent = readText('.opencode/agents/ux-review-agent.md');
    assert.ok(agentContent.includes('Playwright'), 'agent must reference Playwright for visual verification');
  });

  it('F-03: ux-flow-review skill does NOT duplicate Playwright capabilities', () => {
    const content = readText('.opencode/skills/ux-flow-review/SKILL.md');
    assert.ok(!content.includes('screenshot comparison') && !content.includes('pixel-diff'),
      'ux-flow-review must not duplicate visual regression capabilities');
  });

  it('F-04: ui-design-system-review skill does NOT duplicate Playwright', () => {
    const content = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(!content.includes('screenshot comparison') && !content.includes('pixel-diff'),
      'ui-design-system-review must not duplicate visual regression capabilities');
  });
});

// ============================================================
// SECTION G: Governance Integration (No Kernel Gate Bypass)
// ============================================================

describe('UX/UI — Governance Integration', () => {

  it('G-01: agent definition does NOT reference kernel gate bypass', () => {
    const agentContent = readText('.opencode/agents/ux-review-agent.md');
    assert.ok(!agentContent.includes('bypass') && !agentContent.includes('override gate'),
      'agent must not mention bypassing governance gates');
  });

  it('G-02: agent respects approval gates (mentions Owner/Approval Gate)', () => {
    const agentContent = readText('.opencode/agents/ux-review-agent.md');
    assert.ok(agentContent.includes('Approval Gate') || agentContent.includes('approval gate'),
      'agent must acknowledge approval gates');
  });

  it('G-03: skills do NOT grant write access to reports', () => {
    const flowContent = readText('.opencode/skills/ux-flow-review/SKILL.md');
    const uiContent = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    // Skills should state they are read-only and delegate report writing to orchestrator
    const flowHasReadOnly = flowContent.toLowerCase().includes('read-only');
    const uiHasReadOnly = uiContent.toLowerCase().includes('read-only');
    const flowHasOrchestrator = flowContent.toLowerCase().includes('orchestrator');
    const uiHasOrchestrator = uiContent.toLowerCase().includes('orchestrator');
    assert.ok(flowHasReadOnly && uiHasReadOnly, 'both skills must declare read-only nature');
    assert.ok(flowHasOrchestrator || uiHasOrchestrator, 'at least one skill must route output via orchestrator');
  });

  it('G-04: skills declare output goes to orchestrator, not filesystem', () => {
    const flowContent = readText('.opencode/skills/ux-flow-review/SKILL.md');
    const uiContent = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(flowContent.toLowerCase().includes('orchestrator'), 'ux-flow-review must route output to orchestrator');
    assert.ok(uiContent.toLowerCase().includes('orchestrator'), 'ui-design-system-review must route output to orchestrator');
  });

  it('G-05: agent includes redaction/secret protection guidance', () => {
    const agentContent = readText('.opencode/agents/ux-review-agent.md');
    assert.ok(agentContent.includes('REDACTED') || agentContent.includes('Redaction'), 'agent must have redaction guidance');
    assert.ok(agentContent.includes('secret') || agentContent.includes('Secrets'), 'agent must mention secret protection');
  });

  it('G-06: ux-flow-review skill includes redaction rule', () => {
    const content = readText('.opencode/skills/ux-flow-review/SKILL.md');
    assert.ok(content.includes('REDACTED') || content.toLowerCase().includes('redaction'), 'ux-flow-review must mention redaction');
  });

  it('G-07: ui-design-system-review skill includes redaction rule', () => {
    const content = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(content.includes('REDACTED') || content.toLowerCase().includes('redaction'), 'ui-design-system-review must mention redaction');
  });

  it('G-08: agent is in orchestrator delegation scope in WORKING-METHOD.md', () => {
    const wmContent = readText('WORKING-METHOD.md');
    assert.ok(wmContent.includes('ux-review-agent'), 'WORKING-METHOD.md must reference ux-review-agent in delegation table');
  });
});

// ============================================================
// SECTION H: Frontend Design Build Skill — Contract Tests
// ============================================================

describe('frontend-design-build Skill', () => {

  it('H-01: skill directory exists', () => {
    assert.ok(existsSync(join(WORKTREE, '.opencode/skills/frontend-design-build')), 'skill directory must exist');
  });

  it('H-02: SKILL.md exists', () => {
    assert.ok(existsSync(join(WORKTREE, '.opencode/skills/frontend-design-build/SKILL.md')), 'SKILL.md must exist');
  });

  it('H-03: has valid YAML frontmatter with name', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('name: frontend-design-build'), 'frontmatter must have name: frontend-design-build');
  });

  it('H-04: has description in frontmatter', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('description:'), 'frontmatter must have description');
  });

  it('H-05: has compatibility: opencode', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('compatibility: opencode'), 'must declare opencode compatibility');
  });

  it('H-06: has valid license in frontmatter', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('license: Apache-2.0'), 'must have Apache-2.0 license');
  });

  it('H-07: registered in ecosystem manifest conditional skills', () => {
    const manifest = readJson('ecosystem.manifest.json');
    assert.ok(manifest.catalogs.skills.conditional.includes('frontend-design-build'), 'must be in conditional skills');
  });

  it('H-08: contains activation rules (scenario classification)', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('Activate for'), 'must have activation rules');
    assert.ok(content.includes('Do NOT activate for'), 'must have deactivation rules');
  });

  it('H-09: has scenario classification A through E', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('A. Existing Product With Design System'), 'must have scenario A');
    assert.ok(content.includes('B. Existing Product Without Documented System'), 'must have scenario B');
    assert.ok(content.includes('C. Greenfield Frontend'), 'must have scenario C');
    assert.ok(content.includes('D. Pure Review Request'), 'must have scenario D');
    assert.ok(content.includes('E. Small UI Bugfix Without Redesign'), 'must have scenario E');
  });

  it('H-10: enforces Existing-System-First discovery', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('Existing System First'), 'must have existing-system-first section');
    assert.ok(content.includes('REUSE'), 'must include REUSE priority');
    assert.ok(content.includes('EXTEND'), 'must include EXTEND priority');
  });

  it('H-11: has Owner/Approval Gate section', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('Owner / Approval Gate') || content.includes('Owner/Approval Gate'), 'must have approval gate section');
    assert.ok(content.includes('New Visual Direction') || content.includes('New External Fonts'), 'must enumerate approval gates');
  });

  it('H-12: requires design plan before code', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('Design Plan (Before Code)') || content.includes('Design Plan'), 'must require design plan');
    assert.ok(content.includes('Color Tokens'), 'design plan must include color tokens');
    assert.ok(content.includes('Typography Roles'), 'design plan must include typography');
    assert.ok(content.includes('Layout Principle'), 'design plan must include layout');
  });

  it('H-13: has assumption marking protocol', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('ASSUMPTION:'), 'must have ASSUMPTION marker');
    assert.ok(content.includes('EVIDENCE:'), 'must have EVIDENCE marker');
    assert.ok(content.includes('OWNER_CONFIRMATION_REQUIRED'), 'must have owner confirmation flag');
  });

  it('H-14: covers loading, empty, error, success states', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('Loading'), 'must cover loading state');
    assert.ok(content.includes('Empty'), 'must cover empty state');
    assert.ok(content.includes('Error'), 'must cover error state');
    assert.ok(content.includes('Success'), 'must cover success state');
  });

  it('H-15: covers keyboard focus and reduced motion', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('Keyboard Focus') || content.includes('focus-visible'), 'must cover keyboard focus');
    assert.ok(content.includes('Reduced Motion') || content.includes('prefers-reduced-motion'), 'must cover reduced motion');
  });

  it('H-16: prohibits self-review (completion boundary)', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('Completion Boundary'), 'must have completion boundary section');
    assert.ok(content.includes('UX fully passed') || content.includes('UX complete'), 'must prohibit self-review of UX');
    assert.ok(content.includes('Accessibility'), 'must reference accessibility in completion boundary');
  });

  it('H-17: has no runtime network fetch instruction', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('runtime_network_fetch: false'), 'frontmatter must declare no runtime fetch');
    // Must not contain instructions to fetch from URLs at runtime
    const hasFetch = content.match(/curl.*https?:\/\/|wget.*https?:\/\/|fetch\(.*https?:\/\//g);
    assert.strictEqual(hasFetch, null, 'must not contain runtime fetch instructions');
  });

  it('H-18: has no automatic external dependency instruction', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('npm install') === false || content.includes('npm install *: ask'),
      'must not instruct automatic npm install');
  });

  it('H-19: provenance tracked in frontmatter', () => {
    const content = readText('.opencode/skills/frontend-design-build/SKILL.md');
    assert.ok(content.includes('derived_from'), 'must declare derived_from');
    assert.ok(content.includes('upstream_commit'), 'must declare upstream_commit');
    assert.ok(content.includes('adapted: true'), 'must declare adapted');
  });

  it('H-20: THIRD_PARTY_SKILLS.lock.json exists', () => {
    assert.ok(existsSync(join(WORKTREE, '.opencode/skills/THIRD_PARTY_SKILLS.lock.json')), 'provenance lock file must exist');
  });
});

// ============================================================
// SECTION I: Frontend Design Agent — Definition and Permissions
// ============================================================

describe('Frontend Design Agent — Definition', () => {

  it('I-01: agent definition file exists', () => {
    assert.ok(existsSync(join(WORKTREE, '.opencode/agents/frontend-design-agent.md')), 'agent definition must exist');
  });

  it('I-02: agent registered in ecosystem manifest', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const agent = manifest.catalogs.agents.conditional.find(a => a.name === 'frontend-design-agent');
    assert.ok(agent, 'frontend-design-agent must be in conditional agents catalog');
  });

  it('I-03: agent registered in opencode.jsonc', () => {
    const config = readJson('opencode.jsonc');
    assert.ok(config.agent['frontend-design-agent'], 'frontend-design-agent must be in opencode.jsonc agent section');
  });

  it('I-04: agent mode is subagent', () => {
    const config = readJson('opencode.jsonc');
    assert.strictEqual(config.agent['frontend-design-agent'].mode, 'subagent', 'must be subagent mode');
  });

  it('I-05: agent can delegate to ux-review-agent', () => {
    const config = readJson('opencode.jsonc');
    const taskPerm = config.agent['frontend-design-agent'].permission.task;
    assert.strictEqual(taskPerm['ux-review-agent'], 'allow', 'must allow delegation to ux-review-agent');
  });

  it('I-06: agent can delegate to playwright-agent', () => {
    const config = readJson('opencode.jsonc');
    const taskPerm = config.agent['frontend-design-agent'].permission.task;
    assert.strictEqual(taskPerm['playwright-agent'], 'allow', 'must allow delegation to playwright-agent');
  });

  it('I-07: agent cannot delegate to arbitrary agents (wildcard deny)', () => {
    const config = readJson('opencode.jsonc');
    const taskPerm = config.agent['frontend-design-agent'].permission.task;
    assert.strictEqual(taskPerm['*'], 'deny', 'wildcard task delegation must be denied');
  });

  it('I-08: agent has edit permissions for UI file types', () => {
    const config = readJson('opencode.jsonc');
    const editPerm = config.agent['frontend-design-agent'].permission.edit;
    assert.ok(editPerm['*.css'] === 'allow', 'must allow CSS edits');
    assert.ok(editPerm['src/**'] === 'allow', 'must allow src edits');
    assert.ok(editPerm['components/**'] === 'allow', 'must allow component edits');
  });

  it('I-09: agent requires ask for package.json changes', () => {
    const config = readJson('opencode.jsonc');
    const editPerm = config.agent['frontend-design-agent'].permission.edit;
    assert.strictEqual(editPerm['package.json'], 'ask', 'package.json must require ask');
  });

  it('I-10: agent in orchestrator delegation scope (WORKING-METHOD.md)', () => {
    const wmContent = readText('WORKING-METHOD.md');
    assert.ok(wmContent.includes('frontend-design-agent'), 'WORKING-METHOD.md must reference frontend-design-agent in delegation table');
  });
});

// ============================================================
// SECTION J: Detector — Frontend Design Build Inclusion
// ============================================================

describe('Detector — frontend-design-build in Frontend UI Framework', () => {

  it('J-01: detector recommends frontend-design-build', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.recommend.includes('frontend-design-build'), 'must recommend frontend-design-build');
  });

  it('J-02: detector still recommends ux-flow-review', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.recommend.includes('ux-flow-review'), 'must still recommend ux-flow-review');
  });

  it('J-03: detector still recommends ui-design-system-review', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.recommend.includes('ui-design-system-review'), 'must still recommend ui-design-system-review');
  });

  it('J-04: detector recommends playwright-visual-review', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.recommend.includes('playwright-visual-review'), 'must recommend playwright-visual-review');
  });

  it('J-05: detector has vite.config.* signal', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.signals.includes('vite.config.*'), 'must detect vite.config.*');
  });

  it('J-06: detector has Astro signal (unchanged)', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.ok(detector.signals.includes('*.astro'), 'must detect astro files');
    assert.ok(detector.signals.includes('astro.config.*'), 'must detect astro config');
  });

  it('J-07: detector is conditional (unchanged)', () => {
    const manifest = readJson('ecosystem.manifest.json');
    const detector = manifest.detectors.find(d => d.id === 'frontend-ui-framework');
    assert.strictEqual(detector.domain, 'conditional', 'must be conditional');
  });
});

// ============================================================
// SECTION K: Review Skills — Extended Rules Verification
// ============================================================

describe('Extended Review Rules — ux-flow-review', () => {

  it('K-01: has URL and deep-link states section', () => {
    const content = readText('.opencode/skills/ux-flow-review/SKILL.md');
    assert.ok(content.includes('URL and Deep-Link States') || content.includes('Deep-Link'), 'must have deep-link section');
  });

  it('K-02: has clear action labels section', () => {
    const content = readText('.opencode/skills/ux-flow-review/SKILL.md');
    assert.ok(content.includes('Action Labels') || content.includes('action labels'), 'must have action label rules');
  });

  it('K-03: has mobile and touch flows section', () => {
    const content = readText('.opencode/skills/ux-flow-review/SKILL.md');
    assert.ok(content.includes('Mobile and Touch Flows') || content.includes('Touch Flows'), 'must have mobile/touch section');
  });

  it('K-04: has unsaved changes protection section', () => {
    const content = readText('.opencode/skills/ux-flow-review/SKILL.md');
    assert.ok(content.includes('Unsaved Changes') || content.includes('unsaved'), 'must have unsaved changes section');
  });

  it('K-05: has locale-aware content section', () => {
    const content = readText('.opencode/skills/ux-flow-review/SKILL.md');
    assert.ok(content.includes('Locale-Aware') || content.includes('Intl'), 'must have locale section');
  });
});

describe('Extended Review Rules — ui-design-system-review', () => {

  it('K-06: has image dimensions and layout shift section', () => {
    const content = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(content.includes('Layout Shift') || content.includes('CLS'), 'must have layout shift section');
  });

  it('K-07: has dark mode metadata section', () => {
    const content = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(content.includes('Dark Mode Metadata'), 'must have dark mode metadata section');
  });

  it('K-08: has touch target sizes section', () => {
    const content = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(content.includes('Touch Target'), 'must have touch target section');
  });

  it('K-09: has reduced motion section', () => {
    const content = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(content.includes('Reduced Motion'), 'must have reduced motion section');
  });

  it('K-10: has hydration safety section', () => {
    const content = readText('.opencode/skills/ui-design-system-review/SKILL.md');
    assert.ok(content.includes('Hydration Safety'), 'must have hydration safety section');
  });
});

// ============================================================
// SECTION L: Playwright — WCAG 2.2 Updates
// ============================================================

describe('Playwright Visual Review — WCAG 2.2 Updates', () => {

  it('L-01: references WCAG 2.2', () => {
    const content = readText('.opencode/skills/playwright-visual-review/SKILL.md');
    assert.ok(content.includes('WCAG 2.2'), 'must reference WCAG 2.2');
  });

  it('L-02: documents axe limitations', () => {
    const content = readText('.opencode/skills/playwright-visual-review/SKILL.md');
    assert.ok(content.includes('limitations') || content.includes('cannot verify'), 'must document axe limitations');
  });

  it('L-03: new baselines require human review', () => {
    const content = readText('.opencode/skills/playwright-visual-review/SKILL.md');
    assert.ok(content.includes('NEEDS_HUMAN_REVIEW'), 'missing baselines must need human review');
  });

  it('L-04: GitHub comments are gated', () => {
    const content = readText('.opencode/skills/playwright-visual-review/SKILL.md');
    const agentContent = readText('.opencode/agents/playwright-agent.md');
    const combined = content + agentContent;
    assert.ok(combined.includes('orchestrator') || combined.includes('owner approval'), 'github comments must be gated');
  });

  it('L-05: includes reduced motion verification', () => {
    const content = readText('.opencode/skills/playwright-visual-review/SKILL.md');
    assert.ok(content.includes('Reduced motion') || content.includes('prefers-reduced-motion'), 'must verify reduced motion');
  });
});

// ============================================================
// SECTION M: Path Independence — No Hardcoded Worktree Paths
// ============================================================

describe('Path Independence — No Hardcoded Worktree Paths', () => {

  it('M-01: ux-ui-governed-layer.test.mjs uses process.cwd() or env var, not hardcoded path', () => {
    const content = readText('test/validation/ux-ui-governed-layer.test.mjs');
    assert.ok(content.includes('process.env.OPCODE_UX_UI_WORKTREE || process.cwd()'), 'must use dynamic path resolution');
    // Check for hardcoded paths outside of test assertions (skip the test assertion lines)
    const hardcodedPattern = /\/tmp\/opencode-ux-ui-20260722T144637Z/g;
    const lines = content.split('\n');
    const offendingLines = lines.filter(line => hardcodedPattern.test(line) && !line.includes('M-01'));
    assert.strictEqual(offendingLines.length, 0, 'must not contain hardcoded old worktree path outside test assertions');
  });
});

console.log('[UX/UI Red Tests + Frontend Design Tests] All sections defined. Tests validate agent + skills + detector + governance + frontend-design integration.');
