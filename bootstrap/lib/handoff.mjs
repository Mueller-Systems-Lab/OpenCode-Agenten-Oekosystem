import fsSync from "node:fs"
import path from "node:path"
import { REPOSITORY } from "./contract.mjs"

export const HANDOFF_INTENTS = Object.freeze({
  INSTALL_IN_CALLER_WORKSPACE: "INSTALL_IN_CALLER_WORKSPACE",
  DEVELOP_OCAE: "DEVELOP_OCAE",
  NEEDS_REVIEW_AMBIGUOUS_NON_ROOT_CONTEXT: "NEEDS_REVIEW_AMBIGUOUS_NON_ROOT_CONTEXT",
  NEEDS_REVIEW_UNRELATED_INPUT: "NEEDS_REVIEW_UNRELATED_INPUT",
})

export const SOURCE_MUTATION_OPERATIONS = Object.freeze([
  "source file writes",
  "git commit",
  "git push",
  "issue creation",
  "PR creation",
  "formatting",
  "dependency update",
])

const SOURCE_READ_OPERATIONS = Object.freeze([
  "read",
  "verify",
  "resolve release",
  "installation source",
])

const FULL_COMMIT_RE = /^[0-9a-f]{40}$/i
const STABLE_TAG_RE = /^v\d+\.\d+\.\d+$/
const DEV_CONTEXT_RE = /(?:(?:\b(?:entwickle|weiterentwickle|entwickeln|ändere|aendere|bearbeite|fixe|fix|arbeite\s+an|implementiere)\b|öffne|oeffne)[\s\S]{0,120}\b(?:OCAE|OpenCode-Agenten-Oekosystem|Repository|Installer|Entwicklungsprojekt)\b|\b(?:OCAE|OpenCode-Agenten-Oekosystem|Repository|Installer)\b[\s\S]{0,120}(?:\b(?:entwickle|weiterentwickle|entwickeln|ändere|aendere|bearbeite|fixe|fix|arbeite\s+an|implementiere)\b|öffne|oeffne))/iu

export class HandoffBoundaryError extends Error {
  constructor(code, message) {
    super(message)
    this.name = "HandoffBoundaryError"
    this.code = code
  }
}

export function classifyHandoffIntent(input, { callerWorkspaceAvailable = true } = {}) {
  const text = typeof input === "string" ? input.trim() : ""
  if (!text.includes(REPOSITORY)) {
    return {
      intent: HANDOFF_INTENTS.NEEDS_REVIEW_UNRELATED_INPUT,
      development_intent: false,
      explicit_development_intent: false,
      mutating_install_allowed: false,
      reason: "The canonical OCAE repository URL was not present.",
    }
  }

  if (DEV_CONTEXT_RE.test(text)) {
    return {
      intent: HANDOFF_INTENTS.DEVELOP_OCAE,
      development_intent: true,
      explicit_development_intent: true,
      mutating_install_allowed: false,
      reason: "An explicit OCAE development instruction was present.",
    }
  }

  if (!callerWorkspaceAvailable) {
    return {
      intent: HANDOFF_INTENTS.NEEDS_REVIEW_AMBIGUOUS_NON_ROOT_CONTEXT,
      development_intent: false,
      explicit_development_intent: false,
      mutating_install_allowed: false,
      reason: "No caller workspace was available at handoff time.",
    }
  }

  return {
    intent: HANDOFF_INTENTS.INSTALL_IN_CALLER_WORKSPACE,
    development_intent: false,
    explicit_development_intent: false,
    mutating_install_allowed: true,
    reason: "A bare canonical URL defaults to installation in the frozen caller workspace.",
  }
}

export function captureCallerWorkspace({ cwd } = {}) {
  if (typeof cwd !== "string" || cwd.trim() === "") {
    throw new HandoffBoundaryError(
      "RED_BLOCK_CALLER_WORKSPACE_MISSING",
      "The caller workspace must be supplied explicitly during handoff capture.",
    )
  }
  const initialWorkspace = path.resolve(cwd)
  const initialStat = fsSync.lstatSync(initialWorkspace)
  if (initialStat.isSymbolicLink()) {
    throw new HandoffBoundaryError("RED_BLOCK_TARGET_SYMLINK", "The caller workspace must not be a symlink.")
  }
  const canonicalWorkspace = fsSync.realpathSync(initialWorkspace)
  const targetRoot = findGitRoot(canonicalWorkspace)
  const targetStat = fsSync.lstatSync(targetRoot)
  if (targetStat.isSymbolicLink()) {
    throw new HandoffBoundaryError("RED_BLOCK_TARGET_SYMLINK", "The target root must not be a symlink.")
  }

  return Object.freeze({
    initial_workspace: canonicalWorkspace,
    target_root: targetRoot,
    target_root_before: targetRoot,
    target_immutable: true,
    captured_before_source_access: true,
  })
}

