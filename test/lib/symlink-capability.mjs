// SPDX-License-Identifier: MIT
/**
 * Host symlink capability probe.
 *
 * Whether the host can create symlinks is a runtime capability question, not
 * a platform heuristic: Developer Mode, privileges, filesystem, and symlink
 * type all matter. The probe performs a REAL symlink creation in a temp
 * directory and reports the actual host capability. Only a genuine inability
 * to create the link is reported as unsupported; if the probe succeeds but a
 * later symlink operation inside a test fails, that is a real test/product
 * failure and stays a FAIL.
 */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const CAPABILITY_ERROR_CODES = new Set(["EPERM", "EACCES", "ENOSYS", "EINVAL", "EXDEV", "UNKNOWN"])

const probeCache = new Map()

/**
 * @param {{ type?: "file"|"dir"|"junction" }} options
 * @returns {Promise<{ supported: boolean, code: string, reason: string|null }>}
 */
export async function probeSymlinkCapability({ type = "file" } = {}) {
  const cached = probeCache.get(type)
  if (cached) return cached
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-symlink-probe-"))
  let result
  try {
    const targetName = type === "file" ? "probe-target.txt" : "probe-target-dir"
    const target = path.join(root, targetName)
    const link = path.join(root, "probe-link")
    if (type === "file") await fs.writeFile(target, "probe")
    else await fs.mkdir(target)
    // Junctions on Windows require absolute targets; file/dir symlinks use the
    // relative target style the tests use.
    const linkTarget = type === "junction" ? target : targetName
    await fs.symlink(linkTarget, link, type === "file" ? undefined : type)
    const stat = await fs.lstat(link)
    if (!stat.isSymbolicLink()) {
      result = { supported: false, code: "HOST_SYMLINK_CAPABILITY_UNAVAILABLE", reason: `symlink of type "${type}" did not materialize as a link` }
    } else {
      result = { supported: true, code: "HOST_SYMLINK_CAPABILITY_AVAILABLE", reason: null }
    }
  } catch (error) {
    const code = error?.code || "UNKNOWN"
    result = CAPABILITY_ERROR_CODES.has(code)
      ? { supported: false, code: "HOST_SYMLINK_CAPABILITY_UNAVAILABLE", reason: `${code}: ${error.message || code}` }
      : { supported: false, code: "SYMLINK_PROBE_ERROR", reason: `${code}: ${error.message || code}` }
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {})
  }
  probeCache.set(type, result)
  return result
}

/**
 * Skip the current node:test test when the host cannot create the requested
 * symlink type. Returns true when the test was skipped (the caller must
 * return immediately).
 */
export async function skipIfHostCannotSymlink(t, { type = "file" } = {}) {
  const probe = await probeSymlinkCapability({ type })
  if (!probe.supported) {
    t.skip(`HOST_SYMLINK_CAPABILITY_UNAVAILABLE (type=${type}): ${probe.reason || ""}`.replace(/\s+$/, ""))
    return true
  }
  return false
}
