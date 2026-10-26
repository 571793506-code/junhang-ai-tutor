# Module Capability and Web Alignment Implementation Plan

> 后续计划：生成与批改的新一轮工作见 [2026-09-11 日常工作台计划](2026-09-11-generation-grading-daily-workbench.md)。本计划保留历史任务记录，不能依据尚未同步的复选框重复实施全部任务；先核查当前代码与提交。新计划文档完成不代表其工程阶段已经实施。

> 2026-10-26 收口更新：第九阶段既有正式双卷、教师最终评分、独立归档及真实数据库闭环已完成。后续日常质量闭环继续推进；本轮补齐学生周/月档案发布和打印的显式教师确认、服务端复核字段保护及资源库真实章节解析，运行验收范围和证据见 [工作台验收记录](../../teaching-workflow-acceptance.md)。真实新档案的教师内容评价/发布、评分缺失证据、稳定时长及近期两份新稿打印版式仍待验收，不据此勾选全部历史任务；学生磨合留出任务继续暂缓，工作区清理后置。旧模型矩阵仅作历史记录，当前配置与后续验收记录为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把生成、批改、资源库和学生档案统一到同一套能力契约、上下文工程、模型路由、教师复核和多端可见性流程，使 Web 成为服务层能力的完整联调入口，并为小程序复用留下稳定契约。

**Architecture:** 在 `packages/core` 建立机器可检查的模块能力登记，在 `packages/services` 建立生成、批改和档案的上下文组装与状态归一化，在 `packages/ai` 统一任务级模型策略。API 负责权限、教材和资料证据、持久化与角色过滤；Web 只提交业务字段、展示服务端结构化结果和复核状态；小程序继续复用同一 API，不在本计划中重写端侧逻辑。

**Tech Stack:** Node.js 22+ ES modules, Express 5, Prisma 6, React 18/TypeScript, Vite, `node:test`, existing `jh.cmd` and `npm.cmd` verification scripts, existing GPT-5.6/MiniMax/DeepSeek adapters.

**Spec:** `docs/superpowers/specs/2026-09-07-module-capability-and-web-alignment-design.md`

## Global Constraints

- 核心逻辑必须沉淀到 API、服务层、脚本、共享工具或数据契约，不能只写在 Web 页面状态里。
- Web 只作为联调、原型验证和自动化测试入口；小程序和平板复用相同 API、服务层和共享契约。
- 模型原始输出不得直接传给任何端或写入正式资产；必须经过 parse、normalize、validate、repair、角色过滤和 review-state handling。
- 生成、批改和档案结果在教师复核或确认前只能是草稿；未确认结果不得发布、归档或正式导出。
- 学生、家长、课堂平板和公共屏不得看到模型名、供应商、API 地址、内部 prompt、密钥、debug、raw、升级元数据、学习信号或阻断元数据。
- 学生 AI 问答最多调用一次 Terra `low`；问答不可用时不调用 Sol；问答只在服务端准入后进入档案辅助证据。
- 小测、普通练习和个性化练习使用 Terra `medium`；正式试卷、参考答案和主观批改使用 Terra `high`；档案草稿使用 Terra `low`。
- MiniMax 只承担视觉 OCR 和语音；DeepSeek 只作为显式开启的紧急文本回滚候选，不进入默认文本链路。
- Sol 只允许在已分类的 availability 或 evidence-sufficient quality 故障上对最小失败单元升级一次；configuration 和 evidence 不足故障不升级。
- `.edupdf` 受保护教材不得转换或改写；带教材或章节的生成请求必须有真实教材资产、匹配范围和已审批资料证据。
- 生成必须保存内部版本化 `junhang-grading-source-v1` 答案包；学生卷和解析卷是答案包派生产物，不能反向作为标准答案来源。
- 数学总分、客观题比较、来源指纹和归档资格由服务层确定性规则负责，模型不能覆盖顶层分数或绕过归档门禁。
- Windows 命令使用 `cmd /c npm.cmd run ...`、`.\jh.cmd` 的实际项目入口或 `npm.cmd`；本计划中的命令均按 PowerShell/Windows 运行方式书写。
- 既有脏工作区不得清理或覆盖；提交时只使用显式路径，不使用 `git add .`。
- 修改中文文案、提示词、规则或文档后运行 `cmd /c npm.cmd run check:encoding`；涉及历史导出、备份或生成 HTML/PDF 源时再运行 `cmd /c npm.cmd run check:encoding:history`。

## File Structure

### Shared contracts and routing

- Create `packages/core/src/module-capability-registry.js`
  - Owns the four module definitions, schema version, contract fields, review gates, and verification command declarations.
- Create `packages/core/src/module-capability-registry.test.mjs`
  - Verifies module IDs, required contract fields, role visibility declarations, and route dependency order.
- Modify `packages/core/src/index.js` and `packages/core/src/index.d.ts`
  - Export the registry and TypeScript shapes used by API, services, and Web.
- Create `packages/services/src/module-capability-status.js`
  - Converts the static registry and AI runtime snapshot into a teacher-safe capability status response.
- Create `packages/services/src/module-capability-status.test.mjs`
  - Verifies availability mapping and removal of internal provider/model fields from the response.
- Modify `packages/services/src/index.js`
  - Export capability status and the shared context builders introduced by later tasks.

### Skills and documentation

- Modify `SKILLS.md`
  - Add intent-to-Skill routing, dependency order, output contracts, and the capability registry location.
- Modify `.agents/skills/generation/SKILL.md`, `.agents/skills/grading/SKILL.md`, `.agents/skills/teaching-materials/SKILL.md`, `.agents/skills/student-profile/SKILL.md`
  - Make Codex discovery descriptions include the exact cross-module triggers and load order.
- Modify `skills/generation/SKILLS.md`, `skills/grading/SKILLS.md`, `skills/teaching-materials/SKILLS.md`, `skills/student-profile/SKILLS.md`
  - Add explicit sections for triggers, dependencies, input/output, execution sequence, model policy, review gate, and verification.
- Modify `scripts/skills-check-lib.mjs` and `scripts/skills-check.test.mjs`
  - Check the module playbook contract sections and exact dependency routes in addition to existing frontmatter checks.

### Context, model policy, and API

- Create `packages/services/src/context-engineering.js`
  - Owns `buildGenerationContext`, `buildSubmissionGradingContext`, and `buildStudentProfileContext` with safe field allowlists and size limits.
- Create `packages/services/src/context-engineering.test.mjs`
  - Verifies context completeness, source boundaries, truncation, and rejection of client-supplied internal fields.
- Create `packages/ai/src/model-policy.js`
  - Owns `resolveTaskModelPolicy` and task-level defaults for QA, generation, reference answers, grading, profile, OCR, speech, Sol escalation, and emergency rollback.
- Create `packages/ai/src/model-policy.test.mjs`
  - Verifies the route matrix, reasoning effort, timeout/token budgets, failure classes, and one-attempt escalation rule.
- Modify `packages/ai/src/runtime.js`, `packages/ai/src/index.js`, and `packages/ai/src/index.d.ts`
  - Route existing model calls through the shared policy while preserving injected runners used by tests.
- Modify `apps/api/src/server.js`
  - Enforce request allowlists, resolve server-owned context, expose teacher-safe capability status, and wire generation, grading, profile, and content gates.
- Modify `apps/api/src/approved-content-context.js`
  - Add the bounded context preview summary consumed by the generation page.

### Web and verification

- Modify `apps/web/src/api.ts`
  - Add types and wrappers for capability status, generation context summaries, grading workflow states, profile gates, and content preview.
- Modify `apps/web/src/main.tsx`
  - Make generation, grading, resources, and profile panels consume the server contracts and display actionable review/block states.
- Modify `scripts/web-generation-workbench-ui.test.mjs`, `scripts/web-grading-workbench-ui.test.mjs`, and `scripts/content-upload-ui-contract.mjs`
  - Extend static UI contract checks for context previews, teacher review, answer-source evidence, and role-safe output.
- Modify `scripts/content-context-e2e.mjs` and `scripts/content-context-e2e.test.mjs`
  - Add context-preview and source-gate assertions without turning the low-budget link guard into a content-quality test.
- Modify `scripts/grading-quality-check.mjs` and `scripts/grading-quality-check.test.mjs`
  - Validate teacher-confirmed gold inputs and report the existing grading metrics with explicit evidence boundaries.
- Modify `docs/14-api-contract.md`, `docs/41-prompt-context-engineering-playbook.md`, `docs/43-content-index-ui-runbook.md`, and `docs/44-miniprogram-migration-runbook.md`
  - Document the final contracts, route order, Web behavior, and future Mini Program reuse boundary.

### Profile review gate and quality entry points

- Create `apps/api/src/student-profile-publish-gate.js`
  - Owns the pure publish decision for blocked evidence, pending teacher confirmation, and role-safe published snapshots.
- Create `apps/api/src/student-profile-publish-gate.test.mjs`
  - Verifies unconfirmed grading and low-confidence evidence cannot become public profile evidence.
- Modify `apps/api/src/student-growth-profile.js` and `apps/api/src/student-growth-profile.test.mjs`
  - Refine evidence-source priority, blocked evidence summaries, and profile context normalization.
- Create `scripts/quality-gold-contract.mjs` and `scripts/quality-gold-contract.test.mjs`
  - Validates the teacher-confirmed gold case shape used by grading and profile quality checks.
- Create `fixtures/quality/grading-gold-cases.example.json`
  - Provides a synthetic contract example with no real student data; production evaluation uses a separately reviewed teacher gold file.

## Shared Interfaces

The following names and shapes are fixed before implementation. Later tasks must use these names rather than introducing parallel fields.

