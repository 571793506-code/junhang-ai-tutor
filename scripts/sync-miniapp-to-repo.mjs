import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyMiniprogramSync,
  assertRepositoryMirrorClean,
  compareMiniprogramTrees,
  validateMiniprogramRoots,
  validateSourceIdentity
} from "./miniprogram-sync-lib.mjs";

const mode = process.argv[2];
if (process.argv.length !== 3 || !["--check", "--write"].includes(mode)) {
  console.error("Unknown mode. Usage: node scripts/sync-miniapp-to-repo.mjs --check|--write");
  process.exitCode = 1;
} else {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDirectory, "..");
  const sourceRoot = path.resolve(
    process.env.JH_MINIAPP_TARGET || path.join(os.homedir(), "WeChatProjects", "miniapp-1")
  );
  const targetRoot = path.join(repoRoot, "apps", "miniprogram");

  const runGit = (args, options) => new Promise((resolve, reject) => {
    execFile("git", args, { ...options, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });

  try {
    validateMiniprogramRoots(sourceRoot, targetRoot);
    validateSourceIdentity(sourceRoot);
    if (mode === "--write") {
      await assertRepositoryMirrorClean(repoRoot, runGit);
    }

    const differences = compareMiniprogramTrees(sourceRoot, targetRoot);
    if (mode === "--check") {
      const clean = Object.values(differences).every((files) => files.length === 0);
      console.log(JSON.stringify({
        mode: "check",
        clean,
        sourceRoot,
        targetRoot,
        ...differences
      }, null, 2));
      if (!clean) process.exitCode = 1;
    } else {
      applyMiniprogramSync(sourceRoot, targetRoot, differences);
      const remainingDifferences = compareMiniprogramTrees(sourceRoot, targetRoot);
      const clean = Object.values(remainingDifferences).every((files) => files.length === 0);
      console.log(JSON.stringify({
        mode: "write",
        clean,
        sourceRoot,
        targetRoot,
        ...differences,
        remainingDifferences
      }, null, 2));
      if (!clean) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
