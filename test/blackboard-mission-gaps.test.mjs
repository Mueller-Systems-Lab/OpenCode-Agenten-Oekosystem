import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = process.cwd()
const script = join(root, ".agents/skills/coordinate-blackboard-swarm/scripts/blackboard.py")
const make = () => join(mkdtempSync(join(tmpdir(), "ocae-gaps-")), "board.sqlite")
const run = (db, ...args) => execFileSync("python3", [script, "--db", db, ...args], { encoding: "utf8" }).trim()
const fails = (db, ...args) => assert.throws(() => run(db, ...args))
const boot = () => { const db = make(); run(db, "init"); run(db, "gate", "preflight", "PASS", "--evidence", "preflight"); return db }
const expireClaim = (db) => execFileSync("python3", ["-c", `import sqlite3, time; c=sqlite3.connect(${JSON.stringify(db)}); c.execute("UPDATE claims SET expires_at=?", (time.time()-10,)); c.commit()`])

test("G1 preflight gate: claim fails, next blocked before PASS; both work after", () => {
  const db = make(); run(db, "init")
  run(db, "add", "a", "--acceptance", "acc")
  fails(db, "claim", "1", "--worker", "w1", "--lease", "60")
  assert.match(run(db, "next"), /BLOCKED\|PREFLIGHT_NOT_PASS/)
  run(db, "gate", "preflight", "PASS", "--evidence", "preflight")
  assert.match(run(db, "claim", "1", "--worker", "w1", "--lease", "60"), /C\|1\|w1/)
})

test("G2 atomic claim: live claim cannot be stolen; same worker gets renewed marker", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc")
  run(db, "claim", "1", "--worker", "w1", "--lease", "60")
  fails(db, "claim", "1", "--worker", "w2", "--lease", "60")
  assert.match(run(db, "claim", "1", "--worker", "w1", "--lease", "60"), /renewed/)
})

test("G3 lease expiry/crash recovery: expired claim returns to READY, facts survive, peer reclaims", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc")
  run(db, "claim", "1", "--worker", "w1", "--lease", "60")
  run(db, "fact", "1", "rootcause", "x", "--ref", "r0")
  expireClaim(db)
  const st = run(db, "status")
  assert.match(st, /READY:1/)
  assert.match(st, /expired:1/)
  assert.match(run(db, "claim", "1", "--worker", "w2", "--lease", "60"), /C\|1\|w2/)
  const n = execFileSync("python3", ["-c", `import sqlite3; c=sqlite3.connect(${JSON.stringify(db)}); print(c.execute("SELECT COUNT(*) FROM facts WHERE task_id=1").fetchone()[0])`], { encoding: "utf8" }).trim()
  assert.equal(n, "1")
})

test("G4 evidence-gated DONE: no result and FAIL result both block DONE", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc")
  run(db, "claim", "1", "--worker", "w1", "--lease", "60")
  fails(db, "done", "1")
  run(db, "result", "1", "test", "FAIL", "--ref", "r1")
  fails(db, "done", "1")
})

test("G5 fail/retry idempotency: FAILED->READY once, second retry fails, peer reclaims", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc")
  run(db, "claim", "1", "--worker", "w1", "--lease", "60")
  assert.match(run(db, "fail", "1", "boom"), /FAILED/)
  assert.match(run(db, "retry", "1"), /READY/)
  fails(db, "retry", "1")
  assert.match(run(db, "claim", "1", "--worker", "w2", "--lease", "60"), /C\|1\|w2/)
})

test("G6 green gate: open task blocks green, PASS result + quorum + DONE greens", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc", "--quorum", "1")
  run(db, "register-worker", "impl")
  run(db, "register-worker", "reviewer")
  run(db, "claim", "1", "--worker", "impl", "--lease", "60")
  fails(db, "green", "--require", "preflight")
  run(db, "result", "1", "test", "PASS", "--ref", "r1")
  run(db, "vote", "1", "reviewer", "PASS", "--ref", "v1")
  run(db, "done", "1")
  assert.match(run(db, "green", "--require", "preflight"), /PROJECT_GREEN=YES/)
})

test("G7 proposal reject path: PROPOSED->REJECTED with reason", () => {
  const db = boot()
  run(db, "propose", "p", "--acceptance", "acc")
  assert.match(run(db, "reject", "1", "--reason", "oos"), /REJECTED/)
  const snap = JSON.parse(run(db, "snapshot"))
  assert.equal(snap.tasks[0].state, "REJECTED")
})

test("G8 signal aggregation: repeated signals accumulate effective delta", () => {
  const db = make(); run(db, "init")
  assert.match(run(db, "signal", "T1", "3", "hint", "--source", "s1"), /effective:3/)
  assert.match(run(db, "signal", "T1", "3", "hint", "--source", "s1"), /effective:6/)
})

test("G9 observer correctness + secret isolation: snapshot shows state, never fact values", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc", "--quorum", "1")
  run(db, "claim", "1", "--worker", "w1", "--lease", "60")
  run(db, "fact", "1", "apikey", "sk-secret-123", "--ref", "r1")
  const raw = run(db, "snapshot")
  const snap = JSON.parse(raw)
  assert.equal(snap.tasks[0].state, "RUNNING")
  assert.equal(snap.tasks[0].quorum, "0/1")
  assert.equal(snap.gates[0].name, "preflight")
  assert.ok(!raw.includes("sk-secret-123"), "fact secret must not leak into observer snapshot")
})

test("G10 quorum integrity: unknown voter rejected, owner self-vote excluded", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc", "--quorum", "1")
  run(db, "register-worker", "impl")
  run(db, "register-worker", "reviewer")
  run(db, "claim", "1", "--worker", "impl", "--lease", "60")
  run(db, "result", "1", "test", "PASS", "--ref", "r1")
  fails(db, "vote", "1", "ghost", "PASS", "--ref", "bad")
  run(db, "vote", "1", "impl", "PASS", "--ref", "self")
  try { run(db, "quorum", "1"); assert.fail("quorum gate should FAIL with only self-vote") }
  catch (e) { assert.match(String(e.stdout ?? e.message), /0\/1/, "owner self-vote must not count toward quorum") }
  run(db, "vote", "1", "reviewer", "PASS", "--ref", "v1")
  assert.match(run(db, "quorum", "1"), /1\/1.*PASS/)
})

test("G11 session identity: ses_-style worker id claims and appears in snapshot", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc")
  assert.match(run(db, "claim", "1", "--worker", "ses_abc123XYZ", "--lease", "60"), /C\|1\|ses_abc123XYZ/)
  const snap = JSON.parse(run(db, "snapshot"))
  assert.ok(snap.workers.some(w => w.worker === "ses_abc123XYZ"), "session worker visible in snapshot")
})

test("G12 no peer escalation: deauthorized worker cannot vote, peer cannot renew another worker's claim", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc")
  run(db, "register-worker", "w1")
  run(db, "register-worker", "bad", "--no-authorized")
  run(db, "claim", "1", "--worker", "w1", "--lease", "60")
  fails(db, "vote", "1", "bad", "PASS", "--ref", "bad")
  fails(db, "renew", "1", "--worker", "bad", "--lease", "60")
})
