import path from "node:path";

function scannedMetadata(asset) {
  return {
    relativePath: asset.relativePath || "",
    ext: asset.ext || "",
    size: asset.size || 0,
    mtime: asset.mtime || null,
    importState: asset.importState || "只读索引",
    openWith: asset.openWith || "智慧中小学",
    readOnly: true,
    sourceKind: asset.ext === ".edupdf" ? "智慧中小学教材文件" : "教材辅助资料",
    curriculumSeries: asset.curriculumSeries || "",
    curriculumRegion: asset.curriculumRegion || "",
    editionDisplay: asset.editionDisplay || asset.edition || "",
    baselineMatched: asset.baselineMatched === true
  };
}

function normalizedPath(value) {
  return value ? path.resolve(String(value)) : "";
}

function isWithinRoot(filePath, root) {
  const relative = path.relative(root, filePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function findStaleTextbookAssetIds(existingAssets = [], scannedAssets = [], sourceRoot = "") {
  const root = normalizedPath(sourceRoot);
  if (!root) return [];
  const scannedIds = new Set(scannedAssets.map((asset) => String(asset?.id || "")).filter(Boolean));
  const scannedPaths = new Set(scannedAssets.map((asset) => normalizedPath(asset?.path)).filter(Boolean));
  return existingAssets
    .filter((asset) => {
      const assetPath = normalizedPath(asset?.path);
      if (!asset?.id || !assetPath || normalizedPath(asset?.source) !== root) return false;
      if (!isWithinRoot(assetPath, root)) return false;
      return !scannedIds.has(String(asset.id)) && !scannedPaths.has(assetPath);
    })
    .map((asset) => String(asset.id));
}

export function mergeTextbookAssetMetadata(asset, existingMetadata) {
  const metadata = scannedMetadata(asset);
  if (!existingMetadata || typeof existingMetadata !== "object" || Array.isArray(existingMetadata)) {
    return metadata;
  }

  for (const [key, value] of Object.entries(existingMetadata)) {
    if (key === "chapters" || key.startsWith("chapterIndex")) metadata[key] = value;
  }
  return metadata;
}
