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

export function loadDotEnv(filePath = findUp(".env") || path.resolve(process.cwd(), ".env")) {
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

export function loadRuntimeConfig() {
  const fileEnv = loadDotEnv();
  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] == null) process.env[key] = value;
  }
  return { ...process.env, ...fileEnv };
}

export function publicConfigSummary(config = loadRuntimeConfig()) {
  return {
    appEnv: config.APP_ENV || "development",
    appBaseUrl: config.APP_BASE_URL || null,
    apiPort: Number(config.API_PORT || 8787),
    hasDatabaseUrl: Boolean(config.DATABASE_URL),
    providers: {
      deepseek: Boolean(config.DEEPSEEK_API_KEY),
      minimax: Boolean(config.MINIMAX_API_KEY),
      gpt55: Boolean(config.GPT55_API_KEY || config.OPENAI_API_KEY)
    }
  };
}
