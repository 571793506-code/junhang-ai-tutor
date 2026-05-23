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
    env[trimmed.slice(0, equalIndex).trim()] = trimmed.slice(equalIndex + 1).trim();
  }
  return env;
}

const env = { ...process.env, ...loadEnv(envPath) };

function requireEnv(name) {
  if (!env[name]) throw new Error(`Missing ${name}`);
  return env[name];
}

const appId = requireEnv("FEISHU_APP_ID");
const appSecret = requireEnv("FEISHU_APP_SECRET");

const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
  method: "POST",
  headers: {
    "Content-Type": "application/json; charset=utf-8"
  },
  body: JSON.stringify({
    app_id: appId,
    app_secret: appSecret
  })
});

const body = await response.json().catch(() => ({}));

if (!response.ok || body.code !== 0) {
  console.log(JSON.stringify({
    ok: false,
    provider: "feishu",
    status: response.status,
    code: body.code,
    message: body.msg || response.statusText
  }, null, 2));
  process.exit(0);
}

console.log(JSON.stringify({
  ok: true,
  provider: "feishu",
  appId,
  tenantAccessToken: "received",
  expireSeconds: body.expire
}, null, 2));

