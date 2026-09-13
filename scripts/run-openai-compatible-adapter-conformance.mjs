#!/usr/bin/env node
// SPDX-License-Identifier: MIT
/** Deterministic model-transport interoperability gate; no provider call. */
import { runOpenAICompatibleAdapterConformance } from '../runtime/harness/openai-compatible-model-transport.mjs'

const result = await runOpenAICompatibleAdapterConformance()
console.log(JSON.stringify({ OPENAI_COMPATIBLE_ADAPTER_CONFORMANCE: result.status, checks: result.checks, fingerprint: result.fingerprint }, null, 2))
if (result.status !== 'PASS') process.exitCode = 1
