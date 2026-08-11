import test from "node:test"
import assert from "node:assert/strict"
import { normalizeGeneratedText } from "../../scripts/generate-governance.mjs"

test("governance drift check treats Windows CRLF checkouts as generated-equivalent", () => {
  const generated = '{"generated":true}\n'
  assert.equal(normalizeGeneratedText(generated.replaceAll("\n", "\r\n")), generated)
})
