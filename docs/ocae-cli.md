# OCAE CLI

ocae-cli is the distribution layer for the OpenCode-Agenten-Oekosystem. It
bundles a build-generated, hash-verified closure of the canonical Node
installer and invokes that installer from an isolated payload directory.

The Python CLI owns argument validation, package integrity, provenance,
preflight, subprocess orchestration, and presentation. Governance decisions,
configuration merges, backups, rollback, agent installation, source locks, and
runtime assets remain owned by scripts/install-governance.mjs.

## Install from a release ref

    uv tool install ocae-cli --from git+https://github.com/xxammaxx/OpenCode-Agenten-Oekosystem.git@v1.0.0
    ocae doctor .
    ocae install .
    ocae verify .

Node.js is required for the canonical installer. OpenCode is required for
runtime discovery; missing tools are reported as explicit TOOL_GAP results.

## Package boundary

The build backend derives the payload archive from the canonical repository
files at build time. The archive and its manifest are package data, not a
second maintained source tree. ocae verifies the archive, every member hash,
and the installed wheel RECORD before invoking Node.
