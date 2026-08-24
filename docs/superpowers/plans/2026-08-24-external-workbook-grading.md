# 外部练习册批改实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有图片批改工作台上加入外部练习册识别包、答案来源状态、逐题证据修正和更严格的归档门禁，使 iPad 拍照作业可以快速进入教师可复核的批改草稿。

**Architecture:** 继续复用 `Submission`、现有 `/api/submissions/grade` 上传接口和 `/api/grading/workbench` 工作台。新增一个纯服务层识别包 helper 负责 schema、状态和教师修正合并；API 只负责持久化、角色/学生范围校验和归档门禁；Web 只负责上传参数、页/题证据展示和教师编辑，不在前端执行 OCR、评分或归档判断。

**Tech Stack:** Node.js ESM、Express、Prisma JSON 字段、React + TypeScript、现有 grading workbench API、Node `node:test`。

---

### Task 1: 建立外部材料识别包 helper

**Files:**
- Create: `apps/api/src/external-grading-recognition.js`
- Create: `apps/api/src/external-grading-recognition.test.mjs`

- [ ] **Step 1: Write the failing tests**

覆盖以下契约：

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  EXTERNAL_GRADING_RECOGNITION_SCHEMA_VERSION,
  buildExternalGradingRecognitionPacket,
  mergeExternalQuestionTeacherReview,
  externalRecognitionArchiveBlockers
} from "./external-grading-recognition.js";

test("builds versioned external recognition packet with separate recognition and grading states", () => {
  const packet = buildExternalGradingRecognitionPacket({
    pages: [{ pageNumber: 1, fileName: "page-01.jpg", questions: [{ questionNo: "1", printedPrompt: "2+2=?", studentAnswer: "4", recognitionConfidence: 0.98 }] }],
    answerSourceMode: "model_draft"
  });
  assert.equal(packet.schemaVersion, EXTERNAL_GRADING_RECOGNITION_SCHEMA_VERSION);
  assert.equal(packet.materialType, "external_workbook");
  assert.equal(packet.pages[0].questions[0].recognitionStatus, "confirmed");
  assert.equal(packet.answerSource.status, "needs_teacher_review");
  assert.equal(packet.gradingStatus, "needs_teacher_review");
  assert.equal(packet.archiveEligible, false);
});

test("teacher review keeps original recognition values", () => {
  const current = buildExternalGradingRecognitionPacket({
    pages: [{ pageNumber: 1, questions: [{ questionNo: "1", printedPrompt: "原题干", studentAnswer: "原作答", recognitionConfidence: 0.61 }] }],
    answerSourceMode: "teacher_confirmed"
  });
  const next = mergeExternalQuestionTeacherReview(current, "1", { printedPrompt: "修正题干", studentAnswer: "修正作答", correctAnswer: "4", score: 1, maxScore: 1, status: "correct" });
  assert.equal(next.pages[0].questions[0].printedPrompt, "修正题干");
  assert.equal(next.pages[0].questions[0].recognition.originalPrintedPrompt, "原题干");
  assert.equal(next.pages[0].questions[0].recognition.originalStudentAnswer, "原作答");
  assert.equal(next.pages[0].questions[0].review.reviewedByTeacher, true);
});

