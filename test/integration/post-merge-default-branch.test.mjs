import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const rootUrl = "https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem"

function git(cwd, args, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: options.encoding ?? "utf8",
    stdio: options.stdio,
  })
}

if (process.env.OCAE_POST_MERGE_CONTEXT_CHILD === "1") {
  test("nested candidate runs as an isolated default-branch single commit", async () => {
    assert.equal(git(sourceRoot, ["branch", "--show-current"]).trim(), "master")
    assert.equal(git(sourceRoot, ["rev-list", "--count", "HEAD"]).trim(), "1")
    assert.equal(git(sourceRoot, ["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/).length, 1)
    assert.equal(git(sourceRoot, ["for-each-ref", "--format=%(refname)", "refs/remotes"]).includes("feat/"), false)
    assert.equal(await fs.lstat(sourceRoot).then((entry) => entry.isSymbolicLink()), false)
    assert.equal(await fs.readFile(path.join(sourceRoot, "AI-BOOTSTRAP.md"), "utf8")
      .then((content) => content.includes(rootUrl)), true)
  })
} else {
  test("candidate passes canonical gates in default-branch, squash, and detached contexts", async (t) => {
    const checkout = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-post-merge-context-"))
    const isolatedHome = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-post-merge-home-"))
    t.after(() => Promise.all([
      fs.rm(checkout, { recursive: true, force: true }),
      fs.rm(isolatedHome, { recursive: true, force: true }),
    ]))

    await fs.cp(sourceRoot, checkout, {
      recursive: true,
      filter: (source) => {
        const relative = path.relative(sourceRoot, source)
        return relative !== ".git" && !relative.startsWith(`.git${path.sep}`)
      },
    })
    git(checkout, ["init", "--initial-branch=master"], { stdio: "ignore" })
    git(checkout, ["config", "user.name", "OCAE Post-Merge Test"], { stdio: "ignore" })
    git(checkout, ["config", "user.email", "ocae-post-merge.invalid@example.invalid"], { stdio: "ignore" })
    git(checkout, ["remote", "add", "origin", rootUrl], { stdio: "ignore" })
    git(checkout, ["add", "-A"], { stdio: "ignore" })
    git(checkout, ["commit", "-m", "candidate squash tree"], { stdio: "ignore" })

    const controlledEnv = {
      PATH: process.env.PATH,
      HOME: isolatedHome,
      TMPDIR: os.tmpdir(),
      OCAE_POST_MERGE_CONTEXT_CHILD: "1",
    }
    const canonical = spawnSync(process.execPath, [
      "scripts/run-tests.mjs", "--all", "--reporter=dot",
    ], {
      cwd: checkout,
      env: controlledEnv,
      stdio: "inherit",
      timeout: 240_000,
    })
    assert.equal(canonical.status, 0, `canonical runner failed with ${canonical.status}`)

    git(checkout, ["checkout", "--detach", "HEAD"], { stdio: "ignore" })
    const detached = spawnSync(process.execPath, [
      "--test-reporter=spec", "test/security/redaction.test.mjs",
    ], {
      cwd: checkout,
      env: controlledEnv,
      stdio: "inherit",
      timeout: 30_000,
    })
    assert.equal(detached.status, 0, `detached redaction test failed with ${detached.status}`)

    const guide = await fs.readFile(path.join(checkout, "AI-BOOTSTRAP.md"), "utf8")
    const manifest = JSON.parse(await fs.readFile(path.join(checkout, "bootstrap/manifest.json"), "utf8"))
    assert.match(guide, new RegExp(rootUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    assert.equal(manifest.repository, rootUrl)
  }, { timeout: 270_000 })
}
