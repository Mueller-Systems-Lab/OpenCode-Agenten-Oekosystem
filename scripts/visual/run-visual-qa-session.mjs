#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** REAL visual QA harness — browser-evidence + vision-reviewer. Supports multi-viewport matrix, calibration, correlation. */
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { runTask } from '../../runtime/run.mjs'
import { DEFAULT_MODEL_CATALOG } from '../../runtime/routing/model-catalog.mjs'
import { resolveViewportProfile, CANONICAL_VIEWPORTS } from '../../runtime/visual/viewport-policy.mjs'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FIXTURE_ROOT_DIR = path.join(REPO_ROOT, 'test', 'fixtures', 'visual-qa')
const DEFAULT_EVIDENCE_DIR = path.join(REPO_ROOT, 'evidence', `visual-qa-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}Z`)
const VISION_REVIEWER = Object.freeze({ provider: 'openai', model: 'gpt-5.4-mini' })
function buildHighVisCatalog(base = DEFAULT_MODEL_CATALOG) {
  return base.map((e) => e.provider === VISION_REVIEWER.provider && e.model === VISION_REVIEWER.model ? { ...e, enabled: true, availability: 'reachable' } : { ...e })
}
const HIGH_VIS_CATALOG = buildHighVisCatalog(DEFAULT_MODEL_CATALOG)
function resolvePlaywrightCommand() {
  if (process.env.OCAE_PLAYWRIGHT_MCP_BIN?.trim()) {
    const raw = process.env.OCAE_PLAYWRIGHT_MCP_BIN.trim()
    return raw.includes(' ') ? raw.split(/\s+/).filter(Boolean) : [raw]
  }
  for (const p of [path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'), path.join(os.homedir(), '.config', 'opencode', 'opencode.json')]) {
    try {
      const raw = fsSync.readFileSync(p, 'utf8')
      let parsed
      try { parsed = JSON.parse(raw) } catch { const s = raw.replace(/\/\*[\s\S]*?\*\//g, ''); parsed = JSON.parse(s.replace(/^\s*\/\/.*$/gm, '')) }
      const cmd = parsed?.mcp?.playwright?.command
      if (Array.isArray(cmd) && cmd.length > 0 && typeof cmd[0] === 'string' && cmd[0].trim()) return cmd
    } catch {}
  }
  return ['playwright-mcp']
}
const PLAYWRIGHT_MCP_COMMAND = resolvePlaywrightCommand()
const VALID_PROFILES = ['desktop_only', 'mobile_only', 'responsive_core', 'custom']
const SINGLE_VPS = ['desktop', 'mobile', 'both']
function parseArgs(argv) {
  const out = { fixture: 'all', viewport: 'both', viewportProfile: null, viewports: null, customViewports: null, evidenceDir: DEFAULT_EVIDENCE_DIR, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`Missing value for ${arg}`); return v }
    if (arg === '--fixture') out.fixture = next()
    else if (arg === '--viewport') out.viewport = next()
    else if (arg === '--viewport-profile' || arg === '--viewport_profile') out.viewportProfile = next()
    else if (arg === '--viewports') out.viewports = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (arg === '--custom-viewports' || arg === '--custom_viewports') {
      const raw = next()
      try { const parsed = JSON.parse(raw); if (!Array.isArray(parsed)) throw new Error('must be array'); out.customViewports = parsed } catch (e) { throw new Error(`--custom-viewports must be JSON array: ${e.message}`) }
    }
    else if (arg === '--evidence-dir' || arg === '--evidence_dir') out.evidenceDir = next()
    else if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--all') out.fixture = 'all'
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!SINGLE_VPS.includes(out.viewport)) throw new Error(`--viewport must be desktop|mobile|both (got ${out.viewport})`)
  if (out.viewportProfile && !VALID_PROFILES.includes(out.viewportProfile)) throw new Error(`--viewport-profile must be ${VALID_PROFILES.join('|')} (got ${out.viewportProfile})`)
  if (out.viewports?.length && !out.viewportProfile) out.viewportProfile = 'custom'
  if (out.customViewports && !out.viewportProfile) out.viewportProfile = 'custom'
  if (out.viewports) {
    for (const vp of out.viewports) if (!vp.trim()) throw new Error(`Invalid viewport in --viewports: ${vp}`)
    if (out.viewports.length > 8) throw new Error(`--viewports exceeds max 8 (got ${out.viewports.length})`)
  }
  if (out.viewportProfile) {
    const customForValidation = out.customViewports || (out.viewports ? out.viewports.map((n) => { const d = CANONICAL_VIEWPORTS[n]; return d ? { name: n, width: d.width, height: d.height } : { name: n, width: 1280, height: 800 } }) : null)
    if (out.viewportProfile !== 'custom' || customForValidation) {
      const res = resolveViewportProfile({ profile: out.viewportProfile, customViewports: customForValidation || [] })
      if (!res.ok && out.viewportProfile !== 'custom') throw new Error(`Invalid viewport profile ${out.viewportProfile}: ${res.reason || res.code}`)
    }
  }
  return out
}
function printHelp() {
  const fixtures = (() => { try { return fsSync.readdirSync(FIXTURE_ROOT_DIR).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).sort().join(', ') } catch { return '01-clean-desktop, ...' } })()
  console.log(`Usage: node scripts/visual/run-visual-qa-session.mjs [options]

REAL visual QA harness (browser-evidence + vision-reviewer).

Options:
  --fixture <name>       Fixture without .html or "all" (default: all) Available: ${fixtures}
  --viewport <v>         desktop|mobile|both (default: both) [backward compat]
  --viewport-profile <p> desktop_only|mobile_only|responsive_core|custom
  --viewports <list>     Comma list e.g. mobile-small,mobile,tablet,desktop,wide-desktop (implies custom)
  --custom-viewports <json> JSON array [{"name":"my","width":800,"height":600}] (implies custom)
  --evidence-dir <path>  Evidence dir (default: evidence/visual-qa-<ts>Z)
  --help, -h             Help

Examples:
  node scripts/visual/run-visual-qa-session.mjs --fixture 05-overlap --viewport desktop
  node scripts/visual/run-visual-qa-session.mjs --all --viewport both --evidence-dir ./evidence/visual-qa
  node scripts/visual/run-visual-qa-session.mjs --fixture 11-mobile-only-overflow --viewport-profile responsive_core
  node scripts/visual/run-visual-qa-session.mjs --fixture 11-mobile-only-overflow --viewports mobile-small,mobile,tablet,desktop,wide-desktop

Notes:
  - Synthetic fixtures only, fingerprinted evidence (sha256), never raw PNG bytes.
  - Multi-viewport: when --viewport-profile given or fixture has >2 viewports, one runTask per fixture covering all viewports with correlation+calibration.
`)
}
async function loadManifest() { const p = path.join(FIXTURE_ROOT_DIR, 'manifest.json'); return JSON.parse(await fs.readFile(p, 'utf8')) }
function expandFixtures(manifest, fixtureArg, viewportArg) {
  const selected = fixtureArg === 'all' ? manifest.fixtures : manifest.fixtures.filter((f) => f.name === fixtureArg)
  if (selected.length === 0) throw new Error(`Fixture not found: ${fixtureArg}`)
  const pairs = []
  for (const f of selected) {
    const vps = viewportArg === 'both' ? f.viewports : f.viewports.includes(viewportArg) ? [viewportArg] : []
    for (const vp of vps) pairs.push({ fixture: f, viewport: vp })
  }
  return pairs
}
function nativePlanFor(n) { return `# Plan\n## Targets\n- proof.html\n## Acceptance Criteria\n- proof exists\n## Build Scope\nfiles: proof.html` }
export function computeCorpusMetrics(results, manifest) {
  let tp = 0, fp = 0, fn = 0, tn = 0
  const flat = []
  for (const r of results) {
    if (r.per_viewport?.length) { for (const pv of r.per_viewport) flat.push({ fixture: r.fixture, viewport: pv.viewport, decision: pv.decision || r.decision, visual_status: pv.visual_status || r.visual_status }) }
    else if (r.viewports && !r.viewport) { for (const vp of r.viewports) { const ff = (r.findings || []).filter((f) => (f.viewport || f.viewport_id) === vp); const blk = ff.some((f) => f.blocking); flat.push({ fixture: r.fixture, viewport: vp, decision: r.decision, visual_status: blk ? 'FINDINGS_BLOCKING' : ff.length ? 'FINDINGS_NON_BLOCKING' : 'PASS' }) } }
    else flat.push(r)
  }
  for (const r of flat) {
    const e = manifest.fixtures.find((f) => f.name === r.fixture); if (!e) continue
    let expected = e.expected; if (e.expected_per_viewport?.[r.viewport]) expected = e.expected_per_viewport[r.viewport].expected
    const actualBlocking = r.decision === 'BLOCKED' || r.visual_status === 'FINDINGS_BLOCKING'
    const actualPass = r.decision === 'DONE' || r.visual_status === 'PASS'
    const expectPass = expected === 'PASS', expectBlocking = expected === 'FINDINGS_BLOCKING'
    if (expectBlocking && actualBlocking) tp++
    else if (!expectPass && !expectBlocking && r.visual_status !== 'PASS' && expected !== 'PASS') tp++
    else if (expectPass && actualPass) tn++
    else if (!expectPass && actualPass) fn++
    else if (expectPass && !actualPass) fp++
  }
  return { tp, fp, fn, tn, precision: tp + fp === 0 ? 1 : tp / (tp + fp), recall: tp + fn === 0 ? 1 : tp / (tp + fn) }
}
export function computeResponsiveMetrics(results, manifest) {
  let viewportTotal = 0, viewportCorrect = 0, correlationExpected = 0, correlationProduced = 0, incorrectMerges = 0, missedMerges = 0, calibrationTotal = 0, calibrationCorrect = 0
  for (const r of results) {
    const e = manifest.fixtures.find((f) => f.name === r.fixture); if (!e) continue
    const isMulti = r.viewports?.length || r.per_viewport?.length
    if (isMulti) {
      const vps = r.viewports || r.per_viewport.map((p) => p.viewport)
      for (const vp of vps) {
        viewportTotal++
        let expected = e.expected; if (e.expected_per_viewport?.[vp]) expected = e.expected_per_viewport[vp].expected; else if (e.expected === 'MIXED') expected = 'PASS'
        let pv = r.per_viewport?.find((p) => p.viewport === vp)
        let actualPass; if (pv) actualPass = pv.visual_status ? pv.visual_status === 'PASS' : !pv.findings?.length
        else { const ff = (r.findings || []).filter((f) => (f.viewport || f.viewport_id) === vp); actualPass = ff.some((f) => f.blocking) ? false : ff.length ? false : r.visual_status === 'PASS' || ff.length === 0 }
        if ((expected === 'PASS') === actualPass) viewportCorrect++
      }
      const cats = new Set()
      if (e.expected_per_viewport) for (const cfg of Object.values(e.expected_per_viewport)) if (cfg.expected !== 'PASS' && cfg.categories) for (const c of cfg.categories) cats.add(c)
      else if (e.expected !== 'PASS' && e.categories) for (const c of e.categories) cats.add(c)
      if (e.expected === 'PASS') cats.clear()
      correlationExpected += cats.size; correlationProduced += r.correlated_findings?.length || 0
      if (r.correlation_stats) { incorrectMerges += r.correlation_stats.incorrect_merges || 0; missedMerges += r.correlation_stats.missed_merges || 0 }
      for (const f of r.findings || []) {
        calibrationTotal++; const vp = f.viewport || f.viewport_id; let expSev = e.severity; if (vp && e.expected_per_viewport?.[vp]) expSev = e.expected_per_viewport[vp].severity
        const cal = f.calibrated_severity || f.severity
        if (!expSev && !f.blocking) calibrationCorrect++
        else if (expSev && cal === expSev) calibrationCorrect++
      }
    } else {
      viewportTotal++; let expected = e.expected; if (e.expected_per_viewport?.[r.viewport]) expected = e.expected_per_viewport[r.viewport].expected
      const actualPass = r.decision === 'DONE' || r.visual_status === 'PASS'
      if ((expected === 'PASS') === actualPass) viewportCorrect++
    }
  }
  return {
    viewport_total: viewportTotal, viewport_correct: viewportCorrect, viewport_accuracy: viewportTotal ? viewportCorrect / viewportTotal : 1,
    correlation_expected: correlationExpected, correlation_produced: correlationProduced, incorrect_merges: incorrectMerges, missed_merges: missedMerges, correlation_accuracy: correlationExpected === 0 ? (correlationProduced === 0 ? 1 : 0) : Math.min(correlationProduced, correlationExpected) / Math.max(correlationProduced, correlationExpected),
    calibration_total: calibrationTotal, calibration_correct: calibrationCorrect, calibration_accuracy: calibrationTotal ? calibrationCorrect / calibrationTotal : 1,
  }
}
async function runOne({ fixture, viewport, evidenceDir }) {
  const absPath = path.resolve(path.join(FIXTURE_ROOT_DIR, fixture.path))
  const stat = await fs.stat(absPath); if (!stat.isFile()) throw new Error(`Fixture missing: ${absPath}`)
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `ocae-visual-${fixture.name}-${viewport}-`))
  const buildExecutor = async () => { await fs.writeFile(path.join(tmpRoot, 'proof.html'), `<!doctype html><title>proof</title><p>${fixture.name} ${viewport}</p>`); return { changed_files: ['proof.html'], errors: [], strategy_delta: null } }
  const started = Date.now()
  const runResult = await runTask({ taskInput: { task: `visual-qa ${fixture.name} ${viewport}`, repository: tmpRoot }, repoRoot: tmpRoot, nativePlan: { planText: nativePlanFor(fixture.name) }, buildExecutor, verifyChecks: [], routing: { enabled: false }, visualQa: { required: true, pages: [{ name: fixture.name, path: absPath, viewports: [viewport] }], evidence_dir: evidenceDir, mcp: { command: PLAYWRIGHT_MCP_COMMAND, server: 'playwright' }, reviewer: { provider: VISION_REVIEWER.provider, model: VISION_REVIEWER.model, catalog: HIGH_VIS_CATALOG }, requirements: { needs_vision: true } } })
  const duration_ms = Date.now() - started
  const visualReview = (runResult.reviews || []).find((r) => r.review_type === 'visual')
  const visualStatus = visualReview?.review?.status || runResult?.visualGate?.outcome || null
  let image_fingerprint = null, screenshot_path = null
  try {
    const evList = runResult?.evidence || runResult?.visualEvidence || []
    if (evList.length) { const ev = evList.find((e) => e.viewport === viewport) || evList[0]; image_fingerprint = ev?.image_fingerprint || null; screenshot_path = ev?.screenshot_path || null }
    if (!image_fingerprint && runResult.run_id) { const files = await fs.readdir(evidenceDir).catch(() => []); const m = files.find((f) => f.startsWith(runResult.run_id) && f.endsWith('.png')); if (m) { screenshot_path = path.join(evidenceDir, m); try { image_fingerprint = crypto.createHash('sha256').update(await fs.readFile(screenshot_path)).digest('hex') } catch {} } }
  } catch {}
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
  const findings = visualReview?.review?.findings || []
  return { run_id: runResult.run_id, fixture: fixture.name, viewport, decision: runResult.decision?.decision || null, reason_code: runResult.decision?.reason_code || null, first_bad_boundary: runResult.decision?.first_bad_boundary || null, visual_status: visualStatus, findings: findings.map((f) => ({ category: f.category, severity: f.severity, blocking: f.blocking, confidence: f.confidence, viewport: f.viewport || viewport, model_severity: f.model_severity || null, calibrated_severity: f.calibrated_severity || f.severity, calibration_rule: f.calibration_rule || null })), finding_count: findings.length, image_fingerprint, screenshot_path, review_provider: VISION_REVIEWER.provider, review_model: VISION_REVIEWER.model, duration_ms, events_summary: (runResult.events || []).slice(-20).map((e) => ({ job: e.job, phase: e.phase, status: e.status, failure_signature: e.failure_signature || null })), raw_run_id: runResult.run_id }
}
export async function runMultiViewport({ fixture, viewports, evidenceDir, viewportProfile = null, customViewports = null }) {
  if (!viewports?.length) throw new Error('runMultiViewport: viewports array required')
  const absPath = path.resolve(path.join(FIXTURE_ROOT_DIR, fixture.path))
  const stat = await fs.stat(absPath); if (!stat.isFile()) throw new Error(`Fixture missing: ${absPath}`)
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), `ocae-visual-${fixture.name}-multi-`))
  const buildExecutor = async () => { await fs.writeFile(path.join(tmpRoot, 'proof.html'), `<!doctype html><title>proof</title><p>${fixture.name} ${viewports.join(',')}</p>`); return { changed_files: ['proof.html'], errors: [], strategy_delta: null } }
  const started = Date.now()
  const visualQaConfig = { required: true, pages: [{ name: fixture.name, path: absPath, viewports }], evidence_dir: evidenceDir, mcp: { command: PLAYWRIGHT_MCP_COMMAND, server: 'playwright' }, reviewer: { provider: VISION_REVIEWER.provider, model: VISION_REVIEWER.model, catalog: HIGH_VIS_CATALOG }, requirements: { needs_vision: true } }
  if (viewportProfile) visualQaConfig.viewport_profile = viewportProfile
  if (customViewports) visualQaConfig.custom_viewports = customViewports
  const runResult = await runTask({ taskInput: { task: `visual-qa ${fixture.name} ${viewports.join(',')}`, repository: tmpRoot }, repoRoot: tmpRoot, nativePlan: { planText: nativePlanFor(fixture.name) }, buildExecutor, verifyChecks: [], routing: { enabled: false }, visualQa: visualQaConfig })
  const duration_ms = Date.now() - started
  const visualReview = (runResult.reviews || []).find((r) => r.review_type === 'visual')
  const visualStatus = visualReview?.review?.status || runResult?.visualGate?.outcome || null
  const image_fingerprints = {}, perViewportMeta = {}
  try {
    const evList = runResult?.evidence || runResult?.visualEvidence || []
    for (const ev of evList) { const vp = ev.viewport || ev.viewport_id || 'unknown'; if (ev.image_fingerprint) { image_fingerprints[vp] = ev.image_fingerprint; perViewportMeta[vp] = { screenshot_path: ev.screenshot_path || null } } }
    if (!Object.keys(image_fingerprints).length && runResult.run_id) { const files = await fs.readdir(evidenceDir).catch(() => []); for (const vp of viewports) { const m = files.find((f) => f.startsWith(runResult.run_id) && f.includes(vp) && f.endsWith('.png')); if (m) { const p = path.join(evidenceDir, m); try { image_fingerprints[vp] = crypto.createHash('sha256').update(await fs.readFile(p)).digest('hex'); perViewportMeta[vp] = { screenshot_path: p } } catch {} } } }
  } catch {}
  await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
  const findings = visualReview?.review?.findings || []
  const per_viewport = viewports.map((vp) => { const ff = findings.filter((f) => (f.viewport || f.viewport_id) === vp); const blk = ff.some((f) => f.blocking); return { viewport: vp, visual_status: blk ? 'FINDINGS_BLOCKING' : ff.length ? 'FINDINGS_NON_BLOCKING' : 'PASS', findings: ff.map((f) => ({ category: f.category, severity: f.severity, blocking: f.blocking, confidence: f.confidence, viewport: f.viewport || vp, model_severity: f.model_severity || null, calibrated_severity: f.calibrated_severity || f.severity, calibration_rule: f.calibration_rule || null })), finding_count: ff.length, image_fingerprint: image_fingerprints[vp] || null, screenshot_path: perViewportMeta[vp]?.screenshot_path || null } })
  const correlated = runResult?.correlated_findings || visualReview?.review?.correlated_findings || []
  return { run_id: runResult.run_id, fixture: fixture.name, viewports: [...viewports], viewport_profile: runResult?.viewport_profile || viewportProfile || null, viewport_matrix: runResult?.viewport_matrix || viewports, viewport_resolved: runResult?.viewport_resolved || [], decision: runResult.decision?.decision || null, reason_code: runResult.decision?.reason_code || null, first_bad_boundary: runResult.decision?.first_bad_boundary || null, visual_status: visualStatus, findings: findings.map((f) => ({ category: f.category, severity: f.severity, blocking: f.blocking, confidence: f.confidence, viewport: f.viewport || f.viewport_id, model_severity: f.model_severity || null, calibrated_severity: f.calibrated_severity || f.severity, calibration_rule: f.calibration_rule || null, finding_id: f.finding_id })), finding_count: findings.length, correlated_findings: (Array.isArray(correlated) ? correlated : []).map((c) => ({ finding_id: c.finding_id, category: c.category, page: c.page, affected_viewports: c.affected_viewports, unaffected_viewports: c.unaffected_viewports, severity: c.severity, calibrated_severity: c.calibrated_severity, blocking: c.blocking, correlation_confidence: c.correlation_confidence, member_count: c.member_count })), correlation_stats: runResult?.correlation_stats || { total_raw: findings.length, produced: (correlated || []).length, incorrect_merges: 0, missed_merges: 0 }, calibration_info: findings.map((f) => ({ finding_id: f.finding_id, category: f.category, viewport: f.viewport || f.viewport_id, model_severity: f.model_severity || null, calibrated_severity: f.calibrated_severity || f.severity, calibration_rule: f.calibration_rule || null })), per_viewport, image_fingerprints, image_fingerprint: null, review_provider: VISION_REVIEWER.provider, review_model: VISION_REVIEWER.model, duration_ms, events_summary: (runResult.events || []).slice(-20).map((e) => ({ job: e.job, phase: e.phase, status: e.status, failure_signature: e.failure_signature || null })), raw_run_id: runResult.run_id }
}
async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { printHelp(); process.exit(0) }
  const manifest = await loadManifest()
  const allSelected = args.fixture === 'all' ? manifest.fixtures : manifest.fixtures.filter((f) => f.name === args.fixture)
  if (!allSelected.length) throw new Error(`Fixture not found: ${args.fixture}`)
  const evidenceDir = path.resolve(args.evidenceDir)
  await fs.mkdir(evidenceDir, { recursive: true, mode: 0o700 })
  const isProfileMode = args.viewportProfile !== null
  const effectiveCustomViewports = args.customViewports || (args.viewports ? args.viewports.map((n) => { const d = CANONICAL_VIEWPORTS[n]; return d ? { name: n, width: d.width, height: d.height } : { name: n, width: 1280, height: 800 } }) : null)
  let totalRuns = 0; for (const f of allSelected) { const multi = isProfileMode || f.viewports.length > 2; totalRuns += multi ? 1 : (args.viewport === 'both' ? f.viewports.length : f.viewports.includes(args.viewport) ? 1 : 0) }
  if (!totalRuns) { console.error(`No fixture×viewport pairs matched (fixture=${args.fixture}, viewport=${args.viewport}, profile=${args.viewportProfile || 'none'}).`); process.exit(1) }
  console.log(`Visual QA session: ${totalRuns} run(s) — fixture=${args.fixture} viewport=${args.viewport} viewport_profile=${args.viewportProfile || 'auto'}`)
  if (args.viewports) console.log(`Viewports: ${args.viewports.join(', ')}`)
  if (args.customViewports) console.log(`Custom viewports: ${JSON.stringify(args.customViewports)}`)
  console.log(`Fixture root: ${FIXTURE_ROOT_DIR}\nEvidence dir: ${evidenceDir}\nPlaywright MCP: ${JSON.stringify(PLAYWRIGHT_MCP_COMMAND)}\nVision: ${VISION_REVIEWER.provider}/${VISION_REVIEWER.model}`)
  console.log('')
  const results = []
  for (const fixture of allSelected) {
    const useMulti = isProfileMode || fixture.viewports.length > 2
    if (useMulti) {
      let viewports; if (isProfileMode) { if (args.viewports) viewports = [...args.viewports]; else { const res = resolveViewportProfile({ profile: args.viewportProfile, customViewports: effectiveCustomViewports || [] }); viewports = res.ok ? res.viewports.map((v) => v.viewport_id) : [...fixture.viewports] } } else viewports = [...fixture.viewports]
      console.log(`→ ${fixture.name} @ [${viewports.join(', ')}] (multi) ...`)
      try {
        const r = await runMultiViewport({ fixture, viewports, evidenceDir, viewportProfile: args.viewportProfile, customViewports: effectiveCustomViewports })
        results.push(r); const p = path.join(evidenceDir, `session-${r.fixture}-multi-${r.run_id}.json`); await fs.writeFile(p, JSON.stringify(r, null, 2), { encoding: 'utf8', mode: 0o600 })
        const fps = Object.values(r.image_fingerprints || {}).map((fp) => fp.slice(0, 8)).join(','); console.log(`  decision=${r.decision} visual_status=${r.visual_status} findings=${r.finding_count} correlated=${r.correlated_findings.length} fps=[${fps}] → ${p}`)
        for (const cf of r.correlated_findings) console.log(`    correlated ${cf.finding_id} ${cf.category} affected=[${cf.affected_viewports.join(',')}] unaffected=[${cf.unaffected_viewports.join(',')}] severity=${cf.calibrated_severity || cf.severity}`)
        if (r.calibration_info?.length) console.log(`    calibration: ${r.calibration_info.map((c) => `${c.viewport}:${c.model_severity}->${c.calibrated_severity}(${c.calibration_rule})`).join(' | ')}`)
        console.log(`    viewport_matrix: [${(r.viewport_matrix || viewports).join(', ')}] profile=${r.viewport_profile || args.viewportProfile || 'auto'}`)
      } catch (e) { console.error(`  FAILED ${fixture.name}@multi: ${e.message}`); results.push({ fixture: fixture.name, viewports, error: e.message, decision: null, visual_status: null, findings: [], correlated_findings: [], image_fingerprints: {} }) }
    } else {
      const vps = args.viewport === 'both' ? fixture.viewports : fixture.viewports.includes(args.viewport) ? [args.viewport] : []
      for (const viewport of vps) {
        console.log(`→ ${fixture.name} @ ${viewport} ...`)
        try { const r = await runOne({ fixture, viewport, evidenceDir }); results.push(r); const p = path.join(evidenceDir, `session-${r.fixture}-${r.viewport}-${r.run_id}.json`); await fs.writeFile(p, JSON.stringify(r, null, 2), { encoding: 'utf8', mode: 0o600 }); console.log(`  decision=${r.decision} visual_status=${r.visual_status} findings=${r.finding_count} fp=${r.image_fingerprint ? r.image_fingerprint.slice(0, 12) + '…' : 'null'} → ${p}`) } catch (e) { console.error(`  FAILED ${fixture.name}@${viewport}: ${e.message}`); results.push({ fixture: fixture.name, viewport, error: e.message, decision: null, visual_status: null }) }
      }
    }
  }
  const metrics = computeCorpusMetrics(results, manifest), responsiveMetrics = computeResponsiveMetrics(results, manifest)
  const correlatedTotal = results.reduce((s, r) => s + (r.correlated_findings?.length || 0), 0)
  const viewportMatrixAll = [...new Set(results.flatMap((r) => r.viewport_matrix || r.viewports || (r.viewport ? [r.viewport] : [])))]
  const summary = { created_at: new Date().toISOString(), repo_root: '.', fixture_root: path.relative(REPO_ROOT, FIXTURE_ROOT_DIR), evidence_dir: path.relative(REPO_ROOT, evidenceDir), playwright_mcp_command: PLAYWRIGHT_MCP_COMMAND.map((c) => c.replace(REPO_ROOT, '.').replace(os.homedir(), '<home>')), vision_reviewer: VISION_REVIEWER, args: { fixture: args.fixture, viewport: args.viewport, viewport_profile: args.viewportProfile, viewports: args.viewports, custom_viewports: args.customViewports }, total: results.length, results, metrics, responsive_metrics: responsiveMetrics, viewport_profile: args.viewportProfile || null, viewport_profiles_used: [...new Set(results.map((r) => r.viewport_profile).filter(Boolean))], viewport_matrix: viewportMatrixAll, correlated_findings_total: correlatedTotal, calibration_summary: { total_findings: results.reduce((s, r) => s + (r.calibration_info?.length || r.findings?.length || 0), 0) } }
  const summaryPath = path.join(evidenceDir, 'summary.json'); await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), { encoding: 'utf8', mode: 0o600 }); await fs.writeFile(path.join(evidenceDir, 'manifest.snapshot.json'), JSON.stringify(manifest, null, 2), { encoding: 'utf8', mode: 0o600 })
  console.log(`\nSUMMARY: ${summaryPath}`); console.log(JSON.stringify({ total: summary.total, metrics, responsive_metrics: responsiveMetrics, viewport_profile: summary.viewport_profile, viewport_matrix: summary.viewport_matrix, correlated_findings_total: correlatedTotal, evidence_dir: evidenceDir }, null, 2)); console.log(JSON.stringify(summary))
}
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main().catch((e) => { console.error(e.stack || String(e)); process.exit(1) })
