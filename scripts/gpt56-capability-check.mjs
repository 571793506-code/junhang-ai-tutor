import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  return Object.fromEntries(fs.readFileSync(filePath, "utf8").split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return [];
    const index = trimmed.indexOf("=");
    return [[trimmed.slice(0, index).trim(), trimmed.slice(index + 1).trim()]];
  }));
}

export function buildGpt56ProbeTargets(env = {}, { includeSol = false } = {}) {
  const targets = [{
    role: "primary",
    model: env.GPT56_MODEL || env.GPT55_MODEL || "gpt-5.6",
    required: true
  }];
  const solFallbackEnabled = String(env.GPT56_SOL_FALLBACK_ENABLED || "").toLowerCase() === "true";
  if (solFallbackEnabled || includeSol) {
    targets.push({
      role: "sol-fallback",
      model: env.GPT56_SOL_MODEL || "gpt-5.6-sol",
      required: solFallbackEnabled
    });
  }
  return targets;
}

export function buildGpt56ProbeCases(model = "gpt-5.6", { reasoningEffort = "low" } = {}) {
  const baseMessages = [{ role: "user", content: "Reply with the single word OK. This is a synthetic capability check." }];
  return [
    { id: "text", payload: { model, messages: baseMessages, max_tokens: 16 } },
    { id: "json_object", payload: { model, messages: [{ role: "user", content: "Return only a JSON object with {\"ok\":true}." }], response_format: { type: "json_object" }, max_tokens: 32 } },
    { id: "reasoning_effort", payload: { model, messages: baseMessages, reasoning_effort: reasoningEffort, max_tokens: 16 } },
    { id: "json_schema", payload: { model, messages: [{ role: "user", content: "Return a synthetic capability result." }], response_format: { type: "json_schema", json_schema: { name: "capability_result", strict: true, schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false } } }, max_tokens: 32 } },
    { id: "image_input", payload: { model, messages: [{ role: "user", content: [{ type: "text", text: "What color is this synthetic pixel?" }, { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=" } }] }], max_tokens: 16 } },
    {
      id: "project_grading_json",
      payload: {
        model,
        messages: [
          { role: "system", content: "You are an internal elementary-school grading assistant. Return JSON only and require teacher review." },
          { role: "user", content: JSON.stringify({ questionNo: "1", prompt: "6 x 7 = ?", observedAnswer: "42", correctAnswer: "42", maxScore: 5, synthetic: true }) }
        ],
        response_format: { type: "json_object" },
        max_tokens: 128
      }
    }
  ];
}

export function classifyGpt56ProbeResult(result = {}) {
  if (result.ok) return { supported: true, status: result.status, reason: "ok" };
  const message = String(result.body?.error?.message || result.body?.message || result.error || "").toLowerCase();
  const unsupported = /unsupported|unknown parameter|not support|invalid.*parameter/.test(message);
  return {
    supported: false,
    status: result.status || null,
    reason: unsupported ? "unsupported_parameter" : result.status === 401 || result.status === 403 ? "authentication" : result.status === 429 ? "rate_limited" : "request_failed"
  };
}

export async function runProbe(
  env = { ...process.env, ...loadDotEnv() },
  { includeSol = false, fetchImpl = fetch } = {}
) {
  const apiKey = env.GPT56_API_KEY || env.GPT55_API_KEY || env.OPENAI_API_KEY || "";
  const baseUrl = env.GPT56_BASE_URL || env.GPT55_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  if (!apiKey) throw new Error("GPT56_API_KEY is not configured.");
  const probeTargets = buildGpt56ProbeTargets(env, { includeSol });
  const targets = [];
  let requiredTargetsOk = true;
  for (const target of probeTargets) {
    const checks = [];
    const reasoningEffort = target.role === "sol-fallback" ? "high" : "low";
    for (const probe of buildGpt56ProbeCases(target.model, { reasoningEffort })) {
      let response;
      let body = {};
      try {
        response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(probe.payload),
          signal: AbortSignal.timeout(30000)
        });
        const text = await response.text();
        body = text ? JSON.parse(text) : {};
        checks.push({ id: probe.id, ...classifyGpt56ProbeResult({ ok: response.ok, status: response.status, body }) });
      } catch (error) {
        checks.push({ id: probe.id, ...classifyGpt56ProbeResult({ ok: false, status: response?.status || null, body, error: error instanceof Error ? error.message : String(error) }) });
      }
    }
    const requiredCheckIds = target.role === "sol-fallback"
      ? ["text", "json_object", "reasoning_effort", "json_schema", "project_grading_json"]
      : ["text"];
    const targetOk = requiredCheckIds.every((id) => checks.some((item) => item.id === id && item.supported));
    if (target.required && !targetOk) requiredTargetsOk = false;
    targets.push({
      role: target.role,
      model: target.model,
      ok: targetOk,
      checks
    });
  }
  return {
    ok: requiredTargetsOk,
    baseUrl,
    targets
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runProbe(undefined, { includeSol: process.argv.includes("--include-sol") }).then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) process.exitCode = 1;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
