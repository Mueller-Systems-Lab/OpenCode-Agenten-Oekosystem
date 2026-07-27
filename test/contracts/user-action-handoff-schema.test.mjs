import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { repoRoot } from "../helpers.mjs"

const schemaPath = path.join(repoRoot, "governance", "user-action-handoff.schema.json")

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"))
  } catch {
    return null
  }
}

test("canonical JSON Schema exists and pins the German contract", async () => {
  const schema = await readJsonOrNull(schemaPath)
  assert.ok(schema, `missing or invalid ${schemaPath}`)
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema")
  assert.equal(schema.properties.language.const, "de")
  assert.equal(schema.properties.section_title.const, "Erforderliche Aktion durch den Nutzer")
})

test("schema controls every permitted reason code", async () => {
  const schema = await readJsonOrNull(schemaPath)
  assert.ok(schema, `missing or invalid ${schemaPath}`)
  assert.deepEqual(schema.$defs.action.properties.reason_code.enum, [
    "PHYSICAL_ACTION_REQUIRED",
    "RESOURCE_UNREACHABLE",
    "MISSING_PERMISSION",
    "MISSING_AUTHORIZATION",
    "NON_DELEGABLE_OWNER_APPROVAL",
    "PERSONAL_LEGAL_DECISION",
    "MANUAL_SECURITY_CONFIRMATION",
  ])
})

test("schema requires capability evidence and rejects free-form-only actions", async () => {
  const schema = await readJsonOrNull(schemaPath)
  assert.ok(schema, `missing or invalid ${schemaPath}`)
  assert.ok(schema.$defs.action.required.includes("reason_code"))
  assert.ok(schema.$defs.action.required.includes("reason_evidence"))
  assert.equal(schema.$defs.action.additionalProperties, false)
  assert.equal(schema.$defs.reason_evidence.properties.capability_checked.const, true)
  const githubRule = schema.$defs.action.allOf.find((entry) => entry.if?.properties?.platform?.const === "github_web")
  assert.deepEqual(githubRule.then.properties.target.anyOf, [
    { required: ["pull_request"] },
    { required: ["issue"] },
    { required: ["branch"] },
  ])
  assert.deepEqual(githubRule.else.not.required, ["web_ui"])
  assert.equal(schema.$defs.web_ui.properties.steps.contains.properties.confirmation.const, true)
  assert.equal(schema.$defs.web_ui.properties.steps.contains.properties.control_type.const, "button")
})

test("Governance V2 policy and generated IR reference the canonical schema", async () => {
  const policy = await readJsonOrNull(path.join(repoRoot, "governance", "policy-core.yaml"))
  const generated = await readJsonOrNull(path.join(repoRoot, "governance", "generated", "policy-core.json"))
  assert.equal(policy.user_action_handoff.schema, "governance/user-action-handoff.schema.json")
  assert.equal(policy.user_action_handoff.actions_field, "actions")
  assert.deepEqual(generated.user_action_handoff, policy.user_action_handoff)
})

test("machine final-status schema requires user_action_handoff", async () => {
  const schema = await readJsonOrNull(path.join(repoRoot, "governance", "closure-evidence.schema.json"))
  const finalStatusRule = schema.allOf.find((entry) => entry.if?.properties?.evidence_type?.const === "final-status")
  assert.ok(finalStatusRule.then.required.includes("user_action_handoff"))
  assert.equal(schema.properties.user_action_handoff.$ref, "user-action-handoff.schema.json")
})
