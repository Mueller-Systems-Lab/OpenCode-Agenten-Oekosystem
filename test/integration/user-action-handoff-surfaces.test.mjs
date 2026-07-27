import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { copyFixture, readJson, repoRoot, runNodeScript } from "../helpers.mjs"
import { validateUserActionHandoff } from "../../scripts/lib/user-action-handoff.mjs"
import { buildHermesBundle } from "../../scripts/lib/hermes.mjs"
import { createClosureEvidence, validateClosureEvidence } from "../../scripts/lib/closure-evidence.mjs"
import { createRegistry, validateRegistry } from "../../scripts/lib/ecosystem-registry.mjs"

const HEADING = "## Erforderliche Aktion durch den Nutzer"
const EMPTY = "Keine Aktion durch den Nutzer erforderlich."

async function read(relative) {
  return fs.readFile(path.join(repoRoot, relative), "utf8")
}

test("OpenCode kernel and generated AGENTS instructions inject the contract", async () => {
  assert.match(await read("PROMPT-KERNEL.md"), /Erforderliche Aktion durch den Nutzer/)
  const agents = await read("AGENTS.md")
  assert.match(agents, /Erforderliche Aktion durch den Nutzer/)
  assert.match(agents, /Keine Aktion durch den Nutzer erforderlich\./)
  assert.match(agents, /Capability/)
})

test("Hermes native bundle and generated handoff use the same semantics", async () => {
  const bundle = await read(".hermes/skill-bundles/canonical-working-method.yaml")
  assert.match(bundle, /Erforderliche Aktion durch den Nutzer/)
  assert.match(bundle, /PHYSICAL_ACTION_REQUIRED/)
  assert.match(bundle, /github_web/)
  const source = await read("scripts/lib/hermes.mjs")
  assert.match(source, /Erforderliche Aktion durch den Nutzer/)
  assert.match(source, /Keine Aktion durch den Nutzer erforderlich\./)
  const generated = buildHermesBundle("fixture", [], [])
  assert.deepEqual(generated.completion_contract, {
    schema: ".opencode/validation/schema-validators/user-action-handoff.schema.json",
    language: "de",
    section_title: "Erforderliche Aktion durch den Nutzer",
    empty_message: "Keine Aktion durch den Nutzer erforderlich.",
    actions_field: "actions",
    github_platform: "github_web",
  })
})

test("Spec-Kit implementation and close prompts require the canonical final section", async () => {
  const implement = await read("integrations/spec-kit/presets/opencode-canonical-method/commands/speckit.implement.md")
  const close = await read("integrations/spec-kit/extensions/opencode-evidence/commands/speckit.opencode-evidence.close.md")
  assert.match(implement, /Erforderliche Aktion durch den Nutzer/)
  assert.match(close, /Erforderliche Aktion durch den Nutzer/)
  assert.match(close, /non_delegable_user_actions/)
})

test("bootstrap fresh fixture generates AGENTS, Hermes, schema, and valid final report", async () => {
  const target = await copyFixture("generic-no-dsgvo")
  const result = runNodeScript("scripts/bootstrap-project.mjs", ["--target", target, "--apply"])
  assert.notEqual(result.status, 2, result.stderr)

  const agents = await fs.readFile(path.join(target, "AGENTS.md"), "utf8")
  const hermes = await fs.readFile(path.join(target, ".hermes.md"), "utf8")
  const report = await fs.readFile(path.join(target, "docs", "reports", "universal-bootstrap-run-report.md"), "utf8")
  const machineReport = await readJson(path.join(target, ".opencode", "reports", "bootstrap", "report.json"))
  const schema = await readJson(path.join(target, ".opencode", "validation", "schema-validators", "user-action-handoff.schema.json"))

  assert.match(agents, /Erforderliche Aktion durch den Nutzer/)
  assert.match(agents, /\.opencode\/validation\/schema-validators\/user-action-handoff\.schema\.json/)
  assert.match(hermes, /Erforderliche Aktion durch den Nutzer/)
  assert.equal(schema.properties.language.const, "de")
  assert.deepEqual(validateUserActionHandoff(machineReport.user_action_handoff), [])
  assert.equal(report.trimEnd().endsWith(`${HEADING}\n\n${EMPTY}`), true, report)
})

