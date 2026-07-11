import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as syncLib from "./miniprogram-sync-lib.mjs";

import {
  DIRECTORY_EXCLUDES,
  ROOT_EXCLUDES,
  applyMiniprogramSync,
  assertPathInside,
  assertRepositoryMirrorClean,
  compareMiniprogramTrees,
  listSyncFiles
} from "./miniprogram-sync-lib.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "scripts", "sync-miniapp-to-repo.mjs");

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miniprogram-sync-"));
  const sourceRoot = path.join(root, "source");
  const targetRoot = path.join(root, "repo", "apps", "miniprogram");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(targetRoot, { recursive: true });
  return { root, sourceRoot, targetRoot };
}

function writeFile(root, relativePath, contents) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writeValidSourceIdentity(root, overrides = {}) {
  writeFile(root, "project.config.json", `${JSON.stringify({
    projectArchitecture: "multiPlatform",
    compileType: "miniprogram",
    ...overrides
  })}\n`);
  writeFile(root, "app.json", "{}\n");
}

test("exports the required root and directory exclusions", () => {
  assert.deepEqual([...ROOT_EXCLUDES], [
    "project.config.json",
    "project.private.config.json",
    "project.miniapp.json",
    "app.miniapp.json"
  ]);
  assert.deepEqual([...DIRECTORY_EXCLUDES], [
    ".git",
    ".idea",
    ".vscode",
    ".cache",
    "cache",
    "node_modules",
    "miniprogram_npm"
  ]);
});

test("check reports sorted drift without changing either tree", () => {
  const { sourceRoot, targetRoot } = createWorkspace();
  writeFile(sourceRoot, "app.js", "source app\n");
  writeFile(sourceRoot, "pages/student/index.js", "student page\n");
  writeFile(sourceRoot, "project.config.json", "source private config\n");
  writeFile(sourceRoot, "miniprogram_npm/x.js", "generated dependency\n");
  writeFile(sourceRoot, ".cache/tool-state.json", "tool state\n");
  writeFile(targetRoot, "app.js", "repo app\n");
  writeFile(targetRoot, "utils/obsolete.js", "obsolete\n");
  writeFile(targetRoot, "project.config.json", "repo private config\n");

  const beforeSource = listSyncFiles(sourceRoot);
  const beforeTarget = listSyncFiles(targetRoot);
  const differences = compareMiniprogramTrees(sourceRoot, targetRoot);

  assert.deepEqual(differences, {
    added: ["pages/student/index.js"],
    changed: ["app.js"],
    deleted: ["utils/obsolete.js"]
  });
  assert.deepEqual(listSyncFiles(sourceRoot), beforeSource);
  assert.deepEqual(listSyncFiles(targetRoot), beforeTarget);
  assert.equal(fs.readFileSync(path.join(targetRoot, "app.js"), "utf8"), "repo app\n");
  assert.equal(fs.readFileSync(path.join(targetRoot, "project.config.json"), "utf8"), "repo private config\n");
});

test("write mirrors allowed files and leaves the next check clean", () => {
  const { sourceRoot, targetRoot } = createWorkspace();
  writeFile(sourceRoot, "app.js", "source app\n");
  writeFile(sourceRoot, "pages/student/index.js", "student page\n");
  writeFile(sourceRoot, "project.private.config.json", "source private config\n");
  writeFile(targetRoot, "app.js", "repo app\n");
  writeFile(targetRoot, "utils/obsolete.js", "obsolete\n");
  writeFile(targetRoot, "project.private.config.json", "repo private config\n");

  const differences = compareMiniprogramTrees(sourceRoot, targetRoot);
  applyMiniprogramSync(sourceRoot, targetRoot, differences);

  assert.equal(fs.readFileSync(path.join(targetRoot, "app.js"), "utf8"), "source app\n");
  assert.equal(
    fs.readFileSync(path.join(targetRoot, "pages", "student", "index.js"), "utf8"),
    "student page\n"
  );
  assert.equal(fs.existsSync(path.join(targetRoot, "utils", "obsolete.js")), false);
  assert.equal(fs.existsSync(path.join(targetRoot, "utils")), false);
  assert.equal(
    fs.readFileSync(path.join(targetRoot, "project.private.config.json"), "utf8"),
    "repo private config\n"
  );
  assert.deepEqual(compareMiniprogramTrees(sourceRoot, targetRoot), {
    added: [],
    changed: [],
    deleted: []
  });
});

