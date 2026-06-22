import fs from "node:fs";
import path from "node:path";

function loadEnv(filePath = ".env") {
  const env = {};
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return env;
  for (const line of fs.readFileSync(absolutePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) continue;
    env[trimmed.slice(0, equalIndex).trim()] = trimmed.slice(equalIndex + 1).trim();
  }
  return env;
}

const env = { ...process.env, ...loadEnv() };
const baseUrl = (env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
const apiKey = env.DEEPSEEK_API_KEY || "";

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function testChat(model, extraPayload = {}) {
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "Return JSON only." },
            { role: "user", content: `Return {"ok":true,"model":"${model}"}` }
          ],
          temperature: 0,
          response_format: { type: "json_object" },
          max_tokens: 120,
          ...extraPayload
        })
      },
      20000
    );
    const text = await response.text();
    return {
      model,
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      text: text.slice(0, 600)
    };
  } catch (error) {
    return {
      model,
      ok: false,
      ms: Date.now() - started,
      error: `${error?.name || "Error"}: ${error?.message || String(error)}`
    };
  }
}

async function listModels() {
  const started = Date.now();
  try {
    const response = await fetchWithTimeout(
      `${baseUrl}/models`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      20000
    );
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      text: text.slice(0, 1200)
    };
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: `${error?.name || "Error"}: ${error?.message || String(error)}`
    };
  }
}

const results = {
  baseUrl,
  hasApiKey: Boolean(apiKey),
  models: await listModels(),
  chats: []
};

for (const model of ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat"]) {
  results.chats.push(await testChat(model));
}

console.log(JSON.stringify(results, null, 2));
