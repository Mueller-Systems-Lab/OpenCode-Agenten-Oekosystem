#!/usr/bin/env python3
"""Minimal SQLite blackboard for token-efficient agent coordination."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

TASK_STATES = {"PROPOSED", "READY", "RUNNING", "BLOCKED", "FAILED", "DONE", "REJECTED"}
GATE_STATES = {"PASS", "FAIL", "AMBER", "BLOCKED"}
OPEN_STATES = {"PROPOSED", "READY", "RUNNING", "BLOCKED", "FAILED"}

EXPECTED_SCHEMA_VERSION = 2


def now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def connect(path: str, create_parent: bool = True) -> sqlite3.Connection:
    db = Path(path)
    if create_parent:
        db.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db, timeout=10, isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("PRAGMA busy_timeout=10000")
    con.execute("PRAGMA journal_mode=WAL")
    return con


def schema(con: sqlite3.Connection) -> None:
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS tasks(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          acceptance TEXT NOT NULL,
          state TEXT NOT NULL CHECK(state IN ('PROPOSED','READY','RUNNING','BLOCKED','FAILED','DONE','REJECTED')),
          ref TEXT,
          parent_id INTEGER REFERENCES tasks(id),
          reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS claims(
          task_id INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
          worker TEXT NOT NULL,
          expires_at REAL NOT NULL,
          claimed_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS facts(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          ref TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS results(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          value TEXT,
          ref TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS gates(
          name TEXT PRIMARY KEY,
          state TEXT NOT NULL CHECK(state IN ('PASS','FAIL','AMBER','BLOCKED')),
          evidence TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          type TEXT NOT NULL,
          task_id INTEGER,
          payload TEXT
        );
        CREATE TABLE IF NOT EXISTS signals(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          subject TEXT NOT NULL,
          delta INTEGER NOT NULL,
          reason TEXT NOT NULL,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at REAL,
          persistent INTEGER NOT NULL DEFAULT 0 CHECK(persistent IN (0,1))
        );
        CREATE TABLE IF NOT EXISTS inhibitions(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          subject TEXT NOT NULL,
          task_class TEXT NOT NULL,
          penalty INTEGER NOT NULL CHECK(penalty >= 0),
          reason TEXT NOT NULL,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workers(
          worker TEXT PRIMARY KEY,
          capabilities TEXT NOT NULL DEFAULT '[]',
          authorized INTEGER NOT NULL DEFAULT 1 CHECK(authorized IN (0,1)),
          role TEXT NOT NULL DEFAULT 'worker'
        );
        CREATE TABLE IF NOT EXISTS votes(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          voter TEXT NOT NULL,
          status TEXT NOT NULL,
          ref TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at REAL
        );
        CREATE TABLE IF NOT EXISTS scout_facts(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          scout TEXT NOT NULL,
          fact TEXT NOT NULL,
          confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
          ref TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at REAL
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
        CREATE INDEX IF NOT EXISTS idx_facts_task ON facts(task_id);
        CREATE INDEX IF NOT EXISTS idx_results_task ON results(task_id);
        CREATE INDEX IF NOT EXISTS idx_signals_subject ON signals(subject);
        CREATE INDEX IF NOT EXISTS idx_inhibitions_subject ON inhibitions(subject);
        CREATE INDEX IF NOT EXISTS idx_votes_task ON votes(task_id);
        CREATE INDEX IF NOT EXISTS idx_scout_facts_task ON scout_facts(task_id);
        CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS runs(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at TEXT NOT NULL,
          note TEXT
        );
        CREATE TABLE IF NOT EXISTS deps(
          task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          depends_on INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          PRIMARY KEY(task_id, depends_on)
        );
        """
    )
    columns = {row["name"] for row in con.execute("PRAGMA table_info(tasks)")}
    if "priority" not in columns:
        con.execute("ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")
    if "quorum_required" not in columns:
        con.execute(
            "ALTER TABLE tasks ADD COLUMN quorum_required INTEGER NOT NULL DEFAULT 1"
        )
    if "task_class" not in columns:
        con.execute(
            "ALTER TABLE tasks ADD COLUMN task_class TEXT NOT NULL DEFAULT 'general'"
        )
    task_cols = {row["name"] for row in con.execute("PRAGMA table_info(tasks)")}
    if "run_id" not in task_cols:
        con.execute("ALTER TABLE tasks ADD COLUMN run_id INTEGER REFERENCES runs(id)")
    vcols = {row["name"] for row in con.execute("PRAGMA table_info(votes)")}
    if "fingerprint" not in vcols:
        con.execute("ALTER TABLE votes ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ''")
    scols = {row["name"] for row in con.execute("PRAGMA table_info(scout_facts)")}
    if "confirmed" not in scols:
        con.execute(
            "ALTER TABLE scout_facts ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0"
        )
    if "confirmed_by" not in scols:
        con.execute("ALTER TABLE scout_facts ADD COLUMN confirmed_by TEXT")
    if "confirmed_ref" not in scols:
        con.execute("ALTER TABLE scout_facts ADD COLUMN confirmed_ref TEXT")
    row = con.execute("SELECT v FROM meta WHERE k='schema_version'").fetchone()
    if row is None:
        con.execute(
            "INSERT INTO meta(k,v) VALUES('schema_version',?)",
            (str(EXPECTED_SCHEMA_VERSION),),
        )


def event(
    con: sqlite3.Connection,
    typ: str,
    task_id: int | None = None,
    payload: str | None = None,
) -> None:
    con.execute(
        "INSERT INTO events(ts,type,task_id,payload) VALUES(?,?,?,?)",
        (now_iso(), typ, task_id, payload),
    )


def expire_claims(con: sqlite3.Connection) -> int:
    expired = con.execute(
        "SELECT c.task_id,c.worker FROM claims c JOIN tasks t ON t.id=c.task_id WHERE c.expires_at<=? AND t.state='RUNNING'",
        (time.time(),),
    ).fetchall()
    if not expired:
        return 0
    con.execute("BEGIN IMMEDIATE")
    try:
        for row in expired:
            con.execute(
                "UPDATE tasks SET state='READY',reason='lease-expired',updated_at=? WHERE id=? AND state='RUNNING'",
                (now_iso(), row["task_id"]),
            )
            con.execute("DELETE FROM claims WHERE task_id=?", (row["task_id"],))
            event(con, "EXPIRE", row["task_id"], row["worker"])
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    return len(expired)


