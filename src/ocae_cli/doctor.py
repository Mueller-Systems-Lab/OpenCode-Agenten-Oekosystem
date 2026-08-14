from __future__ import annotations

import json
import hashlib
import os
import re
from pathlib import Path

from . import __version__
from .payload import verify_payload, verify_package_record
from .payload import payload_manifest
from .runtime import resolve_node, resolve_opencode, run_external, tool_version


RUNTIME_STATE_SCHEMA_VERSION = "ocae-project-runtime-state.1"
GOVERNANCE_RUNTIME_VERSION = "governance-v2.runtime.1"
TASK_BOOTSTRAP_CONTRACT_VERSION = "governance-v2.task-bootstrap.1"
INSTALLER_CONTRACT_VERSION = "url-only-v1.installer.1"


def _version_tuple(value: object) -> tuple[int, int, int] | None:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", str(value or "").strip())
    return tuple(int(part) for part in match.groups()) if match else None


def _sha256_json(value: dict) -> str:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _file_hash_matches(expected: object, path: Path) -> bool:
    actual = _file_hash(path)
    return expected in {actual, f"sha256:{actual}"}


def _regular_file(path: Path) -> bool:
    try:
        return path.is_file() and not path.is_symlink()
    except OSError:
        return False


def _project_reconciliation(target: Path, installation: dict) -> dict:
    if installation.get("status") == "ABSENT":
        return {"state": "NOT_INSTALLED", "reason": "no OCAE installation manifest"}

    governance = target / ".agent-governance"
    if governance.is_symlink():
        return {"state": "CORRUPT", "reason": ".agent-governance is a symlink"}

    source_lock_path = governance / "source-lock.json"
    if not _regular_file(source_lock_path):
        return {"state": "CORRUPT", "reason": "source-lock.json is missing or unsafe"}
    try:
        source_lock = json.loads(source_lock_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {"state": "CORRUPT", "reason": "source-lock.json is unreadable"}
    if not isinstance(source_lock, dict) or not isinstance(source_lock.get("files"), list):
        return {"state": "CORRUPT", "reason": "source-lock.json has no valid files array"}
    file_hashes = installation.get("file_hashes") if isinstance(installation.get("file_hashes"), dict) else {}
    expected_lock_hash = file_hashes.get(".agent-governance/source-lock.json")
    if expected_lock_hash and not _file_hash_matches(expected_lock_hash, source_lock_path):
        return {"state": "CORRUPT", "reason": "source-lock.json is tampered"}

    marker_path = governance / "runtime-state.json"
    if not marker_path.exists():
        return {"state": "MIGRATION_REQUIRED", "reason": "runtime-state.json is missing"}
    if not _regular_file(marker_path):
        return {"state": "CORRUPT", "reason": "runtime-state.json is not a regular file"}
    try:
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {"state": "CORRUPT", "reason": "runtime-state.json is unreadable"}
    if not isinstance(marker, dict):
        return {"state": "CORRUPT", "reason": "runtime-state.json is not an object"}
    expected_marker_hash = file_hashes.get(".agent-governance/runtime-state.json")
    if expected_marker_hash and not _file_hash_matches(expected_marker_hash, marker_path):
        return {"state": "MIGRATION_REQUIRED", "reason": "runtime-state.json has managed drift"}
    integrity = marker.get("integrity")
    body = {key: value for key, value in marker.items() if key != "integrity"}
    if not isinstance(integrity, dict) or integrity.get("algorithm") != "sha256" or integrity.get("value") != _sha256_json(body):
        return {"state": "CORRUPT", "reason": "runtime-state.json integrity binding failed"}
    required = {
        "schema_version": RUNTIME_STATE_SCHEMA_VERSION,
        "governance_runtime_version": GOVERNANCE_RUNTIME_VERSION,
        "task_bootstrap_contract_version": TASK_BOOTSTRAP_CONTRACT_VERSION,
        "installer_contract_version": INSTALLER_CONTRACT_VERSION,
        "runtime_state": "CURRENT",
    }
    if any(body.get(key) != value for key, value in required.items()):
        return {"state": "MIGRATION_REQUIRED", "reason": "runtime-state.json contract is stale", "marker": body}

    expected_commit = payload_manifest().get("source_commit")
    expected_commit = expected_commit if isinstance(expected_commit, str) and re.fullmatch(r"[0-9a-f]{40}", expected_commit, re.I) else None
    marker_commit = body.get("source_commit")
    marker_version = _version_tuple(body.get("ocae_version"))
    desired_version = _version_tuple(__version__)
    if marker_version is None or desired_version is None:
        return {"state": "CORRUPT", "reason": "runtime-state.json has an invalid OCAE version"}
    if marker_version > desired_version:
        return {"state": "INCOMPATIBLE", "reason": "project OCAE version is newer than the trusted CLI", "marker": body}
    if marker_version < desired_version or (expected_commit and marker_commit != expected_commit):
        return {"state": "MIGRATION_REQUIRED", "reason": "project OCAE runtime is older than the trusted CLI", "marker": body}
    if not isinstance(marker_commit, str) or not re.fullmatch(r"[0-9a-f]{40}", marker_commit, re.I):
        return {"state": "CORRUPT", "reason": "runtime-state.json has no valid source commit", "marker": body}
    if source_lock.get("source_commit") != marker_commit:
        return {"state": "MIGRATION_REQUIRED", "reason": "source-lock.json is from an older runtime", "marker": body}

    required_runtime = [
        governance / "runtime" / "bootstrap" / "task-bootstrap.mjs",
        governance / "policies" / "task-bootstrap-policy.json",
        governance / "runtime" / "governance" / "owner-intent.schema.json",
        governance / "runtime" / "governance" / "task-capsule.schema.json",
    ]
    if not all(_regular_file(path) for path in required_runtime):
        return {"state": "MIGRATION_REQUIRED", "reason": "task-bootstrap runtime is incomplete", "marker": body}
    return {"state": "CURRENT", "reason": "trusted runtime marker and bootstrap contract are current", "marker": body}


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
    if target_result["status"] != "FAIL":
        checks["project_reconciliation"] = _project_reconciliation(target, checks["existing_ecosystem_installation"])
    else:
        checks["project_reconciliation"] = {"state": "CORRUPT", "reason": "target preflight failed"}
    if payload["status"] != "PASS" or target_result["status"] == "FAIL":
        classification = "RED_BLOCK"
        exit_code = 2
    elif not node_path:
        classification = "TOOL_GAP_NODE_RUNTIME"
        exit_code = 1
    elif checks["project_reconciliation"]["state"] == "CORRUPT":
        classification = "PROJECT_CORRUPT"
        exit_code = 2
    elif checks["project_reconciliation"]["state"] == "INCOMPATIBLE":
        classification = "PROJECT_INCOMPATIBLE"
        exit_code = 2
    elif checks["project_reconciliation"]["state"] == "MIGRATION_REQUIRED":
        classification = "PROJECT_MIGRATION_REQUIRED"
        exit_code = 1
    elif checks["project_reconciliation"]["state"] == "CURRENT":
        classification = "PROJECT_CURRENT"
        exit_code = 0
    elif not opencode_path:
        classification = "TOOL_GAP_OPENCODE_RUNTIME_VERIFICATION"
        exit_code = 1
    else:
        classification = "PROJECT_NOT_INSTALLED"
        exit_code = 0
    return {
        "classification": classification,
        "exit_code": exit_code,
        "target": str(target.resolve()),
        "project_state": checks["project_reconciliation"]["state"],
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
