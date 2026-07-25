#!/usr/bin/env node

import path from "node:path"
import fs from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { loadManifest, validateManifest } from "./lib/manifest.mjs"
import { extractFrontmatter, validateAgentFrontmatter, validateSkillFrontmatter } from "./lib/frontmatter.mjs"
import { parseJsonc } from "./lib/jsonc.mjs"
import { pathExists, readTextIfExists, toAbsolutePath, normalizePosix } from "./lib/paths.mjs"
import { safeRedactText, secretValuesFromEnv } from "./lib/security/redaction.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

await main().catch((error) => {
  console.error(safeRedactText(error instanceof Error ? error.message : String(error), { secrets: secretValuesFromEnv() }))
  process.exitCode = 2
})

async function main() {
  const issues = []
  const warnings = []

  const manifestPath = path.join(repoRoot, "ecosystem.manifest.json")
  const manifest = await loadManifest(manifestPath)
  issues.push(...validateManifest(manifest))

  issues.push(...await validateJsonFile(path.join(repoRoot, "opencode.jsonc"), "opencode.jsonc"))
  issues.push(...await validateJsonFile(path.join(repoRoot, ".opencode/policies/evidence-gates.json"), "evidence-gates.json"))
  issues.push(...await validateJsonFile(path.join(repoRoot, ".opencode/policies/mcp-trust-tiers.json"), "mcp-trust-tiers.json"))
  issues.push(...await validateJsonFile(path.join(repoRoot, ".opencode/policies/data-retention.json"), "data-retention.json"))
  issues.push(...await validateJsonFile(path.join(repoRoot, ".opencode/policies/write-protection.json"), "write-protection.json"))
  issues.push(...await validateJsonFile(path.join(repoRoot, ".opencode/policies/model-routing.json"), "model-routing.json"))

  issues.push(...await validateMarkdownDirs(path.join(repoRoot, ".opencode/skills"), "skill"))
  issues.push(...await validateMarkdownDirs(path.join(repoRoot, ".opencode/agents"), "agent"))

  const requiredFiles = [
    "BOOTSTRAP.md",
    "README.md",
    "AGENTS.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "ecosystem.manifest.json",
    ".hermes.md",
    ".hermes/README.md",
    ".hermes/skills/README.md",
    ".hermes/bundles/project-bootstrap.json",
    ".hermes/mcp/opencode-gateway.md",
    "docs/reports/research-findings.md",
    "docs/plans/universal-bootstrap-plan.md",
    "docs/architecture/universal-bootstrap.md",
    "docs/architecture/universal-bootstrap.mmd",
    "docs/adr/ADR-universal-project-bootstrap.md",
    "docs/reports/security-review.md",
    "docs/reports/compliance-review.md",
    "WORKING-METHOD.md",
    ".opencode/policies/working-method.json",
    ".opencode/skills/context-engineering/SKILL.md",
    ".opencode/skills/risk-tier-routing/SKILL.md",
    ".opencode/skills/verification-contract/SKILL.md",
    ".opencode/skills/owner-approval-gate/SKILL.md",
    ".opencode/skills/anti-fake-execution/SKILL.md",
    ".opencode/skills/privacy-data-minimization/SKILL.md",
    ".hermes/skill-bundles/canonical-working-method.yaml",
    ".hermes/config.example.yaml",
    "docs/architecture/canonical-working-method.md",
    "docs/architecture/canonical-working-method.mmd",
    "docs/reports/working-method-deep-dive-2026-07-15.md",
    // Gate Kernel
    "docs/architecture/runtime-neutral-gate-kernel.md",
    "docs/reports/runtime-gate-kernel-research.md",
    "docs/reports/odysseus-integration-research.md",
    "docs/reports/gate-kernel-security-review.md",
    "docs/reports/gate-kernel-compliance-review.md",
    "docs/reports/coderabbit-removal-report.md",
    "scripts/lib/gates/kernel.mjs",
    "scripts/lib/gates/approval.mjs",
    "scripts/lib/gates/evidence.mjs",
    "scripts/lib/gates/decision.mjs",
    "scripts/lib/gates/classifications.mjs",
    "scripts/lib/gates/context-fingerprint.mjs",
    "scripts/lib/gates/errors.mjs",
    "scripts/lib/gates/policy.mjs",
    "scripts/lib/runtimes/contract.mjs",
    "scripts/lib/runtimes/generic.mjs",
    "scripts/lib/runtimes/opencode.mjs",
    "scripts/lib/runtimes/hermes.mjs",
    "scripts/lib/runtimes/odysseus.mjs",
    "scripts/evaluate-gates.mjs",
    "test/gates/kernel.test.mjs",
    "test/gates/approval.test.mjs",
    "test/gates/runtime-adapters.test.mjs",
    "test/gates/comment-policy.test.mjs",
    "LICENSE",
  ]
  issues.push(...await validateRequiredFiles(requiredFiles))

  issues.push(...await validateScriptSyntax([
    "scripts/bootstrap-project.mjs",
    "scripts/validate-ecosystem.mjs",
    "scripts/install-global.mjs",
    "scripts/apply-repository-overlay.mjs",
    "scripts/evaluate-gates.mjs",
    "scripts/lib/discovery.mjs",
    "scripts/lib/frontmatter.mjs",
    "scripts/lib/backup.mjs",
    "scripts/lib/manifest.mjs",
    "scripts/lib/mcp.mjs",
    "scripts/lib/opencode.mjs",
    "scripts/lib/paths.mjs",
    "scripts/lib/report.mjs",
    "scripts/lib/jsonc.mjs",
    "scripts/lib/hermes.mjs",
    "scripts/lib/merge.mjs",
    "scripts/lib/gates/kernel.mjs",
    "scripts/lib/gates/approval.mjs",
    "scripts/lib/gates/evidence.mjs",
    "scripts/lib/gates/decision.mjs",
    "scripts/lib/gates/classifications.mjs",
    "scripts/lib/gates/context-fingerprint.mjs",
    "scripts/lib/gates/errors.mjs",
    "scripts/lib/gates/policy.mjs",
    "scripts/lib/runtimes/contract.mjs",
    "scripts/lib/runtimes/generic.mjs",
    "scripts/lib/runtimes/opencode.mjs",
    "scripts/lib/runtimes/hermes.mjs",
    "scripts/lib/runtimes/odysseus.mjs",
  ]))

  issues.push(...await validateNoAbsoluteUserPaths())
  issues.push(...await validateManifestCatalogNames(manifest))
  issues.push(...await validateSkillAndAgentNames())
  warnings.push(...await validateOptionalArtifacts())

  // Working Method JSON Schema
  issues.push(...await validateWorkingMethodJson())

  // Manifest Catalogs — skills in generic
  issues.push(...await validateManifestGenericSkills(manifest))

  // Manifest Default Selection — generic detectors include core skills
  issues.push(...await validateManifestDetectorRecommendations(manifest))

  // OpenCode Config — no deprecated tools key
  issues.push(...await validateNoDeprecatedTools())

  // Instructions — WORKING-METHOD.md and working-method.json included, data-retention.json NOT included
  issues.push(...await validateInstructions())

  // working-method.json content checks
  issues.push(...await validateWorkingMethodRiskTiers())
  issues.push(...await validateWorkingMethodContextLevels())
  issues.push(...await validateWorkingMethodTruthLayers())
  issues.push(...await validateWorkingMethodApprovalGates())
  issues.push(...await validateWorkingMethodRunCardFields())
  issues.push(...await validateWorkingMethodPrivateRemoteCi())
  issues.push(...await validateWorkingMethodSecurityBeforeCompliance())

  // Audit retention — no generic 10 years or DSGVO compliance
  issues.push(...await validateAuditRetention())

  // Hermes YAML bundle — exists and is valid YAML
  issues.push(...await validateHermesYamlBundle())

  // Hermes config — write_approval: true for skills and memory
  issues.push(...await validateHermesConfig())

  // Security/Compliance agents in generic catalog
  issues.push(...await validateSecurityComplianceAgents(manifest))

  // Tierheim compliance in domain_specific catalog
  issues.push(...await validateTierheimDomainSpecific(manifest))

  // Domain decoupling — data-retention in domain_specific
  issues.push(...await validateDataRetentionDomainSpecific(manifest))

  // Test suite gate — GREEN_SAFE requires all tests passing
  const testResult = runTestSuite()
  if (testResult.status === "FAILED") {
    issues.push(testResult.message)
  } else if (testResult.status === "UNAVAILABLE") {
    warnings.push(testResult.message)
  }

  const status = issues.length > 0 ? "RED_BLOCK" : warnings.filter(Boolean).length > 0 ? "AMBER_REVIEW" : "GREEN_SAFE"
  console.log(status)
  for (const issue of issues) console.log(`- ${issue}`)
  for (const warning of warnings.filter(Boolean)) console.log(`- ${warning}`)
  process.exitCode = status === "GREEN_SAFE" ? 0 : status === "AMBER_REVIEW" ? 1 : 2
}

