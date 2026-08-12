from __future__ import annotations

import gzip
import hashlib
import json
import os
import subprocess
import tarfile
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent
PACKAGE_ROOT = ROOT / "src" / "ocae_cli"
PAYLOAD_ROOT = PACKAGE_ROOT / "_payload"
ARCHIVE_PATH = PAYLOAD_ROOT / "canonical-runtime.tar.gz"
MANIFEST_PATH = PAYLOAD_ROOT / "ocae-payload-manifest.json"
VERSION_PATH = PACKAGE_ROOT / "_version.py"

RUNTIME_FILES = (
    "scripts/install-governance.mjs",
    "scripts/lib/paths.mjs",
    "scripts/lib/backup.mjs",
    "scripts/lib/security/redaction.mjs",
    "scripts/lib/jsonc.mjs",
    "scripts/lib/gates/evaluate-all.mjs",
    "scripts/lib/gates/kernel.mjs",
    "scripts/lib/gates/policy.mjs",
    "scripts/lib/gates/decision.mjs",
    "scripts/lib/gates/approval.mjs",
    "scripts/lib/gates/evidence.mjs",
    "scripts/lib/gates/classifications.mjs",
    "scripts/lib/gates/errors.mjs",
    "scripts/lib/gates/context-fingerprint.mjs",
    "scripts/lib/runtimes/contract.mjs",
    "scripts/lib/runtimes/generic.mjs",
    "scripts/lib/runtimes/opencode.mjs",
    "scripts/lib/runtimes/hermes.mjs",
    "scripts/lib/runtimes/odysseus.mjs",
    "runtime/approval/approval-engine.mjs",
    "runtime/approval/approval-receipt.mjs",
    "runtime/approval/change-lease.mjs",
    "runtime/approval/approval-bundler.mjs",
    "runtime/approval/approval-audit.mjs",
    "runtime/approval/capability-registry.mjs",
    "runtime/gates/evaluate-action.mjs",
    "governance/generated/capability-registry.json",
    "governance/policy-core.yaml",
    "governance/policy-core.schema.json",
    "governance/generated/policy-core.json",
    "governance/generated/risk-profiles.json",
    "PROMPT-KERNEL.md",
    "bootstrap/verify.mjs",
    "bootstrap/manifest.json",
    "bootstrap/lib/contract.mjs",
    "scripts/generate-governance.mjs",
    "scripts/check-governance-drift.mjs",
    ".agent-governance/bin/evaluate.mjs",
    "ecosystem.manifest.json",
)


def _backend():
    from setuptools import build_meta

    return build_meta


