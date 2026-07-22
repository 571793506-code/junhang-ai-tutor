import { classifyTextbookBaseline } from "@junhang/core";
import { buildKnowledgeSourceTextbookBinding } from "./knowledge-source-textbook-scope.js";

function safeMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export const TEACHER_CONFIRMED_TEXTBOOK_SCOPE = "teacher-confirmed-textbook-scope";

export function mergeTeacherConfirmedTextbookScopeChapterIds(asset = {}, existingChapterIds = [], requestedChapterIds = []) {
  const chapters = Array.isArray(safeMetadata(asset.metadata).chapters) ? safeMetadata(asset.metadata).chapters : [];
  const validChapterIds = new Set(chapters.map((chapter) => String(chapter?.id || "").trim()).filter(Boolean));
  return [...new Set([
    ...(Array.isArray(existingChapterIds) ? existingChapterIds : []),
    ...(Array.isArray(requestedChapterIds) ? requestedChapterIds : [])
  ].map((id) => String(id || "").trim()).filter((id) => validChapterIds.has(id)))];
}

export function buildTeacherConfirmedTextbookScope(asset = {}, chapterIds = [], options = {}) {
  const metadata = safeMetadata(asset.metadata);
  const chapters = Array.isArray(metadata.chapters) ? metadata.chapters : [];
  if (!chapters.length) return { ok: false, error: "TEXTBOOK_CHAPTER_INDEX_REQUIRED" };
  const baseline = classifyTextbookBaseline({
    subject: asset.subject,
    edition: asset.edition,
    series: metadata.curriculumSeries,
    title: asset.title,
    source: asset.source,
    path: asset.path
  });
  if (!baseline.baselineMatched) return { ok: false, error: "TEXTBOOK_BASELINE_MISMATCH" };
  const requestedIds = [...new Set((Array.isArray(chapterIds) ? chapterIds : []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!requestedIds.length) return { ok: false, error: "TEXTBOOK_CHAPTER_REQUIRED" };
  const selectedChapters = requestedIds.map((id) => chapters.find((chapter) => String(chapter?.id || "") === id));
  if (selectedChapters.some((chapter) => !chapter)) return { ok: false, error: "TEXTBOOK_CHAPTER_NOT_FOUND" };
  const binding = buildKnowledgeSourceTextbookBinding({
    subject: asset.subject,
    grade: asset.grade,
    metadata: {
      scopeKind: "teacher-confirmed-range",
      confirmedChapterIds: requestedIds,
      confirmedByTeacherId: options.teacherId || null,
      sourceBoundary: "教师确认教材章节范围参考，不代表或摘录教材正文。"
    }
  }, asset);
  if (!binding.ok) return binding;
  const chapterLabels = selectedChapters.map((chapter) => [chapter.unit, chapter.title].filter(Boolean).join(" · "));
  const title = `${asset.title} · 教师确认章节范围`;
  const source = {
    title,
    sourceType: TEACHER_CONFIRMED_TEXTBOOK_SCOPE,
    ...binding.scope,
    reviewStatus: "APPROVED",
    allowedForGeneration: true,
    licenseStatus: "TEACHER_CONFIRMED_SCOPE",
    confidence: 1,
    summary: `教师已确认生成范围：${chapterLabels.join("；")}。仅作为章节范围参考，不代表或摘录教材正文。`,
    metadata: {
      ...binding.scope.metadata,
      scopeKind: "teacher-confirmed-range",
      confirmedChapterIds: requestedIds,
      confirmedByTeacherId: options.teacherId || null,
      sourceBoundary: "教师确认教材章节范围参考，不代表或摘录教材正文。"
    }
  };
  const chunks = selectedChapters.map((chapter, index) => ({
    orderIndex: index,
    text: `教师确认范围：${[chapter.unit, chapter.title].filter(Boolean).join(" · ")}；仅作为章节范围参考，不代表或摘录教材正文。`,
    preview: [chapter.unit, chapter.title].filter(Boolean).join(" · "),
    knowledgePoints: Array.isArray(chapter.focusItems) ? chapter.focusItems : [],
    metadata: { chapterId: chapter.id, scopeKind: "teacher-confirmed-range" }
  }));
  return { ok: true, source, chunks };
}