test("write rejects an untrusted stale deleted plan and preserves an existing empty directory", () => {
  const { sourceRoot, targetRoot } = createWorkspace();
  const existingEmptyDirectory = path.join(targetRoot, "already-empty");
  fs.mkdirSync(existingEmptyDirectory, { recursive: true });

  assert.throws(
    () => applyMiniprogramSync(sourceRoot, targetRoot, {
      added: [],
      changed: [],
      deleted: ["already-empty/missing.js"]
    }),
    /untrusted sync plan/i
  );

  assert.equal(fs.existsSync(existingEmptyDirectory), true);
});

test("write rejects a manually constructed stale deleted plan and preserves the target", () => {
  const { sourceRoot, targetRoot } = createWorkspace();
  writeFile(sourceRoot, "keep.js", "keep\n");
  writeFile(targetRoot, "keep.js", "keep\n");

  assert.throws(
    () => applyMiniprogramSync(sourceRoot, targetRoot, {
      added: [],
      changed: [],
      deleted: ["keep.js"]
    }),
    /untrusted sync plan/i
  );
  assert.equal(fs.readFileSync(path.join(targetRoot, "keep.js"), "utf8"), "keep\n");
});

test("listSyncFiles excludes private root files and generated directories", () => {
  const { sourceRoot } = createWorkspace();
  writeFile(sourceRoot, "app.js", "app\n");
  for (const fileName of ROOT_EXCLUDES) writeFile(sourceRoot, fileName, "private\n");
  for (const directory of DIRECTORY_EXCLUDES) {
    writeFile(sourceRoot, `${directory}/nested/file.js`, "excluded\n");
  }

  assert.deepEqual(listSyncFiles(sourceRoot), ["app.js"]);
});

test("case-folded protected files and directories are excluded across list, compare, and apply", () => {
  const { sourceRoot, targetRoot } = createWorkspace();
  writeFile(sourceRoot, "PROJECT.CONFIG.JSON", "source protected\n");
  writeFile(sourceRoot, ".CACHE/tool-state.json", "cache\n");
  writeFile(sourceRoot, "MINIPROGRAM_NPM/x.js", "generated\n");
  writeFile(targetRoot, "PROJECT.CONFIG.JSON", "target protected\n");

  assert.deepEqual(listSyncFiles(sourceRoot), []);
  assert.deepEqual(compareMiniprogramTrees(sourceRoot, targetRoot), {
    added: [],
    changed: [],
    deleted: []
  });
  assert.throws(
    () => applyMiniprogramSync(sourceRoot, targetRoot, {
      added: [],
      changed: ["PROJECT.CONFIG.JSON"],
      deleted: []
    }),
    /excluded root file/i
  );
  assert.equal(
    fs.readFileSync(path.join(targetRoot, "PROJECT.CONFIG.JSON"), "utf8"),
    "target protected\n"
  );

  const fileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "miniprogram-cache-file-"));
  writeFile(fileRoot, ".cache", "ordinary file\n");
  assert.deepEqual(listSyncFiles(fileRoot), []);
});

test("write replaces a target hardlink without changing the outside inode", () => {
  const { root, sourceRoot, targetRoot } = createWorkspace();
  const outsidePath = path.join(root, "outside.txt");
  const targetPath = path.join(targetRoot, "app.js");
  writeFile(sourceRoot, "app.js", "source bytes\n");
  fs.writeFileSync(outsidePath, "outside bytes\n");
  fs.linkSync(outsidePath, targetPath);

  const differences = compareMiniprogramTrees(sourceRoot, targetRoot);
  applyMiniprogramSync(sourceRoot, targetRoot, differences);

  assert.equal(fs.readFileSync(targetPath, "utf8"), "source bytes\n");
  assert.equal(fs.readFileSync(outsidePath, "utf8"), "outside bytes\n");
});

