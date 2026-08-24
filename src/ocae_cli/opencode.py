from __future__ import annotations

import base64
import hashlib
import importlib.resources
import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from . import __version__
from .runtime import resolve_node, resolve_opencode, run_external, tool_version


INTEGRATION_ID = "ocae-opencode-handoff"
INTEGRATION_VERSION = "1.0.4"
SUPPORTED_OPENCODE_RANGE = ">=1.18.0 <1.19.0"
ADAPTER_FILENAME = "opencode-handoff.js"
MANIFEST_FILENAME = "ocae-opencode-integration.json"
BACKUP_FILENAME = "ocae-opencode-integration.backup.json"
FULL_VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


class IntegrationError(RuntimeError):
    def __init__(self, classification: str, reason: str):
        super().__init__(reason)
        self.classification = classification
        self.reason = reason


def _adapter_bytes() -> bytes:
    return importlib.resources.files("ocae_cli._adapter").joinpath(ADAPTER_FILENAME).read_bytes()


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json_file(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise IntegrationError("RED_BLOCK_INTEGRATION_MANIFEST", f"cannot read {path.name}: {error}") from error
    if not isinstance(value, dict):
        raise IntegrationError("RED_BLOCK_INTEGRATION_MANIFEST", f"{path.name} must contain an object")
    return value


def _write_json_atomic(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _write_bytes_atomic(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(value)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _restore_previous_integration(
    adapter: Path,
    manifest_path: Path,
    previous_adapter: bytes | None,
    previous_manifest: bytes | None,
) -> None:
    if previous_adapter is None:
        if adapter.exists():
            adapter.unlink()
    else:
        _write_bytes_atomic(adapter, previous_adapter)
    if previous_manifest is None:
        if manifest_path.exists():
            manifest_path.unlink()
    else:
        _write_bytes_atomic(manifest_path, previous_manifest)


def _absolute_regular_file(path: Path, classification: str) -> Path:
    try:
        resolved = path.resolve(strict=True)
        if path.is_symlink() or not resolved.is_file():
            raise IntegrationError(classification, f"path is not a regular non-symlink file: {path}")
        return resolved
    except IntegrationError:
        raise
    except OSError as error:
        raise IntegrationError(classification, f"path is unavailable: {path}: {error}") from error


def _clean_cli_environment() -> dict[str, str]:
    environment = os.environ.copy()
    for key in ("PYTHONPATH", "PYTHONHOME"):
        environment.pop(key, None)
    return environment


def _parse_version(value: str | None) -> tuple[int, int, int] | None:
    match = FULL_VERSION_RE.fullmatch(str(value or "").strip())
    return tuple(int(part) for part in match.groups()) if match else None


def _supported_opencode(version: str | None) -> bool:
    parsed = _parse_version(version)
    return parsed is not None and parsed[0] == 1 and parsed[1] == 18


def _resolve_ocae() -> Path:
    candidates = [shutil.which(name) for name in ("ocae.exe", "ocae")]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate)
        if path.suffix.lower() in {".cmd", ".ps1", ".bat"}:
            executable = path.parent / "ocae.exe"
            if executable.is_file():
                return _absolute_regular_file(executable, "RED_BLOCK_CLI_BINDING")
            continue
        return _absolute_regular_file(path, "RED_BLOCK_CLI_BINDING")
    for wrapper_name in ("ocae.cmd", "ocae.ps1", "ocae.bat"):
        wrapper = shutil.which(wrapper_name)
        if wrapper:
            executable = Path(wrapper).parent / "ocae.exe"
            if executable.is_file():
                return _absolute_regular_file(executable, "RED_BLOCK_CLI_BINDING")
    raise IntegrationError("TOOL_GAP_OCAE_CLI", "the installed ocae launcher was not found on PATH")


def _discover_opencode() -> tuple[Path, str, Path]:
    executable_string = resolve_opencode()
    if not executable_string:
        raise IntegrationError("TOOL_GAP_OPENCODE_RUNTIME", "OpenCode executable was not found")
    executable = _absolute_regular_file(Path(executable_string), "TOOL_GAP_OPENCODE_RUNTIME")
    _, version = tool_version("opencode")
    if not version:
        raise IntegrationError("TOOL_GAP_OPENCODE_RUNTIME", "OpenCode version could not be determined")
    if not _supported_opencode(version):
        raise IntegrationError("RED_BLOCK_OPENCODE_VERSION_UNSUPPORTED", f"OpenCode {version} is outside {SUPPORTED_OPENCODE_RANGE}")
    paths = run_external(str(executable), ["debug", "paths"], Path.cwd())
    if paths["exit_code"] != 0:
        raise IntegrationError("TOOL_GAP_OPENCODE_PATHS", "OpenCode debug paths failed")
    config_dir = None
    for line in paths["stdout"].splitlines():
        match = re.match(r"^\s*config\s+(.+?)\s*$", line, re.IGNORECASE)
        if match:
            config_dir = Path(match.group(1).strip())
            break
    if config_dir is None or not config_dir.is_absolute():
        raise IntegrationError("TOOL_GAP_OPENCODE_PATHS", "OpenCode debug paths did not expose an absolute config path")
    if config_dir.exists() and config_dir.is_symlink():
        raise IntegrationError("RED_BLOCK_OPENCODE_CONFIG_SYMLINK", "OpenCode config path must not be a symlink")
    config_dir = config_dir.resolve()
    return executable, version, config_dir


def _paths(config_dir: Path) -> tuple[Path, Path, Path, Path]:
    plugin_dir = config_dir / "plugins"
    adapter = plugin_dir / ADAPTER_FILENAME
    manifest = config_dir / MANIFEST_FILENAME
    backup = config_dir / BACKUP_FILENAME
    return plugin_dir, adapter, manifest, backup


def _path_equal(left: Path, right: Path) -> bool:
    return os.path.normcase(str(left.resolve())) == os.path.normcase(str(right.resolve()))


def _validate_manifest(manifest: dict, config_dir: Path, adapter: Path, current_opencode: str) -> None:
    if manifest.get("integration_id") != INTEGRATION_ID:
        raise IntegrationError("RED_BLOCK_INTEGRATION_MANIFEST", "integration manifest belongs to another integration")
    if manifest.get("integration_version") != INTEGRATION_VERSION:
        raise IntegrationError("RED_BLOCK_INTEGRATION_MANIFEST", "integration manifest version is unsupported")
    if not _path_equal(Path(str(manifest.get("adapter_path", ""))), adapter):
        raise IntegrationError("RED_BLOCK_INTEGRATION_MANIFEST_SCOPE", "manifest adapter path is outside the OpenCode global plugin path")
    if manifest.get("supported_opencode_range") != SUPPORTED_OPENCODE_RANGE:
        raise IntegrationError("RED_BLOCK_INTEGRATION_MANIFEST", "manifest compatibility range is unsupported")
    if manifest.get("opencode_version") != current_opencode:
        raise IntegrationError("RED_BLOCK_OPENCODE_VERSION_MISMATCH", "integration must be reconciled for the installed OpenCode version")
    if not adapter.is_file() or adapter.is_symlink():
        raise IntegrationError("RED_BLOCK_INTEGRATION_TAMPERED", "managed adapter is missing or is a symlink")
    if manifest.get("adapter_sha256") != _sha256_file(adapter):
        raise IntegrationError("RED_BLOCK_INTEGRATION_TAMPERED", "managed adapter hash does not match the manifest")
    cli_path = _absolute_regular_file(Path(str(manifest.get("cli_path", ""))), "RED_BLOCK_CLI_BINDING")
    current_cli = _resolve_ocae()
    if not _path_equal(cli_path, current_cli):
        raise IntegrationError("RED_BLOCK_CLI_BINDING_CHANGED", "integration is bound to a different OCAE launcher than the installed PATH launcher")
    if manifest.get("cli_sha256") != _sha256_file(cli_path):
        raise IntegrationError("RED_BLOCK_CLI_BINDING_CHANGED", "bound OCAE CLI hash changed")


def _debug_config_contains_adapter(executable: Path, config_dir: Path, adapter: Path) -> bool:
    result = run_external(str(executable), ["debug", "config"], config_dir)
    if result["exit_code"] != 0:
        return False
    normalized = result["stdout"].replace("\\", "/").lower()
    absolute = str(adapter.resolve()).replace("\\", "/").lower()
    uri = "file:///" + quote(absolute.lstrip("/"), safe="/:@-._~")
    return absolute in normalized or uri.lower() in normalized


def _runtime_smoke(executable: Path, config_dir: Path) -> dict[str, object]:
    environment = _clean_cli_environment()
    environment.update({
        "OPENCODE_CONFIG_DIR": str(config_dir),
        "OPENCODE_DISABLE_MODELS_FETCH": "1",
        "NO_COLOR": "1",
    })
    try:
        with tempfile.TemporaryDirectory(prefix="ocae-opencode-smoke-") as working_directory:
            child = subprocess.Popen(
                [str(executable), "--log-level", "ERROR"],
                cwd=working_directory,
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                shell=False,
            )
            try:
                exit_code = child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                child.terminate()
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=3)
                return {"passed": True, "state": "STARTED"}
            if exit_code == 0:
                return {"passed": True, "state": "EXITED_CLEANLY", "exit_code": exit_code}
            return {"passed": False, "state": "EXITED_EARLY", "exit_code": exit_code}
    except (OSError, subprocess.SubprocessError) as error:
        return {"passed": False, "state": "SPAWN_FAILED", "reason": str(error)}


def _syntax_passes(adapter: Path) -> bool:
    node = resolve_node()
    if not node:
        return False
    result = run_external(node, ["--check", str(adapter)], adapter.parent)
    return result["exit_code"] == 0


def _backup_value(config_dir: Path, adapter: Path, manifest: Path) -> dict:
    value: dict[str, object] = {
        "schema_version": "1",
        "integration_id": INTEGRATION_ID,
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "adapter_path": str(adapter),
        "manifest_path": str(manifest),
        "adapter_existed_before": adapter.exists(),
        "manifest_existed_before": manifest.exists(),
    }
    if adapter.is_file() and not adapter.is_symlink():
        content = adapter.read_bytes()
        value["adapter_sha256_before"] = _sha256_bytes(content)
        value["adapter_content_base64_before"] = base64.b64encode(content).decode("ascii")
    return value


def _manifest_value(config_dir: Path, adapter: Path, cli_path: Path, opencode_version: str, source: dict) -> dict:
    return {
        "schema_version": "1",
        "integration_id": INTEGRATION_ID,
        "integration_version": INTEGRATION_VERSION,
        "adapter_version": INTEGRATION_VERSION,
        "ocae_version": __version__,
        "opencode_version": opencode_version,
        "supported_opencode_range": SUPPORTED_OPENCODE_RANGE,
        "adapter_path": str(adapter),
        "cli_path": str(cli_path),
        "cli_sha256": _sha256_file(cli_path),
        "adapter_sha256": _sha256_bytes(_adapter_bytes()),
        "config_directory": str(config_dir),
        "installed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source_repository": source.get("source_repository"),
        "source_commit": source.get("source_commit"),
    }


def _result(classification: str, reason: str | None = None, **extra: object) -> dict:
    value: dict[str, object] = {"classification": classification, "exit_code": 0 if classification in {"VERIFIED_IN_SCOPE", "NOOP_IDEMPOTENT", "NOOP_ALREADY_ABSENT"} else 1}
    if classification.startswith("RED_BLOCK"):
        value["exit_code"] = 2
    if reason:
        value["reason"] = reason
    value.update(extra)
    return value


def _verify_impl() -> dict:
    executable, opencode_version, config_dir = _discover_opencode()
    plugin_dir, adapter, manifest_path, _ = _paths(config_dir)
    if not manifest_path.is_file():
        if adapter.exists():
            return _result("RED_BLOCK_INTEGRATION_OWNERSHIP", "an adapter with the OCAE filename exists without an OCAE manifest")
        return _result("NOOP_ALREADY_ABSENT", "OCAE OpenCode integration is not installed", config_directory=str(config_dir))
    manifest = _json_file(manifest_path)
    _validate_manifest(manifest, config_dir, adapter, opencode_version)
    if not _syntax_passes(adapter):
        return _result("RED_BLOCK_PLUGIN_SYNTAX", "OpenCode adapter failed the Node syntax check")
    cli_path = Path(str(manifest["cli_path"]))
    loaded = _debug_config_contains_adapter(executable, config_dir, adapter)
    if not loaded:
        return _result("RED_BLOCK_PLUGIN_LOAD", "OpenCode debug config did not expose the managed global plugin", config_directory=str(config_dir), adapter_path=str(adapter))
    smoke = _runtime_smoke(executable, config_dir)
    if not smoke.get("passed"):
        return _result("RED_BLOCK_PLUGIN_RUNTIME_SMOKE", "OpenCode startup smoke failed", config_directory=str(config_dir), adapter_path=str(adapter), runtime_smoke=smoke)
    return _result("VERIFIED_IN_SCOPE", config_directory=str(config_dir), plugin_directory=str(plugin_dir), adapter_path=str(adapter), cli_path=str(cli_path), opencode_version=opencode_version, runtime_smoke=smoke)


def verify_opencode_integration() -> dict:
    try:
        return _verify_impl()
    except IntegrationError as error:
        return _result(error.classification, error.reason)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return _result("RED_BLOCK_INTEGRATION", str(error))


def remove_opencode_integration() -> dict:
    try:
        _, opencode_version, config_dir = _discover_opencode()
        _, adapter, manifest_path, backup_path = _paths(config_dir)
        if not manifest_path.exists():
            if adapter.exists():
                return _result("RED_BLOCK_INTEGRATION_OWNERSHIP", "an adapter with the OCAE filename exists without an OCAE manifest")
            return _result("NOOP_ALREADY_ABSENT", "OCAE OpenCode integration is already absent", config_directory=str(config_dir))
        manifest = _json_file(manifest_path)
        _validate_manifest(manifest, config_dir, adapter, opencode_version)
        if adapter.exists():
            adapter.unlink()
        manifest_path.unlink()
        return _result("VERIFIED_IN_SCOPE", "OCAE integration removed; third-party plugins and OpenCode config were preserved", config_directory=str(config_dir), backup_path=str(backup_path))
    except IntegrationError as error:
        return _result(error.classification, error.reason)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return _result("RED_BLOCK_INTEGRATION_REMOVE", str(error))


def integrate_opencode() -> dict:
    try:
        executable, opencode_version, config_dir = _discover_opencode()
        plugin_dir, adapter, manifest_path, backup_path = _paths(config_dir)
        if adapter.exists() and not manifest_path.exists():
            raise IntegrationError("RED_BLOCK_INTEGRATION_OWNERSHIP", "an adapter with the OCAE filename exists without an OCAE manifest")
        cli_path = _resolve_ocae()
        cli_version = tool_version("ocae")[1]
        if not cli_version:
            raise IntegrationError("TOOL_GAP_OCAE_CLI", "the installed OCAE CLI version could not be determined")
        bound_provenance = run_external(str(cli_path), ["provenance", "--json"], cli_path.parent, _clean_cli_environment())
        if bound_provenance["exit_code"] != 0:
            raise IntegrationError("RED_BLOCK_CLI_PROVENANCE", "the bound OCAE CLI provenance command failed")
        try:
            source = json.loads(bound_provenance["stdout"])
        except json.JSONDecodeError as error:
            raise IntegrationError("RED_BLOCK_CLI_PROVENANCE", "the bound OCAE CLI returned invalid provenance JSON") from error
        if (
            source.get("source_repository") != "https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem"
            or not re.fullmatch(r"[0-9a-f]{40}", str(source.get("source_commit", "")), re.IGNORECASE)
            or source.get("version") != __version__
        ):
            raise IntegrationError("RED_BLOCK_CLI_PROVENANCE", "the bound OCAE CLI is not an exact canonical release")
        adapter_bytes = _adapter_bytes()

        existing_manifest = None
        if manifest_path.exists():
            existing_manifest = _json_file(manifest_path)
            if not adapter.is_file() or adapter.is_symlink():
                raise IntegrationError("RED_BLOCK_INTEGRATION_TAMPERED", "managed adapter is missing or is a symlink")
            if existing_manifest.get("adapter_sha256") != _sha256_file(adapter):
                raise IntegrationError("RED_BLOCK_INTEGRATION_TAMPERED", "managed adapter was changed outside OCAE")
            if existing_manifest.get("integration_id") != INTEGRATION_ID:
                raise IntegrationError("RED_BLOCK_INTEGRATION_MANIFEST", "integration manifest belongs to another integration")
            if existing_manifest.get("opencode_version") == opencode_version and existing_manifest.get("cli_path") == str(cli_path) and existing_manifest.get("cli_sha256") == _sha256_file(cli_path) and existing_manifest.get("adapter_sha256") == _sha256_bytes(adapter_bytes) and existing_manifest.get("source_commit") == source.get("source_commit"):
                _validate_manifest(existing_manifest, config_dir, adapter, opencode_version)
                return _result("NOOP_IDEMPOTENT", "OCAE OpenCode integration is already reconciled", config_directory=str(config_dir), adapter_path=str(adapter), cli_path=str(cli_path), opencode_version=opencode_version)

        if adapter.exists() and existing_manifest is None:
            raise IntegrationError("RED_BLOCK_INTEGRATION_OWNERSHIP", "an adapter with the OCAE filename exists without an OCAE manifest")
        config_dir.mkdir(parents=True, exist_ok=True)
        plugin_dir.mkdir(parents=True, exist_ok=True)
        if adapter.exists() and adapter.is_symlink():
            raise IntegrationError("RED_BLOCK_INTEGRATION_TAMPERED", "managed adapter path is a symlink")

        previous_adapter = adapter.read_bytes() if adapter.is_file() else None
        previous_manifest = manifest_path.read_bytes() if manifest_path.is_file() else None
        if not backup_path.exists():
            _write_json_atomic(backup_path, _backup_value(config_dir, adapter, manifest_path))
        try:
            _write_bytes_atomic(adapter, adapter_bytes)
            manifest = _manifest_value(config_dir, adapter, cli_path, opencode_version, source)
            _write_json_atomic(manifest_path, manifest)
            result = _verify_impl()
            if result["classification"] != "VERIFIED_IN_SCOPE":
                _restore_previous_integration(adapter, manifest_path, previous_adapter, previous_manifest)
                return _result("INTEGRATION_ROLLED_BACK", "OpenCode integration verification failed; previous integration state was restored", verification=result)
        except Exception:
            _restore_previous_integration(adapter, manifest_path, previous_adapter, previous_manifest)
            raise

        result["classification"] = "VERIFIED_IN_SCOPE"
        result["reason"] = "OCAE OpenCode global handoff adapter installed and verified"
        result["manifest_path"] = str(manifest_path)
        result["backup_path"] = str(backup_path)
        result["ocae_version"] = cli_version
        return result
    except IntegrationError as error:
        return _result(error.classification, error.reason)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return _result("RED_BLOCK_INTEGRATION", str(error))
