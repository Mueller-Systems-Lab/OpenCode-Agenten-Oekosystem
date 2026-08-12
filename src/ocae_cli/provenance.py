from __future__ import annotations

import json
from importlib import metadata

from . import __version__
from .payload import payload_manifest, verify_payload, verify_package_record


def _direct_url() -> dict:
    try:
        value = metadata.distribution("ocae-cli").read_text("direct_url.json")
        return json.loads(value) if value else {}
    except (metadata.PackageNotFoundError, json.JSONDecodeError, OSError):
        return {}


def provenance() -> dict:
    manifest = payload_manifest()
    direct = _direct_url()
    vcs = direct.get("vcs_info") if isinstance(direct, dict) else {}
    vcs = vcs if isinstance(vcs, dict) else {}
    url = direct.get("url") if isinstance(direct, dict) else None
    repository = (
        url
        if isinstance(url, str) and url.startswith("https://github.com/")
        else manifest.get("source_repository")
    )
    if isinstance(repository, str):
        repository = repository.removesuffix(".git")
    commit = vcs.get("commit_id") or manifest.get("source_commit")
    requested_revision = vcs.get("requested_revision")
    source_ref = requested_revision or manifest.get("source_ref")
    return {
        "distribution": "ocae-cli",
        "version": __version__,
        "source_repository": repository,
        "source_commit": commit,
        "source_ref": source_ref,
        "payload_sha256": manifest.get("archive_sha256"),
        "payload_file_count": len(manifest.get("files", [])),
        "direct_url": {
            "url": url,
            "vcs": vcs.get("vcs"),
            "requested_revision": requested_revision,
            "commit_id": vcs.get("commit_id"),
        }
        if direct
        else None,
    }


def integrity_report() -> dict:
    return {
        "package": verify_package_record(),
        "payload": verify_payload(),
    }
