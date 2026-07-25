#!/usr/bin/env node

import path from "node:path"
import fs from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { discoverProject } from "./lib/discovery.mjs"
import { loadManifest, selectManifestRecommendations } from "./lib/manifest.mjs"
import { buildOpenCodeOverlay, writeOpenCodeConfig, mergeOpenCodeMarkdown } from "./lib/opencode.mjs"
import { buildHermesBundle, buildHermesGatewayNote, buildHermesReadmeMarkdown, buildHermesRootMarkdown } from "./lib/hermes.mjs"
import { createBackup, restoreBackup } from "./lib/backup.mjs"
import { ensureDirectory, ensureParentDirectory, pathExists, readTextIfExists, writeText, relativePath, toAbsolutePath, assertSafePath } from "./lib/paths.mjs"
import { renderDiscoveryMarkdown, renderPlanMarkdown, writeJsonReport, writeMarkdownReport } from "./lib/report.mjs"
import { selectMcpCandidates } from "./lib/mcp.mjs"
import { mergeDeep } from "./lib/merge.mjs"
import { safeRedactText, secretValuesFromEnv } from "./lib/security/redaction.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const args = parseArgs(process.argv.slice(2))
const targetRoot = toAbsolutePath(args.target || process.cwd())
const sourceRoot = args.source ? toAbsolutePath(args.source) : repoRoot

if (args.help) {
  printHelp()
  process.exit(0)
}

await main().catch((error) => {
  console.error(safeRedactText(error instanceof Error ? error.message : String(error), { secrets: secretValuesFromEnv() }))
  process.exitCode = 1
})

async function main() {
  const manifest = await loadManifest(path.join(repoRoot, "ecosystem.manifest.json"))

  if (args.rollback) {
    const result = await restoreBackup({ backupRoot: args.rollback })
    console.log(`Rollback completed for ${result.targetRoot}`)
    return
  }

  const discovery = await discoverProject(targetRoot)
  const selected = selectManifestRecommendations(manifest, discovery, { includeRemoteCI: args.includeRemoteCI })
  const mcpSelection = selectMcpCandidates(discovery, { includeRemoteCI: args.includeRemoteCI })
  const overlay = await buildOverlay({ manifest, discovery, selected, mcpSelection, sourceRoot, targetRoot })

  if (!args.apply) {
    const plan = buildPlan({ discovery, selected, mcpSelection, overlay, classification: classify(discovery, selected, mcpSelection, overlay), applyRequested: false })
    console.log(renderPlanMarkdown(plan))
    return
  }

  const filesToBackup = [
    ...overlay.files.map((file) => file.destination),
    path.join(targetRoot, ".opencode", "reports", "bootstrap", "discovery.json"),
    path.join(targetRoot, ".opencode", "reports", "bootstrap", "discovery.md"),
    path.join(targetRoot, ".opencode", "reports", "bootstrap", "plan.json"),
    path.join(targetRoot, ".opencode", "reports", "bootstrap", "plan.md"),
  ]
  const backup = await createBackup({ targetRoot, files: filesToBackup })
  await applyOverlay(overlay)

  const plan = buildPlan({
    discovery,
    selected,
    mcpSelection,
    overlay,
    classification: classify(discovery, selected, mcpSelection, overlay),
    backupRoot: backup.backupDir,
    applyRequested: true,
  })

  const reportsDir = path.join(targetRoot, ".opencode", "reports", "bootstrap")
  await ensureDirectory(reportsDir)
  await writeJsonReport(path.join(reportsDir, "discovery.json"), discoveryForReport(discovery, selected, mcpSelection, backup.backupDir))
  await writeMarkdownReport(path.join(reportsDir, "discovery.md"), renderDiscoveryMarkdown(discoveryForReport(discovery, selected, mcpSelection, backup.backupDir)))
  await writeJsonReport(path.join(reportsDir, "plan.json"), plan)
  await writeMarkdownReport(path.join(reportsDir, "plan.md"), renderPlanMarkdown(plan))

  console.log(renderPlanMarkdown(plan))
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
    } else if (arg === "--source") {
      result.source = argv[++i]
    } else if (arg === "--rollback") {
      result.rollback = argv[++i]
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return result
}

function printHelp() {
  console.log(`Usage:
  node scripts/apply-repository-overlay.mjs --target <project> [--source <overlay>] [--apply] [--include-remote-ci]
  node scripts/apply-repository-overlay.mjs --rollback <backup-dir>
`)
}

