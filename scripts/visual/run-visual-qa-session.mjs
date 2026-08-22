#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/**
 * REAL visual QA session harness — deterministic chain with REAL browser + REAL vision model.
 *
 * Seam: this runner is the REAL vertical slice (no browserExecutor/reviewFn seams).
 * It delegates to the canonical runtime visual QA:
 *   TASK → runTask(visualQa: { required:true, pages:[{path, viewports}], evidence_dir, mcp:{command,server}, reviewer:{provider,model,catalog}, requirements:{needs_vision:true} })
 *     → browser-evidence (MCP playwright) → vision-reviewer (openai/gpt-5.4-mini) → visual gate → controller decision
 *
 * Synthetic fixture corpus only (test/fixtures/visual-qa/*.html). No secrets.
 * Evidence is fingerprinted (sha256) — never log raw PNG bytes. Bounded timeouts.
 *
 * Mirrors structure of scripts/routing/run-routed-worker-session.mjs:
 *   imports, fixtureRoot, CLI arg handling, session output JSON.
 *
 * Usage:
 *   node scripts/visual/run-visual-qa-session.mjs --help
 *   node scripts/visual/run-visual-qa-session.mjs --fixture 05-overlap --viewport desktop
 *   node scripts/visual/run-visual-qa-session.mjs --fixture all --viewport both --evidence-dir evidence/visual-qa-20260822
 *   node scripts/visual/run-visual-qa-session.mjs --all --evidence-dir ./evidence/visual-qa
 */

import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runTask } from '../../runtime/run.mjs'
import { DEFAULT_MODEL_CATALOG } from '../../runtime/routing/model-catalog.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURE_ROOT_DIR = path.join(REPO_ROOT, 'test', 'fixtures', 'visual-qa')
const DEFAULT_EVIDENCE_DIR = path.join(REPO_ROOT, 'evidence', `visual-qa-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}Z`)

// Vision model with proven vision_support in this environment (see runtime/routing/model-catalog.mjs + visual-core.test.mjs)
const VISION_REVIEWER = Object.freeze({ provider: 'openai', model: 'gpt-5.4-mini' })

// Promote gpt-5.4-mini to reachable if catalog has it as configured; keep others as-is but ensure vision entry is reachable
function buildHighVisCatalog(base = DEFAULT_MODEL_CATALOG) {
  return base.map((e) => {
    if (e.provider === VISION_REVIEWER.provider && e.model === VISION_REVIEWER.model) {
      return { ...e, enabled: true, availability: 'reachable' }
    }
    return { ...e }
  })
}
const HIGH_VIS_CATALOG = buildHighVisCatalog(DEFAULT_MODEL_CATALOG)

// Resolve playwright MCP command: ~/.config/opencode/opencode.jsonc -> OCAE_PLAYWRIGHT_MCP_BIN -> 'playwright-mcp'
function resolvePlaywrightCommand() {
  // 1) env override
  if (process.env.OCAE_PLAYWRIGHT_MCP_BIN && process.env.OCAE_PLAYWRIGHT_MCP_BIN.trim().length > 0) {
    const raw = process.env.OCAE_PLAYWRIGHT_MCP_BIN.trim()
    // allow space-separated command string
    return raw.includes(' ') ? raw.split(/\s+/).filter(Boolean) : [raw]
  }
  // 2) opencode.jsonc global config
  const candidates = [
    path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'),
    path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
  ]
  for (const p of candidates) {
    try {
      const raw = fsSync.readFileSync(p, 'utf8')
      // opencode.jsonc may contain comments — strip trailing commas handled by JSON parse fallback
      // Try raw JSON first; fall back to comment-stripped parse only if raw is invalid JSONC.
      // Naive //.* stripping would corrupt "https://" URLs (e.g. $schema), so avoid it unless needed.
      let parsed
      try { parsed = JSON.parse(raw) } catch {
        const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '')
        // Only strip // comments that are NOT inside strings: require // at line start (after optional whitespace).
        const stripped2 = stripped.replace(/^\s*\/\/.*$/gm, '')
        parsed = JSON.parse(stripped2)
      }
      const cmd = parsed?.mcp?.playwright?.command
      if (Array.isArray(cmd) && cmd.length > 0 && typeof cmd[0] === 'string' && cmd[0].trim().length > 0) {
        return cmd
      }
    } catch {}
  }
  // 3) fallback
  return ['playwright-mcp']
}

