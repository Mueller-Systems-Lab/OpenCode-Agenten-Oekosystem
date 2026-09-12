#!/usr/bin/env python3
"""Install the small OpenCode adapter without touching unrelated project files."""
from pathlib import Path
import shutil
import hashlib
import json
import sys

MARKERS = ("# coordinate-blackboard-swarm: managed adapter", "// coordinate-blackboard-swarm: managed adapter", "<!-- coordinate-blackboard-swarm: managed adapter -->")

def main() -> int:
    skill = Path(__file__).resolve().parents[2]
    global_install = "--global" in sys.argv[1:]
    args = [x for x in sys.argv[1:] if x != "--global"]
    if global_install:
        repo = Path.home() / ".config" / "opencode"
    else:
        repo = Path(args[0]).resolve() if args else next((p for p in [Path.cwd(), *Path.cwd().parents] if (p / ".git").exists()), None)
    if repo is None or not (repo / ".git").exists():
        if global_install:
            repo.mkdir(parents=True, exist_ok=True)
        else:
            print("INSTALL|FAIL|REPOSITORY_NOT_FOUND")
            return 2
    if global_install and not repo.is_dir():
        print("INSTALL|FAIL|REPOSITORY_NOT_FOUND")
        return 2
    if not (skill / "scripts/blackboard.py").is_file():
        print("INSTALL|FAIL|SKILL_INVALID")
        return 2
    if shutil.which("opencode") is None:
        print("INSTALL|FAIL|OPENCODE_NOT_FOUND")
        return 2
    prefix = "" if global_install else ".opencode/"
    managed = {
        f"{prefix}tools/swarm.ts": skill / "adapters/opencode/swarm.ts",
        f"{prefix}agents/swarm.md": skill / "adapters/opencode/swarm.md",
        f"{prefix}agents/swarm-worker.md": skill / "adapters/opencode/swarm-worker.md",
        f"{prefix}plugins/blackboard-ui/index.ts": skill / "adapters/opencode/swarm-ui/index.ts",
        f"{prefix}plugins/blackboard-ui/tui.ts": skill / "adapters/opencode/swarm-ui/tui.ts",
        ("skills/coordinate-blackboard-swarm/SKILL.md" if global_install else "__no_skill__"): skill / "SKILL.md",
    }
    previous_manifest = {}
    if global_install:
        manifest_path = repo / "coordinate-blackboard-swarm.manifest.json"
        if manifest_path.is_file():
            try:
                previous_manifest = json.loads(manifest_path.read_text(encoding="utf-8")).get("files", {})
            except (OSError, ValueError, TypeError):
                previous_manifest = {}
    manifest = {}
    for rel, src in managed.items():
        if rel == "__no_skill__":
            continue
        if not src.is_file():
            print(f"INSTALL|FAIL|MISSING_SOURCE|{src}")
            return 2
        dst = repo / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists():
            source_hash = hashlib.sha256(src.read_bytes()).hexdigest()
            existing_hash = hashlib.sha256(dst.read_bytes()).hexdigest()
            marked = any(marker in dst.read_text(encoding="utf-8") for marker in MARKERS)
            if existing_hash != source_hash and not marked and rel not in previous_manifest:
                print(f"INSTALL|FAIL|UNMANAGED_COLLISION|{rel}")
                return 2
        shutil.copyfile(src, dst)
        manifest[rel] = hashlib.sha256(dst.read_bytes()).hexdigest()
    if global_install:
        global_skill = repo / "skills/coordinate-blackboard-swarm"
        for src in sorted(skill.rglob("*")):
            if not src.is_file() or "__pycache__" in src.parts or src.name.endswith(".pyc"):
                continue
            rel = src.relative_to(skill).as_posix()
            if rel == "SKILL.md":
                continue
            dst = global_skill / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            if dst.exists() and hashlib.sha256(dst.read_bytes()).hexdigest() != hashlib.sha256(src.read_bytes()).hexdigest() and f"skills/coordinate-blackboard-swarm/{rel}" not in previous_manifest:
                print(f"INSTALL|FAIL|UNMANAGED_COLLISION|skills/coordinate-blackboard-swarm/{rel}")
                return 2
            shutil.copyfile(src, dst)
            manifest[f"skills/coordinate-blackboard-swarm/{rel}"] = hashlib.sha256(dst.read_bytes()).hexdigest()
    if global_install:
        manifest_path = repo / "coordinate-blackboard-swarm.manifest.json"
        manifest_path.write_text(json.dumps({"source": str(skill), "files": manifest}, indent=2) + "\n", encoding="utf-8")
    print(f"INSTALL|PASS|MANAGED_FILES={len(manifest)}|BLACKBOARD_ENGINE=1|DUPLICATES=0|SCOPE={'global' if global_install else 'project'}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