function classify(discovery, selected, mcpSelection, overlay) {
  if (discovery.signals.some((signal) => signal.id === "tierheim-signals") && !selected.skills.includes("tierheim-compliance")) {
    return "RED_BLOCK"
  }
  if (overlay.conflicts.length > 0) {
    return "AMBER_REVIEW"
  }
  if (mcpSelection.remote_ci_requested) {
    return "AMBER_REVIEW"
  }
  return "GREEN_SAFE"
}

async function buildOverlay({ manifest, discovery, selected, mcpSelection, sourceRoot, targetRoot }) {
  const overlays = []
  const files = []
  const conflicts = []

  const opencodeConfigPath = path.join(targetRoot, "opencode.jsonc")
  if (await pathExists(opencodeConfigPath)) {
    conflicts.push(`existing file preserved: ${relativePath(targetRoot, opencodeConfigPath)} (OpenCode config)`)
  }
  overlays.push({
    destination: opencodeConfigPath,
    kind: "jsonc",
    overlay: buildOpenCodeOverlay({ includeRemoteCI: mcpSelection.remote_ci_requested }),
  })
  files.push({ destination: opencodeConfigPath, action: "merge-config" })

  const mdFiles = [
    ["AGENTS.md", path.join(sourceRoot, "AGENTS.md")],
    ["CONTRIBUTING.md", path.join(sourceRoot, "CONTRIBUTING.md")],
    ["SECURITY.md", path.join(sourceRoot, "SECURITY.md")],
  ]

  for (const [relativeName, sourcePath] of mdFiles) {
    const destination = path.join(targetRoot, relativeName)
    if (await pathExists(destination)) {
      conflicts.push(`existing file preserved: ${relativePath(targetRoot, destination)} (${relativeName})`)
    }
    overlays.push({
      destination,
      kind: "markdown",
      sourcePath,
    })
    files.push({ destination, action: "merge-doc" })
  }

  const rootMarkdown = path.join(targetRoot, ".hermes.md")
  if (await pathExists(rootMarkdown)) {
    conflicts.push(`existing file preserved: ${relativePath(targetRoot, rootMarkdown)} (Hermes root)`)
  }
  overlays.push({
    destination: rootMarkdown,
    kind: "markdown",
    managed: buildHermesRootMarkdown(),
  })
  files.push({ destination: rootMarkdown, action: "create-doc" })

  const hermesReadme = path.join(targetRoot, ".hermes", "README.md")
  if (await pathExists(hermesReadme)) {
    conflicts.push(`existing file preserved: ${relativePath(targetRoot, hermesReadme)} (Hermes README)`)
  }
  overlays.push({
    destination: hermesReadme,
    kind: "markdown",
    managed: buildHermesReadmeMarkdown(),
  })
  files.push({ destination: hermesReadme, action: "create-doc" })

  const hermesSkillsReadme = path.join(targetRoot, ".hermes", "skills", "README.md")
  if (await pathExists(hermesSkillsReadme)) {
    conflicts.push(`existing file preserved: ${relativePath(targetRoot, hermesSkillsReadme)} (Hermes skills README)`)
  }
  overlays.push({
    destination: hermesSkillsReadme,
    kind: "markdown",
    sourcePath: path.join(sourceRoot, ".hermes", "skills", "README.md"),
  })
  files.push({ destination: hermesSkillsReadme, action: "merge-doc" })

  const bundle = buildHermesBundle("project-bootstrap", selected.skills, selected.notes)
  const bundlePath = path.join(targetRoot, ".hermes", "bundles", "project-bootstrap.json")
  if (await pathExists(bundlePath)) {
    conflicts.push(`existing file preserved: ${relativePath(targetRoot, bundlePath)} (Hermes bundle)`)
  }
  overlays.push({
    destination: bundlePath,
    kind: "json",
    overlay: bundle,
  })
  files.push({ destination: bundlePath, action: "create-bundle" })

  const gatewayNotePath = path.join(targetRoot, ".hermes", "mcp", "opencode-gateway.md")
  if (await pathExists(gatewayNotePath)) {
    conflicts.push(`existing file preserved: ${relativePath(targetRoot, gatewayNotePath)} (Hermes MCP gateway note)`)
  }
  overlays.push({
    destination: gatewayNotePath,
    kind: "markdown",
    managed: buildHermesGatewayNote(),
  })
  files.push({ destination: gatewayNotePath, action: "create-doc" })

  for (const name of ["agents", "skills", "policies", "templates", "validation", "prompts", "hooks"]) {
    const sourceDir = path.join(sourceRoot, ".opencode", name)
    const destinationDir = path.join(targetRoot, ".opencode", name)
    const treeConflicts = []
    const treeFiles = await collectTreeFiles(sourceDir, destinationDir, sourceRoot, targetRoot, treeConflicts)
    conflicts.push(...treeConflicts)
    overlays.push({ destination: destinationDir, kind: "tree", sourcePath: sourceDir, files: treeFiles })
    for (const file of treeFiles) {
      files.push({ destination: file.destination, action: "sync-tree" })
    }
  }

  if (mcpSelection.remote_ci_requested) {
    const sourceDir = path.join(sourceRoot, ".github", "workflows")
    const destinationDir = path.join(targetRoot, ".github", "workflows")
    const treeConflicts = []
    const treeFiles = await collectTreeFiles(sourceDir, destinationDir, sourceRoot, targetRoot, treeConflicts)
    conflicts.push(...treeConflicts)
    overlays.push({ destination: destinationDir, kind: "tree", sourcePath: sourceDir, files: treeFiles })
    for (const file of treeFiles) {
      files.push({ destination: file.destination, action: "sync-tree" })
    }
  }

  if (selected.agents.includes("playwright-agent") || discovery.frameworks.includes("playwright")) {
    const playbook = path.join(targetRoot, ".opencode", "reports", "bootstrap", "mcp-candidates.json")
    overlays.push({
      destination: playbook,
      kind: "json",
      overlay: {
        candidates: mcpSelection.candidates,
        notes: mcpSelection.notes,
      },
    })
    files.push({ destination: playbook, action: "create-report" })
  }

  return { overlays, files, manifest, conflicts, sourceRoot, targetRoot }
}

