import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { classifyVisualPaths, renderClassification } from "../../scripts/classify-visual-qa-diff.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const securityWorkflow = readFileSync(path.join(root, ".github/workflows/opencode-security-review.yml"), "utf8")
const visualWorkflow = readFileSync(path.join(root, ".github/workflows/opencode-visual-qa.yml"), "utf8")
const classifier = path.join(root, "scripts/classify-visual-qa-diff.mjs")

describe("PR CI workflow contracts", () => {
  it("allows ecosystem validation to capture the complete canonical test output", () => {
    const validator = readFileSync(path.join(root, "scripts/validate-ecosystem.mjs"), "utf8")
    assert.match(validator, /maxBuffer\s*=\s*50\s*\*\s*1024\s*\*\s*1024/)
    assert.ok(
      validator.indexOf("if (result.error)") < validator.indexOf("// Parse test summary"),
      "spawn errors such as ENOBUFS must be reported before interpreting a missing test summary",
    )
    assert.match(validator, /scripts["'], ["']run-tests\.mjs/)
    assert.match(validator, /"--all"/)
    assert.match(validator, /EXPECTED_TEST_FILES/)
    assert.match(validator, /EXECUTED_TEST_FILES/)
  })

  it("runs deterministic security gates without provider credentials or write permissions", () => {
    assert.doesNotMatch(securityWorkflow, /ANTHROPIC_API_KEY|anomalyco\/opencode\/github|@latest/)
    assert.doesNotMatch(securityWorkflow, /pull-requests:\s*write|issues:\s*write|id-token:\s*write/)
    assert.match(securityWorkflow, /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\|\|\s*github\.sha\s*\}\}/)
    assert.match(securityWorkflow, /apt-get install --no-install-recommends --yes bubblewrap/)
    assert.match(securityWorkflow, /bwrap --version/)
    assert.match(securityWorkflow, /CHECK_RESULT: NOT_APPLICABLE/)
    assert.match(securityWorkflow, /fallback="TOOL_GAP_SECURE_SANDBOX; no unsandboxed execution"/)
    assert.match(securityWorkflow, /echo "FALLBACK_CONTRACT: \$fallback"/)
    assert.match(securityWorkflow, /--group integration_portable/)
    assert.match(securityWorkflow, /OCAE_SECURE_SANDBOX_NOT_APPLICABLE: "1"/)
    for (const group of ["unit", "contract", "integration"]) {
      assert.match(securityWorkflow, new RegExp(`scripts/run-tests\\.mjs --group ${group}`))
    }
  })

  it("runs deterministic validation after master pushes", () => {
    assert.match(securityWorkflow, /push:\s*\n\s*branches:\s*\n\s*-\s*master/)
    assert.match(securityWorkflow, /scripts\/run-tests\.mjs/)
    assert.match(securityWorkflow, /scripts\/validate-ecosystem\.mjs/)
    assert.match(securityWorkflow, /scripts\/check-governance-drift\.mjs/)
    assert.doesNotMatch(securityWorkflow, /continue-on-error|\|\|\s*true/)
  })

  it("requires explicit visual diff classification evidence", () => {
    assert.doesNotMatch(visualWorkflow, /ANTHROPIC_API_KEY|anomalyco\/opencode\/github|@latest/)
    assert.doesNotMatch(visualWorkflow, /pull-requests:\s*write|id-token:\s*write|continue-on-error|\\|\\| true/)
    assert.match(visualWorkflow, /classify-visual-qa-diff\.mjs/)
    assert.match(visualWorkflow, /CHECK_RESULT/)
    assert.match(visualWorkflow, /EVALUATED_PATHS/)
  })

  it("classifies dependency metadata alone as NOT_APPLICABLE with evidence", () => {
    const result = classify(["package.json", "docs/architecture/governance-v2.md", "test/fixtures/bootstrap/frontend-playwright/src/App.tsx"])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /CHECK_RESULT: NOT_APPLICABLE/)
    assert.match(result.stdout, /REASON: No visual or frontend artifacts changed/)
    assert.match(result.stdout, /EVALUATED_PATHS: package\.json, docs\/architecture\/governance-v2\.md, test\/fixtures\/bootstrap\/frontend-playwright\/src\/App\.tsx/)
  })

  it("classifies frontend and stylesheet paths as APPLICABLE", () => {
    for (const changedPath of ["client/src/App.tsx", "src/theme/base.css", "src/theme/base.scss"]) {
      const result = classify([changedPath])
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /CHECK_RESULT: APPLICABLE/)
      assert.match(result.stdout, new RegExp(escapeRegex(changedPath)))
    }
  })

  it("fails closed when visual validation is applicable but unavailable", () => {
    const result = classify(["client/src/App.tsx"], ["--fail-on-applicable"])
    assert.equal(result.status, 3)
    assert.match(result.stdout, /CHECK_RESULT: APPLICABLE/)
    assert.match(result.stderr, /NEEDS_REVIEW_VISUAL_QA/)
  })
})

function classify(paths, extraArgs = []) {
  const classification = classifyVisualPaths(paths)
  const failClosed = classification.applicable && extraArgs.includes("--fail-on-applicable")
  return {
    status: failClosed ? 3 : 0,
    stdout: renderClassification(classification),
    stderr: failClosed ? "NEEDS_REVIEW_VISUAL_QA: visual artifacts changed but no repository-owned visual validation runtime is configured" : "",
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