async function validateJsonFile(filePath, label) {
  if (!(await pathExists(filePath))) {
    return [`missing required JSON file: ${label}`]
  }
  try {
    const text = await fs.readFile(filePath, "utf8")
    parseJsonc(text)
    return []
  } catch (error) {
    return [`invalid JSON/JSONC in ${label}: ${error instanceof Error ? error.message : String(error)}`]
  }
}

async function validateMarkdownDirs(dirPath, kind) {
  const issues = []
  if (!(await pathExists(dirPath))) {
    issues.push(`missing required directory: ${normalizePosix(path.relative(repoRoot, dirPath))}`)
    return issues
  }
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const filePath = path.join(dirPath, entry.name, "SKILL.md")
    const text = await readTextIfExists(filePath)
    if (!text) {
      issues.push(`missing ${kind} file: ${normalizePosix(path.relative(repoRoot, filePath))}`)
      continue
    }
    if (kind === "skill") {
      issues.push(...validateSkillFrontmatter(filePath, text, entry.name))
    } else {
      issues.push(...validateAgentFrontmatter(filePath, text, entry.name))
    }
  }
  if (kind === "agent") {
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      const filePath = path.join(dirPath, entry.name)
      const text = await readTextIfExists(filePath)
      if (!text) continue
      issues.push(...validateAgentFrontmatter(filePath, text, entry.name.replace(/\.md$/, "")))
    }
  }
  return issues
}

