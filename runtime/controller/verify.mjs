// SPDX-License-Identifier: MIT
/**
 * Deterministic verification.
 *
 * Runs real tool checks (tests, type checking, lint, build, schema checks)
 * and normalizes failures into stable failure_signatures. An LLM claim such
 * as "looks correct" is never an accepted verification result here.
 */
import { spawnSync } from 'node:child_process'
import { create as createVerification } from '../contracts/verification.mjs'

export function normalizeFailureSignature({ tool = 'COMMAND', command = '', exit_code = null, stderr = '', stdout = '' } = {}) {
  const text = `${stderr || ''}\n${stdout || ''}`
  const stripDuration = (value) => value.trim().replace(/\s*\(\d+(?:\.\d+)?\s*(?:ms|s)\)\s*$/i, '').trim()
  const testFailure = text.match(/(?:^|\n)\s*(?:✖|not ok|FAIL)\s+([^\n]+)/i)
  if (testFailure) return `TEST_FAILURE:${stripDuration(testFailure[1])}`
  const typeError = text.match(/([A-Za-z0-9_./\\-]+\.(?:ts|mjs|js|cjs|tsx|jsx)):(\d+):(\d+)/)
  if (typeError) return `TYPE_ERROR:${typeError[1]}:${typeError[2]}`
  const missingExport = text.match(/missing (?:export|module) '?([A-Za-z0-9_./\\-]+)'?/i)
  if (missingExport) return `BUILD_FAILURE:missing_${missingExport[1]}`
  if (exit_code !== null && exit_code !== 0) return `${tool.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_EXIT:${exit_code}`
  return `UNKNOWN_FAILURE:${tool.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`
}

export function runCommandCheck({ command, args = [], cwd, timeout = 120000 } = {}) {
  const startedAt = Date.now()
  const env = { ...(process.env || {}) }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout, shell: false, maxBuffer: 4 * 1024 * 1024, env })
  const passed = !result.error && result.status === 0
  const signature = passed
    ? null
    : normalizeFailureSignature({
      tool: typeof command === 'string' ? command.split(/[\\/]/).pop() : 'command',
      command: [command, ...args].filter(Boolean).join(' '),
      exit_code: result.status,
      stderr: result.stderr || '',
      stdout: result.stdout || '',
    })
  return {
    passed,
    exit_code: result.status,
    error: result.error?.message || null,
    failure_signature: signature,
    duration_ms: Date.now() - startedAt,
    command: [command, ...args].filter(Boolean).join(' '),
  }
}

export function runVerification({ run_id, checks = [], strategy_delta = null } = {}) {
  const results = (checks || []).map((check) => runCommandCheck(check))
  const failed = results.find((result) => !result.passed) || null
  return createVerification({
    run_id,
    verification: {
      passed: !failed,
      failure_signature: failed?.failure_signature || null,
      strategy_delta: strategy_delta ?? null,
      checks: results.map(({ passed, exit_code, error, failure_signature, duration_ms, command }) => ({
        command,
        passed,
        exit_code,
        error,
        failure_signature,
        duration_ms,
      })),
    },
  })
}