test("missing answer and low-confidence questions block archive", () => {
  const packet = buildExternalGradingRecognitionPacket({
    pages: [{ pageNumber: 1, questions: [{ questionNo: "1", recognitionConfidence: 0.4, recognitionStatus: "needs_teacher_review" }] }],
    answerSourceMode: "missing"
  });
  assert.deepEqual(externalRecognitionArchiveBlockers(packet).sort(), ["ANSWER_SOURCE_NOT_CONFIRMED", "QUESTION_RECOGNITION_REVIEW_REQUIRED"]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test apps/api/src/external-grading-recognition.test.mjs`  
Expected: FAIL because the helper module and exported functions do not exist.

- [ ] **Step 3: Implement the minimal helper**

Implement:

- `EXTERNAL_GRADING_RECOGNITION_SCHEMA_VERSION = "external-grading-recognition-v1"`。
- `buildExternalGradingRecognitionPacket(input)`：规范化页、题目、bbox、置信度、答案来源和状态；缺失答案默认 `missing`，模型答案默认 `needs_teacher_review`。
- `mergeExternalQuestionTeacherReview(packet, questionNo, patch)`：把原始识别值写入 `recognition.original*`，教师修正写入当前字段和 `review`。
- `externalRecognitionArchiveBlockers(packet)`：检查答案来源、页质量、题目识别状态、题目复核状态和分值完整性；只返回稳定错误码数组。

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --test apps/api/src/external-grading-recognition.test.mjs`  
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bat
git add -- apps/api/src/external-grading-recognition.js apps/api/src/external-grading-recognition.test.mjs
git commit -m "feat: add external grading recognition contract"
```

### Task 2: 接入上传与后台识别持久化

**Files:**
- Modify: `apps/api/src/server.js: createQueuedPhotoSubmission, recognizeAndGradeSubmissionRecord, POST /api/submissions/grade`
- Modify: `apps/api/src/assessment-generation-job-routes.test.mjs` only if shared route fixtures are required
- Create: `apps/api/src/external-workbook-grading-routes.test.mjs`

- [ ] **Step 1: Write failing route-contract tests**

Add static/route tests asserting that:

- upload input accepts `materialType`, `answerSourceMode`, `answerKeyText`, and `referenceSourceId`;
- external upload persists `external-grading-recognition-v1` metadata before background processing;
- generated `assignmentId` uploads continue to use `gradingSourcePackage` and are not marked `external_workbook`;
- recognition response includes `pages`, `answerSource`, and `archiveEligible`.

- [ ] **Step 2: Run the focused route tests and verify failure**

Run: `node --test apps/api/src/external-workbook-grading-routes.test.mjs`  
Expected: FAIL on missing fields/route implementation.

- [ ] **Step 3: Implement upload persistence**

In `createQueuedPhotoSubmission`:

- derive `materialType` as `external_workbook` when no `assignmentId` is supplied, otherwise preserve generated-material metadata;
- initialize `content.externalGradingRecognition` with the helper and `answerSourceMode`;
- preserve `answerKeyText` only as teacher-supplied input metadata, never as a final answer without teacher confirmation;
- keep existing `ocr` fields for backward compatibility.

In `POST /api/submissions/grade`:

- pass the new fields through `getBody(req)`;
- keep existing student-scope and `canReceiveNewWork` checks;
- do not expose provider/model/internal OCR fields in the 202 response.

In `recognizeAndGradeSubmissionRecord`:

- convert recognition pages/questions into the versioned packet;
- preserve page order and original image URLs;
- set `gradingStatus=needs_teacher_review` for external material until answer source and question review gates pass;
- leave generated-material grading behavior unchanged.

- [ ] **Step 4: Run focused route/API tests**

Run: `node --test apps/api/src/external-workbook-grading-routes.test.mjs apps/api/src/grading-workbench-question-drafts.test.mjs`  
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bat
git add -- apps/api/src/server.js apps/api/src/external-workbook-grading-routes.test.mjs
git commit -m "feat: persist external workbook grading packets"
```

### Task 3: 把识别包接入工作台与逐题教师修正

**Files:**
- Modify: `apps/api/src/server.js: mapGradingWorkbench, PATCH /api/grading/workbench/:submissionId/questions/:questionId`
- Modify: `apps/api/src/grading-review-gates.js`
- Modify: `apps/api/src/grading-review-gates.test.mjs`
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: Write failing gate and response tests**

Cover:

- external workbench returns `materialType`, `answerSource`, `recognitionPacket`, and `archiveBlockers`;
- teacher patch updates current prompt/answer/score while preserving recognition originals;
- `model_draft` and `missing` answer sources block archive;
- low-confidence or unusable-page packets block archive;
- generated assignments with valid source packages remain archive-eligible under the existing rules.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test apps/api/src/grading-review-gates.test.mjs apps/api/src/external-grading-recognition.test.mjs`  
Expected: new assertions fail before implementation.

- [ ] **Step 3: Implement API mapping and patch behavior**

In `mapGradingWorkbench`:

- read the packet from `Submission.content.externalGradingRecognition`;
- expose only teacher-facing packet fields needed by the workbench;
- map `answerSourceMode` to a concise label while retaining stable internal mode for API use;
- merge packet blockers into `archiveEligible` and `needsTeacherReview`.

In the question PATCH route:

- use `mergeExternalQuestionTeacherReview` for external material;
- keep the existing `questionResults` compatibility representation;
- write an audit event with question ID, status and score, but never raw image data;
- recalculate provisional score only; final score remains null until archive.

In `grading-review-gates.js`:

- add an optional external packet check after existing all-question checks;
- preserve current generated-material behavior.

In `apps/web/src/api.ts`:

- extend `GradingWorkbench` types with packet, answer-source and archive blocker fields;
- extend upload helper input with `materialType`, `answerSourceMode`, `answerKeyText`, and `referenceSourceId`.

- [ ] **Step 4: Run focused tests**

Run: `node --test apps/api/src/grading-review-gates.test.mjs apps/api/src/external-grading-recognition.test.mjs apps/api/src/external-workbook-grading-routes.test.mjs`  
Expected: all pass.

- [ ] **Step 5: Commit**

```bat
git add -- apps/api/src/server.js apps/api/src/grading-review-gates.js apps/api/src/grading-review-gates.test.mjs apps/web/src/api.ts
git commit -m "feat: gate external grading archive by evidence"
```

### Task 4: 完成 Web 外部批改上传与逐题证据复核 UI

**Files:**
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `scripts/web-grading-workbench-ui.test.mjs`

- [ ] **Step 1: Write failing UI contract tests**

Assert source contains:

- iPad 多页上传提示和 `accept="image/*"`/multiple input behavior;
- answer-source controls for teacher-confirmed, selected reference, model draft and missing;
- external material metadata sent with upload;
- workbench displays page quality, recognition confidence, original/current values and archive blockers;
- archive button disabled when external packet blockers exist.

- [ ] **Step 2: Run UI tests and verify failure**

Run: `node --test scripts/web-grading-workbench-ui.test.mjs`  
Expected: new assertions fail.

- [ ] **Step 3: Implement the minimal Web flow**

In the teacher “拍照上传批改” card:

- add explicit `外部练习册` material label;
- tell the teacher to use iPad multi-page photos and preserve order;
- add answer source selector and optional teacher answer text/reference ID;
- pass metadata through the existing multipart upload call;
- keep generated-assignment upload path unchanged.

In `GradingWorkbenchPanel`:

- show page quality summary before question review;
- show answer-source status and blockers;
- show recognition confidence and current/original distinction where available;
- preserve the existing side-by-side image and per-question editor;
- disable archive until all questions and external evidence gates pass;
- keep model/provider/raw fields hidden.

Add responsive styles that keep the upload controls and answer-source panel usable at desktop and iPad widths without nested cards or overflow.

- [ ] **Step 4: Run Web tests and typecheck**

Run: `node --test scripts/web-grading-workbench-ui.test.mjs` and `cmd /c npm.cmd run typecheck --workspace apps/web`  
Expected: all UI tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bat
git add -- apps/web/src/main.tsx apps/web/src/styles.css scripts/web-grading-workbench-ui.test.mjs
git commit -m "feat: add external workbook grading review UI"
```

### Task 5: 联调验证与收口

**Files:**
- Modify: `docs/14-api-contract.md` with the final external grading fields and states.
- Modify: `docs/48-grading-workbench-redesign.md` with the implemented external packet boundary.

- [ ] **Step 1: Run focused API and Web checks**

```bat
cmd /c npm.cmd run check:api
cmd /c npm.cmd run typecheck --workspace apps/web
cmd /c npm.cmd run check:encoding
cmd /c npm.cmd run check:miniprogram-js
cmd /c npm.cmd run check:miniprogram-sync
```

- [ ] **Step 2: Start existing API/Web dev processes and run browser flow**

Flow under test: `教师登录 -> 批改复核 -> 上传多页外部练习册图片 -> 查看答案来源/质量状态 -> 打开逐题复核 -> 低置信时确认归档按钮保持禁用`。

Collect page identity, nonblank DOM, console errors/warnings, screenshot evidence and the disabled archive state. Use a local fixture image only; do not upload private student files during automated verification.

- [ ] **Step 3: Run grading route and workbench tests**

```bat
node --test apps/api/src/external-grading-recognition.test.mjs apps/api/src/external-workbook-grading-routes.test.mjs apps/api/src/grading-review-gates.test.mjs
node --test scripts/web-grading-workbench-ui.test.mjs
```

- [ ] **Step 4: Review diff and commit documentation**

```bat
git diff --check
git status --short
git add -- docs/14-api-contract.md docs/48-grading-workbench-redesign.md
git commit -m "docs: document external workbook grading contract"
```

- [ ] **Step 5: Final guard**

Run: `cmd /c npm.cmd run workspace:guard`  
Expected: visible workspace clean; ignored generated assets remain untracked and untouched.

## Plan self-review

- Spec coverage: external packet, answer source, iPad multi-page upload, original/current values, teacher review, archive blockers, generated-material compatibility and verification are covered by Tasks 1-5.
- No placeholders: all tasks name exact files, commands and expected outcomes.
- Type consistency: `externalGradingRecognition`, `answerSourceMode`, `archiveBlockers` and `materialType` are used consistently across helper, API and Web types.
- Scope: no new database tables, new model providers, network answer scraping or automatic publication.