```ts
type ModuleCapabilityId =
  | "generation"
  | "grading"
  | "teaching-materials"
  | "student-profile";

type ModuleCapabilityDefinition = {
  moduleId: ModuleCapabilityId;
  triggers: string[];
  dependencies: string[];
  requestContract: {
    requiredFields: string[];
    optionalFields: string[];
    serverDerivedFields: string[];
    forbiddenClientFields: string[];
  };
  resultContract: {
    teacherVisibleFields: string[];
    studentVisibleFields: string[];
    internalOnlyFields: string[];
  };
  modelPolicy: {
    primaryTask: string;
    primaryRoute: string;
    supportRoutes: string[];
    defaultReasoning: Record<string, string>;
    escalation: {
      allowedTriggerClasses: string[];
      blockedTriggerClasses: string[];
      maxAttemptsPerUnit: number;
    };
  };
  reviewGate: "instant_safe_response" | "teacher_review" | "teacher_confirmation" | "blocked";
  verification: {
    tests: string[];
    commands: string[];
  };
};

type ModuleCapabilityStatus = {
  schemaVersion: "junhang-module-capability-v1";
  generatedAt: string;
  capabilities: Array<{
    moduleId: ModuleCapabilityId;
    status: "available" | "draft" | "review_required" | "blocked" | "failed";
    dependencyStatus: "ready" | "review_required" | "blocked";
    reviewGate: ModuleCapabilityDefinition["reviewGate"];
    teacherMessage: string;
    verification: ModuleCapabilityDefinition["verification"];
  }>;
};

type GenerationContextBundle = {
  generationContext: {
    request: Record<string, unknown>;
    target: Record<string, unknown>;
    teaching: {
      textbook: Record<string, unknown>;
      knowledgePoints: string[];
      contentContext: Record<string, unknown>;
      evidence: Record<string, unknown>;
    };
    studentSignals: Array<Record<string, unknown>>;
    output: Record<string, unknown>;
    rules: Record<string, unknown>;
  };
  generationBudget: {
    profile: string;
    assessmentTotalTimeoutMs: number;
    assessmentMaxTokens: number;
  };
  contentContext: Record<string, unknown>;
};

type TaskModelPolicy = {
  task: string;
  primary: {
    providerId: "gpt56" | "minimax";
    reasoningEffort: "none" | "low" | "medium" | "high";
    timeoutMs: number | null;
    maxTokens: number | null;
  };
  escalation: {
    enabled: boolean;
    providerId: "gpt56" | null;
    reasoningEffort: "high" | null;
    timeoutMs: number | null;
    maxAttemptsPerUnit: number;
    allowedTriggerClasses: string[];
    blockedTriggerClasses: string[];
  };
  fallback: "dynamic_draft" | "teacher_review" | "unavailable";
};
```

## Phase 1: Module Capability Contract and Skills Routing

### Task 1: Shared Module Capability Registry

**Files:**
- Create: `packages/core/src/module-capability-registry.js`
- Create: `packages/core/src/module-capability-registry.test.mjs`
- Modify: `packages/core/src/index.js`
- Modify: `packages/core/src/index.d.ts`

**Interfaces:**
- Produces `MODULE_CAPABILITY_SCHEMA_VERSION`, `moduleCapabilityCatalog`, `listModuleCapabilities()`, `getModuleCapability(moduleId)`, and `validateModuleCapabilityRegistry(registry)`.
- `listModuleCapabilities()` returns the four `ModuleCapabilityDefinition` records in the order `generation`, `grading`, `teaching-materials`, `student-profile`.
- `validateModuleCapabilityRegistry()` returns `{ ok: boolean; issues: string[] }` and rejects duplicate IDs, missing required fields, unknown dependency IDs, empty verification commands, and a review gate that does not match the module contract.

- [ ] **Step 1: Write the failing registry tests**

Create `packages/core/src/module-capability-registry.test.mjs` with tests for the fixed IDs, dependency order, and role visibility:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  getModuleCapability,
  listModuleCapabilities,
  validateModuleCapabilityRegistry
} from "./module-capability-registry.js";

test("registers the four cross-module capabilities in dependency order", () => {
  assert.deepEqual(
    listModuleCapabilities().map((item) => item.moduleId),
    ["generation", "grading", "teaching-materials", "student-profile"]
  );
  assert.equal(getModuleCapability("grading").dependencies.includes("generation"), true);
  assert.equal(getModuleCapability("student-profile").dependencies.includes("grading"), true);
});

test("every module declares client, teacher, and internal boundaries", () => {
  for (const capability of listModuleCapabilities()) {
    assert.ok(capability.requestContract.forbiddenClientFields.length > 0);
    assert.ok(capability.resultContract.teacherVisibleFields.length > 0);
    assert.ok(capability.resultContract.internalOnlyFields.length > 0);
    assert.ok(capability.verification.commands.length > 0);
  }
});

test("registry validation reports duplicate and unknown dependencies", () => {
  const result = validateModuleCapabilityRegistry([
    { ...getModuleCapability("generation"), moduleId: "generation", dependencies: ["unknown"] },
    { ...getModuleCapability("generation"), moduleId: "generation" }
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes("duplicate moduleId")));
  assert.ok(result.issues.some((issue) => issue.includes("unknown dependency")));
});
```

- [ ] **Step 2: Run the focused test and verify it fails for the missing module**

Run:

```powershell
cmd /c node --test packages\core\src\module-capability-registry.test.mjs
```

Expected: FAIL because `module-capability-registry.js` does not exist yet.

- [ ] **Step 3: Implement the registry with the fixed four definitions**

Define the schema version and records in `packages/core/src/module-capability-registry.js`. The records must contain these concrete boundaries:

```js
export const MODULE_CAPABILITY_SCHEMA_VERSION = "junhang-module-capability-v1";

export const moduleCapabilityCatalog = Object.freeze([
  {
    moduleId: "generation",
    triggers: ["生成小测", "生成练习", "生成试卷", "生成教学任务"],
    dependencies: ["teaching-materials"],
    requestContract: {
      requiredFields: ["subject", "kind", "grade", "requirement"],
      optionalFields: ["studentId", "targetScope", "textbookAssetId", "textbookChapterId", "knowledgePoints"],
      serverDerivedFields: ["requestId", "studentSignals", "generationContext", "contentContext", "generationBudget"],
      forbiddenClientFields: ["prompt", "provider", "model", "raw", "debug", "generationContext", "contentContext", "generationBudget"]
    },
    resultContract: {
      teacherVisibleFields: ["draftItems", "audit", "generationPipeline", "generationContextSummary", "gradingSource", "reviewStatus"],
      studentVisibleFields: ["title", "publishedStudentPaper", "status"],
      internalOnlyFields: ["raw", "prompt", "provider", "model", "modelRun", "reviewModelRunIds", "budget"]
    },
    modelPolicy: {
      primaryTask: "assessment-draft",
      primaryRoute: "gpt56-assessment",
      supportRoutes: ["gpt56-sol-escalation", "local-structured-repair"],
      defaultReasoning: { quiz: "medium", practice: "medium", formal: "high" },
      escalation: { allowedTriggerClasses: ["availability", "quality"], blockedTriggerClasses: ["configuration", "evidence"], maxAttemptsPerUnit: 1 }
    },
    reviewGate: "teacher_review",
    verification: {
      tests: ["packages/services/src/assessment-draft-review.test.mjs", "packages/core/src/grading-source-package.test.mjs"],
      commands: ["check:generation:blueprint", "check:content-context", "check:api"]
    }
  },
  {
    moduleId: "grading",
    triggers: ["批改生成材料", "批改外部练习册", "复核 OCR", "确认逐题分数"],
    dependencies: ["generation"],
    requestContract: {
      requiredFields: ["studentId", "subject", "imageNames"],
      optionalFields: ["assignmentId", "answerKeyText", "referenceSourceId", "ocrQuestions"],
      serverDerivedFields: ["gradingSourcePackage", "questionLayoutManifest", "referenceAnswers", "imageQuality"],
      forbiddenClientFields: ["finalScore", "archiveEligible", "provider", "model", "raw", "debug"]
    },
    resultContract: {
      teacherVisibleFields: ["pages", "questions", "quality", "answerSource", "archiveBlockers", "workflowState"],
      studentVisibleFields: ["reviewedScore", "reviewedFeedback", "status"],
      internalOnlyFields: ["raw", "prompt", "provider", "model", "modelRun", "attempts", "usedModelEscalation"]
    },
    modelPolicy: {
      primaryTask: "submission-grading",
      primaryRoute: "gpt56-grading",
      supportRoutes: ["minimax-ocr", "local-objective-comparison", "gpt56-sol-escalation"],
      defaultReasoning: { reference: "high", grading: "high", audit: "high" },
      escalation: { allowedTriggerClasses: ["availability", "quality"], blockedTriggerClasses: ["configuration", "evidence"], maxAttemptsPerUnit: 1 }
    },
    reviewGate: "teacher_confirmation",
    verification: {
      tests: ["packages/services/src/deterministic-grading.test.mjs", "apps/api/src/grading-source-package-contract.test.mjs"],
      commands: ["check:api", "check:grading:quality"]
    }
  },
  {
    moduleId: "teaching-materials",
    triggers: ["上传教学资料", "转换 Markdown", "重建内容索引", "审核资料来源", "绑定教材章节"],
    dependencies: [],
    requestContract: {
      requiredFields: ["sourceType", "title"],
      optionalFields: ["subject", "grade", "edition", "textbookAssetId", "textbookChapterId"],
      serverDerivedFields: ["sourceId", "chunkCount", "indexStatus", "licenseStatus", "allowedForGeneration"],
      forbiddenClientFields: ["absolutePath", "databaseConnection", "prompt", "provider", "model"]
    },
    resultContract: {
      teacherVisibleFields: ["source", "summary", "indexStatus", "reviewStatus", "allowedForGeneration"],
      studentVisibleFields: ["status"],
      internalOnlyFields: ["absolutePath", "rawMarkdown", "chunks", "databaseConnection", "debug"]
    },
    modelPolicy: {
      primaryTask: "content-index",
      primaryRoute: "local-document-conversion",
      supportRoutes: ["local-content-index", "teacher-review"],
      defaultReasoning: {},
      escalation: { allowedTriggerClasses: [], blockedTriggerClasses: ["configuration", "evidence"], maxAttemptsPerUnit: 0 }
    },
    reviewGate: "teacher_review",
    verification: {
      tests: ["apps/api/src/approved-content-context.test.mjs", "scripts/build-content-index.test.mjs"],
      commands: ["check:content-upload-ui", "check:content-context"]
    }
  },
  {
    moduleId: "student-profile",
    triggers: ["生成周档案", "生成月度综合档案", "生成阶段报告", "发布家长摘要"],
    dependencies: ["grading", "teaching-materials"],
    requestContract: {
      requiredFields: ["studentId", "periodType"],
      optionalFields: ["teacherText", "periodLabel"],
      serverDerivedFields: ["profileEvidencePack", "blockedEvidence", "publishedView", "printView"],
      forbiddenClientFields: ["profileEvidencePack", "blockedEvidence", "provider", "model", "raw", "debug"]
    },
    resultContract: {
      teacherVisibleFields: ["profileEvidencePack", "teacherReview", "publishedView", "printView", "publishGate"],
      studentVisibleFields: ["publishedView", "status", "period"],
      internalOnlyFields: ["raw", "prompt", "provider", "model", "blockedEvidenceDetails", "modelRun"]
    },
    modelPolicy: {
      primaryTask: "student-profile-narrative",
      primaryRoute: "gpt56-profile",
      supportRoutes: ["local-evidence-aggregation", "teacher-edit"],
      defaultReasoning: { weekly: "low", monthly: "low", term: "low" },
      escalation: { allowedTriggerClasses: [], blockedTriggerClasses: ["configuration", "evidence"], maxAttemptsPerUnit: 0 }
    },
    reviewGate: "teacher_confirmation",
    verification: {
      tests: ["apps/api/src/student-growth-profile.test.mjs", "apps/api/src/student-profile-publish-gate.test.mjs"],
      commands: ["check:api", "typecheck --workspace apps/web"]
    }
  }
]);
```

Implement `listModuleCapabilities()` as a shallow copy of the frozen catalog, `getModuleCapability(moduleId)` as an exact ID lookup, and `validateModuleCapabilityRegistry()` as a pure structural check. Do not include runtime API keys, resolved model names, absolute paths, or raw content in the registry.

- [ ] **Step 4: Export the registry and types**

Add `export * from "./module-capability-registry.js";` to `packages/core/src/index.js`. Add the `ModuleCapabilityId`, `ModuleCapabilityDefinition`, `ModuleCapabilityStatus`, and function declarations to `packages/core/src/index.d.ts` using the shared interfaces above.

- [ ] **Step 5: Run the focused tests and package checks**

Run:

```powershell
cmd /c node --test packages\core\src\module-capability-registry.test.mjs
cmd /c npm.cmd run check:skills
```

Expected: the new registry tests pass; the existing Skills check remains green before the Skills files are changed in Task 2.

- [ ] **Step 6: Commit only the registry files**

```powershell
git add -- packages/core/src/module-capability-registry.js packages/core/src/module-capability-registry.test.mjs packages/core/src/index.js packages/core/src/index.d.ts
git commit -m "feat: add module capability registry"
```

### Task 2: Skills Discovery and Cross-Module Routing

**Files:**
- Modify: `SKILLS.md`
- Modify: `.agents/skills/generation/SKILL.md`
- Modify: `.agents/skills/grading/SKILL.md`
- Modify: `.agents/skills/teaching-materials/SKILL.md`
- Modify: `.agents/skills/student-profile/SKILL.md`
- Modify: `skills/generation/SKILLS.md`
- Modify: `skills/grading/SKILLS.md`
- Modify: `skills/teaching-materials/SKILLS.md`
- Modify: `skills/student-profile/SKILLS.md`
- Modify: `scripts/skills-check-lib.mjs`
- Modify: `scripts/skills-check.test.mjs`

**Interfaces:**
- `validateSkillsWorkspace(workspaceRoot)` continues to return `{ ok, checkedSkills, failures }`.
- Add `MODULE_PLAYBOOK_REQUIREMENTS` and `validateModulePlaybookContracts({ rootSkills, playbooks })` to `scripts/skills-check-lib.mjs`.
- A module playbook must contain the exact headings `## 何时加载`, `## 前置依赖`, `## 输入契约`, `## 输出契约`, `## 执行顺序`, `## 模型与复核`, and `## 验证`.

