#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'generate-governance.mjs'), '--check'], { cwd: root, encoding: 'utf8' })
if (result.status !== 0) {
  process.stderr.write(result.stderr)
  process.exitCode = result.status || 2
} else {
  process.stdout.write('GOVERNANCE_DRIFT_CHECK_OK\n')
}
