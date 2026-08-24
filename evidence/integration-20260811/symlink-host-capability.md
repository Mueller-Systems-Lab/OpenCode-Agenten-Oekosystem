# Symlink Host Capability

Host probe on Windows:

- Node: `v24.13.0`
- Filesystem: NTFS on `C:`
- `SeCreateSymbolicLinkPrivilege`: not available in the active token; `whoami /priv` exposed only the enabled change-notify privilege.
- Real `fs.symlinkSync` probe: `EPERM`.
- Developer Mode: not determinable as enabled.
- WSL: no registered distribution; no alternate POSIX-capable host was available.
- Junctions were not used and security assertions were not weakened.

The two failing tests are host-capability failures while creating the adversarial symlink, not product assertion failures:

- `test/security/bootstrap-bypass-red-team.test.mjs`
- `test/security/bootstrap-secret-isolation.test.mjs`

