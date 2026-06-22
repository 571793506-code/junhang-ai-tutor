import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const installDir = path.join(os.homedir(), "AppData", "Local", "JunhangAITutorAPI");
const runValueName = "JunhangAITutorAPI";

const result = spawnSync(
  "reg",
  ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", runValueName, "/f"],
  { encoding: "utf8", windowsHide: true }
);

if (result.status !== 0 && !(result.stderr || result.stdout || "").includes("unable to find")) {
  console.error(result.stderr || result.stdout || "Failed to delete HKCU Run registry entry.");
  process.exit(result.status || 1);
}

if (fs.existsSync(installDir)) {
  fs.rmSync(installDir, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  removedRunValueName: runValueName,
  removedInstallDir: installDir
}, null, 2));
