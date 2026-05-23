import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(".env");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) continue;
    const key = trimmed.slice(0, equalIndex).trim();
    const value = trimmed.slice(equalIndex + 1).trim();
    env[key] = value;
  }
  return env;
}

const env = { ...process.env, ...loadEnv(envPath) };

function requireEnv(name) {
  if (!env[name]) throw new Error(`Missing ${name}`);
  return env[name];
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    const message = body?.error?.message || body?.msg || body?.message || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }

  return body;
}

async function checkDeepSeek() {
  const apiKey = requireEnv("DEEPSEEK_API_KEY");
  const baseUrl = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
  const models = await requestJson(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  const modelIds = Array.isArray(models?.data) ? models.data.map((model) => model.id).slice(0, 5) : [];
  return {
    ok: true,
    provider: "deepseek",
    endpoint: `${baseUrl}/models`,
    models: modelIds
  };
}

async function checkMiniMax() {
  const apiKey = requireEnv("MINIMAX_API_KEY");
  const baseUrl = (env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1").replace(/\/$/, "");
  const response = await requestJson(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.MINIMAX_TEXT_MODEL || "MiniMax-M2.7-highspeed",
      messages: [
        { role: "system", content: "You are a concise API health check assistant." },
        { role: "user", content: "Reply with OK." }
      ],
      max_tokens: 32,
      temperature: 1
    })
  });

  const content = response?.choices?.[0]?.message?.content || "";
  return {
    ok: true,
    provider: "minimax",
    endpoint: `${baseUrl}/chat/completions`,
    model: response?.model || env.MINIMAX_TEXT_MODEL || "MiniMax-M2.7-highspeed",
    responseLength: content.length
  };
}

const checks = [
  ["DeepSeek", checkDeepSeek],
  ["MiniMax", checkMiniMax]
];

const results = [];
for (const [name, check] of checks) {
  try {
    results.push(await check());
  } catch (error) {
    results.push({
      ok: false,
      provider: name.toLowerCase(),
      error: error.message
    });
  }
}

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