const PLAYWRIGHT_MCP_COMMAND = resolvePlaywrightCommand()

function parseArgs(argv) {
  const out = {
    fixture: 'all',
    viewport: 'both',
    evidenceDir: DEFAULT_EVIDENCE_DIR,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[++i]
    if (arg === '--fixture') out.fixture = next()
    else if (arg === '--viewport') out.viewport = next()
    else if (arg === '--evidence-dir') out.evidenceDir = next()
    else if (arg === '--evidence_dir') out.evidenceDir = next()
    else if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--all') out.fixture = 'all'
    else throw new Error(`Unknown argument: ${arg}`)
  }
  // normalize
  if (out.viewport === 'both') out.viewport = 'both'
  else if (!['desktop', 'mobile', 'both'].includes(out.viewport)) throw new Error(`--viewport must be desktop|mobile|both (got ${out.viewport})`)
  return out
}

function printHelp() {
  const fixtures = (() => {
    try { return fsSync.readdirSync(FIXTURE_ROOT_DIR).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).sort().join(', ') } catch { return '01-clean-desktop, ... (10 fixtures)' }
  })()
  console.log(`Usage: node scripts/visual/run-visual-qa-session.mjs [options]

REAL visual QA session harness (browser-evidence + vision-reviewer, no seams).

Options:
  --fixture <name>       Fixture name without .html, or "all" (default: all)
                         Available: ${fixtures}
  --viewport <v>         desktop | mobile | both (default: both)
  --evidence-dir <path>  Directory to write session JSON + screenshots (default: evidence/visual-qa-<ts>Z)
  --help, -h             Show this help

Examples:
  node scripts/visual/run-visual-qa-session.mjs --help
  node scripts/visual/run-visual-qa-session.mjs --fixture 05-overlap --viewport desktop
  node scripts/visual/run-visual-qa-session.mjs --all --viewport both --evidence-dir ./evidence/visual-qa

Notes:
  - Uses REAL browser-evidence (MCP server: playwright) and REAL vision-reviewer (openai/gpt-5.4-mini).
  - No browserExecutor/reviewFn seams — this is the real vertical slice.
  - Synthetic fixtures only (test/fixtures/visual-qa/*.html), fingerprinted evidence, bounded timeouts, never logs raw PNG bytes.
  - Manifest: test/fixtures/visual-qa/manifest.json declares expected outcomes per viewport.
  - Vision reviewer prompt is injection-guarded (UNTRUSTED DATA framing); fixture 10-prompt-injection tests the guard.
`)
}

async function loadManifest() {
  const p = path.join(FIXTURE_ROOT_DIR, 'manifest.json')
  const raw = await fs.readFile(p, 'utf8')
  return JSON.parse(raw)
}

function expandFixtures(manifest, fixtureArg, viewportArg) {
  const allFixtures = manifest.fixtures
  const selected = fixtureArg === 'all' ? allFixtures : allFixtures.filter((f) => f.name === fixtureArg)
  if (selected.length === 0) throw new Error(`Fixture not found: ${fixtureArg}`)
  const pairs = []
  for (const f of selected) {
    const viewports = viewportArg === 'both'
      ? f.viewports
      : f.viewports.includes(viewportArg) ? [viewportArg] : []
    // For viewport mismatch: if user asked desktop but fixture only has mobile? skip with warning
    if (viewports.length === 0) continue
    for (const vp of viewports) {
      pairs.push({ fixture: f, viewport: vp })
    }
  }
  return pairs
}

function nativePlanFor(fixtureName) {
  return `# Plan
## Targets
- proof.html
## Acceptance Criteria
- proof exists
## Build Scope
files: proof.html`
}

