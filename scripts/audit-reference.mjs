import fs from "node:fs";
import path from "node:path";

const referenceRoot = process.env.JUNHANG_REFERENCE_ROOT || "D:\\君航AI助教";

const interestingDirs = ["data", "students", "textbooks", "logs"];

function exists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

function countFiles(root) {
  let count = 0;
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      if (entry.isFile()) count += 1;
    }
  }

  return count;
}

const summary = {
  referenceRoot,
  exists: exists(referenceRoot),
  generatedAt: new Date().toISOString(),
  directories: {}
};

for (const dir of interestingDirs) {
  const fullPath = path.join(referenceRoot, dir);
  summary.directories[dir] = {
    exists: exists(fullPath),
    fileCount: exists(fullPath) ? countFiles(fullPath) : 0
  };
}

console.log(JSON.stringify(summary, null, 2));

