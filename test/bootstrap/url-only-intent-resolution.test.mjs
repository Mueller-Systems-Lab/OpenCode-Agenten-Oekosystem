import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { repoRoot } from "../helpers.mjs"
import {
  HANDOFF_INTENTS,
  SOURCE_MUTATION_OPERATIONS,
  assertSourceTargetSeparation,
  assertSourceMutationAllowed,
  assertTargetMutationAllowed,
  buildOcaeCliInstallPlan,
  captureCallerWorkspace,
  classifyHandoffIntent,
  classifyToolAvailability,
  resolveStableRelease,
  resolveTargetRoot,
  validateHandoffContract,
} from "../../bootstrap/lib/handoff.mjs"

const canonicalUrl = "https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem"

async function makeHandoffFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-handoff-contract-"))
  const caller = path.join(root, "caller")
  const source = path.join(root, "temp-source", "OpenCode-Agenten-Oekosystem")
  await fs.mkdir(path.join(caller, ".git"), { recursive: true })
  await fs.writeFile(path.join(caller, "README.md"), "foreign caller project\n", "utf8")
  await fs.mkdir(source, { recursive: true })
  await fs.writeFile(path.join(source, "README.md"), "OCAE source\n", "utf8")
  return { root, caller, source }
}

test("machine-readable handoff contract has fail-closed constants", async () => {
  const contract = JSON.parse(await fs.readFile(path.join(repoRoot, "ocae.handoff.json"), "utf8"))
  assert.deepEqual(validateHandoffContract(contract), [])
  assert.equal(contract.bare_url_default_intent, "INSTALL_IN_CALLER_WORKSPACE")
  assert.equal(contract.target_immutable, true)
  assert.equal(contract.source_target_identity_forbidden, true)
  assert.equal(contract.development_requires_explicit_intent, true)
})

test("bare canonical URL resolves to installation in the caller workspace", () => {
  const result = classifyHandoffIntent(canonicalUrl, { callerWorkspaceAvailable: true })
  assert.equal(result.intent, HANDOFF_INTENTS.INSTALL_IN_CALLER_WORKSPACE)
  assert.equal(result.development_intent, false)
})

test("installation language remains installation intent", () => {
  for (const input of [
    `${canonicalUrl} installiere das in diesem Projekt`,
    `${canonicalUrl} nutze das in diesem Projekt`,
  ]) {
    assert.equal(classifyHandoffIntent(input).intent, HANDOFF_INTENTS.INSTALL_IN_CALLER_WORKSPACE)
  }
})

test("explicit OCAE development language is the only development override", () => {
  for (const input of [
    `entwickle das Projekt weiter: ${canonicalUrl}`,
    `Bearbeite dieses Repository und fixe OCAE: ${canonicalUrl}`,
    `öffne das OCAE Repository als Entwicklungsprojekt: ${canonicalUrl}`,
  ]) {
    const result = classifyHandoffIntent(input)
    assert.equal(result.intent, HANDOFF_INTENTS.DEVELOP_OCAE)
    assert.equal(result.development_intent, true)
  }
})

test("missing caller context is a safe review classification", () => {
  const result = classifyHandoffIntent(canonicalUrl, { callerWorkspaceAvailable: false })
  assert.equal(result.intent, HANDOFF_INTENTS.NEEDS_REVIEW_AMBIGUOUS_NON_ROOT_CONTEXT)
  assert.equal(result.mutating_install_allowed, false)
})

test("caller target is frozen before source access and survives CWD drift", async (t) => {
  const fixture = await makeHandoffFixture()
  const originalCwd = process.cwd()
  t.after(async () => {
    process.chdir(originalCwd)
    await fs.rm(fixture.root, { recursive: true, force: true })
  })

  const handoff = captureCallerWorkspace({ cwd: fixture.caller })
  assert.equal(handoff.target_root, fixture.caller)
  assert.equal(handoff.target_root_before, fixture.caller)

  process.chdir(fixture.source)
  assert.equal(resolveTargetRoot(handoff), fixture.caller)
  assert.equal(handoff.target_root, handoff.target_root_before)
  assert.equal(resolveTargetRoot(handoff) === process.cwd(), false)
})

