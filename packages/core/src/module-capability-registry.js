export const MODULE_CAPABILITY_SCHEMA_VERSION = "junhang-module-capability-v1";

const EXPECTED_MODULE_IDS = ["generation", "grading", "teaching-materials", "student-profile"];
const EXPECTED_REVIEW_GATES = {
  generation: "teacher_review",
  grading: "teacher_confirmation",
  "teaching-materials": "teacher_review",
  "student-profile": "teacher_confirmation"
};

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
      primaryTask: "generation",
      primaryRoute: "gpt-6-astra",
      supportRoutes: ["gpt-5.6-sol-availability-replacement", "primary-quality-repair", "local-structured-validation"],
      defaultReasoning: { quiz: "high", practice: "high", formal: "high" },
      escalation: {
        allowedTriggerClasses: ["availability"],
        blockedTriggerClasses: ["configuration", "evidence", "quality"],
        maxAttemptsPerUnit: 1
      }
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
      primaryTask: "grading",
      primaryRoute: "gpt-6-astra",
      supportRoutes: ["minimax-ocr", "deepseek-flash-ocr-opt-in", "local-objective-comparison", "gpt-5.6-sol-availability-replacement", "primary-quality-repair"],
      defaultReasoning: { reference: "high", grading: "high" },
      escalation: {
        allowedTriggerClasses: ["availability"],
        blockedTriggerClasses: ["configuration", "evidence", "quality"],
        maxAttemptsPerUnit: 1
      }
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
      escalation: {
        allowedTriggerClasses: [],
        blockedTriggerClasses: ["configuration", "evidence"],
        maxAttemptsPerUnit: 0
      }
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
      escalation: {
        allowedTriggerClasses: [],
        blockedTriggerClasses: ["configuration", "evidence"],
        maxAttemptsPerUnit: 0
      }
    },
    reviewGate: "teacher_confirmation",
    verification: {
      tests: ["apps/api/src/student-growth-profile.test.mjs", "apps/api/src/student-profile-publish-gate.test.mjs"],
      commands: ["check:api", "typecheck --workspace apps/web"]
    }
  }
]);

const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);
const isNonEmptyStringArray = (value) => Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.length > 0);
const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0);

export function listModuleCapabilities() {
  return [...moduleCapabilityCatalog];
}

export function getModuleCapability(moduleId) {
  return moduleCapabilityCatalog.find((capability) => capability.moduleId === moduleId);
}

export function validateModuleCapabilityRegistry(registry = moduleCapabilityCatalog) {
  const issues = [];
  if (!Array.isArray(registry)) return { ok: false, issues: ["registry must be an array"] };

  const ids = new Set();
  for (const capability of registry) {
    const moduleId = capability?.moduleId;
    if (ids.has(moduleId)) issues.push(`duplicate moduleId: ${moduleId}`);
    ids.add(moduleId);
    if (!EXPECTED_MODULE_IDS.includes(moduleId)) issues.push(`unknown moduleId: ${moduleId}`);
    if (!isNonEmptyStringArray(capability?.triggers)) issues.push(`${moduleId}: triggers must be non-empty`);
    if (!isStringArray(capability?.dependencies)) issues.push(`${moduleId}: dependencies must be an array`);

    const requestContract = capability?.requestContract;
    for (const field of ["requiredFields", "optionalFields", "serverDerivedFields", "forbiddenClientFields"]) {
      if (!isStringArray(requestContract?.[field])) issues.push(`${moduleId}: requestContract.${field} is invalid`);
    }

    const resultContract = capability?.resultContract;
    for (const field of ["teacherVisibleFields", "studentVisibleFields", "internalOnlyFields"]) {
      if (!isNonEmptyStringArray(resultContract?.[field])) issues.push(`${moduleId}: resultContract.${field} is invalid`);
    }

    const modelPolicy = capability?.modelPolicy;
    if (!isRecord(modelPolicy) || typeof modelPolicy.primaryTask !== "string" || typeof modelPolicy.primaryRoute !== "string") {
      issues.push(`${moduleId}: modelPolicy is invalid`);
    } else {
      if (!isStringArray(modelPolicy.supportRoutes)) issues.push(`${moduleId}: modelPolicy.supportRoutes is invalid`);
      if (!isRecord(modelPolicy.defaultReasoning)) issues.push(`${moduleId}: modelPolicy.defaultReasoning is invalid`);
      const escalation = modelPolicy.escalation;
      if (!isRecord(escalation) || !isStringArray(escalation.allowedTriggerClasses) || !isStringArray(escalation.blockedTriggerClasses) || !Number.isInteger(escalation.maxAttemptsPerUnit) || escalation.maxAttemptsPerUnit < 0) {
        issues.push(`${moduleId}: modelPolicy.escalation is invalid`);
      }
    }

    if (!Object.prototype.hasOwnProperty.call(EXPECTED_REVIEW_GATES, moduleId)) {
      issues.push(`${moduleId}: reviewGate cannot be checked`);
    } else if (capability?.reviewGate !== EXPECTED_REVIEW_GATES[moduleId]) {
      issues.push(`${moduleId}: reviewGate mismatch`);
    }

    if (!isRecord(capability?.verification) || !isNonEmptyStringArray(capability.verification.tests) || !isNonEmptyStringArray(capability.verification.commands)) {
      issues.push(`${moduleId}: verification tests and commands are required`);
    }
  }

  for (const capability of registry) {
    for (const dependency of capability?.dependencies || []) {
      if (!ids.has(dependency)) issues.push(`${capability.moduleId}: unknown dependency: ${dependency}`);
    }
  }

  return { ok: issues.length === 0, issues };
}
