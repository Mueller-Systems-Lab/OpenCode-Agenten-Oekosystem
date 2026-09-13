import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const root = process.cwd()
const script = join(root, ".agents/skills/coordinate-blackboard-swarm/scripts/blackboard.py")
const make = () => join(mkdtempSync(join(tmpdir(), "ocae-harden-")), "board.sqlite")
const run = (db, ...args) => execFileSync("python3", [script, "--db", db, ...args], { encoding: "utf8" }).trim()
const fails = (db, ...args) => assert.throws(() => run(db, ...args))
const boot = () => { const db = make(); run(db, "init"); run(db, "gate", "preflight", "PASS", "--evidence", "preflight"); return db }

test("A1 init stamps schema_version 2 and snapshot reports it", () => {
  const db = boot()
  const snap = JSON.parse(run(db, "snapshot"))
  assert.equal(snap.schema_version, 2)
})

test("A2 unknown-newer and older versions fail closed", () => {
  const db = boot()
  execFileSync("python3", ["-c", `import sqlite3; c=sqlite3.connect(${JSON.stringify(db)}); c.execute("UPDATE meta SET v='99' WHERE k='schema_version'"); c.commit()`])
  fails(db, "status")
  execFileSync("python3", ["-c", `import sqlite3; c=sqlite3.connect(${JSON.stringify(db)}); c.execute("UPDATE meta SET v='1' WHERE k='schema_version'"); c.commit()`])
  fails(db, "next")
})

test("B1 run-create/run-current and --run tagging with status display", () => {
  const db = boot()
  assert.match(run(db, "run-current"), /RUN\|NONE/)
  assert.match(run(db, "run-create", "--note", "r1"), /RUN\|1/)
  assert.match(run(db, "run-current"), /RUN\|1/)
  run(db, "add", "tagged", "--acceptance", "acc", "--run", "1")
  run(db, "add", "legacy", "--acceptance", "acc")
  const snap = JSON.parse(run(db, "snapshot"))
  assert.equal(snap.runs.length, 1)
  assert.equal(snap.current_run, 1)
  assert.equal(snap.tasks.find(t => t.title === "tagged").run_id, 1)
  assert.equal(snap.tasks.find(t => t.title === "legacy").run_id, null)
  assert.match(run(db, "status"), /run:1/)
})

test("B2 add --run with unknown run fails", () => {
  const db = boot()
  fails(db, "add", "bad", "--acceptance", "acc", "--run", "42")
})

test("C1 dep rejects self-dependency", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc")
  fails(db, "dep", "1", "--on", "1")
})

test("C2 dep rejects reverse-edge cycle and next excludes blocked deps", () => {
  const db = boot()
  run(db, "add", "base", "--acceptance", "acc")
  run(db, "add", "child", "--acceptance", "acc")
  run(db, "dep", "2", "--on", "1")
  fails(db, "dep", "1", "--on", "2")
  assert.match(run(db, "next", "--limit", "5"), /\|base\|/)
  assert.doesNotMatch(run(db, "next", "--limit", "5"), /\|child\|/)
})

test("C3 next prints blocked hint when all READY are dep-blocked", () => {
  const db = boot()
  run(db, "add", "base", "--acceptance", "acc")
  run(db, "add", "child", "--acceptance", "acc")
  run(db, "dep", "2", "--on", "1")
  run(db, "claim", "1", "--worker", "w", "--lease", "60")
  assert.match(run(db, "next"), /T\|NONE\|blocked:1/)
})

test("C4 snapshot includes deps", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc")
  run(db, "add", "b", "--acceptance", "acc")
  run(db, "dep", "2", "--on", "1")
  const snap = JSON.parse(run(db, "snapshot"))
  assert.deepEqual(snap.deps, [{ task_id: 2, depends_on: 1 }])
})

test("D1 renew extends own unexpired claim, denies others", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc")
  run(db, "claim", "1", "--worker", "w1", "--lease", "60")
  assert.match(run(db, "renew", "1", "--worker", "w1", "--lease", "60"), /renewed/)
  fails(db, "renew", "1", "--worker", "other", "--lease", "60")
  fails(db, "renew", "1", "--worker", "w1", "--lease", "5")
})

test("E1 claim idempotency returns renewed marker", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc")
  run(db, "claim", "1", "--worker", "w1", "--lease", "60")
  assert.match(run(db, "claim", "1", "--worker", "w1", "--lease", "60"), /renewed/)
})

test("E2 result dedup avoids duplicate rows", () => {
  const db = boot()
  run(db, "add", "a", "--acceptance", "acc")
  run(db, "claim", "1", "--worker", "w1", "--lease", "60")
  run(db, "result", "1", "test", "PASS", "--ref", "r1")
  assert.match(run(db, "result", "1", "test", "PASS", "--ref", "r1"), /R\|1\|test\|PASS\|ref:r1/)
  const n = execFileSync("python3", ["-c", `import sqlite3; c=sqlite3.connect(${JSON.stringify(db)}); print(c.execute("SELECT COUNT(*) FROM results").fetchone()[0])`], { encoding: "utf8" }).trim()
  assert.equal(n, "1")
  run(db, "result", "1", "test", "PASS", "--ref", "r2")
  const n2 = execFileSync("python3", ["-c", `import sqlite3; c=sqlite3.connect(${JSON.stringify(db)}); print(c.execute("SELECT COUNT(*) FROM results").fetchone()[0])`], { encoding: "utf8" }).trim()
  assert.equal(n2, "2")
})
