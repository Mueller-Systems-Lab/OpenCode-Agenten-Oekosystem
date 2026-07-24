#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { evaluateAction, recordActionOutcome } from '../../runtime/gates/evaluate-action.mjs'

const args = parseArgs(process.argv.slice(2))
if (!args.target || !args.server || !args.tool || !args.action) throw new Error('Usage: --target <dir> --server <node-script> --tool <name> --action <read|write> --resource <path> [--content <text>]')
const target = path.resolve(args.target)
const governance = path.join(target, '.agent-governance')
const readJson = async (name) => { try { return JSON.parse(await fs.readFile(path.join(governance, name), 'utf8')) } catch { return null } }
const actionKey = args.action === 'read' ? 'mcp.read' : args.action === 'write' ? 'mcp.write' : `mcp.${args.action}`
const auditPath = path.join(governance, 'evidence', 'action-audit.jsonl')
const decision = await evaluateAction({
  tool: 'mcp', action: args.action, capabilityKey: actionKey, resource: args.resource,
  capsule: await readJson('task-capsule.json'), intent: await readJson('owner-intent.json'),
  runtime: 'mcp-sandbox', auditPath,
})
if (!decision.allowed) {
  console.log(JSON.stringify({ handshake: false, executed: false, decision }))
  process.exit(decision.requires_owner ? 1 : 2)
}

const protocolInput = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'governance-v2-guard', version: '1.0.0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: args.tool, arguments: { path: args.resource, content: args.content || '' } } },
].map((message) => JSON.stringify(message)).join('\n') + '\n'
const child = spawnSync(process.execPath, [path.resolve(args.server)], { cwd: target, input: protocolInput, encoding: 'utf8', timeout: 5000 })
const messages = child.stdout.split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)] } catch { return [] }
})
try {
  const initialized = messages.find((message) => message.id === 1) || { error: { message: 'missing initialize response' } }
  const listed = messages.find((message) => message.id === 2) || {}
  const result = messages.find((message) => message.id === 3) || { error: { message: 'missing tools/call response' } }
  await recordActionOutcome({ auditPath, decision, success: !result.error && !result.result?.isError, output: result.result?.content || result.error || null })
  console.log(JSON.stringify({ handshake: !initialized.error, tools: listed.result?.tools?.map((tool) => tool.name) || [], executed: true, decision, result: result.result || result.error, stderr: String(child.stderr || '').slice(0, 1000), process_status: child.status, process_error: child.error?.message || null }))
  process.exit(result.error || result.result?.isError ? 1 : 0)
} catch (error) {
  console.log(JSON.stringify({ handshake: false, executed: false, decision, error: error.message }))
  process.exit(1)
}

function parseArgs(argv) {
  const result = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--target') result.target = argv[++i]
    else if (arg === '--server') result.server = argv[++i]
    else if (arg === '--tool') result.tool = argv[++i]
    else if (arg === '--action') result.action = argv[++i]
    else if (arg === '--resource') result.resource = argv[++i]
    else if (arg === '--content') result.content = argv[++i]
  }
  return result
}
