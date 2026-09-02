import { normalizeGradeLevel } from "./grade-level.js";

export const ZUNYI_TEXTBOOK_REGION = "贵州遵义";

const baselineProfiles = {
  语文: {
    edition: "统编版",
    series: "人教体系",
    displayName: "统编版 / 人教体系",
    signals: /统编|部编|人教/i
  },
  数学: {
    edition: "人教版",
    series: "人教版",
    displayName: "人教版",
    signals: /人教/i
  },
  英语: {
    edition: "人教版",
    series: "PEP",
    displayName: "人教版 PEP",
    signals: /PEP|三年级起点/i
  }
};

const conflictingEditionSignals = /苏教|北师|外研|译林|冀教|沪教|湘教|鲁教|教科版/i;

function joinedText(input = {}) {
  return [input.edition, input.series, input.title, input.source, input.path]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

function safeMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function scopeValues(...values) {
  return values.flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean);
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function normalizedSubject(value) {
  const text = normalizedText(value);
  if (text.includes("英语") || text.includes("english")) return "英语";
  if (text.includes("语文") || text.includes("chinese")) return "语文";
  if (text.includes("数学") || text.includes("math")) return "数学";
  return text;
}

function normalizedGrade(value) {
  const normalized = normalizeGradeLevel(value);
  if (normalized) return String(normalized.level);
  const text = normalizedText(value);
  return text;
}

function normalizedEdition(value, subject) {
  const text = normalizedText(value);
  if (normalizedSubject(subject) === "语文" && /统编|部编|人教/.test(text)) return "统编人教";
  if (text.includes("人教")) return "人教版";
  if (text.includes("苏教")) return "苏教版";
  if (text.includes("北师")) return "北师大版";
  if (text.includes("外研")) return "外研版";
  if (text.includes("译林")) return "译林版";
  return text;
}

function normalizedSeries(value) {
  const text = normalizedText(value);
  if (text.includes("pep")) return "pep";
  if (text.includes("人教体系") || text.includes("统编") || text.includes("部编")) return "人教体系";
  if (text.includes("人教")) return "人教版";
  return text;
}

function normalizedVolume(value) {
  const text = normalizedText(value);
  if (text.includes("上册") || text.includes("上学期")) return "上册";
  if (text.includes("下册") || text.includes("下学期")) return "下册";
  return text;
}

function normalizedRegion(value) {
  const text = normalizedText(value);
  return text.includes("贵州") && text.includes("遵义") ? ZUNYI_TEXTBOOK_REGION : text;
}

function matchesRequiredScope(expectedValues, sourceValues, normalizer) {
  const expected = [...new Set(scopeValues(expectedValues).map(normalizer).filter(Boolean))];
  const actual = [...new Set(scopeValues(sourceValues).map(normalizer).filter(Boolean))];
  return expected.length === 1 && actual.some((value) => value === expected[0]);
}

function detectedEdition(text) {
  if (/苏教/i.test(text)) return "苏教版";
  if (/北师/i.test(text)) return "北师大版";
  if (/外研/i.test(text)) return "外研版";
  if (/译林/i.test(text)) return "译林版";
  if (/人教/i.test(text)) return "人教版";
  return "";
}

export function classifyTextbookBaseline(input = {}) {
  const profile = baselineProfiles[input.subject];
  const text = joinedText(input);
  const explicitEdition = String(input.edition || "").trim();
  const baselineMatched = Boolean(
    profile &&
    !conflictingEditionSignals.test(text) &&
    profile.signals.test(text)
  );

  if (baselineMatched) {
    return {
      region: ZUNYI_TEXTBOOK_REGION,
      edition: profile.edition,
      series: profile.series,
      displayName: profile.displayName,
      baselineMatched: true
    };
  }

  const edition = explicitEdition || detectedEdition(text);
  return {
    region: ZUNYI_TEXTBOOK_REGION,
    edition,
    series: String(input.series || "").trim(),
    displayName: edition || "未识别",
    baselineMatched: false
  };
}

export function matchesTextbookEvidenceScope(textbook = {}, source = {}) {
  const textbookMetadata = safeMetadata(textbook.metadata);
  const sourceMetadata = safeMetadata(source.metadata);
  const textbookAssetId = scopeValues(textbook.id, textbook.assetId, textbookMetadata.textbookAssetId);
  const sourceAssetId = scopeValues(source.textbookAssetId, source.assetId, sourceMetadata.textbookAssetId);
  const textbookSubject = scopeValues(textbook.subject, textbookMetadata.subject, textbookMetadata.subjects);
  const sourceSubject = scopeValues(source.subject, sourceMetadata.subject, sourceMetadata.subjects);
  const textbookGrade = scopeValues(textbook.grade, textbookMetadata.grade, textbookMetadata.grades);
  const sourceGrade = scopeValues(source.grade, sourceMetadata.grade, sourceMetadata.grades);
  const textbookEdition = scopeValues(textbook.edition, textbookMetadata.edition, textbookMetadata.editions);
  const sourceEdition = scopeValues(source.edition, sourceMetadata.edition, sourceMetadata.editions);
  const textbookSeries = scopeValues(
    textbook.curriculumSeries,
    textbook.series,
    textbookMetadata.curriculumSeries,
    textbookMetadata.series
  );
  const sourceSeries = scopeValues(
    source.curriculumSeries,
    source.series,
    sourceMetadata.curriculumSeries,
    sourceMetadata.series
  );
  const textbookVolume = scopeValues(textbook.volume, textbookMetadata.volume, textbookMetadata.volumes);
  const sourceVolume = scopeValues(source.volume, sourceMetadata.volume, sourceMetadata.volumes);
  const textbookRegion = scopeValues(
    textbook.curriculumRegion,
    textbook.region,
    textbookMetadata.curriculumRegion,
    textbookMetadata.region,
    textbookMetadata.regions
  );
  const sourceRegion = scopeValues(
    source.curriculumRegion,
    source.region,
    sourceMetadata.curriculumRegion,
    sourceMetadata.region,
    sourceMetadata.regions
  );
  const subject = textbookSubject[0];

  return matchesRequiredScope(textbookAssetId, sourceAssetId, normalizedText)
    && matchesRequiredScope(textbookSubject, sourceSubject, normalizedSubject)
    && matchesRequiredScope(textbookGrade, sourceGrade, normalizedGrade)
    && matchesRequiredScope(textbookEdition, sourceEdition, (value) => normalizedEdition(value, subject))
    && matchesRequiredScope(textbookSeries, sourceSeries, normalizedSeries)
    && matchesRequiredScope(textbookVolume, sourceVolume, normalizedVolume)
    && matchesRequiredScope(textbookRegion, sourceRegion, normalizedRegion);
}

export function matchesTeacherConfirmedTextbookChapterScope(source = {}, chapterId = "") {
  if (source.sourceType !== "teacher-confirmed-textbook-scope") return true;
  const requestedChapterId = normalizedText(chapterId);
  if (!requestedChapterId) return true;
  const metadata = safeMetadata(source.metadata);
  return scopeValues(metadata.confirmedChapterIds)
    .map(normalizedText)
    .some((confirmedChapterId) => confirmedChapterId === requestedChapterId);
}

export function matchesTextbookAssetSearch(asset = {}, search = "") {
  const query = normalizedText(search);
  if (!query) return true;
  const metadata = safeMetadata(asset.metadata);
  const haystack = normalizedText([
    asset.title,
    asset.subject,
    asset.grade,
    asset.edition,
    asset.editionDisplay,
    asset.curriculumSeries,
    asset.series,
    asset.curriculumRegion,
    asset.region,
    asset.volume,
    asset.source,
    asset.path,
    asset.relativePath,
    metadata.edition,
    metadata.editionDisplay,
    metadata.curriculumSeries,
    metadata.series,
    metadata.curriculumRegion,
    metadata.region,
    metadata.relativePath
  ].flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean).join(" "));
  return haystack.includes(query);
}