test("bootstrap run report includes structured machine-readable handoff", async () => {
  const source = await read("scripts/bootstrap-project.mjs")
  assert.match(source, /user_action_handoff/)
  const renderer = await read("scripts/lib/report.mjs")
  assert.match(renderer, /renderUserActionHandoff/)
})

test("governance installer persists the canonical handoff schema, runtime, and install report", async () => {
  const target = await copyFixture("generic-no-dsgvo")
  const result = runNodeScript("scripts/install-governance.mjs", ["--target", target, "--apply", "--json"])
  assert.notEqual(result.status, 2, result.stderr)
  const report = await readJson(path.join(target, ".agent-governance", "reports", "install-report.json"))
  assert.deepEqual(validateUserActionHandoff(report.user_action_handoff), [])
  assert.equal(await fs.stat(path.join(target, ".agent-governance", "runtime", "user-action-handoff.mjs")).then((entry) => entry.isFile()), true)
  assert.equal(await fs.stat(path.join(target, ".agent-governance", "runtime", "governance", "user-action-handoff.schema.json")).then((entry) => entry.isFile()), true)
})

test("repository overlay helper writes a machine and Markdown completion handoff", async () => {
  const target = await copyFixture("generic-no-dsgvo")
  const result = runNodeScript("scripts/apply-repository-overlay.mjs", ["--target", target, "--apply"])
  assert.notEqual(result.status, 2, result.stderr)
  const report = await readJson(path.join(target, ".opencode", "reports", "bootstrap", "report.json"))
  const markdown = await fs.readFile(path.join(target, "docs", "reports", "universal-bootstrap-run-report.md"), "utf8")
  assert.deepEqual(validateUserActionHandoff(report.user_action_handoff), [])
  assert.equal(markdown.trimEnd().endsWith(`${HEADING}\n\n${EMPTY}`), true, markdown)
})

test("ecosystem validator enforces cross-surface drift", async () => {
  const source = await read("scripts/validate-ecosystem.mjs")
  assert.match(source, /validateUserActionHandoffContract/)
  assert.match(source, /user-action-handoff\.schema\.json/)
})

test("closure evidence runtime validates the structured handoff", async () => {
  const source = await read("scripts/lib/closure-evidence.mjs")
  assert.match(source, /user_action_handoff/)
  assert.match(source, /validateUserActionHandoff/)
  const finalStatus = createClosureEvidence({
    evidence_type: "final-status",
    findings: [],
  })
  assert.deepEqual(validateUserActionHandoff(finalStatus.user_action_handoff), [])
  assert.deepEqual(validateClosureEvidence(finalStatus), [])
  const withoutHandoff = { ...finalStatus }
  delete withoutHandoff.user_action_handoff
  assert.ok(validateClosureEvidence(withoutHandoff).some((finding) => /requires user_action_handoff/.test(finding)))
})

test("closure and registry surfaces reject malformed supplied handoffs", () => {
  assert.throws(() => createClosureEvidence({
    evidence_type: "final-status",
    findings: [],
    user_action_handoff: { actions: "malformed-actions" },
  }), /Invalid user_action_handoff/)
  const valid = createClosureEvidence({ evidence_type: "final-status", findings: [] }).user_action_handoff
  assert.throws(() => createClosureEvidence({
    evidence_type: "final-status",
    findings: [],
    user_action_handoff: { ...valid, unexpected: true },
  }), /UNKNOWN_FIELD/)

  const registry = createRegistry()
  registry.projects.push({
    project_id: "fixture-project",
    project: { name: "Fixture" },
    classification: { main: "NEEDS_REVIEW", substatus: [] },
    user_action_handoff: { actions: "malformed-actions" },
    updated_at: new Date().toISOString(),
  })
  assert.ok(validateRegistry(registry).some((finding) => /ACTIONS_INVALID/.test(finding)))
})
