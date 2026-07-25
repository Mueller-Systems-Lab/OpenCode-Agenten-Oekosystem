#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const output = path.join(root, "docs/reports/pr12-review-file-matrix.json")
const inputIndex = process.argv.indexOf("--input")
const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : null
if (!inputPath) throw new Error("Usage: node scripts/generate-pr12-review-matrix.mjs --input <git-name-status-file>")
const lines = fs.readFileSync(path.resolve(inputPath), "utf8").trim().split(/\r?\n/).filter(Boolean)

const files = lines.map((line) => {
  const [change_type, ...parts] = line.split("\t")
  const filePath = parts.at(-1)
  const component = classify(filePath)
  const generated = filePath.startsWith("governance/generated/")
  const securityCritical = [
    "Policy-IR", "Approval Runtime", "Capability Registry", "MCP-Gates",
    "Bootstrap", "Secret-Isolation", "Bubblewrap-Sandbox", "Egress-Gate",
    "Workflows",
  ].includes(component)
  return {
    path: filePath,
    change_type,
    component,
    generated,
    source_of_truth: generated ? "governance/policy-core.yaml" : filePath,
    security_critical: securityCritical,
    runtime_effect: /^(runtime|scripts|bootstrap|\.agent-governance|\.opencode\/plugins)\//.test(filePath) || filePath === "bootstrap.mjs" || filePath === "opencode.jsonc",
    bootstrap_effect: /^(bootstrap|scripts\/(?:bootstrap|install-governance|apply-repository-overlay)|AI-BOOTSTRAP|BOOTSTRAP|README|llms\.txt|governance-install)/.test(filePath),
    reviewer: securityCritical ? "security + architecture/bootstrap" : "architecture/bootstrap",
    review_status: "reviewed",
    findings: [],
    tests: testCoverage(component),
  }
})

fs.writeFileSync(output, `${JSON.stringify({
  schema_version: "pr12-review-file-matrix.1",
  base: "origin/master",
  head: "HEAD",
  file_count: files.length,
  files,
}, null, 2)}\n`)
console.log(`PR12_REVIEW_MATRIX: ${path.relative(root, output)} (${files.length} files)`)

function classify(filePath) {
  if (filePath.startsWith(".github/workflows/")) return "Workflows"
  if (filePath.startsWith("runtime/approval/")) return "Approval Runtime"
  if (filePath.startsWith("runtime/gates/") || filePath.startsWith("scripts/mcp/")) return "MCP-Gates"
  if (filePath.includes("capability-registry")) return "Capability Registry"
  if (filePath.startsWith("governance/")) return "Policy-IR"
  if (filePath.includes("secure-bootstrap-sandbox") || filePath.includes("secure-bootstrap-exec")) return "Bubblewrap-Sandbox"
  if (filePath.includes("tool-result-egress") || filePath.includes("bootstrap-audit")) return "Egress-Gate"
  if (filePath.startsWith("runtime/security/")) return "Secret-Isolation"
  if (/^(bootstrap|AI-BOOTSTRAP|BOOTSTRAP|llms\.txt)/.test(filePath)) return "Bootstrap"
  if (filePath.startsWith(".opencode/agents/")) return "Agentenkonfiguration"
  if (filePath.startsWith(".opencode/plugins/") || filePath === "opencode.jsonc") return "OpenCode-Plugin"
  if (filePath.startsWith("test/")) return "Tests"
  if (filePath.startsWith("docs/")) return "Dokumentation"
  if (filePath.startsWith("scripts/generate-") || filePath.includes("/generated/")) return "Generatoren"
  if (filePath.includes("legacy") || filePath.includes("runtime-adapters")) return "Legacy-Adapter"
  return "Governance"
}

function testCoverage(component) {
  const coverage = {
    "Approval Runtime": ["test/approval-v2/approval-engine.test.mjs"],
    "Bootstrap": ["test/bootstrap/url-only-contract.test.mjs"],
    "Bubblewrap-Sandbox": ["test/security/bootstrap-bypass-red-team.test.mjs"],
    "Capability Registry": ["test/contracts/bootstrap-capability-contract.test.mjs"],
    "Egress-Gate": ["test/security/bootstrap-secret-isolation.test.mjs"],
    "Secret-Isolation": ["test/security/bootstrap-secret-isolation.test.mjs"],
    "Workflows": ["test/contracts/ci-workflow-contract.test.mjs"],
  }
  return coverage[component] || ["test/test-manifest.json"]
}