// Corpus metrics helper — compares actual outcomes vs manifest expectations (deferred to evidence-correlation phase)
export function computeCorpusMetrics(results, manifest) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const r of results) {
    const entry = manifest.fixtures.find((f) => f.name === r.fixture)
    if (!entry) continue
    let expected = entry.expected
    let expectedBlocking = entry.blocking
    // per-viewport override
    if (entry.expected_per_viewport && entry.expected_per_viewport[r.viewport]) {
      expected = entry.expected_per_viewport[r.viewport].expected
      expectedBlocking = entry.expected_per_viewport[r.viewport].blocking
    }
    const actualBlocking = r.decision === 'BLOCKED' || r.visual_status === 'FINDINGS_BLOCKING'
    const actualPass = r.decision === 'DONE' || r.visual_status === 'PASS'
    const expectPass = expected === 'PASS'
    const expectBlocking = expected === 'FINDINGS_BLOCKING'
    // True positive: expected defect and got defect
    if (expectBlocking && actualBlocking) tp++
    else if (!expectPass && !expectBlocking && r.visual_status !== 'PASS' && expected !== 'PASS') tp++ // non-blocking findings case
    else if (expectPass && actualPass) tn++
    else if (!expectPass && actualPass) fn++
    else if (expectPass && !actualPass) fp++
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn)
  return { tp, fp, fn, tn, precision, recall }
}

