import fs from "node:fs";
import path from "node:path";
import { prisma } from "@junhang/db";
import { findStaleTextbookAssetIds, mergeTextbookAssetMetadata } from "./textbook-asset-metadata.mjs";

const indexPath = path.resolve(process.argv[2] || "exports/textbook-index/textbooks-index.json");

function requiredText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

if (!fs.existsSync(indexPath)) {
  console.error(`Textbook index not found: ${indexPath}`);
  process.exit(1);
}

const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const assets = Array.isArray(index.assets) ? index.assets : [];
const existingAssets = await prisma.textbookAsset.findMany({
  where: { path: { not: null } },
  select: { id: true, source: true, path: true }
});
let upserted = 0;

for (const asset of assets) {
  const id = requiredText(asset.id);
  const title = requiredText(asset.title);
  if (!id || !title) continue;
  const existing = await prisma.textbookAsset.findUnique({
    where: { id },
    select: { metadata: true }
  });
  const metadata = mergeTextbookAssetMetadata(asset, existing?.metadata);

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
      metadata
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
      metadata
    }
  });
  upserted += 1;
}

const staleIds = findStaleTextbookAssetIds(existingAssets, assets, index.root || "");
if (staleIds.length) {
  await prisma.textbookAsset.deleteMany({ where: { id: { in: staleIds } } });
}

console.log(JSON.stringify({
  ok: true,
  indexPath,
  sourceRoot: index.root || "",
  scanned: assets.length,
  upserted,
  retired: staleIds.length,
  retiredIds: staleIds
}, null, 2));

await prisma.$disconnect();