- [ ] **Step 1: Add failing Skills contract tests**

Extend `scripts/skills-check.test.mjs` with a fixture containing the four playbooks and assert that a missing section and an incorrect route are reported:

```js
test("reports a missing module playbook section", async () => {
  await withFixture(async (root) => {
    const skillPath = path.join(root, "skills", "generation", "SKILLS.md");
    const content = await readFile(skillPath, "utf8");
    await write(root, "skills/generation/SKILLS.md", content.replace("## 验证", ""));
    const result = await validateSkillsWorkspace(root);
    assert.ok(failureCodes(result).includes("missing-module-playbook-section"));
  });
});

test("reports a generation route that skips prompt-context engineering", async () => {
  await withFixture(async (root) => {
    const rootSkills = await readFile(path.join(root, "SKILLS.md"), "utf8");
    await write(root, "SKILLS.md", rootSkills.replace("prompt-context-engineering", "ai-qa"));
    const result = await validateSkillsWorkspace(root);
    assert.ok(failureCodes(result).includes("invalid-module-route"));
  });
});
```

- [ ] **Step 2: Run the Skills tests and verify the new failures are absent from the checker**

Run:

```powershell
cmd /c node --test scripts\skills-check.test.mjs
```

Expected: FAIL because `validateSkillsWorkspace()` does not yet validate module playbook sections or the new root route order.

- [ ] **Step 3: Implement exact playbook contract validation**

Add this requirement table to `scripts/skills-check-lib.mjs`:

```js
export const MODULE_PLAYBOOK_REQUIREMENTS = {
  generation: {
    path: "skills/generation/SKILLS.md",
    route: ["teaching-materials", "prompt-context-engineering", "generation"],
    tokens: ["generationContext", "gradingSourcePackage", "teacher_review", "check:generation:quality"]
  },
  grading: {
    path: "skills/grading/SKILLS.md",
    route: ["grading"],
    tokens: ["gradingSourcePackage", "ocrQuestions", "teacher_confirmation", "check:grading:quality"]
  },
  "teaching-materials": {
    path: "skills/teaching-materials/SKILLS.md",
    route: ["teaching-materials"],
    tokens: [".edupdf", "allowedForGeneration", "contentContext", "check:content-context"]
  },
  "student-profile": {
    path: "skills/student-profile/SKILLS.md",
    route: ["grading", "student-profile"],
    tokens: ["profileEvidencePack", "blockedEvidence", "publishedView", "teacher_confirmation"]
  }
};
```

Read each required route file as UTF-8, check the seven exact headings, verify all required tokens, and return failure codes `missing-module-playbook-section`, `missing-module-playbook-token`, and `invalid-module-route`. Update the test fixture builder to include the minimum valid headings so unrelated frontmatter tests continue to isolate one failure at a time.

- [ ] **Step 4: Rewrite the root routing table and four wrappers**

Update `SKILLS.md` so each route records `意图 -> 首个 Skill -> 依赖 Skill -> 执行顺序 -> 验证命令`, with these exact routes:

```text
生成小测/练习/试卷 -> teaching-materials (only when textbook/material is named) -> prompt-context-engineering -> generation -> gradingSourcePackage -> teacher review
已生成材料批改 -> grading -> gradingSourcePackage/questionLayoutManifest -> teacher question review -> teacher confirmation
外部材料批改 -> grading -> reference answer registration -> OCR/question review -> teacher confirmation
资料上传/登记 -> teaching-materials -> conversion/index -> source review -> generation contentContext
周/月档案 -> grading evidence -> student-profile -> teacher edit -> teacher confirmation -> publishedView/printView
```

Update the four `.agents/skills/*/SKILL.md` descriptions so their first sentence includes the concrete trigger set and the body directs a cross-module task to load `skills/<module>/SKILLS.md` plus the other routes named above. Keep frontmatter restricted to `name` and `description`.

Update the four `skills/*/SKILLS.md` files with the exact seven headings. Under those headings, document:

- generation: `kind`-specific blueprints, `generationContext`, answer package creation, budget profiles, Sol triggers, dynamic fallback, and `check:generation:quality:*` versus `check:content-context`.
- grading: generated versus external material, OCR/printed prompt/student answer separation, deterministic objective grading, question-level review, and archive blockers.
- teaching-materials: MarkItDown default conversion, `.edupdf` protection, source/version/license review, chunk visibility, and the `contentContext` injection gate.
- student-profile: evidence priority, blocked evidence, sample limits, weekly/monthly/term output differences, role filtering, and teacher confirmation.

- [ ] **Step 5: Run Skills and encoding checks**

Run:

```powershell
cmd /c node --test scripts\skills-check.test.mjs
cmd /c npm.cmd run check:skills
cmd /c npm.cmd run check:encoding
```

Expected: all fixed nine Skills routes and the four module playbooks pass; no modified Chinese rule or description produces an encoding issue.

- [ ] **Step 6: Commit the Skills routing boundary**

```powershell
git add -- SKILLS.md .agents/skills/generation/SKILL.md .agents/skills/grading/SKILL.md .agents/skills/teaching-materials/SKILL.md .agents/skills/student-profile/SKILL.md skills/generation/SKILLS.md skills/grading/SKILLS.md skills/teaching-materials/SKILLS.md skills/student-profile/SKILLS.md scripts/skills-check-lib.mjs scripts/skills-check.test.mjs
git commit -m "docs: formalize module skills routing"
```

### Task 3: Teacher-Safe Capability Status