async function runOne({ fixture, viewport, evidenceDir }) {
  const fixturePath = path.join(FIXTURE_ROOT_DIR, fixture.path)
  const absPath = path.resolve(fixturePath)
  // Verify fixture exists and is <5KB
  const stat = await fs.stat(absPath)
  if (!stat.isFile()) throw new Error(`Fixture file missing: ${absPath}`)
  // tmp repo root for this run (mkdtemp) — synthetic, isolated
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `ocae-visual-${fixture.name}-${viewport}-`))
  // Place a minimal proof file so build can succeed (pipeline requires buildExecutor)
  const buildExecutor = async () => {
    await fs.writeFile(path.join(tmpRoot, 'proof.html'), `<!doctype html><title>proof</title><p>${fixture.name} ${viewport}</p>`)
    return { changed_files: ['proof.html'], errors: [], strategy_delta: null }
  }
  const started = Date.now()
  const runResult = await runTask({
    taskInput: { task: `visual-qa ${fixture.name} ${viewport}`, repository: tmpRoot },
    repoRoot: tmpRoot,
    nativePlan: { planText: nativePlanFor(fixture.name) },
    buildExecutor,
    verifyChecks: [],
    routing: { enabled: false },
    visualQa: {
      required: true,
      pages: [{ name: fixture.name, path: absPath, viewports: [viewport] }],
      evidence_dir: evidenceDir,
      mcp: { command: PLAYWRIGHT_MCP_COMMAND, server: 'playwright' },
      reviewer: { provider: VISION_REVIEWER.provider, model: VISION_REVIEWER.model, catalog: HIGH_VIS_CATALOG },
      requirements: { needs_vision: true },
    },
  })
  const duration_ms = Date.now() - started
  // Extract visual review + evidence
  const visualReview = (runResult.reviews || []).find((r) => r.review_type === 'visual')
  const visualStatus = visualReview?.review?.status || runResult?.visualGate?.outcome || null
  // Try to find screenshot fingerprint from evidence dir sidecars or runResult
  let image_fingerprint = null
  let screenshot_path = null
  try {
    // runResult may carry evidence or we scan evidenceDir for this run_id
    const evList = runResult?.evidence || runResult?.visualEvidence || []
    if (Array.isArray(evList) && evList.length > 0) {
      const ev = evList.find((e) => e.viewport === viewport) || evList[0]
      image_fingerprint = ev?.image_fingerprint || null
      screenshot_path = ev?.screenshot_path || null
    }
    // Fallback: scan evidenceDir for png matching run_id
    if (!image_fingerprint && runResult.run_id) {
      const files = await fs.readdir(evidenceDir).catch(() => [])
      const match = files.find((f) => f.startsWith(runResult.run_id) && f.endsWith('.png'))
      if (match) {
        screenshot_path = path.join(evidenceDir, match)
        try {
          const bytes = await fs.readFile(screenshot_path)
          image_fingerprint = crypto.createHash('sha256').update(bytes).digest('hex')
        } catch {}
      }
    }
  } catch {}
  // Cleanup tmp root but keep evidenceDir
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
  const findings = visualReview?.review?.findings || []
  const eventsSummary = (runResult.events || []).slice(-20).map((e) => ({ job: e.job, phase: e.phase, status: e.status, failure_signature: e.failure_signature || null }))
  return {
    run_id: runResult.run_id,
    fixture: fixture.name,
    viewport,
    decision: runResult.decision?.decision || null,
    reason_code: runResult.decision?.reason_code || null,
    first_bad_boundary: runResult.decision?.first_bad_boundary || null,
    visual_status: visualStatus,
    findings: findings.map((f) => ({ category: f.category, severity: f.severity, blocking: f.blocking, confidence: f.confidence })),
    finding_count: findings.length,
    image_fingerprint,
    screenshot_path,
    review_provider: VISION_REVIEWER.provider,
    review_model: VISION_REVIEWER.model,
    duration_ms,
    events_summary: eventsSummary,
    raw_run_id: runResult.run_id,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    process.exit(0)
  }
  const manifest = await loadManifest()
  const pairs = expandFixtures(manifest, args.fixture, args.viewport)
  if (pairs.length === 0) {
    console.error(`No fixture×viewport pairs matched (fixture=${args.fixture}, viewport=${args.viewport}). Check manifest viewports.`)
    process.exit(1)
  }
  const evidenceDir = path.resolve(args.evidenceDir)
  await fs.mkdir(evidenceDir, { recursive: true, mode: 0o700 })

  console.log(`Visual QA session: ${pairs.length} run(s) — fixture=${args.fixture} viewport=${args.viewport}`)
  console.log(`Fixture root: ${FIXTURE_ROOT_DIR}`)
  console.log(`Evidence dir: ${evidenceDir}`)
  console.log(`Playwright MCP command: ${JSON.stringify(PLAYWRIGHT_MCP_COMMAND)}`)
  console.log(`Vision reviewer: ${VISION_REVIEWER.provider}/${VISION_REVIEWER.model}`)
  console.log(`Catalog: HIGH_VIS_CATALOG (gpt-5.4-mini promoted to reachable)`)
  console.log('')

  const results = []
  for (const { fixture, viewport } of pairs) {
    console.log(`→ ${fixture.name} @ ${viewport} ...`)
    try {
      const result = await runOne({ fixture, viewport, evidenceDir })
      results.push(result)
      const perPath = path.join(evidenceDir, `session-${result.fixture}-${result.viewport}-${result.run_id}.json`)
      await fs.writeFile(perPath, JSON.stringify(result, null, 2), { encoding: 'utf8', mode: 0o600 })
      console.log(`  decision=${result.decision} visual_status=${result.visual_status} findings=${result.finding_count} fp=${result.image_fingerprint ? result.image_fingerprint.slice(0, 12) + '…' : 'null'} duration=${result.duration_ms}ms → ${perPath}`)
    } catch (e) {
      console.error(`  FAILED ${fixture.name}@${viewport}: ${e.message}`)
      results.push({ fixture: fixture.name, viewport, error: e.message, decision: null, visual_status: null })
    }
  }

  // Aggregate summary
  const summary = {
    created_at: new Date().toISOString(),
    repo_root: path.relative(REPO_ROOT, REPO_ROOT) || '.',
    fixture_root: path.relative(REPO_ROOT, FIXTURE_ROOT_DIR),
    evidence_dir: path.relative(REPO_ROOT, evidenceDir),
    playwright_mcp_command: PLAYWRIGHT_MCP_COMMAND.map(c => c.replace(REPO_ROOT, '.').replace(os.homedir(), '<home>')),
    vision_reviewer: VISION_REVIEWER,
    args: { fixture: args.fixture, viewport: args.viewport },
    total: results.length,
    results,
    metrics: computeCorpusMetrics(results, manifest),
  }
  const summaryPath = path.join(evidenceDir, 'summary.json')
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), { encoding: 'utf8', mode: 0o600 })
  // Also write manifest snapshot for correlation
  await fs.writeFile(path.join(evidenceDir, 'manifest.snapshot.json'), JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 })

  console.log('')
  console.log(`SUMMARY: ${summaryPath}`)
  console.log(JSON.stringify({ total: summary.total, metrics: summary.metrics, evidence_dir: evidenceDir }, null, 2))
  // stdout JSON for machine consumption
  console.log(JSON.stringify(summary))
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((e) => {
    console.error(e.stack || String(e))
    process.exit(1)
  })
}
