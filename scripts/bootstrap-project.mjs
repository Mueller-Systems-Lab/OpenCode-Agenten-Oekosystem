#!/usr/bin/env node

import path from "node:path"
import fs from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { discoverProject } from "./lib/discovery.mjs"
import { loadManifest, validateManifest, selectManifestRecommendations } from "./lib/manifest.mjs"
import { buildOpenCodeOverlay, mergeOpenCodeConfig, writeOpenCodeConfig } from "./lib/opencode.mjs"
import { buildHermesBundle, buildHermesGatewayNote, buildHermesReadmeMarkdown, buildHermesRootMarkdown } from "./lib/hermes.mjs"
import { createBackup, restoreBackup } from "./lib/backup.mjs"
import { ensureDirectory, ensureParentDirectory, pathExists, readTextIfExists, toAbsolutePath, writeText, relativePath, assertSafePath } from "./lib/paths.mjs"
import { renderDiscoveryMarkdown, renderPlanMarkdown, renderRunReportMarkdown, writeJsonReport, writeMarkdownReport } from "./lib/report.mjs"
import { selectMcpCandidates } from "./lib/mcp.mjs"
import { mergeDeep, mergeManagedSections } from "./lib/merge.mjs"
import { evaluateAllGates, CLASSIFICATIONS } from "./lib/gates/evaluate-all.mjs"
import { safeRedactText, secretValuesFromEnv } from "./lib/security/redaction.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  printHelp()
  process.exit(0)
}

if (!args.target && !args.rollback) {
  console.error("Missing required --target")
  process.exit(1)
}

const targetRoot = args.target ? toAbsolutePath(args.target) : null
const manifestPath = path.join(repoRoot, "ecosystem.manifest.json")

await main().catch((error) => {
  console.error(safeRedactText(error instanceof Error ? error.message : String(error), { secrets: secretValuesFromEnv() }))
  process.exitCode = 1
})

