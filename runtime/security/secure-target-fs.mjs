import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"

import { createSecretDenial } from "./bootstrap-denial.mjs"
import { classifySecretPath, isSafeReadAllowed, resolveTargetPath } from "./secret-path-policy.mjs"
import { gateToolResult } from "./tool-result-egress-gate.mjs"

const MAX_SAFE_READ_BYTES = 64 * 1024

function pathDenial(resourceClass = "TARGET_SECRET") {
  return {
    ...createSecretDenial({ action: "filesystem.read" }),
    resource_class: resourceClass,
  }
}

function nonSecretReadDenial(resourceClass) {
  return {
    status: "RED_BLOCK_TARGET_READ_NOT_ALLOWLISTED",
    action: "filesystem.read",
    resource_class: resourceClass,
    path_disclosed: false,
    content_returned: false,
    bytes_returned: 0,
    retry_same_action: false,
    safe_next_actions: ["bootstrap_inspect_target"],
  }
}

export async function readSafeTargetFile({
  targetRoot,
  inputPath,
  knownSecrets = [],
  maxBytes = MAX_SAFE_READ_BYTES,
}) {
  const resolved = await resolveTargetPath({ targetRoot, inputPath })
  if (!resolved.allowed) {
    return ["TARGET_SECRET", "TARGET_SECRET_ALIAS", "TARGET_CREDENTIAL_STORE", "TARGET_GIT_INTERNAL", "PROCESS_ENVIRONMENT"]
      .includes(resolved.resourceClass)
      ? pathDenial(resolved.resourceClass)
      : nonSecretReadDenial(resolved.resourceClass)
  }
  if (!isSafeReadAllowed(resolved.relativePath)) {
    return nonSecretReadDenial("TARGET_METADATA_ONLY")
  }

  let before
  try {
    before = await fs.lstat(resolved.absolutePath)
  } catch {
    return pathDenial("TARGET_PATH_UNAVAILABLE")
  }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1 || before.size > maxBytes) {
    return pathDenial(before.nlink !== 1 ? "TARGET_SECRET_ALIAS" : "TARGET_UNSAFE_FILE")
  }

  let handle
  try {
    handle = await fs.open(resolved.absolutePath, fsSync.constants.O_RDONLY | fsSync.constants.O_NOFOLLOW)
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size > maxBytes
    ) {
      return pathDenial("TARGET_FILE_RACE")
    }
    const buffer = Buffer.alloc(opened.size)
    const { bytesRead } = await handle.read(buffer, 0, opened.size, 0)
    const content = buffer.subarray(0, bytesRead).toString("utf8")
    const gated = gateToolResult({ value: content, channel: "file", knownSecrets, maxBytes })
    if (gated.status !== "VERIFIED_IN_SCOPE") return gated
    return {
      status: "VERIFIED_IN_SCOPE",
      resource_class: classifySecretPath(resolved.relativePath).resourceClass === "TARGET_SAFE_TEMPLATE"
        ? "TARGET_SAFE_TEMPLATE"
        : "TARGET_SAFE_METADATA",
      relative_path: resolved.relativePath,
      content,
      content_returned: true,
      bytes_returned: bytesRead,
    }
  } catch {
    return pathDenial("TARGET_PATH_UNAVAILABLE")
  } finally {
    await handle?.close()
  }
}

async function walkMetadata(targetRoot, relative = "") {
  const directory = path.join(targetRoot, relative)
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const results = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = path.posix.join(relative.split(path.sep).join("/"), entry.name)
    const absolutePath = path.join(targetRoot, ...relativePath.split("/"))
    const stat = await fs.lstat(absolutePath)
    const policy = classifySecretPath(relativePath)
    results.push({
      relative_path: relativePath,
      type: entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      size: stat.size,
      mode: stat.mode & 0o777,
      symlink: entry.isSymbolicLink(),
      link_count: stat.nlink,
      resource_class: policy.decision === "ABSOLUTE_DENY"
        ? policy.resourceClass
        : isSafeReadAllowed(relativePath)
          ? "TARGET_SAFE_METADATA"
          : "TARGET_METADATA_ONLY",
    })
    if (
      entry.isDirectory() &&
      !entry.isSymbolicLink() &&
      policy.decision !== "ABSOLUTE_DENY" &&
      relativePath !== ".git"
    ) {
      results.push(...await walkMetadata(targetRoot, relativePath))
    }
  }
  return results
}

export async function inspectTarget({ targetRoot, knownSecrets = [] }) {
  const entries = await walkMetadata(targetRoot)
  for (const entry of entries) {
    if (entry.resource_class !== "TARGET_SAFE_METADATA" || entry.type !== "file") continue
    const read = await readSafeTargetFile({
      targetRoot,
      inputPath: entry.relative_path,
      knownSecrets,
    })
    if (read.status === "VERIFIED_IN_SCOPE") entry.content = read.content
  }
  const secretEntry = entries.find((entry) =>
    ["TARGET_SECRET", "TARGET_CREDENTIAL_STORE"].includes(entry.resource_class),
  )
  const result = {
    status: "VERIFIED_IN_SCOPE",
    entries,
    ...(secretEntry ? {
      required_denial_probe: {
        action: "bootstrap_inspect_target",
        requested_path: secretEntry.relative_path,
        max_attempts: 1,
        purpose: "Prove technical secret isolation, then continue with bootstrap_dry_run.",
      },
    } : {}),
  }
  const gated = gateToolResult({ value: result, channel: "mcp", knownSecrets })
  if (gated.status !== "VERIFIED_IN_SCOPE") return gated
  return gated.value
}
