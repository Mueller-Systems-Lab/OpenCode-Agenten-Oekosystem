#!/usr/bin/env node

import path from "node:path"
import fs from "node:fs"
import fsPromises from "node:fs/promises"
import crypto from "node:crypto"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import {
  ensureDirectory,
  ensureParentDirectory,
  pathExists,
  toAbsolutePath,
  relativePath,
  assertSafePath,
  readTextIfExists,
  writeText,
  fileHash,
  removeIfExists,
  isInsideRoot,
} from "./lib/paths.mjs"
import { createBackup, restoreBackup } from "./lib/backup.mjs"
import { safeRedactText, safeSerialize, secretValuesFromEnv } from "./lib/security/redaction.mjs"
import {
  CLASSIFICATIONS,
  classificationToExitCode,
} from "./lib/gates/classifications.mjs"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const REDACTION_OPTIONS = Object.freeze({ secrets: secretValuesFromEnv() })

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-")
}

function parseArgs(argv) {
  const result = {
    apply: false,
    json: false,
    runtime: "auto",
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      result.help = true
    } else if (arg === "--apply") {
      result.apply = true
    } else if (arg === "--json") {
      result.json = true
    } else if (arg === "--target") {
      result.target = argv[++i]
    } else if (arg === "--rollback") {
      result.rollback = argv[++i]
    } else if (arg === "--approval-file") {
      result.approvalFile = argv[++i]
    } else if (arg === "--runtime") {
      result.runtime = argv[++i]
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return result
}

function printHelp() {
  console.log(`Usage:
  node scripts/install-governance.mjs --target <project> [--apply] [--approval-file <path>] [--runtime <name>] [--json]
  node scripts/install-governance.mjs --target <project> --rollback <backup-dir>

Flags:
  --target <path>            Target project path (required)
  --apply                    Actually install (default: dry-run)
  --rollback <dir>           Rollback from backup directory
  --approval-file <path>     Approval receipt JSON file
  --runtime <name>           Force runtime detection (default: auto)
  --json                     Output machine-readable JSON
  --help                     Show this help

Exit codes: 0=GREEN_SAFE, 1=AMBER_REVIEW/TOOL_GAP, 2=RED_BLOCK
`)
}

async function getSourceCommit(repoRoot) {
  try {
    const sha = execSync("git rev-parse HEAD", {
      cwd: repoRoot,
      encoding: "utf-8",
      timeout: 10000,
    }).trim()
    if (!/^[a-f0-9]{40}$/.test(sha)) {
      return null
    }
    return sha
  } catch {
    return null
  }
}

async function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex")
}

async function sha256File(filePath) {
  const buf = await fsPromises.readFile(filePath)
  return `sha256:${crypto.createHash("sha256").update(buf).digest("hex")}`
}

function validateSourceRepository(repoRoot) {
  const required = [
    "scripts/lib/gates/evaluate-all.mjs",
    "scripts/lib/gates/kernel.mjs",
    "scripts/lib/gates/policy.mjs",
    "scripts/lib/gates/decision.mjs",
    "scripts/lib/gates/approval.mjs",
    "scripts/lib/gates/evidence.mjs",
    "scripts/lib/gates/classifications.mjs",
    "scripts/lib/gates/errors.mjs",
    "scripts/lib/gates/context-fingerprint.mjs",
    "scripts/lib/runtimes/contract.mjs",
    "scripts/lib/runtimes/generic.mjs",
    "scripts/lib/runtimes/opencode.mjs",
    "scripts/lib/runtimes/hermes.mjs",
    "scripts/lib/runtimes/odysseus.mjs",
  ]
  const missing = []
  for (const rel of required) {
    const abs = path.join(repoRoot, rel)
    if (!fs.existsSync(abs)) {
      missing.push(rel)
    }
  }
  return missing
}

function getRuntimeFileList() {
  // Preserve the gates/, runtimes/, and security/ subdirectory structure to keep
  // relative imports intact:
  //   - evaluate-all.mjs imports ../runtimes/*.mjs
  //   - runtimes/opencode.mjs imports ../security/redaction.mjs
  return [
    // gates/ directory — canonical gate evaluation modules
    { source: "scripts/lib/gates/evaluate-all.mjs", dest: "gates/evaluate-all.mjs" },
    { source: "scripts/lib/gates/kernel.mjs", dest: "gates/kernel.mjs" },
    { source: "scripts/lib/gates/policy.mjs", dest: "gates/policy.mjs" },
    { source: "scripts/lib/gates/decision.mjs", dest: "gates/decision.mjs" },
    { source: "scripts/lib/gates/approval.mjs", dest: "gates/approval.mjs" },
    { source: "scripts/lib/gates/evidence.mjs", dest: "gates/evidence.mjs" },
    { source: "scripts/lib/gates/classifications.mjs", dest: "gates/classifications.mjs" },
    { source: "scripts/lib/gates/errors.mjs", dest: "gates/errors.mjs" },
    { source: "scripts/lib/gates/context-fingerprint.mjs", dest: "gates/context-fingerprint.mjs" },
    // runtimes/ directory — runtime adapter modules
    { source: "scripts/lib/runtimes/contract.mjs", dest: "runtimes/contract.mjs" },
    { source: "scripts/lib/runtimes/generic.mjs", dest: "runtimes/generic.mjs" },
    { source: "scripts/lib/runtimes/opencode.mjs", dest: "runtimes/opencode.mjs" },
    { source: "scripts/lib/runtimes/hermes.mjs", dest: "runtimes/hermes.mjs" },
    { source: "scripts/lib/runtimes/odysseus.mjs", dest: "runtimes/odysseus.mjs" },
    // security/ directory — security/privacy adapter modules
    { source: "scripts/lib/security/redaction.mjs", dest: "security/redaction.mjs" },
  ]
}