test("write rejects a plan when changed target content changed after compare", () => {
  const { sourceRoot, targetRoot } = createWorkspace();
  writeFile(sourceRoot, "app.js", "planned source\n");
  writeFile(targetRoot, "app.js", "planned target\n");
  const plan = compareMiniprogramTrees(sourceRoot, targetRoot);
  writeFile(targetRoot, "app.js", "concurrent target\n");

  assert.throws(
    () => applyMiniprogramSync(sourceRoot, targetRoot, plan),
    /stale (sync )?(content|plan)/i
  );
  assert.equal(fs.readFileSync(path.join(targetRoot, "app.js"), "utf8"), "concurrent target\n");
});

test("write rejects a plan when deleted target content changed after compare", () => {
  const { sourceRoot, targetRoot } = createWorkspace();
  writeFile(targetRoot, "obsolete.js", "planned delete\n");
  const plan = compareMiniprogramTrees(sourceRoot, targetRoot);
  writeFile(targetRoot, "obsolete.js", "concurrent target\n");

  assert.throws(
    () => applyMiniprogramSync(sourceRoot, targetRoot, plan),
    /stale (sync )?(content|plan)/i
  );
  assert.equal(fs.readFileSync(path.join(targetRoot, "obsolete.js"), "utf8"), "concurrent target\n");
});

test("write rejects a plan when added source content changed after compare", () => {
  const { sourceRoot, targetRoot } = createWorkspace();
  writeFile(sourceRoot, "added.js", "planned source\n");
  const plan = compareMiniprogramTrees(sourceRoot, targetRoot);
  writeFile(sourceRoot, "added.js", "concurrent source\n");

  assert.throws(
    () => applyMiniprogramSync(sourceRoot, targetRoot, plan),
    /stale (sync )?(content|plan)/i
  );
  assert.equal(fs.existsSync(path.join(targetRoot, "added.js")), false);
});

test("write rejects a plan when changed source content changed after compare", () => {
  const { sourceRoot, targetRoot } = createWorkspace();
  writeFile(sourceRoot, "app.js", "planned source\n");
  writeFile(targetRoot, "app.js", "planned target\n");
  const plan = compareMiniprogramTrees(sourceRoot, targetRoot);
  writeFile(sourceRoot, "app.js", "concurrent source\n");

  assert.throws(
    () => applyMiniprogramSync(sourceRoot, targetRoot, plan),
    /stale (sync )?(content|plan)/i
  );
  assert.equal(fs.readFileSync(path.join(targetRoot, "app.js"), "utf8"), "planned target\n");
});

test("write rejects a JSON-cloned plan without a trusted snapshot", () => {
  const { sourceRoot, targetRoot } = createWorkspace();
  writeFile(sourceRoot, "app.js", "planned source\n");
  writeFile(targetRoot, "app.js", "planned target\n");
  const plan = compareMiniprogramTrees(sourceRoot, targetRoot);
  const clonedPlan = JSON.parse(JSON.stringify(plan));

  assert.throws(
    () => applyMiniprogramSync(sourceRoot, targetRoot, clonedPlan),
    /untrusted sync plan/i
  );
  assert.equal(fs.readFileSync(path.join(targetRoot, "app.js"), "utf8"), "planned target\n");
});

test("write rejects a trusted plan used with different roots", () => {
  const first = createWorkspace();
  const second = createWorkspace();
  writeFile(first.sourceRoot, "app.js", "planned source\n");
  writeFile(first.targetRoot, "app.js", "planned target\n");
  writeFile(second.sourceRoot, "app.js", "planned source\n");
  writeFile(second.targetRoot, "app.js", "planned target\n");
  const plan = compareMiniprogramTrees(first.sourceRoot, first.targetRoot);

  assert.throws(
    () => applyMiniprogramSync(second.sourceRoot, second.targetRoot, plan),
    /stale sync plan.*roots|roots.*stale sync plan/i
  );
  assert.equal(fs.readFileSync(path.join(second.targetRoot, "app.js"), "utf8"), "planned target\n");
});

test("validateSourceIdentity accepts a real multiPlatform miniprogram source", () => {
  const { sourceRoot } = createWorkspace();
  writeValidSourceIdentity(sourceRoot);

  assert.doesNotThrow(() => syncLib.validateSourceIdentity(sourceRoot));
});

