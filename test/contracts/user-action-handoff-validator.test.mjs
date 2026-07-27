import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { runNodeScript } from "../helpers.mjs"
import { createUserActionHandoff } from "../../scripts/lib/user-action-handoff.mjs"

test("standalone validator accepts canonical JSON and terminal Markdown together", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-user-action-validator-"))
  try {
    const input = path.join(directory, "handoff.json")
    const markdown = path.join(directory, "report.md")
    await fs.writeFile(input, `${JSON.stringify(createUserActionHandoff([]), null, 2)}\n`, { mode: 0o600 })
    await fs.writeFile(markdown, "# Bericht\n\n## Erforderliche Aktion durch den Nutzer\n\nKeine Aktion durch den Nutzer erforderlich.\n", { mode: 0o600 })
    const result = runNodeScript("scripts/validate-user-action-handoff.mjs", ["--input", input, "--markdown", markdown])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).classification, "VERIFIED_IN_SCOPE")
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test("standalone validator fails closed for a missing final section", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-user-action-validator-"))
  try {
    const markdown = path.join(directory, "report.md")
    await fs.writeFile(markdown, "# Bericht\n\n## Status\n\nErledigt.\n", { mode: 0o600 })
    const result = runNodeScript("scripts/validate-user-action-handoff.mjs", ["--markdown", markdown])
    assert.equal(result.status, 1, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.classification, "RED_BLOCK")
    assert.ok(output.findings.some((finding) => finding.code === "SECTION_MISSING"))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test("standalone validator refuses environment files and symlink inputs", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-user-action-validator-"))
  try {
    const environmentFile = path.join(directory, ".env")
    const symlink = path.join(directory, "report.md")
    const report = path.join(directory, "source.md")
    await fs.writeFile(environmentFile, "IGNORED=value\n", { mode: 0o600 })
    await fs.writeFile(report, "# Bericht\n", { mode: 0o600 })
    await fs.symlink(report, symlink)
    const envResult = runNodeScript("scripts/validate-user-action-handoff.mjs", ["--markdown", environmentFile])
    assert.equal(envResult.status, 2)
    assert.match(envResult.stderr, /Umgebungsdatei/)
    const symlinkResult = runNodeScript("scripts/validate-user-action-handoff.mjs", ["--markdown", symlink])
    assert.equal(symlinkResult.status, 2)
    assert.match(symlinkResult.stderr, /ohne Symlink/)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test("standalone validator rejects action Markdown without structured capability evidence", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-user-action-validator-"))
  try {
    const markdown = path.join(directory, "report.md")
    await fs.writeFile(markdown, `# Bericht

## Erforderliche Aktion durch den Nutzer

### Pull Request zusammenführen

**Warum diese Aktion nicht durch das Agentensystem ausgeführt werden konnte:**
Eine persönliche Freigabe fehlt.

**Ziel:** Repository \`owner/repo\`, Pull Request \`#123\`

1. Führe \`gh pr merge 123\` aus.
`, { mode: 0o600 })
    const result = runNodeScript("scripts/validate-user-action-handoff.mjs", ["--markdown", markdown])
    assert.equal(result.status, 1)
    const codes = JSON.parse(result.stdout).findings.map((finding) => finding.code)
    assert.ok(codes.includes("GITHUB_CLI_ONLY"))
    assert.ok(codes.includes("CAPABILITY_EVIDENCE_REQUIRED"))
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
