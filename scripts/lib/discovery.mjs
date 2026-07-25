import fs from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { normalizePosix, pathExists, readTextIfExists } from "./paths.mjs"

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".opencode/reports",
  ".opencode/backups",
  ".opencode/memory",
])

const IGNORE_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
])

function addSignal(bucket, id, filePath, notes = []) {
  const existing = bucket.get(id)
  if (existing) {
    existing.paths.add(filePath)
    for (const note of notes) existing.notes.add(note)
    return
  }
  bucket.set(id, {
    id,
    paths: new Set([filePath]),
    notes: new Set(notes),
  })
}

async function walk(root, dir = root, depth = 0, maxDepth = 4, files = []) {
  if (depth > maxDepth) return files
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name)
    const relative = normalizePosix(path.relative(root, absolute))
    if (IGNORE_DIRS.has(relative) || [...IGNORE_DIRS].some((prefix) => relative.startsWith(`${prefix}/`))) {
      continue
    }
    if (entry.isDirectory()) {
      if (IGNORE_DIR_NAMES.has(entry.name)) continue
      await walk(root, absolute, depth + 1, maxDepth, files)
    } else {
      files.push(relative)
    }
  }
  return files
}

function detectPackageManager(files) {
  if (files.includes("pnpm-lock.yaml") || files.includes("pnpm-workspace.yaml")) return "pnpm"
  if (files.includes("yarn.lock")) return "yarn"
  if (files.includes("bun.lock") || files.includes("bun.lockb")) return "bun"
  if (files.includes("package-lock.json")) return "npm"
  if (files.includes("poetry.lock") || files.includes("pyproject.toml")) return "python"
  if (files.includes("Cargo.lock")) return "cargo"
  return null
}

function detectFrameworks(files, contentIndex) {
  const frameworks = new Set()
  const packageJson = contentIndex.get("package.json")

  if (packageJson) {
    const deps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    }
    const has = (name) => Boolean(deps?.[name])
    if (has("react") || has("react-dom")) frameworks.add("react")
    if (has("next")) frameworks.add("next")
    if (has("vue")) frameworks.add("vue")
    if (has("svelte")) frameworks.add("svelte")
    if (has("astro")) frameworks.add("astro")
    if (has("vite")) frameworks.add("vite")
    if (has("vitest")) frameworks.add("vitest")
    if (has("playwright")) frameworks.add("playwright")
    if (has("jest")) frameworks.add("jest")
    if (has("eslint")) frameworks.add("eslint")
    if (has("prettier")) frameworks.add("prettier")
  }

  const pyproject = contentIndex.get("pyproject.toml")
  if (pyproject) {
    if (/\bpytest\b/i.test(pyproject.raw)) frameworks.add("pytest")
    if (/\bfastapi\b/i.test(pyproject.raw)) frameworks.add("fastapi")
    if (/\bdjango\b/i.test(pyproject.raw)) frameworks.add("django")
    if (/\bflask\b/i.test(pyproject.raw)) frameworks.add("flask")
    if (/\bruff\b/i.test(pyproject.raw)) frameworks.add("ruff")
    if (/\bblack\b/i.test(pyproject.raw)) frameworks.add("black")
  }

  if (files.some((file) => /playwright\.config\./i.test(file))) {
    frameworks.add("playwright")
  }

  if (files.some((file) => /vite\.config\./i.test(file))) {
    frameworks.add("vite")
  }

  return [...frameworks]
}

function detectLanguage(files, contentIndex) {
  if (files.includes("package.json")) return "javascript/typescript"
  if (files.includes("pyproject.toml") || files.some((file) => file.endsWith(".py"))) return "python"
  if (files.includes("Cargo.toml")) return "rust"
  if (files.includes("go.mod")) return "go"
  if (files.includes("composer.json")) return "php"
  if (files.includes("pom.xml") || files.includes("build.gradle") || files.includes("build.gradle.kts")) return "jvm"
  if (files.includes("Dockerfile")) return "docker"
  if (files.some((file) => file.endsWith(".md"))) return "markdown"
  return "unknown"
}

function detectDatabases(files, contentIndex) {
  const databases = new Set()
  if (files.some((file) => /\.sqlite3?$|\.db$|\.sqlite$/i.test(file))) databases.add("sqlite")
  if (files.some((file) => /postgres|psql|pg_dump|postgresql/i.test(file))) databases.add("postgresql")
  if (contentIndex.get("docker-compose.yml")?.raw?.toLowerCase().includes("postgres")) databases.add("postgresql")
  if (contentIndex.get("docker-compose.yaml")?.raw?.toLowerCase().includes("postgres")) databases.add("postgresql")
  if (contentIndex.get("README.md")?.raw?.toLowerCase().includes("sqlite")) databases.add("sqlite")
  return [...databases]
}