test("validateSourceIdentity rejects empty sources and missing project.config.json", () => {
  const { sourceRoot } = createWorkspace();
  assert.throws(() => syncLib.validateSourceIdentity(sourceRoot), /project\.config\.json/i);
  writeFile(sourceRoot, "app.json", "{}\n");
  assert.throws(() => syncLib.validateSourceIdentity(sourceRoot), /project\.config\.json/i);
});

test("validateSourceIdentity rejects invalid project config JSON", () => {
  const { sourceRoot } = createWorkspace();
  writeFile(sourceRoot, "project.config.json", "not json\n");
  writeFile(sourceRoot, "app.json", "{}\n");

  assert.throws(() => syncLib.validateSourceIdentity(sourceRoot), /invalid.*project\.config\.json/i);
});

test("validateSourceIdentity rejects non-multiPlatform projects", () => {
  const { sourceRoot } = createWorkspace();
  writeValidSourceIdentity(sourceRoot, { projectArchitecture: "traditional" });

  assert.throws(() => syncLib.validateSourceIdentity(sourceRoot), /multiPlatform/i);
});

test("validateSourceIdentity rejects non-miniprogram compile types", () => {
  const { sourceRoot } = createWorkspace();
  writeValidSourceIdentity(sourceRoot, { compileType: "plugin" });

  assert.throws(() => syncLib.validateSourceIdentity(sourceRoot), /compileType.*miniprogram/i);
});

test("validateSourceIdentity requires app.json to be a regular file", () => {
  const { sourceRoot } = createWorkspace();
  writeFile(sourceRoot, "project.config.json", `${JSON.stringify({
    projectArchitecture: "multiPlatform",
    compileType: "miniprogram"
  })}\n`);
  fs.mkdirSync(path.join(sourceRoot, "app.json"));

  assert.throws(() => syncLib.validateSourceIdentity(sourceRoot), /app\.json.*regular file/i);
});

test("validateMiniprogramRoots rejects equal and overlapping trees", () => {
  const { root, sourceRoot, targetRoot } = createWorkspace();
  assert.throws(
    () => syncLib.validateMiniprogramRoots(sourceRoot, sourceRoot),
    /same|overlap/i
  );

  const nestedTarget = path.join(sourceRoot, "nested-target");
  fs.mkdirSync(nestedTarget);
  assert.throws(
    () => syncLib.validateMiniprogramRoots(sourceRoot, nestedTarget),
    /overlap/i
  );

  const nestedSource = path.join(targetRoot, "nested-source");
  fs.mkdirSync(nestedSource);
  assert.throws(
    () => syncLib.validateMiniprogramRoots(nestedSource, targetRoot),
    /overlap/i
  );
  assert.equal(fs.existsSync(root), true);
});

test("validateMiniprogramRoots rejects a symlink or reparse root", (t) => {
  const { root, sourceRoot, targetRoot } = createWorkspace();
  const linkedSource = path.join(root, "linked-source");
  try {
    fs.symlinkSync(sourceRoot, linkedSource, "junction");
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Creating a Windows junction is not permitted in this environment.");
      return;
    }
    throw error;
  }

  assert.throws(
    () => syncLib.validateMiniprogramRoots(linkedSource, targetRoot),
    /symbolic link|reparse/i
  );
});

test("repository mirror guard refuses write when apps/miniprogram is dirty", async () => {
  const calls = [];
  const runGit = async (args, options) => {
    calls.push({ args, options });
    return " M apps/miniprogram/app.js\n";
  };

  await assert.rejects(
    assertRepositoryMirrorClean("C:\\repo", runGit),
    /apps\/miniprogram.*dirty/i
  );
  assert.deepEqual(calls, [{
    args: ["status", "--porcelain", "--", "apps/miniprogram"],
    options: { cwd: "C:\\repo" }
  }]);
});

test("repository mirror guard permits write when apps/miniprogram is clean", async () => {
  await assert.doesNotReject(
    assertRepositoryMirrorClean("C:\\repo", async () => "")
  );
});

test("assertPathInside rejects traversal, absolute paths, and sibling-prefix escapes", () => {
  const root = path.resolve("C:\\repo\\apps\\miniprogram");
  assert.equal(
    assertPathInside(root, path.join(root, "pages", "index.js")),
    path.join(root, "pages", "index.js")
  );
  assert.throws(() => assertPathInside(root, path.resolve(root, "..", "outside.js")), /outside/i);
  assert.throws(() => assertPathInside(root, `${root}-backup${path.sep}app.js`), /outside/i);
});

