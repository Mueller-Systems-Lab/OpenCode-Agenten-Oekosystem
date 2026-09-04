import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { repoRoot } from '../helpers.mjs'

test('Issue #43 causal runner is frozen for a distinct GLM-5.3 identity', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'scripts', 'run-issue-43-causal-factor-experiment.mjs'), 'utf8')
  assert.match(source, /const provider = 'zai-coding-plan'/u)
  assert.match(source, /const model = 'glm-5\.3'/u)
  assert.match(source, /issue-43-glm53-causal-factor-isolation-/u)
  assert.doesNotMatch(source, /issue-43-causal-factor-isolation-20260903T215623Z/u)
  assert.match(source, /const repetitions = 4/u)
  assert.match(source, /const contractRepetitions = 4/u)
  assert.match(source, /model_switch_used: false/u)
})
