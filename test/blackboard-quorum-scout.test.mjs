import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = process.cwd()
const script = join(root, ".agents/skills/coordinate-blackboard-swarm/scripts/blackboard.py")
const make = () => join(mkdtempSync(join(tmpdir(), "ocae-qs-")), "board.sqlite")
const run = (db, ...args) => execFileSync("python3", [script, "--db", db, ...args], { encoding: "utf8" }).trim()
const fails = (db, ...args) => assert.throws(() => run(db, ...args))
const boot = () => { const db = make(); run(db, "init"); run(db, "gate", "preflight", "PASS", "--evidence", "preflight"); return db }

test("QS1 vote binds explicit fingerprint", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc", "--quorum", "1")
  run(db, "register-worker", "impl")
  run(db, "register-worker", "rev")
  run(db, "claim", "1", "--worker", "impl", "--lease", "60")
  run(db, "fact", "1", "fingerprint", "abc123", "--ref", "r0")
  const out = run(db, "vote", "1", "rev", "PASS", "--ref", "v1", "--fingerprint", "abc123")
  assert.match(out, /1\/1/)
  assert.match(run(db, "quorum", "1"), /1\/1.*\(stale:0\).*PASS/)
})

test("QS2 default vote uses current fingerprint; mutation invalidates stale votes", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc", "--quorum", "1")
  run(db, "register-worker", "impl")
  run(db, "register-worker", "rev")
  run(db, "claim", "1", "--worker", "impl", "--lease", "60")
  run(db, "fact", "1", "fingerprint", "fp1", "--ref", "r0")
  run(db, "vote", "1", "rev", "PASS", "--ref", "v1")
  assert.match(run(db, "quorum", "1"), /1\/1.*PASS/)
  run(db, "fact", "1", "fingerprint", "fp2", "--ref", "r1")
  const q = (() => { try { return run(db, "quorum", "1") } catch (e) { return String(e.stdout ?? e.message) } })()
  assert.match(q, /0\/1.*\(stale:1\)/)
})

test("QS3 quorum excludes stale votes from count", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc", "--quorum", "1")
  run(db, "register-worker", "impl")
  run(db, "register-worker", "rev")
  run(db, "claim", "1", "--worker", "impl", "--lease", "60")
  run(db, "fact", "1", "fingerprint", "new", "--ref", "r0")
  run(db, "vote", "1", "rev", "PASS", "--ref", "v-old", "--fingerprint", "old")
  const q = (() => { try { return run(db, "quorum", "1") } catch (e) { return String(e.stdout ?? e.message) } })()
  assert.match(q, /0\/1.*\(stale:1\)/)
})

test("QS4 scout self-confirm rejected", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc")
  run(db, "register-worker", "s1", "--role", "scout")
  run(db, "scout", "1", "s1", "obs=A", "0.7", "--ref", "r1")
  fails(db, "scout-confirm", "1", "--reviewer", "s1", "--ref", "r2")
})

test("QS5 second-scout confirm works", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc")
  run(db, "register-worker", "s1", "--role", "scout")
  run(db, "register-worker", "s2", "--role", "scout")
  run(db, "scout", "1", "s1", "obs=A", "0.7", "--ref", "r1")
  assert.match(run(db, "scout-confirm", "1", "--reviewer", "s2", "--ref", "r2"), /SCOUT_CONFIRMED\|1\|s2/)
})

test("QS6 snapshot shows confirmed count", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc")
  run(db, "register-worker", "s1", "--role", "scout")
  run(db, "register-worker", "s2", "--role", "scout")
  run(db, "scout", "1", "s1", "obs=A", "0.7", "--ref", "r1")
  let snap = JSON.parse(run(db, "snapshot"))
  assert.equal(snap.scouts_confirmed, 0)
  run(db, "scout-confirm", "1", "--reviewer", "s2", "--ref", "r2")
  snap = JSON.parse(run(db, "snapshot"))
  assert.equal(snap.scouts_confirmed, 1)
  assert.equal(snap.scouts[0].confirmed, 1)
})
