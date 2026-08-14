// SPDX-License-Identifier: MIT
/**
 * Deterministic shell effect classifier used by the Governance V2 boundary.
 *
 * This is deliberately a small parser, not an LLM or a free-form regex
 * decision. It tokenizes shell structure first, normalizes command names and
 * arguments, classifies each segment, and combines compound commands by the
 * highest concrete effect.
 */

export const COMMAND_EFFECT_CLASSES = Object.freeze({
  LOCAL_INSPECTION: "LOCAL_INSPECTION",
  LOCAL_BUILD: "LOCAL_BUILD",
  LOCAL_TEST: "LOCAL_TEST",
  LOCAL_GENERATION: "LOCAL_GENERATION",
  LOCAL_PACKAGE_OPERATION: "LOCAL_PACKAGE_OPERATION",
  LOCAL_GIT_READ: "LOCAL_GIT_READ",
  LOCAL_GIT_WRITE: "LOCAL_GIT_WRITE",
  NETWORK_READ: "NETWORK_READ",
  EXTERNAL_WRITE: "EXTERNAL_WRITE",
  PUBLISH: "PUBLISH",
  DEPLOY: "DEPLOY",
  SECRET_ACCESS: "SECRET_ACCESS",
  DESTRUCTIVE: "DESTRUCTIVE",
  UNKNOWN: "UNKNOWN",
})

const C = COMMAND_EFFECT_CLASSES
const R = Object.freeze({
  FULLY_REVERSIBLE: "FULLY_REVERSIBLE",
  REVERSIBLE_WITH_BACKUP: "REVERSIBLE_WITH_BACKUP",
  PARTIALLY_REVERSIBLE: "PARTIALLY_REVERSIBLE",
  IRREVERSIBLE: "IRREVERSIBLE",
  UNKNOWN_REVERSIBILITY: "UNKNOWN_REVERSIBILITY",
})

const RANK = Object.freeze({
  [C.LOCAL_INSPECTION]: 10,
  [C.LOCAL_GIT_READ]: 12,
  [C.NETWORK_READ]: 20,
  [C.LOCAL_TEST]: 30,
  [C.LOCAL_BUILD]: 32,
  [C.LOCAL_PACKAGE_OPERATION]: 36,
  [C.LOCAL_GENERATION]: 40,
  [C.LOCAL_GIT_WRITE]: 45,
  [C.EXTERNAL_WRITE]: 70,
  [C.PUBLISH]: 75,
  [C.DEPLOY]: 80,
  [C.SECRET_ACCESS]: 90,
  [C.DESTRUCTIVE]: 100,
  [C.UNKNOWN]: 0,
})

const INSPECTION_COMMANDS = new Set([
  "pwd", "cd", "dir", "ls", "ll", "la", "find", "grep", "rg", "cat", "head", "tail", "type",
  "get-childitem", "get-item", "test-path", "get-content", "resolve-path", "get-filehash",
  "select-object", "where-object", "sort-object", "measure-object", "which", "where", "whoami",
])
const BUILD_COMMANDS = new Set(["tsc", "make", "ninja", "msbuild", "gradle", "mvn", "bazel", "go"])
const TEST_COMMANDS = new Set(["pytest", "vitest", "jest", "mocha", "ctest"])
const PACKAGE_COMMANDS = new Set(["install", "ci", "add", "i", "restore", "pack", "cache", "fetch"])
const SECRET_NAME = /(?:^|[\\/])\.env(?:$|[.\\/])|(?:^|[._-])(api[_-]?key|access[_-]?token|secret|password|private[_-]?key)(?:$|[._-])/i
const SECRET_ENV = /^(?:env:)?(?:.*(?:key|token|secret|password|credential).*)$/i
const ABSOLUTE_PATH = /^(?:[a-z]:[\\/]|[\\/]|\\\\)/i

function emptySegment() {
  return { tokens: [], operators: [] }
}

function pushToken(segment, value) {
  if (value.length > 0) segment.tokens.push(value)
}