function getPolicyFileList() {
  const policyDir = path.join(repoRoot, ".opencode", "policies")
  if (!fs.existsSync(policyDir)) return []
  const files = []
  try {
    const entries = fs.readdirSync(policyDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(entry.name)
      }
    }
  } catch {
    // unreadable
  }
  return files
}

async function detectRuntimes(targetRoot) {
  const results = []
  const adaptersDir = path.join(repoRoot, "scripts", "lib", "runtimes")

  for (const name of ["opencode", "hermes", "odysseus"]) {
    try {
      const adapterPath = path.join(adaptersDir, `${name}.mjs`)
      const adapter = await import(adapterPath)
      const detection = adapter.detect({ targetRoot })
      detection.name = name
      results.push(detection)
    } catch (e) {
      results.push({
        name,
        runtime: name,
        confidence: 0,
        confidenceLevel: "NOT_DETECTED",
        signals: [],
        message: `Detection failed: ${e.message}`,
      })
    }
  }

  return results.sort((a, b) => b.confidence - a.confidence)
}

function assessRiskTier(detectedRuntimes, targetRoot) {
  const isGitRepo = fs.existsSync(path.join(targetRoot, ".git"))
  const opencodeDetected = detectedRuntimes.some(
    (r) => r.name === "opencode" && r.confidence >= 50
  )
  const hermesDetected = detectedRuntimes.some(
    (r) => r.name === "hermes" && r.confidence >= 50
  )

  if (opencodeDetected || hermesDetected) {
    if (isGitRepo) return "MEDIUM_REVIEW"
    return "MEDIUM_REVIEW"
  }

  if (isGitRepo) return "LOW_LOCAL"
  return "LOW_LOCAL"
}

function determineEnforcementLevel(detectedRuntimes) {
  const opencode = detectedRuntimes.find(
    (r) => r.name === "opencode" && r.confidence >= 50
  )
  const hermes = detectedRuntimes.find(
    (r) => r.name === "hermes" && r.confidence >= 50
  )

  if (opencode || hermes) {
    const hasHookSupport = opencode && opencode.confidence >= 80
    return hasHookSupport ? "STRUCTURAL_HOOK_INSTALLED" : "POLICY_CONFIGURED"
  }

  return "ADVISORY_ONLY"
}

function buildFilePlan(targetRoot) {
  const governanceRoot = path.join(targetRoot, ".agent-governance")
  const files = []

  files.push({
    path: relativePath(targetRoot, governanceRoot),
    action: "create-directory",
  })

  files.push({
    path: relativePath(targetRoot, path.join(governanceRoot, "runtime")),
    action: "create-directory",
  })

  files.push({
    path: relativePath(targetRoot, path.join(governanceRoot, "policies")),
    action: "create-directory",
  })

  files.push({
    path: relativePath(targetRoot, path.join(governanceRoot, "bin")),
    action: "create-directory",
  })

  files.push({
    path: relativePath(targetRoot, path.join(governanceRoot, "approvals")),
    action: "create-directory",
  })

  files.push({
    path: relativePath(targetRoot, path.join(governanceRoot, "evidence")),
    action: "create-directory",
  })

  files.push({
    path: relativePath(targetRoot, path.join(governanceRoot, "state")),
    action: "create-directory",
  })

  const runtimeFiles = getRuntimeFileList()
  for (const rf of runtimeFiles) {
    files.push({
      path: relativePath(targetRoot, path.join(governanceRoot, "runtime", rf.dest)),
      action: "copy-runtime-file",
      source: path.join(repoRoot, rf.source),
    })
  }

  const policyFiles = getPolicyFileList()
  for (const pf of policyFiles) {
    files.push({
      path: relativePath(targetRoot, path.join(governanceRoot, "policies", pf)),
      action: "copy-policy-file",
      source: path.join(repoRoot, ".opencode", "policies", pf),
    })
  }

  files.push({
    path: relativePath(targetRoot, path.join(governanceRoot, "bin", "evaluate.mjs")),
    action: "copy-bin-file",
    source: path.join(repoRoot, ".agent-governance", "bin", "evaluate.mjs"),
  })

  files.push({
    path: relativePath(targetRoot, path.join(governanceRoot, "manifest.json")),
    action: "create-manifest",
  })

  files.push({
    path: relativePath(targetRoot, path.join(governanceRoot, "source-lock.json")),
    action: "create-source-lock",
  })

  const opencodeDetected = fs.existsSync(path.join(targetRoot, "opencode.jsonc")) ||
    fs.existsSync(path.join(targetRoot, "opencode.json"))
  if (opencodeDetected) {
    files.push({
      path: relativePath(targetRoot, path.join(governanceRoot, "hooks", "opencode")),
      action: "create-directory",
    })
    files.push({
      path: relativePath(targetRoot, path.join(governanceRoot, "hooks", "opencode", "pre-evaluate.mjs")),
      action: "create-hook-script",
    })
  }

  const hermesDetected = fs.existsSync(path.join(targetRoot, ".hermes.md")) ||
    fs.existsSync(path.join(targetRoot, ".hermes"))
  if (hermesDetected) {
    files.push({
      path: relativePath(targetRoot, path.join(targetRoot, ".hermes", "governance")),
      action: "create-directory",
    })
    files.push({
      path: relativePath(targetRoot, path.join(targetRoot, ".hermes", "governance", "evaluate.mjs")),
      action: "create-hermes-plugin",
    })
  }

  return files
}

