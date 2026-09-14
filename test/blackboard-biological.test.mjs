import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = process.cwd()
const script = join(root, ".agents/skills/coordinate-blackboard-swarm/scripts/blackboard.py")
const make = () => join(mkdtempSync(join(tmpdir(), "ocae-bio-")), "board.sqlite")
const run = (db, ...args) => execFileSync("python3", [script, "--db", db, ...args], { encoding: "utf8" }).trim()
const fails = (db, ...args) => assert.throws(() => run(db, ...args))

test("signals change deterministic order and TTL evaporation removes them", async () => {
  const db = make(); run(db, "init"); run(db, "gate", "preflight", "PASS", "--evidence", "preflight")
  run(db, "add", "low", "--acceptance", "evidence", "--priority", "1")
  run(db, "add", "high", "--acceptance", "evidence", "--priority", "0")
  run(db, "signal", "T2", "5", "failing-test", "--source", "scout", "--ttl", "2")
  assert.match(run(db, "next"), /\|high\|ac:/)
  await new Promise(resolve => setTimeout(resolve, 2200))
  assert.match(run(db, "next"), /\|low\|ac:/)
})

test("quorum excludes self and unauthorized or stale voters", () => {
  const db = make(); run(db, "init"); run(db, "gate", "preflight", "PASS", "--evidence", "preflight")
  run(db, "add", "reviewed", "--acceptance", "evidence", "--quorum", "2")
  run(db, "register-worker", "impl"); run(db, "register-worker", "review-a"); run(db, "register-worker", "review-b")
  run(db, "claim", "1", "--worker", "impl", "--lease", "60"); run(db, "result", "1", "test", "PASS", "--ref", "test-ref")
  fails(db, "done", "1")
  fails(db, "vote", "1", "unknown", "PASS", "--ref", "bad")
  run(db, "vote", "1", "review-a", "PASS", "--ref", "review-a")
  run(db, "vote", "1", "review-b", "PASS", "--ref", "review-b")
  assert.match(run(db, "quorum", "1"), /2\/2.*PASS/)
  run(db, "done", "1")
})

test("scout facts and inhibition are bounded data and matching is deterministic", () => {
  const db = make(); run(db, "init"); run(db, "gate", "preflight", "PASS", "--evidence", "preflight")
  run(db, "add", "investigate", "--acceptance", "evidence", "--task-class", "tooling")
  run(db, "register-worker", "scout-1", "--role", "scout")
  run(db, "scout", "1", "scout-1", "rootcause=A", "0.8", "--ref", "scout-ref")
  run(db, "register-worker", "a", "--capabilities", "[\"read\",\"python\"]")
  run(db, "register-worker", "b", "--capabilities", "[\"read\",\"python\"]")
  run(db, "register-worker", "reviewer")
  run(db, "inhibit", "a", "tooling", "3", "temporary", "--source", "supervisor", "--ttl", "60")
  assert.match(run(db, "match", "1", "--requires", "read,python"), /\|b\|/)
  run(db, "claim", "1", "--worker", "b", "--lease", "60"); run(db, "result", "1", "test", "PASS", "--ref", "test-ref"); run(db, "vote", "1", "reviewer", "PASS", "--ref", "review-ref")
  run(db, "done", "1")
  run(db, "add", "scout-task", "--acceptance", "scout evidence")
  run(db, "claim", "2", "--worker", "scout-1", "--lease", "60"); run(db, "result", "2", "scout", "PASS", "--ref", "scout-ref")
  fails(db, "done", "2")
})
