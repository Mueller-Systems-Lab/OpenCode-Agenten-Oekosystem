#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2))

async function main(args) {
  const useStdin = args.includes("--paths-stdin")
  const failOnApplicable = args.includes("--fail-on-applicable")
  const base = valueAfter(args, "--base")
  const head = valueAfter(args, "--head")

  let changedPaths
  if (useStdin) {
    changedPaths = readPaths(await readStdin())
  } else {
    if (!base || !head) failUsage("Provide --base <sha> and --head <sha>, or --paths-stdin")
    const diff = spawnSync("git", ["diff", "--name-only", "--no-renames", `${base}...${head}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    if (diff.error || diff.status !== 0) {
      process.stderr.write(diff.stderr || `VISUAL_QA_DIFF_ERROR: ${diff.error?.message || "git diff failed"}\n`)
      process.exit(2)
    }
    changedPaths = readPaths(diff.stdout)
  }

  const result = classifyVisualPaths(changedPaths)
  process.stdout.write(renderClassification(result))

  if (result.applicable && failOnApplicable) {
    console.error("NEEDS_REVIEW_VISUAL_QA: visual artifacts changed but no repository-owned visual validation runtime is configured")
    process.exit(3)
  }
}

export function classifyVisualPaths(paths) {
  const changedPaths = [...new Set(paths.map((entry) => entry.trim()).filter(Boolean))]
  const visualPaths = changedPaths.filter(isVisualPath)
  return { changedPaths, visualPaths, applicable: visualPaths.length > 0 }
}

export function renderClassification({ changedPaths, visualPaths, applicable }) {
  return [
    `CHECK_RESULT: ${applicable ? "APPLICABLE" : "NOT_APPLICABLE"}`,
    `REASON: ${applicable ? "Visual or frontend artifacts changed" : "No visual or frontend artifacts changed"}`,
    `EVALUATED_PATHS: ${changedPaths.length ? changedPaths.join(", ") : "(none)"}`,
    `VISUAL_PATHS: ${visualPaths.length ? visualPaths.join(", ") : "(none)"}`,
    "",
  ].join("\n")
}

export function isVisualPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/")
  if (/^(?:test\/fixtures|docs|artifacts)\//.test(normalized)) return false
  return (
    /^client\/src\//.test(normalized) ||
    /^src\/.*\.(?:css|scss|sass|less)$/.test(normalized) ||
    /\.(?:tsx|jsx|vue|svelte|astro)$/.test(normalized) ||
    /(?:^|\/)(?:playwright|storybook)(?:\.config)?\.[^/]+$/.test(normalized) ||
    /(?:^|\/)(?:screenshots?|visual-baselines?)\//.test(normalized)
  )
}

function readPaths(value) {
  return [...new Set(value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean))]
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1]
}

async function readStdin() {
  let value = ""
  for await (const chunk of process.stdin) value += chunk
  return value
}

function failUsage(message) {
  console.error(`VISUAL_QA_USAGE_ERROR: ${message}`)
  process.exit(2)
}
