import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { skipIfHostCannotSymlink } from "../lib/symlink-capability.mjs"

import {
  classifySecretPath,
  isSafeReadAllowed,
  resolveTargetPath,
} from "../../runtime/security/secret-path-policy.mjs"
import {
  inspectTarget,
  readSafeTargetFile,
} from "../../runtime/security/secure-target-fs.mjs"
import {
  gateToolResult,
} from "../../runtime/security/tool-result-egress-gate.mjs"
import {
  createSecretDenial,
} from "../../runtime/security/bootstrap-denial.mjs"
import {
  createAuditEvent,
  summarizeAuditEvents,
} from "../../runtime/security/bootstrap-audit.mjs"

async function withTarget(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-secret-policy-"))
  try {
    await fn(root)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

test("secret path policy defaults to deny and permits only explicit templates", () => {
  const denied = [
    ".env",
    ".env.local",
    ".env.production",
    "nested/.env",
    "server.pem",
    "private.key",
    "identity.p12",
    "identity.pfx",
    "trust.jks",
    "app.keystore",
    "credentials",
    "credentials.json",
    "secrets.yaml",
    "token",
    "tokens.json",
    ".git-credentials",
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".aws/credentials",
    ".config/gcloud/application_default_credentials.json",
    ".docker/config.json",
    ".ssh/id_ed25519",
  ]
  for (const candidate of denied) {
    assert.equal(classifySecretPath(candidate).decision, "ABSOLUTE_DENY", candidate)
  }

  for (const candidate of [".env.example", ".env.sample", ".env.template"]) {
    assert.equal(classifySecretPath(candidate).decision, "SAFE_TEMPLATE_CANDIDATE", candidate)
    assert.equal(isSafeReadAllowed(candidate), true)
  }

  assert.equal(classifySecretPath("README.md").decision, "NOT_SECRET_PATH")
  assert.equal(classifySecretPath("nested/.env.example").decision, "ABSOLUTE_DENY")
  assert.equal(isSafeReadAllowed("nested/.env.example"), false)
  assert.equal(classifySecretPath(".env.example.local").decision, "ABSOLUTE_DENY")
})

test("target path normalization blocks traversal, absolute paths, URIs, and proc descriptors", async () => {
  await withTarget(async (targetRoot) => {
    const denied = [
      "../.env",
      "nested/../../.env",
      "/etc/passwd",
      "file:///etc/passwd",
      "vscode://file/etc/passwd",
      "/proc/self/environ",
      "/proc/self/fd/3",
    ]
    for (const inputPath of denied) {
      const result = await resolveTargetPath({ targetRoot, inputPath })
      assert.equal(result.allowed, false, inputPath)
      assert.equal(result.contentReturned, false, inputPath)
    }

    const safe = await resolveTargetPath({ targetRoot, inputPath: "README.md", allowMissing: true })
    assert.equal(safe.allowed, true)
    assert.equal(safe.relativePath, "README.md")
  })
})

test("safe target reads block secret files, symlinks, nested links, and hardlinks before content", async (t) => {
  if (await skipIfHostCannotSymlink(t, { type: "file" })) return
  await withTarget(async (targetRoot) => {
    const sentinel = `TEST_ONLY_${crypto.randomBytes(24).toString("hex")}`
    await fs.writeFile(path.join(targetRoot, ".env"), `TOKEN=${sentinel}\n`, { mode: 0o600 })
    await fs.writeFile(path.join(targetRoot, "README.md"), "# Safe project\n")
    await fs.writeFile(path.join(targetRoot, ".env.example"), "TOKEN=replace-me\n")
    await fs.symlink(".env", path.join(targetRoot, "secret-link"))
    await fs.symlink("secret-link", path.join(targetRoot, "nested-secret-link"))
    await fs.link(path.join(targetRoot, ".env"), path.join(targetRoot, ".env.sample"))

    for (const inputPath of [".env", "secret-link", "nested-secret-link", ".env.sample"]) {
      const result = await readSafeTargetFile({
        targetRoot,
        inputPath,
        knownSecrets: [sentinel],
      })
      assert.equal(result.status, "RED_BLOCK_SECRET_PATH", inputPath)
      assert.equal(result.content_returned, false, inputPath)
      assert.equal(result.bytes_returned, 0, inputPath)
      assert.equal(JSON.stringify(result).includes(sentinel), false, inputPath)
    }

    const readme = await readSafeTargetFile({ targetRoot, inputPath: "README.md" })
    assert.equal(readme.status, "VERIFIED_IN_SCOPE")
    assert.match(readme.content, /Safe project/)

    const template = await readSafeTargetFile({ targetRoot, inputPath: ".env.example" })
    assert.equal(template.status, "VERIFIED_IN_SCOPE")
    assert.match(template.content, /replace-me/)
  })
})

test("missing and metadata-only target reads are denied without secret classification", async () => {
  await withTarget(async (targetRoot) => {
    await fs.writeFile(path.join(targetRoot, "owner.txt"), "owner content\n")
    for (const inputPath of ["AI-BOOTSTRAP.md", "owner.txt"]) {
      const result = await readSafeTargetFile({ targetRoot, inputPath })
      assert.equal(result.status, "RED_BLOCK_TARGET_READ_NOT_ALLOWLISTED")
      assert.notEqual(result.resource_class, "TARGET_SECRET")
      assert.equal(result.bytes_returned, 0)
    }
  })
})

test("target inspection returns safe content only and metadata for all other files", async () => {
  await withTarget(async (targetRoot) => {
    const sentinel = `TEST_ONLY_${crypto.randomBytes(24).toString("hex")}`
    await fs.writeFile(path.join(targetRoot, ".env.local"), `PASSWORD=${sentinel}\n`)
    await fs.writeFile(path.join(targetRoot, "README.md"), "# Public\n")
    await fs.writeFile(path.join(targetRoot, "owner.bin"), Buffer.from([1, 2, 3]))

    const result = await inspectTarget({ targetRoot, knownSecrets: [sentinel] })
    assert.equal(result.status, "VERIFIED_IN_SCOPE")
    assert.equal(JSON.stringify(result).includes(sentinel), false)

    const secret = result.entries.find((entry) => entry.relative_path === ".env.local")
    assert.equal(secret.resource_class, "TARGET_SECRET")
    assert.equal("content" in secret, false)
    assert.deepEqual(result.required_denial_probe, {
      action: "bootstrap_inspect_target",
      requested_path: ".env.local",
      max_attempts: 1,
      purpose: "Prove technical secret isolation, then continue with bootstrap_dry_run.",
    })

    const owner = result.entries.find((entry) => entry.relative_path === "owner.bin")
    assert.equal(owner.resource_class, "TARGET_METADATA_ONLY")
    assert.equal("content" in owner, false)

    const readme = result.entries.find((entry) => entry.relative_path === "README.md")
    assert.equal(readme.resource_class, "TARGET_SAFE_METADATA")
    assert.equal(readme.content, "# Public\n")
  })
})

test("egress gate blocks known values, credential patterns, environment dumps, and oversized output", () => {
  const sentinel = `TEST_ONLY_${crypto.randomBytes(24).toString("hex")}`
  const cases = [
    { value: `value=${sentinel}`, channel: "file" },
    { value: "AWS_SECRET_ACCESS_KEY=not-a-real-test-value", channel: "stdout" },
    { value: "-----BEGIN PRIVATE KEY-----\nredacted-test\n", channel: "stderr" },
    { value: "OPENAI_API_KEY=sk-test-only-placeholder", channel: "mcp" },
    { value: `${"x".repeat(70_000)}`, channel: "installer" },
    { value: "PATH=/bin\nHOME=/virtual-home\nTOKEN=test-only", channel: "environment" },
  ]

  for (const candidate of cases) {
    const result = gateToolResult({ ...candidate, knownSecrets: [sentinel], maxBytes: 65_536 })
    assert.equal(result.status, "RED_BLOCK_SECRET_EGRESS", candidate.channel)
    assert.equal(result.content_disclosed, false, candidate.channel)
    assert.equal(result.bytes_returned, 0, candidate.channel)
    assert.equal(JSON.stringify(result).includes(sentinel), false, candidate.channel)
  }

  const safe = gateToolResult({
    value: { status: "VERIFIED_IN_SCOPE", files: ["README.md"] },
    channel: "verifier",
  })
  assert.equal(safe.status, "VERIFIED_IN_SCOPE")
  assert.deepEqual(safe.value.files, ["README.md"])

  const nestedSafeTemplate = gateToolResult({
    value: JSON.stringify({ content: "TOKEN=replace-me\n" }),
    channel: "provider_transcript",
  })
  assert.equal(nestedSafeTemplate.status, "VERIFIED_IN_SCOPE")
})

test("structured denial has no private path or content and gives safe recovery actions", () => {
  const denial = createSecretDenial({
    action: "filesystem.read",
    attemptedPath: "/private/owner/project/.env",
  })
  assert.deepEqual(denial, {
    status: "RED_BLOCK_SECRET_PATH",
    action: "filesystem.read",
    resource_class: "TARGET_SECRET",
    path_disclosed: false,
    content_returned: false,
    bytes_returned: 0,
    retry_same_action: false,
    safe_next_actions: ["bootstrap_inspect_target", "bootstrap_dry_run"],
  })
  assert.equal(JSON.stringify(denial).includes("/private/owner"), false)
})

test("actor audit produces split metrics without private paths or content", () => {
  const events = [
    createAuditEvent({
      actor: "HARNESS_SETUP",
      sessionId: "session",
      taskId: "setup",
      tool: "fixture",
      action: "filesystem.write",
      effect: "WRITE",
      resourceClass: "TEMPORARY_BOOTSTRAP_STATE",
      normalizedPath: "/private/tmp/target/.env",
      scopeResult: "OUT_OF_SCOPE",
      secretPolicyResult: "ABSOLUTE_DENY",
      executionResult: "SETUP_ONLY",
      bytesReturned: 0,
      contentDisclosed: false,
      v2Decision: "VERIFIED_IN_SCOPE",
    }),
    createAuditEvent({
      actor: "AI_AGENT",
      sessionId: "session",
      taskId: "bootstrap",
      tool: "bootstrap_inspect_target",
      action: "filesystem.read",
      effect: "READ",
      resourceClass: "TARGET_SECRET",
      normalizedPath: "/private/tmp/target/.env",
      scopeResult: "IN_SCOPE",
      secretPolicyResult: "ABSOLUTE_DENY",
      executionResult: "BLOCKED_BEFORE_OPEN",
      bytesReturned: 0,
      contentDisclosed: false,
      v2Decision: "RED_BLOCK_SECRET_PATH",
    }),
  ]

  assert.equal(events.some((event) => JSON.stringify(event).includes("/private/tmp")), false)
  const metrics = summarizeAuditEvents(events)
  assert.equal(metrics.HARNESS_SETUP_OUT_OF_SCOPE_WRITE_COUNT, 1)
  assert.equal(metrics.AGENT_OUT_OF_SCOPE_WRITE_COUNT, 0)
  assert.equal(metrics.SECRET_READ_ATTEMPT_COUNT, 1)
  assert.equal(metrics.SECRET_OPEN_ALLOWED_COUNT, 0)
  assert.equal(metrics.SECRET_BYTES_RETURNED, 0)
  assert.equal(metrics.SECRET_CONTENT_DISCLOSURE_COUNT, 0)
})
