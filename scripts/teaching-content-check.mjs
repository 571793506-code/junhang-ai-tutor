import { runSteps, timeoutMsFromEnv } from "./check-step-runner.mjs";

const env = { ...process.env };
const steps = [
  {
    name: "api start if needed",
    command: "cmd.exe",
    args: ["/c", "scripts\\start-api-if-needed.cmd"],
    timeoutMs: timeoutMsFromEnv("api start if needed", env, 60000)
  },
  {
    name: "content upload ui contract",
    command: process.execPath,
    args: ["scripts/content-upload-ui-contract.mjs"],
    timeoutMs: timeoutMsFromEnv("content upload ui contract", env, 60000)
  },
  {
    name: "content context e2e",
    command: process.execPath,
    args: ["scripts/content-context-e2e.mjs"],
    timeoutMs: timeoutMsFromEnv("content context e2e", env, 300000)
  }
];

const summary = await runSteps(steps, {
  cwd: process.cwd(),
  env,
  prefix: "[teaching-content-check]",
  defaultTimeoutMs: 180000
});

console.log(JSON.stringify(summary, null, 2));
if (!summary.ok) process.exit(1);