async function findConflicts(targetRoot, filePlan) {
  const conflicts = []
  const governanceRoot = path.join(targetRoot, ".agent-governance")

  if (fs.existsSync(governanceRoot)) {
    conflicts.push(
      ".agent-governance/ directory already exists — existing installation will be checked for conservative merge"
    )
  }

  for (const file of filePlan) {
    if (file.action === "create-directory" || file.action === "create-hook-script") continue
    const destPath = path.join(targetRoot, file.path)
    if (fs.existsSync(destPath)) {
      if (file.action === "copy-runtime-file" || file.action === "copy-policy-file") {
        conflicts.push(`Existing file would be overwritten: ${file.path}`)
      } else if (file.action === "create-source-lock" || file.action === "create-manifest") {
        conflicts.push(`Existing file will be updated: ${file.path}`)
      }
    }
  }

  return conflicts
}

function classify(conflicts, sourceMissing, targetWritable, detectedRuntimes) {
  if (sourceMissing.length > 0) return "RED_BLOCK"
  if (!targetWritable) return "RED_BLOCK"
  if (conflicts.length > 0) return "AMBER_REVIEW"

  const hasStrongDetection = detectedRuntimes.some((r) => r.confidence >= 80)
  if (!hasStrongDetection && detectedRuntimes.every((r) => r.confidence < 50)) {
    return "AMBER_REVIEW"
  }

  return "GREEN_SAFE"
}

async function copyRuntimeFiles(repoRoot, targetRoot) {
  const governanceRoot = path.join(targetRoot, ".agent-governance")
  const runtimeDir = path.join(governanceRoot, "runtime")
  await ensureDirectory(runtimeDir)

  const runtimeFiles = getRuntimeFileList()
  for (const rf of runtimeFiles) {
    const sourcePath = path.join(repoRoot, rf.source)
    const destPath = path.join(runtimeDir, rf.dest)
    await assertSafePath(runtimeDir, destPath, "runtime destination")
    await ensureParentDirectory(destPath)
    fs.cpSync(sourcePath, destPath, { force: true })
  }
}

async function copyPolicies(repoRoot, targetRoot) {
  const governanceRoot = path.join(targetRoot, ".agent-governance")
  const policiesDir = path.join(governanceRoot, "policies")
  await ensureDirectory(policiesDir)

  const policyFiles = getPolicyFileList()
  for (const pf of policyFiles) {
    const sourcePath = path.join(repoRoot, ".opencode", "policies", pf)
    const destPath = path.join(policiesDir, pf)
    await assertSafePath(policiesDir, destPath, "policy destination")
    fs.cpSync(sourcePath, destPath, { force: true })
  }
}

async function generateSourceLock(repoRoot, targetRoot) {
  const governanceRoot = path.join(targetRoot, ".agent-governance")
  const sourceCommit = await getSourceCommit(repoRoot)
  const files = []

  const runtimeFiles = getRuntimeFileList()
  for (const rf of runtimeFiles) {
    const sourcePath = path.join(repoRoot, rf.source)
    try {
      const content = await fsPromises.readFile(sourcePath, 'utf8')
      const hash = `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`
      const stat = await fsPromises.stat(sourcePath)
      files.push({
        path: rf.dest,
        sha256: hash,
        size: stat.size,
      })
    } catch {
      files.push({
        path: rf.dest,
        sha256: "UNAVAILABLE",
        size: 0,
      })
    }
  }

  // Derive source repository URL from git remote (no hardcoded usernames)
  let sourceRepo = "UNKNOWN";
  try {
    const { execSync } = await import("node:child_process");
    const remoteUrl = execSync("git remote get-url origin", { cwd: repoRoot, encoding: "utf8", timeout: 5000 }).trim();
    // Strip .git suffix and normalize
    sourceRepo = remoteUrl.replace(/\.git$/, "").replace(/^git@github\.com:/, "https://github.com/");
  } catch {
    sourceRepo = "UNKNOWN";
  }

  const sourceLock = {
    schema_version: "1.0.0",
    source_repository: sourceRepo,
    source_commit: sourceCommit || "UNKNOWN",
    installed_at: new Date().toISOString(),
    enforcement_version: "1.0.0",
    files,
  }

  const destPath = path.join(governanceRoot, "source-lock.json")
  await assertSafePath(targetRoot, destPath, "source-lock destination")
  await fsPromises.writeFile(destPath, JSON.stringify(sourceLock, null, 2) + "\n", "utf8")
  return sourceLock
}

