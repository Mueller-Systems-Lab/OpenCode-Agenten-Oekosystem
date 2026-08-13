from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .doctor import doctor, runtime_discovery
from .opencode import integrate_opencode, remove_opencode_integration, verify_opencode_integration
from .payload import verify_payload
from .provenance import provenance
from .runtime import run_canonical


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ocae", description="OpenCode-Agenten-Oekosystem CLI")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    subparsers = parser.add_subparsers(dest="command", required=True)

    version = subparsers.add_parser("version")
    version.add_argument("--json", action="store_true")
    prov = subparsers.add_parser("provenance")
    prov.add_argument("--json", action="store_true")

    for name in ("doctor", "install", "verify", "update"):
        command = subparsers.add_parser(name)
        command.add_argument("target", nargs="?", default=".")
        command.add_argument("--json", action="store_true")
    subparsers.choices["install"].add_argument("--dry-run", action="store_true")

    rollback = subparsers.add_parser("rollback")
    rollback.add_argument("target", nargs="?", default=".")
    rollback.add_argument("--backup", required=True)
    rollback.add_argument("--json", action="store_true")

    integrate = subparsers.add_parser("integrate")
    integrate.add_argument("runtime", choices=["opencode"])
    integrate.add_argument("--remove", action="store_true")
    integrate.add_argument("--verify", action="store_true")
    integrate.add_argument("--json", action="store_true")
    return parser


def _emit(value: dict | str, as_json: bool) -> None:
    if as_json:
        print(json.dumps(value, indent=2, sort_keys=True))
    elif isinstance(value, str):
        print(value)
    else:
        classification = value.get("classification", "UNKNOWN")
        print(classification)
        if value.get("reason"):
            print(value["reason"])


def _exit(value: dict) -> int:
    return int(value.get("exit_code", 0))


def _strip_process_output(value: dict) -> dict:
    return {key: item for key, item in value.items() if key not in {"stdout", "stderr"}}


def _verify_target(target: Path) -> dict:
    canonical = run_canonical(target, mode="VERIFY_ONLY")
    result = _strip_process_output(canonical)
    if canonical.get("exit_code") != 0:
        return result
    discovery = runtime_discovery(target)
    result["runtime_discovery"] = _strip_process_output(discovery)
    if discovery.get("classification") != "VERIFIED_IN_SCOPE":
        result["classification"] = discovery["classification"]
        result["exit_code"] = discovery.get("exit_code", 1)
        return result
    expected = []
    try:
        installation = json.loads(
            (target / ".opencode" / "ecosystem-installation.json").read_text(encoding="utf-8")
        )
        expected = installation.get("installed_agents", [])
    except (OSError, json.JSONDecodeError):
        result["classification"] = "RED_BLOCK_INSTALLATION_MANIFEST"
        result["exit_code"] = 2
        return result
    output = discovery.get("stdout", "")
    missing = [agent for agent in expected if agent not in output]
    result["runtime_discovery"]["expected_agents"] = expected
    result["runtime_discovery"]["discovered_expected_agents"] = [agent for agent in expected if agent not in missing]
    result["runtime_discovery"]["missing_expected_agents"] = missing
    if missing:
        result["classification"] = "TOOL_GAP_OPENCODE_RUNTIME_VERIFICATION"
        result["exit_code"] = 1
    return result


def _apply(target: Path, mode: str) -> dict:
    preflight = doctor(target)
    if preflight["classification"] == "RED_BLOCK":
        return preflight
    if verify_payload().get("status") != "PASS":
        return {
            "classification": "RED_BLOCK_PACKAGE_PAYLOAD_INTEGRITY",
            "exit_code": 2,
        }
    dry_run = run_canonical(target, mode=mode)
    if dry_run.get("exit_code") != 0:
        return {
            "classification": dry_run.get("classification", "RED_BLOCK"),
            "exit_code": dry_run.get("exit_code", 2),
            "dry_run": _strip_process_output(dry_run),
        }
    applied = run_canonical(target, apply=True, mode=mode)
    result = {
        "classification": applied.get("classification", "RED_BLOCK"),
        "exit_code": applied.get("exit_code", 2),
        "apply": _strip_process_output(applied),
    }
    if applied.get("exit_code") != 0:
        return result
    result["verification"] = _verify_target(target)
    if applied.get("classification") == "NOOP_IDEMPOTENT" and result["verification"].get("exit_code") == 0:
        result["classification"] = "NOOP_IDEMPOTENT"
    else:
        result["classification"] = result["verification"].get("classification", result["classification"])
    result["exit_code"] = result["verification"].get("exit_code", result["exit_code"])
    return result


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    as_json = bool(getattr(args, "json", False))
    target = Path(getattr(args, "target", "."))
    if args.command == "version":
        value = {"distribution": "ocae-cli", "version": __version__}
        _emit(value if as_json else f"ocae-cli {__version__}", as_json)
        return 0
    if args.command == "provenance":
        _emit(provenance(), as_json)
        return 0
    if args.command == "doctor":
        value = doctor(target)
        _emit(value, as_json)
        return _exit(value)
    if args.command == "install":
        value = _strip_process_output(run_canonical(target, mode="INSTALL_NEW")) if args.dry_run else _apply(target, "INSTALL_NEW")
        _emit(value, as_json)
        return _exit(value)
    if args.command == "update":
        value = _apply(target, "UPDATE_EXISTING")
        _emit(value, as_json)
        return _exit(value)
    if args.command == "verify":
        value = _verify_target(target)
        _emit(value, as_json)
        return _exit(value)
    if args.command == "rollback":
        value = _strip_process_output(run_canonical(target, rollback=Path(args.backup)))
        _emit(value, as_json)
        return _exit(value)
    if args.command == "integrate":
        if args.remove and args.verify:
            raise SystemExit("--remove and --verify are mutually exclusive")
        if args.runtime != "opencode":
            return 2
        value = remove_opencode_integration() if args.remove else verify_opencode_integration() if args.verify else integrate_opencode()
        _emit(value, as_json)
        return _exit(value)
    return 2


if __name__ == "__main__":
    sys.exit(main())
