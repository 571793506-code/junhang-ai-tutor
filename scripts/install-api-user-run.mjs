import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installDir = path.join(os.homedir(), "AppData", "Local", "JunhangAITutorAPI");
const cmdPath = path.join(installDir, "run-api.cmd");
const vbsPath = path.join(installDir, "launch-api.vbs");
const runValueName = "JunhangAITutorAPI";

fs.mkdirSync(installDir, { recursive: true });

const cmdContent = [
  "@echo off",
  "chcp 65001 >nul",
  `cd /d "${root}"`,
  `call "${path.join(root, "scripts", "run-api-autostart.cmd")}"`,
  ""
].join("\r\n");

fs.writeFileSync(cmdPath, cmdContent, "utf8");

const vbsContent = [
  'Set shell = CreateObject("WScript.Shell")',
  `shell.Run Chr(34) & "${cmdPath}" & Chr(34), 0, False`,
  ""
].join("\r\n");

fs.writeFileSync(vbsPath, Buffer.from(`\uFEFF${vbsContent}`, "utf16le"));

const regData = `wscript.exe "${vbsPath}"`;
const result = spawnSync(
  "reg",
  ["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", runValueName, "/t", "REG_SZ", "/d", regData, "/f"],
  { encoding: "utf8", windowsHide: true }
);

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || "Failed to write HKCU Run registry entry.");
  process.exit(result.status || 1);
}

console.log(JSON.stringify({
  ok: true,
  method: "HKCU Run",
  runValueName,
  installDir,
  cmdPath,
  vbsPath,
  regData
}, null, 2));
