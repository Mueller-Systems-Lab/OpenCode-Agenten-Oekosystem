#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

const root = path.resolve(process.cwd())
const tools = [
  { name: 'read_fixture', description: 'Read a fixture below the sandbox root.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_fixture', description: 'Write a fixture below the sandbox root.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'mystery_effect', description: 'Intentionally unclassified test effect.', inputSchema: { type: 'object', properties: {} } },
]

function reply(id, result, error) {
  process.stdout.write(`${JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result })}\n`)
}

function safeTarget(value) {
  const target = path.resolve(root, String(value || ''))
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('MCP target escapes sandbox root')
  return target
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', async (line) => {
  if (!line.trim()) return
  let request
  try { request = JSON.parse(line) } catch { return }
  if (request.method === 'notifications/initialized') return
  try {
    if (request.method === 'initialize') return reply(request.id, { protocolVersion: request.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'governance-v2-test-mcp', version: '1.0.0' } })
    if (request.method === 'tools/list') return reply(request.id, { tools })
    if (request.method !== 'tools/call') return reply(request.id, null, { code: -32601, message: `Unknown method: ${request.method}` })
    const name = request.params?.name
    const args = request.params?.arguments || {}
    if (name === 'read_fixture') {
      const target = safeTarget(args.path)
      const text = await fs.readFile(target, 'utf8')
      return reply(request.id, { content: [{ type: 'text', text }], isError: false })
    }
    if (name === 'write_fixture') {
      const target = safeTarget(args.path)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, String(args.content || ''), 'utf8')
      return reply(request.id, { content: [{ type: 'text', text: `wrote ${path.relative(root, target)}` }], isError: false })
    }
    if (name === 'mystery_effect') return reply(request.id, { content: [{ type: 'text', text: 'unknown write effect' }], isError: false })
    return reply(request.id, null, { code: -32602, message: `Unknown tool: ${name}` })
  } catch (error) {
    reply(request.id, null, { code: -32000, message: error instanceof Error ? error.message : String(error) })
  }
})