**Files:**
- Create: `packages/services/src/module-capability-status.js`
- Create: `packages/services/src/module-capability-status.test.mjs`
- Modify: `packages/services/src/index.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**
- Add `buildModuleCapabilityStatus(config, role = "teacher")` in `packages/services/src/module-capability-status.js`.
- Extend `GET /api/ai/status` with top-level `capabilities: ModuleCapabilityStatus`; keep the endpoint teacher-only.
- `getApiStatus()` returns the top-level `capabilities` object and a sanitized `ai` status summary; the browser response never returns `model`, `baseUrl`, `apiKey`, `prompt`, `raw`, `debug`, or full orchestration internals.

- [ ] **Step 1: Write failing status projection tests**

Test a ready GPT-5.6/MiniMax snapshot and an unavailable snapshot. Assert that module statuses are present and internal fields are removed:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildModuleCapabilityStatus } from "./module-capability-status.js";

test("projects runtime readiness into four teacher-safe module statuses", () => {
  const result = buildModuleCapabilityStatus({
    aiSnapshot: {
      generatedAt: "2026-09-07T00:00:00.000Z",
      features: [
        { id: "assessment-draft", status: "ready" },
        { id: "submission-grading", status: "ready" },
        { id: "spoken-interaction", status: "unavailable" }
      ]
    }
  });
  assert.deepEqual(result.capabilities.map((item) => item.moduleId), ["generation", "grading", "teaching-materials", "student-profile"]);
  assert.equal(result.capabilities.find((item) => item.moduleId === "generation").status, "available");
  assert.equal("model" in result.capabilities[0], false);
  assert.equal("prompt" in result.capabilities[0], false);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

```powershell
cmd /c node --test packages\services\src\module-capability-status.test.mjs
```

Expected: FAIL because the status projection module does not exist.

- [ ] **Step 3: Implement the projection using the core registry and AI snapshot**

Import `listModuleCapabilities()` from `@junhang/core` and `buildAiStartupSnapshot()` from `@junhang/ai`. Resolve the snapshot from `config.aiSnapshot` when supplied by tests, otherwise call `buildAiStartupSnapshot(config)`. Map a ready feature to `available`, an unavailable feature to `blocked`, and a missing feature to `review_required`. The teaching-materials status is `available` only for the route itself; its dependency state remains `review_required` until a reviewed source is selected. The returned object contains the schema version, timestamp, module ID, state, dependency state, review gate, teacher message, and verification commands. Do not copy `modelPolicy`, model names, URLs, attempt metadata, or raw runtime configuration into the response.

- [ ] **Step 4: Add the capability status to the teacher AI status endpoint**

Import `buildModuleCapabilityStatus` in `apps/api/src/server.js` and change the existing route to build a safe AI summary and the top-level capability status:

```js
app.get("/api/ai/status", requireSession(config, ["teacher"]), (_req, res) => {
  const snapshot = buildAiStartupSnapshot(config);
  res.json({
    ok: true,
    ai: {
      generatedAt: snapshot.generatedAt,
      mode: snapshot.mode,
      features: snapshot.features.filter((feature) => feature.id !== "avatar-dialog").map((feature) => ({
        id: feature.id,
        label: feature.label,
        appSurface: feature.appSurface,
        status: feature.status,
        reason: feature.status === "ready" ? "AI生成可用" : "AI生成暂不可用"
      }))
    },
    capabilities: buildModuleCapabilityStatus({ ...config, aiSnapshot: snapshot }, "teacher")
  });
});
```

The service must sanitize the AI snapshot before it reaches the normal Web status type and must not return `orchestration` from this browser response. Preserve the current teacher-only boundary for the endpoint.

- [ ] **Step 5: Consume the status in the Web shell**

Extend the `getApiStatus()` response type in `apps/web/src/api.ts` with `capabilities: ModuleCapabilityStatus`; update the `ai` type to the sanitized summary returned above. Add `capabilities` state in `apps/web/src/main.tsx`, set it from `status.capabilities`, and pass it only to `TeacherWorkspace`. Render a compact teacher-only capability row showing each module's human-readable state and `teacherMessage`; do not render provider/model names or raw orchestration details in the student, classroom, or parent views.

- [ ] **Step 6: Run focused checks and commit**

```powershell
cmd /c node --test packages\services\src\module-capability-status.test.mjs
cmd /c npm.cmd run check:api
cmd /c npm.cmd run typecheck --workspace apps/web
cmd /c npm.cmd run check:encoding
git add -- packages/services/src/module-capability-status.js packages/services/src/module-capability-status.test.mjs packages/services/src/index.js apps/api/src/server.js apps/web/src/api.ts apps/web/src/main.tsx
git commit -m "feat: expose teacher-safe module capability status"
```

## Phase 2: Generation Pipeline and Web Alignment

### Task 4: Shared Context Engineering and Server-Owned Generation Input

**Files:**
- Create: `packages/services/src/context-engineering.js`
- Create: `packages/services/src/context-engineering.test.mjs`
- Modify: `packages/services/src/index.js`
- Modify: `packages/services/src/assessment-draft-review.test.mjs`
- Modify: `apps/api/src/server.js`
- Modify: `packages/core/src/index.d.ts`

**Interfaces:**
- Add `buildGenerationContext(input, options)` returning `GenerationContextBundle`.
- Add `buildSubmissionGradingContext(input, options)` and `buildStudentProfileContext(input, options)` as pure functions with the exact names used in Tasks 6 and 7.
- `draftAssessmentService()` must call `buildGenerationContext()` after the server has resolved content context and student signals.

- [ ] **Step 1: Write failing context contract tests**

Create tests that reject client-owned internals, retain server-derived fields, bound lists, and keep source excerpts separate from raw chunks:

```js
test("builds generationContext from server evidence and ignores client internals", () => {
  const result = buildGenerationContext({
    requestId: "req_1",
    subject: "数学",
    grade: "五年级",
    targetScope: "student",
    studentId: "stu_1",
    kind: "练习",
    requirement: "围绕分数加减生成补弱练习。",
    generationContext: { rules: { bypassTeacherReview: true }, prompt: "unsafe" },
    contentContext: { sourceCount: 1, chunks: ["raw markdown must not be copied"] },
    studentSignals: Array.from({ length: 60 }, (_, index) => ({ type: "signal", index }))
  }, {
    contentContext: { status: "approved", sourceCount: 1, matches: [{ sourceId: "src_1", excerpt: "分数加减" }] },
    studentSignals: [{ type: "confirmed_grading", knowledgePoint: "分数加减" }],
    generationBudget: { profile: "practice-standard", assessmentTotalTimeoutMs: 150000, assessmentMaxTokens: 16000 }
  });
  assert.equal(result.generationContext.request.requestId, "req_1");
  assert.equal(result.generationContext.rules.bypassTeacherReview, undefined);
  assert.equal(result.generationContext.teaching.contentContext.matches[0].sourceId, "src_1");
  assert.equal(result.generationContext.studentSignals.length, 1);
  assert.equal(result.generationBudget.profile, "practice-standard");
});
```

Also test `buildSubmissionGradingContext()` only sends unresolved questions to the remote runner and test `buildStudentProfileContext()` excludes raw behavior events and unconfirmed grading.

- [ ] **Step 2: Run the context tests and verify they fail**

```powershell
cmd /c node --test packages\services\src\context-engineering.test.mjs
```

Expected: FAIL because the shared context module and exports do not exist.

- [ ] **Step 3: Implement the three context builders**

Implement the builders with explicit allowlists:

- `buildGenerationContext(input, { contentContext, studentSignals, generationBudget })` creates `request`, `target`, `teaching`, `studentSignals`, `output`, and `rules`; it copies only approved content summaries and never copies client `generationContext`, `prompt`, `raw`, or `debug` fields.
- `buildSubmissionGradingContext(input, { ocr, reference, questionLayoutManifest, deepAuditRequired })` separates `printedText`, `studentAnswerText`, `ocrQuestions`, `referenceAnswers`, and `questionLayoutManifest`; it limits remote payloads to 80 questions and 1200/1800 character previews according to the existing audit boundary.
- `buildStudentProfileContext({ student, snapshot, profileEvidencePack })` keeps `profileEvidencePack`, `publishedView` draft fields, period metadata, and teacher observations while dropping raw model output, full behavior logs, guardian fields, provider fields, and unconfirmed grading.

Normalize each returned object with `normalizeDisplayPayload`-compatible plain values and ensure all arrays have deterministic ordering and bounded length.

- [ ] **Step 4: Replace the inline generation context assembly**

In `packages/services/src/index.js`, keep `resolveAssessmentGenerationBudget()` as the source of budget defaults and call `buildGenerationContext()` from `draftAssessmentService()` with the already-resolved `contentContext`, `studentSignals`, `generationBudget`, and request ID. Preserve the existing values: `quiz-standard` 120000/16000, `practice-standard` 150000/16000, and `formal-full` 240000/24000. Keep `teacherReviewRequired`, `includeAnswerAnalysis`, and `includeStructuredAnswerPackage` true.

- [ ] **Step 5: Whitelist API assessment input**

Change `assessmentDraftInputFromRequest(req)` in `apps/api/src/server.js` to copy only the business fields used by `assessmentGenerationJobRequest()`: target scope, student/grade, subject, kind, difficulty, requirement, requested item count, content scope, knowledge points, textbook identifiers, generation basis, and recovery reason. Drop client-supplied `generationContext`, `contentContext`, `studentSignals`, `generationBudget`, `provider`, `model`, `prompt`, `raw`, and `debug` before `prepareAssessmentDraftInput()`.

Keep `prepareAssessmentDraftInput()` as the owner of student signal loading, approved content resolution, textbook metadata derivation, active-student validation, and `generationBasis`. Add a regression assertion that a client-provided content context cannot make an unapproved textbook request pass.

- [ ] **Step 6: Run service and API checks, then commit the context boundary**

```powershell
cmd /c node --test packages\services\src\context-engineering.test.mjs packages\services\src\assessment-draft-review.test.mjs
cmd /c npm.cmd run check:api
cmd /c npm.cmd run check:generation:blueprint
cmd /c npm.cmd run check:encoding
git add -- packages/services/src/context-engineering.js packages/services/src/context-engineering.test.mjs packages/services/src/index.js packages/services/src/assessment-draft-review.test.mjs apps/api/src/server.js packages/core/src/index.d.ts
git commit -m "feat: centralize server-owned AI context"
```

### Task 5: Structured Generation Results in the Web Workbench

**Files:**
- Modify: `apps/api/src/server.js`
- Modify: `packages/core/src/index.d.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `scripts/web-generation-workbench-ui.test.mjs`
- Modify: `docs/14-api-contract.md`
- Modify: `docs/44-miniprogram-migration-runbook.md`

