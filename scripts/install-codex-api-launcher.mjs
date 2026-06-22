import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(os.homedir(), "Desktop");
const target = path.join(desktop, "君航Codex启动API.cmd");

if (!fs.existsSync(desktop)) {
  throw new Error(`Desktop folder not found: ${desktop}`);
}

const content = [
  "@echo off",
  "chcp 65001 >nul",
  `call "${path.join(root, "scripts", "open-codex-with-api.cmd")}"`,
  ""
].join("\r\n");

fs.writeFileSync(target, content, "utf8");

console.log(JSON.stringify({
  ok: true,
  launcher: target
}, null, 2));