async function main() {
  const manifest = await loadManifest(manifestPath)
  const manifestIssues = validateManifest(manifest)
  if (manifestIssues.length > 0) {
    console.log("RED_BLOCK")
    manifestIssues.forEach((issue) => console.log(`- ${issue}`))
    process.exitCode = 2
    return
  }

  if (args.rollback) {
    const result = await restoreBackup({ backupRoot: args.rollback })
    console.log(`Rollback completed for ${result.targetRoot}`)
    console.log("GREEN_SAFE")
    process.exitCode = 0
    return
  }

  const discovery = await discoverProject(targetRoot)
  const selected = selectManifestRecommendations(manifest, discovery, { includeRemoteCI: args.includeRemoteCI })
  const mcpSelection = selectMcpCandidates(discovery, { includeRemoteCI: args.includeRemoteCI })
  const overlay = await buildOverlay({ manifest, discovery, selected, mcpSelection, sourceRoot: repoRoot, targetRoot })
  const discoveryFindings = computeDiscoveryFindings(discovery, selected, mcpSelection, overlay)

  const writePaths = overlay.files.map((f) => f.destination)
  const gateDecision = await evaluateAllGates({
    targetRoot,
    runtime: "auto",
    action: args.apply ? "apply" : "evaluate",
    writePaths,
    enforcementContext: {
      hasBackup: false,
      hasValidatedManifest: true,
      environment: "development",
    },
    riskTier: "LOW_LOCAL",
    dryRun: !args.apply,
    worktreeRoot: targetRoot,
  })

  const classification = gateDecision.classification

  const plan = buildPlan({
    discovery, selected, mcpSelection, overlay, classification,
    applyRequested: false,
    gateDecision,
    discoveryFindings,
  })

  if (!args.apply) {
    console.log(renderDiscoveryMarkdown(discoveryForReport(discovery, selected, mcpSelection, null)))
    console.log("")
    console.log(renderPlanMarkdown(plan))
    console.log(classification)
    process.exitCode = classification === "GREEN_SAFE" ? 0 : classification === "AMBER_REVIEW" || classification === "TOOL_GAP" ? 1 : 2
    return
  }

  if (discoveryFindings.has_blockers) {
    console.error("RED_BLOCK: Discovery findings indicate blocking conditions.")
    discoveryFindings.notes.forEach((n) => console.log(`  - ${n}`))
    process.exitCode = 2
    return
  }

  const filesToBackup = [
    ...overlay.files.map((file) => file.destination),
    path.join(targetRoot, ".opencode", "reports", "bootstrap", "discovery.json"),
    path.join(targetRoot, ".opencode", "reports", "bootstrap", "discovery.md"),
    path.join(targetRoot, ".opencode", "reports", "bootstrap", "plan.json"),
    path.join(targetRoot, ".opencode", "reports", "bootstrap", "plan.md"),
    path.join(targetRoot, "docs", "reports", "universal-bootstrap-run-report.md"),
  ]
  const backup = await createBackup({ targetRoot, files: filesToBackup })

  const applyGateDecision = await evaluateAllGates({
    targetRoot,
    runtime: "auto",
    action: "apply",
    writePaths,
    enforcementContext: {
      hasBackup: true,
      hasValidatedManifest: true,
      environment: "development",
    },
    riskTier: "LOW_LOCAL",
    dryRun: false,
    worktreeRoot: targetRoot,
  })

  if (applyGateDecision.classification === CLASSIFICATIONS.RED_BLOCK) {
    console.error("RED_BLOCK: Canonical gate evaluation blocked the apply operation.")
    for (const block of applyGateDecision.blockedBy) {
      console.error(`  - [${block.layer}] ${block.message}`)
    }
    process.exitCode = 2
    return
  }

  if (applyGateDecision.classification === CLASSIFICATIONS.TOOL_GAP) {
    console.warn("TOOL_GAP: Missing enforcement detected.")
    for (const gap of applyGateDecision.toolGaps) {
      console.warn(`  - ${gap}`)
    }
  }

  if (applyGateDecision.classification === CLASSIFICATIONS.AMBER_REVIEW) {
    console.warn("AMBER_REVIEW: Proceeding with apply as explicitly requested.")
    for (const warning of applyGateDecision.warnings) {
      console.warn(`  - ${warning}`)
    }
  }

  await applyOverlay(overlay)

  const reportsDir = path.join(targetRoot, ".opencode", "reports", "bootstrap")
  await ensureDirectory(reportsDir)
  const reportDiscovery = discoveryForReport(discovery, selected, mcpSelection, backup.backupDir)
  const reportPlan = buildPlan({
    discovery, selected, mcpSelection, overlay, classification: applyGateDecision.classification,
    backupRoot: backup.backupDir, applyRequested: true,
    gateDecision: applyGateDecision,
    discoveryFindings,
  })
  const changedFiles = overlay.files.map((file) => relativePath(targetRoot, file.destination))

  await writeJsonReport(path.join(reportsDir, "discovery.json"), reportDiscovery)
  await writeMarkdownReport(path.join(reportsDir, "discovery.md"), renderDiscoveryMarkdown(reportDiscovery))
  await writeJsonReport(path.join(reportsDir, "plan.json"), reportPlan)
  await writeMarkdownReport(path.join(reportsDir, "plan.md"), renderPlanMarkdown(reportPlan))

  const validation = await validateRepoState(targetRoot)
  const runReport = {
    classification: applyGateDecision.classification,
    target_root: targetRoot,
    timestamp: new Date().toISOString(),
    summary: "Bootstrap applied with conservative merge rules, backup protection, and canonical gate evaluation.",
    changed_files: changedFiles,
    evidence: [
      `Backup root: ${backup.backupDir}`,
      `Discovery report: ${path.join(reportsDir, "discovery.md")}`,
      `Plan report: ${path.join(reportsDir, "plan.md")}`,
      `Validation: ${validation.classification}`,
      `Gate classification: ${applyGateDecision.classification}`,
    ],
    uncertainties: validation.uncertainties,
    gate_evaluation: {
      classification: applyGateDecision.classification,
      verification_level: applyGateDecision.verificationLevel,
      kernel_blocked_by: applyGateDecision.blockedBy.filter((b) => b.layer === "kernel").map((b) => ({ code: b.code, message: b.message })),
      runtime_adapter: applyGateDecision.adapterSelection || { detectedAs: "generic", confidence: 0 },
      required_approvals: applyGateDecision.requiredApprovals.map((a) => a.type),
      tool_gaps: applyGateDecision.toolGaps,
      discovery_findings: discoveryFindings.notes,
    },
  }

  await writeMarkdownReport(path.join(targetRoot, "docs", "reports", "universal-bootstrap-run-report.md"), renderRunReportMarkdown(runReport))

  console.log(renderPlanMarkdown(reportPlan))
  console.log(applyGateDecision.classification)
  process.exitCode = applyGateDecision.classification === "GREEN_SAFE" ? 0 : applyGateDecision.classification === "AMBER_REVIEW" || applyGateDecision.classification === "TOOL_GAP" ? 1 : 2
}