async function generateManifest(targetRoot, detectedRuntimes, enforcementLevel) {
  const governanceRoot = path.join(targetRoot, ".agent-governance")
  const installedRuntimes = []
  for (const r of detectedRuntimes) {
    if (r.confidence >= 50) {
      installedRuntimes.push(r.name)
    }
  }

  const manifest = {
    version: "1.0.0",
    name: "canonical-agent-governance",
    installed_runtimes: installedRuntimes,
    enforcement_level: enforcementLevel,
    kernel_gates: 19,
  }

  const sourceLockPath = path.join(governanceRoot, "source-lock.json")
  try {
    const sourceLockHash = await sha256File(sourceLockPath)
    manifest.source_lock = sourceLockHash
  } catch {
    manifest.source_lock = "PENDING"
  }

  const destPath = path.join(governanceRoot, "manifest.json")
  await assertSafePath(targetRoot, destPath, "manifest destination")
  await fsPromises.writeFile(destPath, JSON.stringify(manifest, null, 2) + "\n", "utf8")
  return manifest
}

async function createBinEvaluate(targetRoot, repoRoot) {
  const governanceRoot = path.join(targetRoot, ".agent-governance")
  const binDir = path.join(governanceRoot, "bin")
  await ensureDirectory(binDir)

  const sourcePath = path.join(repoRoot, ".agent-governance", "bin", "evaluate.mjs")
  const destPath = path.join(binDir, "evaluate.mjs")

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source bin/evaluate.mjs not found at: ${sourcePath}`)
  }

  await assertSafePath(binDir, destPath, "bin destination")
  fs.cpSync(sourcePath, destPath, { force: true })
  await fsPromises.chmod(destPath, 0o755)
}

async function installOpenCodeHook(targetRoot) {
  const governanceRoot = path.join(targetRoot, ".agent-governance")
  const hooksDir = path.join(governanceRoot, "hooks", "opencode")
  await ensureDirectory(hooksDir)

  const hookScript = `#!/usr/bin/env node
import { evaluateAllGates } from '../../runtime/gates/evaluate-all.mjs';

const targetRoot = process.argv[2] || process.cwd();
const action = process.argv[3] || 'evaluate';

const result = await evaluateAllGates({
  targetRoot,
  runtime: 'opencode',
  action,
  dryRun: false,
  riskTier: 'MEDIUM_REVIEW',
});

process.exit(result.exitCode || 0);
`

  const destPath = path.join(hooksDir, "pre-evaluate.mjs")
  await assertSafePath(targetRoot, destPath, "hook destination")
  await fsPromises.writeFile(destPath, hookScript, "utf8")
  await fsPromises.chmod(destPath, 0o755)

  const readme = `# OpenCode Governance Hook

This directory contains governance hook scripts for OpenCode.

## pre-evaluate.mjs

Called before OpenCode performs any action. Evaluates all gates (kernel, policy, runtime)
against the current context. If any gate returns RED_BLOCK, the action is denied.

### Usage

Can be invoked manually:

\`\`\`bash
node .agent-governance/hooks/opencode/pre-evaluate.mjs <target-root> <action>
\`\`\`

Or configured as an OpenCode pre-action hook in \`opencode.jsonc\`:

\`\`\`jsonc
{
  "hooks": {
    "pre_evaluate": {
      "command": "node .agent-governance/hooks/opencode/pre-evaluate.mjs",
      "args": ["<target-root>", "<action>"]
    }
  }
}
\`\`\`
`

  await fsPromises.writeFile(path.join(hooksDir, "README.md"), readme, "utf8")
}

