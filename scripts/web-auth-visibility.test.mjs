import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../apps/web/src/main.tsx", import.meta.url), "utf8");

test("web keeps business data empty until a role session bootstraps", () => {
  assert.match(source, /useState<TeacherProfile\[\]>\(\[\]\)/);
  assert.match(source, /useState<StudentProfile\[\]>\(\[\]\)/);
  assert.match(source, /useState<LearningTaskCard\[\]>\(\[\]\)/);
  assert.match(source, /useState<AssignmentCard\[\]>\(\[\]\)/);
  assert.match(source, /role === "teacher" && auth\.teacherId/);
  assert.match(source, /role === "student" && auth\.studentId/);
});

test("role login bootstraps data before exposing the authenticated workspace", () => {
  for (const handlerName of ["handleTeacherLogin", "handleStudentLogin", "handleClassroomLogin"]) {
    const start = source.indexOf(`async function ${handlerName}`);
    const end = source.indexOf("\n  async function", start + 1);
    assert.ok(start >= 0 && end > start, `${handlerName} should be defined`);
    const handler = source.slice(start, end);
    assert.ok(handler.indexOf("await applyBootstrap()") < handler.indexOf("setAuth("), `${handlerName} must bootstrap before setting auth`);
  }
});

test("web shows a sync state instead of rendering an authenticated workspace without its role data", () => {
  assert.match(source, /auth\.teacherId && currentTeacher/);
  assert.match(source, /auth\.studentId && currentStudent/);
  assert.match(source, /auth\.deviceId && currentDevice/);
  assert.match(source, /正在同步教师数据/);
  assert.match(source, /正在同步学生数据/);
  assert.match(source, /正在同步课堂设备/);
});

test("student learning log fallback never exposes raw internal feature or action", () => {
  const start = source.indexOf("function formatLearningLog");
  const end = source.indexOf("function studentSummaryPreview", start);
  assert.ok(start >= 0 && end > start);
  const helper = source.slice(start, end);
  assert.match(helper, /未知|暂不展示|学习记录/);
  assert.doesNotMatch(helper, /title: fallbackFeature\[featureKey\] \|\| featureKey/);
  assert.doesNotMatch(helper, /detail: actionText \|\|/);
});
