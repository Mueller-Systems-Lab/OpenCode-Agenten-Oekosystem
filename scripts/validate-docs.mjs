import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const failures = []

function read(relative) {
  const file = path.join(root, relative)
  if (!fs.existsSync(file)) {
    failures.push(`${relative}: file is missing`)
    return ""
  }
  return fs.readFileSync(file, "utf8")
}

function fail(message) { failures.push(message) }
function assert(condition, message) { if (!condition) fail(message) }
function resolveLocal(source, target) {
  const clean = target.split("#", 1)[0].split("?", 1)[0]
  return path.resolve(path.dirname(path.join(root, source)), clean)
}
function checkLinks(source, text) {
  const markdown = /\[[^\]]+\]\(([^)]+)\)/g
  const html = /\bhref=["']([^"']+)["']/g
  for (const match of [...text.matchAll(markdown), ...text.matchAll(html)]) {
    const target = match[1].trim()
    if (!target || target.startsWith("#") || /^(https?:|mailto:|javascript:)/i.test(target)) continue
    const resolved = resolveLocal(source, target)
    assert(fs.existsSync(resolved), `${source}: broken local link ${target}`)
  }
}

const manifest = JSON.parse(read("ecosystem.manifest.json"))
const cliVersion = /__version__\s*=\s*["']([^"']+)["']/.exec(read("src/ocae_cli/_version.py"))?.[1]
const releaseData = JSON.parse(read("docs/release-data.json"))
const agentFiles = fs.existsSync(path.join(root, ".opencode/agents"))
  ? fs.readdirSync(path.join(root, ".opencode/agents")).filter((name) => name.endsWith(".md")).sort()
  : []
const agentIds = agentFiles.map((name) => name.slice(0, -3))
const primaryAgents = agentFiles.filter((name) => /(^|\n)mode:\s*primary\s*(\n|$)/.test(read(path.join(".opencode/agents", name).replaceAll("\\", "/"))))

assert(String(manifest.version) === cliVersion, `manifest/CLI version drift: ${manifest.version} vs ${cliVersion}`)
assert(releaseData.version === String(manifest.version), "release data version does not match ecosystem manifest")
assert(releaseData.tag === `v${manifest.version}`, "release data tag does not match manifest version")
assert(/^[0-9a-f]{40}$/.test(releaseData.releaseCommit), "release data must contain the exact stable release commit")
assert(releaseData.installCommand === `uv tool install ocae-cli --from git+https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem.git@v${manifest.version}`, "release data install command is stale")
assert(releaseData.agentCount === agentIds.length, `release data agent count ${releaseData.agentCount} does not match ${agentIds.length} source agents`)
assert(releaseData.capabilityProfileCount === agentIds.length, "capability profile count does not match installable agent count")
assert(JSON.stringify(releaseData.agents.map((agent) => agent.id)) === JSON.stringify(agentIds), "release data agent inventory drift")
assert(primaryAgents.length === 1 && releaseData.primaryAgent === primaryAgents[0].slice(0, -3), "primary agent inventory drift")

const readme = read("README.md")
const aiInstall = read("AI-INSTALL.md")
const aiBootstrap = read("AI-BOOTSTRAP.md")
const bootstrap = read("BOOTSTRAP.md")
const cliDoc = read("docs/ocae-cli.md")
const landing = read("docs/index.html")
const siteJs = read("docs/assets/site.js")
const siteCss = read("docs/assets/site.css")
const activeDocs = { "README.md": readme, "AI-INSTALL.md": aiInstall, "AI-BOOTSTRAP.md": aiBootstrap, "BOOTSTRAP.md": bootstrap, "docs/ocae-cli.md": cliDoc, "docs/index.html": landing }
const forbiddenInternalReference = new RegExp(`${["CT", "108"].join("")}|TTS`, "i")
const installCommand = `uv tool install ocae-cli --from git+https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem.git@v${cliVersion}`

assert(readme.startsWith("# OCAE"), "README does not start with the OCAE product hero")
assert(readme.includes(`OCAE CLI v${cliVersion}`), "README product version is missing or stale")
assert(readme.includes(installCommand), "README is missing the pinned CLI install command")
assert(readme.includes("ocae doctor .") && readme.includes("ocae install .") && readme.includes("ocae verify ."), "README quick start is incomplete")
assert(!/^>.*archiv/i.test(readme), "README still contains an archive banner")
assert(!/\b9\s+Agenten?\b|\b9\s+agents?\b/i.test(readme), "README contains a stale 9-agent claim")
assert(!/\b10\s+Skills?\b|\b10\s+skills?\b/i.test(readme), "README contains a stale 10-skill claim")
assert(!/hand an AI the repository URL/i.test(readme), "README still presents URL-only AI handoff as the primary path")
assert(landing.includes("OCAE CLI") && landing.includes("13 governed agents"), "landing page hero is incomplete")
assert(landing.includes(installCommand), "landing page is missing the pinned CLI install command")
for (const id of agentIds) assert(landing.includes(`>${id}<`), `landing page is missing agent ${id}`)
for (const id of ["quick-start", "agents", "governance", "how-it-works", "capabilities", "cli", "release", "requirements", "docs"]) assert(landing.includes(`id="${id}"`), `landing page is missing section #${id}`)
assert(/<!doctype html>/i.test(landing) && /<html[^>]+lang="en"/i.test(landing), "landing page lacks valid document shell")
assert(/<meta[^>]+name="viewport"/i.test(landing), "landing page lacks mobile viewport")
assert(/prefers-reduced-motion/.test(siteCss), "landing page lacks reduced-motion handling")
assert(/:focus-visible/.test(siteCss), "landing page lacks visible focus styling")
assert(/data-copy-target/.test(landing) && /addEventListener\("click"/.test(siteJs), "copy button is not wired for keyboard-capable interaction")
assert(!/<script[^>]+src=["']https?:/i.test(landing), "landing page loads an external script")
assert(!/\beval\s*\(|\.innerHTML\b|javascript:/i.test(`${landing}\n${siteJs}`), "landing page contains unsafe DOM execution pattern")
assert(!/http:\/\//i.test(`${landing}\n${siteCss}\n${siteJs}`), "landing page contains insecure HTTP asset/link")
assert(!/\b(?:pending|unknown)\b/i.test(landing.match(/<section id="release"[\s\S]*?<\/section>/i)?.[0] || ""), "release section contains unresolved metadata")
for (const match of landing.matchAll(/target="_blank"/g)) {
  const before = landing.slice(Math.max(0, match.index - 180), match.index + 120)
  assert(/rel="noopener noreferrer"/.test(before), "external blank link lacks noopener/noreferrer")
}

for (const [file, text] of Object.entries(activeDocs)) {
  assert(!/Dieses Repository ist archiviert|This repository is archived/i.test(text), `${file}: obsolete archive statement remains`)
  assert(!/\b9\s+Agenten?\b|\b9\s+agents?\b/i.test(text), `${file}: stale 9-agent claim remains`)
  assert(!/\b10\s+Skills?\b|\b10\s+skills?\b/i.test(text), `${file}: stale 10-skill claim remains`)
  assert(!forbiddenInternalReference.test(text), `${file}: internal gate or speech reference remains in active docs`)
  checkLinks(file, text)
}

if (failures.length) {
  console.error(`Documentation validation failed (${failures.length}):`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exitCode = 1
} else {
  console.log(`Documentation validation passed: v${releaseData.version}, ${releaseData.agentCount} installable agents, active links checked.`)
}
