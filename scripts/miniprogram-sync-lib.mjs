import fs from "node:fs";
import path from "node:path";

export const ROOT_EXCLUDES = new Set([
  "project.config.json",
  "project.private.config.json",
  "project.miniapp.json",
  "app.miniapp.json"
]);

export const DIRECTORY_EXCLUDES = new Set([
  ".git",
  ".idea",
  ".vscode",
  ".cache",
  "cache",
  "node_modules",
  "miniprogram_npm"
]);

function toPosixPath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function validateRelativeSyncPath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error("Sync path must be a non-empty relative path.");
  }
  if (relativePath.includes("\0") || path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new Error(`Sync path must be relative: ${relativePath}`);
  }

  const parts = relativePath.split(/[\\/]/);
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Sync path must not escape with relative segments: ${relativePath}`);
  }
  if (parts.length === 1 && ROOT_EXCLUDES.has(parts[0])) {
    throw new Error(`Sync path is an excluded root file: ${relativePath}`);
  }
  if (parts.some((part) => DIRECTORY_EXCLUDES.has(part))) {
    throw new Error(`Sync path is inside an excluded directory: ${relativePath}`);
  }

  return parts.join("/");
}

export function assertPathInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path is outside sync root: ${resolvedCandidate}`);
  }

  return resolvedCandidate;
}

function assertNoSymbolicLinkPath(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = assertPathInside(resolvedRoot, candidate);
  const rootStat = fs.lstatSync(resolvedRoot);
  if (rootStat.isSymbolicLink()) {
    throw new Error(`Symbolic link or reparse point is not allowed: ${resolvedRoot}`);
  }

  const relative = path.relative(resolvedRoot, resolvedCandidate);
  let current = resolvedRoot;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Symbolic link or reparse point is not allowed: ${current}`);
    }
  }
}

export function listSyncFiles(root) {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
    throw new Error(`Miniprogram sync root not found: ${resolvedRoot}`);
  }
  assertNoSymbolicLinkPath(resolvedRoot, resolvedRoot);

  const realRoot = fs.realpathSync.native(resolvedRoot);
  const files = [];

  function walk(directory, relativeDirectory = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (!relativeDirectory && ROOT_EXCLUDES.has(entry.name)) continue;
      if (DIRECTORY_EXCLUDES.has(entry.name) && entry.isDirectory()) continue;

      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || fs.lstatSync(fullPath).isSymbolicLink()) {
        throw new Error(`Symbolic link or reparse point is not allowed: ${fullPath}`);
      }

      const realPath = fs.realpathSync.native(fullPath);
      assertPathInside(realRoot, realPath);

      if (entry.isDirectory()) {
        walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        files.push(toPosixPath(relativePath));
      } else {
        throw new Error(`Unsupported filesystem entry in sync tree: ${fullPath}`);
      }
    }
  }

  walk(resolvedRoot);
  return files.sort();
}

function filePath(root, relativePath) {
  const normalized = validateRelativeSyncPath(relativePath);
  return assertPathInside(root, path.resolve(root, ...normalized.split("/")));
}

export function compareMiniprogramTrees(sourceRoot, targetRoot) {
  const sourceFiles = listSyncFiles(sourceRoot);
  const targetFiles = listSyncFiles(targetRoot);
  const sourceSet = new Set(sourceFiles);
  const targetSet = new Set(targetFiles);

  const added = sourceFiles.filter((relativePath) => !targetSet.has(relativePath));
  const deleted = targetFiles.filter((relativePath) => !sourceSet.has(relativePath));
  const changed = sourceFiles.filter((relativePath) => {
    if (!targetSet.has(relativePath)) return false;
    const sourceBytes = fs.readFileSync(filePath(sourceRoot, relativePath));
    const targetBytes = fs.readFileSync(filePath(targetRoot, relativePath));
    return !sourceBytes.equals(targetBytes);
  });

  return {
    added: added.sort(),
    changed: changed.sort(),
    deleted: deleted.sort()
  };
}

function removeEmptyParentDirectories(targetRoot, deletedPaths) {
  const directories = new Set();
  for (const relativePath of deletedPaths) {
    let directory = path.posix.dirname(relativePath);
    while (directory !== ".") {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }

  const deepestFirst = [...directories].sort((left, right) => {
    const depthDifference = right.split("/").length - left.split("/").length;
    return depthDifference || right.localeCompare(left);
  });

  for (const relativeDirectory of deepestFirst) {
    const targetDirectory = filePath(targetRoot, `${relativeDirectory}/.sync-placeholder`);
    const directoryPath = path.dirname(targetDirectory);
    assertPathInside(targetRoot, directoryPath);
    assertNoSymbolicLinkPath(targetRoot, directoryPath);
    try {
      fs.rmdirSync(directoryPath);
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error;
    }
  }
}

export function applyMiniprogramSync(sourceRoot, targetRoot, differences) {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const resolvedTargetRoot = path.resolve(targetRoot);
  listSyncFiles(resolvedSourceRoot);
  const allowedTargetFiles = new Set(listSyncFiles(resolvedTargetRoot));

  const deletedPaths = differences.deleted.map(validateRelativeSyncPath);
  const actuallyDeletedPaths = [];
  for (const relativePath of deletedPaths) {
    const targetPath = filePath(resolvedTargetRoot, relativePath);
    assertPathInside(resolvedTargetRoot, targetPath);
    assertNoSymbolicLinkPath(resolvedTargetRoot, targetPath);
    if (!fs.existsSync(targetPath)) continue;
    if (!allowedTargetFiles.has(relativePath) || !fs.lstatSync(targetPath).isFile()) {
      throw new Error(`Refusing to delete non-sync target file: ${relativePath}`);
    }
    fs.unlinkSync(targetPath);
    actuallyDeletedPaths.push(relativePath);
  }
  removeEmptyParentDirectories(resolvedTargetRoot, actuallyDeletedPaths);

  for (const relativePath of [...differences.added, ...differences.changed].map(validateRelativeSyncPath)) {
    const sourcePath = filePath(resolvedSourceRoot, relativePath);
    const targetPath = filePath(resolvedTargetRoot, relativePath);
    assertPathInside(resolvedSourceRoot, sourcePath);
    assertPathInside(resolvedTargetRoot, targetPath);
    assertNoSymbolicLinkPath(resolvedSourceRoot, sourcePath);
    assertNoSymbolicLinkPath(resolvedTargetRoot, targetPath);
    if (!fs.existsSync(sourcePath) || !fs.lstatSync(sourcePath).isFile()) {
      throw new Error(`Sync source file not found: ${relativePath}`);
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    assertNoSymbolicLinkPath(resolvedTargetRoot, path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
  }
}

export async function assertRepositoryMirrorClean(repoRoot, runGit) {
  const output = await runGit(
    ["status", "--porcelain", "--", "apps/miniprogram"],
    { cwd: repoRoot }
  );
  const text = Array.isArray(output) ? output.join("\n") : String(output ?? "");
  if (text.trim()) {
    throw new Error(`apps/miniprogram mirror is dirty; refusing reverse sync:\n${text.trim()}`);
  }
}
