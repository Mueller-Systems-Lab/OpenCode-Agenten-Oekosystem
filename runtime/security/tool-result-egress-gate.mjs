const SENSITIVE_ASSIGNMENT = /\b(?:[a-z0-9]+[_-])*(?:api[_-]?key|secret(?:[_-]?(?:access[_-]?)?key)?|token|password|passwd|credential|authorization)\b\s*[:=]\s*["']?([^\s"',;]+)/gi
const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/
const TOKEN_SHAPE = /\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/
const SAFE_PLACEHOLDERS = /^(?:replace-me|example|sample|template|placeholder|changeme|redacted|\[redacted\]|<[^>]+>)$/i

function blocked(reason) {
  return {
    status: "RED_BLOCK_SECRET_EGRESS",
    reason,
    content_disclosed: false,
    content_returned: false,
    bytes_returned: 0,
  }
}

function serialize(value) {
  return typeof value === "string" ? value : JSON.stringify(value)
}

function stringLeaves(value, output = []) {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        stringLeaves(JSON.parse(trimmed), output)
        return output
      } catch {
        // Non-JSON strings are scanned as-is.
      }
    }
    output.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) stringLeaves(item, output)
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) stringLeaves(item, output)
  }
  return output
}

export function gateToolResult({
  value,
  channel = "mcp",
  knownSecrets = [],
  maxBytes = 65_536,
} = {}) {
  let serialized
  try {
    serialized = serialize(value)
  } catch {
    return blocked("UNSERIALIZABLE_RESULT")
  }
  const bytes = Buffer.byteLength(serialized || "", "utf8")
  if (bytes > maxBytes) return blocked("UNEXPECTED_LARGE_OUTPUT")
  if (channel === "environment") return blocked("ENVIRONMENT_OUTPUT_DENIED")

  for (const leaf of stringLeaves(value)) {
    for (const secret of knownSecrets) {
      if (typeof secret === "string" && secret.length > 0 && leaf.includes(secret)) {
        return blocked("KNOWN_SECRET_MATCH")
      }
    }
    if (PRIVATE_KEY.test(leaf)) return blocked("PRIVATE_KEY_PATTERN")
    if (TOKEN_SHAPE.test(leaf)) return blocked("TOKEN_PATTERN")

    SENSITIVE_ASSIGNMENT.lastIndex = 0
    for (const match of leaf.matchAll(SENSITIVE_ASSIGNMENT)) {
      if (!SAFE_PLACEHOLDERS.test(match[1])) return blocked("SENSITIVE_ASSIGNMENT_PATTERN")
    }
  }

  return {
    status: "VERIFIED_IN_SCOPE",
    channel,
    value,
    content_disclosed: false,
    bytes_returned: bytes,
  }
}
