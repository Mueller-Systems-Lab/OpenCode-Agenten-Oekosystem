#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import { argv, exit } from "node:process"
import fs from "node:fs"
import path from "node:path"
import { evaluateAction } from "../runtime/gates/evaluate-action.mjs"

const args = parseArgs(argv.slice(2))
if (args.help) {
  console.log(`evaluate.mjs — Governance V2 effect evaluation

Usage:
  node .agent-governance/bin/evaluate.mjs --target <path> --tool <tool> [options]

Exit Codes:
  0  VERIFIED_IN_SCOPE
  1  NEEDS_REVIEW
  2  RED_BLOCK`)
  exit(0)
}
if (!args.target) fail("--target is required")

const targetRoot = path.resolve(args.target)
if (!fs.existsSync(targetRoot)) fail(`Target directory does not exist: ${targetRoot}`)
const governanceRoot = path.join(targetRoot, ".agent-governance")
const readJson = (name) => {
  try { return JSON.parse(fs.readFileSync(path.join(governanceRoot, name), "utf8")) } catch { return null }
}
const action = args.action || (args.command ? null : "read")
const tool = args.tool || (args.command ? "bash" : action)
const resource = args.writePaths?.[0] || args.resource || action || tool

try {
  const result = await evaluateAction({
    targetRoot,
    runtime: args.runtime || "cli",
    tool,
    action,
    command: args.command || null,
    resource,
    capsule: readJson("task-capsule.json"),
    intent: readJson("owner-intent.json"),
    auditPath: path.join(governanceRoot, "evidence", "action-audit.jsonl"),
  })
  const classification = result.allowed ? "VERIFIED_IN_SCOPE" : result.requires_owner ? "NEEDS_REVIEW" : "RED_BLOCK"
  const output = { ...result, classification }
  if (args.json) console.log(JSON.stringify(output, null, 2))
  else {
    console.log(`Classification: ${classification}`)
    console.log(`Decision: ${result.decision_class}`)
    console.log(`Code: ${result.code}`)
    console.log(`Allowed: ${result.allowed}`)
  }
  exit(result.allowed ? 0 : result.requires_owner ? 1 : 2)
} catch (error) {
  fail(error.code === "ERR_MODULE_NOT_FOUND" ? "Governance V2 runtime is missing or incomplete" : error.message)
}

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index]
    if (arg === "--help" || arg === "-h") result.help = true
    else if (arg === "--target") result.target = values[++index]
    else if (arg === "--runtime") result.runtime = values[++index]
    else if (arg === "--action") result.action = values[++index]
    else if (arg === "--tool") result.tool = values[++index]
    else if (arg === "--command") result.command = values[++index]
    else if (arg === "--resource") result.resource = values[++index]
    else if (arg === "--write-path") (result.writePaths ||= []).push(values[++index])
    else if (arg === "--json") result.json = true
    else fail(`Unknown argument: ${arg}`)
  }
  return result
}

function fail(message) {
  console.error(`RED_BLOCK: ${message}`)
  exit(2)
}
