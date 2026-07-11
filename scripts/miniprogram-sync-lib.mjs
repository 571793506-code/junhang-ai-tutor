import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

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

const ROOT_EXCLUDE_KEYS = new Set([...ROOT_EXCLUDES].map((item) => item.toLowerCase()));
const DIRECTORY_EXCLUDE_KEYS = new Set([...DIRECTORY_EXCLUDES].map((item) => item.toLowerCase()));
const SYNC_PLAN_SNAPSHOTS = new WeakMap();

function toPosixPath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

export function isSyncPathExcluded(relativePath) {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  const lowerParts = parts.map((part) => part.toLowerCase());
  return (
    (lowerParts.length === 1 && ROOT_EXCLUDE_KEYS.has(lowerParts[0])) ||
    lowerParts.some((part) => DIRECTORY_EXCLUDE_KEYS.has(part))
  );
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
  if (parts.length === 1 && ROOT_EXCLUDE_KEYS.has(parts[0].toLowerCase())) {
    throw new Error(`Sync path is an excluded root file: ${relativePath}`);
  }
  if (parts.some((part) => DIRECTORY_EXCLUDE_KEYS.has(part.toLowerCase()))) {
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

function assertDirectoryRoot(root, label) {
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`${label} root not found: ${resolvedRoot}`);
  }
  const stat = fs.lstatSync(resolvedRoot);
  if (stat.isSymbolicLink()) {
    throw new Error(`Symbolic link or reparse point is not allowed: ${resolvedRoot}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} root must be a directory: ${resolvedRoot}`);
  }
  return resolvedRoot;
}

function caseFoldedRealPath(root) {
  return fs.realpathSync.native(root).replace(/[\\/]+/g, path.sep).toLowerCase();
}

export function validateMiniprogramRoots(sourceRoot, targetRoot) {
  const resolvedSourceRoot = assertDirectoryRoot(sourceRoot, "Source");
  const resolvedTargetRoot = assertDirectoryRoot(targetRoot, "Target");
  const sourceKey = caseFoldedRealPath(resolvedSourceRoot);
  const targetKey = caseFoldedRealPath(resolvedTargetRoot);
  const sourcePrefix = `${sourceKey}${path.sep}`;
  const targetPrefix = `${targetKey}${path.sep}`;

  if (sourceKey === targetKey) {
    throw new Error("Source and target roots must not be the same directory.");
  }
  if (sourceKey.startsWith(targetPrefix) || targetKey.startsWith(sourcePrefix)) {
    throw new Error("Source and target roots must not overlap.");
  }

  return { sourceRoot: resolvedSourceRoot, targetRoot: resolvedTargetRoot };
}

function assertRegularFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular file: ${filePath}`);
  }
}

export function validateSourceIdentity(sourceRoot) {
  const resolvedSourceRoot = assertDirectoryRoot(sourceRoot, "Source");
  const projectConfigPath = path.join(resolvedSourceRoot, "project.config.json");
  const appJsonPath = path.join(resolvedSourceRoot, "app.json");
  assertRegularFile(projectConfigPath, "project.config.json");
  assertRegularFile(appJsonPath, "app.json");

  let projectConfig;
  try {
    projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid project.config.json: ${error.message}`);
  }
  if (projectConfig.projectArchitecture !== "multiPlatform") {
    throw new Error("project.config.json projectArchitecture must be multiPlatform.");
  }
  if (projectConfig.compileType !== "miniprogram") {
    throw new Error("project.config.json compileType must be miniprogram.");
  }

  return projectConfig;
}