/** Tokenize shell separators while preserving quoted arguments. */
export function parseCommand(command = "", { shell = "auto" } = {}) {
  const source = String(command)
  const segments = []
  let segment = emptySegment()
  let current = ""
  let quote = null
  let escaped = false

  const flush = () => {
    pushToken(segment, current)
    current = ""
  }
  const split = (operator) => {
    flush()
    if (segment.tokens.length > 0 || segment.operators.length > 0) segments.push(segment)
    segment = emptySegment()
    segment.operators.push(operator)
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1] || ""
    if (quote) {
      if (escaped && shell !== "powershell") {
        current += char
        escaped = false
      } else if (char === "\\" && shell !== "powershell" && (next === quote || /\s/.test(next))) {
        escaped = true
      } else if (char === quote) {
        quote = null
      } else if (shell === "powershell" && char === "`" && next) {
        current += next
        index += 1
      } else {
        current += char
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === "#" && current.trim() === "") break
    if (char === ";" || char === "\n") {
      split(char)
      continue
    }
    if (char === "&" || char === "|") {
      const operator = `${char}${next === char ? next : ""}`
      if (next === char) index += 1
      split(operator)
      continue
    }
    if (char === ">" || char === "<") {
      flush()
      const operator = `${char}${next === char ? next : ""}`
      if (next === char) index += 1
      segment.tokens.push(operator)
      continue
    }
    if (/\s/.test(char)) {
      flush()
      continue
    }
    if (char === "\\" && (next === " " || next === "\t" || next === "|" || next === ";" || next === "&")) {
      current += next
      index += 1
      continue
    }
    current += char
  }
  flush()
  if (segment.tokens.length > 0 || segment.operators.length > 0) segments.push(segment)
  return { shell, source, segments }
}

function basename(value) {
  return String(value || "").replace(/^.*[\\/]/, "").toLowerCase().replace(/\.exe$/, "")
}

function isFlag(value) { return /^-{1,2}[a-z]/i.test(value) || /^\/[a-z]/i.test(value) }

function pathArguments(tokens) {
  return tokens
    .slice(1)
    .filter((token) => token && !isFlag(token) && !token.startsWith("-") && !/^\d?>{1,2}$/.test(token))
    .filter((token) => !token.includes("://") && token !== "--")
    .filter((token) => ABSOLUTE_PATH.test(token) || token === "." || token === ".." || token.includes(".."))
}

function containsSecret(tokens) {
  return tokens.some((token) => SECRET_NAME.test(token) || (token.startsWith("Env:") && SECRET_ENV.test(token.slice(4))))
}

function result(effectClass, governanceEffect, reversibility, tool, action, resource, tokens, extra = {}) {
  return {
    effect_class: effectClass,
    governance_effect: governanceEffect,
    reversibility,
    tool,
    action,
    resource,
    paths: pathArguments(tokens),
    tokens,
    ...extra,
  }
}

function gitSubcommand(tokens) {
  for (let index = 1; index < tokens.length; index += 1) {
    if (tokens[index] === "--") return tokens[index + 1]?.toLowerCase() || ""
    if (["-c", "--git-dir", "--work-tree"].includes(tokens[index].toLowerCase())) {
      index += 1
      continue
    }
    if (!isFlag(tokens[index])) return basename(tokens[index])
  }
  return ""
}

function hasArg(tokens, ...values) {
  const normalized = new Set(values.map((value) => value.toLowerCase()))
  return tokens.some((token) => normalized.has(token.toLowerCase()))
}

function packageSubcommand(tokens) {
  const wrappers = new Set(["run", "exec", "command", "tauri"])
  for (let index = 1; index < tokens.length; index += 1) {
    if (tokens[index] === "--") return basename(tokens[index + 1])
    if (isFlag(tokens[index])) continue
    if (wrappers.has(basename(tokens[index]))) continue
    return basename(tokens[index])
  }
  return ""
}

function unwrapShell(tokens) {
  const command = basename(tokens[0])
  const switches = command === "cmd" ? ["/c", "/k"] : ["-c", "-command", "--command"]
  if (!["cmd", "powershell", "pwsh", "bash", "sh", "zsh"].includes(command)) return null
  const index = tokens.findIndex((token) => switches.includes(token.toLowerCase()))
  if (index < 0 || !tokens[index + 1]) return null
  return tokens.slice(index + 1).join(" ")
}