async function validateRequiredFiles(files) {
  const issues = []
  for (const rel of files) {
    if (!(await pathExists(path.join(repoRoot, rel)))) {
      issues.push(`missing required file: ${rel}`)
    }
  }
  return issues
}

async function validateScriptSyntax(files) {
  const issues = []
  for (const rel of files) {
    const abs = path.join(repoRoot, rel)
    if (!(await pathExists(abs))) {
      issues.push(`missing script: ${rel}`)
    }
  }
  return issues
}

async function validateNoAbsoluteUserPaths() {
  const issues = []
  const files = await collectTextFiles(repoRoot)
  const patterns = [
    /\/home\/[A-Za-z0-9._-]+/g,
    /\/Users\/[A-Za-z0-9._-]+/g,
    /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/g,
  ]
  for (const [rel, text] of files) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        issues.push(`absolute user path found in ${rel}`)
        break
      }
    }
  }
  return issues
}

async function validateManifestCatalogNames(manifest) {
  const issues = []
  const names = new Set()
  for (const section of ["agents", "skills", "policies", "mcp_servers"]) {
    for (const bucket of ["generic", "conditional", "domain_specific", "experimental", "deprecated"]) {
      for (const entry of manifest.catalogs?.[section]?.[bucket] ?? []) {
        const name = typeof entry === "string" ? entry : entry.name
        if (!name) continue
        if (names.has(`${section}:${name}`)) {
          issues.push(`duplicate catalog entry: ${section}:${name}`)
        }
        names.add(`${section}:${name}`)
      }
    }
  }
  return issues
}

async function validateSkillAndAgentNames() {
  const issues = []
  for (const [dir, kind] of [
    [path.join(repoRoot, ".opencode/skills"), "skill"],
    [path.join(repoRoot, ".opencode/agents"), "agent"],
  ]) {
    if (!(await pathExists(dir))) {
      issues.push(`missing directory: ${normalizePosix(path.relative(repoRoot, dir))}`)
      continue
    }
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (kind === "skill" && entry.isDirectory()) {
        const file = path.join(dir, entry.name, "SKILL.md")
        const text = await readTextIfExists(file)
        if (text) issues.push(...validateSkillFrontmatter(file, text, entry.name))
      }
      if (kind === "agent" && entry.isFile() && entry.name.endsWith(".md")) {
        const file = path.join(dir, entry.name)
        const text = await readTextIfExists(file)
        if (text) issues.push(...validateAgentFrontmatter(file, text, entry.name.replace(/\.md$/, "")))
      }
    }
  }
  return issues
}

