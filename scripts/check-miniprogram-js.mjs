import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("apps/miniprogram");

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".js")) files.push(fullPath);
  }
  return files;
}

const files = fs.existsSync(root) ? walk(root) : [];
const failed = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
    windowsHide: true
  });
  if (result.status !== 0) {
    failed.push({
      file: path.relative(process.cwd(), file),
      stderr: result.stderr.trim()
    });
  }
}

console.log(JSON.stringify({
  ok: failed.length === 0,
  checkedFiles: files.length,
  failed
}, null, 2));

if (failed.length) process.exitCode = 1;
