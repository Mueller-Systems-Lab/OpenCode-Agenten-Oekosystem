import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as adapterModule from "../../src/ocae_cli/_adapter/opencode-handoff.js"

test("global adapter exposes only the OpenCode plugin factory", async () => {
  assert.deepEqual(Object.keys(adapterModule), ["default"])

  const target = await fs.mkdtemp(path.join(os.tmpdir(), "ocae-opencode-adapter-contract-"))
  try {
    const hooks = await adapterModule.default({
      client: {},
      project: { id: "contract-test" },
      directory: target,
      worktree: target,
      experimental_workspace: { register() {} },
      serverUrl: new URL("http://localhost:4096"),
      $: undefined,
    })
    assert.equal(typeof hooks["chat.message"], "function")
  } finally {
    await fs.rm(target, { recursive: true, force: true })
  }
})

test("global adapter blocks non-string OpenCode target context without throwing", async () => {
  const hooks = await adapterModule.default({
    client: {},
    project: { id: "invalid-target-test" },
    directory: {},
    worktree: {},
    experimental_workspace: { register() {} },
    serverUrl: new URL("http://localhost:4096"),
    $: undefined,
  })
  const output = {
    message: { role: "user", id: "message-1" },
    parts: [{ type: "text", text: "ordinary user prompt" }],
  }

  const result = await hooks["chat.message"]({ sessionID: "session-1", messageID: "message-1" }, output)

  assert.equal(result.classification, "RED_BLOCK_TARGET_UNCLEAR")
  assert.match(output.parts[0].text, /RED_BLOCK_TARGET_UNCLEAR/u)
  assert.equal(output.parts[0].synthetic, true)
})
