import { classifyTextbookBaseline, matchesTextbookEvidenceScope } from "@junhang/core";

function safeMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function textbookScope(asset) {
  const metadata = safeMetadata(asset?.metadata);
  const baseline = classifyTextbookBaseline({
    subject: asset?.subject,
    edition: asset?.edition,
    series: metadata.curriculumSeries,
    title: asset?.title,
    source: asset?.source,
    path: asset?.path
  });
  return {
    baseline,
    scope: {
      id: asset?.id || "",
      subject: asset?.subject || "",
      grade: asset?.grade || "",
      edition: baseline.edition || asset?.edition || "",
      curriculumSeries: baseline.series || metadata.curriculumSeries || "",
      volume: asset?.volume || "",
      curriculumRegion: baseline.region
    }
  };
}

export function buildKnowledgeSourceTextbookBinding(source = {}, asset = {}) {
  if (!asset?.id) return { ok: false, error: "TEXTBOOK_ASSET_REQUIRED" };
  const { baseline, scope } = textbookScope(asset);
  if (!baseline.baselineMatched) return { ok: false, error: "TEXTBOOK_BASELINE_MISMATCH" };

  const sourceMetadata = safeMetadata(source.metadata);
  const candidate = {
    ...source,
    subject: source.subject || scope.subject,
    grade: source.grade || scope.grade,
    edition: source.edition || scope.edition,
    volume: source.volume || scope.volume,
    metadata: {
      ...sourceMetadata,
      textbookAssetId: sourceMetadata.textbookAssetId || scope.id,
      curriculumSeries: sourceMetadata.curriculumSeries || scope.curriculumSeries,
      curriculumRegion: sourceMetadata.curriculumRegion || scope.curriculumRegion
    }
  };
  if (!matchesTextbookEvidenceScope(scope, candidate)) {
    return { ok: false, error: "KNOWLEDGE_SOURCE_TEXTBOOK_SCOPE_MISMATCH" };
  }

  return {
    ok: true,
    scope: {
      subject: scope.subject,
      grade: scope.grade,
      edition: scope.edition,
      volume: scope.volume,
      metadata: {
        ...sourceMetadata,
        textbookAssetId: scope.id,
        textbookTitle: asset.title || null,
        curriculumSeries: scope.curriculumSeries,
        curriculumRegion: scope.curriculumRegion
      }
    }
  };
}

export function preserveKnowledgeSourceTextbookBinding(next = {}, existing = {}) {
  const current = existing && typeof existing === "object" ? existing : {};
  const existingMetadata = safeMetadata(current.metadata);
  if (!existingMetadata.textbookAssetId) return next;
  const nextMetadata = safeMetadata(next.metadata);
  return {
    ...next,
    subject: current.subject || next.subject || null,
    grade: current.grade || next.grade || null,
    edition: current.edition || next.edition || null,
    volume: current.volume || next.volume || null,
    metadata: {
      ...nextMetadata,
      textbookAssetId: existingMetadata.textbookAssetId,
      textbookTitle: existingMetadata.textbookTitle || nextMetadata.textbookTitle || null,
      curriculumSeries: existingMetadata.curriculumSeries || nextMetadata.curriculumSeries || null,
      curriculumRegion: existingMetadata.curriculumRegion || nextMetadata.curriculumRegion || null
    }
  };
}
