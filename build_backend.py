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
CANONICAL_SOURCE_REPOSITORY = (
    "https://github.com/Mueller-Systems-Lab/OpenCode-Agenten-Oekosystem"
)

RUNTIME_FILES = (
    "scripts/install-governance.mjs",
    "scripts/lib/install-contract.mjs",
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
    "runtime/gates/command-effect-classifier.mjs",
    "runtime/gates/evaluate-action.mjs",
    "runtime/bootstrap/task-bootstrap.mjs",
    "governance/generated/capability-registry.json",
    "governance/owner-intent.schema.json",
    "governance/task-capsule.schema.json",
    "governance/task-bootstrap-policy.schema.json",
    "governance/task-bootstrap-policy.json",
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
    # Canonical Blackboard swarm skill (T2): the wheel payload must ship the
    # single canonical source under .agents/skills so a URL-installed CLI can
    # mechanically derive the swarm runtime at install time. Never maintain a
    # second copy — install-governance.mjs copies these byte-for-byte.
    ".agents/skills/coordinate-blackboard-swarm/SKILL.md",
    ".agents/skills/coordinate-blackboard-swarm/scripts/blackboard.py",
    ".agents/skills/coordinate-blackboard-swarm/adapters/opencode/swarm.ts",
    ".agents/skills/coordinate-blackboard-swarm/adapters/opencode/swarm.md",
    ".agents/skills/coordinate-blackboard-swarm/adapters/opencode/swarm-worker.md",
    ".agents/skills/coordinate-blackboard-swarm/adapters/opencode/install.py",
    ".agents/skills/coordinate-blackboard-swarm/adapters/opencode/swarm-ui/index.ts",
    ".agents/skills/coordinate-blackboard-swarm/adapters/opencode/swarm-ui/tui.ts",
    ".agents/skills/coordinate-blackboard-swarm/references/protocol.md",
    ".agents/skills/coordinate-blackboard-swarm/agents/openai.yaml",
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
        if (
            path in {".ok"}
            or path.startswith("evidence/")
            or path.startswith(".agent-governance/evidence/")
        ):
            continue
        relevant.append(path)
    return relevant


def _source_repository() -> str:
    value = os.environ.get("OCAE_SOURCE_REPOSITORY") or _git_value(
        "remote", "get-url", "origin"
    )
    if not value:
        return CANONICAL_SOURCE_REPOSITORY
    if value.startswith("git@github.com:"):
        value = "https://github.com/" + value.split(":", 1)[1]
    if not value.startswith("https://github.com/"):
        return CANONICAL_SOURCE_REPOSITORY
    return value.removesuffix(".git")


def _source_commit() -> str:
    explicit = os.environ.get("OCAE_SOURCE_COMMIT")
    if explicit:
        return explicit
    dirty = _relevant_worktree_status()
    if dirty:
        if os.environ.get("OCAE_ALLOW_DIRTY_BUILD") == "1":
            return "DIRTY_WORKTREE"
        raise RuntimeError(
            "refusing a build from a dirty worktree; commit source changes first"
        )
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


def verify_release_consistency(
    *,
    manifest_version: str,
    tag: str,
    dirty: Iterable[str] | None = None,
    payload_manifest: dict | None = None,
    archive_sha256: str | None = None,
) -> dict:
    """Deterministic stable-release consistency gate (T11).

    Fails closed when the manifest version differs from the release tag
    (leading ``v`` stripped), when the worktree is dirty, or when the built
    payload manifest disagrees with the release (package version or archive
    hash). Pure function of its inputs so stable releases and tests get
    identical decisions.
    """
    errors: list[str] = []
    claimed = str(manifest_version).strip()
    normalized_tag = str(tag).strip()
    if normalized_tag.startswith("v"):
        normalized_tag = normalized_tag[1:].strip()
    if claimed != normalized_tag:
        errors.append(
            f"manifest version {claimed!r} != release tag {str(tag).strip()!r}"
        )
    dirty_list = list(dirty or [])
    if dirty_list:
        errors.append(f"dirty worktree: {', '.join(dirty_list)}")
    if payload_manifest is not None:
        payload_version = str(payload_manifest.get("package_version", "")).strip()
        if payload_version != claimed:
            errors.append(
                f"payload manifest package_version {payload_version!r} != {claimed!r}"
            )
        expected_digest = payload_manifest.get("archive_sha256")
        if (
            archive_sha256 is not None
            and expected_digest is not None
            and str(expected_digest).strip() != str(archive_sha256).strip()
        ):
            errors.append("payload archive_sha256 mismatch")
    if errors:
        raise RuntimeError("release consistency check failed: " + "; ".join(errors))
    return {
        "manifest_version": claimed,
        "tag": normalized_tag,
        "dirty": dirty_list,
        "payload_verified": payload_manifest is not None,
    }


def check_release_version(
    manifest_version: str | None = None, tag: str | None = None
) -> dict:
    """Stable-release consistency check against live repository reality."""
    if manifest_version is None:
        manifest_data = json.loads(
            (ROOT / "ecosystem.manifest.json").read_text(encoding="utf-8")
        )
        manifest_version = str(manifest_data["version"])
    if tag is None:
        tag = os.environ.get("OCAE_RELEASE_TAG") or _git_value(
            "describe", "--tags", "--exact-match"
        )
        if not tag:
            raise RuntimeError(
                "release consistency check failed: no release tag "
                "(pass --tag or set OCAE_RELEASE_TAG)"
            )
    payload_manifest = None
    archive_digest = None
    if MANIFEST_PATH.is_file() and ARCHIVE_PATH.is_file():
        payload_manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        archive_digest = _sha256(ARCHIVE_PATH)
    return verify_release_consistency(
        manifest_version=manifest_version,
        tag=tag,
        dirty=_relevant_worktree_status(),
        payload_manifest=payload_manifest,
        archive_sha256=archive_digest,
    )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _payload_files() -> list[str]:
    files = list(RUNTIME_FILES)
    # The canonical installer validates and copies the complete runtime graph.
    # Keep the packaged source tree aligned with that graph so a URL-installed
    # CLI cannot pass package verification and then fail during source
    # validation because an imported runtime helper was omitted.
    for root_name in ("runtime", "scripts/lib"):
        root = ROOT / root_name
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if path.is_file() and not path.is_symlink():
                files.append(path.relative_to(ROOT).as_posix())
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
                    archive.add(
                        source,
                        arcname=source.relative_to(ROOT).as_posix(),
                        recursive=False,
                        filter=_tar_filter,
                    )
    temporary.replace(ARCHIVE_PATH)


def _prepare_payload() -> None:
    if not (ROOT / "ecosystem.manifest.json").is_file():
        if ARCHIVE_PATH.is_file() and MANIFEST_PATH.is_file():
            existing = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
            version = str(existing["package_version"])
            VERSION_PATH.write_text(f'__version__ = "{version}"\n', encoding="utf-8")
            return
        raise RuntimeError("ecosystem.manifest.json is required for a source build")
    manifest_data = json.loads(
        (ROOT / "ecosystem.manifest.json").read_text(encoding="utf-8")
    )
    version = str(manifest_data["version"])
    release_tag = os.environ.get("OCAE_RELEASE_TAG")
    if release_tag:
        # Stable-release builds fail closed on version/tag drift or a dirty
        # worktree before any payload bytes are written. Payload-hash
        # agreement is verified post-build via `check-release`.
        verify_release_consistency(
            manifest_version=version,
            tag=release_tag,
            dirty=_relevant_worktree_status(),
        )
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
    return _backend().prepare_metadata_for_build_wheel(
        metadata_directory, config_settings
    )


def get_requires_for_build_wheel(config_settings=None):
    return _backend().get_requires_for_build_wheel(config_settings)


def get_requires_for_build_sdist(config_settings=None):
    return _backend().get_requires_for_build_sdist(config_settings)


def prepare_metadata_for_build_editable(metadata_directory, config_settings=None):
    _prepare_payload()
    return _backend().prepare_metadata_for_build_editable(
        metadata_directory, config_settings
    )


def build_editable(wheel_directory, config_settings=None, metadata_directory=None):
    _prepare_payload()
    return _backend().build_editable(
        wheel_directory, config_settings, metadata_directory
    )


def _cli(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="OCAE build backend helpers")
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser(
        "check-release",
        help="fail when manifest version != release tag, worktree dirty, "
        "or payload manifest hash mismatches",
    )
    check.add_argument("--manifest-version", default=None)
    check.add_argument("--tag", default=None)
    args = parser.parse_args(argv)
    if args.command == "check-release":
        try:
            result = check_release_version(
                manifest_version=args.manifest_version, tag=args.tag
            )
        except RuntimeError as exc:
            print(f"FAIL {exc}", flush=True)
            return 2
        print(json.dumps(result, indent=2))
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(_cli())
