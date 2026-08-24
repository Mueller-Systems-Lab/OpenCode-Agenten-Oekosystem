// SPDX-License-Identifier: MIT
/**
 * Browser evidence capture — MCP Playwright screenshot + snapshot.
 *
 * Least-privilege grant enforcement via mcpSessionCall (grant+server).
 * Viewport determinism via browser_resize is best-effort (ignore MCP_TOOL_NOT_FOUND).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { createMcpSession, mcpSessionCall } from '../mcp/tool-executor.mjs'

import { CANONICAL_VIEWPORTS } from './viewport-policy.mjs'

export const VIEWPORTS = CANONICAL_VIEWPORTS

function isValidUrl(url) {
  if (typeof url !== 'string' || url.trim().length === 0) return false
  return url.startsWith('file://') || url.startsWith('http://') || url.startsWith('https://')
}

export async function capturePageEvidence({
  run_id,
  page,
  viewport,
  grant,
  server = 'playwright',
  mcpCommand,
  mcpArgs = [],
  evidence_dir,
  timeout_ms = 15000,
} = {}) {
  const start = Date.now()
  if (!run_id || typeof run_id !== 'string' || run_id.trim().length === 0) {
    return { ok: false, failure_class: 'BROWSER_MCP_UNAVAILABLE', reason: 'run_id required' }
  }
  const url = page?.url
  if (!isValidUrl(url)) {
    return { ok: false, failure_class: 'BROWSER_NAVIGATION_FAILURE', reason: 'url must be file:// or http(s)://' }
  }
  if (!evidence_dir || typeof evidence_dir !== 'string' || evidence_dir.trim().length === 0) {
    return { ok: false, failure_class: 'BROWSER_MCP_UNAVAILABLE', reason: 'evidence_dir required' }
  }
  await fs.mkdir(evidence_dir, { recursive: true, mode: 0o700 })

  if (!mcpCommand) {
    return { ok: false, failure_class: 'BROWSER_MCP_UNAVAILABLE', reason: 'SERVER_CONFIGURATION_MISSING' }
  }

  // Normalize mcpCommand/mcpArgs: the runner passes command as array ["bin", ...args]; browser-evidence expects string+args
  let effectiveCommand = mcpCommand
  let effectiveArgsBase = Array.isArray(mcpArgs) ? [...mcpArgs] : []
  if (Array.isArray(mcpCommand)) {
    effectiveCommand = mcpCommand[0]
    const extraFromCommand = mcpCommand.slice(1)
    effectiveArgsBase = [...extraFromCommand, ...effectiveArgsBase]
  }
  // playwright-mcp defaults to a shared browser profile; --isolated ensures each session gets its own
  // in-memory profile and avoids 'Browser is already in use' when multiple sessions run.
  // --allow-unrestricted-file-access is required for file:// fixture URLs.
  const cmdString = typeof effectiveCommand === 'string' ? effectiveCommand : String(effectiveCommand || '')
  const needsPlaywrightFlags = cmdString.includes('playwright-mcp')
  const effectiveArgs = (() => {
    const base = [...effectiveArgsBase]
    if (needsPlaywrightFlags) {
      if (!base.includes('--isolated')) base.push('--isolated')
      if (!base.includes('--allow-unrestricted-file-access')) base.push('--allow-unrestricted-file-access')
    }
    return base
  })()
  const session = createMcpSession({ command: effectiveCommand, args: effectiveArgs, serverName: server, timeout_ms })
  if (!session || session.ok === false) {
    return { ok: false, failure_class: 'BROWSER_MCP_UNAVAILABLE', reason: session?.reason || 'SERVER_CONFIGURATION_MISSING' }
  }

  // 1) navigate
  const nav = await mcpSessionCall({ session, tool: 'browser_navigate', arguments: { url }, timeout_ms, grant, server })
  if (nav.status !== 'MCP_SUCCESS') {
    try { await session.close() } catch {}
    const failureClass = nav.failure_class === 'MCP_TOOL_NOT_FOUND' ? 'BROWSER_MCP_UNAVAILABLE' : 'BROWSER_NAVIGATION_FAILURE'
    // Navigation failure is distinct from screenshot failure (firstBadBoundary)
    if (nav.failure_class === 'MCP_TOOL_NOT_FOUND' || nav.status === 'DENIED') {
      return { ok: false, failure_class: 'BROWSER_MCP_UNAVAILABLE', reason: nav.failure_reason || nav.failure_class }
    }
    return { ok: false, failure_class, reason: nav.failure_reason || nav.failure_class, details: nav.failure_class }
  }

  // 2) resize — best-effort viewport determinism
  if (viewport && typeof viewport.width === 'number' && typeof viewport.height === 'number') {
    const resized = await mcpSessionCall({ session, tool: 'browser_resize', arguments: { width: viewport.width, height: viewport.height }, timeout_ms, grant, server })
    if (resized.failure_class === 'MCP_TOOL_NOT_FOUND') {
      // best-effort: ignore when tool absent from server version
    } else if (resized.status === 'DENIED') {
      // grant denied for resize is non-fatal? Treat as failure_class but allow continue if not granted? Spec says harness-viewport config, so ignore deny as best-effort
    }
  }

  // 3) wait/determinism — minimal
  const waitCall = await mcpSessionCall({ session, tool: 'browser_wait_for', arguments: { time: 0.5 }, timeout_ms, grant, server })
  if (waitCall.failure_class === 'MCP_TOOL_NOT_FOUND' || waitCall.status === 'DENIED') {
    await new Promise((r) => setTimeout(r, 200))
  }

  // 4) snapshot — non-fatal
  let snapshot_text = null
  const snap = await mcpSessionCall({ session, tool: 'browser_snapshot', arguments: {}, timeout_ms, grant, server })
  if (snap.status === 'MCP_SUCCESS' && snap.result) {
    const content = snap.result.content
    if (Array.isArray(content)) {
      snapshot_text = content.map((e) => e?.text || '').join('\n')
    } else if (typeof snap.result.text === 'string') {
      snapshot_text = snap.result.text
    } else {
      try { snapshot_text = JSON.stringify(snap.result) } catch { snapshot_text = String(snap.result) }
    }
  }

  // 5) screenshot
  const vpName = viewport?.name || 'desktop'
  const pageName = page?.name || 'page'
  const basename = `${run_id}-${pageName}-${vpName}.png`
  const screenshot_path = path.resolve(evidence_dir, basename)
  const shot = await mcpSessionCall({ session, tool: 'browser_take_screenshot', arguments: { filename: screenshot_path, type: 'png', fullPage: false }, timeout_ms, grant, server })
  if (shot.status !== 'MCP_SUCCESS') {
    try { await session.close() } catch {}
    if (shot.status === 'DENIED' || shot.failure_class === 'MCP_TOOL_NOT_FOUND') {
      return { ok: false, failure_class: 'BROWSER_MCP_UNAVAILABLE', reason: shot.failure_reason || shot.failure_class }
    }
    return { ok: false, failure_class: 'SCREENSHOT_CAPTURE_FAILURE', reason: shot.failure_reason || shot.failure_class }
  }

  // After screenshot: fingerprint + sidecar (never log raw bytes)
  let image_fingerprint = null
  try {
    const bytes = await fs.readFile(screenshot_path)
    image_fingerprint = crypto.createHash('sha256').update(bytes).digest('hex')
  } catch (e) {
    try { await session.close() } catch {}
    return { ok: false, failure_class: 'SCREENSHOT_CAPTURE_FAILURE', reason: `fingerprint failed: ${e.message}` }
  }

  const sidecarPath = `${screenshot_path}.meta.json`
  const sidecar = {
    run_id,
    page: pageName,
    viewport: vpName,
    screenshot_path,
    image_fingerprint,
    snapshot_chars: snapshot_text ? snapshot_text.length : 0,
    timestamp: new Date().toISOString(),
  }
  await fs.writeFile(sidecarPath, JSON.stringify(sidecar, null, 2), { encoding: 'utf8', mode: 0o600 })

  try { await session.close() } catch {}

  return {
    ok: true,
    page: pageName,
    viewport: vpName,
    url,
    screenshot_path,
    image_fingerprint,
    snapshot_text,
    duration_ms: Date.now() - start,
  }
}
