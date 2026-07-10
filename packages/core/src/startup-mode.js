import { entityBlueprints, miniProgramSurface } from "./domain.js";
import { importPlan } from "./import-plan.js";

export const startupMode = {
  id: "web-phase1-demo",
  label: "Phase 1 Web MVP",
  description: "GPT-5.6 负责文本生成与批改，MiniMax 负责视觉、语音与化身，Web 先做可迁移的学习闭环。",
  demoScope: ["学生主页", "今日任务", "AI 问答", "英语词汇助手"],
  providerPolicy: {
    textProvider: "GPT-5.6",
    mediaProvider: "MiniMax",
    mediaGate: "MiniMax 已恢复，可开放语音与化身"
  },
  migrationTargets: miniProgramSurface,
  entityBlueprints,
  importPlan
};
