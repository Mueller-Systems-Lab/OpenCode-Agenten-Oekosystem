# Windows Symlink Host Gate

Classification: `HOST_SYMLINK_CAPABILITY_REQUIRED`.

Observed on the current host:

- Developer Mode registry value: not present/unknown.
- `SeCreateSymbolicLinkPrivilege`: not present in `whoami /priv` output.
- `wsl.exe`: installed, but no Linux distribution is registered; the list
  command returned usage output and exit code 1.
- Node symlink creation: reproducibly fails with `EPERM` in the direct
  security tests.

The affected tests attempt real symlink attacks against secret isolation,
path containment, bootstrap boundaries, and the approval ledger. Junctions
were not substituted because they do not prove the same semantic property.
No skip, weaker assertion, or fake symlink result was introduced.

Required follow-up is a suitable Windows account/Developer Mode or an already
authorized Linux CI/WSL host, followed by the unchanged canonical test suite.
