import test from "node:test";
import assert from "node:assert/strict";
import {
  demoAssignments,
  demoClassroomBroadcasts,
  demoCorrectionRecords,
  demoDictationTasks,
  demoLearningLogs,
  demoReadingTasks,
  demoStudentReports,
  demoStudents,
  demoTasks,
  demoVocabularyEntries
} from "./demo-data.js";

test("demo seed uses Xiao Xinyan as the primary student fixture", () => {
  const primary = demoStudents[0];
  assert.deepEqual(
    {
      id: primary.id,
      displayName: primary.displayName,
      school: primary.school,
      className: primary.className,
      guardianName: primary.guardianName,
      guardianPhone: primary.guardianPhone,
      guardianId: primary.guardianId,
      accessCode: primary.accessCode,
      enrollmentStatus: primary.enrollmentStatus,
      loginEnabled: primary.loginEnabled,
      focus: primary.focus
    },
    {
      id: "cmrx8gpcd00016ydgu2hqz4dy",
      displayName: "肖心妍",
      school: "君航课堂",
      className: null,
      guardianName: "肖心妍家长",
      guardianPhone: "18285281120",
      guardianId: "cmrx8gpeu00066ydg0bn9nwz7",
      accessCode: "XFSJHA",
      enrollmentStatus: "在读",
      loginEnabled: true,
      focus: "注重数学的各方面提升"
    }
  );

});

test("primary demo content follows the seeded student identity", () => {
  const primaryId = demoStudents[0].id;
  const linkedCollections = [
    demoAssignments,
    demoCorrectionRecords,
    demoDictationTasks,
    demoLearningLogs,
    demoReadingTasks,
    demoStudentReports,
    demoTasks,
    demoVocabularyEntries
  ];

  for (const collection of linkedCollections) {
    for (const item of collection) {
      if ("studentId" in item) assert.equal(item.studentId, primaryId);
    }
  }

  const linkedNames = [...demoAssignments, ...demoTasks].map((item) => item.studentName);
  assert.ok(linkedNames.every((name) => name === "肖心妍"));
  assert.match(demoClassroomBroadcasts[1].content, /肖心妍/);
});

test("historical demo students stay outside new-work selectors", () => {
  const historical = demoStudents.find((student) => student.displayName === "李子越");
  assert.equal(historical?.enrollmentStatus, "退课保留档案");
  assert.equal(historical?.loginEnabled, false);
});
