import fs from "node:fs"
import path from "node:path"

export const PRODUCT_INVARIANT = "OCAE_IS_AN_OPENCODE_URL_INSTALLABLE_AGENT_ECOSYSTEM"

export function readProductContract(sourceRoot) {
  const manifestPath = path.join(sourceRoot, "bootstrap", "manifest.json")
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  return manifest.product_contract
}

export function hasProjectProviderConfiguration(targetRoot) {
  for (const filename of ["opencode.jsonc", "opencode.json"]) {
    const configPath = path.join(targetRoot, filename)
    if (!fs.existsSync(configPath)) continue
    const text = fs.readFileSync(configPath, "utf8")
    if (/"(?:model|provider)"\s*:/i.test(text)) return true
  }
  return false
}

export function buildPostInstallStatus({ targetRoot, coreIssues = [], toolsInstalled = false } = {}) {
  const blockers = [...coreIssues]
  return {
    core: blockers.length === 0 ? "CORE_READY" : "CORE_NOT_READY",
    provider: hasProjectProviderConfiguration(targetRoot) ? "PROVIDER_READY" : "PROVIDER_NOT_CONFIGURED",
    tools: toolsInstalled ? "TOOLS_READY" : "TOOLS_NOT_CONFIGURED",
    optional_capabilities: "HOST_DISCOVERED",
    blockers,
  }
}
