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


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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
        CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state);
        CREATE INDEX IF NOT EXISTS idx_facts_task ON facts(task_id);
        CREATE INDEX IF NOT EXISTS idx_results_task ON results(task_id);
        """
    )


def event(con: sqlite3.Connection, typ: str, task_id: int | None = None, payload: str | None = None) -> None:
    con.execute("INSERT INTO events(ts,type,task_id,payload) VALUES(?,?,?,?)", (now_iso(), typ, task_id, payload))


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
            con.execute("UPDATE tasks SET state='READY',reason='lease-expired',updated_at=? WHERE id=? AND state='RUNNING'", (now_iso(), row["task_id"]))
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


def preflight_pass(con: sqlite3.Connection) -> bool:
    row = con.execute("SELECT state,evidence FROM gates WHERE name='preflight'").fetchone()
    return bool(row and row["state"] == "PASS" and row["evidence"])


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
    ts = now_iso()
    cur = con.execute(
        "INSERT INTO tasks(title,acceptance,state,ref,parent_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        (args.title.strip(), args.acceptance.strip(), state, args.ref, getattr(args, "parent", None), ts, ts),
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
        raise SystemExit(f"ERROR|INVALID_STATE|{args.id}|{row['state']}|expected=PROPOSED")
    if not args.evidence.strip():
        raise SystemExit("ERROR|ADMISSION_EVIDENCE_REQUIRED")
    con.execute("UPDATE tasks SET state='READY',reason=NULL,updated_at=? WHERE id=?", (now_iso(), args.id))
    event(con, "ADMIT", args.id, args.evidence.strip())
    print(f"T|{args.id}|READY|admitted|ref:{args.evidence.strip()}")


def cmd_reject(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    row = get_task(con, args.id)
    if row["state"] not in {"PROPOSED", "READY", "BLOCKED", "FAILED"}:
        raise SystemExit(f"ERROR|INVALID_STATE|{args.id}|{row['state']}")
    con.execute("UPDATE tasks SET state='REJECTED',reason=?,updated_at=? WHERE id=?", (args.reason.strip(), now_iso(), args.id))
    con.execute("DELETE FROM claims WHERE task_id=?", (args.id,))
    event(con, "REJECT", args.id, args.reason.strip())
    print(f"T|{args.id}|REJECTED|{args.reason.strip()}")


def cmd_next(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    expire_claims(con)
    if not preflight_pass(con):
        print("BLOCKED|PREFLIGHT_NOT_PASS")
        return
    rows = con.execute("SELECT id,title,acceptance,ref FROM tasks WHERE state='READY' ORDER BY id LIMIT ?", (args.limit,)).fetchall()
    if not rows:
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
    con.execute("BEGIN IMMEDIATE")
    try:
        row = get_task(con, args.id)
        if row["state"] != "READY":
            raise RuntimeError(f"INVALID_STATE|{row['state']}")
        expiry = time.time() + args.lease
        con.execute("UPDATE tasks SET state='RUNNING',reason=NULL,updated_at=? WHERE id=?", (now_iso(), args.id))
        con.execute("INSERT INTO claims(task_id,worker,expires_at,claimed_at) VALUES(?,?,?,?)", (args.id, args.worker, expiry, now_iso()))
        event(con, "CLAIM", args.id, f"{args.worker}|lease={args.lease}")
        con.execute("COMMIT")
    except RuntimeError as exc:
        con.execute("ROLLBACK")
        raise SystemExit(f"ERROR|{exc}|task={args.id}")
    except Exception:
        con.execute("ROLLBACK")
        raise
    expiry_iso = datetime.fromtimestamp(expiry, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    print(f"C|{args.id}|{args.worker}|until:{expiry_iso}")


def cmd_fact(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    get_task(con, args.id)
    con.execute("INSERT INTO facts(task_id,key,value,ref,created_at) VALUES(?,?,?,?,?)", (args.id, args.key, args.value, args.ref, now_iso()))
    event(con, "FACT", args.id, args.key)
    suffix = f"|ref:{args.ref}" if args.ref else ""
    print(f"F|{args.id}|{args.key}={args.value}{suffix}")


def cmd_result(args: argparse.Namespace) -> None:
    con = connect(args.db)
    require_schema(con)
    row = get_task(con, args.id)
    if row["state"] != "RUNNING":
        raise SystemExit(f"ERROR|INVALID_STATE|{args.id}|{row['state']}|expected=RUNNING")
    if not args.ref.strip():
        raise SystemExit("ERROR|RESULT_EVIDENCE_REQUIRED")
    status = args.status.upper()
    con.execute("INSERT INTO results(task_id,kind,status,value,ref,created_at) VALUES(?,?,?,?,?,?)", (args.id, args.kind, status, args.value, args.ref.strip(), now_iso()))
    event(con, "RESULT", args.id, f"{args.kind}|{status}|{args.ref.strip()}")
    print(f"R|{args.id}|{args.kind}|{status}|ref:{args.ref.strip()}")


def transition_with_reason(args: argparse.Namespace, target: str, event_type: str) -> None:
    con = connect(args.db)
    require_schema(con)
    row = get_task(con, args.id)
    allowed = {"RUNNING"} if target in {"BLOCKED", "FAILED"} else {"BLOCKED", "FAILED"}
    if row["state"] not in allowed:
        raise SystemExit(f"ERROR|INVALID_STATE|{args.id}|{row['state']}|target={target}")
    reason = getattr(args, "reason", None)
    con.execute("UPDATE tasks SET state=?,reason=?,updated_at=? WHERE id=?", (target, reason, now_iso(), args.id))
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
        raise SystemExit(f"ERROR|INVALID_STATE|{args.id}|{row['state']}|expected=RUNNING")
    passed = con.execute("SELECT 1 FROM results WHERE task_id=? AND UPPER(status)='PASS' AND TRIM(ref)<>'' LIMIT 1", (args.id,)).fetchone()
    if not passed:
        raise SystemExit(f"ERROR|PASS_EVIDENCE_REQUIRED|task={args.id}")
    con.execute("UPDATE tasks SET state='DONE',reason=NULL,updated_at=? WHERE id=?", (now_iso(), args.id))
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
    counts = {row["state"]: row["n"] for row in con.execute("SELECT state,COUNT(*) n FROM tasks GROUP BY state")}
    gates = [f"{row['name']}={row['state']}" for row in con.execute("SELECT name,state FROM gates ORDER BY name")]
    task_part = ",".join(f"{state}:{counts.get(state,0)}" for state in sorted(TASK_STATES) if counts.get(state, 0)) or "none"
    print(f"STATUS|tasks:{task_part}|gates:{','.join(gates) if gates else 'none'}|expired:{expired}")


def cmd_snapshot(args: argparse.Namespace) -> None:
    """Small read-only JSON view for the OpenCode observer."""
    con = connect(args.db)
    require_schema(con)
    expire_claims(con)
    tasks = [dict(row) for row in con.execute("SELECT id,title,acceptance,state,reason,updated_at FROM tasks ORDER BY id").fetchall()]
    workers = [dict(row) for row in con.execute("""SELECT c.worker,c.task_id,c.expires_at,t.title,t.state
        FROM claims c JOIN tasks t ON t.id=c.task_id WHERE t.state='RUNNING' AND c.expires_at>? ORDER BY c.worker""", (time.time(),)).fetchall()]
    gates = [dict(row) for row in con.execute("SELECT name,state,evidence,updated_at FROM gates ORDER BY name").fetchall()]
    events = [dict(row) for row in con.execute("SELECT ts,type,task_id,payload FROM events ORDER BY id DESC LIMIT 20").fetchall()]
    print(json.dumps({"tasks": tasks, "workers": workers, "gates": gates, "recent_events": events}, separators=(",", ":")))


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
    counts = {row["state"]: row["n"] for row in con.execute("SELECT state,COUNT(*) n FROM tasks GROUP BY state")}
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
        SELECT id,state,title,reason
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
    summary_states = ["PROPOSED", "READY", "RUNNING", "BLOCKED", "FAILED", "DONE", "REJECTED"]
    summary = "  ".join(f"{state}:{counts.get(state,0)}" for state in summary_states if counts.get(state, 0)) or "none"
    gate_text = "  ".join(f"{row['name']}:{row['state']}" for row in gates) or "none"

    lines = [
        "MINIMAL BLACKBOARD SWARM — LIVE",
        f"DB: {Path(args.db)}",
        f"UTC: {now_iso()}   tasks:{total} done:{done} active-workers:{len(claims)} expired-now:{expired}",
        f"STATES  {summary}",
        f"GATES   {gate_text}",
        "",
        f"ACTIVE WORKERS / CLAIMS ({len(claims)})",
        "WORKER               TASK   LEASE     CURRENT TASK",
    ]
    if claims:
        for row in claims:
            lines.append(f"{_clip(row['worker'],20):20} T{row['task_id']:<5} {_lease_left(row['expires_at']):9} {_clip(row['title'],70)}")
    else:
        lines.append("(none)")

    lines += ["", f"OPEN BLACKBOARD TASKS (showing up to {args.tasks})", "TASK    STATE      TITLE / BLOCKER"]
    if work:
        for row in work:
            detail = row["title"]
            if row["reason"]:
                detail += f" — {row['reason']}"
            lines.append(f"T{row['id']:<6} {row['state']:<10} {_clip(detail,90)}")
    else:
        lines.append("(none)")

    lines += ["", f"RECENT EVENTS ({args.events})", "TIME                  EVENT      TASK    DETAIL"]
    if events:
        for row in events:
            task = f"T{row['task_id']}" if row["task_id"] is not None else "-"
            lines.append(f"{_clip(row['ts'],20):20} {_clip(row['type'],10):10} {task:<7} {_clip(row['payload'],80)}")
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
        row = con.execute("SELECT state,evidence FROM gates WHERE name=?", (name,)).fetchone()
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
        reasons.append("open=" + ",".join(f"{row['state']}:{row['n']}" for row in open_rows))
    print("PROJECT_GREEN=NO|" + "|".join(reasons))
    raise SystemExit(2)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Minimal SQLite blackboard for agent coordination")
    p.add_argument("--db", default=".agent/board.sqlite", help="SQLite board path")
    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("init")
    sp.set_defaults(func=cmd_init)

    for name, func in (("add", cmd_add), ("propose", cmd_propose)):
        sp = sub.add_parser(name)
        sp.add_argument("title")
        sp.add_argument("--acceptance", required=True)
        sp.add_argument("--ref")
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

    sp = sub.add_parser("watch", help="Live terminal view of workers, tasks, gates, and recent events")
    sp.add_argument("--interval", type=float, default=2.0, help="Refresh interval in seconds")
    sp.add_argument("--tasks", type=int, default=20, help="Maximum open tasks to display")
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
