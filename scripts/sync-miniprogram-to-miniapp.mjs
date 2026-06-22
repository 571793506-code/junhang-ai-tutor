import fs from "node:fs";
import path from "node:path";

const sourceRoot = path.resolve("apps/miniprogram");
const defaultTarget = "C:\\Users\\86188\\WeChatProjects\\miniapp-1";
const targetRoot = path.resolve(process.argv[2] || process.env.JH_MINIAPP_TARGET || defaultTarget);

const rootExcludes = new Set([
  "project.config.json",
  "project.private.config.json",
  "project.miniapp.json",
  "app.miniapp.json"
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertProject() {
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`Source miniprogram not found: ${sourceRoot}`);
  }
  if (!fs.existsSync(targetRoot)) {
    throw new Error(`Target miniapp project not found: ${targetRoot}`);
  }

  const targetConfigPath = path.join(targetRoot, "project.config.json");
  if (!fs.existsSync(targetConfigPath)) {
    throw new Error(`Target project.config.json not found: ${targetConfigPath}`);
  }

  const config = readJson(targetConfigPath);
  if (config.projectArchitecture !== "multiPlatform") {
    throw new Error(`Target is not a multiPlatform project: ${targetRoot}`);
  }
}

function ensureTargetConfig() {
  const targetConfigPath = path.join(targetRoot, "project.config.json");
  const config = readJson(targetConfigPath);
  config.setting = {
    ...(config.setting || {}),
    es6: true,
    postcss: true,
    enhance: true,
    minifyWXSS: true,
    minifyWXML: true
  };
  fs.writeFileSync(targetConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function copyEntry(entryName, copied) {
  if (rootExcludes.has(entryName)) return;

  const sourcePath = path.join(sourceRoot, entryName);
  const targetPath = path.join(targetRoot, entryName);

  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    force: true,
    errorOnExist: false
  });
  copied.push(entryName);
}

function verifySynced() {
  const required = [
    "app.js",
    "app.json",
    "app.wxss",
    "pages/role/index.wxml",
    "pages/role/index.wxss",
    "styles/login-entry.wxss",
    "utils/api.js"
  ];

  const missing = required.filter((item) => !fs.existsSync(path.join(targetRoot, item)));
  const config = readJson(path.join(targetRoot, "project.config.json"));
  return {
    appid: config.appid || "",
    architecture: config.projectArchitecture || "",
    missing
  };
}

assertProject();
ensureTargetConfig();

const copied = [];
for (const entry of fs.readdirSync(sourceRoot)) {
  copyEntry(entry, copied);
}

const verification = verifySynced();
const ok = verification.architecture === "multiPlatform" && verification.missing.length === 0;

console.log(JSON.stringify({
  ok,
  sourceRoot,
  targetRoot,
  skippedRootFiles: [...rootExcludes],
  copied,
  verification
}, null, 2));

if (!ok) process.exitCode = 1;
