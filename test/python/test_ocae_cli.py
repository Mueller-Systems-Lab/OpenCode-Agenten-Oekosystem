from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import build_backend


os.environ.setdefault("OCAE_ALLOW_DIRTY_BUILD", "1")
build_backend._prepare_payload()

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))
from ocae_cli import cli, payload, provenance, runtime
from ocae_cli import opencode


class PayloadTests(unittest.TestCase):
    def test_payload_manifest_and_archive_are_verified(self):
        result = payload.verify_payload()
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["source_commit"], build_backend._source_commit())
        self.assertGreater(result["file_count"], 50)

    def test_payload_rejects_unsafe_member_paths(self):
        with self.assertRaises(ValueError):
            payload._safe_member_path(Path(tempfile.gettempdir()), "../escape")

    def test_payload_tampering_fails_closed(self):
        original = payload._resource("canonical-runtime.tar.gz")
        reader = payload._resource
        with patch.object(payload, "_resource", side_effect=lambda name: original + b"x" if name == payload.ARCHIVE_NAME else reader(name)):
            self.assertEqual(payload.verify_payload()["status"], "FAIL")

    def test_provenance_is_commit_pinned(self):
        value = provenance.provenance()
        self.assertEqual(value["distribution"], "ocae-cli")
        self.assertTrue(value["source_commit"] == "DIRTY_WORKTREE" or len(value["source_commit"]) == 40)
        self.assertEqual(value["source_repository"], "https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem")


