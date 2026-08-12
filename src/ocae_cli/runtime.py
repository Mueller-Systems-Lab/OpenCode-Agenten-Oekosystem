from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from .payload import materialize_payload, payload_manifest


def resolve_node() -> str | None:
    return shutil.which("node")


def resolve_opencode() -> str | None:
    direct = shutil.which("opencode.exe") or shutil.which("opencode")
    if direct and not direct.lower().endswith((".cmd", ".ps1")):
        return direct
    wrapper = shutil.which("opencode.cmd")
    if wrapper:
        candidate = Path(wrapper).parent / "node_modules" / "opencode-ai" / "bin" / "opencode.exe"
        if candidate.is_file():
            return str(candidate)
    return direct


def tool_version(command: str) -> tuple[str | None, str | None]:
    executable = resolve_opencode() if command == "opencode" else resolve_node() if command == "node" else shutil.which(command)
    if not executable:
        return None, None
    try:
        result = subprocess.run(
            [executable, "--version"],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
            shell=False,
        )
    except (OSError, subprocess.SubprocessError):
        return executable, None
    output = (result.stdout or result.stderr).strip().splitlines()
    return executable, output[0] if output else None


def run_external(executable: str, arguments: list[str], cwd: Path) -> dict:
    try:
        completed = subprocess.run(
            [executable, *arguments],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
            shell=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        return {"exit_code": 2, "stdout": "", "stderr": str(error)}
    return {
        "exit_code": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


def _subprocess_environment() -> dict[str, str]:
    environment = os.environ.copy()
    for key in (
        "NODE_OPTIONS",
        "NODE_PATH",
        "NPM_CONFIG_USERCONFIG",
        "NPM_CONFIG_GLOBALCONFIG",
        "BUN_INSTALL",
    ):
        environment.pop(key, None)
    manifest = payload_manifest()
    commit = manifest.get("source_commit")
    repository = manifest.get("source_repository")
    source_ref = manifest.get("source_ref")
    if isinstance(commit, str) and len(commit) == 40:
        environment["OCAE_BOOTSTRAP_SOURCE_COMMIT"] = commit
    if isinstance(repository, str) and repository.startswith("https://github.com/"):
        environment["OCAE_BOOTSTRAP_SOURCE_REPOSITORY"] = repository
    if isinstance(source_ref, str) and source_ref != "UNKNOWN":
        environment["OCAE_BOOTSTRAP_SOURCE_REF"] = source_ref
    return environment


def _parse_json_result(stdout: str) -> dict:
    for line in reversed(stdout.splitlines()):
        candidate = line.strip()
        if not candidate:
            continue
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return {}


def _classification(exit_code: int | None, result: dict) -> str:
    value = result.get("classification")
    if isinstance(value, str):
        return value
    if exit_code == 0:
        return "VERIFIED_IN_SCOPE"
    if exit_code == 1:
        return "NEEDS_REVIEW"
    return "RED_BLOCK"


def run_canonical(
    target: Path,
    *,
    apply: bool = False,
    mode: str | None = None,
    rollback: Path | None = None,
    timeout: int = 300,
) -> dict:
    node = resolve_node()
    if not node:
        return {
            "classification": "TOOL_GAP_NODE_RUNTIME",
            "exit_code": 1,
            "stdout": "",
            "stderr": "Node.js is required to run the canonical installer.",
        }
    target = target.resolve()
    with materialize_payload() as (_, payload_root):
        script = payload_root / "scripts" / "install-governance.mjs"
        arguments = [node, str(script), "--target", str(target), "--json"]
        if apply:
            arguments.append("--apply")
        if mode:
            arguments.extend(["--mode", mode])
        if rollback is not None:
            arguments.extend(["--rollback", str(rollback.resolve())])
        try:
            completed = subprocess.run(
                arguments,
                cwd=str(payload_root),
                env=_subprocess_environment(),
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
                shell=False,
            )
        except subprocess.TimeoutExpired:
            return {
                "classification": "RED_BLOCK_CANONICAL_INSTALLER_TIMEOUT",
                "exit_code": 2,
                "stdout": "",
                "stderr": "Canonical installer timed out.",
            }
        result = _parse_json_result(completed.stdout)
        result.setdefault("classification", _classification(completed.returncode, result))
        result["exit_code"] = completed.returncode
        result["stdout"] = completed.stdout
        result["stderr"] = completed.stderr
        return result
