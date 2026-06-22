import fs from "node:fs";
import path from "node:path";
import {
  buildAiStartupSnapshot,
  callDeepSeekChat,
  callMiniMaxChat
} from "../packages/ai/src/index.js";

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
const snapshot = buildAiStartupSnapshot(env);
const shouldSmokeTest = env.AI_SMOKE_TEST === "1" || env.AI_SMOKE === "1";

async function runSmokeTests() {
  if (!shouldSmokeTest) {
    return {
      skipped: true,
      reason: "Set AI_SMOKE_TEST=1 to make live provider requests."
    };
  }

  const checks = [];
  const deepseek = snapshot.providers.find((provider) => provider.id === "deepseek");
  const minimax = snapshot.providers.find((provider) => provider.id === "minimax");

  if (deepseek?.status === "ready") {
    try {
      const response = await callDeepSeekChat(env, [
        { role: "system", content: "You are a concise API health check assistant." },
        { role: "user", content: "Reply with OK." }
      ]);
      checks.push({
        provider: "deepseek",
        ok: true,
        model: response?.model || deepseek.model
      });
    } catch (error) {
      checks.push({ provider: "deepseek", ok: false, error: error.message });
    }
  } else {
    checks.push({ provider: "deepseek", ok: false, skipped: true, reason: deepseek?.reason });
  }

  if (minimax?.status === "ready") {
    try {
      const response = await callMiniMaxChat(env, [
        { role: "system", content: "You are a concise API health check assistant." },
        { role: "user", content: "Reply with OK." }
      ]);
      checks.push({
        provider: "minimax",
        ok: true,
        model: response?.model || minimax.model
      });
    } catch (error) {
      checks.push({ provider: "minimax", ok: false, error: error.message });
    }
  } else {
    checks.push({
      provider: "minimax",
      ok: false,
      skipped: true,
      reason: minimax?.reason || "MiniMax is not configured."
    });
  }

  return { skipped: false, checks };
}

const smoke = await runSmokeTests();

console.log(
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      mode: snapshot.mode,
      providers: snapshot.providers,
      features: snapshot.features,
      smoke
    },
    null,
    2
  )
);
