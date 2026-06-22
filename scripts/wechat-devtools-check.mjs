import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cliPath = process.env.WECHAT_DEVTOOLS_CLI ||
  "C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat";
const projectPath = process.argv[2] ||
  process.env.JH_MINIAPP_TARGET ||
  "C:\\Users\\86188\\WeChatProjects\\miniapp-1";
const port = process.env.WECHAT_DEVTOOLS_PORT || "51197";
const command = process.env.WECHAT_DEVTOOLS_COMMAND || "compile";

if (!fs.existsSync(cliPath)) {
  console.error(JSON.stringify({ ok: false, reason: "cli_not_found", cliPath }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(path.join(projectPath, "project.config.json"))) {
  console.error(JSON.stringify({ ok: false, reason: "project_not_found", projectPath }, null, 2));
  process.exit(1);
}

const args = command === "open"
  ? ["open", "--project", projectPath, "--port", port, "--lang", "zh"]
  : ["cache", "--clean", "compile", "--project", projectPath, "--port", port, "--lang", "zh"];

function quoteCmd(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

const commandLine = `call ${quoteCmd(cliPath)} ${args.map(quoteCmd).join(" ")}`;
const tempScript = path.join(os.tmpdir(), `junhang-wechat-devtools-${Date.now()}.cmd`);
fs.writeFileSync(tempScript, `@echo off\r\n${commandLine}\r\n`, "utf8");

const child = spawn("cmd.exe", ["/d", "/c", tempScript], {
  cwd: projectPath,
  stdio: "inherit",
  windowsHide: true
});

child.on("exit", (code, signal) => {
  fs.rmSync(tempScript, { force: true });
  if (signal) {
    console.error(JSON.stringify({ ok: false, reason: "signal", signal }, null, 2));
    process.exit(1);
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  fs.rmSync(tempScript, { force: true });
  console.error(JSON.stringify({ ok: false, reason: "spawn_error", message: error.message }, null, 2));
  process.exit(1);
});