**Interfaces:**
- Extend `AssignmentCard` with `gradingSource` and a teacher-only `generationContextSummary`.
- `generationContextSummary` is `{ basis, target, textbook, knowledgePoints, contentContext: { status, sourceCount, sourceIds }, studentSignalCount, reviewRequired }` and never includes raw chunks or prompts.
- `draftAssessment()` returns `parsedDraft`, `draftItems`, `audit`, `generationPipeline`, `generationContext`, and `contentContext` only through the teacher-authenticated API path; `mapAssignment()` returns the bounded summary to Web.
- Keep `createAssessmentGenerationJob`, `listAssessmentGenerationJobs`, `cancelAssessmentGenerationJob`, `reviewAssessmentDraft`, and `exportAssessmentPrint` as the only Web actions for the existing asynchronous flow.

- [ ] **Step 1: Add failing Web contract assertions**

Extend `scripts/web-generation-workbench-ui.test.mjs` to require the Web source to:

```js
assert.match(apiSource, /generationContextSummary/);
assert.match(apiSource, /gradingSource/);
assert.match(mainSource, /generationContextSummary/);
assert.match(mainSource, /draftReviewStatus/);
assert.match(mainSource, /layoutValidation/);
assert.match(mainSource, /generationBasis/);
assert.doesNotMatch(mainSource, /system.*prompt|provider.*model.*student/i);
```

Add an assertion that the final export action is disabled when `layoutValidation?.ok !== true`, the review status is not accepted, or the selected context does not match the draft request.

- [ ] **Step 2: Run the Web contract test and verify the new result fields are missing**

```powershell
cmd /c node scripts\web-generation-workbench-ui.test.mjs
```

Expected: FAIL until the API mapping and TypeScript response types are extended.

- [ ] **Step 3: Add bounded assignment and API result types**

In `apps/api/src/server.js`, derive `generationContextSummary` from the persisted `generationContext` and `contentContext`. Expose source IDs, counts, textbook title/chapter, knowledge points, target, basis, student signal count, and review requirement. Use the existing `gradingSourceReference(gradingSourcePackageForAssignment(assignment))` for the answer package identity and fingerprint.

In `apps/web/src/api.ts`, replace the narrow `draftAssessment()` result type with named types for `AssessmentGenerationResult`, `GenerationContextSummary`, and `GradingSourceReference`. Preserve the current `normalizeDisplayPayload()` boundary and do not type internal raw/model fields as browser data.

- [ ] **Step 4: Complete the generation workbench state flow**

In `apps/web/src/main.tsx`:

- Keep `AssessmentRequestInput` limited to teacher business fields and add no prompt or model fields.
- Show selected textbook/章节, approval status, content source count, student signal count, generation basis, and the resulting context summary next to the generation controls.
- Show the asynchronous job status near the action, including queued, generating, exporting draft, ready for review, failed, and cancelled.
- Show the structured draft audit, answer package reference, layout validation, and teacher review status before enabling final export.
- Keep rejection feedback as the only input to the existing regenerate action; the page must not synthesize a second prompt template.
- Pass `generationContextSummary` and `gradingSource` into the teacher history card so the teacher can distinguish textbook-based, student-based, and emergency drafts.

Use existing icons and styles in `apps/web/src/styles.css`; add only the status layout needed for the context summary and review gate.

- [ ] **Step 5: Update the API contract and Mini Program reuse note**

Document the teacher-only `generationContextSummary`, `gradingSource`, asynchronous job states, and the final export gate in `docs/14-api-contract.md`. In `docs/44-miniprogram-migration-runbook.md`, state that a future Mini Program page submits the same business request and consumes the same job, summary, review, and export fields; it must not recreate context assembly or answer package logic.

- [ ] **Step 6: Run Web and generation checks, then commit**

```powershell
cmd /c node scripts\web-generation-workbench-ui.test.mjs
cmd /c npm.cmd run typecheck --workspace apps/web
cmd /c npm.cmd run check:generation:blueprint
cmd /c npm.cmd run check:api
cmd /c npm.cmd run check:encoding
git add -- apps/api/src/server.js packages/core/src/index.d.ts apps/web/src/api.ts apps/web/src/main.tsx apps/web/src/styles.css scripts/web-generation-workbench-ui.test.mjs docs/14-api-contract.md docs/44-miniprogram-migration-runbook.md
git commit -m "feat: align web generation workbench with structured drafts"
```

## Phase 3: Grading, Teacher Review, and Student Profile Evidence

### Task 6: Unified Grading Context and Workbench State

**Files:**
- Modify: `packages/services/src/context-engineering.js`
- Modify: `packages/services/src/context-engineering.test.mjs`
- Modify: `packages/services/src/index.js`
- Modify: `apps/api/src/server.js`
- Modify: `apps/api/src/grading-source-package-contract.test.mjs`
- Modify: `apps/api/src/external-workbook-grading-routes.test.mjs`
- Modify: `apps/api/src/external-grading-recognition.test.mjs`
- Modify: `packages/services/src/deterministic-grading.test.mjs`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `scripts/web-grading-workbench-ui.test.mjs`

**Interfaces:**
- `buildSubmissionGradingContext(input, options)` returns `{ gradingInput, unresolvedQuestionNos, evidence, policy }`.
- `gradingInput` always contains `gradingSourcePackage` when a valid generated assignment source exists, otherwise `referenceAnswers` and `referenceAnswerMode` with the external-material mode.
- `mapGradingWorkbench(submission)` returns `workflowState`, `archiveBlockers`, `quality`, `answerSource`, `questionLayoutManifest`, `pages`, and `questions` with no raw model/provider fields.
- `archiveSubmissionReview()` remains the only transition that can set a submission to `GRADED`, `archiveEligible: true`, and create reviewed mistake records.

- [ ] **Step 1: Add failing context and workbench assertions**

Add tests for both paths:

```js
test("generated assignment grading uses the validated source package first", () => {
  const result = buildSubmissionGradingContext({
    assignmentId: "assignment_1",
    materialType: "generated_assessment",
    gradingSourcePackage: {
      schemaVersion: "junhang-grading-source-v1",
      sourceId: "assignment_1",
      fingerprint: "fp_1",
      questions: [{ questionNo: "1", prompt: "1+1=", correctAnswer: "2", maxScore: 5 }]
    },
    ocrQuestions: [{ questionNo: "1", printedPrompt: "1+1=", studentAnswer: "2", confidence: 0.98 }]
  }, { questionLayoutManifest: { questions: [] }, deepAuditRequired: false });
  assert.equal(result.evidence.answerSource, "gradingSourcePackage");
  assert.deepEqual(result.unresolvedQuestionNos, []);
});

test("external grading with missing answer evidence stays review required", () => {
  const result = buildSubmissionGradingContext({ materialType: "external_workbook", ocrQuestions: [] }, {});
  assert.equal(result.policy.teacherConfirmBeforeArchive, true);
  assert.equal(result.evidence.answerSource, "missing");
  assert.equal(result.workflowState, "review_required");
});
```

Extend the existing API contract tests to assert the authoritative package and question layout manifest are both passed to the grading service.

- [ ] **Step 2: Run focused grading tests and verify the new context contract fails**

```powershell
cmd /c node --test packages\services\src\context-engineering.test.mjs packages\services\src\deterministic-grading.test.mjs apps\api\src\grading-source-package-contract.test.mjs apps\api\src\external-grading-recognition.test.mjs
```

Expected: FAIL for the new `workflowState` and `buildSubmissionGradingContext` assertions before implementation.

- [ ] **Step 3: Implement the grading context builder and use it in `gradeSubmissionService()`**

Build the service input in this order:

1. Read and validate `gradingSourcePackage` from the generated assignment.
2. Enrich OCR with page quality, stable page order, printed prompt, student answer, and bounding boxes.
3. Generate a reference answer only when there is no usable teacher answer or generated source package.
4. Resolve explicit objective questions locally and send only unresolved questions to Terra.
5. Permit one Sol escalation only when evidence is sufficient and the failure class is availability or quality.
6. Recompute the total score from question results and preserve `needsTeacherReview` for every unresolved, low-confidence, conflicting, or evidence-insufficient item.

Set `workflowState` to `draft` for an available structured result, `review_required` for low confidence or missing evidence, `blocked` for invalid source/image/permission state, and `failed` for an unsuccessful processing task. Never set `archiveEligible` from model output alone.

- [ ] **Step 4: Enforce generated and external boundaries in the API**

In `buildSubmissionGradeInputFromRecord()` and `recognizeAndGradeSubmissionRecord()`:

- Resolve `gradingSourcePackageForAssignment(assignment)` and validate its fingerprint before adding it to the grading input.
- Keep external `externalGradingRecognition`, `answerSource`, and `archiveBlockers` separate from generated assignment source fields.
- Preserve the existing `questionLayoutManifest` source reference and question map.
- Keep image quality, OCR, printed prompt, student answer, and teacher corrections as separate fields.
- Return the new `workflowState` from `mapReviewSubmission()` and `mapGradingWorkbench()` while hiding `raw`, `provider`, `model`, `attempts`, and escalation metadata.

Do not alter the existing `archiveSubmissionReview()` gate to accept an unreviewed score, a low-confidence score, an uncertain question, a missing answer source, or an incomplete question set.