def require_schema(con: sqlite3.Connection) -> None:
    try:
        con.execute("SELECT 1 FROM tasks LIMIT 1")
    except sqlite3.OperationalError:
        raise SystemExit("ERROR|BOARD_NOT_INITIALIZED")
    # Idempotent auto-migration: older boards lack biological tables/columns.
    # schema() uses CREATE IF NOT EXISTS + conditional ALTER TABLE, so it is
    # safe to run on every command and repairs stale DBs (e.g. watch/status
    # must not fail with "no such column: priority").
    schema(con)
    row = con.execute("SELECT v FROM meta WHERE k='schema_version'").fetchone()
    if row is None or row["v"] != str(EXPECTED_SCHEMA_VERSION):
        raise SystemExit(
            f"ERROR|SCHEMA_MISMATCH|expected={EXPECTED_SCHEMA_VERSION}|found={row['v'] if row else 'missing'}"
        )


def preflight_pass(con: sqlite3.Connection) -> bool:
    row = con.execute(
        "SELECT state,evidence FROM gates WHERE name='preflight'"
    ).fetchone()
    return bool(row and row["state"] == "PASS" and row["evidence"])


def effective_signal(
    con: sqlite3.Connection, subject: str, at: float | None = None
) -> int:
    at = time.time() if at is None else at
    row = con.execute(
        "SELECT COALESCE(SUM(delta),0) AS value FROM signals WHERE subject=? AND (expires_at IS NULL OR expires_at>?)",
        (subject, at),
    ).fetchone()
    return int(row["value"] or 0)


def effective_inhibition(
    con: sqlite3.Connection, subject: str, task_class: str, at: float | None = None
) -> int:
    at = time.time() if at is None else at
    row = con.execute(
        "SELECT COALESCE(SUM(penalty),0) AS value FROM inhibitions WHERE subject=? AND task_class=? AND expires_at>?",
        (subject, task_class, at),
    ).fetchone()
    return int(row["value"] or 0)


def implementation_worker(con: sqlite3.Connection, task_id: int) -> str | None:
    row = con.execute(
        "SELECT payload FROM events WHERE task_id=? AND type='CLAIM' ORDER BY id LIMIT 1",
        (task_id,),
    ).fetchone()
    return row["payload"].split("|", 1)[0] if row else None


def task_fingerprint(con: sqlite3.Connection, task_id: int) -> str:
    row = con.execute(
        "SELECT value FROM facts WHERE task_id=? AND key='fingerprint' ORDER BY id DESC LIMIT 1",
        (task_id,),
    ).fetchone()
    return row["value"] if row else ""


def quorum_status(
    con: sqlite3.Connection, task_id: int, at: float | None = None
) -> tuple[int, int, int]:
    at = time.time() if at is None else at
    task = get_task(con, task_id)
    own = implementation_worker(con, task_id)
    cur = task_fingerprint(con, task_id)
    rows = con.execute(
        "SELECT voter,COALESCE(fingerprint,'') AS fp FROM votes v JOIN workers w ON w.worker=v.voter "
        "WHERE v.task_id=? AND UPPER(v.status)='PASS' AND w.authorized=1 "
        "AND (v.expires_at IS NULL OR v.expires_at>?)",
        (task_id, at),
    ).fetchall()
    voters = {row["voter"] for row in rows if row["voter"] != own and row["fp"] == cur}
    stale = sum(1 for row in rows if row["voter"] != own and row["fp"] != cur)
    return len(voters), int(task["quorum_required"]), stale


def get_task(con: sqlite3.Connection, task_id: int) -> sqlite3.Row:
    row = con.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if not row:
        raise SystemExit(f"ERROR|TASK_NOT_FOUND|{task_id}")
    return row


def cmd_init(args: argparse.Namespace) -> None:
    con = connect(args.db)
    schema(con)
    print(f"BOARD|READY|{Path(args.db)}")


def create_task(args: argparse.Namespace, state: str) -> None:
    con = connect(args.db)
    require_schema(con)
    run_id = getattr(args, "run", None)
    if run_id is not None:
        exists = con.execute("SELECT 1 FROM runs WHERE id=?", (run_id,)).fetchone()
        if not exists:
            raise SystemExit(f"ERROR|RUN_NOT_FOUND|{run_id}")
    ts = now_iso()
    cur = con.execute(
        "INSERT INTO tasks(title,acceptance,state,ref,parent_id,created_at,updated_at,priority,quorum_required,task_class,run_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (
            args.title.strip(),
            args.acceptance.strip(),
            state,
            args.ref,
            getattr(args, "parent", None),
            ts,
            ts,
            getattr(args, "priority", 0),
            getattr(args, "quorum", 1),
            getattr(args, "task_class", "general"),
            run_id,
        ),
    )
    task_id = cur.lastrowid
    event(con, "TASK", task_id, state)
    print(f"T|{task_id}|{state}|{args.title.strip()}")


def cmd_add(args: argparse.Namespace) -> None:
    create_task(args, "READY")


def cmd_propose(args: argparse.Namespace) -> None:
    create_task(args, "PROPOSED")