export function resolveTargetRoot(handoff) {
  if (!handoff || handoff.target_immutable !== true || handoff.target_root !== handoff.target_root_before) {
    throw new HandoffBoundaryError("RED_BLOCK_TARGET_ROOT_CHANGED", "The captured target root is not immutable.")
  }
  return handoff.target_root
}

export function assertSourceTargetSeparation({ intent, targetRoot, sourceRoot }) {
  if (intent !== HANDOFF_INTENTS.INSTALL_IN_CALLER_WORKSPACE) return { separated: true }
  const target = canonicalExistingPath(targetRoot, "target root")
  const source = canonicalExistingPath(sourceRoot, "source root")
  if (target === source) {
    throw new HandoffBoundaryError(
      "RED_BLOCK_SOURCE_TARGET_IDENTITY_COLLISION",
      "Installation source and caller target resolve to the same path.",
    )
  }
  if (isPathInside(target, source) || isPathInside(source, target)) {
    throw new HandoffBoundaryError(
      "RED_BLOCK_SOURCE_TARGET_PATH_OVERLAP",
      "Installation source and caller target overlap; source and target must be disjoint.",
    )
  }
  return { separated: true, target_root: target, source_root: source }
}

export function assertSourceMutationAllowed({ intent, operation }) {
  if (intent === HANDOFF_INTENTS.DEVELOP_OCAE) return { allowed: true, operation }
  if (SOURCE_MUTATION_OPERATIONS.includes(operation)) {
    throw new HandoffBoundaryError(
      intent === HANDOFF_INTENTS.INSTALL_IN_CALLER_WORKSPACE
        ? "RED_BLOCK_SOURCE_MUTATION_FOR_INSTALL_INTENT"
        : "RED_BLOCK_SOURCE_MUTATION_WITHOUT_EXPLICIT_DEVELOPMENT",
      `Source mutation is forbidden for ${intent}: ${operation}`,
    )
  }
  if (!SOURCE_READ_OPERATIONS.includes(operation)) {
    throw new HandoffBoundaryError(
      "RED_BLOCK_UNKNOWN_SOURCE_OPERATION",
      `Unknown source operation is not allowed without explicit OCAE development intent: ${operation}`,
    )
  }
  return { allowed: true, operation }
}

export function assertTargetMutationAllowed({ intent, targetRoot, mutationPath, sourceRoot }) {
  if (intent !== HANDOFF_INTENTS.INSTALL_IN_CALLER_WORKSPACE) {
    throw new HandoffBoundaryError(
      "RED_BLOCK_TARGET_MUTATION_WITHOUT_INSTALL_INTENT",
      `Target mutation is not authorized for ${intent}.`,
    )
  }

  const target = canonicalExistingPath(targetRoot, "target root")
  const candidate = canonicalBoundaryPath(mutationPath, "target mutation path")
  if (sourceRoot) {
    const source = canonicalExistingPath(sourceRoot, "source root")
    if (isPathInsideOrSame(source, candidate)) {
      throw new HandoffBoundaryError(
        "RED_BLOCK_SOURCE_MUTATION_FOR_INSTALL_INTENT",
        "An installation mutation resolves inside the read-only OCAE source.",
      )
    }
  }
  if (!isPathInsideOrSame(target, candidate)) {
    throw new HandoffBoundaryError(
      "RED_BLOCK_TARGET_ESCAPE",
      "An installation mutation resolves outside the frozen caller target.",
    )
  }
  return { allowed: true, target_root: target, mutation_path: candidate }
}

export function resolveStableRelease(releases) {
  const candidates = (Array.isArray(releases) ? releases : [])
    .filter((release) => !(release?.isDraft ?? release?.draft) && !(release?.isPrerelease ?? release?.prerelease))
    .map((release) => ({
      tag: release.tag ?? release.tagName ?? release.tag_name,
      commit: release.commit ?? release.tagCommit ?? release.tag_commit ?? release.targetCommitish,
      publishedAt: release.publishedAt ?? release.published_at ?? "",
    }))
    .filter((release) => STABLE_TAG_RE.test(release.tag || "") && FULL_COMMIT_RE.test(release.commit || ""))
    .sort((left, right) => String(right.publishedAt).localeCompare(String(left.publishedAt)))

  if (candidates.length === 0) {
    throw new HandoffBoundaryError(
      "TOOL_GAP_STABLE_RELEASE_METADATA",
      "No stable release with an exact tag commit was available.",
    )
  }
  return { tag: candidates[0].tag, commit: candidates[0].commit }
}

