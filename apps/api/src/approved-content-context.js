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
