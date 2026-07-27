import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import { lstatSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { ApprovalAuditLog } from "../../runtime/approval/approval-audit.mjs"
import {
  ApprovalReceiptStore,
  createApprovalReceipt,
  readSigningKeyFileSync,
  validateApprovalReceipt,
} from "../../runtime/approval/approval-receipt.mjs"
import { preservePrimaryClassification } from "../../scripts/lib/lifecycle.mjs"
import { createClosureEvidence, validateClosureEvidence } from "../../scripts/lib/closure-evidence.mjs"
import { exportPortableRegistry } from "../../scripts/lib/ecosystem-registry.mjs"
import {
  classifyRuntimeProof,
  createRuntimeProof,
  scanRuntimeBypassPaths,
} from "../../scripts/lib/runtime-activation-proof.mjs"

const root = path.resolve(new URL("../..", import.meta.url).pathname)
const signingKey = "security-closure-test-key"
const syntheticHomePath = ["/home", "user", "project"].join("/")

function receipt(overrides = {}) {
  return createApprovalReceipt({
    signing_key: signingKey,
    owner_intent_id: "intent",
    task_id: "task",
    project_id: "project",
    runtime: "opencode",
    run_id: "run",
    session_id: "session-123456",
    call_id: "call-123456",
    tool: "git",
    normalized_action: "push",
    capability: "git.push",
    effect: "PUSH",
    effect_classes: ["PUSH"],
    resource: "remote",
    scope: ["remote"],
    resource_scope: ["remote"],
    allowed_actions: ["push"],
    approval_authority: "OWNER_INTENT",
    expires_at: "2099-01-01T00:00:00.000Z",
    ...overrides,
  })
}

test("F-001 runtime receipt carries and verifies a required session_id and call_id", () => {
  const valid = receipt()
  assert.equal(valid.call_id, "call-123456")
  assert.equal(validateApprovalReceipt(valid, {
    signing_key: signingKey,
    requireRuntimeBinding: true,
    project_id: "project",
    runtime: "opencode",
    run_id: "run",
    session_id: "session-123456",
    call_id: "call-123456",
    tool: "git",
    normalized_action: "push",
    capability: "git.push",
    effect: "PUSH",
    resource: "remote",
  }).valid, true)
  for (const overrides of [{ session_id: null }, { session_id: "" }, { call_id: null }, { call_id: "" }]) {
    const invalid = receipt(overrides)
    assert.equal(validateApprovalReceipt(invalid, {
      signing_key: signingKey,
      requireRuntimeBinding: true,
      project_id: "project",
      runtime: "opencode",
      run_id: "run",
      session_id: "session-123456",
      call_id: "call-123456",
      tool: "git",
      normalized_action: "push",
      capability: "git.push",
      effect: "PUSH",
      resource: "remote",
    }).valid, false)
  }
  assert.equal(validateApprovalReceipt(valid, {
    signing_key: signingKey,
    requireRuntimeBinding: true,
    project_id: "project",
    runtime: "opencode",
    run_id: "run",
    session_id: "session-123456",
    call_id: "call-other",
    tool: "git",
    normalized_action: "push",
    capability: "git.push",
    effect: "PUSH",
    resource: "remote",
  }).valid, false)
})

test("F-002 receipt identifiers and revoke markers cannot escape or follow symlinks", async () => {
  assert.throws(() => receipt({ approval_id: "../outside-receipt" }), /receipt|approval|identifier|path/i)
  assert.throws(() => receipt({ approval_id: "/absolute/receipt-id-123456" }), /receipt|approval|identifier|path/i)
  assert.throws(() => receipt({ approval_id: `long-${"x".repeat(130)}` }), /receipt|approval|identifier|path/i)
  assert.throws(() => receipt({ approval_id: "safe-id-1234567890\u2024escape" }), /receipt|approval|identifier|path/i)
  const storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-closure-store-"))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-closure-outside-"))
  const store = new ApprovalReceiptStore(path.join(storeRoot, "approvals"))
  try {
    await fs.mkdir(path.join(storeRoot, "approvals"))
    await fs.symlink(path.join(outside, "marker"), path.join(storeRoot, "approvals", "safe-id-1234567890.revoked"))
    await assert.rejects(() => store.revoke("safe-id-1234567890"), /symlink|regular|RED_BLOCK/i)
  } finally {
    await fs.rm(storeRoot, { recursive: true, force: true })
    await fs.rm(outside, { recursive: true, force: true })
  }
})

