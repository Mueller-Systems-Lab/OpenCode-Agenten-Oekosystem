from __future__ import annotations

import csv
import hashlib
import importlib.metadata
import importlib.resources
import io
import json
import tarfile
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from typing import BinaryIO


PAYLOAD_PACKAGE = "ocae_cli._payload"
ARCHIVE_NAME = "canonical-runtime.tar.gz"
MANIFEST_NAME = "ocae-payload-manifest.json"


def _resource(name: str) -> bytes:
    return importlib.resources.files(PAYLOAD_PACKAGE).joinpath(name).read_bytes()


def payload_manifest() -> dict:
    return json.loads(_resource(MANIFEST_NAME).decode("utf-8"))


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_package_record() -> dict:
    try:
        distribution = importlib.metadata.distribution("ocae-cli")
        record_text = distribution.read_text("RECORD")
        if not record_text:
            return {"status": "NOT_AVAILABLE", "reason": "package RECORD is unavailable"}
        checked = 0
        failures = []
        for row in csv.reader(io.StringIO(record_text)):
            if len(row) < 3 or not row[1]:
                continue
            # Wheel RECORD paths use POSIX separators on every platform. Path
            # accepts those separators natively; converting them to a literal
            # backslash makes every recorded file look missing on POSIX.
            relative = row[0]
            path = Path(distribution.locate_file(relative))
            if not path.is_file():
                failures.append({"path": row[0], "reason": "missing"})
                continue
            algorithm, encoded = row[1].split("=", 1)
            if algorithm != "sha256":
                failures.append({"path": row[0], "reason": "unsupported digest"})
                continue
            import base64

            actual = base64.urlsafe_b64encode(bytes.fromhex(_sha256_file(path))).rstrip(b"=").decode()
            if actual != encoded:
                failures.append({"path": row[0], "reason": "hash mismatch"})
            checked += 1
        return {
            "status": "PASS" if not failures else "FAIL",
            "checked_files": checked,
            "failures": failures,
        }
    except importlib.metadata.PackageNotFoundError:
        return {"status": "NOT_AVAILABLE", "reason": "ocae-cli is not installed as a distribution"}
    except Exception as error:
        return {"status": "FAIL", "reason": f"package RECORD could not be checked: {error}"}


def verify_payload() -> dict:
    manifest = payload_manifest()
    archive = _resource(ARCHIVE_NAME)
    failures = []
    expected_archive_hash = manifest.get("archive_sha256")
    if not expected_archive_hash:
        failures.append({"reason": "manifest has no archive_sha256"})
    elif _sha256_bytes(archive) != expected_archive_hash:
        failures.append({"reason": "payload archive hash mismatch"})

    entries = manifest.get("files")
    if not isinstance(entries, list) or not entries:
        failures.append({"reason": "manifest files list is missing or empty"})
        entries = []
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as bundle:
        members = {member.name: member for member in bundle.getmembers()}
        for entry in entries:
            relative = entry.get("relative_path")
            member = members.get(relative)
            if not relative or member is None:
                failures.append({"path": relative, "reason": "manifest file missing from archive"})
                continue
            if not member.isfile():
                failures.append({"path": relative, "reason": "payload member is not a regular file"})
                continue
            stream = bundle.extractfile(member)
            content = stream.read() if stream else b""
            if len(content) != entry.get("size"):
                failures.append({"path": relative, "reason": "size mismatch"})
            if _sha256_bytes(content) != entry.get("sha256"):
                failures.append({"path": relative, "reason": "hash mismatch"})
        unexpected = sorted(set(members) - {entry.get("relative_path") for entry in entries})
        if unexpected:
            failures.append({"reason": "archive contains files outside the manifest", "paths": unexpected})
    return {
        "status": "PASS" if not failures else "FAIL",
        "package_version": manifest.get("package_version"),
        "source_commit": manifest.get("source_commit"),
        "source_ref": manifest.get("source_ref"),
        "source_repository": manifest.get("source_repository"),
        "payload_sha256": expected_archive_hash,
        "file_count": len(entries),
        "failures": failures,
    }


def _safe_member_path(root: Path, name: str) -> Path:
    pure = PurePosixPath(name)
    if pure.is_absolute() or not pure.parts or ".." in pure.parts:
        raise ValueError(f"unsafe payload member path: {name}")
    candidate = (root.joinpath(*pure.parts)).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError(f"payload member escapes extraction root: {name}")
    return candidate


def extract_payload(destination: Path) -> Path:
    report = verify_payload()
    if report["status"] != "PASS":
        raise RuntimeError("RED_BLOCK_PACKAGE_PAYLOAD_INTEGRITY")
    destination = destination.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    archive = _resource(ARCHIVE_NAME)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as bundle:
        for member in bundle.getmembers():
            if member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                raise ValueError(f"unsafe payload member type: {member.name}")
            target = _safe_member_path(destination, member.name)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            stream = bundle.extractfile(member)
            if stream is None:
                raise ValueError(f"payload member cannot be read: {member.name}")
            with target.open("wb") as handle:
                handle.write(stream.read())
    extracted_failures = []
    for entry in payload_manifest()["files"]:
        target = _safe_member_path(destination, entry["relative_path"])
        if not target.is_file() or _sha256_file(target) != entry["sha256"] or target.stat().st_size != entry["size"]:
            extracted_failures.append(entry["relative_path"])
    if extracted_failures:
        raise RuntimeError("RED_BLOCK_PACKAGE_PAYLOAD_INTEGRITY")
    return destination


@contextmanager
def materialize_payload():
    temporary = TemporaryDirectory(prefix="ocae-payload-")
    try:
        yield temporary, extract_payload(Path(temporary.name))
    finally:
        temporary.cleanup()
