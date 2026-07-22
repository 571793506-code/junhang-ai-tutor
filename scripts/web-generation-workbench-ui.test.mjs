import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8");
const apiSource = fs.readFileSync(new URL("../apps/web/src/api.ts", import.meta.url), "utf8");

test("generation workbench keeps selectable options for preview-matched fields", () => {
  assert.match(source, /const practiceTrainingTargetOptions = \[/);
  assert.match(source, /const questionCountOptionsByMode: Record<GenerationMode, string\[]> = /);
  assert.match(source, /const examTypeOptions = \[/);
  assert.match(source, /const examTotalScoreOptions = \[/);
  assert.match(source, /const mathBonusQuestionOptions = \[/);
  assert.match(source, /generationStudentId/);
  assert.match(source, /const generationTargetStudents = students\.filter/);
  assert.match(source, /selectGenerationStudent/);
  assert.match(source, /student\.grade === targetGrade/);
  assert.match(source, /assessmentSubject === "数学"/);
  assert.match(source, /附加题/);
  assert.doesNotMatch(source, /训练目标" : "章节 \/ 单元"}<input/);
  assert.doesNotMatch(source, /"总分" : "题量目标"}<input/);
});

test("generation workbench sends structured item count and chapter context", () => {
  assert.match(source, /requestedItemCount:/);
  assert.match(source, /textbookChapterTitle:\s*generationTextbookContext\?\.chapter\?\.title/);
  assert.doesNotMatch(source, /textbookChapterTitle:[\s\S]{0,160}assessmentQuizChapter/);
});

test("grade generation uses a grade-scoped title instead of the current student", () => {
  assert.match(source, /contentScope: generationMode === "quiz"/);
  assert.match(source, /const titlePrefix = request\.targetScope === "grade" \? grade : student\.displayName/);
  assert.match(source, /\.\.\.\(request\.targetScope === "student" \? \{ studentName: student\.displayName \} : \{\}\)/);
  assert.match(source, /title: `\$\{titlePrefix\}\$\{request\.subject\}\$\{titleScope\}\$\{request\.kind\}`/);
  assert.doesNotMatch(source, /title: `\$\{student\.displayName\}\$\{request\.subject\}\$\{request\.kind\}/);
});

test("grade quiz titles use the teacher's stated range when no textbook chapter is selected", () => {
  assert.match(source, /const assessmentGenerationContentScope =/);
  assert.match(source, /assessmentKnowledgeRange\.trim\(\)/);
  assert.match(source, /contentScope:\s*generationMode === "quiz"\s*\? assessmentGenerationContentScope/);
});

test("textbook quiz chapters are derived from the selected textbook volume", () => {
  assert.doesNotMatch(source, /quizChapterOptionsByGradeAndSubject/);
  assert.doesNotMatch(source, /activeQuizChapterOptions/);
  assert.match(source, /generationTextbookChapters = generationTextbookContext\?\.asset\.chapters \|\| \[\]/);
  assert.match(source, /章节 \/ 单元<select disabled=\{!generationTextbookContext \|\| !generationTextbookChapters\.length\} value=\{generationTextbookContext\?\.chapter\?\.id \|\| ""\}/);
  assert.match(source, /const chapter = asset\.chapters\?\.\[0\];/);
  assert.match(source, /setAssessmentQuizChapter\(chapter\?\.title \|\| ""\)/);
  assert.match(source, /generationTextbookChapters\.map\(\(chapter\) => <option key=\{chapter\.id\} value=\{chapter\.id\}>/);
});

test("sixth-grade lower-volume math textbooks offer a reviewable chapter-index repair", () => {
  assert.match(source, /chapterDraftsForTextbookAsset/);
  assert.match(source, /建立章节草案/);
  assert.match(source, /onSaveTextbookChapters\(generationTextbookContext\.asset\.id, chapterDraftsForTextbookAsset\(generationTextbookContext\.asset\)\)/);
});

test("sixth-grade math chapter drafts keep upper and lower volumes separate", () => {
  const catalogSource = fs.readFileSync(new URL("../packages/core/src/textbook-chapter-drafts.js", import.meta.url), "utf8");
  assert.match(catalogSource, /"六年级-上册": \[/);
  assert.match(catalogSource, /第一单元.*分数乘法/);
  assert.match(catalogSource, /第二单元.*位置与方向（二）/);
  assert.match(catalogSource, /第九单元.*总复习/);
  assert.match(catalogSource, /"六年级-下册": \[/);
  assert.match(catalogSource, /第三单元.*圆柱与圆锥/);
});

test("chapter draft UI distinguishes a complete index from an index that can be repaired", () => {
  assert.match(source, /const seedChapters = defaultChaptersForAsset\(asset\);/);
  assert.match(source, /const missingChapterCount = draftChapters\.length - chapters\.length;/);
  assert.match(source, /请手工录入目录/);
});

test("chapter draft repair preserves indexed chapters and appends only missing units", () => {
  assert.match(source, /function mergedChaptersForAsset\(asset: TextbookAsset, existingChapters: TextbookChapter\[\] = \[\]\)/);
  assert.match(source, /return mergeTextbookChapterDrafts\(asset, existingChapters\);/);
  assert.match(source, /const draftChapters = mergedChaptersForAsset\(asset, chapters\);/);
  assert.match(source, /chaptersToDraftText\(draftChapters\)/);
});

test("generation workbench blocks textbook quizzes until matching baseline evidence is selected", () => {
  assert.match(source, /generationTextbookContext/);
  assert.match(source, /quizGenerationBlockReason/);
  assert.match(source, /贵州遵义教材基准/);
  assert.match(source, /disabled=\{Boolean\(quizGenerationBlockReason\)\}/);
  assert.match(source, /textbookAssetId:\s*generationTextbookContext\?\.asset\.id/);
  assert.match(source, /asset\.editionDisplay \|\| asset\.edition/);
  assert.match(source, /matchesTextbookEvidenceScope\(\s*generationTextbookContext\.asset,\s*source\s*\)/);
  assert.match(source, /source\.licenseStatus\s*!==\s*"NOT_ALLOWED"/);
  assert.match(source, /source\.chunkCount\s*>\s*0/);
});

test("generation workbench lets teachers select matching textbook evidence before creating a quiz", () => {
  assert.match(source, /const generationTextbookAssets = useMemo/);
  assert.match(source, /const matchingApprovedTextbookSources =/);
  assert.match(source, /教材依据/);
  assert.match(source, /onSelectTextbookContext\(\{ asset/);
  assert.match(source, /matchingApprovedTextbookSources\.length/);
  assert.match(source, /onOpenModule\("教材资料"\)/);
  assert.match(source, /需要先完成资料索引和教师复核/);
});

test("generation workbench offers separate evidence repair and teacher-requirement emergency paths", () => {
  assert.match(apiSource, /export async function recoverAssessmentGenerationContext/);
  assert.match(source, /onAssessmentRecovery/);
  assert.match(source, /修复教材依据/);
  assert.match(source, /按教师要求生成临时草稿/);
  assert.match(source, /generationBasis:\s*"teacher_requirement_emergency"/);
});

test("textbook repair and teacher scope confirmation use shared server-backed actions", () => {
  assert.match(apiSource, /export async function repairTextbookChapterDrafts/);
  assert.match(apiSource, /export async function confirmTextbookGenerationScope/);
  assert.match(source, /onRepairTextbookChapterDrafts/);
  assert.match(source, /onConfirmTextbookGenerationScope/);
  assert.match(source, /补齐可用教材目录/);
  assert.match(source, /确认当前教材章节范围并恢复小测/);
  assert.match(apiSource, /confirm-generation-scope/);
});

test("generation workbench submits independent jobs, supports cancellation, and keeps job records selectable", () => {
  assert.match(apiSource, /export async function createAssessmentGenerationJob/);
  assert.match(apiSource, /export async function listAssessmentGenerationJobs/);
  assert.match(apiSource, /export async function cancelAssessmentGenerationJob/);
  assert.match(source, /assessmentJobs/);
  assert.match(source, /onAssessmentCancel/);
  assert.match(source, /取消本次生成/);
  assert.match(source, /generation-job-record-card/);
  assert.doesNotMatch(source, /const isAssessmentDraftBusy = sync\.busy/);
});

test("knowledge source list requests the resolver-aligned 200 source limit", () => {
  const functionStart = apiSource.indexOf("export async function listKnowledgeSources");
  const functionEnd = apiSource.indexOf("export async function", functionStart + 1);
  const functionSource = apiSource.slice(functionStart, functionEnd === -1 ? apiSource.length : functionEnd);

  assert.match(functionSource, /limit\?:\s*number/);
  assert.match(functionSource, /query\.set\("limit",\s*String\(filters\.limit\s*\|\|\s*200\)\)/);
});

test("textbook list requests the bounded 200 asset limit", () => {
  const functionStart = apiSource.indexOf("export async function listTextbooks");
  const functionEnd = apiSource.indexOf("export async function", functionStart + 1);
  const functionSource = apiSource.slice(functionStart, functionEnd === -1 ? apiSource.length : functionEnd);

  assert.match(functionSource, /limit\?:\s*number/);
  assert.match(functionSource, /query\.set\("limit",\s*String\(filters\.limit\s*\|\|\s*200\)\)/);
});

test("knowledge source review binds only the selected real textbook asset", () => {
  assert.match(source, /selectedTextbook=\{selectedTextbookContext\?\.asset\s*\|\|\s*null\}/);
  assert.match(source, /textbookAssetId:\s*selectedTextbook\.id/);
  assert.match(apiSource, /export type KnowledgeSourceReviewInput/);
  assert.match(apiSource, /textbookAssetId\?:\s*string/);
});

test("generation workbench displays layout risk and blocks draft confirmation", () => {
  assert.match(source, /layoutValidation\?:/);
  assert.match(source, /latestAssessmentDraft\?\.layoutValidation\?\.ok === false/);
  assert.match(source, /disabled=\{!latestAssessmentDraft \|\| latestAssessmentDraft\.layoutValidation\?\.ok !== true\}/);
  assert.match(source, /排版校验未通过/);
});

test("generation workbench restores and selects server-backed review drafts", () => {
  assert.match(source, /function assessmentDraftRefFromAssignment/);
  assert.match(source, /assignment\.draftReviewAsset/);
  assert.match(source, /setLatestAssessmentDraft\(\(current\) =>/);
  assert.match(source, /onAssessmentDraftSelect/);
  assert.match(source, /onClick=\{\(\) => onAssessmentDraftSelect\(assignment\)\}/);
});

test("generation review separates draft rejection from regeneration", () => {
  const rejectStart = source.indexOf("async function rejectAssessmentDraft");
  const regenerateStart = source.indexOf("async function regenerateAssessmentDraft");
  const rejectSource = source.slice(rejectStart, regenerateStart);

  assert.ok(rejectStart >= 0);
  assert.ok(regenerateStart > rejectStart);
  assert.match(rejectSource, /reviewAssessmentDraft\(assignmentId, "reject"\)/);
  assert.doesNotMatch(rejectSource, /createAssessment\(/);
  assert.match(source, /async function regenerateAssessmentDraft/);
  assert.match(source, /await createAssessment\(draft\.request\)/);
  assert.match(source, /onAssessmentRegenerate/);
  assert.match(source, /否决草稿/);
  assert.match(source, /重新生成/);
  assert.match(source, /latestAssessmentDraft\.reviewStatus !== "rejected"/);
});

test("generation review exposes the selected draft's student and answer PDFs", () => {
  assert.match(source, /finalExportAssets:\s*assignment\.finalExportAssets/);
  assert.match(source, /finalExportAssets:\s*\{\s*studentPaper: response\.asset/);
  assert.match(source, /学生卷 PDF/);
  assert.match(source, /答案解析 PDF/);
  assert.match(source, /latestAssessmentDraft\?\.finalExportAssets\?\.studentPaper/);
  assert.match(source, /latestAssessmentDraft\?\.finalExportAssets\?\.answerAnalysis/);
});
