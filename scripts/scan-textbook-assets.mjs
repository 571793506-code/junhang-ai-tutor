import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const defaultRoot = "D:/\u541b\u822aAI\u52a9\u6559/textbooks";
const rootArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const root = path.resolve(rootArg || process.env.TEXTBOOK_ROOT || defaultRoot);
const write = process.argv.includes("--write");
const outputPath = path.resolve("exports/textbook-index/textbooks-index.json");

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function inferSubject(text) {
  if (/语文|Chinese|yuwen/i.test(text)) return "语文";
  if (/数学|Math|shuxue/i.test(text)) return "数学";
  if (/英语|English|yingyu/i.test(text)) return "英语";
  return "";
}

function inferGrade(text) {
  const matches = [...text.matchAll(/([三四五六]|3|4|5|6)\s*年级/g)];
  if (!matches.length) return "";
  const match = matches[matches.length - 1];
  const map = { "3": "三", "4": "四", "5": "五", "6": "六" };
  return `${map[match[1]] || match[1]}年级`;
}

function inferVolume(text) {
  if (/上册|上学期|volume\s*1/i.test(text)) return "上册";
  if (/下册|下学期|volume\s*2/i.test(text)) return "下册";
  return "";
}

function inferEdition(text) {
  if (/人教|PEP/i.test(text)) return "人教版";
  if (/苏教/i.test(text)) return "苏教版";
  if (/北师/i.test(text)) return "北师大版";
  if (/外研/i.test(text)) return "外研版";
  return "";
}

function toAsset(filePath) {
  const stat = fs.statSync(filePath);
  const relativePath = path.relative(root, filePath);
  const searchText = `${relativePath} ${path.basename(filePath, path.extname(filePath))}`;
  return {
    id: crypto.createHash("sha1").update(relativePath).digest("hex").slice(0, 16),
    subject: inferSubject(searchText),
    grade: inferGrade(searchText),
    edition: inferEdition(searchText),
    volume: inferVolume(searchText),
    title: path.basename(filePath, path.extname(filePath)),
    source: root,
    path: filePath,
    relativePath,
    ext: path.extname(filePath).toLowerCase(),
    size: stat.size,
    hash: sha256(filePath),
    mtime: stat.mtime.toISOString(),
    importState: "只读索引"
  };
}

const files = walk(root);
const assets = files.map(toAsset);
const byExt = assets.reduce((acc, item) => {
  acc[item.ext || "(none)"] = (acc[item.ext || "(none)"] || 0) + 1;
  return acc;
}, {});
const bySubject = assets.reduce((acc, item) => {
  const key = item.subject || "未识别";
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const byGrade = assets.reduce((acc, item) => {
  const key = item.grade || "未识别";
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const report = {
  ok: fs.existsSync(root),
  root,
  generatedAt: new Date().toISOString(),
  count: assets.length,
  byExt,
  bySubject,
  byGrade,
  assets
};

if (write) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
}

console.log(JSON.stringify({
  ok: report.ok,
  root: report.root,
  count: report.count,
  byExt,
  bySubject,
  byGrade,
  outputPath: write ? outputPath : null,
  samples: assets.slice(0, 12)
}, null, 2));

if (!report.ok) process.exitCode = 1;
