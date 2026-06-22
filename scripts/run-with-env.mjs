import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function findUp(fileName, startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, fileName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function loadDotEnv(filePath = findUp(".env")) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) continue;
    env[trimmed.slice(0, equalIndex).trim()] = trimmed.slice(equalIndex + 1).trim();
  }
  return env;
}

function resolveCommand(command) {
  if (process.platform !== "win32") return command;
  if (command === "npm") return "npm.cmd";
  if (command === "npx") return "npx.cmd";
  return command;
}

function quoteWindowsArg(value) {
  const text = String(value);
  if (!/[ \t"&^<>|]/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

const [, , command, ...args] = process.argv;

if (!command) {
  console.error("Usage: node scripts/run-with-env.mjs <command> [...args]");
  process.exit(1);
}

const commandName = resolveCommand(command);
const useShell = process.platform === "win32";
const child = spawn(
  useShell ? [commandName, ...args].map(quoteWindowsArg).join(" ") : commandName,
  useShell ? [] : args,
  {
  cwd: process.cwd(),
  env: { ...process.env, ...loadDotEnv() },
  shell: useShell,
  stdio: "inherit",
  windowsHide: true
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Command stopped by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
