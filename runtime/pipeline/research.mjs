// SPDX-License-Identifier: MIT
/**
 * Deterministic research phase.
 *
 * Research perspectives (code / docs / tests) are jobs over the repository,
 * not permanent agents. Findings are real and repository-derived; nothing is
 * invented just to fill the contract.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { create as createResearch } from '../contracts/research.mjs'

export async function runResearch({ run_id, repoRoot, depth = 2 } = {}) {
  const code = []
  const docs = []
  const tests = []

  async function walk(directory, level) {
    if (level > depth) return
    let entries
    try { entries = await fs.readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute, level + 1)
      } else if (entry.isFile()) {
        const relative = path.relative(repoRoot, absolute).replaceAll('\\', '/')
        if (/\.test\.(mjs|cjs|js|ts|py)$/.test(entry.name)) tests.push(relative)
        else if (/\.(mjs|cjs|js|ts|tsx|py|go|rs)$/.test(entry.name)) code.push(relative)
        else if (/\.(md|mdx|rst|txt|json|yaml|yml|toml)$/.test(entry.name)) docs.push(relative)
      }
    }
  }

  if (repoRoot) await walk(repoRoot, 0)

  return createResearch({
    run_id,
    research: [
      { focus: 'code', findings: code.slice(0, 200) },
      { focus: 'docs', findings: docs.slice(0, 200) },
      { focus: 'tests', findings: tests.slice(0, 200) },
    ],
  })
}
