// SPDX-License-Identifier: MIT
// T4 Governance/Swarm authority unification invariant.
// Canonical invariant: BLACKBOARD MAY PRIORITIZE WORK, MUST NEVER GRANT AUTHORITY;
// GOVERNANCE V2 AUTHORIZES EFFECTS.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const script = join(root, ".agents/skills/coordinate-blackboard-swarm/scripts/blackboard.py");
const manifestPath = join(root, "ecosystem.manifest.json");
const make = () => join(mkdtempSync(join(tmpdir(), "ocae-swarm-auth-")), "board.sqlite");
const run = (db, ...args) => execFileSync("python3", [script, "--db", db, ...args], { encoding: "utf8" }).trim();
const fails = (db, ...args) => assert.throws(() => run(db, ...args));
const snapshot = (db) => JSON.parse(execFileSync("python3", [script, "--db", db, "snapshot"], { encoding: "utf8" }));

test("coordination signals never create PASS gates (signal/inhibit/vote/scout/match)", () => {
  const db = make();
  run(db, "init");
  run(db, "gate", "preflight", "PASS", "--evidence", "preflight");
  run(db, "add", "coord-task", "--acceptance", "evidence");
  run(db, "register-worker", "impl");
  run(db, "register-worker", "reviewer");
  run(db, "register-worker", "scout-1", "--role", "scout");
  run(db, "claim", "1", "--worker", "impl", "--lease", "60");
  const before = snapshot(db);
  assert.equal(before.gates.length, 1, "only the preflight PASS gate exists before coordination ops");
  run(db, "signal", "T1", "3", "scheduling-hint", "--source", "scout-1");
  run(db, "inhibit", "impl", "general", "2", "scheduling-penalty", "--source", "supervisor", "--ttl", "60");
  run(db, "vote", "1", "reviewer", "PASS", "--ref", "review-ref");
  run(db, "scout", "1", "scout-1", "rootcause=A", "0.8", "--ref", "scout-ref");
  run(db, "match", "1");
  const snap = snapshot(db);
  assert.equal(snap.gates.length, 1, "coordination ops must not create gates");
  assert.equal(snap.gates[0].name, "preflight", "only the preflight gate remains");
  assert.equal(snap.gates[0].state, "PASS", "preflight gate unchanged");
  // A PASS preflight gate plus an open RUNNING task is still not green:
  // coordination data alone never completes authority.
  fails(db, "green", "--require", "preflight");
  assert.match(snap.tasks[0].quorum, /1\/1/, "reviewer vote counted; owner self-vote excluded");
});

test("PROPOSED admits to READY only with evidence", () => {
  const db = make();
  run(db, "init");
  run(db, "propose", "new-work", "--acceptance", "evidence");
  // Missing --evidence is rejected by the CLI (exit 2).
  fails(db, "admit", "1");
  // Blank evidence is rejected by the engine.
  fails(db, "admit", "1", "--evidence", "   ");
  let snap = snapshot(db);
  assert.equal(snap.tasks[0].state, "PROPOSED", "task stays PROPOSED until admitted with evidence");
  run(db, "admit", "1", "--evidence", "scope-check-pass");
  snap = snapshot(db);
  assert.equal(snap.tasks[0].state, "READY", "admit with evidence moves PROPOSED to READY");
});

test("DONE requires a PASS result plus quorum", () => {
  const db = make();
  run(db, "init");
  run(db, "gate", "preflight", "PASS", "--evidence", "preflight");
  run(db, "add", "reviewed-work", "--acceptance", "evidence", "--quorum", "1");
  run(db, "register-worker", "impl");
  run(db, "register-worker", "reviewer");
  run(db, "claim", "1", "--worker", "impl", "--lease", "60");
  // No result yet: DONE must fail.
  fails(db, "done", "1");
  run(db, "result", "1", "test", "PASS", "--ref", "test-ref");
  // PASS result present but quorum (non-owner PASS vote) missing: DONE must fail.
  fails(db, "done", "1");
  run(db, "vote", "1", "reviewer", "PASS", "--ref", "review-ref");
  run(db, "done", "1");
  const snap = snapshot(db);
  assert.equal(snap.tasks[0].state, "DONE", "DONE succeeds only with PASS result + quorum");
});

test("manifest declares swarm as coordinator-only with no authority", () => {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const generic = manifest.catalogs?.agents?.generic ?? [];
  const byName = new Map(generic.map((e) => [typeof e === "string" ? e : e.name, typeof e === "string" ? "" : e.description ?? ""]));
  for (const name of ["swarm", "swarm-worker"]) {
    assert.ok(byName.has(name), `catalogs.agents.generic must contain ${name}`);
  }
  for (const name of ["swarm", "swarm-worker"]) {
    const desc = byName.get(name);
    assert.match(desc, /facade/i, `${name} description must state facade role`);
    assert.match(desc, /no authority|never.*authority|grants no authority/i, `${name} description must state no authority`);
  }
  assert.ok(byName.has("issue-orchestrator"), "issue-orchestrator remains the primary orchestrator");
  const profiles = manifest.catalogs?.agents?.profiles ?? {};
  for (const name of ["swarm", "swarm-worker"]) {
    const profile = profiles[name];
    assert.ok(profile, `profiles must contain ${name}`);
    for (const op of ["approve", "merge", "deploy"]) {
      assert.ok(!profile.allowed_operations.includes(op), `${name}.allowed_operations must not contain ${op}`);
    }
  }
});
