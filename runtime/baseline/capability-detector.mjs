// SPDX-License-Identifier: MIT
/**
 * Task-specific capability derivation.
 *
 * The preflight must never probe every installed capability. It derives the
 * capabilities this concrete run actually needs from the task text and the
 * approved plan, then only those are mandatory.
 */
const CAPABILITY_KEYWORDS = Object.freeze({
  repository: /repository|repo|checkout|clone|remote/,
  filesystem: /filesystem|file|directory|read|write|create|path/,
  shell: /shell|command|bash|powershell|pwsh|execute|run command/,
  git: /\bgit\b|commit|branch|merge|push|diff/,
  skills: /skill|agent skill/,
  policies: /policy|governance|evidence/,
  runtime: /runtime|opencode|hermes|node|npm/,
  provider: /provider|anthropic|openai|deepseek|lm\s*studio/,
  model: /\bmodel\b/,
  credentials: /credential|api\s*key|token|secret|password/,
  write: /write|create|edit|modify|implement|add|change/,
  test: /test|verify|assert|coverage/,
  build: /build|compile|typecheck|type-check|lint|schema/,
})

const ALWAYS_REQUIRED = Object.freeze(['repository', 'filesystem', 'runtime'])

export function deriveRequiredCapabilities({ task = '', plan = null } = {}) {
  const text = `${task || ''}\n${JSON.stringify(plan || {})}`
  const required = [...ALWAYS_REQUIRED]
  const add = (name) => { if (!required.includes(name)) required.push(name) }
  for (const [name, pattern] of Object.entries(CAPABILITY_KEYWORDS)) {
    if (pattern.test(text)) add(name)
  }
  if (plan?.build_scope?.files?.length) add('write')
  if (Array.isArray(plan?.required_tests) && plan.required_tests.length > 0) add('test')
  return required
}

export function deriveOptionalCapabilities({ task = '', plan = null } = {}) {
  const text = `${task || ''}\n${JSON.stringify(plan || {})}`
  const optional = []
  const add = (name) => { if (!optional.includes(name)) optional.push(name) }
  if (/github|issue|pull\s*request/i.test(text)) add('github')
  if (/credential|api\s*key|token|secret|password/i.test(text)) add('credentials')
  if (/\bmodel\b|provider/i.test(text)) add('model')
  return optional
}