def cmd_admit(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    row = get_task(con, args.id)
    if row["state"] != "PROPOSED":
        raise SystemExit(
            f"ERROR|INVALID_STATE|{args.id}|{row['state']}|expected=PROPOSED"
        )
    if not args.evidence.strip():
        raise SystemExit("ERROR|ADMISSION_EVIDENCE_REQUIRED")
    con.execute(
        "UPDATE tasks SET state='READY',reason=NULL,updated_at=? WHERE id=?",
        (now_iso(), args.id),
    )
    event(con, "ADMIT", args.id, args.evidence.strip())
    print(f"T|{args.id}|READY|admitted|ref:{args.evidence.strip()}")


def cmd_reject(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    row = get_task(con, args.id)
    if row["state"] not in {"PROPOSED", "READY", "BLOCKED", "FAILED"}:
        raise SystemExit(f"ERROR|INVALID_STATE|{args.id}|{row['state']}")
    con.execute(
        "UPDATE tasks SET state='REJECTED',reason=?,updated_at=? WHERE id=?",
        (args.reason.strip(), now_iso(), args.id),
    )
    con.execute("DELETE FROM claims WHERE task_id=?", (args.id,))
    event(con, "REJECT", args.id, args.reason.strip())
    print(f"T|{args.id}|REJECTED|{args.reason.strip()}")


def deps_blocked(con: sqlite3.Connection, task_id: int) -> bool:
    dep_rows = con.execute(
        "SELECT depends_on FROM deps WHERE task_id=?", (task_id,)
    ).fetchall()
    for dep_row in dep_rows:
        dep_task = con.execute(
            "SELECT state FROM tasks WHERE id=?", (dep_row["depends_on"],)
        ).fetchone()
        if not dep_task or dep_task["state"] != "DONE":
            return True
    return False


def cmd_next(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    expire_claims(con)
    if not preflight_pass(con):
        print("BLOCKED|PREFLIGHT_NOT_PASS")
        return
    rows = con.execute(
        "SELECT id,title,acceptance,ref,priority FROM tasks WHERE state='READY'"
    ).fetchall()
    total_ready = len(rows)
    eligible = [r for r in rows if not deps_blocked(con, r["id"])]
    blocked = total_ready - len(eligible)
    rows = sorted(
        eligible,
        key=lambda row: (
            -(int(row["priority"]) + effective_signal(con, "T" + str(row["id"]))),
            row["id"],
        ),
    )[: args.limit]
    if not rows:
        if blocked > 0:
            print(f"T|NONE|blocked:{blocked}")
        else:
            print("T|NONE")
        return
    for row in rows:
        ref = f"|ref:{row['ref']}" if row["ref"] else ""
        print(f"T|{row['id']}|READY|{row['title']}|ac:{row['acceptance']}{ref}")


def cmd_claim(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    expire_claims(con)
    if not preflight_pass(con):
        raise SystemExit("ERROR|PREFLIGHT_NOT_PASS")
    if args.lease < 30:
        raise SystemExit("ERROR|LEASE_TOO_SHORT|min=30")
    existing = con.execute(
        "SELECT worker,expires_at FROM claims WHERE task_id=?", (args.id,)
    ).fetchone()
    if (
        existing
        and existing["worker"] == args.worker
        and existing["expires_at"] > time.time()
    ):
        task_row = get_task(con, args.id)
        if task_row["state"] == "RUNNING":
            expiry = time.time() + args.lease
            con.execute(
                "UPDATE claims SET expires_at=?,claimed_at=? WHERE task_id=?",
                (expiry, now_iso(), args.id),
            )
            event(con, "RENEW", args.id, f"{args.worker}|lease={args.lease}")
            expiry_iso = (
                datetime.fromtimestamp(expiry, timezone.utc)
                .replace(microsecond=0)
                .isoformat()
                .replace("+00:00", "Z")
            )
            print(f"C|{args.id}|{args.worker}|until:{expiry_iso}|renewed")
            return
    con.execute("BEGIN IMMEDIATE")
    try:
        row = get_task(con, args.id)
        if row["state"] != "READY":
            raise RuntimeError(f"INVALID_STATE|{row['state']}")
        expiry = time.time() + args.lease
        con.execute(
            "UPDATE tasks SET state='RUNNING',reason=NULL,updated_at=? WHERE id=?",
            (now_iso(), args.id),
        )
        con.execute(
            "INSERT INTO claims(task_id,worker,expires_at,claimed_at) VALUES(?,?,?,?)",
            (args.id, args.worker, expiry, now_iso()),
        )
        con.execute(
            "INSERT INTO workers(worker) VALUES(?) ON CONFLICT(worker) DO NOTHING",
            (args.worker,),
        )
        event(con, "CLAIM", args.id, f"{args.worker}|lease={args.lease}")
        con.execute("COMMIT")
    except RuntimeError as exc:
        con.execute("ROLLBACK")
        raise SystemExit(f"ERROR|{exc}|task={args.id}")
    except Exception:
        con.execute("ROLLBACK")
        raise
    expiry_iso = (
        datetime.fromtimestamp(expiry, timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )
    print(f"C|{args.id}|{args.worker}|until:{expiry_iso}")


def cmd_fact(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    get_task(con, args.id)
    con.execute(
        "INSERT INTO facts(task_id,key,value,ref,created_at) VALUES(?,?,?,?,?)",
        (args.id, args.key, args.value, args.ref, now_iso()),
    )
    event(con, "FACT", args.id, args.key)
    suffix = f"|ref:{args.ref}" if args.ref else ""
    print(f"F|{args.id}|{args.key}={args.value}{suffix}")


def cmd_result(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    row = get_task(con, args.id)
    if row["state"] != "RUNNING":
        raise SystemExit(
            f"ERROR|INVALID_STATE|{args.id}|{row['state']}|expected=RUNNING"
        )
    if not args.ref.strip():
        raise SystemExit("ERROR|RESULT_EVIDENCE_REQUIRED")
    status = args.status.upper()
    dup = con.execute(
        "SELECT id FROM results WHERE task_id=? AND kind=? AND status=? AND ref=? LIMIT 1",
        (args.id, args.kind, status, args.ref.strip()),
    ).fetchone()
    if dup:
        print(f"R|{args.id}|{args.kind}|{status}|ref:{args.ref.strip()}")
        return
    con.execute(
        "INSERT INTO results(task_id,kind,status,value,ref,created_at) VALUES(?,?,?,?,?,?)",
        (args.id, args.kind, status, args.value, args.ref.strip(), now_iso()),
    )
    event(con, "RESULT", args.id, f"{args.kind}|{status}|{args.ref.strip()}")
    print(f"R|{args.id}|{args.kind}|{status}|ref:{args.ref.strip()}")


def cmd_signal(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    expires = None if args.ttl is None else time.time() + args.ttl
    con.execute(
        "INSERT INTO signals(subject,delta,reason,source,created_at,expires_at,persistent) VALUES(?,?,?,?,?,?,?)",
        (
            args.subject,
            args.delta,
            args.reason,
            args.source,
            now_iso(),
            expires,
            int(args.persistent),
        ),
    )
    event(
        con, "SIGNAL", None, f"{args.subject}|{args.delta}|{args.reason}|{args.source}"
    )
    print(
        f"SIGNAL|{args.subject}|{args.delta:+d}|{args.reason}|effective:{effective_signal(con, args.subject)}"
    )


def cmd_inhibit(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    if args.ttl <= 0 or args.penalty < 0:
        raise SystemExit("ERROR|INVALID_INHIBITION")
    con.execute(
        "INSERT INTO inhibitions(subject,task_class,penalty,reason,source,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
        (
            args.subject,
            args.task_class,
            args.penalty,
            args.reason,
            args.source,
            now_iso(),
            time.time() + args.ttl,
        ),
    )
    event(
        con,
        "INHIBIT",
        None,
        f"{args.subject}|{args.task_class}|{args.penalty}|ttl:{args.ttl}",
    )
    print(
        f"INHIBIT|{args.subject}|{args.task_class}|{args.penalty}|effective:{effective_inhibition(con, args.subject, args.task_class)}"
    )


def cmd_register_worker(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    try:
        capabilities = json.loads(args.capabilities)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"ERROR|CAPABILITIES_INVALID|{exc}")
    if not isinstance(capabilities, list) or not all(
        isinstance(x, str) and x for x in capabilities
    ):
        raise SystemExit("ERROR|CAPABILITIES_INVALID")
    con.execute(
        "INSERT INTO workers(worker,capabilities,authorized,role) VALUES(?,?,?,?) ON CONFLICT(worker) DO UPDATE SET capabilities=excluded.capabilities,authorized=excluded.authorized,role=excluded.role",
        (
            args.worker,
            json.dumps(sorted(set(capabilities))),
            int(args.authorized),
            args.role,
        ),
    )
    print(
        f"WORKER|{args.worker}|registered|authorized:{int(args.authorized)}|capabilities:{','.join(sorted(set(capabilities)))}"
    )


def cmd_vote(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    get_task(con, args.id)
    worker = con.execute(
        "SELECT authorized FROM workers WHERE worker=?", (args.voter,)
    ).fetchone()
    if not worker or not worker["authorized"]:
        raise SystemExit("ERROR|VOTER_NOT_AUTHORIZED")
    if not args.ref.strip():
        raise SystemExit("ERROR|VOTE_EVIDENCE_REQUIRED")
    fp = (
        args.fingerprint
        if args.fingerprint is not None
        else task_fingerprint(con, args.id)
    )
    con.execute(
        "INSERT INTO votes(task_id,voter,status,ref,created_at,expires_at,fingerprint) VALUES(?,?,?,?,?,?,?)",
        (
            args.id,
            args.voter,
            args.status.upper(),
            args.ref.strip(),
            now_iso(),
            None if args.ttl is None else time.time() + args.ttl,
            fp,
        ),
    )
    count, required, stale = quorum_status(con, args.id)
    print(
        f"VOTE|T{args.id}|{args.voter}|{args.status.upper()}|quorum:{count}/{required} (stale:{stale})"
    )


def cmd_quorum(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    count, required, stale = quorum_status(con, args.id)
    passed_gate = True
    if args.gate:
        gate = con.execute(
            "SELECT state FROM gates WHERE name=?", (args.gate.lower(),)
        ).fetchone()
        passed_gate = bool(gate and gate["state"] == "PASS")
    state = "PASS" if count >= required and passed_gate else "FAIL"
    print(
        f"QUORUM|T{args.id}|{count}/{required} (stale:{stale})|gate:{'PASS' if passed_gate else 'FAIL'}|{state}"
    )
    if state != "PASS":
        raise SystemExit(2)


def cmd_scout(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    worker = con.execute(
        "SELECT role,authorized FROM workers WHERE worker=?", (args.scout,)
    ).fetchone()
    if not worker or not worker["authorized"] or worker["role"] != "scout":
        raise SystemExit("ERROR|SCOUT_NOT_REGISTERED")
    if not args.ref.strip():
        raise SystemExit("ERROR|SCOUT_EVIDENCE_REQUIRED")
    con.execute(
        "INSERT INTO scout_facts(task_id,scout,fact,confidence,ref,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
        (
            args.id,
            args.scout,
            args.fact,
            args.confidence,
            args.ref.strip(),
            now_iso(),
            None if args.ttl is None else time.time() + args.ttl,
        ),
    )
    event(
        con,
        "SCOUT_FACT",
        args.id,
        f"{args.scout}|{args.fact}|confidence:{args.confidence}",
    )
    print(
        f"SCOUT_FACT|T{args.id}|{args.scout}|confidence:{args.confidence}|ref:{args.ref.strip()}"
    )


def cmd_scout_confirm(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    row = con.execute("SELECT * FROM scout_facts WHERE id=?", (args.id,)).fetchone()
    if not row:
        raise SystemExit(f"ERROR|SCOUT_FACT_NOT_FOUND|{args.id}")
    if args.reviewer == row["scout"]:
        raise SystemExit("ERROR|SCOUT_SELF_CONFIRM_REJECTED")
    rev = con.execute(
        "SELECT authorized FROM workers WHERE worker=?", (args.reviewer,)
    ).fetchone()
    if not rev or not rev["authorized"]:
        raise SystemExit("ERROR|REVIEWER_NOT_AUTHORIZED")
    if not args.ref.strip():
        raise SystemExit("ERROR|SCOUT_CONFIRM_EVIDENCE_REQUIRED")
    con.execute(
        "UPDATE scout_facts SET confirmed=1,confirmed_by=?,confirmed_ref=? WHERE id=?",
        (args.reviewer, args.ref.strip(), args.id),
    )
    event(con, "SCOUT_CONFIRM", row["task_id"], f"{args.id}|{args.reviewer}")
    print(f"SCOUT_CONFIRMED|{args.id}|{args.reviewer}|ref:{args.ref.strip()}")


def cmd_match(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    task = get_task(con, args.id)
    required = set(filter(None, (x.strip() for x in args.requires.split(","))))
    candidates = []
    for row in con.execute(
        "SELECT worker,capabilities FROM workers WHERE authorized=1 AND role!='scout' ORDER BY worker"
    ):
        capabilities = set(json.loads(row["capabilities"]))
        if not required.issubset(capabilities):
            continue
        penalty = effective_inhibition(con, row["worker"], task["task_class"])
        candidates.append((penalty, -len(capabilities - required), row["worker"]))
    if not candidates:
        print("MATCH|NONE")
        return
    candidates.sort()
    penalty, _, worker = candidates[0]
    print(
        f"MATCH|T{args.id}|{worker}|inhibition:{penalty}|candidates:{len(candidates)}"
    )


def cmd_dep(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    get_task(con, args.id)
    get_task(con, args.on)
    if args.id == args.on:
        raise SystemExit("ERROR|SELF_DEPENDENCY")
    reverse = con.execute(
        "SELECT 1 FROM deps WHERE task_id=? AND depends_on=?",
        (args.on, args.id),
    ).fetchone()
    if reverse:
        raise SystemExit(f"ERROR|DEPENDENCY_CYCLE|{args.id}|{args.on}")
    con.execute(
        "INSERT OR IGNORE INTO deps(task_id,depends_on) VALUES(?,?)",
        (args.id, args.on),
    )
    event(con, "DEP", args.id, f"depends_on={args.on}")
    print(f"DEP|{args.id}|on:{args.on}")


def cmd_renew(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    expire_claims(con)
    if args.lease < 30:
        raise SystemExit("ERROR|LEASE_TOO_SHORT|min=30")
    row = con.execute(
        "SELECT worker,expires_at FROM claims WHERE task_id=?", (args.id,)
    ).fetchone()
    task = get_task(con, args.id)
    if (
        not row
        or row["worker"] != args.worker
        or row["expires_at"] <= time.time()
        or task["state"] != "RUNNING"
    ):
        raise SystemExit(f"ERROR|RENEW_DENIED|task={args.id}")
    expiry = time.time() + args.lease
    con.execute(
        "UPDATE claims SET expires_at=?,claimed_at=? WHERE task_id=?",
        (expiry, now_iso(), args.id),
    )
    event(con, "RENEW", args.id, f"{args.worker}|lease={args.lease}")
    expiry_iso = (
        datetime.fromtimestamp(expiry, timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )
    print(f"C|{args.id}|{args.worker}|until:{expiry_iso}|renewed")


def cmd_run_create(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    cur = con.execute(
        "INSERT INTO runs(created_at,note) VALUES(?,?)",
        (now_iso(), args.note),
    )
    run_id = cur.lastrowid
    event(con, "RUN", None, f"{run_id}|{args.note or ''}")
    print(f"RUN|{run_id}")


def cmd_run_current(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    row = con.execute("SELECT id,note FROM runs ORDER BY id DESC LIMIT 1").fetchone()
    if not row:
        print("RUN|NONE")
        return
    note = f"|{row['note']}" if row["note"] else ""
    print(f"RUN|{row['id']}{note}")


def current_run_id(con: sqlite3.Connection) -> int | None:
    row = con.execute("SELECT id FROM runs ORDER BY id DESC LIMIT 1").fetchone()
    return int(row["id"]) if row else None


def run_counts(con: sqlite3.Connection) -> str:
    rows = con.execute(
        "SELECT COALESCE(run_id,-1) AS r,COUNT(*) n FROM tasks GROUP BY r ORDER BY r"
    ).fetchall()
    if not rows:
        return "none"
    parts = []
    for row in rows:
        label = "legacy" if int(row["r"]) == -1 else f"run:{row['r']}"
        parts.append(f"{label}={row['n']}")
    return ",".join(parts)


def transition_with_reason(
    args: argparse.Namespace, target: str, event_type: str
) -> None:
    con = connect(args.db)
    require_schema(con)
    row = get_task(con, args.id)
    allowed = {"RUNNING"} if target in {"BLOCKED", "FAILED"} else {"BLOCKED", "FAILED"}
    if row["state"] not in allowed:
        raise SystemExit(
            f"ERROR|INVALID_STATE|{args.id}|{row['state']}|target={target}"
        )
    reason = getattr(args, "reason", None)
    con.execute(
        "UPDATE tasks SET state=?,reason=?,updated_at=? WHERE id=?",
        (target, reason, now_iso(), args.id),
    )
    con.execute("DELETE FROM claims WHERE task_id=?", (args.id,))
    event(con, event_type, args.id, reason)
    print(f"T|{args.id}|{target}" + (f"|{reason}" if reason else ""))


def cmd_block(args: argparse.Namespace) -> None:
    transition_with_reason(args, "BLOCKED", "BLOCK")


def cmd_fail(args: argparse.Namespace) -> None:
    transition_with_reason(args, "FAILED", "FAIL")


def cmd_retry(args: argparse.Namespace) -> None:
    transition_with_reason(args, "READY", "RETRY")


def cmd_done(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    row = get_task(con, args.id)
    if row["state"] != "RUNNING":
        raise SystemExit(
            f"ERROR|INVALID_STATE|{args.id}|{row['state']}|expected=RUNNING"
        )
    owner = implementation_worker(con, args.id)
    owner_row = (
        con.execute("SELECT role FROM workers WHERE worker=?", (owner,)).fetchone()
        if owner
        else None
    )
    if (owner_row and owner_row["role"] == "scout") or args.role == "scout":
        raise SystemExit("ERROR|SCOUT_CANNOT_COMPLETE_IMPLEMENTATION")
    passed = con.execute(
        "SELECT 1 FROM results WHERE task_id=? AND UPPER(status)='PASS' AND TRIM(ref)<>'' LIMIT 1",
        (args.id,),
    ).fetchone()
    if not passed:
        raise SystemExit(f"ERROR|PASS_EVIDENCE_REQUIRED|task={args.id}")
    count, required, _stale = quorum_status(con, args.id)
    if count < required:
        raise SystemExit(f"ERROR|QUORUM_NOT_MET|task={args.id}|{count}/{required}")
    con.execute(
        "UPDATE tasks SET state='DONE',reason=NULL,updated_at=? WHERE id=?",
        (now_iso(), args.id),
    )
    con.execute("DELETE FROM claims WHERE task_id=?", (args.id,))
    event(con, "DONE", args.id, "PASS")
    print(f"D|{args.id}|PASS")


def cmd_gate(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    state = args.state.upper()
    if state not in GATE_STATES:
        raise SystemExit(f"ERROR|INVALID_GATE_STATE|{state}")
    evidence = args.evidence.strip() if args.evidence else None
    if state == "PASS" and not evidence:
        raise SystemExit("ERROR|PASS_GATE_EVIDENCE_REQUIRED")
    con.execute(
        "INSERT INTO gates(name,state,evidence,updated_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET state=excluded.state,evidence=excluded.evidence,updated_at=excluded.updated_at",
        (args.name.lower(), state, evidence, now_iso()),
    )
    event(con, "GATE", None, f"{args.name.lower()}|{state}|{evidence or ''}")
    suffix = f"|ref:{evidence}" if evidence else ""
    print(f"G|{args.name.lower()}|{state}{suffix}")


def cmd_status(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    expired = expire_claims(con)
    counts = {
        row["state"]: row["n"]
        for row in con.execute("SELECT state,COUNT(*) n FROM tasks GROUP BY state")
    }
    gates = [
        f"{row['name']}={row['state']}"
        for row in con.execute("SELECT name,state FROM gates ORDER BY name")
    ]
    task_part = (
        ",".join(
            f"{state}:{counts.get(state, 0)}"
            for state in sorted(TASK_STATES)
            if counts.get(state, 0)
        )
        or "none"
    )
    print(
        f"STATUS|tasks:{task_part}|gates:{','.join(gates) if gates else 'none'}|expired:{expired}|run:{current_run_id(con) if current_run_id(con) is not None else 'none'}|runs:{run_counts(con)}"
    )


def cmd_snapshot(args: argparse.Namespace) -> None:
    """Small read-only JSON view for the OpenCode observer."""
    con = connect(args.db)
    require_schema(con)
    expire_claims(con)
    tasks = []
    for row in con.execute(
        "SELECT id,title,acceptance,state,reason,updated_at,priority,quorum_required,task_class,run_id FROM tasks ORDER BY id"
    ).fetchall():
        item = dict(row)
        item["signal"] = effective_signal(con, f"T{row['id']}")
        _n, _req, _ = quorum_status(con, row["id"])
        item["quorum"] = f"{_n}/{_req}"
        tasks.append(item)
    deps = [
        dict(row)
        for row in con.execute(
            "SELECT task_id,depends_on FROM deps ORDER BY task_id,depends_on"
        ).fetchall()
    ]
    runs = [
        dict(row)
        for row in con.execute(
            "SELECT id,created_at,note FROM runs ORDER BY id"
        ).fetchall()
    ]
    workers = [
        dict(row)
        for row in con.execute(
            """SELECT c.worker,c.task_id,c.expires_at,t.title,t.state
        FROM claims c JOIN tasks t ON t.id=c.task_id WHERE t.state='RUNNING' AND c.expires_at>? ORDER BY c.worker""",
            (time.time(),),
        ).fetchall()
    ]
    gates = [
        dict(row)
        for row in con.execute(
            "SELECT name,state,evidence,updated_at FROM gates ORDER BY name"
        ).fetchall()
    ]
    events = [
        dict(row)
        for row in con.execute(
            "SELECT ts,type,task_id,payload FROM events ORDER BY id DESC LIMIT 20"
        ).fetchall()
    ]
    inhibitions = [
        dict(row)
        for row in con.execute(
            "SELECT subject,task_class,penalty,reason,expires_at FROM inhibitions WHERE expires_at>? ORDER BY subject",
            (time.time(),),
        ).fetchall()
    ]
    scouts = [
        dict(row)
        for row in con.execute(
            "SELECT id,task_id,scout,fact,confidence,ref,COALESCE(confirmed,0) AS confirmed,confirmed_by FROM scout_facts WHERE expires_at IS NULL OR expires_at>? ORDER BY id DESC LIMIT 20",
            (time.time(),),
        ).fetchall()
    ]
    scouts_confirmed = sum(1 for s in scouts if s["confirmed"])
    print(
        json.dumps(
            {
                "tasks": tasks,
                "deps": deps,
                "runs": runs,
                "current_run": current_run_id(con),
                "schema_version": EXPECTED_SCHEMA_VERSION,
                "workers": workers,
                "gates": gates,
                "inhibitions": inhibitions,
                "scouts": scouts,
                "scouts_confirmed": scouts_confirmed,
                "recent_events": events,
            },
            separators=(",", ":"),
        )
    )


def _clip(value: object, width: int) -> str:
    text = "" if value is None else str(value).replace("\n", " ").strip()
    if len(text) <= width:
        return text
    return text[: max(0, width - 1)] + "…"


def _lease_left(expires_at: float) -> str:
    seconds = max(0, int(expires_at - time.time()))
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def dashboard_lines(con: sqlite3.Connection, args: argparse.Namespace) -> list[str]:
    expired = expire_claims(con)
    counts = {
        row["state"]: row["n"]
        for row in con.execute("SELECT state,COUNT(*) n FROM tasks GROUP BY state")
    }
    gates = con.execute("SELECT name,state FROM gates ORDER BY name").fetchall()
    claims = con.execute(
        """
        SELECT c.worker,c.task_id,c.expires_at,t.title
        FROM claims c JOIN tasks t ON t.id=c.task_id
        WHERE t.state='RUNNING' AND c.expires_at>?
        ORDER BY c.worker,c.task_id
        """,
        (time.time(),),
    ).fetchall()
    work = con.execute(
        """
        SELECT id,state,title,reason,priority,quorum_required
        FROM tasks
        WHERE state IN ('PROPOSED','READY','RUNNING','BLOCKED','FAILED')
        ORDER BY CASE state
          WHEN 'RUNNING' THEN 0 WHEN 'READY' THEN 1 WHEN 'BLOCKED' THEN 2
          WHEN 'FAILED' THEN 3 ELSE 4 END, id
        LIMIT ?
        """,
        (args.tasks,),
    ).fetchall()
    events = con.execute(
        "SELECT ts,type,task_id,payload FROM events ORDER BY id DESC LIMIT ?",
        (args.events,),
    ).fetchall()

    total = sum(counts.values())
    done = counts.get("DONE", 0)
    summary_states = [
        "PROPOSED",
        "READY",
        "RUNNING",
        "BLOCKED",
        "FAILED",
        "DONE",
        "REJECTED",
    ]
    summary = (
        "  ".join(
            f"{state}:{counts.get(state, 0)}"
            for state in summary_states
            if counts.get(state, 0)
        )
        or "none"
    )
    gate_text = "  ".join(f"{row['name']}:{row['state']}" for row in gates) or "none"

    lines = [
        "MINIMAL BLACKBOARD SWARM — LIVE",
        f"DB: {Path(args.db)}",
        f"UTC: {now_iso()}   tasks:{total} done:{done} active-workers:{len(claims)} expired-now:{expired}",
        f"STATES  {summary}",
        f"GATES   {gate_text}",
        f"RUN     current:{current_run_id(con) if current_run_id(con) is not None else 'none'} counts:{run_counts(con)}",
        "",
        f"ACTIVE WORKERS / CLAIMS ({len(claims)})",
        "WORKER               TASK   LEASE     CURRENT TASK",
    ]
    if claims:
        for row in claims:
            lines.append(
                f"{_clip(row['worker'], 20):20} T{row['task_id']:<5} {_lease_left(row['expires_at']):9} {_clip(row['title'], 70)}"
            )
    else:
        lines.append("(none)")

    lines += [
        "",
        f"OPEN BLACKBOARD TASKS (showing up to {args.tasks})",
        "TASK    STATE      TITLE / BLOCKER",
    ]
    if work:
        for row in work:
            signal = effective_signal(con, "T" + str(row["id"]))
            detail = f"{row['title']} [p={row['priority']} q={row['quorum_required']} s={signal}]"
            if row["reason"]:
                detail += f" — {row['reason']}"
            lines.append(f"T{row['id']:<6} {row['state']:<10} {_clip(detail, 90)}")
    else:
        lines.append("(none)")

    active_inhibitions = con.execute(
        "SELECT subject,task_class,penalty FROM inhibitions WHERE expires_at>? ORDER BY subject",
        (time.time(),),
    ).fetchall()
    scouts = con.execute(
        "SELECT task_id,scout,fact FROM scout_facts WHERE expires_at IS NULL OR expires_at>? ORDER BY id DESC LIMIT 5",
        (time.time(),),
    ).fetchall()
    lines += [
        "",
        "BIOLOGICAL COORDINATION",
        "SIGNALS are scheduling data only; quorum is independent PASS votes",
    ]
    lines.append(
        "INHIBITIONS "
        + (
            "  ".join(
                f"{r['subject']}/{r['task_class']}:-{r['penalty']}"
                for r in active_inhibitions
            )
            or "none"
        )
    )
    lines.append(
        "SCOUTS      "
        + (
            "  ".join(
                f"T{r['task_id']}:{r['scout']}:{_clip(r['fact'], 35)}" for r in scouts
            )
            or "none"
        )
    )

    lines += [
        "",
        f"RECENT EVENTS ({args.events})",
        "TIME                  EVENT      TASK    DETAIL",
    ]
    if events:
        for row in events:
            task = f"T{row['task_id']}" if row["task_id"] is not None else "-"
            lines.append(
                f"{_clip(row['ts'], 20):20} {_clip(row['type'], 10):10} {task:<7} {_clip(row['payload'], 80)}"
            )
    else:
        lines.append("(none)")

    if not args.once:
        lines += ["", f"Refresh: {args.interval:g}s  •  Ctrl-C to exit"]
    return lines


def cmd_watch(args: argparse.Namespace) -> None:
    if args.interval <= 0:
        raise SystemExit("ERROR|WATCH_INTERVAL_MUST_BE_POSITIVE")
    if args.tasks < 1 or args.events < 1:
        raise SystemExit("ERROR|WATCH_LIMITS_MUST_BE_POSITIVE")
    con = connect(args.db)
    require_schema(con)
    try:
        while True:
            lines = dashboard_lines(con, args)
            if not args.once:
                # ANSI clear + cursor home; no curses or third-party dependency.
                print("\033[2J\033[H", end="")
            print("\n".join(lines), flush=True)
            if args.once:
                return
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nWATCH|STOPPED")


def cmd_green(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    expire_claims(con)
    required = [x.strip().lower() for x in args.require.split(",") if x.strip()]
    if not required:
        raise SystemExit("ERROR|REQUIRED_GATES_EMPTY")
    missing = []
    for name in required:
        row = con.execute(
            "SELECT state,evidence FROM gates WHERE name=?", (name,)
        ).fetchone()
        if not row or row["state"] != "PASS" or not row["evidence"]:
            missing.append(name)
    open_rows = con.execute(
        "SELECT state,COUNT(*) n FROM tasks WHERE state IN ('PROPOSED','READY','RUNNING','BLOCKED','FAILED') GROUP BY state"
    ).fetchall()
    open_count = sum(row["n"] for row in open_rows)
    if not missing and open_count == 0:
        print("PROJECT_GREEN=YES")
        return
    reasons = []
    if missing:
        reasons.append("gates=" + ",".join(missing))
    if open_count:
        reasons.append(
            "open=" + ",".join(f"{row['state']}:{row['n']}" for row in open_rows)
        )
    print("PROJECT_GREEN=NO|" + "|".join(reasons))
    raise SystemExit(2)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Minimal SQLite blackboard for agent coordination"
    )
    p.add_argument("--db", default=".agent/board.sqlite", help="SQLite board path")
    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("init")
    sp.set_defaults(func=cmd_init)

    for name, func in (("add", cmd_add), ("propose", cmd_propose)):
        sp = sub.add_parser(name)
        sp.add_argument("title")
        sp.add_argument("--acceptance", required=True)
        sp.add_argument("--ref")
        sp.add_argument("--priority", type=int, default=0)
        sp.add_argument("--quorum", type=int, default=1)
        sp.add_argument("--task-class", default="general")
        sp.add_argument("--run", type=int, default=None)
        if name == "propose":
            sp.add_argument("--parent", type=int)
        sp.set_defaults(func=func)

    sp = sub.add_parser("admit")
    sp.add_argument("id", type=int)
    sp.add_argument("--evidence", required=True)
    sp.set_defaults(func=cmd_admit)

    sp = sub.add_parser("reject")
    sp.add_argument("id", type=int)
    sp.add_argument("--reason", required=True)
    sp.set_defaults(func=cmd_reject)

    sp = sub.add_parser("next")
    sp.add_argument("--limit", type=int, default=1)
    sp.set_defaults(func=cmd_next)

    sp = sub.add_parser("claim")
    sp.add_argument("id", type=int)
    sp.add_argument("--worker", required=True)
    sp.add_argument("--lease", type=int, default=900)
    sp.set_defaults(func=cmd_claim)

    sp = sub.add_parser("renew")
    sp.add_argument("id", type=int)
    sp.add_argument("--worker", required=True)
    sp.add_argument("--lease", type=int, default=900)
    sp.set_defaults(func=cmd_renew)

    sp = sub.add_parser("dep")
    sp.add_argument("id", type=int)
    sp.add_argument("--on", type=int, required=True)
    sp.set_defaults(func=cmd_dep)

    sp = sub.add_parser("run-create")
    sp.add_argument("--note", default=None)
    sp.set_defaults(func=cmd_run_create)

    sp = sub.add_parser("run-current")
    sp.set_defaults(func=cmd_run_current)

    sp = sub.add_parser("fact")
    sp.add_argument("id", type=int)
    sp.add_argument("key")
    sp.add_argument("value")
    sp.add_argument("--ref")
    sp.set_defaults(func=cmd_fact)

    sp = sub.add_parser("result")
    sp.add_argument("id", type=int)
    sp.add_argument("kind")
    sp.add_argument("status")
    sp.add_argument("--ref", required=True)
    sp.add_argument("--value")
    sp.set_defaults(func=cmd_result)

    sp = sub.add_parser("signal")
    sp.add_argument("subject")
    sp.add_argument("delta", type=int)
    sp.add_argument("reason")
    sp.add_argument("--source", required=True)
    sp.add_argument("--ttl", type=float)
    sp.add_argument("--persistent", action="store_true")
    sp.set_defaults(func=cmd_signal)

    sp = sub.add_parser("inhibit")
    sp.add_argument("subject")
    sp.add_argument("task_class")
    sp.add_argument("penalty", type=int)
    sp.add_argument("reason")
    sp.add_argument("--source", required=True)
    sp.add_argument("--ttl", type=float, required=True)
    sp.set_defaults(func=cmd_inhibit)

    sp = sub.add_parser("register-worker")
    sp.add_argument("worker")
    sp.add_argument("--capabilities", default="[]")
    sp.add_argument("--role", choices=("worker", "scout"), default="worker")
    sp.add_argument("--authorized", action=argparse.BooleanOptionalAction, default=True)
    sp.set_defaults(func=cmd_register_worker)

    sp = sub.add_parser("vote")
    sp.add_argument("id", type=int)
    sp.add_argument("voter")
    sp.add_argument("status")
    sp.add_argument("--ref", required=True)
    sp.add_argument("--ttl", type=float)
    sp.add_argument("--fingerprint", default=None)
    sp.set_defaults(func=cmd_vote)

    sp = sub.add_parser("quorum")
    sp.add_argument("id", type=int)
    sp.add_argument("--gate")
    sp.set_defaults(func=cmd_quorum)

    sp = sub.add_parser("scout")
    sp.add_argument("id", type=int)
    sp.add_argument("scout")
    sp.add_argument("fact")
    sp.add_argument("confidence", type=float)
    sp.add_argument("--ref", required=True)
    sp.add_argument("--ttl", type=float)
    sp.set_defaults(func=cmd_scout)

    sp = sub.add_parser("scout-confirm")
    sp.add_argument("id", type=int)
    sp.add_argument("--reviewer", required=True)
    sp.add_argument("--ref", required=True)
    sp.set_defaults(func=cmd_scout_confirm)

    sp = sub.add_parser("match")
    sp.add_argument("id", type=int)
    sp.add_argument("--requires", default="")
    sp.set_defaults(func=cmd_match)

    for name, func in (("block", cmd_block), ("fail", cmd_fail)):
        sp = sub.add_parser(name)
        sp.add_argument("id", type=int)
        sp.add_argument("reason")
        sp.set_defaults(func=func)

    sp = sub.add_parser("retry")
    sp.add_argument("id", type=int)
    sp.set_defaults(func=cmd_retry)

    sp = sub.add_parser("done")
    sp.add_argument("id", type=int)
    sp.add_argument("--role", choices=("worker", "scout"), default="worker")
    sp.set_defaults(func=cmd_done)

    sp = sub.add_parser("gate")
    sp.add_argument("name")
    sp.add_argument("state")
    sp.add_argument("--evidence")
    sp.set_defaults(func=cmd_gate)

    sp = sub.add_parser("status")
    sp.set_defaults(func=cmd_status)

    sp = sub.add_parser("snapshot", help="Read-only structured observer snapshot")
    sp.set_defaults(func=cmd_snapshot)

    sp = sub.add_parser(
        "watch", help="Live terminal view of workers, tasks, gates, and recent events"
    )
    sp.add_argument(
        "--interval", type=float, default=2.0, help="Refresh interval in seconds"
    )
    sp.add_argument(
        "--tasks", type=int, default=20, help="Maximum open tasks to display"
    )
    sp.add_argument("--events", type=int, default=12, help="Recent events to display")
    sp.add_argument("--once", action="store_true", help="Render one snapshot and exit")
    sp.set_defaults(func=cmd_watch)

    sp = sub.add_parser("green")
    sp.add_argument("--require", required=True, help="Comma-separated gate names")
    sp.set_defaults(func=cmd_green)
    return p


def main() -> None:
    args = parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
