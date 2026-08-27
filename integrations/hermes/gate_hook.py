# SPDX-License-Identifier: MIT
"""Hermes pre_tool_call hook for runtime gate enforcement."""

import os
import json
import hashlib
from pathlib import Path

# Import the canonical evaluator client
from .runtime_client import evaluate as evaluate_gate, block_message

# Tool risk classification
WRITE_TOOLS = {"bash", "write_file", "edit_file", "create_file", "delete_file"}
EXTERNAL_TOOLS = {"web_fetch", "web_search", "http_request"}
DELEGATE_TOOLS = {"task", "run_agent", "background_task"}
READ_TOOLS = {"read_file", "grep", "glob", "ls", "cat"}
SAFE_TOOLS = {"ask_user", "question"}


def _find_governance_root():
    """Walk up from cwd to find .agent-governance/manifest.json."""
    cwd = Path(os.getcwd()).resolve()
    for parent in [cwd] + list(cwd.parents):
        manifest = parent / ".agent-governance" / "manifest.json"
        if manifest.exists():
            return parent
    return None


def _map_hermes_tool(tool_name, args):
    """Map Hermes tool to neutral operation descriptor."""
    action = "read"
    if tool_name in WRITE_TOOLS:
        action = "write"
    elif tool_name in EXTERNAL_TOOLS:
        action = "external"
    elif tool_name in DELEGATE_TOOLS:
        action = "delegate"

    write_paths = []
    if "path" in args:
        write_paths.append(str(args["path"]))
    elif "file_path" in args:
        write_paths.append(str(args["file_path"]))

    return {
        "runtime": "hermes",
        "tool": tool_name,
        "action": action,
        "command": args.get("command", args.get("cmd", "")),
        "writePaths": write_paths,
        "targetRoot": str(os.getcwd()),
    }


def pre_tool_call_handler(tool_name, args, session_id=None):
    """pre_tool_call hook — enforce governance before tool execution."""

    # 1. Find governance installation
    gov_root = _find_governance_root()
    if gov_root is None:
        # No governance installed — block writes, allow reads
        if tool_name in WRITE_TOOLS or tool_name in EXTERNAL_TOOLS:
            return {
                "action": "block",
                "message": "Governance not installed. Write/external operations blocked. Run /governance-install first.",
            }
        # Allow reads without governance
        return None

    # 2. Check runtime integrity (tamper detection)
    source_lock = gov_root / ".agent-governance" / "source-lock.json"
    if source_lock.exists():
        try:
            lock_data = json.loads(source_lock.read_text())
            files = lock_data.get("files", [])
            # Verify runtime files match hashes (unified files[] format)
            runtime_dir = gov_root / ".agent-governance" / "runtime"
            for entry in files:
                filename = entry.get("path", "")
                expected_hash = entry.get("sha256", "")
                if not filename or expected_hash == "UNAVAILABLE":
                    continue
                file_path = runtime_dir / filename
                if file_path.exists():
                    actual_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()
                    if actual_hash != expected_hash:
                        if tool_name in WRITE_TOOLS or tool_name in EXTERNAL_TOOLS:
                            return {
                                "action": "block",
                                "message": f"GOVERNANCE TAMPERED: Runtime file {filename} hash mismatch. All write/external operations blocked.",
                            }
                elif tool_name in WRITE_TOOLS or tool_name in EXTERNAL_TOOLS:
                    return {
                        "action": "block",
                        "message": f"GOVERNANCE TAMPERED: Runtime file {filename} missing. All write/external operations blocked.",
                    }
        except Exception as e:
            if tool_name in WRITE_TOOLS or tool_name in EXTERNAL_TOOLS:
                return {
                    "action": "block",
                    "message": f"GOVERNANCE RUNTIME UNAVAILABLE: {str(e)}. Write/external operations blocked.",
                }

    # 3. For write, external, and delegate tools — call the canonical evaluator
    if (
        tool_name in WRITE_TOOLS
        or tool_name in EXTERNAL_TOOLS
        or tool_name in DELEGATE_TOOLS
    ):
        descriptor = _map_hermes_tool(tool_name, args)

        # Defense-in-depth: inline kernel checks (fast path for critical patterns)
        if tool_name == "bash" and args.get("command", ""):
            cmd = args.get("command", "")
            if "--force" in cmd or ("-f" in cmd and "push" in cmd):
                return {
                    "action": "block",
                    "message": "KERNEL GATE: NO_FORCE_PUSH — Force push is unconditionally blocked.",
                }
            if any(p in cmd for p in ["rm -rf", "DROP TABLE", "format"]):
                return {
                    "action": "block",
                    "message": f"KERNEL GATE: Destructive command blocked: {cmd[:80]}",
                }

        # Path containment: defense-in-depth (proper check via os.path.commonpath)
        for wp in descriptor.get("writePaths", []):
            wp_abs = os.path.realpath(str(wp))
            gov_root_str = os.path.realpath(str(gov_root))
            # Safe containment: write path must be within governance root or project .agent-governance/state/tmp/
            allowed_tmp = os.path.join(
                gov_root_str, ".agent-governance", "state", "tmp"
            )
            if os.path.commonpath([wp_abs, gov_root_str]) != gov_root_str:
                if not wp_abs.startswith(allowed_tmp):
                    return {
                        "action": "block",
                        "message": f"KERNEL GATE: NO_PATH_ESCAPE — Write path {wp} is outside governance root.",
                    }

        # Canonical evaluator: the primary gate decision
        try:
            decision = evaluate_gate(descriptor, governance_root=str(gov_root))
        except Exception as exc:
            return {
                "action": "block",
                "message": f"GOVERNANCE EVALUATOR ERROR: {str(exc)}. Write/external operations blocked.",
            }

        classification = decision.get("classification", "RED_BLOCK")
        allowed = decision.get("allowed", False)

        if classification == "GREEN_SAFE" and allowed:
            return None  # Pass

        # Block everything else
        msg = block_message(decision)
        return {"action": "block", "message": msg}

    # 4. Allow safe operations (reads, questions)
    return None


