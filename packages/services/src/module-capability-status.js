import { buildAiStartupSnapshot } from "@junhang/ai";
import {
  MODULE_CAPABILITY_SCHEMA_VERSION,
  listModuleCapabilities
} from "@junhang/core";

const FEATURE_IDS = {
  generation: ["assessment-draft"],
  grading: ["submission-grading"],
  "teaching-materials": [],
  "student-profile": ["report-draft", "student-profile"]
};

function statusFromFeature(feature) {
  if (!feature) return "review_required";
  if (feature.status === "ready") return "available";
  if (feature.status === "blocked" || feature.status === "unavailable") return "blocked";
  return "review_required";
}

function dependencyStatusFor(capability, statuses) {
  if (capability.moduleId === "teaching-materials") return "review_required";
  const dependencies = capability.dependencies.map((moduleId) => statuses.get(moduleId));
  if (dependencies.some((status) => status === "blocked")) return "blocked";
  if (dependencies.some((status) => status !== "available")) return "review_required";
  return "ready";
}

function messageFor(status, moduleId) {
  if (status === "available") {
    return moduleId === "teaching-materials"
      ? "资料处理能力可用，选择已审核来源后才能注入生成上下文。"
      : "当前模块可用，结果仍按教师复核流程处理。";
  }
  if (status === "blocked") return "当前模块暂不可用，请检查服务状态或保留待复核结果。";
  return "当前模块需要补充资料、证据或教师复核后继续。";
}

export function buildModuleCapabilityStatus(config = {}, role = "teacher") {
  const snapshot = config.aiSnapshot || buildAiStartupSnapshot(config);
  const features = Array.isArray(snapshot.features) ? snapshot.features : [];
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  const capabilities = listModuleCapabilities();
  const directStatuses = new Map();

  for (const capability of capabilities) {
    if (capability.moduleId === "teaching-materials") {
      directStatuses.set(capability.moduleId, "available");
      continue;
    }
    const feature = FEATURE_IDS[capability.moduleId]
      .map((featureId) => featureById.get(featureId))
      .find(Boolean);
    directStatuses.set(capability.moduleId, statusFromFeature(feature));
  }

  const projected = capabilities.map((capability) => {
    const directStatus = directStatuses.get(capability.moduleId);
    const dependencyStatus = dependencyStatusFor(capability, directStatuses);
    const status = directStatus === "available" && dependencyStatus === "blocked"
      ? "blocked"
      : directStatus;
    return {
      moduleId: capability.moduleId,
      status,
      dependencyStatus,
      reviewGate: capability.reviewGate,
      teacherMessage: messageFor(status, capability.moduleId),
      verification: {
        tests: [...capability.verification.tests],
        commands: [...capability.verification.commands]
      }
    };
  });

  // Non-teacher callers receive the same redacted shape; the API route remains teacher-only.
  void role;
  return {
    schemaVersion: MODULE_CAPABILITY_SCHEMA_VERSION,
    generatedAt: snapshot.generatedAt || new Date().toISOString(),
    capabilities: projected
  };
}