test("source and target collision is blocked for installation", async (t) => {
  const fixture = await makeHandoffFixture()
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))
  assert.throws(
    () => assertSourceTargetSeparation({
      intent: HANDOFF_INTENTS.INSTALL_IN_CALLER_WORKSPACE,
      targetRoot: fixture.caller,
      sourceRoot: fixture.caller,
    }),
    (error) => error.code === "RED_BLOCK_SOURCE_TARGET_IDENTITY_COLLISION",
  )
})

test("source mutations are forbidden for installation intent", () => {
  for (const operation of SOURCE_MUTATION_OPERATIONS) {
    assert.throws(
      () => assertSourceMutationAllowed({ intent: HANDOFF_INTENTS.INSTALL_IN_CALLER_WORKSPACE, operation }),
      (error) => error.code === "RED_BLOCK_SOURCE_MUTATION_FOR_INSTALL_INTENT",
    )
  }
  assert.doesNotThrow(() => assertSourceMutationAllowed({ intent: HANDOFF_INTENTS.DEVELOP_OCAE, operation: "git commit" }))
  assert.throws(
    () => assertSourceMutationAllowed({ intent: HANDOFF_INTENTS.NEEDS_REVIEW_AMBIGUOUS_NON_ROOT_CONTEXT, operation: "source file writes" }),
    (error) => error.code === "RED_BLOCK_SOURCE_MUTATION_WITHOUT_EXPLICIT_DEVELOPMENT",
  )
  assert.doesNotThrow(() => assertSourceMutationAllowed({ intent: HANDOFF_INTENTS.INSTALL_IN_CALLER_WORKSPACE, operation: "read" }))
  assert.throws(
    () => assertSourceMutationAllowed({ intent: HANDOFF_INTENTS.INSTALL_IN_CALLER_WORKSPACE, operation: "unknown source write" }),
    (error) => error.code === "RED_BLOCK_UNKNOWN_SOURCE_OPERATION",
  )
})

test("stable release resolution excludes drafts and prereleases and pins the commit", () => {
  const release = resolveStableRelease([
    { tagName: "v9.0.0-rc.1", isDraft: false, isPrerelease: true, publishedAt: "2026-08-12T00:00:00Z", targetCommitish: "bad" },
    { tagName: "v1.0.0", isDraft: false, isPrerelease: false, publishedAt: "2026-01-01T00:00:00Z", targetCommitish: "4f97bdd000000000000000000000000000000000" },
    { tagName: "v0.9.0", isDraft: false, isPrerelease: false, publishedAt: "2025-01-01T00:00:00Z", targetCommitish: "0f9bc8700000000000000000000000000000000" },
  ])
  assert.deepEqual(release, {
    tag: "v1.0.0",
    commit: "4f97bdd000000000000000000000000000000000",
  })
})

test("stable release resolution rejects prerelease-shaped tags even with bad metadata", () => {
  assert.deepEqual(resolveStableRelease([
    { tagName: "v9.0.0-rc.1", isDraft: false, isPrerelease: false, publishedAt: "2026-08-12T00:00:00Z", commit: "9f97bdd000000000000000000000000000000000" },
    { tagName: "v1.0.0", isDraft: false, isPrerelease: false, publishedAt: "2026-01-01T00:00:00Z", commit: "4f97bdd000000000000000000000000000000000" },
  ]), {
    tag: "v1.0.0",
    commit: "4f97bdd000000000000000000000000000000000",
  })
})