async function applyOverlay(overlay) {
  for (const entry of overlay.overlays) {
    if (entry.kind === "jsonc" || entry.kind === "json") {
      await assertSafePath(overlay.targetRoot, entry.destination, "overlay destination")
      const existing = await readJsonLike(entry.destination)
      const merged = mergeDeep(existing ?? {}, entry.overlay ?? {})
      await writeText(entry.destination, `${JSON.stringify(merged, null, 2)}\n`)
      continue
    }

    if (entry.kind === "markdown") {
      await assertSafePath(overlay.targetRoot, entry.destination, "overlay destination")
      if (entry.sourcePath) {
        await assertSafePath(overlay.sourceRoot, entry.sourcePath, "overlay source")
      }
      const existing = (await readTextIfExists(entry.destination)) ?? ""
      const next = entry.sourcePath
        ? await mergeManagedMarkdown(existing, entry.sourcePath)
        : mergeMarkdownText(existing, entry.managed)
      await writeText(entry.destination, next)
      continue
    }

    if (entry.kind === "tree") {
      await syncTree(entry.sourcePath, entry.destination, overlay.sourceRoot, overlay.targetRoot)
      continue
    }
  }
}

async function syncTree(sourceDir, destinationDir, sourceRoot, targetRoot) {
  if (!(await pathExists(sourceDir))) return
  await assertSafePath(sourceRoot, sourceDir, "tree source")
  await assertSafePath(targetRoot, destinationDir, "tree destination")
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  await ensureDirectory(destinationDir)
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
    } else {
      const destinationStat = await fs.lstat(destinationPath).catch(() => null)
      if (destinationStat) {
        if (destinationStat.isSymbolicLink()) {
          throw new Error(`Refusing to overwrite symlink at destination: ${destinationPath}`)
        }
        continue
      }
      await ensureParentDirectory(destinationPath)
      await fs.copyFile(sourcePath, destinationPath)
    }
  }
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
      continue
    }
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
  return files
}

async function mergeManagedMarkdown(existing, sourcePath) {
  const source = await fs.readFile(sourcePath, "utf8")
  return mergeMarkdownText(existing, source)
}

function mergeMarkdownText(existing, source) {
  return mergeOpenCodeMarkdown(existing, source)
}

async function readJsonLike(filePath) {
  if (!(await pathExists(filePath))) return null
  const raw = await fs.readFile(filePath, "utf8")
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function buildPlan({ discovery, selected, mcpSelection, overlay, classification, backupRoot, applyRequested = false }) {
  const rollbackCommand = backupRoot
    ? `node scripts/apply-repository-overlay.mjs --target ${JSON.stringify(discovery.target_root)} --rollback ${JSON.stringify(backupRoot)}`
    : "run apply first to create a backup"

  return {
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
}

function discoveryForReport(discovery, selected, mcpSelection, backupRoot) {
  return {
    ...discovery,
    selected_skills: selected.skills,
    selected_agents: selected.agents,
    selected_mcps: mcpSelection.candidates.map((candidate) => ({
      name: candidate.name,
      tier: candidate.tier,
      enabled: candidate.enabled,
      reason: candidate.reason,
    })),
    backup_root: backupRoot || null,
  }
}