- [ ] **Step 5: Align the Web grading workbench**

Extend the `GradingWorkbench` type in `apps/web/src/api.ts`. In `apps/web/src/main.tsx`, render the workflow state at the top of the workbench, then keep the existing image/page selector and question inspector. Display, in separate rows, image quality, OCR status, printed prompt, student answer, answer source, reference confidence, current score, and archive blockers. Disable archive while any question is unresolved, any page is poor, the answer source is missing, or `archiveEligible` is false.

Keep teacher corrections as explicit calls to `patchGradingWorkbenchQuestion()`, answer source confirmation as `confirmGradingAnswerSource()`, and final archiving as `archiveGradingWorkbench()` or the existing reviewed-submission action.

- [ ] **Step 6: Extend static UI and run grading verification**

Add assertions to `scripts/web-grading-workbench-ui.test.mjs` for `workflowState`, `archiveBlockers`, `answerSource`, `questionLayoutManifest`, the four question statuses, and disabled archive behavior. Then run:

```powershell
cmd /c node scripts\web-grading-workbench-ui.test.mjs
cmd /c node --test packages\services\src\context-engineering.test.mjs packages\services\src\deterministic-grading.test.mjs apps\api\src\grading-source-package-contract.test.mjs apps\api\src\external-workbook-grading-routes.test.mjs apps\api\src\external-grading-recognition.test.mjs
cmd /c npm.cmd run check:api
cmd /c npm.cmd run typecheck --workspace apps/web
cmd /c npm.cmd run check:encoding
```

- [ ] **Step 7: Commit the grading workbench boundary**

```powershell
git add -- packages/services/src/context-engineering.js packages/services/src/context-engineering.test.mjs packages/services/src/index.js apps/api/src/server.js apps/api/src/grading-source-package-contract.test.mjs apps/api/src/external-workbook-grading-routes.test.mjs apps/api/src/external-grading-recognition.test.mjs packages/services/src/deterministic-grading.test.mjs apps/web/src/api.ts apps/web/src/main.tsx scripts/web-grading-workbench-ui.test.mjs
git commit -m "feat: align grading workbench with reviewed evidence"
```

### Task 7: Profile Evidence and Teacher Publish Gate

**Files:**
- Create: `apps/api/src/student-profile-publish-gate.js`
- Create: `apps/api/src/student-profile-publish-gate.test.mjs`
- Modify: `apps/api/src/student-growth-profile.js`
- Modify: `apps/api/src/student-growth-profile.test.mjs`
- Modify: `packages/services/src/context-engineering.js`
- Modify: `packages/services/src/context-engineering.test.mjs`
- Modify: `packages/ai/src/runtime.js`
- Modify: `packages/ai/src/runtime-prompt.test.mjs`
- Modify: `apps/api/src/server.js`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `docs/14-api-contract.md`

**Interfaces:**
- Add `evaluateStudentProfilePublish(snapshot)` returning `{ ok: boolean; blockers: string[]; excludedEvidenceRefs: string[] }`.
- Add `markStudentProfileTeacherConfirmation(snapshot, teacherId, now)` returning a new snapshot with `teacherReview.status = "confirmed"`, `confirmedByTeacherId`, and `confirmedAt`.
- `buildStudentProfileContext()` sends only eligible evidence plus minimal `blockedEvidence` reason summaries to the profile model.

- [ ] **Step 1: Write failing publish-gate tests**

```js
test("unreviewed grading and low-confidence evidence block public profile publishing", () => {
  const result = evaluateStudentProfilePublish({
    draftStatus: "draft",
    teacherReview: { status: "pending", pendingConfirmations: [{ title: "第2题", reason: "低置信" }] },
    profileEvidencePack: {
      submissions: [{ id: "sub_1", archiveEligible: false, needsTeacherReview: true }],
      blockedEvidence: [{ sourceId: "sub_1", reason: "low_confidence" }]
    },
    publishedView: { overview: { text: "不可直接发布" } }
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes("TEACHER_CONFIRMATION_REQUIRED"));
  assert.deepEqual(result.excludedEvidenceRefs, ["sub_1"]);
});

test("teacher confirmation records identity and time without exposing evidence to students", () => {
  const snapshot = { teacherReview: { status: "pending" }, profileEvidencePack: { blockedEvidence: [] } };
  const confirmed = markStudentProfileTeacherConfirmation(snapshot, "teacher_1", "2026-09-07T10:00:00.000Z");
  assert.equal(confirmed.teacherReview.status, "confirmed");
  assert.equal(confirmed.teacherReview.confirmedByTeacherId, "teacher_1");
  assert.equal(confirmed.teacherReview.confirmedAt, "2026-09-07T10:00:00.000Z");
});
```

- [ ] **Step 2: Run the profile tests and verify the gate is missing**

```powershell
cmd /c node --test apps\api\src\student-profile-publish-gate.test.mjs apps\api\src\student-growth-profile.test.mjs
```

Expected: FAIL because the publish-gate module does not exist and the current profile flow does not return the new gate result.

- [ ] **Step 3: Implement evidence priority and blocked evidence handling**

Refine `buildProfileEvidencePack()` so the public-eligible evidence order is:

1. Teacher-confirmed grading and mistake records.
2. Teacher-confirmed tasks and classroom observations.
3. Confirmed non-QA learning records.
4. Eligible `qa-learning-signal-v1` records as supporting evidence only.

Exclude low-confidence OCR, unconfirmed scores, unresolved questions, provisional grading, teacher tests, anonymous/identity-unconfirmed QA, unsafe or unavailable QA, invalid dates, and legacy QA from public evidence. Preserve only a minimal `blockedEvidence` entry with source reference and reason for teacher review. A single QA source cannot increase mastery or score; repeated QA signals remain supporting evidence and conflicts create teacher notes.

- [ ] **Step 4: Build the profile model context and strengthen the prompt contract**

In `buildStudentProfileContext()`, provide the period, profile type, eligible evidence summaries, evidence coverage, sample limits, and teacher observations. In `draftStudentProfileNarrative()` in `packages/ai/src/runtime.js`, require strict JSON with `profileType`, `period`, `publishedView`, and `teacherReview`, require `evidenceRefs` and `confidence` on every visible conclusion, and explicitly prohibit model/provider/raw/prompt fields.

Update `packages/ai/src/runtime-prompt.test.mjs` to assert `profileEvidencePack`, `teacherReview`, `evidenceRefs`, `confidence`, and the no-strong-conclusion rule appear in the profile prompt. Keep the profile task at Terra `low`; no Sol escalation is allowed for the profile narrative task.

- [ ] **Step 5: Enforce the gate in profile routes**

In `/api/students/:studentId/profile/draft` and `/aggregate`, return a teacher-only `publishGate` alongside the filtered teacher snapshot. In `/publish`, reconstruct the server evidence snapshot, merge only allowed teacher edits, call `evaluateStudentProfilePublish()`, and return `409 PROFILE_TEACHER_CONFIRMATION_REQUIRED` with `blockers` when the gate fails. On success call `markStudentProfileTeacherConfirmation()` before persistence and return a teacher-filtered snapshot.

Keep `/api/students/:studentId/profile` role-filtered: teacher receives `teacherReview`, `profileEvidencePack`, and `publishGate`; student receives only the confirmed `publishedView`, period, status, and permitted narrative fields. Keep term reports teacher-only until `mark-sent` and preserve manual parent delivery.

- [ ] **Step 6: Align the Web profile review surface**

Extend the profile API types with `publishGate`, `blockedEvidence`, evidence coverage, and teacher confirmation fields. In `apps/web/src/main.tsx`, show the profile source coverage and pending confirmations in the teacher draft panel, disable publishing while the gate is blocked, and show the exact blocked reason returned by the service. Keep the student archive read-only and render only the server-filtered `publishedView`.

- [ ] **Step 7: Run profile and cross-layer checks, then commit**

```powershell
cmd /c node --test apps\api\src\student-profile-publish-gate.test.mjs apps\api\src\student-growth-profile.test.mjs packages\services\src\context-engineering.test.mjs packages\ai\src\runtime-prompt.test.mjs
cmd /c npm.cmd run check:api
cmd /c npm.cmd run typecheck --workspace apps/web
cmd /c npm.cmd run check:encoding
git add -- apps/api/src/student-profile-publish-gate.js apps/api/src/student-profile-publish-gate.test.mjs apps/api/src/student-growth-profile.js apps/api/src/student-growth-profile.test.mjs packages/services/src/context-engineering.js packages/services/src/context-engineering.test.mjs packages/ai/src/runtime.js packages/ai/src/runtime-prompt.test.mjs apps/api/src/server.js apps/web/src/api.ts apps/web/src/main.tsx docs/14-api-contract.md
git commit -m "feat: gate student profiles on reviewed evidence"
```

## Phase 4: Resource Library, Unified Model Policy, and Quality Loop

### Task 8: Resource Library Context Preview and Approval Gate

**Files:**
- Modify: `apps/api/src/approved-content-context.js`
- Modify: `apps/api/src/approved-content-context.test.mjs`
- Modify: `apps/api/src/server.js`
- Modify: `packages/services/src/index.js`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `scripts/content-upload-ui-contract.mjs`
- Modify: `scripts/content-context-e2e.mjs`
- Modify: `scripts/content-context-e2e.test.mjs`
- Modify: `docs/43-content-index-ui-runbook.md`
- Modify: `docs/44-miniprogram-migration-runbook.md`
- Modify: `skills/teaching-materials/SKILLS.md`

**Interfaces:**
- Add `summarizeApprovedAssessmentContentContext(contentContext)` returning `{ status, reason, textbookContext, sourceCount, sourceIds, matches }` with bounded metadata and no raw chunks.
- Add teacher-only `POST /api/content/context/preview`; request accepts the same business fields as an assessment request and response returns `{ ok, context }`.
- Add `previewAssessmentContentContext(input)` in `apps/web/src/api.ts`.

