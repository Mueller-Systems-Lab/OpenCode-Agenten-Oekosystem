import fs from "node:fs/promises"
import path from "node:path"
import { ensureParentDirectory } from "./paths.mjs"
import { safeRedactText, safeSerialize, secretValuesFromEnv } from "./security/redaction.mjs"
import {
  createUserActionHandoff,
  renderUserActionHandoff,
} from "./user-action-handoff.mjs"

const REDACTION_OPTIONS = Object.freeze({ secrets: secretValuesFromEnv() })

function prettySafeJson(value) {
  const serialized = safeSerialize(value, REDACTION_OPTIONS)
  try {
    return JSON.stringify(JSON.parse(serialized), null, 2)
  } catch {
    return JSON.stringify("[REDACTED_UNSERIALIZABLE]", null, 2)
  }
}

export async function writeJsonReport(filePath, data) {
  await ensureParentDirectory(filePath)
  await fs.writeFile(filePath, `${prettySafeJson(data)}\n`, "utf8")
}

export async function writeMarkdownReport(filePath, markdown) {
  await ensureParentDirectory(filePath)
  await fs.writeFile(filePath, `${safeRedactText(markdown, REDACTION_OPTIONS).trimEnd()}\n`, "utf8")
}

export function renderKeyValueList(entries) {
  return entries.map(([key, value]) => `- **${key}:** ${value}`).join("\n")
}

export function renderDiscoveryMarkdown(discovery) {
  const lines = []
  lines.push(`# Discovery Report`)
  lines.push("")
  lines.push(`- Target: \`${discovery.target_root}\``)
  lines.push(`- Classification: \`${discovery.classification}\``)
  lines.push(`- Language: ${discovery.language || "unknown"}`)
  lines.push(`- Frameworks: ${discovery.frameworks.length ? discovery.frameworks.join(", ") : "none"}`)
  lines.push(`- Package manager: ${discovery.package_manager || "unknown"}`)
  lines.push(`- Test frameworks: ${discovery.test_frameworks.length ? discovery.test_frameworks.join(", ") : "none"}`)
  lines.push(`- Database signals: ${discovery.databases.length ? discovery.databases.join(", ") : "none"}`)
  lines.push(`- GitHub remote: ${discovery.existing.github_remote ? "yes" : "no"}`)
  if (discovery.existing.github_remote_url) {
    lines.push(`- Git remote URL: ${discovery.existing.github_remote_url}`)
  }
  lines.push("")
  lines.push("## Signals")
  lines.push("")
  for (const signal of discovery.signals) {
    lines.push(`- \`${signal.id}\` via ${signal.paths.join(", ")}`)
  }
  lines.push("")
  lines.push("## Existing Tooling")
  lines.push("")
  lines.push(`- OpenCode: ${discovery.existing.opencode ? "yes" : "no"}`)
  lines.push(`- Hermes: ${discovery.existing.hermes ? "yes" : "no"}`)
  lines.push(`- AGENTS.md: ${discovery.existing.agents ? "yes" : "no"}`)
  lines.push(`- CI workflows: ${discovery.existing.ci_files.length ? discovery.existing.ci_files.join(", ") : "none"}`)
  lines.push("")
  lines.push("## Notes")
  lines.push("")
  for (const note of discovery.notes) {
    lines.push(`- ${note}`)
  }
  return lines.join("\n")
}

export function renderPlanMarkdown(plan) {
  const lines = []
  lines.push(`# Bootstrap Plan`)
  lines.push("")
  lines.push(`- Classification: \`${plan.classification}\``)
  lines.push(`- Apply requested: ${plan.apply_requested ? "yes" : "no"}`)
  lines.push(`- Remote CI requested: ${plan.include_remote_ci ? "yes" : "no"}`)
  lines.push("")
  lines.push("## Files")
  lines.push("")
  for (const file of plan.files) {
    lines.push(`- \`${file.path}\` (${file.action})`)
  }
  lines.push("")
  lines.push("## Selected Skills")
  lines.push("")
  for (const skill of plan.skills) {
    lines.push(`- \`${skill}\``)
  }
  lines.push("")
  lines.push("## Selected MCPs")
  lines.push("")
  for (const mcp of plan.mcps) {
    lines.push(`- \`${mcp.name}\` (${mcp.tier}) - ${mcp.enabled ? "enabled" : "disabled"}`)
  }
  lines.push("")
  lines.push("## Backup")
  lines.push("")
  lines.push(`- Backup root: \`${plan.backup_root || "n/a"}\``)
  lines.push(`- Rollback command: \`${plan.rollback_command || "n/a"}\``)
  lines.push("")
  lines.push("## Conflicts")
  lines.push("")
  if (plan.conflicts.length === 0) {
    lines.push("- none")
  } else {
    for (const conflict of plan.conflicts) {
      lines.push(`- ${conflict}`)
    }
  }
  return lines.join("\n")
}

export function renderRunReportMarkdown(report) {
  const lines = []
  lines.push(`# Universal Bootstrap Run Report`)
  lines.push("")
  lines.push(`- Classification: \`${report.classification}\``)
  lines.push(`- Target: \`${report.target_root}\``)
  lines.push(`- Timestamp: ${report.timestamp}`)
  lines.push("")
  lines.push("## Summary")
  lines.push("")
  lines.push(report.summary)
  lines.push("")
  lines.push("## Changed Files")
  lines.push("")
  for (const file of report.changed_files) {
    lines.push(`- \`${file}\``)
  }
  lines.push("")
  lines.push("## Evidence")
  lines.push("")
  for (const line of report.evidence) {
    lines.push(`- ${line}`)
  }
  lines.push("")
  lines.push("## Uncertainties")
  lines.push("")
  for (const line of report.uncertainties) {
    lines.push(`- ${line}`)
  }
  lines.push("")
  lines.push(renderUserActionHandoff(report.user_action_handoff || createUserActionHandoff([])))
  return lines.join("\n")
}

export function joinReportPath(root, ...segments) {
  return path.join(root, ...segments)
}
