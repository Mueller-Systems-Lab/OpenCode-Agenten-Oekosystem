#!/usr/bin/env node

import path from "node:path"
import { fileURLToPath } from "node:url"

import { runSecureBootstrapAi } from "../runtime/security/secure-bootstrap-ai.mjs"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const args = parseArgs(process.argv.slice(2))
if (!args.target || !args.sourceUrl || !args.prompt) {
  console.error("Usage: node scripts/run-secure-bootstrap-ai.mjs --target <project> --source-url <url> --prompt <text> [--model <provider/model>]")
  process.exit(2)
}

const result = await runSecureBootstrapAi({
  targetRoot: path.resolve(args.target),
  sourceRoot,
  sourceUrl: args.sourceUrl,
  prompt: args.prompt,
  model: args.model,
})
console.log(JSON.stringify(result))
process.exitCode = result.status === "VERIFIED_IN_SCOPE" ? 0 : result.status.startsWith("NEEDS_REVIEW") ? 1 : 2

function parseArgs(argv) {
  const result = {
    target: null,
    sourceUrl: null,
    prompt: null,
    model: "opencode/deepseek-v4-flash-free",
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--target") result.target = argv[++index]
    else if (arg === "--source-url") result.sourceUrl = argv[++index]
    else if (arg === "--prompt") result.prompt = argv[++index]
    else if (arg === "--model") result.model = argv[++index]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return result
}