function classifySegment(tokens, shell) {
  if (!tokens.length) return null
  const nested = unwrapShell(tokens)
  if (nested) return classifyCommand(nested, { shell }).segments[0] || null
  const command = basename(tokens[0])
  const text = tokens.join(" ")

  if (containsSecret(tokens) || ((command === "printenv" || command === "env" || command === "set") && tokens.slice(1).some((token) => SECRET_ENV.test(token)))) {
    return result(C.SECRET_ACCESS, "SECRET_ACCESS", R.UNKNOWN_REVERSIBILITY, "filesystem", "read", `secret://${text}`, tokens)
  }

  if (["format", "diskpart", "shred", "wipefs"].includes(command) || command === "git" && gitSubcommand(tokens) === "clean") {
    return result(C.DESTRUCTIVE, "IRREVERSIBLE_DELETE", R.IRREVERSIBLE, "filesystem", "delete", "filesystem://destructive", tokens)
  }
  if (["rm", "unlink", "del", "erase", "rmdir", "rd"].includes(command)) {
    const destructive = hasArg(tokens, "-rf", "-fr", "/s", "/q", "-recurse", "-force") || tokens.some((token) => token === "/" || token === "\\")
    return destructive
      ? result(C.DESTRUCTIVE, "IRREVERSIBLE_DELETE", R.IRREVERSIBLE, "filesystem", "delete", "filesystem://destructive", tokens)
      : result(C.LOCAL_GENERATION, "LOCAL_DELETE", R.REVERSIBLE_WITH_BACKUP, "filesystem", "delete", "workspace://local", tokens)
  }
  if (command === "remove-item") {
    const destructive = hasArg(tokens, "-recurse", "-force") || tokens.some((token) => token === "/" || token === "\\" || token.includes("*"))
    return destructive
      ? result(C.DESTRUCTIVE, "IRREVERSIBLE_DELETE", R.IRREVERSIBLE, "filesystem", "delete", "filesystem://destructive", tokens)
      : result(C.LOCAL_GENERATION, "LOCAL_DELETE", R.REVERSIBLE_WITH_BACKUP, "filesystem", "delete", "workspace://local", tokens)
  }

  if (command === "git") {
    const subcommand = gitSubcommand(tokens)
    if (subcommand === "push") return result(C.EXTERNAL_WRITE, "PUSH", R.PARTIALLY_REVERSIBLE, "git", "push", "git-remote", tokens)
    if (["merge", "rebase"].includes(subcommand)) return result(C.EXTERNAL_WRITE, subcommand === "merge" ? "MERGE" : "LOCAL_COMMIT", subcommand === "merge" ? R.IRREVERSIBLE : R.REVERSIBLE_WITH_BACKUP, "git", subcommand, subcommand === "merge" ? "protected-branch" : "git-index", tokens)
    if (["fetch", "ls-remote", "clone"].includes(subcommand)) return result(C.NETWORK_READ, "NETWORK", R.FULLY_REVERSIBLE, "network", "read", `network://read/git-${subcommand}`, tokens)
    if (["status", "diff", "log", "show", "branch", "rev-parse", "remote", "config", "ls-files", "describe", "name-rev", "shortlog", "grep"].includes(subcommand) || (subcommand === "tag" && tokens.slice(1).filter((token) => !isFlag(token)).length === 1)) return result(C.LOCAL_GIT_READ, "LOCAL_READ", R.FULLY_REVERSIBLE, "git", "read", "git://read", tokens)
    if (["add", "tag", "reset", "checkout", "switch", "cherry-pick", "commit"].includes(subcommand)) return result(C.LOCAL_GIT_WRITE, subcommand === "commit" ? "LOCAL_COMMIT" : "LOCAL_COMMIT", R.FULLY_REVERSIBLE, "git", subcommand === "commit" ? "commit" : "write", "git-index", tokens)
  }

  if (["gh", "hub"].includes(command)) {
    const subcommand = packageSubcommand(tokens)
    const nestedCommand = tokens.slice(1).find((token) => ["view", "list", "status", "checks", "diff"].includes(token.toLowerCase()))
    if (nestedCommand) return result(C.NETWORK_READ, "NETWORK", R.FULLY_REVERSIBLE, "network", "read", "network://read/github", tokens)
    if (tokens.some((token) => token.toLowerCase() === "merge")) return result(C.EXTERNAL_WRITE, "MERGE", R.IRREVERSIBLE, "shell", "execute", "protected-branch", tokens)
    if (tokens.some((token) => token.toLowerCase() === "workflow" && tokens[tokens.indexOf(token) + 1]?.toLowerCase() === "run")) return result(C.EXTERNAL_WRITE, "EXTERNAL_COMMUNICATION", R.IRREVERSIBLE, "shell", "execute", "remote://workflow", tokens)
    if (subcommand === "release" && tokens.some((token) => token.toLowerCase() === "create")) return result(C.PUBLISH, "EXTERNAL_COMMUNICATION", R.IRREVERSIBLE, "shell", "execute", "publish://release", tokens)
    if (tokens.some((token) => ["close", "comment", "delete", "create"].includes(token.toLowerCase()))) return result(C.EXTERNAL_WRITE, "EXTERNAL_COMMUNICATION", R.IRREVERSIBLE, "shell", "execute", "remote://external-write", tokens)
  }

  if (["cargo", "npm", "pnpm", "yarn", "bun", "pip", "python", "python3", "twine"].includes(command)) {
    const subcommand = packageSubcommand(tokens)
    if (command === "python" || command === "python3") {
      if (tokens.some((token) => token === "pytest" || token === "py.test") || hasArg(tokens, "pytest")) return result(C.LOCAL_TEST, "TEST_EXECUTION", R.FULLY_REVERSIBLE, "test", "run", "test-run", tokens)
      if (hasArg(tokens, "build")) return result(C.LOCAL_BUILD, "LOCAL_EXECUTE", R.REVERSIBLE_WITH_BACKUP, "shell", "execute", "workspace://local", tokens)
    }
    if (command === "twine" && ["upload", "upload-legacy"].includes(subcommand)) return result(C.PUBLISH, "EXTERNAL_COMMUNICATION", R.IRREVERSIBLE, "shell", "execute", "publish://registry", tokens)
    if (["publish", "upload"].includes(subcommand)) return result(C.PUBLISH, "EXTERNAL_COMMUNICATION", R.IRREVERSIBLE, "shell", "execute", "publish://registry", tokens)
    if (command === "cargo" && ["fetch", "update"].includes(subcommand)) return result(C.NETWORK_READ, "NETWORK", R.FULLY_REVERSIBLE, "network", "read", `network://read/cargo-${subcommand}`, tokens)
    if (command === "cargo" && (["check", "build", "clippy", "fmt"].includes(subcommand) || tokens.some((token) => token.toLowerCase() === "build"))) return result(C.LOCAL_BUILD, "LOCAL_EXECUTE", R.REVERSIBLE_WITH_BACKUP, "shell", "execute", "workspace://local", tokens)
    if (command === "cargo" && subcommand === "package") return result(C.LOCAL_PACKAGE_OPERATION, "LOCAL_EXECUTE", R.REVERSIBLE_WITH_BACKUP, "shell", "execute", "workspace://local", tokens)
    if (command === "cargo" && subcommand === "test") return result(C.LOCAL_TEST, "TEST_EXECUTION", R.FULLY_REVERSIBLE, "test", "run", "test-run", tokens)
    if (command !== "cargo" && ["install", "add", "i", "restore", "pack", "cache"].includes(subcommand)) return result(C.LOCAL_PACKAGE_OPERATION, "LOCAL_EXECUTE", R.REVERSIBLE_WITH_BACKUP, "shell", "execute", "workspace://local", tokens)
    if (command !== "cargo" && ["test", "run"].includes(subcommand) && text.toLowerCase().includes("test")) return result(C.LOCAL_TEST, "TEST_EXECUTION", R.FULLY_REVERSIBLE, "test", "run", "test-run", tokens)
    if (command !== "cargo" && ["build", "compile"].includes(subcommand)) return result(C.LOCAL_BUILD, "LOCAL_EXECUTE", R.REVERSIBLE_WITH_BACKUP, "shell", "execute", "workspace://local", tokens)
    if (["create", "init"].includes(subcommand)) return result(C.LOCAL_GENERATION, "LOCAL_WRITE", R.REVERSIBLE_WITH_BACKUP, "filesystem", "write", "workspace://local", tokens)
  }

  if (command === "node" && hasArg(tokens, "--test")) return result(C.LOCAL_TEST, "TEST_EXECUTION", R.FULLY_REVERSIBLE, "test", "run", "test-run", tokens)
  if (command === "node" && tokens.some((token) => /(?:test|build|check|lint)[^/\\]*\.(?:m?js|cjs|ts|py)$/i.test(token))) return result(C.LOCAL_TEST, "TEST_EXECUTION", R.FULLY_REVERSIBLE, "test", "run", "test-run", tokens)
  if (["npx", "pnpm", "npm", "yarn", "bun"].includes(command) && tokens.some((token) => token.toLowerCase() === "tsc")) return result(C.LOCAL_BUILD, "LOCAL_EXECUTE", R.REVERSIBLE_WITH_BACKUP, "shell", "execute", "workspace://local", tokens)
  if (BUILD_COMMANDS.has(command) && (command === "tsc" || hasArg(tokens, "build", "check", "compile", "package"))) return result(C.LOCAL_BUILD, "LOCAL_EXECUTE", R.REVERSIBLE_WITH_BACKUP, "shell", "execute", "workspace://local", tokens)
  if (TEST_COMMANDS.has(command) || ["eslint", "prettier", "ruff", "mypy", "flake8", "black"].includes(command) || (command === "go" && hasArg(tokens, "test"))) return result(C.LOCAL_TEST, "TEST_EXECUTION", R.FULLY_REVERSIBLE, "test", "run", "test-run", tokens)

  if (["curl", "wget", "invoke-webrequest", "invoke-restmethod"].includes(command)) {
    const writes = hasArg(tokens, "-d", "--data", "--data-raw", "-x", "--request", "post", "put", "patch", "delete") || tokens.some((token) => /^(post|put|patch|delete)$/i.test(token))
    return writes
      ? result(C.EXTERNAL_WRITE, "EXTERNAL_COMMUNICATION", R.IRREVERSIBLE, "shell", "execute", "remote://external-write", tokens)
      : result(C.NETWORK_READ, "NETWORK", R.FULLY_REVERSIBLE, "network", "read", "network://read/http", tokens)
  }

  if (["vercel", "netlify", "kubectl", "terraform", "docker"].includes(command) && text.match(/\b(deploy|apply|push|up)\b/i)) return result(C.DEPLOY, "PRODUCTION_DEPLOY", R.IRREVERSIBLE, "shell", "execute", "deploy://production", tokens)
  if (["lint", "format", "typecheck", "check"].includes(packageSubcommand(tokens)) && ["npm", "pnpm", "yarn", "bun"].includes(command)) return result(C.LOCAL_TEST, "TEST_EXECUTION", R.FULLY_REVERSIBLE, "test", "run", "test-run", tokens)
  if (["touch", "mkdir", "md", "new-item", "set-content", "out-file", "copy-item", "move-item", "tee"].includes(command) || tokens.includes(">") || tokens.includes(">>")) return result(C.LOCAL_GENERATION, command === "move-item" || command === "copy-item" ? "LOCAL_WRITE" : "LOCAL_WRITE", R.REVERSIBLE_WITH_BACKUP, "filesystem", "write", "workspace://local", tokens)
  if (INSPECTION_COMMANDS.has(command)) return result(C.LOCAL_INSPECTION, "LOCAL_READ", R.FULLY_REVERSIBLE, "filesystem", "read", "workspace://inspection", tokens)

  return result(C.UNKNOWN, "UNKNOWN_TOOL_EFFECT", R.UNKNOWN_REVERSIBILITY, "shell", "execute", text || "shell://unknown", tokens)
}

function flattenSegments(parsed) {
  const expanded = []
  for (const segment of parsed.segments) {
    const nested = unwrapShell(segment.tokens)
    if (!nested) expanded.push(segment)
    else expanded.push(...parseCommand(nested, { shell: parsed.shell }).segments)
  }
  return expanded
}

/** Parse, normalize, classify, and combine a complete shell command. */
export function classifyCommand(command = "", options = {}) {
  const parsed = parseCommand(command, options)
  const segments = flattenSegments(parsed).map((segment) => classifySegment(segment.tokens, parsed.shell)).filter(Boolean)
  const selected = segments.reduce((best, current) => !best || RANK[current.effect_class] > RANK[best.effect_class] ? current : best, null)
    || result(C.UNKNOWN, "UNKNOWN_TOOL_EFFECT", R.UNKNOWN_REVERSIBILITY, "shell", "execute", "shell://unknown", [])
  return Object.freeze({
    shell: parsed.shell,
    command: parsed.source,
    segments,
    effect_class: selected.effect_class,
    governance_effect: selected.governance_effect,
    reversibility: selected.reversibility,
    tool: selected.tool,
    action: selected.action,
    resource: selected.resource,
    paths: [...new Set(segments.flatMap((segment) => segment.paths || []))],
  })
}
