import path from "node:path"

export const BOOTSTRAP_PROTOCOL = "url-only-v1"
export const ECOSYSTEM = "OpenCode-Agenten-Oekosystem"
export const REPOSITORY = "https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem"
export const CLASSIFICATIONS = Object.freeze([
  "RED_BLOCK",
  "TOOL_GAP",
  "NEEDS_REVIEW",
  "VERIFIED_IN_SCOPE",
])
export const CONFLICT_CLASSES = Object.freeze([
  "SAFE_CREATE",
  "SAFE_GENERATED_UPDATE",
  "SAFE_MANAGED_UPDATE",
  "OWNER_CONTENT_PRESERVE",
  "MANUAL_REVIEW_REQUIRED",
  "FORBIDDEN",
])

const COMMIT_RE = /^[0-9a-f]{7,64}$/i
const GITHUB_RE = /^https:\/\/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i

export function normalizeBootstrapUrl(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new TypeError("GitHub repository URL is required")
  }
  const raw = input.trim()
  if (!raw.startsWith("https://github.com/")) {
    throw new TypeError("GitHub repository URL must use https://github.com/")
  }

  const parsed = new URL(raw)
  const pathParts = parsed.pathname.split("/").filter(Boolean)
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com" || pathParts.length < 2) {
    throw new TypeError("GitHub repository URL is invalid")
  }
  const owner = pathParts[0]
  const repo = pathParts[1].replace(/\.git$/, "")
  const repository = `https://github.com/${owner}/${repo}`
  if (pathParts.length === 2) return { repository, ref: null, ref_type: "default" }

  if (pathParts[2] === "commit") {
    const ref = pathParts.slice(3).join("/")
    if (!COMMIT_RE.test(ref)) throw new TypeError("GitHub commit URL must contain a commit ref")
    return { repository, ref, ref_type: "commit" }
  }

  if (pathParts[2] === "tree") {
    const ref = pathParts.slice(3).join("/")
    if (!ref || ref.startsWith(".") || ref.includes("..")) throw new TypeError("GitHub branch/tag URL must contain a safe ref")
    return { repository, ref, ref_type: "branch_or_tag" }
  }

  throw new TypeError("GitHub URL must be a repository, /tree/<ref>, or /commit/<sha> URL")
}

export function canonicalRepositoryUrl(input) {
  return normalizeBootstrapUrl(input).repository
}

export function classifyBootstrapConflict({ exists = false, managed = false, currentHashMatchesPrevious = false, forbidden = false } = {}) {
  if (forbidden) return "FORBIDDEN"
  if (!exists) return "SAFE_CREATE"
  if (!managed) return "OWNER_CONTENT_PRESERVE"
  return currentHashMatchesPrevious ? "SAFE_MANAGED_UPDATE" : "MANUAL_REVIEW_REQUIRED"
}

export function validateBootstrapManifest(manifest) {
  const issues = []
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return ["manifest must be an object"]
  const required = [
    "schema_version", "ecosystem", "repository", "bootstrap_protocol", "entrypoint", "installer",
    "verifier", "rollback", "supported_platforms", "required_tools", "minimum_versions",
    "supported_project_types", "default_mode", "available_modes", "managed_paths", "protected_paths",
    "generated_paths", "dry_run_required", "idempotence_required", "v2_gate_required", "approval_model",
    "completion_classification",
  ]
  for (const key of required) if (!(key in manifest)) issues.push(`missing manifest field: ${key}`)
  if (manifest.schema_version !== "1") issues.push("schema_version must be 1")
  if (manifest.ecosystem !== ECOSYSTEM) issues.push(`ecosystem must be ${ECOSYSTEM}`)
  if (manifest.repository !== REPOSITORY) issues.push(`repository must be ${REPOSITORY}`)
  if (manifest.bootstrap_protocol !== BOOTSTRAP_PROTOCOL) issues.push(`bootstrap_protocol must be ${BOOTSTRAP_PROTOCOL}`)
  for (const key of ["supported_platforms", "required_tools", "supported_project_types", "available_modes", "managed_paths", "protected_paths", "generated_paths"]) {
    if (key in manifest && !Array.isArray(manifest[key])) issues.push(`${key} must be an array`)
  }
  if (manifest.default_mode !== "INSTALL_NEW") issues.push("default_mode must be INSTALL_NEW")
  const modes = new Set(manifest.available_modes || [])
  for (const mode of ["INSTALL_NEW", "UPDATE_EXISTING", "VERIFY_ONLY", "ROLLBACK"]) if (!modes.has(mode)) issues.push(`available_modes must include ${mode}`)
  if (manifest.dry_run_required !== true || manifest.idempotence_required !== true || manifest.v2_gate_required !== true) issues.push("dry_run_required, idempotence_required, and v2_gate_required must be true")
  if (manifest.approval_model !== "effect-based") issues.push("approval_model must be effect-based")
  if (manifest.completion_classification !== "VERIFIED_IN_SCOPE") issues.push("completion_classification must be VERIFIED_IN_SCOPE")
  for (const key of ["entrypoint", "installer", "verifier"]) {
    if (typeof manifest[key] !== "string" || manifest[key].startsWith("/") || manifest[key].includes("..")) issues.push(`${key} must be a relative repository path`)
  }
  if (typeof manifest.rollback !== "string" || !manifest.rollback.includes("scripts/install-governance.mjs")) issues.push("rollback must point to scripts/install-governance.mjs")
  return issues
}

export function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

export function containsPrivateAbsolutePath(value) {
  return /(?:^|[\s"'`])\/(?:media\/|home\/|tmp\/opencode-|tmp\/opencode-governance)/i.test(String(value))
}
