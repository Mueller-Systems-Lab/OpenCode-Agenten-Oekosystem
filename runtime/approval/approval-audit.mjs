// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises'
import path from 'node:path'

const SECRET_KEY = /(token|secret|password|api[_-]?key|credential|authorization)/i

function redact(value) {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : redact(item)]))
  return typeof value === 'string' && SECRET_KEY.test(value) ? '[REDACTED]' : value
}

export class ApprovalAuditLog {
  constructor(filePath) {
    this.filePath = path.resolve(filePath)
  }

  async append(event) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true })
    await fs.appendFile(this.filePath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...redact(event) })}\n`, { mode: 0o600 })
  }

  async read() {
    try {
      const text = await fs.readFile(this.filePath, 'utf8')
      return text.trim() ? text.trim().split('\n').map((line) => JSON.parse(line)) : []
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }
}

