import fs from "node:fs/promises"
import path from "node:path"
import { fileHash, ensureDirectory, ensureParentDirectory, pathExists, copyFile, relativePath, toAbsolutePath, isInsideRoot, removeIfExists, assertSafePath } from "./paths.mjs"

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-")
}

async function ensureBackupGitignore(backupRoot) {
  const gitignorePath = path.join(backupRoot, ".gitignore")
  if (!(await pathExists(gitignorePath))) {
    await ensureParentDirectory(gitignorePath)
    await fs.writeFile(gitignorePath, "*\n!.gitignore\n", "utf8")
  }
}

export async function createBackup({ targetRoot, files, backupRoot }) {
  const root = toAbsolutePath(targetRoot)
  const backupDir = backupRoot
    ? toAbsolutePath(backupRoot, root)
    : path.join(root, ".opencode", "backups", `bootstrap-${timestampSlug()}`)

  await ensureDirectory(backupDir)
  await ensureBackupGitignore(path.join(root, ".opencode", "backups"))

  const manifest = {
    version: "1.0.0",
    created_at: new Date().toISOString(),
    target_root: root,
    backup_root: backupDir,
    files: [],
  }

  for (const filePath of files) {
    const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath)
    await assertSafePath(root, absolute, "backup target")

    if (!(await pathExists(absolute))) {
      manifest.files.push({
        path: relativePath(root, absolute),
        existed: false,
      })
      continue
    }

    const stat = await fs.lstat(absolute)
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to back up symlinked path: ${absolute}`)
    }

    if (stat.isDirectory()) {
      // Recursively backup directory contents
      const entries = await fs.readdir(absolute, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue // skip hidden files/dirs
        const subPath = path.join(absolute, entry.name)
        const subStat = await fs.lstat(subPath)
        if (subStat.isSymbolicLink()) {
          continue // skip symlinks in directory trees
        }
        if (subStat.isFile()) {
          const subRel = relativePath(root, subPath)
          const subDest = path.join(backupDir, subRel)
          await ensureParentDirectory(subDest)
          await copyFile(subPath, subDest)
          manifest.files.push({
            path: subRel,
            existed: true,
            backup_path: relativePath(backupDir, subDest),
            sha256: await fileHash(subPath),
            size: subStat.size,
          })
        }
      }
      // Add the directory itself as an entry for tracking
      manifest.files.push({
        path: relativePath(root, absolute),
        existed: true,
        is_directory: true,
      })
    } else if (stat.isFile()) {
      const rel = relativePath(root, absolute)
      const destination = path.join(backupDir, rel)
      await copyFile(absolute, destination)
      manifest.files.push({
        path: rel,
        existed: true,
        backup_path: relativePath(backupDir, destination),
        sha256: await fileHash(absolute),
        size: stat.size,
      })
    } else {
      // Other types (e.g., sockets, devices) — skip
      manifest.files.push({
        path: relativePath(root, absolute),
        existed: true,
        skipped: true,
        type: 'non-file-non-directory',
      })
    }
  }

  await fs.writeFile(path.join(backupDir, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return { backupDir, manifest }
}

export async function restoreBackup({ backupRoot, expectedTargetRoot }) {
  const root = toAbsolutePath(backupRoot)
  const manifestPath = path.join(root, "backup-manifest.json")
  if (!(await pathExists(manifestPath))) {
    throw new Error(`Missing backup manifest: ${manifestPath}`)
  }

  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"))
  const targetRoot = manifest.target_root

  if (expectedTargetRoot && toAbsolutePath(expectedTargetRoot) !== targetRoot) {
    throw new Error(`Backup target_root (${targetRoot}) does not match expected (${expectedTargetRoot})`)
  }

  for (const entry of manifest.files) {
    const destination = path.resolve(targetRoot, entry.path)
    await assertSafePath(targetRoot, destination, "restore target")
    if (entry.is_directory) {
      await ensureDirectory(destination)
      continue
    }
    if (!entry.existed) {
      if (await pathExists(destination)) {
        await fs.rm(destination, { recursive: true, force: true })
      }
      continue
    }
    const source = path.join(root, entry.backup_path)
    await ensureParentDirectory(destination)
    await fs.copyFile(source, destination)
  }

  return { targetRoot, manifest }
}

export async function removeBackup(backupRoot) {
  await removeIfExists(backupRoot)
}
