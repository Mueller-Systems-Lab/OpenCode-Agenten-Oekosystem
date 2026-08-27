import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const manifest = JSON.parse(fs.readFileSync(path.join(root, "ecosystem.manifest.json"), "utf8"))
const agentsDir = path.join(root, ".opencode", "agents")

function frontmatterValue(text, key) {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(text.replace(/\r\n/g, "\n"))
  return match ? match[1].trim() : ""
}

function releaseCommit() {
  try {
    return execFileSync("git", ["rev-list", "-n", "1", `v${manifest.version}`], { cwd: root, encoding: "utf8" }).trim()
  } catch {
    return process.env.OCAE_RELEASE_COMMIT?.trim() || "UNRELEASED"
  }
}

const agents = fs.readdirSync(agentsDir)
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => {
    const id = name.slice(0, -3)
    const source = fs.readFileSync(path.join(agentsDir, name), "utf8")
    const mode = frontmatterValue(source, "mode")
    const profile = manifest.catalogs?.agents?.profiles?.[id]
    if (!profile) throw new Error(`Missing capability profile for installable agent: ${id}`)
    return {
      id,
      mode,
      description: frontmatterValue(source, "description"),
    }
  })

const primary = agents.filter((agent) => agent.mode === "primary")
if (primary.length !== 1) throw new Error(`Expected exactly one primary agent, found ${primary.length}`)

const data = {
  version: String(manifest.version),
  tag: `v${manifest.version}`,
  releaseCommit: releaseCommit(),
  sourceRepository: "https://github.com/Mueller-Systems-Lab/OpenCode-Agenten-Oekosystem",
  installCommand: `uv tool install ocae-cli --from git+https://github.com/Mueller-Systems-Lab/OpenCode-Agenten-Oekosystem.git@v${manifest.version}`,
  primaryAgent: primary[0].id,
  agentCount: agents.length,
  capabilityProfileCount: agents.length,
  agents,
}

const output = path.join(root, "docs", "release-data.json")
fs.writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`, "utf8")

const landingPath = path.join(root, "docs", "index.html")
if (fs.existsSync(landingPath)) {
  const html = fs.readFileSync(landingPath, "utf8")
  const start = html.indexOf("<!-- BEGIN GENERATED AGENT INVENTORY -->")
  const end = html.indexOf("<!-- END GENERATED AGENT INVENTORY -->")
  if (start !== -1 && end > start) {
    const list = agents.map((agent) => `          <li><code>${agent.id}</code><span>${agent.mode === "primary" ? "Primary agent" : "Subagent"}</span></li>`).join("\n")
    const replacement = `<!-- BEGIN GENERATED AGENT INVENTORY -->\n        <ul class="agent-list">\n${list}\n        </ul>\n        <!-- END GENERATED AGENT INVENTORY -->`
    const next = `${html.slice(0, start)}${replacement}${html.slice(end + "<!-- END GENERATED AGENT INVENTORY -->".length)}`
    fs.writeFileSync(landingPath, next, "utf8")
  }
}

console.log(`Generated ${output} from ${agents.length} installable agents.`)
