#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import {
  EMPTY_USER_ACTION_MESSAGE,
  USER_ACTION_SECTION_TITLE,
  renderUserActionHandoff,
  validateCompletionMarkdown,
  validateUserActionHandoff,
} from "./lib/user-action-handoff.mjs"
import { safeRedactText, secretValuesFromEnv } from "./lib/security/redaction.mjs"

const args = parseArgs(process.argv.slice(2))

try {
  if (!args.input && !args.markdown) throw new Error("Mindestens --input oder --markdown ist erforderlich.")
  const findings = []
  let handoff = null
  if (args.input) {
    handoff = JSON.parse(await readRegularText(args.input, ".json", "--input"))
    findings.push(...validateUserActionHandoff(handoff))
  }
  if (args.markdown) {
    const markdown = await readRegularText(args.markdown, ".md", "--markdown")
    findings.push(...validateCompletionMarkdown(markdown))
    const terminalEmpty = `## ${USER_ACTION_SECTION_TITLE}\n\n${EMPTY_USER_ACTION_MESSAGE}`
    if (!handoff && !markdown.trimEnd().endsWith(terminalEmpty)) {
      findings.push({
        code: "CAPABILITY_EVIDENCE_REQUIRED",
        path: "markdown",
        message: "Markdown-Aktionen benötigen zusätzlich ein strukturiertes --input mit Capability-Evidence.",
      })
    }
    if (handoff && validateUserActionHandoff(handoff).length === 0
      && !markdown.trimEnd().endsWith(renderUserActionHandoff(handoff))) {
      findings.push({
        code: "HANDOFF_MARKDOWN_MISMATCH",
        path: "markdown",
        message: "Markdown-Abschlussabschnitt und strukturiertes Handoff stimmen nicht überein.",
      })
    }
  }
  const result = {
    classification: findings.length === 0 ? "VERIFIED_IN_SCOPE" : "RED_BLOCK",
    findings,
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (findings.length > 0) process.exitCode = 1
} catch (error) {
  const message = safeRedactText(error instanceof Error ? error.message : String(error), {
    secrets: secretValuesFromEnv(),
  })
  process.stderr.write(`USER_ACTION_HANDOFF_VALIDATION_ERROR: ${message}\n`)
  process.exitCode = 2
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!["--input", "--markdown"].includes(argument)) throw new Error(`Unbekanntes Argument: ${argument}`)
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) throw new Error(`Wert für ${argument} fehlt.`)
    parsed[argument.slice(2)] = value
    index += 1
  }
  return parsed
}

async function readRegularText(filePath, requiredExtension, label) {
  const absolute = path.resolve(filePath)
  const basename = path.basename(absolute).toLowerCase()
  if (basename === ".env" || basename.startsWith(".env.")) throw new Error(`${label} darf keine Umgebungsdatei lesen.`)
  if (path.extname(absolute).toLowerCase() !== requiredExtension) throw new Error(`${label} benötigt eine ${requiredExtension}-Datei.`)
  let stat
  try {
    stat = await fs.lstat(absolute)
  } catch {
    throw new Error(`${label}-Datei ist nicht lesbar.`)
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} muss eine reguläre Datei ohne Symlink sein.`)
  return fs.readFile(absolute, "utf8")
}