test("write rejects malicious differences and never deletes outside target", () => {
  const { root, sourceRoot, targetRoot } = createWorkspace();
  const outsidePath = path.join(root, "repo", "apps", "outside.js");
  writeFile(path.dirname(outsidePath), path.basename(outsidePath), "keep\n");

  assert.throws(
    () => applyMiniprogramSync(sourceRoot, targetRoot, {
      added: [],
      changed: [],
      deleted: ["../outside.js"]
    }),
    /relative path|outside/i
  );
  assert.equal(fs.readFileSync(outsidePath, "utf8"), "keep\n");

  assert.throws(
    () => applyMiniprogramSync(sourceRoot, targetRoot, {
      added: [path.resolve(root, "absolute.js")],
      changed: [],
      deleted: []
    }),
    /relative path|absolute/i
  );
});

test("listSyncFiles conservatively rejects symlinks or reparse points", (t) => {
  const { root, sourceRoot } = createWorkspace();
  const outsideRoot = path.join(root, "outside");
  fs.mkdirSync(outsideRoot, { recursive: true });
  writeFile(outsideRoot, "secret.js", "outside\n");

  try {
    fs.symlinkSync(outsideRoot, path.join(sourceRoot, "linked"), "junction");
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Creating a Windows junction is not permitted in this environment.");
      return;
    }
    throw error;
  }

  assert.throws(() => listSyncFiles(sourceRoot), /symbolic link|reparse/i);
});

test("CLI check reports concrete drift arrays and does not write the repository mirror", () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "miniapp-cli-source-"));
  const targetRoot = path.join(repoRoot, "apps", "miniprogram");
  fs.cpSync(targetRoot, sourceRoot, { recursive: true });
  writeFile(sourceRoot, "app.js", "task 5 changed fixture\n");
  writeFile(sourceRoot, "pages/task5-sync-added.js", "task 5 added fixture\n");
  fs.unlinkSync(path.join(sourceRoot, "utils", "api.js"));
  const targetAppBefore = fs.readFileSync(path.join(targetRoot, "app.js"));

  const result = spawnSync(process.execPath, [cliPath, "--check"], {
    cwd: repoRoot,
    env: { ...process.env, JH_MINIAPP_TARGET: sourceRoot },
    encoding: "utf8"
  });

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.added, ["pages/task5-sync-added.js"]);
  assert.deepEqual(report.changed, ["app.js"]);
  assert.deepEqual(report.deleted, ["utils/api.js"]);
  assert.equal(report.mode, "check");
  assert.equal(report.clean, false);
  assert.deepEqual(fs.readFileSync(path.join(targetRoot, "app.js")), targetAppBefore);
  assert.equal(fs.existsSync(path.join(targetRoot, "pages", "task5-sync-added.js")), false);
  assert.equal(fs.existsSync(path.join(targetRoot, "utils", "api.js")), true);
});

test("CLI rejects invalid source identity before reporting deletion arrays", () => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "miniapp-invalid-source-"));
  writeFile(sourceRoot, "orphan.js", "not a miniprogram project\n");
  const targetAppPath = path.join(repoRoot, "apps", "miniprogram", "app.js");
  const targetAppBefore = fs.readFileSync(targetAppPath);

  const result = spawnSync(process.execPath, [cliPath, "--check"], {
    cwd: repoRoot,
    env: { ...process.env, JH_MINIAPP_TARGET: sourceRoot },
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project\.config\.json/i);
  assert.doesNotMatch(result.stdout, /"deleted"/);
  assert.deepEqual(fs.readFileSync(targetAppPath), targetAppBefore);
});

test("CLI rejects source and target overlap before compare", () => {
  const targetRoot = path.join(repoRoot, "apps", "miniprogram");
  const result = spawnSync(process.execPath, [cliPath, "--check"], {
    cwd: repoRoot,
    env: { ...process.env, JH_MINIAPP_TARGET: targetRoot },
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /same|overlap/i);
  assert.doesNotMatch(result.stdout, /"deleted"/);
});

test("CLI rejects unknown modes", () => {
  const result = spawnSync(process.execPath, [cliPath, "--unknown"], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown mode|usage/i);
});
