import { spawn } from "node:child_process";

const DEFAULT_STEP_TIMEOUT_MS = 180000;

export function parseJsonOrText(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function timeoutMsFromEnv(stepName, env = process.env, defaultTimeoutMs = DEFAULT_STEP_TIMEOUT_MS) {
  const stepKey = String(stepName || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const specific = Number(env[`CHECK_STEP_${stepKey}_TIMEOUT_MS`] || 0);
  if (Number.isFinite(specific) && specific > 0) return specific;
  const shared = Number(env.CHECK_STEP_TIMEOUT_MS || 0);
  if (Number.isFinite(shared) && shared > 0) return shared;
  return defaultTimeoutMs;
}

export async function runStep(step, options = {}) {
  const stderr = options.stderr || process.stderr;
  const prefix = options.prefix || "[check-step]";
  const timeoutMs = Number(step.timeoutMs || timeoutMsFromEnv(step.name, options.env || process.env, options.defaultTimeoutMs));
  const startedAt = Date.now();
  stderr.write(`${prefix} start ${step.name}\n`);

  return await new Promise((resolve) => {
    const child = spawn(step.command, step.args || [], {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true
    });

    let stdout = "";
    let rawStderr = "";
    let timedOut = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      rawStderr += text;
      stderr.write(text);
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(`${prefix} fail ${step.name}: ${message}\n`);
      resolve({
        name: step.name,
        ok: false,
        durationMs,
        timedOut: false,
        stdout: parseJsonOrText(stdout),
        stderr: [rawStderr.trim(), message].filter(Boolean).join("\n")
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startedAt;
      const timeoutMessage = timedOut ? `${step.name} timed out after ${timeoutMs}ms` : "";
      const ok = !timedOut && code === 0;
      if (ok) {
        stderr.write(`${prefix} done ${step.name}: ${durationMs}ms\n`);
      } else {
        const reason = timeoutMessage || `exit code ${code}${signal ? `, signal ${signal}` : ""}`;
        stderr.write(`${prefix} fail ${step.name}: ${reason}\n`);
      }
      resolve({
        name: step.name,
        ok,
        durationMs,
        timedOut,
        stdout: parseJsonOrText(stdout),
        stderr: [rawStderr.trim(), timeoutMessage].filter(Boolean).join("\n")
      });
    });
  });
}

export async function runSteps(steps, options = {}) {
  const results = [];
  for (const step of steps) {
    const result = await runStep(step, options);
    results.push(result);
    if (!result.ok) break;
  }
  return {
    ok: results.every((result) => result.ok),
    generatedAt: new Date().toISOString(),
    results
  };
}