function detectTestFrameworks(files, contentIndex) {
  const tests = new Set()
  const packageJson = contentIndex.get("package.json")
  if (packageJson) {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies }
    const has = (name) => Boolean(deps?.[name])
    if (has("vitest")) tests.add("vitest")
    if (has("jest")) tests.add("jest")
    if (has("@playwright/test")) tests.add("playwright")
    if (has("mocha")) tests.add("mocha")
    if (has("ava")) tests.add("ava")
  }

  if (contentIndex.get("pyproject.toml")) {
    const raw = contentIndex.get("pyproject.toml").raw
    if (/\bpytest\b/i.test(raw)) tests.add("pytest")
  }

  if (files.some((file) => /playwright\.config\./i.test(file))) tests.add("playwright")
  if (files.some((file) => /jest\./i.test(file) || /\.spec\./i.test(file))) tests.add("javascript-tests")
  return [...tests]
}

function detectMonorepo(files) {
  return Boolean(
    files.includes("pnpm-workspace.yaml") ||
      files.includes("turbo.json") ||
      files.includes("nx.json") ||
      files.includes("lerna.json") ||
      files.some((file) => file.startsWith("packages/")) ||
      files.some((file) => file.startsWith("apps/")),
  )
}

function detectGitRemote(root) {
  const result = spawnSync("git", ["-C", root, "remote", "-v"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

  if (result.status !== 0 || !result.stdout) {
    return { remoteUrl: null, remoteName: null }
  }

  const fetchLine = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.endsWith("(fetch)"))

  if (!fetchLine) {
    return { remoteUrl: null, remoteName: null }
  }

  const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(fetchLine)
  if (!match) {
    return { remoteUrl: null, remoteName: null }
  }

  return {
    remoteName: match[1],
    remoteUrl: match[2],
  }
}

function detectSignals(files, contentIndex) {
  const signals = new Map()

  const add = (id, filePath, notes = []) => addSignal(signals, id, filePath, notes)

  for (const file of files) {
    if (file === "package.json") add("package-json", file)
    if (file === "pyproject.toml") add("pyproject", file)
    if (file === "requirements.txt") add("requirements", file)
    if (file === "Cargo.toml") add("cargo", file)
    if (file === "go.mod") add("go-mod", file)
    if (file === "composer.json") add("composer", file)
    if (file === "pom.xml") add("pom", file)
    if (file === "build.gradle" || file === "build.gradle.kts") add("gradle", file)
    if (/playwright\.config\./i.test(file)) add("playwright-config", file)
    if (/vite\.config\./i.test(file)) add("vite-config", file)
    if (/Dockerfile/i.test(file) || /docker-compose/i.test(file)) add("docker", file)
    if (/\.(sqlite3?|db)$/i.test(file)) add("sqlite-file", file)
    if (file === "AGENTS.md") add("agents-md", file)
    if (file === "opencode.json" || file === "opencode.jsonc") add("opencode-config", file)
    if (file === ".hermes.md" || file.startsWith(".hermes/")) add("hermes-config", file)
    if (file.startsWith(".github/workflows/")) add("github-actions", file)
    if (file.startsWith(".opencode/skills/")) add("opencode-skills", file)
    if (file.startsWith(".opencode/agents/")) add("opencode-agents", file)
    if (file.startsWith(".opencode/policies/")) add("opencode-policies", file)
  }

  const readme = files.includes("README.md") ? (contentIndex.get("README.md")?.raw?.toLowerCase() || "") : ""
  const combined = [
    readme,
    files.includes("AGENTS.md") ? (contentIndex.get("AGENTS.md")?.raw?.toLowerCase() || "") : "",
    files.includes("SECURITY.md") ? (contentIndex.get("SECURITY.md")?.raw?.toLowerCase() || "") : "",
    files.includes("CONTRIBUTING.md") ? (contentIndex.get("CONTRIBUTING.md")?.raw?.toLowerCase() || "") : "",
    files.includes("package.json") ? (contentIndex.get("package.json")?.raw?.toLowerCase() || "") : "",
    files.includes("pyproject.toml") ? (contentIndex.get("pyproject.toml")?.raw?.toLowerCase() || "") : "",
  ].join("\n")

  const piiTerms = ["consent", "adopter", "donor", "volunteer", "medical", "birth_date", "address", "phone", "email", "privacy", "dsgvo", "gdpr"]
  for (const term of piiTerms) {
    if (combined.includes(term)) add("pii-signals", "README.md", [`matched:${term}`])
  }

  const shelterTerms = ["tierheim", "civipet", "animal", "adoption", "foster", "vet"]
  for (const term of shelterTerms) {
    if (combined.includes(term)) add("tierheim-signals", "README.md", [`matched:${term}`])
  }

  if (combined.includes("offline") || combined.includes("local-only") || combined.includes("air-gapped")) {
    add("offline-only", "README.md")
  }

  if (files.some((file) => file.startsWith(".github/workflows/"))) {
    add("github-actions", ".github/workflows")
  }

  return [...signals.values()].map((entry) => ({
    id: entry.id,
    paths: [...entry.paths],
    notes: [...entry.notes],
  }))
}

async function readStructuredContent(root, filePath, contentIndex) {
  const absolute = path.join(root, filePath)
  const stat = await fs.stat(absolute)
  if (stat.size > 128 * 1024) return
  const raw = await fs.readFile(absolute, "utf8")
  const entry = { raw }
  if (filePath === "package.json") {
    try {
      Object.assign(entry, JSON.parse(raw))
    } catch {
      entry.invalid = true
    }
  }
  contentIndex.set(filePath, entry)
}

async function buildContentIndex(root, files) {
  const contentIndex = new Map()
  const candidates = [
    "README.md",
    "AGENTS.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "docker-compose.yml",
    "docker-compose.yaml",
    "opencode.json",
    "opencode.jsonc",
  ]
  for (const file of files) {
    if (candidates.includes(file) || /playwright\.config\./i.test(file) || /vite\.config\./i.test(file) || file.endsWith(".toml")) {
      try {
        await readStructuredContent(root, file, contentIndex)
      } catch {
        // Ignore unreadable or absent files during discovery.
      }
    }
  }
  return contentIndex
}

export async function discoverProject(targetRoot) {
  const root = path.resolve(targetRoot)
  const files = await walk(root)
  const bootstrapManaged = files.includes(".opencode/reports/bootstrap/discovery.json") || files.includes("docs/reports/universal-bootstrap-run-report.md")
  const analysisFiles = bootstrapManaged ? files.filter((file) => !isBootstrapScaffold(file)) : files
  const contentIndex = await buildContentIndex(root, files)
  const gitRemote = detectGitRemote(root)

  const language = detectLanguage(analysisFiles, contentIndex)
  const packageManager = detectPackageManager(analysisFiles)
  const frameworks = detectFrameworks(analysisFiles, contentIndex)
  const testFrameworks = detectTestFrameworks(analysisFiles, contentIndex)
  const databases = detectDatabases(analysisFiles, contentIndex)
  const monorepo = detectMonorepo(analysisFiles)
  const signals = detectSignals(analysisFiles, contentIndex)

  const existing = {
    agents: analysisFiles.includes("AGENTS.md"),
    opencode: analysisFiles.includes("opencode.json") || analysisFiles.includes("opencode.jsonc") || analysisFiles.some((file) => file.startsWith(".opencode/")),
    hermes: analysisFiles.includes(".hermes.md") || analysisFiles.some((file) => file.startsWith(".hermes/")) || analysisFiles.some((file) => file.startsWith("hermes/")),
    ci_files: analysisFiles.filter((file) => file.startsWith(".github/workflows/")),
    github_remote: Boolean(gitRemote.remoteUrl && /github\.com/i.test(gitRemote.remoteUrl)),
    github_remote_url: gitRemote.remoteUrl,
  }

  const notes = []
  if (existing.opencode) notes.push("Existing OpenCode configuration detected.")
  if (existing.hermes) notes.push("Existing Hermes artifacts detected.")
  if (existing.agents) notes.push("Existing AGENTS.md detected.")
  if (monorepo) notes.push("Monorepo layout detected.")
  if (frameworks.includes("playwright")) notes.push("Playwright-style project detected.")
  if (databases.length > 0) notes.push(`Database signals detected: ${databases.join(", ")}.`)
  if (signals.some((signal) => signal.id === "tierheim-signals")) notes.push("Tierheim/CiviPet compliance should remain conditional.")
  if (signals.some((signal) => signal.id === "github-actions")) notes.push("Remote CI files exist or are requested in the project.")
  if (bootstrapManaged) notes.push("Bootstrap-managed artifacts detected; generated scaffolding is ignored for re-runs.")
  if (existing.github_remote) notes.push(`GitHub remote detected via ${gitRemote.remoteName || "origin"}${gitRemote.remoteUrl ? ` (${gitRemote.remoteUrl})` : ""}.`)

  const classification = existing.opencode || existing.hermes || existing.agents ? "AMBER_REVIEW" : "GREEN_SAFE"

  return {
    target_root: root,
    classification,
    files,
    analysis_files: analysisFiles,
    bootstrap_managed: bootstrapManaged,
    signals,
    existing,
    language,
    package_manager: packageManager,
    frameworks,
    test_frameworks: testFrameworks,
    databases,
    monorepo,
    github_remote: existing.github_remote,
    github_remote_url: existing.github_remote_url,
    notes,
    content_index: contentIndex,
  }
}

function isBootstrapScaffold(file) {
  return (
    file.startsWith(".opencode/") ||
    file.startsWith(".hermes/") ||
    file.startsWith(".github/workflows/") ||
    file.startsWith("docs/reports/") ||
    file === "AGENTS.md" ||
    file === "CONTRIBUTING.md" ||
    file === "SECURITY.md" ||
    file === "BOOTSTRAP.md" ||
    file === "README.md" ||
    file === "ecosystem.manifest.json"
  )
}