test("stable release resolution understands GitHub release field names", () => {
  assert.deepEqual(resolveStableRelease([
    { tag_name: "v9.0.0", draft: false, prerelease: true, published_at: "2026-08-12T00:00:00Z", tag_commit: "9f97bdd000000000000000000000000000000000" },
    { tag_name: "v1.0.0", draft: false, prerelease: false, published_at: "2026-01-01T00:00:00Z", tag_commit: "4f97bdd000000000000000000000000000000000" },
  ]), {
    tag: "v1.0.0",
    commit: "4f97bdd000000000000000000000000000000000",
  })
})

test("CLI plan uses an exact release and explicit absolute target for every command", () => {
  const targetRoot = path.resolve("caller-project")
  const plan = buildOcaeCliInstallPlan({
    stableRelease: { tag: "v1.0.0", commit: "4f97bdd000000000000000000000000000000000" },
    targetRoot,
  })
  assert.deepEqual(plan.uv_command, [
    "uv", "tool", "install", "ocae-cli",
    "--from", `${canonicalUrl}.git@v1.0.0`,
  ])
  assert.deepEqual(plan.ocae_commands, [
    ["ocae", "doctor", targetRoot],
    ["ocae", "install", targetRoot],
    ["ocae", "verify", targetRoot],
  ])
  assert.ok(plan.ocae_commands.every((command) => command[2] !== "."))
})

test("missing uv is a precise tool gap and does not change the target", () => {
  assert.deepEqual(classifyToolAvailability({ uvPath: null, ocaePath: null }), {
    classification: "TOOL_GAP_UV",
    target_unchanged: true,
  })
  assert.deepEqual(classifyToolAvailability({ uvPath: "uv", ocaePath: null }), {
    classification: "CLI_INSTALL_REQUIRED",
    target_unchanged: true,
  })
})

test("target mutation guard blocks escapes and source writes", async (t) => {
  const fixture = await makeHandoffFixture()
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }))
  assert.doesNotThrow(() => assertTargetMutationAllowed({
    intent: HANDOFF_INTENTS.INSTALL_IN_CALLER_WORKSPACE,
    targetRoot: fixture.caller,
    mutationPath: path.join(fixture.caller, ".opencode", "agents", "new.md"),
    sourceRoot: fixture.source,
  }))
  assert.throws(
    () => assertTargetMutationAllowed({
      intent: HANDOFF_INTENTS.INSTALL_IN_CALLER_WORKSPACE,
      targetRoot: fixture.caller,
      mutationPath: path.join(fixture.root, "outside", "new.md"),
      sourceRoot: fixture.source,
    }),
    (error) => error.code === "RED_BLOCK_TARGET_ESCAPE",
  )
  assert.throws(
    () => assertTargetMutationAllowed({
      intent: HANDOFF_INTENTS.INSTALL_IN_CALLER_WORKSPACE,
      targetRoot: fixture.caller,
      mutationPath: path.join(fixture.source, "README.md"),
      sourceRoot: fixture.source,
    }),
    (error) => error.code === "RED_BLOCK_SOURCE_MUTATION_FOR_INSTALL_INTENT",
  )
})

test("active AI handoff documentation states the immutable boundary contract", async () => {
  const [readme, bootstrap, install] = await Promise.all([
    fs.readFile(path.join(repoRoot, "README.md"), "utf8"),
    fs.readFile(path.join(repoRoot, "AI-BOOTSTRAP.md"), "utf8"),
    fs.readFile(path.join(repoRoot, "AI-INSTALL.md"), "utf8"),
  ])
  for (const marker of [
    "DEFAULT_INTENT = INSTALL_IN_CALLER_WORKSPACE",
    "TARGET_CAPTURE_BEFORE_CLONE",
    "TARGET_IMMUTABLE",
    "SOURCE_IS_NOT_TARGET",
    "SOURCE_MUTATION_FORBIDDEN",
    "DEVELOPMENT_REQUIRES_EXPLICIT_INTENT",
  ]) {
    assert.ok(`${readme}\n${bootstrap}\n${install}`.includes(marker), `missing marker: ${marker}`)
  }
  assert.match(readme, /ocae\.handoff\.json/)
  assert.match(bootstrap, /ocae\.handoff\.json/)
})