def _git_value(*args: str) -> str | None:
    try:
        value = subprocess.check_output(
            ["git", *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return None
    return value or None


def _relevant_worktree_status() -> list[str]:
    status = _git_value("status", "--porcelain", "--untracked-files=all") or ""
    relevant = []
    for line in status.splitlines():
        path = line[3:] if len(line) >= 4 else line
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        path = path.replace("\\", "/")
        if path in {".ok"} or path.startswith("evidence/") or path.startswith(".agent-governance/evidence/"):
            continue
        relevant.append(path)
    return relevant


def _source_repository() -> str:
    value = os.environ.get("OCAE_SOURCE_REPOSITORY") or _git_value("remote", "get-url", "origin")
    if not value:
        return "UNKNOWN"
    if value.startswith("git@github.com:"):
        value = "https://github.com/" + value.split(":", 1)[1]
    return value.removesuffix(".git")


def _source_commit() -> str:
    explicit = os.environ.get("OCAE_SOURCE_COMMIT")
    if explicit:
        return explicit
    dirty = _relevant_worktree_status()
    if dirty:
        if os.environ.get("OCAE_ALLOW_DIRTY_BUILD") == "1":
            return "DIRTY_WORKTREE"
        raise RuntimeError("refusing a build from a dirty worktree; commit source changes first")
    return _git_value("rev-parse", "HEAD") or "UNKNOWN"


def _source_ref() -> str:
    explicit = os.environ.get("OCAE_SOURCE_REF")
    if explicit:
        return explicit
    return (
        _git_value("symbolic-ref", "--short", "-q", "HEAD")
        or _git_value("describe", "--tags", "--exact-match")
        or "UNKNOWN"
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _payload_files() -> list[str]:
    files = list(RUNTIME_FILES)
    for root_name in (".opencode/agents", ".opencode/skills", ".opencode/policies"):
        root = ROOT / root_name
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if path.is_file() and not path.is_symlink():
                files.append(path.relative_to(ROOT).as_posix())
    return sorted(set(files))


def _validate_paths(files: Iterable[str]) -> list[Path]:
    resolved: list[Path] = []
    for relative in files:
        path = (ROOT / relative).resolve()
        if ROOT not in path.parents:
            raise RuntimeError(f"payload path escapes repository: {relative}")
        if not path.is_file() or path.is_symlink():
            raise RuntimeError(f"payload source is missing or unsafe: {relative}")
        resolved.append(path)
    return resolved


def _tar_filter(info: tarfile.TarInfo) -> tarfile.TarInfo:
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    info.mtime = 0
    info.mode = 0o644
    return info


def _write_archive(files: list[Path]) -> None:
    PAYLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    temporary = ARCHIVE_PATH.with_suffix(".tmp")
    with temporary.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w") as archive:
                for source in files:
                    archive.add(source, arcname=source.relative_to(ROOT).as_posix(), recursive=False, filter=_tar_filter)
    temporary.replace(ARCHIVE_PATH)


def _prepare_payload() -> None:
    if not (ROOT / "ecosystem.manifest.json").is_file():
        if ARCHIVE_PATH.is_file() and MANIFEST_PATH.is_file():
            existing = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
            version = str(existing["package_version"])
            VERSION_PATH.write_text(f'__version__ = "{version}"\n', encoding="utf-8")
            return
        raise RuntimeError("ecosystem.manifest.json is required for a source build")
    manifest_data = json.loads((ROOT / "ecosystem.manifest.json").read_text(encoding="utf-8"))
    version = str(manifest_data["version"])
    VERSION_PATH.write_text(f'__version__ = "{version}"\n', encoding="utf-8")
    files = _payload_files()
    sources = _validate_paths(files)
    file_entries = []
    for relative, source in zip(files, sources):
        file_entries.append(
            {
                "relative_path": relative,
                "sha256": _sha256(source),
                "size": source.stat().st_size,
            }
        )
    _write_archive(sources)
    manifest = {
        "manifest_version": "1.0.0",
        "package_version": version,
        "ecosystem_version": version,
        "source_repository": _source_repository(),
        "source_commit": _source_commit(),
        "source_ref": _source_ref(),
        "files": file_entries,
        "archive_sha256": _sha256(ARCHIVE_PATH),
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def build_wheel(wheel_directory, config_settings=None, metadata_directory=None):
    _prepare_payload()
    return _backend().build_wheel(wheel_directory, config_settings, metadata_directory)


def build_sdist(sdist_directory, config_settings=None):
    _prepare_payload()
    return _backend().build_sdist(sdist_directory, config_settings)


def prepare_metadata_for_build_wheel(metadata_directory, config_settings=None):
    _prepare_payload()
    return _backend().prepare_metadata_for_build_wheel(metadata_directory, config_settings)


def get_requires_for_build_wheel(config_settings=None):
    return _backend().get_requires_for_build_wheel(config_settings)


def get_requires_for_build_sdist(config_settings=None):
    return _backend().get_requires_for_build_sdist(config_settings)


def prepare_metadata_for_build_editable(metadata_directory, config_settings=None):
    _prepare_payload()
    return _backend().prepare_metadata_for_build_editable(metadata_directory, config_settings)


def build_editable(wheel_directory, config_settings=None, metadata_directory=None):
    _prepare_payload()
    return _backend().build_editable(wheel_directory, config_settings, metadata_directory)