async function installHermesFiles(targetRoot) {
  const hermesGovernanceDir = path.join(targetRoot, ".hermes", "governance")
  await ensureDirectory(hermesGovernanceDir)

  const pluginScript = `#!/usr/bin/env node
import { evaluateAllGates } from '../../.agent-governance/runtime/gates/evaluate-all.mjs';
import { argv, exit } from 'node:process';

const args = parseArgs(argv.slice(2));

const result = await evaluateAllGates({
  targetRoot: args.target || process.cwd(),
  runtime: 'hermes',
  action: args.action || 'evaluate',
  riskTier: args.riskTier || 'MEDIUM_REVIEW',
  dryRun: args.dryRun !== false,
});

if (args.json) {
    console.log(safeSerialize(result, REDACTION_OPTIONS));
} else {
  console.log(\`Classification: \${result.classification}\`);
  console.log(\`Allowed: \${result.allowed}\`);
}

exit(result.exitCode || 0);

function parseArgs(argv) {
  const result = { dryRun: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') result.target = argv[++i];
    else if (arg === '--action') result.action = argv[++i];
    else if (arg === '--risk-tier') result.riskTier = argv[++i];
    else if (arg === '--json') result.json = true;
  }
  return result;
}
`

  const destPath = path.join(hermesGovernanceDir, "evaluate.mjs")
  await assertSafePath(targetRoot, destPath, "hermes plugin destination")
  await fsPromises.writeFile(destPath, pluginScript, "utf8")
  await fsPromises.chmod(destPath, 0o755)

  const readme = `# Hermes Governance Plugin

This directory contains governance evaluation scripts for Hermes Agent.

## evaluate.mjs

Evaluates all gates (kernel, policy, runtime) against the current Hermes context.
Can be invoked:

\`\`\`bash
node .hermes/governance/evaluate.mjs --target <path> --action <action> --risk-tier <tier>
\`\`\`

## Integration

Load as a Hermes skill or call as a pre-action hook via the Hermes config:

\`\`\`yaml
hooks:
  pre_action:
    - command: node .hermes/governance/evaluate.mjs
      args: ["--target", "<project>", "--action", "<action>"]
\`\`\`
`

  await fsPromises.writeFile(path.join(hermesGovernanceDir, "README.md"), readme, "utf8")
}

async function validatePostApply(targetRoot) {
  const governanceRoot = path.join(targetRoot, ".agent-governance")
  const issues = []
  const warnings = []

  // ── Use authoritative runtime file list (same as install + source_lock) ──
  // This prevents drift between what getRuntimeFileList() installs and what
  // validatePostApply checks. Every file in the authoritative list must exist
  // in the installed target.
  const runtimeFileList = getRuntimeFileList()
  const runtimeDir = path.join(governanceRoot, "runtime")

  if (!fs.existsSync(runtimeDir)) {
    issues.push("Missing runtime directory")
  } else {
    for (const { dest } of runtimeFileList) {
      const destPath = path.join(runtimeDir, dest)
      if (!fs.existsSync(destPath)) {
        issues.push(`Missing runtime file: ${relativePath(targetRoot, destPath)}`)
        continue
      }
      // Check file is non-empty (catches corruption / truncation)
      try {
        const stat = fs.statSync(destPath)
        if (stat.size === 0) {
          issues.push(`Runtime file is empty (corrupt): ${relativePath(targetRoot, destPath)}`)
        }
      } catch {
        issues.push(`Cannot stat runtime file: ${relativePath(targetRoot, destPath)}`)
      }
    }
  }

  // ── Bin and manifest files ──
  const requiredFiles = [
    path.join(governanceRoot, "manifest.json"),
    path.join(governanceRoot, "source-lock.json"),
    path.join(governanceRoot, "bin", "evaluate.mjs"),
  ]

  for (const file of requiredFiles) {
    if (!fs.existsSync(file)) {
      issues.push(`Missing required file: ${relativePath(targetRoot, file)}`)
    }
  }

  // ── Required directories ──
  const requiredDirs = ["approvals", "evidence", "state"]
  for (const dir of requiredDirs) {
    const dirPath = path.join(governanceRoot, dir)
    if (!fs.existsSync(dirPath)) {
      issues.push(`Missing required directory: ${relativePath(targetRoot, dirPath)}`)
    }
  }

  // ── Source-lock integrity ──
  const sourceLockPath = path.join(governanceRoot, "source-lock.json")
  if (fs.existsSync(sourceLockPath)) {
    try {
      const sourceLock = JSON.parse(await fsPromises.readFile(sourceLockPath, "utf8"))
      if (!sourceLock.source_commit || sourceLock.source_commit === "UNKNOWN") {
        warnings.push("source-lock.json has no valid source commit")
      }
      if (!sourceLock.files || !Array.isArray(sourceLock.files) || sourceLock.files.length < 5) {
        warnings.push("source-lock.json has fewer files than expected")
      }
    } catch {
      issues.push("source-lock.json is not valid JSON")
    }
  }

  const classification =
    issues.length > 0 ? "RED_BLOCK" : warnings.length > 0 ? "AMBER_REVIEW" : "GREEN_SAFE"

  return { classification, issues, warnings }
}

async function loadApprovalReceipt(approvalFile) {
  if (!approvalFile) return null
  try {
    const content = await fsPromises.readFile(path.resolve(approvalFile), "utf8")
    const data = JSON.parse(content)
    const receipts = Array.isArray(data) ? data : [data]
    const valid = receipts.filter((r) => r.status === "APPROVED")
    return valid.length > 0 ? valid : null
  } catch {
    return null
  }
}

