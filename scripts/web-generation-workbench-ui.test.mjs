import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8");
const apiSource = fs.readFileSync(new URL("../apps/web/src/api.ts", import.meta.url), "utf8");

test("generation workbench keeps selectable options for preview-matched fields", () => {
  assert.match(source, /const quizChapterOptionsByGradeAndSubject: Record<string, Record<SubjectLabel, string\[]>> = /);
  assert.match(source, /const practiceTrainingTargetOptions = \[/);
  assert.match(source, /const questionCountOptionsByMode: Record<GenerationMode, string\[]> = /);
  assert.match(source, /const examTypeOptions = \[/);
  assert.match(source, /const examTotalScoreOptions = \[/);
  assert.match(source, /const mathBonusQuestionOptions = \[/);
  assert.match(source, /generationStudentId/);
  assert.match(source, /const generationTargetStudents = students\.filter/);
  assert.match(source, /selectGenerationStudent/);
  assert.match(source, /student\.grade === targetGrade/);
  assert.match(source, /activeQuizChapterOptions\.map/);
  assert.match(source, /assessmentSubject === "数学"/);
  assert.match(source, /附加题/);
  assert.doesNotMatch(source, /训练目标" : "章节 \/ 单元"}<input/);
  assert.doesNotMatch(source, /"总分" : "题量目标"}<input/);
});

test("generation workbench sends structured item count and chapter context", () => {
  assert.match(source, /requestedItemCount:/);
  assert.match(source, /textbookChapterTitle:\s*generationTextbookContext\?\.chapter\?\.title\s*\|\|\s*\(generationMode === "quiz" \? assessmentQuizChapter : undefined\)/);
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
