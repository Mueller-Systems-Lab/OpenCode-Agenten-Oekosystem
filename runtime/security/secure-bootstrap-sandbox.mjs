import path from "node:path"

function baseFilesystemArgs() {
  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-cgroup-try",
    "--clearenv",
    "--cap-drop", "ALL",
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/bin", "/bin",
    "--ro-bind", "/lib", "/lib",
    "--ro-bind", "/lib64", "/lib64",
    "--dir", "/run",
    "--dir", "/etc",
    "--dir", "/etc/ssl",
    "--ro-bind-try", "/etc/resolv.conf", "/etc/resolv.conf",
    "--ro-bind-try", "/etc/hosts", "/etc/hosts",
    "--ro-bind-try", "/etc/nsswitch.conf", "/etc/nsswitch.conf",
    "--ro-bind-try", "/etc/ssl/certs", "/etc/ssl/certs",
    "--ro-bind-try", "/etc/ca-certificates", "/etc/ca-certificates",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--tmpfs", "/home",
  ]
  return args
}

export function buildModelSandboxArgs({
  executable,
  sandboxHome,
  sandboxWork,
  configPath,
  command = [],
}) {
  return [
    ...baseFilesystemArgs(),
    "--bind", sandboxHome, "/sandbox-home",
    "--bind", sandboxWork, "/work",
    "--ro-bind", executable, "/run/opencode",
    "--ro-bind", configPath, "/run/opencode.json",
    "--setenv", "HOME", "/sandbox-home",
    "--setenv", "XDG_CONFIG_HOME", "/sandbox-home/.config",
    "--setenv", "XDG_DATA_HOME", "/sandbox-home/.local/share",
    "--setenv", "XDG_CACHE_HOME", "/sandbox-home/.cache",
    "--setenv", "OPENCODE_CONFIG", "/run/opencode.json",
    "--setenv", "OPENCODE_DISABLE_MODELS_FETCH", "1",
    "--setenv", "PATH", "/run:/usr/bin:/bin",
    "--chdir", "/work",
    "--",
    "/run/opencode",
    ...command,
  ]
}

export function buildActionSandboxArgs({
  sourceRoot,
  targetRoot,
  sandboxState,
  maskedRelativePaths = [],
  writable = false,
  command = [],
  nodeExecutable = process.execPath,
  environment = {},
}) {
  const targetBind = writable ? "--bind" : "--ro-bind"
  const args = [
    ...baseFilesystemArgs(),
    "--unshare-net",
    "--ro-bind", sourceRoot, "/source",
    targetBind, targetRoot, "/target",
    "--bind", sandboxState, "/state",
    "--ro-bind", nodeExecutable, "/runtime/node",
    "--setenv", "HOME", "/sandbox-home",
    "--setenv", "PATH", "/runtime:/usr/bin:/bin",
    "--setenv", "TMPDIR", "/tmp",
  ]
  for (const [name, value] of Object.entries(environment)) {
    args.push("--setenv", name, String(value))
  }
  for (const relativePath of maskedRelativePaths) {
    const portable = String(relativePath).replaceAll("\\", "/").replace(/^\/+/, "")
    const isDirectory = portable === ".git" || portable.endsWith("/")
    args.push(
      "--ro-bind",
      path.join(sandboxState, isDirectory ? "denied-dir" : "denied-file"),
      path.posix.join("/target", portable),
    )
  }
  args.push("--chdir", "/source", "--", ...command)
  return args
}