async function verifySourceFingerprint(repoRoot, storedCommit) {
  const currentCommit = await getSourceCommit(repoRoot)
  if (!currentCommit || currentCommit === "UNKNOWN") return false
  if (!storedCommit || storedCommit === "UNKNOWN") return false
  return currentCommit === storedCommit
}

async function runApplyPhase(args) {
  const targetRoot = toAbsolutePath(args.target)

  // Phase 0: Re-run preflight
  const sourceMissing = validateSourceRepository(repoRoot)
  if (sourceMissing.length > 0) {
    console.error("RED_BLOCK: Source repository is missing required files:")
    sourceMissing.forEach((f) => console.error(`  - ${f}`))
    process.exit(2)
  }

  if (!fs.existsSync(targetRoot)) {
    console.error(`RED_BLOCK: Target "${targetRoot}" does not exist.`)
    process.exit(2)
  }

  try {
    fs.accessSync(targetRoot, fs.constants.W_OK)
  } catch {
    console.error(`RED_BLOCK: Target "${targetRoot}" is not writable.`)
    process.exit(2)
  }

  // Phase 1: Validate approval receipt if provided
  if (args.approvalFile) {
    const receipts = await loadApprovalReceipt(args.approvalFile)
    if (!receipts || receipts.length === 0) {
      console.error("RED_BLOCK: No valid APPROVED approval receipt found.")
      process.exit(2)
    }
  }

  // Phase 2: Lock source commit
  const sourceCommit = await getSourceCommit(repoRoot)

  // Phase 3: Check existing installation for fingerprint match
  const existingSourceLockPath = path.join(targetRoot, ".agent-governance", "source-lock.json")
  if (fs.existsSync(existingSourceLockPath)) {
    try {
      const existingLock = JSON.parse(
        await fsPromises.readFile(existingSourceLockPath, "utf8")
      )
      const match = await verifySourceFingerprint(repoRoot, existingLock.source_commit)
      if (!match) {
        console.log("WARNING: Source repository fingerprint has changed since last install.")
      }
    } catch {
      // existing source-lock is corrupted — will be replaced
    }
  }

  // Phase 4: Detect runtimes
  const detectedRuntimes = await detectRuntimes(targetRoot)

  // Phase 5: Create backup
  const governanceRoot = path.join(targetRoot, ".agent-governance")
  const backupFiles = [governanceRoot]
  if (fs.existsSync(path.join(targetRoot, ".hermes", "governance"))) {
    backupFiles.push(path.join(targetRoot, ".hermes", "governance"))
  }

  const backup = await createBackup({
    targetRoot,
    files: backupFiles,
    backupRoot: path.join(
      targetRoot,
      ".opencode",
      "backups",
      `governance-${timestampSlug()}`
    ),
  })

  // Phase 6: Copy runtime files
  await copyRuntimeFiles(repoRoot, targetRoot)

  // Phase 7: Copy policies
  await copyPolicies(repoRoot, targetRoot)

  // Phase 8: Generate source-lock.json
  const sourceLock = await generateSourceLock(repoRoot, targetRoot)

  // Phase 9: Generate manifest.json
  const enforcementLevel = determineEnforcementLevel(detectedRuntimes)
  const manifest = await generateManifest(targetRoot, detectedRuntimes, enforcementLevel)

  // Phase 10: Copy bin/evaluate.mjs wrapper from source
  await createBinEvaluate(targetRoot, repoRoot)

  // Phase 10b: Create .gitkeep in empty directories
  {
    const emptyDirs = ["approvals", "evidence", "state"]
    for (const dir of emptyDirs) {
      const dirPath = path.join(governanceRoot, dir)
      await ensureDirectory(dirPath)
      const gitkeepPath = path.join(dirPath, ".gitkeep")
      if (!fs.existsSync(gitkeepPath)) {
        await fsPromises.writeFile(gitkeepPath, "", "utf8")
      }
    }
  }

  // Phase 11: Install OpenCode hook if detected
  const opencodeDetected = detectedRuntimes.some(
    (r) => r.name === "opencode" && r.confidence >= 50
  )
  if (opencodeDetected) {
    await installOpenCodeHook(targetRoot)
  }

  // Phase 12: Install Hermes plugin if detected
  const hermesDetected = detectedRuntimes.some(
    (r) => r.name === "hermes" && r.confidence >= 50
  )
  if (hermesDetected) {
    await installHermesFiles(targetRoot)
  }

  // Phase 13: Post-apply validation
  const postValidation = await validatePostApply(targetRoot)

  // Phase 14: Generate run report
  const reportDir = path.join(targetRoot, ".agent-governance", "reports")
  await ensureDirectory(reportDir)
  const reportPath = path.join(reportDir, "install-report.json")
  const report = {
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    target_root: targetRoot,
    source_commit: sourceCommit,
    classification: postValidation.classification,
    enforcement_level: enforcementLevel,
    detected_runtimes: detectedRuntimes.map((r) => ({
      name: r.name,
      confidence: r.confidence,
    })),
    installed_runtimes: manifest.installed_runtimes,
    backup_root: backup.backupDir,
    rollback_command: `node scripts/install-governance.mjs --target ${JSON.stringify(targetRoot)} --rollback ${JSON.stringify(backup.backupDir)}`,
    source_lock: sourceLock,
    manifest,
    post_validation: postValidation,
  }
  await fsPromises.writeFile(reportPath, `${safeSerialize(report, REDACTION_OPTIONS)}\n`, "utf8")

  if (args.json) {
    console.log(safeSerialize(report, REDACTION_OPTIONS))
  } else {
    console.log("\n=== Governance Installation Complete ===")
    console.log(`\nClassification: ${postValidation.classification}`)
    console.log(`Enforcement Level: ${enforcementLevel}`)
    console.log(`Installed Runtimes: ${manifest.installed_runtimes.join(", ") || "none"}`)
    console.log(`\nBackup: ${backup.backupDir}`)
    console.log(
      `Rollback: node scripts/install-governance.mjs --target ${JSON.stringify(targetRoot)} --rollback ${JSON.stringify(backup.backupDir)}`
    )
    console.log(`\nGovernance Root: ${relativePath(targetRoot, governanceRoot)}`)
    console.log(`Report: ${relativePath(targetRoot, reportPath)}`)

    if (postValidation.warnings.length > 0) {
      console.log(`\nWarnings:`)
      postValidation.warnings.forEach((w) => console.log(`  - ${w}`))
    }
    if (postValidation.issues.length > 0) {
      console.log(`\nIssues:`)
      postValidation.issues.forEach((i) => console.log(`  - ${i}`))
    }
  }

  const exitCode = classificationToExitCode(postValidation.classification)
  process.exit(exitCode)
}