export function listSyncFiles(root) {
  const resolvedRoot = assertDirectoryRoot(root, "Miniprogram sync");
  assertNoSymbolicLinkPath(resolvedRoot, resolvedRoot);

  const realRoot = fs.realpathSync.native(resolvedRoot);
  const files = [];

  function walk(directory, relativeDirectory = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (isSyncPathExcluded(relativePath)) continue;

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

function digestBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function captureFileState(root, relativePath) {
  const absolutePath = filePath(root, relativePath);
  assertNoSymbolicLinkPath(root, absolutePath);

  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "absent" };
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Sync entry must be a regular file: ${relativePath}`);
  }

  const bytes = fs.readFileSync(absolutePath);
  return {
    status: "present",
    size: bytes.length,
    digest: digestBytes(bytes),
    bytes
  };
}

function snapshotFileState(state) {
  if (state.status === "absent") return { status: "absent" };
  return { status: "present", size: state.size, digest: state.digest };
}

function fileStatesMatch(left, right) {
  if (left.status !== right.status) return false;
  if (left.status === "absent") return true;
  return left.size === right.size && left.digest === right.digest;
}

export function compareMiniprogramTrees(sourceRoot, targetRoot) {
  const { sourceRoot: resolvedSourceRoot, targetRoot: resolvedTargetRoot } = validateMiniprogramRoots(
    sourceRoot,
    targetRoot
  );
  const sourceFiles = listSyncFiles(resolvedSourceRoot);
  const targetFiles = listSyncFiles(resolvedTargetRoot);
  const allFiles = [...new Set([...sourceFiles, ...targetFiles])].sort();
  const states = new Map();
  const added = [];
  const changed = [];
  const deleted = [];

  for (const relativePath of allFiles) {
    const sourceState = captureFileState(resolvedSourceRoot, relativePath);
    const targetState = captureFileState(resolvedTargetRoot, relativePath);
    states.set(relativePath, { source: sourceState, target: targetState });
    if (sourceState.status === "present" && targetState.status === "absent") {
      added.push(relativePath);
    } else if (sourceState.status === "absent" && targetState.status === "present") {
      deleted.push(relativePath);
    } else if (
      sourceState.status === "present" &&
      targetState.status === "present" &&
      !sourceState.bytes.equals(targetState.bytes)
    ) {
      changed.push(relativePath);
    }
  }

  const plan = { added, changed, deleted };
  const relevantStates = new Map();
  for (const relativePath of [...added, ...changed, ...deleted]) {
    const state = states.get(relativePath);
    relevantStates.set(relativePath, {
      source: snapshotFileState(state.source),
      target: snapshotFileState(state.target)
    });
  }
  SYNC_PLAN_SNAPSHOTS.set(plan, {
    sourceRoot: caseFoldedRealPath(resolvedSourceRoot),
    targetRoot: caseFoldedRealPath(resolvedTargetRoot),
    differences: {
      added: [...added],
      changed: [...changed],
      deleted: [...deleted]
    },
    files: relevantStates
  });
  return plan;
}

function validateDifferences(differences) {
  const validated = {};
  for (const key of ["added", "changed", "deleted"]) {
    if (!Array.isArray(differences?.[key])) {
      throw new Error(`Sync differences ${key} must be an array.`);
    }
    validated[key] = differences[key].map(validateRelativeSyncPath);
  }
  return validated;
}

function differencesMatch(left, right) {
  return ["added", "changed", "deleted"].every((key) => (
    left[key].length === right[key].length &&
    left[key].every((item, index) => item === right[key][index])
  ));
}

function assertPlanPathUnchanged(planSnapshot, sourceRoot, targetRoot, relativePath) {
  const expected = planSnapshot.files.get(relativePath);
  if (!expected) {
    throw new Error(`stale sync plan content: missing snapshot for ${relativePath}`);
  }
  const sourceState = captureFileState(sourceRoot, relativePath);
  const targetState = captureFileState(targetRoot, relativePath);
  if (!fileStatesMatch(expected.source, sourceState)) {
    throw new Error(`stale sync plan content: source changed for ${relativePath}`);
  }
  if (!fileStatesMatch(expected.target, targetState)) {
    throw new Error(`stale sync plan content: target changed for ${relativePath}`);
  }
}

function assertPlanContentUnchanged(planSnapshot, sourceRoot, targetRoot) {
  for (const relativePath of planSnapshot.files.keys()) {
    assertPlanPathUnchanged(planSnapshot, sourceRoot, targetRoot, relativePath);
  }
}

function assertPlanSourceUnchanged(planSnapshot, sourceRoot, relativePath) {
  const expected = planSnapshot.files.get(relativePath)?.source;
  if (!expected || !fileStatesMatch(expected, captureFileState(sourceRoot, relativePath))) {
    throw new Error(`stale sync plan content: source changed for ${relativePath}`);
  }
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

function replaceTargetFile(sourceRoot, targetRoot, relativePath, targetExists, planSnapshot) {
  const sourcePath = filePath(sourceRoot, relativePath);
  const targetPath = filePath(targetRoot, relativePath);
  const targetDirectory = path.dirname(targetPath);
  assertPathInside(sourceRoot, sourcePath);
  assertPathInside(targetRoot, targetPath);
  assertNoSymbolicLinkPath(sourceRoot, sourcePath);
  assertNoSymbolicLinkPath(targetRoot, targetPath);
  if (!fs.existsSync(sourcePath) || !fs.lstatSync(sourcePath).isFile()) {
    throw new Error(`Sync source file not found: ${relativePath}`);
  }

  assertPlanPathUnchanged(planSnapshot, sourceRoot, targetRoot, relativePath);
  fs.mkdirSync(targetDirectory, { recursive: true });
  assertNoSymbolicLinkPath(targetRoot, targetDirectory);
  const temporaryPath = assertPathInside(
    targetRoot,
    path.join(targetDirectory, `.miniprogram-sync-${randomUUID()}.tmp`)
  );
  let temporaryExists = false;

  try {
    assertPlanPathUnchanged(planSnapshot, sourceRoot, targetRoot, relativePath);
    fs.copyFileSync(sourcePath, temporaryPath, fs.constants.COPYFILE_EXCL);
    temporaryExists = true;
    assertPathInside(targetRoot, temporaryPath);
    assertNoSymbolicLinkPath(targetRoot, temporaryPath);
    if (!fs.lstatSync(temporaryPath).isFile()) {
      throw new Error(`Temporary sync entry is not a regular file: ${temporaryPath}`);
    }
    const expectedSourceState = planSnapshot.files.get(relativePath).source;
    const temporaryBytes = fs.readFileSync(temporaryPath);
    const temporaryState = {
      status: "present",
      size: temporaryBytes.length,
      digest: digestBytes(temporaryBytes)
    };
    if (!fileStatesMatch(expectedSourceState, temporaryState)) {
      throw new Error(`stale sync plan content: temporary copy changed for ${relativePath}`);
    }

    if (targetExists) {
      assertPlanPathUnchanged(planSnapshot, sourceRoot, targetRoot, relativePath);
      assertPathInside(targetRoot, targetPath);
      assertNoSymbolicLinkPath(targetRoot, targetPath);
      if (!fs.existsSync(targetPath) || !fs.lstatSync(targetPath).isFile()) {
        throw new Error(`Target changed during sync: ${relativePath}`);
      }
      fs.unlinkSync(targetPath);
      assertPlanSourceUnchanged(planSnapshot, sourceRoot, relativePath);
      if (captureFileState(targetRoot, relativePath).status !== "absent") {
        throw new Error(`stale sync plan content: target changed for ${relativePath}`);
      }
    } else {
      assertPlanPathUnchanged(planSnapshot, sourceRoot, targetRoot, relativePath);
    }

    assertPathInside(targetRoot, temporaryPath);
    assertPathInside(targetRoot, targetPath);
    assertNoSymbolicLinkPath(targetRoot, targetDirectory);
    fs.renameSync(temporaryPath, targetPath);
    temporaryExists = false;
  } finally {
    if (temporaryExists && fs.existsSync(temporaryPath)) {
      assertPathInside(targetRoot, temporaryPath);
      fs.unlinkSync(temporaryPath);
    }
  }
}

export function applyMiniprogramSync(sourceRoot, targetRoot, differences) {
  const { sourceRoot: resolvedSourceRoot, targetRoot: resolvedTargetRoot } = validateMiniprogramRoots(
    sourceRoot,
    targetRoot
  );
  const validatedDifferences = validateDifferences(differences);
  const planSnapshot = SYNC_PLAN_SNAPSHOTS.get(differences);
  if (!planSnapshot) {
    throw new Error("untrusted sync plan");
  }
  if (
    planSnapshot.sourceRoot !== caseFoldedRealPath(resolvedSourceRoot) ||
    planSnapshot.targetRoot !== caseFoldedRealPath(resolvedTargetRoot)
  ) {
    throw new Error("stale sync plan roots");
  }
  if (!differencesMatch(validatedDifferences, planSnapshot.differences)) {
    throw new Error("stale sync plan differences");
  }

  const freshDifferences = compareMiniprogramTrees(resolvedSourceRoot, resolvedTargetRoot);
  if (!differencesMatch(validatedDifferences, freshDifferences)) {
    throw new Error("stale sync differences");
  }
  assertPlanContentUnchanged(planSnapshot, resolvedSourceRoot, resolvedTargetRoot);

  const allowedSourceFiles = new Set(listSyncFiles(resolvedSourceRoot));
  for (const relativePath of [...validatedDifferences.added, ...validatedDifferences.changed]) {
    if (!allowedSourceFiles.has(relativePath)) {
      throw new Error(`Sync source path is not allowed: ${relativePath}`);
    }
  }
  const allowedTargetFiles = new Set(listSyncFiles(resolvedTargetRoot));

  const deletedPaths = validatedDifferences.deleted;
  const actuallyDeletedPaths = [];
  for (const relativePath of deletedPaths) {
    assertPlanPathUnchanged(planSnapshot, resolvedSourceRoot, resolvedTargetRoot, relativePath);
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

  for (const relativePath of validatedDifferences.added) {
    replaceTargetFile(resolvedSourceRoot, resolvedTargetRoot, relativePath, false, planSnapshot);
  }
  for (const relativePath of validatedDifferences.changed) {
    if (!allowedTargetFiles.has(relativePath)) {
      throw new Error(`Sync target path is not allowed: ${relativePath}`);
    }
    replaceTargetFile(resolvedSourceRoot, resolvedTargetRoot, relativePath, true, planSnapshot);
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