def governance_install(args, session_id=None):
    """Slash command: install governance into current project."""
    return {
        "message": "Governance installation: Use the canonical URL installer:\n"
        "  1. Provide repository URL: https://github.com/Mueller-Systems-Lab/OpenCode-Agenten-Oekosystem\n"
        "  2. The AI will run a dry-run first, then require approval before applying.\n"
        "  3. After installation, restart your session via the managed launcher."
    }


def governance_status(args, session_id=None):
    """Slash command: show governance enforcement status."""
    gov_root = _find_governance_root()
    if gov_root is None:
        return {
            "message": "Governance: NOT_INSTALLED. Run /governance-install from the project root."
        }

    # Determine enforcement level from evidence
    enforcement_level = "STRUCTURAL_HOOK_INSTALLED"

    # Check for session attestation
    attestation_dir = gov_root / ".agent-governance" / "evidence"
    attestation_files = (
        list(attestation_dir.glob("session-attestation-*.json"))
        if attestation_dir.exists()
        else []
    )
    has_attestation = len(attestation_files) > 0

    # Check for allow/block test evidence
    evidence_files = (
        list(attestation_dir.glob("decision-*.json"))
        if attestation_dir.exists()
        else []
    )
    has_allow_evidence = False
    has_block_evidence = False

    for ef in evidence_files:
        try:
            data = json.loads(ef.read_text())
            d = data.get("decision", "")
            if d in ("GREEN", "ALLOW", "GREEN_SAFE"):
                has_allow_evidence = True
            if d in ("RED_BLOCK", "BLOCK", "DENY", "AMBER_REVIEW"):
                has_block_evidence = True
        except Exception:
            pass

    # Check for restart flag
    restart_flag = gov_root / ".agent-governance" / "state" / "RESTART_REQUIRED"
    if restart_flag.exists():
        enforcement_level = "RESTART_REQUIRED"
    elif has_attestation and has_allow_evidence and has_block_evidence:
        enforcement_level = "MANAGED_HOOK_ENFORCED"

    # Read installed version and runtime info
    manifest = gov_root / ".agent-governance" / "manifest.json"
    installed_version = "unknown"
    if manifest.exists():
        try:
            manifest_data = json.loads(manifest.read_text())
            installed_version = manifest_data.get("version", "unknown")
        except Exception:
            pass

    lines = [
        f"Governance: INSTALLED at {gov_root}",
        f"Enforcement Level: {enforcement_level}",
        f"Installed Version: {installed_version}",
        f"Session Attestation: {'PRESENT' if has_attestation else 'MISSING'}",
        f"Allow Evidence: {'PRESENT' if has_allow_evidence else 'MISSING'}",
        f"Block Evidence: {'PRESENT' if has_block_evidence else 'MISSING'}",
    ]
    return {"message": "\n".join(lines)}


def governance_doctor(args, session_id=None):
    """Slash command: diagnose governance installation."""
    issues = []
    gov_root = _find_governance_root()
    if gov_root is None:
        issues.append("NO_GOVERNANCE_ROOT: .agent-governance/ not found")
    else:
        manifest = gov_root / ".agent-governance" / "manifest.json"
        if not manifest.exists():
            issues.append("NO_MANIFEST: manifest.json not found")
        source_lock = gov_root / ".agent-governance" / "source-lock.json"
        if not source_lock.exists():
            issues.append("NO_SOURCE_LOCK: source-lock.json not found")
    return {"message": "\n".join(issues) if issues else "Governance: HEALTHY"}


def governance_rollback(args, session_id=None):
    """Slash command: rollback governance installation."""
    return {
        "message": "Rollback: Run `node .agent-governance/bin/evaluate.mjs --action rollback` to restore previous state."
    }
