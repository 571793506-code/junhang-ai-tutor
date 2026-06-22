import fs from "node:fs";
import path from "node:path";
import { prisma } from "@junhang/db";

const indexPath = path.resolve(process.argv[2] || "exports/textbook-index/textbooks-index.json");

function requiredText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function toMetadata(asset) {
  return {
    relativePath: asset.relativePath || "",
    ext: asset.ext || "",
    size: asset.size || 0,
    mtime: asset.mtime || null,
    importState: asset.importState || "只读索引",
    openWith: asset.openWith || "智慧中小学",
    readOnly: true,
    sourceKind: asset.ext === ".edupdf" ? "智慧中小学教材文件" : "教材辅助资料"
  };
}

if (!fs.existsSync(indexPath)) {
  console.error(`Textbook index not found: ${indexPath}`);
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const assets = Array.isArray(index.assets) ? index.assets : [];
let upserted = 0;

for (const asset of assets) {
  const id = requiredText(asset.id);
  const title = requiredText(asset.title);
  if (!id || !title) continue;

  await prisma.textbookAsset.upsert({
    where: { id },
    create: {
      id,
      subject: requiredText(asset.subject, "未识别"),
      edition: requiredText(asset.edition, "未识别"),
      grade: requiredText(asset.grade, "未识别"),
      volume: requiredText(asset.volume, "未识别"),
      title,
      source: requiredText(asset.source, index.root || ""),
      path: requiredText(asset.path, null),
      url: null,
      hash: requiredText(asset.hash, null),
      metadata: toMetadata(asset)
    },
    update: {
      subject: requiredText(asset.subject, "未识别"),
      edition: requiredText(asset.edition, "未识别"),
      grade: requiredText(asset.grade, "未识别"),
      volume: requiredText(asset.volume, "未识别"),
      title,
      source: requiredText(asset.source, index.root || ""),
      path: requiredText(asset.path, null),
      hash: requiredText(asset.hash, null),
      metadata: toMetadata(asset)
    }
  });
  upserted += 1;
}

console.log(JSON.stringify({
  ok: true,
  indexPath,
  sourceRoot: index.root || "",
  scanned: assets.length,
  upserted
}, null, 2));

await prisma.$disconnect();