test("F-002 concurrent revoke and consume cannot produce a usable post-revoke receipt", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-revoke-race-"))
  const store = new ApprovalReceiptStore(path.join(directory, "approvals"))
  const candidate = receipt({ approval_id: "safe-id-1234567890" })
  try {
    await store.save(candidate)
    const [revoked, consumed] = await Promise.all([
      store.revoke(candidate.approval_id),
      store.consume(candidate, { signing_key: signingKey, requireRuntimeBinding: true, project_id: "project", runtime: "opencode", run_id: "run", session_id: "session-123456", call_id: "call-123456", tool: "git", normalized_action: "push", capability: "git.push", effect: "PUSH", resource: "remote" }),
    ])
    assert.equal(revoked.revoked, true)
    assert.equal(store.isRevoked(candidate.approval_id), true)
    if (consumed.valid === true) {
      assert.equal(validateApprovalReceipt(candidate, { signing_key: signingKey, store }).valid, false)
    } else {
      assert.equal(consumed.valid, false)
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test("F-003 activation verification requires real hook, restart, binding, and single-use controls", () => {
  const proof = createRuntimeProof({
    project_id: "fixture",
    runtime: { name: "opencode", adapter: "opencode" },
    activation: {
      runtime_detected: true,
      adapter_selected: true,
      hook_registered: true,
      plugin_loaded: true,
      hook_observed: true,
      positive_control: "PASS",
      negative_control: "PASS",
      restart_performed: true,
      restart_plugin_loaded: true,
      restart_hook_observed: true,
      restart_positive_control: "PASS",
      restart_negative_control: "PASS",
      receipt_required_without_receipt: "BLOCK",
      valid_receipt: "ALLOW",
      replay: "BLOCK",
      session_binding: "PASS",
      call_binding: "PASS",
      resource_binding: "PASS",
      effect_binding: "PASS",
      parallel_single_use: "PASS",
      restart_replay_persistence: "PASS",
      safe_action_allowed: true,
      forbidden_action_blocked: true,
      scope_escape_blocked: true,
      secret_isolation_blocked: true,
      approval_required_action_blocked_without_receipt: true,
      approval_receipt_accepted: true,
      replay_blocked: true,
      restart_verified: true,
      bypass_scan_completed: true,
    },
    evidence: [{ kind: "isolated-runtime", result: "passed" }, { kind: "bypass-scan", dynamic: true, result: "passed", critical_open_paths: 0 }],
  })
  assert.equal(classifyRuntimeProof(proof).classification, "VERIFIED_IN_SCOPE")
  const impossible = structuredClone(proof)
  impossible.activation.call_binding = "FAIL"
  assert.notEqual(classifyRuntimeProof(impossible).classification, "VERIFIED_IN_SCOPE")
})

test("F-004 portable registry export is an explicit allowlist", () => {
  const exported = exportPortableRegistry({
    schema_version: "1.0.0",
    kind: "ocae-ecosystem-registry",
    updated_at: "2026-07-27T00:00:00.000Z",
    projects: [{
      project_id: "fixture",
      project: { name: "Fixture", repository_url: "https://example.invalid/repo.git", nested: { token: "TOKEN_SHOULD_NOT_EXPORT" } },
      governance: { version: "2", root: syntheticHomePath, nested: { secret: "SECRET_SHOULD_NOT_EXPORT" } },
      runtime: { detected: ["opencode"], path: "/tmp/local", capability_summary: ["LOCAL_READ"] },
      verification: { activation_status: "UNPROVEN", local_evidence_path: "/tmp/evidence" },
      classification: { main: "NEEDS_REVIEW", substatus: ["UNPROVEN"] },
      tool_gaps: ["HERMES_TOOL_GAP"],
      updated_at: "2026-07-27T00:00:00.000Z",
    }],
  })
  const text = JSON.stringify(exported)
  assert.equal(text.includes("TOKEN_SHOULD_NOT_EXPORT"), false)
  assert.equal(text.includes(syntheticHomePath), false)
  assert.equal(text.includes("/tmp/local"), false)
  assert.equal(Object.hasOwn(exported.projects[0], "governance"), false)
})

test("F-005 active documentation names the singular verified plugin path", async () => {
  const files = ["README.md", "BOOTSTRAP.md", "AI-BOOTSTRAP.md", "docs/guides/unified-lifecycle.md", "docs/guides/unified-lifecycle-troubleshooting.md"]
  const texts = await Promise.all(files.map((file) => fs.readFile(path.join(root, file), "utf8")))
  assert.ok(texts.some((text) => text.includes(".opencode/plugin/governance-v2.ts")))
  assert.equal(texts.some((text) => /\.opencode\/plugins\//.test(text)), false)
  let historicalFiles = []
  try {
    historicalFiles = execFileSync("rg", ["-l", "--glob", "*.md", "--glob", "*.json", "\\.opencode/plugins/", path.join(root, "docs")], { encoding: "utf8" }).trim().split("\n").filter(Boolean)
  } catch (error) {
    if (error.status !== 1) throw error
  }
  for (const file of historicalFiles) {
    const text = await fs.readFile(file, "utf8")
    assert.match(text.slice(0, 1400), /HISTORICAL|SUPERSEDED/, `${path.relative(root, file)} must mark old plugin paths as historical`)
  }
})

test("F-006 bypass scan distinguishes canonical presence from activation and legacy paths", async () => {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-bypass-closure-"))
  try {
    await fs.mkdir(path.join(target, ".opencode", "plugin"), { recursive: true })
    await fs.writeFile(path.join(target, ".opencode", "plugin", "governance-v2.ts"), "export default {}\n")
    const installed = await scanRuntimeBypassPaths(target)
    assert.equal(installed.canonical_plugin_state, "CANONICAL_PLUGIN_PRESENT")
    assert.equal(installed.classification, "INSTALLED_UNVERIFIED")
    const active = await scanRuntimeBypassPaths(target, { hook_observed: true })
    assert.equal(active.classification, "CANONICAL_PLUGIN_ACTIVE")
    await fs.rm(path.join(target, ".opencode", "plugin", "governance-v2.ts"))
    await fs.mkdir(path.join(target, ".opencode", "plugins"), { recursive: true })
    await fs.writeFile(path.join(target, ".opencode", "plugins", "governance-v2.mjs"), "export default {}\n")
    assert.equal((await scanRuntimeBypassPaths(target)).classification, "LEGACY_OR_MISCONFIGURED")
    await fs.writeFile(path.join(target, ".opencode", "plugin", "governance-v2.ts"), "export default {}\n")
    assert.equal((await scanRuntimeBypassPaths(target)).classification, "INSTALLED_UNVERIFIED")
    await fs.rm(path.join(target, ".opencode", "plugin", "governance-v2.ts"))
    await fs.rm(path.join(target, ".opencode", "plugins", "governance-v2.mjs"))
    await fs.symlink(path.join(target, "missing-plugin.ts"), path.join(target, ".opencode", "plugin", "governance-v2.ts"))
    assert.equal((await scanRuntimeBypassPaths(target)).canonical_plugin_state, "UNPROVEN")
    assert.equal((await scanRuntimeBypassPaths(target)).classification, "BYPASS_RISK")
    await fs.rm(path.join(target, ".opencode", "plugin", "governance-v2.ts"))
    await fs.mkdir(path.join(target, ".opencode", "plugin", "governance-v2.ts"))
    assert.equal((await scanRuntimeBypassPaths(target)).canonical_plugin_state, "UNPROVEN")
    assert.equal((await scanRuntimeBypassPaths(target, { pure: true })).classification, "BYPASS_RISK")
    assert.equal((await scanRuntimeBypassPaths(target, { alternative_config: true })).classification, "UNPROVEN")
    assert.equal((await scanRuntimeBypassPaths(target, { direct_evaluator: true })).classification, "UNPROVEN")
  } finally {
    await fs.rm(target, { recursive: true, force: true })
  }
})

test("F-007 audit and metric failures do not weaken the primary classification", () => {
  const source = execFileSync("rg", ["-n", "classification.*result.classification|primary.*classification|METRICS_WRITE_FAILED", path.join(root, "scripts")], { encoding: "utf8" })
  assert.match(source, /primary|METRICS_WRITE_FAILED|result\.classification/)
  for (const primary of ["RED_BLOCK", "NEEDS_REVIEW", "TOOL_GAP", "VERIFIED_IN_SCOPE"]) {
    const result = preservePrimaryClassification({ classification: primary, substatus: "ORIGINAL" }, { type: "METRICS_WRITE_FAILED", classification: "TOOL_GAP" })
    assert.equal(result.classification, primary)
    assert.equal(result.secondary_findings[0].classification, "TOOL_GAP")
  }
})

test("F-008 receipt keys require a current-user 0600 regular file and never follow symlinks", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-key-closure-"))
  const keyPath = path.join(directory, "receipt-key")
  const key = "0123456789abcdef0123456789abcdef"
  try {
    await fs.writeFile(keyPath, `${key}\n`, { mode: 0o644 })
    assert.equal(readSigningKeyFileSync(keyPath), null)
    await fs.chmod(keyPath, 0o600)
    assert.equal(readSigningKeyFileSync(keyPath), key)
    const symlink = path.join(directory, "receipt-key-link")
    await fs.symlink(keyPath, symlink)
    assert.equal(readSigningKeyFileSync(symlink), null)
    await fs.rm(keyPath)
    await fs.mkdir(keyPath)
    assert.equal(readSigningKeyFileSync(keyPath), null)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test("F-009 audit evidence excludes tool output and sensitive content", async () => {
  const auditPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "ocae-audit-closure-")), "audit.jsonl")
  const log = new ApprovalAuditLog(auditPath)
  await log.append({
    event: "ACTION_OUTCOME",
    decision: { allowed: true, tool: "git", action: "status", resource: syntheticHomePath },
    success: true,
    stdout: "TOKEN=DO_NOT_STORE",
    stderr: "-----BEGIN PRIVATE KEY-----",
    output: "source code and user@example.invalid",
  })
  const text = await fs.readFile(auditPath, "utf8")
  assert.equal(text.includes("DO_NOT_STORE"), false)
  assert.equal(text.includes("PRIVATE KEY"), false)
  assert.equal(text.includes("user@example.invalid"), false)
  assert.equal(text.includes("source code"), false)
})

test("F-010 and F-011 expose a versioned assertion and closure-evidence contract", async () => {
  assert.equal(lstatSync(path.join(root, "governance", "closure-evidence.schema.json")).isFile(), true)
  assert.equal(lstatSync(path.join(root, "scripts", "lib", "closure-evidence.mjs")).isFile(), true)
  const source = await fs.readFile(path.join(root, "scripts", "lib", "runtime-activation-proof.mjs"), "utf8")
  assert.match(source, /required_evidence/)
  assert.match(source, /observed_evidence/)
  assert.match(source, /PARTIALLY_PROVEN/)
  const overclaim = createClosureEvidence({
    evidence_type: "final-status",
    run_id: "run",
    repository_commit: "commit",
    runtime_name: "opencode",
    classification: "PROVEN",
    findings: [],
    assertions: [{
      assertion_id: "A-1",
      claim: "strong claim",
      required_evidence: ["receipt"],
      observed_evidence: ["weak receipt"],
      status: "PARTIALLY_PROVEN",
      limitations: ["call binding not observed"],
      code_contract_version: "1.1.0",
      schema_version: "ocae-closure-evidence.1",
    }],
  })
  assert.ok(validateClosureEvidence(overclaim).some((issue) => /PROVEN summary/.test(issue)))
  assert.ok(validateClosureEvidence({ ...overclaim, unexpected_secret: "must fail" }).some((issue) => /unknown field/.test(issue)))
})

test("F-012 local closure evidence is ignored while schemas remain visible", () => {
  const ignored = execFileSync("git", ["check-ignore", "--no-index", "evidence/critical-closure-999999T000000Z/proof.json"], { cwd: root, encoding: "utf8" })
  assert.match(ignored, /critical-closure/)
  assert.throws(() => execFileSync("git", ["check-ignore", "--no-index", "governance/closure-evidence.schema.json"], { cwd: root, encoding: "utf8" }))
})