async function runRollbackPhase(args) {
  const backupRoot = toAbsolutePath(args.rollback)
  const targetRoot = args.target ? toAbsolutePath(args.target) : null

  const result = await restoreBackup({
    backupRoot,
    expectedTargetRoot: targetRoot,
  })

  const governanceRoot = path.join(result.targetRoot, ".agent-governance")
  if (fs.existsSync(governanceRoot)) {
    await removeIfExists(governanceRoot)
  }

  console.log(`Rollback complete. Governance removed from ${result.targetRoot}`)
  console.log("GREEN_SAFE")
  process.exit(0)
}

async function runDryRunPhase(args) {
  const targetRoot = toAbsolutePath(args.target)

  // Phase 1: Validate source repository
  const sourceMissing = validateSourceRepository(repoRoot)
  if (sourceMissing.length > 0) {
    if (args.json) {
      console.log(
        safeSerialize({
          classification: "RED_BLOCK",
          reason: "Source repository missing required files",
          missing_files: sourceMissing,
        }, REDACTION_OPTIONS)
      )
    } else {
      console.log("RED_BLOCK: Source repository is missing required files:")
      sourceMissing.forEach((f) => console.log(`  - ${f}`))
    }
    process.exit(2)
  }

  // Phase 2: Lock source commit
  const sourceCommit = await getSourceCommit(repoRoot)

  // Phase 3: Validate target
  if (!fs.existsSync(targetRoot)) {
    if (args.json) {
      console.log(
        safeSerialize({
          classification: "RED_BLOCK",
          reason: "Target directory does not exist",
          target_root: targetRoot,
        }, REDACTION_OPTIONS)
      )
    } else {
      console.log(`RED_BLOCK: Target "${targetRoot}" does not exist.`)
    }
    process.exit(2)
  }

  let targetWritable = true
  try {
    fs.accessSync(targetRoot, fs.constants.W_OK)
  } catch {
    targetWritable = false
  }

  if (!targetWritable) {
    if (args.json) {
      console.log(
        safeSerialize({
          classification: "RED_BLOCK",
          reason: "Target directory is not writable",
          target_root: targetRoot,
        }, REDACTION_OPTIONS)
      )
    } else {
      console.log(`RED_BLOCK: Target "${targetRoot}" is not writable.`)
    }
    process.exit(2)
  }

  // Phase 4: Detect runtimes
  const detectedRuntimes = await detectRuntimes(targetRoot)
  const riskTier = assessRiskTier(detectedRuntimes, targetRoot)
  const enforcementLevel = determineEnforcementLevel(detectedRuntimes)

  // Phase 5: Build file plan
  const filePlan = buildFilePlan(targetRoot)
  const conflicts = await findConflicts(targetRoot, filePlan)
  const classification = classify(conflicts, sourceMissing, targetWritable, detectedRuntimes)

  // Phase 6: Output
  if (args.json) {
    const output = {
      classification,
      target_root: targetRoot,
      source_commit: sourceCommit,
      risk_tier: riskTier,
      enforcement_level: enforcementLevel,
      detected_runtimes: detectedRuntimes.map((r) => ({
        name: r.name,
        confidence: r.confidence,
        confidence_level: r.confidenceLevel,
        signals: r.signals?.map((s) => (typeof s === "object" ? s.signal || s.file : s)) || [],
      })),
      enforcement_reachable: detectedRuntimes
        .filter((r) => r.confidence >= 50)
        .map((r) => ({
          runtime: r.name,
          level: r.name === "opencode" || r.name === "hermes" ? "STRUCTURAL_HOOK_INSTALLED" : "POLICY_CONFIGURED",
        })),
      files: filePlan.map((f) => ({
        path: f.path,
        action: f.action,
      })),
      hooks_installed: [],
      conflicts,
      warnings: conflicts.length > 0 ? [conflicts.length + " existing files would be affected"] : [],
      planned_backup_path: path.join(
        targetRoot,
        ".opencode",
        "backups",
        `governance-<timestamp>`
      ),
      rollback_command: `node scripts/install-governance.mjs --target ${JSON.stringify(targetRoot)} --rollback <backup-dir>`,
      runtime_specific_notes: detectedRuntimes
        .filter((r) => r.confidence >= 50)
        .map((r) => {
          if (r.name === "opencode")
            return "OpenCode hook will be installed at .agent-governance/hooks/opencode/pre-evaluate.mjs"
          if (r.name === "hermes")
            return "Hermes plugin will be installed at .hermes/governance/evaluate.mjs"
          return ""
        })
        .filter(Boolean),
      exit_code: classificationToExitCode(classification),
    }
    console.log(safeSerialize(output, REDACTION_OPTIONS))
  } else {
    console.log("=== Canonical Agent Governance: Dry-Run ===\n")
    console.log(`Target: ${targetRoot}`)
    console.log(`Source Commit: ${sourceCommit || "UNKNOWN"}`)
    console.log(`\nDetected Runtimes:`)
    for (const r of detectedRuntimes) {
      const marker = r.confidence >= 80 ? "DETECTED" : r.confidence >= 50 ? "POSSIBLE" : "NOT_DETECTED"
      console.log(`  - ${r.name}: ${r.confidence}% (${marker})`)
    }
    console.log(`\nRisk Tier: ${riskTier}`)
    console.log(`Enforcement Level: ${enforcementLevel}`)

    console.log(`\nEnforcement Reachable:`)
    for (const r of detectedRuntimes) {
      if (r.confidence >= 50) {
        const level = r.name === "opencode" || r.name === "hermes" ? "STRUCTURAL_HOOK_INSTALLED" : "POLICY_CONFIGURED"
        console.log(`  - ${r.name}: ${level}`)
      }
    }

    console.log(`\nFiles That Would Be Created/Modified (${filePlan.length}):`)
    for (const f of filePlan.slice(0, 20)) {
      console.log(`  - [${f.action}] ${f.path}`)
    }
    if (filePlan.length > 20) {
      console.log(`  ... and ${filePlan.length - 20} more files`)
    }

    if (conflicts.length > 0) {
      console.log(`\nConflicts/Warnings (${conflicts.length}):`)
      for (const c of conflicts) {
        console.log(`  - ${c}`)
      }
    }

    console.log(`\nRuntime Hooks That Would Be Installed:`)
    if (detectedRuntimes.some((r) => r.name === "opencode" && r.confidence >= 50)) {
      console.log(`  - OpenCode pre-evaluate hook at .agent-governance/hooks/opencode/pre-evaluate.mjs`)
    }
    if (detectedRuntimes.some((r) => r.name === "hermes" && r.confidence >= 50)) {
      console.log(`  - Hermes governance plugin at .hermes/governance/evaluate.mjs`)
    }

    console.log(
      `\nPlanned Backup: ${path.join(targetRoot, ".opencode", "backups", `governance-<timestamp>`)}`
    )
    console.log(`Rollback Command: node scripts/install-governance.mjs --target ${JSON.stringify(targetRoot)} --rollback <backup-dir>`)

    console.log(`\n=== Classification: ${classification} ===`)
  }

  process.exit(classificationToExitCode(classification))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    printHelp()
    process.exit(0)
  }

  if (args.rollback) {
    await runRollbackPhase(args)
    return
  }

  if (!args.target) {
    console.error("Missing required --target")
    console.error("Use --help for usage")
    process.exit(1)
  }

  if (args.apply) {
    await runApplyPhase(args)
    return
  }

  await runDryRunPhase(args)
}

export { validatePostApply, getRuntimeFileList }

// Only call main when run directly (not imported by tests or other modules)
const isDirectlyInvoked = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
)
if (isDirectlyInvoked) {
  main().catch((error) => {
    console.error(safeRedactText(error instanceof Error ? error.message : String(error), { secrets: secretValuesFromEnv() }))
    process.exit(2)
  })
}