- [ ] **Step 1: Write failing context preview tests**

Cover approved, pending, protected, mismatched, and missing content cases:

```js
test("context preview exposes source metadata but never raw chunks", () => {
  const result = summarizeApprovedAssessmentContentContext({
    status: "approved",
    textbookContext: { resolved: true, assetId: "tb_1", chapterId: "ch_1", chapterTitle: "分数加减" },
    matches: [{ sourceId: "src_1", title: "五年级数学单元资料", summary: "分数加减", chunkCount: 3, chunks: ["private markdown"] }]
  });
  assert.equal(result.status, "approved");
  assert.deepEqual(result.sourceIds, ["src_1"]);
  assert.equal("chunks" in result.matches[0], false);
});
```

Add API source assertions that `.edupdf` returns `PROTECTED_TEXTBOOK_NOT_ALLOWED`, an unapproved source returns `ASSESSMENT_CONTENT_CONTEXT_REQUIRED`, and a valid preview does not include `markdown`, `chunks`, `absolutePath`, or database fields.

- [ ] **Step 2: Run focused content tests and verify the preview contract is missing**

```powershell
cmd /c node --test apps\api\src\approved-content-context.test.mjs scripts\content-context-e2e.test.mjs
```

Expected: FAIL because the summary helper and preview route are not present.

- [ ] **Step 3: Implement bounded content context summarization**

Use the existing `resolveApprovedAssessmentContentContext(prisma, input)` and `validateAssessmentContentContext(input, contentContext)` as the only source of approval truth. `summarizeApprovedAssessmentContentContext()` may return source IDs, titles, subject, grade, edition, chapter, knowledge points, review status, allowed-for-generation state, chunk count, and short excerpts. It must remove raw Markdown chunks, absolute paths, upload names that expose local paths, and unbounded source metadata.

- [ ] **Step 4: Add the preview route and preserve generation preflight**

Add the teacher-only route before the generation routes:

```js
app.post("/api/content/context/preview", requireDatabase, requireSession(config, ["teacher"]), asyncRoute(async (req, res) => {
  const input = assessmentDraftInputFromRequest(req);
  const context = await resolveApprovedAssessmentContentContext(prisma, input);
  const validation = validateAssessmentContentContext(input, context);
  if (!validation.ok) {
    return res.status(422).json({ ok: false, ...assessmentContentContextFailure(context, validation) });
  }
  res.json({ ok: true, context: summarizeApprovedAssessmentContentContext(context) });
}));
```

Keep `prepareAssessmentDraftInput()` as the final gate immediately before model invocation. Preview is advisory for the page; it cannot authorize an unapproved source or override the final server check.

- [ ] **Step 5: Align the resource and generation panels**

Add `previewAssessmentContentContext()` and types to `apps/web/src/api.ts`. In `apps/web/src/main.tsx`, call the preview when the teacher changes textbook/chapter/scope, display source count, review state, matching chapter and generation eligibility, and disable textbook-based generation while the preview is blocked. Keep upload, conversion, index rebuild, sync, and review actions on their existing API wrappers. Do not display full Markdown chunks in Web.

- [ ] **Step 6: Extend content checks and migration documentation**

Update `scripts/content-upload-ui-contract.mjs` for the preview wrapper and blocked state. Update `scripts/content-context-e2e.mjs` to assert preview, source approval, generation context injection, draft review, and export gates while keeping the low-budget run labeled `link-guard`. Document the same request/response fields for future Mini Program use in `docs/44-miniprogram-migration-runbook.md` and the source lifecycle in `docs/43-content-index-ui-runbook.md`.

- [ ] **Step 7: Run content checks and commit**

```powershell
cmd /c node --test apps\api\src\approved-content-context.test.mjs scripts\content-context-e2e.test.mjs
cmd /c npm.cmd run check:content-upload-ui
cmd /c npm.cmd run check:content-context
cmd /c npm.cmd run check:api
cmd /c npm.cmd run typecheck --workspace apps/web
cmd /c npm.cmd run check:encoding
git add -- apps/api/src/approved-content-context.js apps/api/src/approved-content-context.test.mjs apps/api/src/server.js packages/services/src/index.js apps/web/src/api.ts apps/web/src/main.tsx scripts/content-upload-ui-contract.mjs scripts/content-context-e2e.mjs scripts/content-context-e2e.test.mjs docs/43-content-index-ui-runbook.md docs/44-miniprogram-migration-runbook.md skills/teaching-materials/SKILLS.md
git commit -m "feat: add approved content context preview"
```

### Task 9: Unified Task Model Policy and Failure Classification

**Files:**
- Create: `packages/ai/src/model-policy.js`
- Create: `packages/ai/src/model-policy.test.mjs`
- Modify: `packages/ai/src/runtime.js`
- Modify: `packages/ai/src/index.js`
- Modify: `packages/ai/src/index.d.ts`
- Modify: `packages/ai/src/assessment-runtime.test.mjs`
- Modify: `packages/ai/src/model-escalation.test.mjs`
- Modify: `packages/ai/src/gpt56-runtime.test.mjs`
- Modify: `packages/services/src/index.js`
- Modify: `packages/services/src/context-engineering.js`
- Modify: `docs/41-prompt-context-engineering-playbook.md`
- Modify: `docs/14-api-contract.md`

**Interfaces:**
- Add `resolveTaskModelPolicy(task, config, input)` with task values `qa`, `task-draft`, `assessment-draft`, `reference-answer`, `submission-grading`, `student-profile`, `ocr`, `speech`, and `emergency-text`.
- Add `classifyTaskFailure(error, context)` returning `{ triggerClass: "availability" | "quality" | "configuration" | "evidence"; allowedToEscalate: boolean; code: string }`.
- Existing `draftAssessment`, `generateSubmissionReferenceAnswers`, `gradeSubmissionText`, and `draftStudentProfileNarrative` must consume this policy while preserving their current injected-runner test options.

- [ ] **Step 1: Write failing policy matrix tests**

```js
test("assessment and grading use Terra defaults with one bounded Sol escalation", () => {
  const assessment = resolveTaskModelPolicy("assessment-draft", {}, { kind: "小测" });
  const formal = resolveTaskModelPolicy("assessment-draft", {}, { kind: "试卷" });
  const grading = resolveTaskModelPolicy("submission-grading", {}, {});
  assert.equal(assessment.primary.reasoningEffort, "medium");
  assert.equal(formal.primary.reasoningEffort, "high");
  assert.equal(grading.primary.reasoningEffort, "high");
  assert.equal(assessment.escalation.maxAttemptsPerUnit, 1);
  assert.deepEqual(assessment.escalation.blockedTriggerClasses, ["configuration", "evidence"]);
});

test("QA never escalates and evidence failure cannot call Sol", () => {
  const qa = resolveTaskModelPolicy("qa", {}, {});
  const evidence = classifyTaskFailure({ code: "REFERENCE_EVIDENCE_MISSING" }, { evidenceSufficient: false });
  assert.equal(qa.escalation.enabled, false);
  assert.equal(evidence.triggerClass, "evidence");
  assert.equal(evidence.allowedToEscalate, false);
});
```

Add tests for configuration errors, availability errors, malformed JSON quality errors, and explicit DeepSeek emergency mode. Assert that no policy permits Sol after Sol or a third text model.

- [ ] **Step 2: Run the policy tests and verify they fail**

```powershell
cmd /c node --test packages\ai\src\model-policy.test.mjs packages\ai\src\model-escalation.test.mjs
```

Expected: FAIL because the policy module and shared classifier do not exist.

- [ ] **Step 3: Implement the task policy table**

Implement these concrete defaults:

| Task | Primary | Reasoning | Budget | Escalation |
| --- | --- | --- | --- | --- |
| `qa` | GPT-5.6 Terra | `low` | one call | none |
| `task-draft` | GPT-5.6 Terra | `low` | existing task budget | teacher review on structure failure |
| `assessment-draft` quiz/practice | GPT-5.6 Terra | `medium` | 120s/16000 or 150s/16000 | one Sol `high` per failed partition |
| `assessment-draft` formal/personalized | GPT-5.6 Terra | `high` | 240s/24000 | one Sol `high` per failed partition |
| `reference-answer` | GPT-5.6 Terra | `high` | 180s/12000 local escalation budget | one Sol `high` only with evidence |
| `submission-grading` | GPT-5.6 Terra | `high` | 180s/12000 local escalation budget | one Sol `high` per eligible question |
| `student-profile` | GPT-5.6 Terra | `low` | existing profile timeout | no Sol |
| `ocr` | MiniMax vision | provider default | existing OCR budget | teacher review on failure |
| `speech` | MiniMax speech | provider default | existing speech budget | teacher review on failure |
| `emergency-text` | DeepSeek | explicit caller policy | caller budget | disabled by default |

`classifyTaskFailure()` must classify timeout, 524, short rate limiting, and network interruption as availability; malformed/structurally invalid but evidence-sufficient JSON as quality; credentials, unsupported model/parameter, and configuration as configuration; missing approved materials, unreadable OCR, missing prompt, or missing student answer as evidence. Only availability and evidence-sufficient quality return `allowedToEscalate: true`.

- [ ] **Step 4: Route existing runtime functions through the policy**

Replace duplicated reasoning and Sol eligibility decisions in `packages/ai/src/runtime.js` with `resolveTaskModelPolicy()` and `classifyTaskFailure()`. Preserve the current public response shapes and internal metadata fields. Preserve `disableSolEscalation`, `evidenceSufficient`, `model`, `reasoningEffort`, `timeoutMs`, `signal`, and injected runners as test controls. Keep `usedModelEscalation` distinct from `usedDynamicFallback`.

Update `buildModelOrchestrationPlan()` to include task policy summaries and failure classes for teacher/internal diagnostics, then ensure the API mapping still removes those internals from non-teacher responses.

- [ ] **Step 5: Run the complete policy regression set**

