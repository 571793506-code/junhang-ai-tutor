import {
  demoCorrectionRecords,
  demoLearningLogs,
  demoStudents,
  demoTasks,
  demoTextbooks,
  entityBlueprints,
  importPlan,
  startupMode
} from "../packages/core/src/index.js";
import { createDemoAiSnapshot } from "../packages/ai/src/index.js";

const ai = createDemoAiSnapshot();

const report = {
  generatedAt: new Date().toISOString(),
  mode: {
    id: startupMode.id,
    label: startupMode.label,
    description: startupMode.description,
    demoScope: startupMode.demoScope,
    migrationTargets: startupMode.migrationTargets,
    providerPolicy: startupMode.providerPolicy
  },
  ai,
  demoData: {
    students: demoStudents.length,
    tasks: demoTasks.length,
    correctionRecords: demoCorrectionRecords.length,
    textbooks: demoTextbooks.length,
    learningLogs: demoLearningLogs.length
  },
  entityBlueprints,
  importPlan
};

console.log(JSON.stringify(report, null, 2));
