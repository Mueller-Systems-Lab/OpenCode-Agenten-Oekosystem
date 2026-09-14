# T7 swarm.ts portable path resolution fix (2026-09-13)

Scope: `.agents/skills/coordinate-blackboard-swarm/adapters/opencode/swarm.ts` only.
Source: evidence/T5-legacy-url-audit-20260913.md area 4 (`swarm.ts:5` hard-depended on
`$HOME/.config/opencode/skills/coordinate-blackboard-swarm`).

## Before

```ts
const skillRoot = `${process.env.HOME}/.config/opencode/skills/coordinate-blackboard-swarm`
const script = `${skillRoot}/scripts/blackboard.py`
```

## After (new resolution logic)

```ts
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const resolveScript = (directory: string) => {
  const candidates = [
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "blackboard.py"),
    resolve(directory, ".agents", "skills", "coordinate-blackboard-swarm", "scripts", "blackboard.py"),
    `${process.env.HOME}/.config/opencode/skills/coordinate-blackboard-swarm/scripts/blackboard.py`,
  ]
  return candidates.find((p) => existsSync(p)) ?? candidates[0]
}

const run = async (args: string[], directory: string) => {
  const script = resolveScript(directory)
```

Fallback order: (1) relative to adapter file location (`import.meta.url` → `../../scripts/blackboard.py`,
mirrors `install.py`'s `Path(__file__).resolve().parents[2]` convention); (2) project-local
`<context.directory>/.agents/skills/coordinate-blackboard-swarm/scripts/blackboard.py` (covers
project-scope installs where only adapter files are copied, no `scripts/` beside the copy);
(3) legacy global `$HOME/.config/...` path as last resort only.

## Sibling-convention check

- `adapters/opencode/install.py:12` resolves skill root via `Path(__file__).resolve().parents[2]` —
  file-relative, portable. Matched with the TS `fileURLToPath(import.meta.url)` equivalent.
- `scripts/*.mjs` repo convention is `fileURLToPath(import.meta.url)` + `path.dirname` + `path.resolve`
  (e.g. `scripts/install-governance.mjs:8,38`). Matched.
- `swarm.md` / `swarm-worker.md` contain no path logic; nothing to align there.
- `swarm-ui/*.ts` contain no path logic.

## Mirror / generator check

- Generator is `adapters/opencode/install.py` (copies source → `.opencode/tools/swarm.ts` project scope
  or global skill dir). Fix applied at the source `swarm.ts` that `install.py` copies from — no generator
  change needed.
- No mirrored copy exists in this repo (`.opencode/tools/` absent; `.opencode/plugins/` holds only
  `canonical-governance.mjs`). Nothing to regenerate or hand-mirror.

## Verification

- `node --check .agents/skills/coordinate-blackboard-swarm/adapters/opencode/swarm.ts` → EXIT:0 (PASS).
- Functional spot-check: candidate 1 resolves to
  `.agents/skills/coordinate-blackboard-swarm/scripts/blackboard.py` and `existsSync` → true.
- `git diff` on the file: only the `resolveScript` block + its call-site added; pre-existing uncommitted
  lines from peer tasks (extended action enum) preserved untouched.
- Untouched as required: blackboard.py, build_backend.py, manifest, tests. No commits/pushes.