class RuntimeTests(unittest.TestCase):
    def test_node_is_started_with_argument_list_and_payload_cwd(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = type("Completed", (), {"returncode": 0, "stdout": "{}", "stderr": ""})()
            with patch.object(runtime, "resolve_node", return_value="node.exe"), patch.object(
                runtime.subprocess, "run", return_value=fake
            ) as run:
                result = runtime.run_canonical(Path(directory), apply=False)
            self.assertEqual(result["exit_code"], 0)
            arguments = run.call_args.args[0]
            self.assertEqual(arguments[0], "node.exe")
            self.assertIn("--target", arguments)
            self.assertEqual(arguments[arguments.index("--target") + 1], str(Path(directory).resolve()))
            self.assertFalse(run.call_args.kwargs["shell"])
            self.assertNotEqual(run.call_args.kwargs["cwd"], str(Path(directory).resolve()))

    def test_node_gap_maps_to_explicit_tool_gap(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(runtime, "resolve_node", return_value=None):
            result = runtime.run_canonical(Path(directory))
        self.assertEqual(result["classification"], "TOOL_GAP_NODE_RUNTIME")
        self.assertEqual(result["exit_code"], 1)


class CliTests(unittest.TestCase):
    def test_json_version_output_is_machine_readable(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = cli.main(["version", "--json"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output.getvalue())["distribution"], "ocae-cli")

    def test_doctor_missing_target_is_red_block(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing"
            result = cli.main(["doctor", str(missing), "--json"])
        self.assertEqual(result, 2)

    def test_install_dry_run_uses_canonical_result(self):
        fake_result = {"classification": "VERIFIED_IN_SCOPE", "exit_code": 0}
        with patch.object(cli, "run_canonical", return_value=fake_result):
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = cli.main(["install", ".", "--dry-run", "--json"])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output.getvalue())["classification"], "VERIFIED_IN_SCOPE")


class OpenCodeIntegrationTests(unittest.TestCase):
    def test_integrate_command_is_available(self):
        args = cli._parser().parse_args(["integrate", "opencode", "--verify", "--json"])
        self.assertEqual(args.runtime, "opencode")
        self.assertTrue(args.verify)

    def test_global_adapter_is_packaged_and_uses_structured_spawn(self):
        adapter = opencode._adapter_bytes().decode("utf-8")
        self.assertIn('spawn(executable, args, {', adapter)
        self.assertIn('shell: false', adapter)
        self.assertIn('directory', adapter)
        self.assertIn('worktree', adapter)

    def test_integration_is_idempotent_and_removal_is_scoped(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "config"
            executable = Path(directory) / "ocae.exe"
            executable.write_bytes(b"validated ocae launcher")
            fake_opencode = Path(directory) / "opencode.exe"
            fake_opencode.write_bytes(b"validated opencode launcher")
            discovered = (fake_opencode, "1.18.18", config)
            with patch.object(opencode, "_discover_opencode", return_value=discovered), patch.object(
                opencode, "_resolve_ocae", return_value=executable
            ), patch.object(opencode, "tool_version", return_value=(str(executable), opencode.__version__)), patch.object(
                opencode, "run_external", return_value={
                    "exit_code": 0,
                    "stdout": json.dumps({
                        "version": opencode.__version__,
                        "source_repository": "https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem",
                        "source_commit": "4f97bdd6ed78a607a64742352a372ef453a7b009",
                    }),
                    "stderr": "",
                }
            ), patch.object(opencode, "_verify_impl", return_value={"classification": "VERIFIED_IN_SCOPE", "exit_code": 0}
            ):
                first = opencode.integrate_opencode()
                second = opencode.integrate_opencode()
                removed = opencode.remove_opencode_integration()
            self.assertEqual(first["classification"], "VERIFIED_IN_SCOPE")
            self.assertEqual(second["classification"], "NOOP_IDEMPOTENT")
            self.assertEqual(removed["classification"], "VERIFIED_IN_SCOPE")
            self.assertFalse((config / "plugins" / opencode.ADAPTER_FILENAME).exists())
            self.assertFalse((config / opencode.MANIFEST_FILENAME).exists())

    def test_failed_runtime_verification_rolls_back_new_integration(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "config"
            executable = Path(directory) / "ocae.exe"
            executable.write_bytes(b"validated ocae launcher")
            fake_opencode = Path(directory) / "opencode.exe"
            fake_opencode.write_bytes(b"validated opencode launcher")
            discovered = (fake_opencode, "1.18.18", config)
            with patch.object(opencode, "_discover_opencode", return_value=discovered), patch.object(
                opencode, "_resolve_ocae", return_value=executable
            ), patch.object(opencode, "tool_version", return_value=(str(executable), opencode.__version__)), patch.object(
                opencode, "run_external", return_value={
                    "exit_code": 0,
                    "stdout": json.dumps({
                        "version": opencode.__version__,
                        "source_repository": "https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem",
                        "source_commit": "4f97bdd6ed78a607a64742352a372ef453a7b009",
                    }),
                    "stderr": "",
                }
            ), patch.object(
                opencode, "_verify_impl", return_value={
                    "classification": "RED_BLOCK_PLUGIN_RUNTIME_SMOKE",
                    "exit_code": 2,
                    "runtime_smoke": {"passed": False, "state": "EXITED_EARLY", "exit_code": 1},
                }
            ):
                result = opencode.integrate_opencode()

            self.assertEqual(result["classification"], "INTEGRATION_ROLLED_BACK")
            self.assertFalse((config / "plugins" / opencode.ADAPTER_FILENAME).exists())
            self.assertFalse((config / opencode.MANIFEST_FILENAME).exists())

    def test_failed_runtime_verification_restores_previous_integration(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "config"
            adapter = config / "plugins" / opencode.ADAPTER_FILENAME
            manifest_path = config / opencode.MANIFEST_FILENAME
            executable = Path(directory) / "ocae.exe"
            executable.write_bytes(b"validated ocae launcher")
            fake_opencode = Path(directory) / "opencode.exe"
            fake_opencode.write_bytes(b"validated opencode launcher")
            previous_adapter = b"previous adapter content"
            adapter.parent.mkdir(parents=True)
            adapter.write_bytes(previous_adapter)
            previous_manifest = json.dumps({
                "integration_id": opencode.INTEGRATION_ID,
                "integration_version": "1.0.3",
                "opencode_version": "1.18.18",
                "supported_opencode_range": opencode.SUPPORTED_OPENCODE_RANGE,
                "adapter_path": str(adapter),
                "adapter_sha256": opencode._sha256_bytes(previous_adapter),
                "cli_path": str(executable),
                "cli_sha256": opencode._sha256_file(executable),
            }, sort_keys=True).encode("utf-8")
            manifest_path.write_bytes(previous_manifest)
            discovered = (fake_opencode, "1.18.18", config)
            with patch.object(opencode, "_discover_opencode", return_value=discovered), patch.object(
                opencode, "_resolve_ocae", return_value=executable
            ), patch.object(opencode, "tool_version", return_value=(str(executable), opencode.__version__)), patch.object(
                opencode, "run_external", return_value={
                    "exit_code": 0,
                    "stdout": json.dumps({
                        "version": opencode.__version__,
                        "source_repository": "https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem",
                        "source_commit": "4f97bdd6ed78a607a64742352a372ef453a7b009",
                    }),
                    "stderr": "",
                }
            ), patch.object(
                opencode, "_verify_impl", return_value={
                    "classification": "RED_BLOCK_PLUGIN_RUNTIME_SMOKE",
                    "exit_code": 2,
                    "runtime_smoke": {"passed": False, "state": "EXITED_EARLY", "exit_code": 1},
                }
            ):
                result = opencode.integrate_opencode()

            self.assertEqual(result["classification"], "INTEGRATION_ROLLED_BACK")
            self.assertEqual(adapter.read_bytes(), previous_adapter)
            self.assertEqual(manifest_path.read_bytes(), previous_manifest)

    def test_adapter_rejects_unowned_global_filename(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "config"
            adapter = config / "plugins" / opencode.ADAPTER_FILENAME
            adapter.parent.mkdir(parents=True)
            adapter.write_bytes(b"owner content")
            with patch.object(opencode, "_discover_opencode", return_value=(Path(directory) / "opencode.exe", "1.18.18", config)):
                result = opencode.integrate_opencode()
            self.assertEqual(result["classification"], "RED_BLOCK_INTEGRATION_OWNERSHIP")
