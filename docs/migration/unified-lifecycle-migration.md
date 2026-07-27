# Migration to `ocae`

Existing commands remain valid. New target projects should use:

```text
node scripts/ocae.mjs inspect --target <project>
node scripts/ocae.mjs plan --target <project>
node scripts/ocae.mjs install --target <project>
node scripts/ocae.mjs verify --target <project>
```

The first two commands are read-only. `install` and `update` select the legacy
installer layer from discovered evidence and stop on owner content conflicts.
Existing backups remain valid and are consumed by the legacy rollback command.
Use `ocae registry register --registry <local-file> --target <project>` only
when a local multi-project view is wanted; no global registry is created.