function parseArgs(argv) {
  const result = {
    apply: false,
    includeRemoteCI: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      result.help = true
    } else if (arg === "--apply") {
      result.apply = true
    } else if (arg === "--include-remote-ci") {
      result.includeRemoteCI = true
    } else if (arg === "--target") {
      result.target = argv[++i]
    } else if (arg === "--rollback") {
      result.rollback = argv[++i]
    } else if (arg === "--manifest") {
      result.manifest = argv[++i]
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return result
}

function printHelp() {
  console.log(`Usage:
  node scripts/bootstrap-project.mjs --target <project> [--apply] [--include-remote-ci]
  node scripts/bootstrap-project.mjs --target <project> --rollback <backup-dir>
`)
}

function computeDiscoveryFindings(discovery, selected, mcpSelection, overlay) {
  const signals = discovery.signals.map((signal) => signal.id)
  const tierheimMissing = signals.includes("tierheim-signals") && !selected.skills.includes("tierheim-compliance")
  return {
    overlay_conflict_count: overlay.conflicts.length,
    tierheim_missing_compliance: tierheimMissing,
    remote_ci_requested: mcpSelection.remote_ci_requested,
    has_blockers: tierheimMissing,
    notes: [
      overlay.conflicts.length > 0 ? `${overlay.conflicts.length} overlay conflict(s) detected` : null,
      tierheimMissing ? "tierheim signals present but tierheim-compliance skill not selected" : null,
      mcpSelection.remote_ci_requested ? "remote CI workflows requested" : null,
    ].filter(Boolean),
  }
}

function buildPlan({ discovery, selected, mcpSelection, overlay, classification, backupRoot, applyRequested = false, gateDecision, discoveryFindings }) {
  const rollbackCommand = backupRoot
    ? `node scripts/bootstrap-project.mjs --target ${JSON.stringify(discovery.target_root)} --rollback ${JSON.stringify(backupRoot)}`
    : "Run apply mode first to create a backup."

  const plan = {
    target_root: discovery.target_root,
    classification,
    apply_requested: applyRequested,
    include_remote_ci: mcpSelection.remote_ci_requested,
    files: overlay.files.map((file) => ({
      path: relativePath(discovery.target_root, file.destination),
      action: file.action,
    })),
    skills: selected.skills,
    mcps: mcpSelection.candidates,
    conflicts: overlay.conflicts,
    backup_root: backupRoot || null,
    rollback_command: rollbackCommand,
  }

  if (discoveryFindings) {
    plan.discovery_findings = discoveryFindings.notes
  }

  if (gateDecision) {
    plan.gate_evaluation = {
      classification: gateDecision.classification,
      verification_level: gateDecision.verificationLevel,
      kernel_blocked_by: (gateDecision.blockedBy || [])
        .filter((b) => b.layer === "kernel")
        .map((b) => ({ code: b.code, message: b.message })),
      required_approvals: (gateDecision.requiredApprovals || []).map((a) => a.type),
      tool_gaps: gateDecision.toolGaps || [],
      warnings: gateDecision.warnings || [],
    }
  }

  return plan
}

function discoveryForReport(discovery, selected, mcpSelection, backupRoot) {
  return {
    target_root: discovery.target_root,
    classification: discovery.classification,
    language: discovery.language,
    package_manager: discovery.package_manager,
    frameworks: discovery.frameworks,
    test_frameworks: discovery.test_frameworks,
    databases: discovery.databases,
    monorepo: discovery.monorepo,
    notes: discovery.notes,
    signals: discovery.signals,
    existing: discovery.existing,
    selected_skills: selected.skills,
    selected_agents: selected.agents,
    selected_mcps: mcpSelection.candidates.map((candidate) => ({
      name: candidate.name,
      tier: candidate.tier,
      enabled: candidate.enabled,
      reason: candidate.reason,
    })),
    backup_root: backupRoot,
  }
}

async function buildOverlay({ manifest, discovery, selected, mcpSelection, sourceRoot, targetRoot }) {
  const overlays = []
  const conflicts = []

  await recordTopLevelConflict(targetRoot, path.join(targetRoot, "opencode.jsonc"), conflicts, "OpenCode config", { merged: true })
  overlays.push({
    destination: path.join(targetRoot, "opencode.jsonc"),
    kind: "config",
    overlay: buildOpenCodeOverlay({ includeRemoteCI: mcpSelection.remote_ci_requested }),
  })

  for (const fileName of ["AGENTS.md", "CONTRIBUTING.md", "SECURITY.md"]) {
    await recordTopLevelConflict(targetRoot, path.join(targetRoot, fileName), conflicts, `${fileName} managed section`)
    overlays.push({
      destination: path.join(targetRoot, fileName),
      kind: "markdown",
      sourcePath: path.join(sourceRoot, fileName),
      managed: true,
    })
  }

  overlays.push({
    destination: path.join(targetRoot, ".hermes.md"),
    kind: "markdown",
    managed: buildHermesRootMarkdown(),
  })
  await recordTopLevelConflict(targetRoot, path.join(targetRoot, ".hermes.md"), conflicts, "Hermes handoff")
  overlays.push({
    destination: path.join(targetRoot, ".hermes", "README.md"),
    kind: "markdown",
    managed: buildHermesReadmeMarkdown(),
  })
  await recordTopLevelConflict(targetRoot, path.join(targetRoot, ".hermes", "README.md"), conflicts, "Hermes README")
  overlays.push({
    destination: path.join(targetRoot, ".hermes", "skills", "README.md"),
    kind: "markdown",
    sourcePath: path.join(sourceRoot, ".hermes", "skills", "README.md"),
  })
  await recordTopLevelConflict(targetRoot, path.join(targetRoot, ".hermes", "skills", "README.md"), conflicts, "Hermes skills README")
  overlays.push({
    destination: path.join(targetRoot, ".hermes", "bundles", "project-bootstrap.json"),
    kind: "json",
    overlay: buildHermesBundle("project-bootstrap", selected.skills, selected.notes),
  })
  await recordTopLevelConflict(targetRoot, path.join(targetRoot, ".hermes", "bundles", "project-bootstrap.json"), conflicts, "Hermes bundle")
  overlays.push({
    destination: path.join(targetRoot, ".hermes", "mcp", "opencode-gateway.md"),
    kind: "markdown",
    managed: buildHermesGatewayNote(),
  })
  await recordTopLevelConflict(targetRoot, path.join(targetRoot, ".hermes", "mcp", "opencode-gateway.md"), conflicts, "Hermes MCP gateway note")

  for (const name of ["agents", "skills", "policies", "templates", "validation", "prompts", "hooks"]) {
    const sourceDir = path.join(sourceRoot, ".opencode", name)
    const destinationDir = path.join(targetRoot, ".opencode", name)
    const treeConflicts = []
    overlays.push({
      destination: destinationDir,
      kind: "tree",
      sourcePath: sourceDir,
      files: await collectTreeFiles(sourceDir, destinationDir, sourceRoot, targetRoot, treeConflicts),
    })
    conflicts.push(...treeConflicts)
  }

  if (mcpSelection.remote_ci_requested) {
    overlays.push({
      destination: path.join(targetRoot, ".github", "workflows"),
      kind: "tree",
      sourcePath: path.join(sourceRoot, ".github", "workflows"),
      files: await collectTreeFiles(path.join(sourceRoot, ".github", "workflows"), path.join(targetRoot, ".github", "workflows"), sourceRoot, targetRoot),
    })
  }

  return { files: flattenOverlayFiles(overlays), overlays, conflicts, manifest, sourceRoot, targetRoot }
}

function flattenOverlayFiles(overlays) {
  const files = []
  for (const overlay of overlays) {
    if (overlay.kind === "tree") {
      for (const file of overlay.files ?? []) {
        files.push({ destination: file.destination, action: "sync-tree" })
      }
    } else if (overlay.kind === "config") {
      files.push({ destination: overlay.destination, action: "merge-config" })
    } else if (overlay.kind === "json") {
      files.push({ destination: overlay.destination, action: "write-json" })
    } else if (overlay.kind === "markdown") {
      files.push({ destination: overlay.destination, action: overlay.sourcePath ? "merge-doc" : "create-doc" })
    }
  }
  return files
}

async function applyOverlay(overlay) {
  for (const item of overlay.overlays) {
    if (item.kind === "config") {
      await assertSafePath(overlay.targetRoot, item.destination, "OpenCode destination")
      await writeOpenCodeConfig(item.destination, item.overlay)
      continue
    }
    if (item.kind === "json") {
      await assertSafePath(overlay.targetRoot, item.destination, "JSON destination")
      await ensureParentDirectory(item.destination)
      await fs.writeFile(item.destination, `${JSON.stringify(item.overlay, null, 2)}\n`, "utf8")
      continue
    }
    if (item.kind === "markdown") {
      if (item.sourcePath) {
        await assertSafePath(overlay.sourceRoot, item.sourcePath, "markdown source")
      }
      await assertSafePath(overlay.targetRoot, item.destination, "markdown destination")
      const existing = (await readTextIfExists(item.destination)) || ""
      let next = existing
      if (item.sourcePath) {
        const source = await fs.readFile(item.sourcePath, "utf8")
        next = mergeManagedSections(existing, [source])
      } else {
        next = mergeManagedSections(existing, [item.managed])
      }
      await writeText(item.destination, next)
      continue
    }
    if (item.kind === "tree") {
      await syncTree(item.sourcePath, item.destination, overlay.sourceRoot, overlay.targetRoot)
      continue
    }
  }
}

async function syncTree(sourceDir, destinationDir, sourceRoot, targetRoot) {
  if (!(await pathExists(sourceDir))) return
  await assertSafePath(sourceRoot, sourceDir, "tree source")
  await assertSafePath(targetRoot, destinationDir, "tree destination")
  await ensureDirectory(destinationDir)
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const destinationPath = path.join(destinationDir, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to copy symlinked source path: ${sourcePath}`)
    }
    if (entry.isDirectory()) {
      const destinationStat = await pathExists(destinationPath) ? await fs.lstat(destinationPath) : null
      if (destinationStat && !destinationStat.isDirectory()) {
        continue
      }
      await syncTree(sourcePath, destinationPath, sourceRoot, targetRoot)
      continue
    }
    const destinationStat = await pathExists(destinationPath) ? await fs.lstat(destinationPath) : null
    if (destinationStat) {
      if (!destinationStat.isFile()) {
        continue
      }
      const sourceText = await fs.readFile(sourcePath, "utf8")
      const destinationText = await fs.readFile(destinationPath, "utf8")
      if (sourceText !== destinationText) {
        continue
      }
      continue
    }
    await ensureParentDirectory(destinationPath)
    await fs.copyFile(sourcePath, destinationPath)
  }
}

async function validateRepoState(targetRoot) {
  const uncertain = []
  const blocking = []

  const opencodePath = await findFirstExisting(targetRoot, ["opencode.jsonc", "opencode.json"])
  if (!opencodePath) blocking.push("missing OpenCode config")

  const skillsDir = path.join(targetRoot, ".opencode", "skills")
  if (!(await pathExists(skillsDir))) blocking.push("missing .opencode/skills")

  const hermesRoot = path.join(targetRoot, ".hermes.md")
  if (!(await pathExists(hermesRoot))) uncertain.push("Hermes root markdown was not generated")

  const classification = blocking.length > 0 ? "RED_BLOCK" : uncertain.length > 0 ? "AMBER_REVIEW" : "GREEN_SAFE"
  return { classification, uncertainties: uncertain, blocking }
}

async function findFirstExisting(root, relPaths) {
  for (const rel of relPaths) {
    const abs = path.join(root, rel)
    if (await pathExists(abs)) return abs
  }
  return null
}

async function collectTreeFiles(sourceDir, destinationDir, sourceRoot, targetRoot, conflicts = []) {
  const files = []
  if (!(await pathExists(sourceDir))) return files
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const destinationPath = path.join(destinationDir, entry.name)
    if (entry.isSymbolicLink()) {
      conflicts.push(`symlink blocked in overlay source: ${relativePath(sourceRoot, sourcePath)}`)
      continue
    }
    if (entry.isDirectory()) {
      const destinationStat = await pathExists(destinationPath) ? await fs.lstat(destinationPath) : null
      if (destinationStat && !destinationStat.isDirectory()) {
        conflicts.push(`existing non-directory preserved: ${relativePath(targetRoot, destinationPath)}`)
        continue
      }
      files.push(...await collectTreeFiles(sourcePath, destinationPath, sourceRoot, targetRoot, conflicts))
    } else {
      const destinationStat = await pathExists(destinationPath) ? await fs.lstat(destinationPath) : null
      if (destinationStat) {
        if (!destinationStat.isFile()) {
          conflicts.push(`existing non-file preserved: ${relativePath(targetRoot, destinationPath)}`)
          continue
        }
        const [sourceText, destinationText] = await Promise.all([
          fs.readFile(sourcePath, "utf8"),
          fs.readFile(destinationPath, "utf8"),
        ])
        if (sourceText !== destinationText) {
          conflicts.push(`existing file preserved: ${relativePath(targetRoot, destinationPath)}`)
        }
      }
      files.push({ source: sourcePath, destination: destinationPath })
    }
  }
  return files
}

async function recordTopLevelConflict(targetRoot, destination, conflicts, label, { merged = false } = {}) {
  if (await pathExists(destination)) {
    const verb = merged ? "existing file will be merged" : "existing file preserved"
    conflicts.push(`${verb}: ${relativePath(targetRoot, destination)} (${label})`)
  }
}
