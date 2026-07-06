import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const rootPackage = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const apiServerSource = fs.readFileSync(new URL("../apps/api/src/server.js", import.meta.url), "utf8");

test("root package exposes explicit LAN display scripts", () => {
  assert.equal(rootPackage.scripts["dev:web:lan"], "scripts\\dev-web-lan.cmd");
  assert.equal(rootPackage.scripts["dev:api:lan"], "scripts\\dev-api-lan.cmd");
});

test("API server can bind to a configurable host for LAN access", () => {
  assert.match(apiServerSource, /const host = String\(config\.API_HOST \|\| "127\.0\.0\.1"\)/);
  assert.match(apiServerSource, /app\.listen\(port, host,/);
});

test("API root gives a human-readable hint when the Web and API ports are confused", () => {
  assert.match(apiServerSource, /app\.get\("\/",/);
  assert.match(apiServerSource, /请打开 Web 地址/);
  assert.match(apiServerSource, /5173/);
});

test("LAN helper scripts keep API and Web host settings explicit", () => {
  const apiLanScript = fs.readFileSync(new URL("./dev-api-lan.cmd", import.meta.url), "utf8");
  const webLanScript = fs.readFileSync(new URL("./dev-web-lan.cmd", import.meta.url), "utf8");

  assert.match(apiLanScript, /set "API_HOST=0\.0\.0\.0"/);
  assert.match(webLanScript, /VITE_API_BASE_URL=http:\/\/%LAN_IP%:8787/);
  assert.match(webLanScript, /pushd apps\\web/);
  assert.match(webLanScript, /vite\.js --host 0\.0\.0\.0/);
});