export function buildOcaeCliInstallPlan({ stableRelease, targetRoot }) {
  const target = path.resolve(targetRoot)
  if (!path.isAbsolute(targetRoot) || target !== targetRoot) {
    throw new HandoffBoundaryError("RED_BLOCK_TARGET_NOT_ABSOLUTE", "Installer commands require the captured absolute target root.")
  }
  if (!STABLE_TAG_RE.test(stableRelease?.tag || "") || !FULL_COMMIT_RE.test(stableRelease?.commit || "")) {
    throw new HandoffBoundaryError("RED_BLOCK_RELEASE_NOT_PINNED", "The CLI install plan requires an exact stable tag and commit.")
  }
  return {
    stable_release: { tag: stableRelease.tag, commit: stableRelease.commit },
    uv_command: ["uv", "tool", "install", "ocae-cli", "--from", `${REPOSITORY}.git@${stableRelease.tag}`],
    ocae_commands: [
      ["ocae", "doctor", targetRoot],
      ["ocae", "install", targetRoot],
      ["ocae", "verify", targetRoot],
    ],
  }
}

export function classifyToolAvailability({ uvPath, ocaePath }) {
  if (!uvPath) return { classification: "TOOL_GAP_UV", target_unchanged: true }
  if (!ocaePath) return { classification: "CLI_INSTALL_REQUIRED", target_unchanged: true }
  return { classification: "AVAILABLE", target_unchanged: true }
}

export function validateHandoffContract(contract) {
  const expected = {
    schema_version: "1.0.0",
    product: "OCAE",
    canonical_repository: REPOSITORY,
    bare_url_default_intent: HANDOFF_INTENTS.INSTALL_IN_CALLER_WORKSPACE,
    source_role: "READ_ONLY_DISTRIBUTION_SOURCE",
    target_resolution: "CALLER_WORKSPACE_AT_HANDOFF",
    target_immutable: true,
    source_target_identity_forbidden: true,
    preferred_distribution: "ocae-cli",
    development_requires_explicit_intent: true,
    source_mutations_for_install_intent: 0,
    target_commands_require_absolute_root: true,
  }
  const issues = []
  for (const [key, value] of Object.entries(expected)) {
    if (contract?.[key] !== value) issues.push(`${key} must equal ${JSON.stringify(value)}`)
  }
  return issues
}

function findGitRoot(start) {
  let current = start
  while (true) {
    const marker = path.join(current, ".git")
    if (fsSync.existsSync(marker)) {
      const stat = fsSync.lstatSync(marker)
      if (stat.isSymbolicLink()) {
        throw new HandoffBoundaryError("RED_BLOCK_TARGET_GIT_SYMLINK", "The target .git marker must not be a symlink.")
      }
      return current
    }
    const parent = path.dirname(current)
    if (parent === current) return start
    current = parent
  }
}

function canonicalExistingPath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new HandoffBoundaryError("RED_BLOCK_PATH_NOT_ABSOLUTE", `${label} must be absolute.`)
  }
  try {
    if (fsSync.lstatSync(value).isSymbolicLink()) {
      throw new HandoffBoundaryError("RED_BLOCK_PATH_SYMLINK", `${label} must not be a symbolic link.`)
    }
    return fsSync.realpathSync(value)
  } catch (error) {
    if (error instanceof HandoffBoundaryError) throw error
    throw new HandoffBoundaryError("RED_BLOCK_PATH_UNAVAILABLE", `${label} cannot be resolved: ${error.message}`)
  }
}

function canonicalBoundaryPath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new HandoffBoundaryError("RED_BLOCK_PATH_NOT_ABSOLUTE", `${label} must be absolute.`)
  }

  let unresolved = path.resolve(value)
  const suffix = []
  while (!pathEntryExists(unresolved)) {
    const parent = path.dirname(unresolved)
    if (parent === unresolved) {
      throw new HandoffBoundaryError("RED_BLOCK_PATH_UNAVAILABLE", `${label} has no existing ancestor.`)
    }
    suffix.unshift(path.basename(unresolved))
    unresolved = parent
  }
  try {
    if (fsSync.lstatSync(unresolved).isSymbolicLink()) {
      throw new HandoffBoundaryError("RED_BLOCK_PATH_SYMLINK", `${label} must not traverse a symbolic link.`)
    }
    return path.join(fsSync.realpathSync(unresolved), ...suffix)
  } catch (error) {
    if (error instanceof HandoffBoundaryError) throw error
    throw new HandoffBoundaryError("RED_BLOCK_PATH_UNAVAILABLE", `${label} cannot be resolved: ${error.message}`)
  }
}

function pathEntryExists(value) {
  try {
    fsSync.lstatSync(value)
    return true
  } catch {
    return false
  }
}

function isPathInsideOrSame(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
