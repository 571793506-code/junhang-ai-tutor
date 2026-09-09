import { classifyTextbookBaseline } from "@junhang/core";
import { matchApprovedContentContext } from "@junhang/services";

function safeMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function uniqueText(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function boundedText(value, max = 240) {
  return String(value || "").trim().slice(0, max);
}

function boundedList(value, max = 20) {
  return uniqueText(Array.isArray(value) ? value : []).slice(0, max).map((item) => boundedText(item, 160));
}

async function resolveTextbookInput(prisma, input) {
  const hasTextbookIntent = Boolean(
    input.textbookAssetId
    || input.textbookTitle
    || input.textbookEdition
    || input.textbookEditionDisplay
    || input.textbookSeries
    || input.textbookVolume
    || input.textbookRegion
    || input.textbookChapterId
    || input.textbookChapterTitle
  );
  if (!input.textbookAssetId) {
    return hasTextbookIntent
      ? {
          input,
          valid: false,
          textbookContext: {
            resolved: false,
            reason: "TEXTBOOK_ASSET_REQUIRED"
          }
        }
      : { input, textbookContext: null, valid: true };
  }
  const asset = await prisma.textbookAsset.findUnique({ where: { id: input.textbookAssetId } });
  if (!asset) {
    return {
      input,
      valid: false,
      textbookContext: {
        resolved: false,
        assetId: input.textbookAssetId,
        reason: "TEXTBOOK_ASSET_NOT_FOUND"
      }
    };
  }

  const metadata = safeMetadata(asset.metadata);
  const baseline = classifyTextbookBaseline({
    subject: asset.subject,
    edition: asset.edition,
    series: metadata.curriculumSeries,
    title: asset.title,
    source: asset.source,
    path: asset.path
  });
  if (!baseline.baselineMatched) {
    return {
      input,
      valid: false,
      textbookContext: {
        resolved: false,
        assetId: asset.id,
        title: asset.title,
        subject: asset.subject || null,
        grade: asset.grade || null,
        edition: asset.edition || null,
        volume: asset.volume || null,
        curriculumRegion: baseline.region,
        baselineMatched: false,
        reason: "TEXTBOOK_BASELINE_MISMATCH"
      }
    };
  }
  const chapters = Array.isArray(metadata.chapters) ? metadata.chapters : [];
  const requestedChapterId = String(input.textbookChapterId || "").trim();
  const requestedChapterTitle = normalizedText(input.textbookChapterTitle);
  const chapter = requestedChapterId
    ? chapters.find((item) => String(item?.id || "") === requestedChapterId)
    : requestedChapterTitle
      ? chapters.find((item) => normalizedText(item?.title) === requestedChapterTitle)
      : null;
  if (requestedChapterId && !chapter) {
    return {
      input,
      valid: false,
      textbookContext: {
        resolved: false,
        assetId: asset.id,
        title: asset.title,
        chapterId: requestedChapterId,
        reason: "TEXTBOOK_CHAPTER_NOT_FOUND"
      }
    };
  }

  const knowledgePoints = uniqueText([
    ...(Array.isArray(input.knowledgePoints) ? input.knowledgePoints : []),
    ...(Array.isArray(chapter?.focusItems) ? chapter.focusItems : []),
    ...(Array.isArray(chapter?.dictationItems) ? chapter.dictationItems : [])
  ]);
  const textbookContext = {
    resolved: true,
    assetId: asset.id,
    title: asset.title,
    subject: asset.subject || null,
    grade: asset.grade || null,
    edition: baseline.edition,
    editionDisplay: baseline.displayName,
    curriculumSeries: baseline.series,
    curriculumRegion: baseline.region,
    baselineMatched: true,
    volume: asset.volume || null,
    chapterId: chapter?.id || input.textbookChapterId || null,
    chapterTitle: chapter?.title || input.textbookChapterTitle || null,
    knowledgePoints,
    readingSupport: chapter?.readingSupport || null
  };
  return {
    valid: true,
    textbookContext,
    input: {
      ...input,
      subject: asset.subject || input.subject,
      grade: asset.grade || input.grade || input.targetGrade,
      textbookTitle: asset.title,
      textbookEdition: baseline.edition,
      textbookEditionDisplay: baseline.displayName,
      textbookSeries: baseline.series,
      textbookVolume: asset.volume || null,
      textbookRegion: baseline.region,
      textbookChapterTitle: textbookContext.chapterTitle,
      knowledgePoints,
      specialRequirements: [input.specialRequirements, textbookContext.readingSupport].filter(Boolean).join("\n")
    }
  };
}

export async function resolveApprovedAssessmentContentContext(prisma, input = {}) {
  const resolvedTextbook = await resolveTextbookInput(prisma, input);
  if (!resolvedTextbook.valid) {
    return {
      ...matchApprovedContentContext(resolvedTextbook.input, []),
      reason: resolvedTextbook.textbookContext.reason,
      textbookContext: resolvedTextbook.textbookContext
    };
  }
  const sources = await prisma.knowledgeSource.findMany({
    where: {
      reviewStatus: "APPROVED",
      allowedForGeneration: true,
      licenseStatus: { not: "NOT_ALLOWED" }
    },
    include: {
      chunks: { orderBy: { orderIndex: "asc" } }
    },
    orderBy: { updatedAt: "desc" },
    take: 200
  });
  return {
    ...matchApprovedContentContext(resolvedTextbook.input, sources),
    textbookContext: resolvedTextbook.textbookContext
  };
}

export function summarizeApprovedAssessmentContentContext(contentContext = {}) {
  const source = safeMetadata(contentContext);
  const textbookContext = safeMetadata(source.textbookContext);
  const matches = (Array.isArray(source.matches) ? source.matches : []).slice(0, 8).map((match) => {
    const item = safeMetadata(match);
    return {
      sourceId: boundedText(item.id || item.sourceId, 180),
      title: boundedText(item.title, 240),
      sourceType: boundedText(item.sourceType, 120),
      subject: boundedText(item.subject, 80),
      grade: boundedText(item.grade, 80),
      edition: boundedText(item.edition, 120),
      volume: boundedText(item.volume, 80),
      curriculumSeries: boundedText(item.curriculumSeries, 120),
      curriculumRegion: boundedText(item.curriculumRegion, 120),
      textbookAssetId: boundedText(item.textbookAssetId, 180) || null,
      knowledgePoints: boundedList(item.knowledgePoints),
      chunkCount: Number(item.chunkCount || item.chunks?.length || 0) || 0,
      summary: boundedText(item.summary, 600)
    };
  });
  const status = source.available === true || matches.length
    ? "approved"
    : boundedText(source.reason || "missing", 80);
  return {
    status,
    reason: source.reason ? boundedText(source.reason, 160) : null,
    approvedOnly: source.approvedOnly === true,
    sourceCount: Number(source.approvedSourceCount ?? source.sourceCount ?? matches.length) || 0,
    sourceIds: matches.map((match) => match.sourceId).filter(Boolean),
    matchedCount: Number(source.matchedCount ?? matches.length) || 0,
    textbookContext: {
      resolved: textbookContext.resolved === true,
      assetId: boundedText(textbookContext.assetId, 180) || null,
      title: boundedText(textbookContext.title, 240) || null,
      subject: boundedText(textbookContext.subject, 80) || null,
      grade: boundedText(textbookContext.grade, 80) || null,
      edition: boundedText(textbookContext.edition, 120) || null,
      volume: boundedText(textbookContext.volume, 80) || null,
      chapterId: boundedText(textbookContext.chapterId, 180) || null,
      chapterTitle: boundedText(textbookContext.chapterTitle, 240) || null,
      knowledgePoints: boundedList(textbookContext.knowledgePoints)
    },
    matches
  };
}