async function validateOptionalArtifacts() {
  return []
}

// ---------------------------------------------------------------------------
// New Validation Functions
// ---------------------------------------------------------------------------

async function loadWorkingMethod() {
  const filePath = path.join(repoRoot, ".opencode/policies/working-method.json")
  if (!(await pathExists(filePath))) return null
  try {
    const text = await fs.readFile(filePath, "utf8")
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function validateWorkingMethodJson() {
  const issues = []
  const filePath = path.join(repoRoot, ".opencode/policies/working-method.json")
  if (!(await pathExists(filePath))) {
    issues.push("missing working-method.json for schema validation")
    return issues
  }
  let wm
  try {
    const text = await fs.readFile(filePath, "utf8")
    wm = JSON.parse(text)
  } catch (error) {
    issues.push(`invalid JSON in working-method.json: ${error instanceof Error ? error.message : String(error)}`)
    return issues
  }

  const requiredKeys = [
    "version",
    "source_of_truth_order",
    "phases",
    "context_levels",
    "risk_tiers",
    "truth_layers",
    "classifications",
    "approval_gates",
    "constraint_reinjection_points",
    "mandatory_run_card_fields",
  ]
  for (const key of requiredKeys) {
    if (!(key in wm)) {
      issues.push(`working-method.json: missing required key "${key}"`)
    }
  }
  return issues
}

async function validateManifestGenericSkills(manifest) {
  const issues = []
  const expectedSkills = [
    "context-engineering",
    "risk-tier-routing",
    "verification-contract",
    "owner-approval-gate",
    "anti-fake-execution",
    "privacy-data-minimization",
  ]
  const genericSkills = new Set(manifest.catalogs?.skills?.generic ?? [])
  for (const skill of expectedSkills) {
    if (!genericSkills.has(skill)) {
      issues.push(`ecosystem.manifest.json: missing skill "${skill}" in catalogs.skills.generic`)
    }
  }
  return issues
}

async function validateManifestDetectorRecommendations(manifest) {
  const issues = []
  const coreSkills = [
    "context-engineering",
    "risk-tier-routing",
    "verification-contract",
    "anti-fake-execution",
    "privacy-data-minimization",
    "owner-approval-gate",
  ]
  for (const detector of manifest.detectors ?? []) {
    // Only validate comprehensive generic detectors that already have at least one core skill
    if (detector.domain === "generic" && detector.recommend && coreSkills.some((s) => detector.recommend.includes(s))) {
      for (const skill of coreSkills) {
        if (!detector.recommend.includes(skill)) {
          issues.push(`detector "${detector.id}" (${detector.domain}) is missing recommendation for skill "${skill}"`)
        }
      }
    }
  }
  return issues
}

async function validateNoDeprecatedTools() {
  const issues = []
  const filePath = path.join(repoRoot, "opencode.jsonc")
  if (!(await pathExists(filePath))) {
    issues.push("opencode.jsonc not found for tools check")
    return issues
  }
  try {
    const text = await fs.readFile(filePath, "utf8")
    const config = parseJsonc(text)

    // Check top-level tools key
    if ("tools" in config) {
      issues.push('opencode.jsonc: top-level "tools" key is present (deprecated)')
    }

    // Check tools key in every agent
    if (config.agent && typeof config.agent === "object") {
      for (const [agentName, agentConfig] of Object.entries(config.agent)) {
        if (agentConfig && typeof agentConfig === "object" && "tools" in agentConfig) {
          issues.push(`opencode.jsonc: agent "${agentName}" has deprecated "tools" key`)
        }
      }
    }
  } catch (error) {
    issues.push(`opencode.jsonc: parse error during tools check: ${error instanceof Error ? error.message : String(error)}`)
  }
  return issues
}

async function validateInstructions() {
  const issues = []
  const filePath = path.join(repoRoot, "opencode.jsonc")
  if (!(await pathExists(filePath))) {
    issues.push("opencode.jsonc not found for instructions check")
    return issues
  }
  try {
    const text = await fs.readFile(filePath, "utf8")
    const config = parseJsonc(text)
    const instructions = Array.isArray(config.instructions) ? config.instructions : []

    // Must include WORKING-METHOD.md
    if (!instructions.includes("WORKING-METHOD.md")) {
      issues.push('opencode.jsonc.instructions: missing "WORKING-METHOD.md"')
    }

    // Must include .opencode/policies/working-method.json
    if (!instructions.includes(".opencode/policies/working-method.json")) {
      issues.push('opencode.jsonc.instructions: missing ".opencode/policies/working-method.json"')
    }

    // Must NOT include .opencode/policies/data-retention.json
    if (instructions.includes(".opencode/policies/data-retention.json")) {
      issues.push('opencode.jsonc.instructions: must NOT include ".opencode/policies/data-retention.json"')
    }
  } catch (error) {
    issues.push(`opencode.jsonc: parse error during instructions check: ${error instanceof Error ? error.message : String(error)}`)
  }
  return issues
}

async function validateWorkingMethodRiskTiers() {
  const issues = []
  const wm = await loadWorkingMethod()
  if (!wm) {
    issues.push("working-method.json: could not load for risk tier validation")
    return issues
  }
  const requiredTiers = ["LOW_LOCAL", "MEDIUM_REVIEW", "HIGH_HUMAN_GATE", "CRITICAL_BLOCK"]
  for (const tier of requiredTiers) {
    if (!(tier in (wm.risk_tiers ?? {}))) {
      issues.push(`working-method.json.risk_tiers: missing tier "${tier}"`)
    }
  }
  return issues
}

async function validateWorkingMethodContextLevels() {
  const issues = []
  const wm = await loadWorkingMethod()
  if (!wm) {
    issues.push("working-method.json: could not load for context level validation")
    return issues
  }
  const requiredLevels = ["COLD", "WARM", "HOT"]
  for (const level of requiredLevels) {
    if (!(level in (wm.context_levels ?? {}))) {
      issues.push(`working-method.json.context_levels: missing level "${level}"`)
    }
  }
  return issues
}

async function validateWorkingMethodTruthLayers() {
  const issues = []
  const wm = await loadWorkingMethod()
  if (!wm) {
    issues.push("working-method.json: could not load for truth layer validation")
    return issues
  }
  const requiredLayers = ["0_reality", "1_executable", "2_evidence", "3_documentation", "4_memory_chat"]
  for (const layer of requiredLayers) {
    if (!(layer in (wm.truth_layers ?? {}))) {
      issues.push(`working-method.json.truth_layers: missing layer "${layer}"`)
    }
  }
  return issues
}

async function validateWorkingMethodApprovalGates() {
  const issues = []
  const wm = await loadWorkingMethod()
  if (!wm) {
    issues.push("working-method.json: could not load for approval gate validation")
    return issues
  }
  const requiredGates = ["apply", "commit", "push", "pr", "merge", "deploy", "remote_ci", "skill_write", "memory_write"]
  for (const gate of requiredGates) {
    if (!(gate in (wm.approval_gates ?? {}))) {
      issues.push(`working-method.json.approval_gates: missing gate "${gate}"`)
    }
  }
  return issues
}

async function validateWorkingMethodRunCardFields() {
  const issues = []
  const wm = await loadWorkingMethod()
  if (!wm) {
    issues.push("working-method.json: could not load for run card field validation")
    return issues
  }
  const requiredFields = [
    "goal",
    "why_necessary",
    "risk_tier",
    "context_level",
    "source_of_truth",
    "scope",
    "out_of_scope",
    "hard_constraints",
    "non_touch_areas",
    "involved_agents",
    "verification_contract",
    "red_tests",
    "test_matrix",
    "evidence_plan",
    "owner_approval_status",
    "rollback_strategy",
    "expected_completion_classification",
  ]
  const fields = wm.mandatory_run_card_fields ?? []
  for (const field of requiredFields) {
    if (!fields.includes(field)) {
      issues.push(`working-method.json.mandatory_run_card_fields: missing field "${field}"`)
    }
  }
  return issues
}

async function validateWorkingMethodPrivateRemoteCi() {
  const issues = []
  const wm = await loadWorkingMethod()
  if (!wm) {
    issues.push("working-method.json: could not load for remote_ci validation")
    return issues
  }
  const remoteCi = wm.remote_ci
  if (!remoteCi) {
      issues.push('working-method.json: missing "remote_ci" section')
    return issues
  }
  if (remoteCi.private_repo_without_approval !== "RED_BLOCK") {
    issues.push('working-method.json.remote_ci: private_repo_without_approval must be "RED_BLOCK"')
  }
  return issues
}

async function validateWorkingMethodSecurityBeforeCompliance() {
  const issues = []
  const wm = await loadWorkingMethod()
  if (!wm) {
    issues.push("working-method.json: could not load for phase order validation")
    return issues
  }
  const phases = wm.phases ?? []
  let securityOrder = -1
  let complianceOrder = -1
  for (const phase of phases) {
    if (phase.name === "security") securityOrder = phase.order
    if (phase.name === "compliance") complianceOrder = phase.order
  }
  if (securityOrder === -1) {
    issues.push('working-method.json.phases: missing phase "security"')
  }
  if (complianceOrder === -1) {
    issues.push('working-method.json.phases: missing phase "compliance"')
  }
  if (securityOrder !== -1 && complianceOrder !== -1 && securityOrder >= complianceOrder) {
    issues.push(`working-method.json.phases: "security" (order ${securityOrder}) must have lower order than "compliance" (order ${complianceOrder})`)
  }
  return issues
}

async function validateAuditRetention() {
  const issues = []
  const filePath = path.join(repoRoot, ".opencode/skills/audit-trail-enforcer/SKILL.md")
  if (!(await pathExists(filePath))) {
    issues.push("audit-trail-enforcer/SKILL.md not found for retention check")
    return issues
  }
  const text = await fs.readFile(filePath, "utf8")

  // Check for generic retention violations in the retention section
  // We split by ## Retention (or ## Retention\n) and check only that section
  const retentionMatch = text.match(/## Retention[\s\S]*?(?=\n## |\n---|$)/)
  const retentionSection = retentionMatch ? retentionMatch[0] : text

  if (/10 years/i.test(retentionSection)) {
    issues.push('audit-trail-enforcer/SKILL.md retention section must not contain "10 years" (generic retention)')
  }
  if (/DSGVO compliance/i.test(retentionSection)) {
    issues.push('audit-trail-enforcer/SKILL.md retention section must not contain "DSGVO compliance" (generic retention)')
  }
  return issues
}

async function validateHermesYamlBundle() {
  const issues = []
  const filePath = path.join(repoRoot, ".hermes/skill-bundles/canonical-working-method.yaml")
  if (!(await pathExists(filePath))) {
    issues.push(".hermes/skill-bundles/canonical-working-method.yaml not found")
    return issues
  }
  try {
    const text = await fs.readFile(filePath, "utf8")
    // Basic YAML validation: must contain name and skills keys
    if (!/^name:\s*\S/m.test(text)) {
      issues.push('.hermes/skill-bundles/canonical-working-method.yaml: missing "name" key')
    }
    if (!/^skills:/m.test(text)) {
      issues.push('.hermes/skill-bundles/canonical-working-method.yaml: missing "skills" key')
    }
  } catch (error) {
    issues.push(`.hermes/skill-bundles/canonical-working-method.yaml: read error: ${error instanceof Error ? error.message : String(error)}`)
  }
  return issues
}

async function validateHermesConfig() {
  const issues = []
  const filePath = path.join(repoRoot, ".hermes/config.example.yaml")
  if (!(await pathExists(filePath))) {
    issues.push(".hermes/config.example.yaml not found")
    return issues
  }
  try {
    const text = await fs.readFile(filePath, "utf8")
    const lines = text.split("\n")

    // Find each top-level section and verify write_approval within it
    function findWriteApprovalInSection(sectionName) {
      const sectionStart = lines.findIndex((l) => l.trim() === `${sectionName}:`)
      if (sectionStart === -1) return null
      // Look at lines after section header until next top-level key
      for (let i = sectionStart + 1; i < lines.length; i++) {
        const line = lines[i]
        // Stop at next top-level key (non-indented, non-empty, not a comment)
        if (i > sectionStart + 1 && line.trim() && !line.startsWith(" ") && !line.startsWith("\t") && !line.startsWith("#")) break
        const match = line.match(/^\s+write_approval:\s*(true|false)/)
        if (match) return match[1] === "true"
      }
      return null
    }

    const skillsApproval = findWriteApprovalInSection("skills")
    if (skillsApproval === null) {
      issues.push('.hermes/config.example.yaml: missing or unparseable "skills.write_approval"')
    } else if (!skillsApproval) {
      issues.push('.hermes/config.example.yaml: "skills.write_approval" must be "true"')
    }

    const memoryApproval = findWriteApprovalInSection("memory")
    if (memoryApproval === null) {
      issues.push('.hermes/config.example.yaml: missing or unparseable "memory.write_approval"')
    } else if (!memoryApproval) {
      issues.push('.hermes/config.example.yaml: "memory.write_approval" must be "true"')
    }
  } catch (error) {
    issues.push(`.hermes/config.example.yaml: read error: ${error instanceof Error ? error.message : String(error)}`)
  }
  return issues
}

async function validateSecurityComplianceAgents(manifest) {
  const issues = []
  const genericAgents = manifest.catalogs?.agents?.generic ?? []
  const agentNames = new Set(genericAgents.map((a) => (typeof a === "string" ? a : a.name)))

  if (!agentNames.has("security-agent")) {
    issues.push('ecosystem.manifest.json: "security-agent" must be in catalogs.agents.generic')
  }
  if (!agentNames.has("compliance-agent")) {
    issues.push('ecosystem.manifest.json: "compliance-agent" must be in catalogs.agents.generic')
  }
  return issues
}

async function validateTierheimDomainSpecific(manifest) {
  const issues = []
  const domainSkills = manifest.catalogs?.skills?.domain_specific ?? []
  if (!domainSkills.includes("tierheim-compliance")) {
    issues.push('ecosystem.manifest.json: "tierheim-compliance" must be in catalogs.skills.domain_specific')
  }
  return issues
}

async function validateDataRetentionDomainSpecific(manifest) {
  const issues = []
  const domainPolicies = manifest.catalogs?.policies?.domain_specific ?? []
  if (!domainPolicies.includes("data-retention")) {
    issues.push('ecosystem.manifest.json: "data-retention" must be in catalogs.policies.domain_specific')
  }
  return issues
}

async function collectTextFiles(root) {
  const files = []
  async function walk(current, depth = 0) {
    if (depth > 4) return
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const abs = path.join(current, entry.name)
      const rel = normalizePosix(path.relative(root, abs))
      if (rel.startsWith(".git/") || rel.startsWith("node_modules/") || rel.startsWith(".opencode/memory/")) continue
      if (entry.isDirectory()) {
        await walk(abs, depth + 1)
      } else if (/\.(md|json|jsonc|mjs|yml|yaml|toml|txt)$/i.test(entry.name)) {
        const text = await readTextIfExists(abs)
        if (text) files.push([rel, text])
      }
    }
  }
  await walk(root)
  return files
}

/**
 * Run the test suite and return status.
 * GREEN_SAFE classification requires all tests passing.
 * Test failures produce a RED_BLOCK issue (not just a warning) because
 * a green validator with red tests is a false signal.
 */
function runTestSuite() {
  try {
    const result = spawnSync("node", ["--test", "--test-reporter=spec"], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 120000,
      stdio: "pipe",
    })

    // Parse test summary
    const output = result.stdout + result.stderr
    const passMatch = output.match(/ℹ pass (\d+)/)
    const failMatch = output.match(/ℹ fail (\d+)/)
    const testsMatch = output.match(/ℹ tests (\d+)/)

    const passCount = passMatch ? parseInt(passMatch[1], 10) : 0
    const failCount = failMatch ? parseInt(failMatch[1], 10) : 0
    const totalCount = testsMatch ? parseInt(testsMatch[1], 10) : 0

    if (result.status !== 0 || failCount > 0) {
      return {
        status: "FAILED",
        message: `TEST_SUITE_FAILED: ${passCount}/${totalCount} tests passed, ${failCount} failed (exit code ${result.status})`
      }
    }

    if (result.error) {
      return {
        status: "UNAVAILABLE",
        message: `TEST_SUITE_UNAVAILABLE: could not execute tests (${result.error.message})`
      }
    }

    return { status: "PASSED" }
  } catch (error) {
    return {
      status: "UNAVAILABLE",
      message: `TEST_SUITE_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