```powershell
cmd /c node --test packages\ai\src\model-policy.test.mjs packages\ai\src\model-escalation.test.mjs packages\ai\src\assessment-runtime.test.mjs packages\ai\src\gpt56-runtime.test.mjs
cmd /c npm.cmd run check:gpt56
cmd /c npm.cmd run check:api
cmd /c npm.cmd run check:encoding
```

- [ ] **Step 6: Update the prompt/context playbook and commit**

Add the policy function names, task matrix, failure classification, one-attempt rule, hidden metadata boundary, and `generationContext`/grading/profile context requirements to `docs/41-prompt-context-engineering-playbook.md` and the API contract. Then commit explicit paths:

```powershell
git add -- packages/ai/src/model-policy.js packages/ai/src/model-policy.test.mjs packages/ai/src/runtime.js packages/ai/src/index.js packages/ai/src/index.d.ts packages/ai/src/assessment-runtime.test.mjs packages/ai/src/model-escalation.test.mjs packages/ai/src/gpt56-runtime.test.mjs packages/services/src/index.js packages/services/src/context-engineering.js docs/41-prompt-context-engineering-playbook.md docs/14-api-contract.md
git commit -m "feat: unify task model policy"
```

### Task 10: Teacher Gold Quality Loop

**Files:**
- Create: `scripts/quality-gold-contract.mjs`
- Create: `scripts/quality-gold-contract.test.mjs`
- Create: `fixtures/quality/grading-gold-cases.example.json`
- Modify: `scripts/grading-quality-check.mjs`
- Modify: `scripts/grading-quality-check.test.mjs`
- Modify: `scripts/generation-quality-check.mjs`
- Modify: `scripts/generation-quality-check.test.mjs`
- Modify: `skills/generation/SKILLS.md`
- Modify: `skills/grading/SKILLS.md`
- Modify: `docs/43-content-index-ui-runbook.md`

**Interfaces:**
- `validateGradingGoldCases(cases)` returns `{ ok: boolean; issues: string[]; normalizedCases: object[] }`.
- `evaluateGradingCases(cases)` keeps schema `grading-quality-v1` and adds `evidenceBoundary`, `teacherConfirmedCaseCount`, and `productionAccuracyClaim: false` unless an explicit teacher-reviewed report is supplied.
- `buildGenerationQualityVerification(mode)` continues to reject dynamic fallback and continues to distinguish content quality from PDF layout and link-guard checks.

- [ ] **Step 1: Define and test the teacher gold schema**

The schema must require `caseId`, `sourceType`, `input`, `expected`, and `teacherReview`. `teacherReview` must contain `confirmedBy`, `confirmedAt`, and `modifiedQuestionNos`; every expected question must contain `questionNo`, `status`, and a teacher-confirmed answer or reason for `uncertain`.

Use `fixtures/quality/grading-gold-cases.example.json` with synthetic content only:

```json
[
  {
    "caseId": "synthetic-generated-1",
    "sourceType": "generated_assessment",
    "input": {
      "subject": "数学",
      "kind": "练习",
      "questionLayoutManifest": { "questions": [{ "questionNo": "1", "prompt": "1+1=", "correctAnswer": "2", "maxScore": 5 }] },
      "ocrQuestions": [{ "questionNo": "1", "printedPrompt": "1+1=", "studentAnswer": "2", "confidence": 0.98 }]
    },
    "expected": {
      "score": 5,
      "needsTeacherReview": false,
      "questionResults": [{ "questionNo": "1", "status": "correct", "studentAnswer": "2", "correctAnswer": "2", "confidence": 0.98 }]
    },
    "teacherReview": {
      "confirmedBy": "synthetic-teacher",
      "confirmedAt": "2026-09-07T00:00:00.000Z",
      "modifiedQuestionNos": []
    }
  }
]
```

- [ ] **Step 2: Run the gold contract test and verify it fails**

```powershell
cmd /c node --test scripts\quality-gold-contract.test.mjs
```

Expected: FAIL because the validator module does not exist.

- [ ] **Step 3: Implement schema validation and evidence-safe metrics**

Implement `validateGradingGoldCases()` to reject missing teacher identity/time, duplicate case IDs, absent expected question results, invalid statuses, missing uncertain reasons, and cases whose `teacherReview.confirmedAt` is not a valid ISO date. Modify `scripts/grading-quality-check.mjs` so the CLI validates before calculating metrics and emits a clear `GOLD_CASES_INVALID` error without running model calls.

Keep the existing metric definitions for question accuracy, status agreement, score mean absolute error, low-confidence recall, unsafe high-confidence errors, and teacher modification rate. Add the counts needed to tell apart teacher-confirmed cases from synthetic examples. Never print a production-accuracy claim from Sol availability, generation quality, or a link-guard E2E result.

- [ ] **Step 4: Add profile evidence and generation quality boundaries**

Update `scripts/generation-quality-check.mjs` and its tests to assert `modelAvailable === true`, `usedDynamicFallback === false`, the expected generation profile, and the separation from PDF layout. Update the generation and grading Skills to name the gold command and state that no gold file means grading accuracy is unverified. Keep `check:generation:quality:quiz`, `check:generation:quality:formal`, and `check:generation:quality:sol` as explicit quality samples; keep `check:content-context` as a link guard.

- [ ] **Step 5: Run the quality checks and record the boundary**

```powershell
cmd /c node --test scripts\quality-gold-contract.test.mjs scripts\grading-quality-check.test.mjs scripts\generation-quality-check.test.mjs
cmd /c npm.cmd run check:grading:quality -- fixtures\quality\grading-gold-cases.example.json
cmd /c npm.cmd run check:generation:blueprint
cmd /c npm.cmd run check:encoding
```

The synthetic example proves the schema and metric path only. A real teacher-confirmed gold file must be supplied separately before any production accuracy conclusion; the implementation must preserve that limitation in its report fields and documentation.

- [ ] **Step 6: Commit the quality entry point**

```powershell
git add -- scripts/quality-gold-contract.mjs scripts/quality-gold-contract.test.mjs fixtures/quality/grading-gold-cases.example.json scripts/grading-quality-check.mjs scripts/grading-quality-check.test.mjs scripts/generation-quality-check.mjs scripts/generation-quality-check.test.mjs skills/generation/SKILLS.md skills/grading/SKILLS.md docs/43-content-index-ui-runbook.md
git commit -m "test: add teacher gold quality contract"
```

## Phase Gates and Final Verification

Each phase is complete only when its code, tests, documentation, and explicit commit are present.

### Phase 1 gate

- `moduleCapabilityCatalog` validates with four unique module IDs and fixed dependency order.
- `check:skills` validates the root route table, four playbook contracts, all wrappers, and exact verification commands.
- `GET /api/ai/status` returns teacher-safe capability status and student/classroom paths do not receive it.
- `check:encoding`, `check:api`, and the focused core/services tests pass.

### Phase 2 gate

- Assessment input is server-owned after request allowlisting; client-supplied context cannot authorize generation.
- Generation result includes structured draft, audit, generation context summary, layout state, review state, and answer package reference.
- Web shows context evidence and asynchronous status, disables formal export until review/layout gates pass, and does not assemble prompts.
- `check:generation:blueprint`, `check:content-context`, `check:api`, `typecheck --workspace apps/web`, and the generation UI contract pass.

### Phase 3 gate

- Generated grading reads the validated answer package before PDF/OCR guesses; external grading stays in its own reference-answer path.
- Workbench shows OCR/image quality, source evidence, confidence, question status, teacher edits, and archive blockers.
- Only teacher-confirmed grading can create reviewed mistake records and eligible profile evidence.
- Profile drafts include evidence coverage and blocked sources; publish requires teacher confirmation; students see only filtered published views.
- Grading/profile focused tests, `check:api`, and Web typecheck pass.

### Phase 4 gate

- Resource preview, index, source review, textbook scope, and generation context use one server-side approval path.
- Model policy and failure classification are tested for QA, generation, reference answers, grading, profile, OCR, speech, Sol, and emergency rollback.
- Quality commands distinguish real-model content quality, link-guard chain closure, PDF layout, and teacher-confirmed grading accuracy.
- No production grading accuracy claim is made without a real teacher-confirmed gold file.

### Final verification sequence

Run the following after the last phase, using Windows-safe commands and keeping each output bounded:

```powershell
cmd /c node --test packages\core\src\module-capability-registry.test.mjs packages\services\src\module-capability-status.test.mjs packages\services\src\context-engineering.test.mjs packages\ai\src\model-policy.test.mjs
cmd /c node --test apps\api\src\student-profile-publish-gate.test.mjs apps\api\src\student-growth-profile.test.mjs apps\api\src\approved-content-context.test.mjs
cmd /c node scripts\web-generation-workbench-ui.test.mjs
cmd /c node scripts\web-grading-workbench-ui.test.mjs
cmd /c npm.cmd run check:skills
cmd /c npm.cmd run check:api
cmd /c npm.cmd run check:generation:blueprint
cmd /c npm.cmd run check:content-upload-ui
cmd /c npm.cmd run check:content-context
cmd /c npm.cmd run typecheck --workspace apps/web
cmd /c npm.cmd run check:miniprogram-js
cmd /c npm.cmd run check:encoding
cmd /c npm.cmd run workspace:guard
```

Run `cmd /c npm.cmd run check:teaching-content:full` only after the focused checks pass and only as the release/link-closure gate. Run the real-model quality commands separately because they measure different properties:

```powershell
cmd /c npm.cmd run check:generation:quality:quiz
cmd /c npm.cmd run check:generation:quality:formal
cmd /c npm.cmd run check:generation:quality:sol
cmd /c npm.cmd run check:grading:quality -- fixtures\quality\grading-gold-cases.example.json
```

The final report must list the exact passing commands, model availability, whether dynamic fallback occurred, whether a teacher gold file was present, and the remaining dirty worktree files from before this plan. It must not stage, delete, restore, or rewrite the existing batch of grading changes.
