from __future__ import annotations

import json
import os
from pathlib import Path

from .payload import verify_payload, verify_package_record
from .runtime import resolve_node, resolve_opencode, run_external, tool_version


def _target_check(target: Path) -> dict:
    resolved = target.resolve()
    if not target.exists():
        return {"status": "FAIL", "reason": "target does not exist", "path": str(resolved)}
    if not target.is_dir():
        return {"status": "FAIL", "reason": "target is not a directory", "path": str(resolved)}
    if target.is_symlink():
        return {"status": "FAIL", "reason": "target is a symlink", "path": str(resolved)}
    return {
        "status": "PASS" if os.access(target, os.W_OK) else "FAIL",
        "reason": None if os.access(target, os.W_OK) else "target is not writable",
        "path": str(resolved),
    }


def _installation_check(target: Path) -> dict:
    manifest = target / ".opencode" / "ecosystem-installation.json"
    if not manifest.is_file():
        return {"status": "ABSENT", "managed_files": 0, "agents": 0}
    try:
        value = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"status": "FAIL", "reason": "installation manifest is unreadable"}
    return {
        "status": "PRESENT",
        "managed_files": len(value.get("managed_files", [])),
        "agents": len(value.get("installed_agents", [])),
        "source_commit": value.get("source_commit"),
    }


def _runtime_check(target: Path) -> dict:
    config = target / "opencode.jsonc"
    if not config.exists():
        config = target / "opencode.json"
    agents = target / ".opencode" / "agents"
    return {
        "config": {"status": "PASS" if config.is_file() else "ABSENT"},
        "agent_directory": {
            "status": "PASS" if agents.is_dir() else "ABSENT",
            "count": len(list(agents.glob("*.md"))) if agents.is_dir() else 0,
        },
        "runtime": "opencode" if config.is_file() or agents.is_dir() else "unknown",
    }


def _task_bootstrap_check(target: Path) -> dict:
    governance = target / ".agent-governance"
    installation = target / ".opencode" / "ecosystem-installation.json"
    if not installation.exists():
        return {"status": "NOT_INSTALLED", "manual_bootstrap_required": False}
    runtime = governance / "runtime" / "bootstrap" / "task-bootstrap.mjs"
    policy = governance / "policies" / "task-bootstrap-policy.json"
    intent_schema = governance / "runtime" / "governance" / "owner-intent.schema.json"
    capsule_schema = governance / "runtime" / "governance" / "task-capsule.schema.json"
    state = governance / "state" / "task-bootstrap-state.json"
    if not all(path.is_file() for path in (runtime, policy, intent_schema, capsule_schema, state)):
        return {"status": "TASK_BOOTSTRAP_MIGRATION_REQUIRED", "manual_bootstrap_required": False}
    try:
        policy_value = json.loads(policy.read_text(encoding="utf-8"))
        state_value = json.loads(state.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"status": "TASK_BOOTSTRAP_CORRUPT", "manual_bootstrap_required": False}
    if policy_value.get("schema_version") != "governance-v2.task-bootstrap-policy.1":
        return {"status": "TASK_BOOTSTRAP_VERSION_MISMATCH", "manual_bootstrap_required": False}
    if state_value.get("state") not in {"COLD_READ_ONLY", "TASK_BOOTSTRAPPING", "TASK_READY", "TASK_BLOCKED", "TASK_COMPLETED"}:
        return {"status": "TASK_BOOTSTRAP_CORRUPT", "manual_bootstrap_required": False}
    return {"status": "TASK_BOOTSTRAP_READY", "manual_bootstrap_required": False, "state": state_value.get("state")}


def doctor(target: Path) -> dict:
    target = Path(target)
    package = verify_package_record()
    payload = verify_payload()
    target_result = _target_check(target)
    node_path, node_version = tool_version("node")
    opencode_path, opencode_version = tool_version("opencode")
    checks = {
        "python_package_integrity": package,
        "payload_integrity": payload,
        "node": {
            "status": "PASS" if node_path else "TOOL_GAP_NODE_RUNTIME",
            "path": node_path,
            "version": node_version,
        },
        "opencode": {
            "status": "PASS" if opencode_path else "TOOL_GAP_OPENCODE_RUNTIME_VERIFICATION",
            "path": opencode_path,
            "version": opencode_version,
        },
        "target": target_result,
        "runtime_detection": _runtime_check(target) if target_result["status"] != "FAIL" else {"status": "SKIPPED"},
        "existing_ecosystem_installation": _installation_check(target) if target_result["status"] != "FAIL" else {"status": "SKIPPED"},
        "task_bootstrap": _task_bootstrap_check(target) if target_result["status"] != "FAIL" else {"status": "SKIPPED"},
    }
    if payload["status"] != "PASS" or target_result["status"] == "FAIL":
        classification = "RED_BLOCK"
        exit_code = 2
    elif not node_path:
        classification = "TOOL_GAP_NODE_RUNTIME"
        exit_code = 1
    elif checks["task_bootstrap"]["status"] in {"TASK_BOOTSTRAP_CORRUPT", "TASK_BOOTSTRAP_VERSION_MISMATCH"}:
        classification = checks["task_bootstrap"]["status"]
        exit_code = 2
    elif checks["task_bootstrap"]["status"] == "TASK_BOOTSTRAP_MIGRATION_REQUIRED":
        classification = "TASK_BOOTSTRAP_MIGRATION_REQUIRED"
        exit_code = 1
    elif not opencode_path:
        classification = "TOOL_GAP_OPENCODE_RUNTIME_VERIFICATION"
        exit_code = 1
    else:
        classification = "VERIFIED_IN_SCOPE"
        exit_code = 0
    return {
        "classification": classification,
        "exit_code": exit_code,
        "target": str(target.resolve()),
        "checks": checks,
    }


def runtime_discovery(target: Path) -> dict:
    executable = resolve_opencode()
    if not executable:
        return {
            "classification": "TOOL_GAP_OPENCODE_RUNTIME_VERIFICATION",
            "exit_code": 1,
            "agents": [],
            "stdout": "",
            "stderr": "OpenCode is not available.",
        }
    result = run_external(executable, ["agent", "list"], target.resolve())
    if result["exit_code"] != 0:
        return {
            "classification": "TOOL_GAP_OPENCODE_RUNTIME_VERIFICATION",
            "agents": [],
            **result,
        }
    return {
        "classification": "VERIFIED_IN_SCOPE",
        "agents": [line.strip() for line in result["stdout"].splitlines() if line.strip()],
        **result,
    }
