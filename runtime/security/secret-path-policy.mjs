import fs from "node:fs/promises"
import path from "node:path"

export const SAFE_READ_ALLOWLIST = Object.freeze([
  "README",
  "README.md",
  "AGENTS.md",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "pyproject.toml",
  "requirements.txt",
  "Cargo.toml",
  "go.mod",
  "opencode.json",
  "opencode.jsonc",
  ".gitignore",
])

export const SAFE_TEMPLATE_ALLOWLIST = Object.freeze([
  ".env.example",
  ".env.sample",
  ".env.template",
])

const SECRET_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".kubeconfig"])
const SECRET_NAMES = /^(?:credentials?|secrets?|tokens?)(?:\..+)?$/i
const DOT_SECRET_NAMES = new Set([".git-credentials", ".netrc", ".npmrc", ".pypirc"])

function normalizedPolicyPath(inputPath) {
  return String(inputPath ?? "").replaceAll("\\", "/").replace(/^\.\/+/, "")
}

export function classifySecretPath(inputPath) {
  const relativePath = normalizedPolicyPath(inputPath)
  const lower = relativePath.toLowerCase()
  const segments = lower.split("/").filter(Boolean)
  const basename = segments.at(-1) || ""

  if (SAFE_TEMPLATE_ALLOWLIST.includes(relativePath)) {
    return { decision: "SAFE_TEMPLATE_CANDIDATE", resourceClass: "TARGET_SAFE_TEMPLATE" }
  }
  if (basename === ".env" || basename.startsWith(".env.")) {
    return { decision: "ABSOLUTE_DENY", resourceClass: "TARGET_SECRET" }
  }
  if (SECRET_EXTENSIONS.has(path.posix.extname(basename)) || SECRET_NAMES.test(basename) || DOT_SECRET_NAMES.has(basename)) {
    return { decision: "ABSOLUTE_DENY", resourceClass: "TARGET_SECRET" }
  }
  if (
    lower === ".git" ||
    lower.startsWith(".git/") ||
    lower.includes("/.git/") ||
    lower === ".git/index"
  ) {
    return { decision: "ABSOLUTE_DENY", resourceClass: "TARGET_GIT_INTERNAL" }
  }
  if (
    lower === ".docker/config.json" ||
    lower.endsWith("/.docker/config.json") ||
    lower === ".aws/credentials" ||
    lower.endsWith("/.aws/credentials") ||
    lower.startsWith(".azure/") ||
    lower.includes("/.azure/") ||
    lower.startsWith(".config/gcloud/") ||
    lower.includes("/.config/gcloud/") ||
    lower === ".kube/config" ||
    lower.endsWith("/.kube/config") ||
    lower.startsWith(".ssh/id_") ||
    lower.includes("/.ssh/id_") ||
    lower === ".config/opencode/auth.json" ||
    lower.endsWith("/.config/opencode/auth.json")
  ) {
    return { decision: "ABSOLUTE_DENY", resourceClass: "TARGET_CREDENTIAL_STORE" }
  }
  if (lower.startsWith("/proc/") || lower.includes("/proc/") || lower.includes("/fd/") || lower.endsWith("/environ")) {
    return { decision: "ABSOLUTE_DENY", resourceClass: "PROCESS_ENVIRONMENT" }
  }
  return { decision: "NOT_SECRET_PATH", resourceClass: "TARGET_FILE" }
}

export function isSafeReadAllowed(relativePath) {
  const normalized = normalizedPolicyPath(relativePath)
  if (SAFE_READ_ALLOWLIST.includes(normalized)) return true
  if (SAFE_TEMPLATE_ALLOWLIST.includes(normalized)) return true
  return normalized.startsWith(".opencode/") && classifySecretPath(normalized).decision === "NOT_SECRET_PATH"
}

function rejected(resourceClass = "TARGET_PATH") {
  return {
    allowed: false,
    resourceClass,
    contentReturned: false,
    bytesReturned: 0,
  }
}

async function realpathForMissing(candidate) {
  const suffix = []
  let current = candidate
  while (true) {
    try {
      const resolved = await fs.realpath(current)
      return path.join(resolved, ...suffix.reverse())
    } catch (error) {
      if (error.code !== "ENOENT") throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      suffix.push(path.basename(current))
      current = parent
    }
  }
}

function withinRoot(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

export async function resolveTargetPath({ targetRoot, inputPath, allowMissing = false }) {
  if (typeof inputPath !== "string" || inputPath.length === 0 || inputPath.includes("\0")) {
    return rejected()
  }
  const portable = normalizedPolicyPath(inputPath)
  if (
    path.isAbsolute(inputPath) ||
    path.win32.isAbsolute(inputPath) ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(inputPath) ||
    portable.startsWith("/proc/") ||
    portable.includes("/../") ||
    portable === ".." ||
    portable.startsWith("../")
  ) {
    return rejected(portable.includes("proc/") ? "PROCESS_ENVIRONMENT" : "TARGET_PATH_ESCAPE")
  }

  const root = await fs.realpath(targetRoot)
  const relativePath = path.posix.normalize(portable)
  if (relativePath === ".." || relativePath.startsWith("../")) return rejected("TARGET_PATH_ESCAPE")
  const candidate = path.resolve(root, ...relativePath.split("/"))
  if (!withinRoot(root, candidate)) return rejected("TARGET_PATH_ESCAPE")

  let resolved
  let exists = true
  try {
    resolved = await fs.realpath(candidate)
  } catch (error) {
    if (error.code !== "ENOENT" || !allowMissing) return rejected("TARGET_PATH_UNAVAILABLE")
    exists = false
    try {
      resolved = await realpathForMissing(candidate)
    } catch {
      return rejected("TARGET_PATH_UNAVAILABLE")
    }
  }
  if (!withinRoot(root, resolved)) return rejected("TARGET_PATH_ESCAPE")

  const resolvedRelative = path.relative(root, resolved).split(path.sep).join("/")
  const requestedPolicy = classifySecretPath(relativePath)
  const resolvedPolicy = classifySecretPath(resolvedRelative)
  const policy = requestedPolicy.decision === "ABSOLUTE_DENY" ? requestedPolicy : resolvedPolicy
  if (policy.decision === "ABSOLUTE_DENY") return rejected(policy.resourceClass)

  return {
    allowed: true,
    absolutePath: candidate,
    resolvedPath: resolved,
    relativePath,
    resolvedRelativePath: resolvedRelative,
    exists,
    resourceClass: policy.resourceClass,
    contentReturned: false,
    bytesReturned: 0,
  }
}
