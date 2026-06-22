import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const steps = [
  {
    name: "api start if needed",
    command: "cmd.exe",
    args: ["/c", "scripts\\start-api-if-needed.cmd"]
  },
  {
    name: "content upload ui contract",
    command: process.execPath,
    args: ["scripts/content-upload-ui-contract.mjs"]
  },
  {
    name: "content context e2e",
    command: process.execPath,
    args: ["scripts/content-context-e2e.mjs"]
  }
];

const results = [];

for (const step of steps) {
  try {
    const result = await execFileAsync(step.command, step.args, {
      cwd: process.cwd(),
      env: { ...process.env },
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 24
    });
    results.push({
      name: step.name,
      ok: true,
      stdout: parseJsonOrText(result.stdout),
      stderr: result.stderr.trim()
    });
  } catch (error) {
    results.push({
      name: step.name,
      ok: false,
      stdout: parseJsonOrText(error.stdout || ""),
      stderr: String(error.stderr || error.message || "").trim()
    });
    break;
  }
}

const ok = results.every((result) => result.ok);
console.log(JSON.stringify({ ok, generatedAt: new Date().toISOString(), results }, null, 2));
if (!ok) process.exit(1);

function parseJsonOrText(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
