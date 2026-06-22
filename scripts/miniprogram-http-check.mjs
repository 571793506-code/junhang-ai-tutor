import fs from "node:fs";
import path from "node:path";

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) continue;
    env[trimmed.slice(0, equalIndex).trim()] = trimmed.slice(equalIndex + 1).trim();
  }
  return env;
}

const env = { ...process.env, ...loadEnv(path.resolve(".env")) };
const apiBaseUrl = (env.API_BASE_URL || `http://127.0.0.1:${env.API_PORT || 8787}`).replace(/\/$/, "");

async function request(route, options = {}) {
  const response = await fetch(`${apiBaseUrl}${route}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {})
    },
    body: options.body == null ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  return { status: response.status, ok: response.ok && body.ok !== false, body };
}

function assertCheck(name, condition, detail = {}) {
  return { name, ok: Boolean(condition), detail };
}

const checks = [];
const publicStatus = await request("/api/status");
checks.push(assertCheck("public status hides providers", publicStatus.ok && (publicStatus.body.ai?.providers || []).length === 0, publicStatus.body.ai));

const teacherLogin = await request("/api/teacher-login", {
  method: "POST",
  body: { phone: "13800000001", accessCode: "T8JH21" }
});
const teacherToken = teacherLogin.body.sessionToken;
checks.push(assertCheck("teacher login", teacherLogin.ok && teacherToken, { status: teacherLogin.status }));

const teacherBootstrap = teacherToken ? await request("/api/bootstrap", { token: teacherToken }) : null;
checks.push(assertCheck("teacher bootstrap scoped", teacherBootstrap?.ok && Array.isArray(teacherBootstrap.body.students), {
  students: teacherBootstrap?.body.students?.length ?? 0
}));

const teacherAi = teacherToken ? await request("/api/ai/status", { token: teacherToken }) : null;
checks.push(assertCheck("teacher can see provider ops", teacherAi?.ok && (teacherAi.body.ai?.providers || []).some((item) => item.id === "deepseek"), {
  providers: teacherAi?.body.ai?.providers?.map((item) => `${item.id}:${item.status}`) || []
}));

const firstStudent = teacherBootstrap?.body.students?.[0];
const demoStudentCredentials = {
  displayName: env.SMOKE_STUDENT_NAME || "李子越",
  guardianPhone: env.SMOKE_STUDENT_PHONE || "13900005678",
  accessCode: env.SMOKE_STUDENT_CODE || "LZY6P9"
};
const studentLogin = await request("/api/student-login", {
  method: "POST",
  body: demoStudentCredentials
});
const studentToken = studentLogin?.body.sessionToken;
checks.push(assertCheck("student login by name phone code", studentLogin?.ok && studentToken, {
  student: demoStudentCredentials.displayName,
  status: studentLogin?.status
}));

const studentBootstrap = studentToken ? await request("/api/bootstrap", { token: studentToken }) : null;
checks.push(assertCheck("student bootstrap no provider leak", studentBootstrap?.ok && !JSON.stringify(studentBootstrap.body).includes("DeepSeek") && !JSON.stringify(studentBootstrap.body).includes("MiniMax"), {
  students: studentBootstrap?.body.students?.length ?? 0
}));

const deviceLogin = await request("/api/classroom/device-login", {
  method: "POST",
  body: { bindingCode: "PAD6JH" }
});
const deviceToken = deviceLogin.body.sessionToken;
checks.push(assertCheck("classroom device login", deviceLogin.ok && deviceToken, { status: deviceLogin.status }));

const classroomBootstrap = deviceToken ? await request("/api/bootstrap", { token: deviceToken }) : null;
checks.push(assertCheck("classroom bootstrap no private fields", classroomBootstrap?.ok && !JSON.stringify(classroomBootstrap.body).includes("guardianPhone") && !JSON.stringify(classroomBootstrap.body).includes("accessCode") && !JSON.stringify(classroomBootstrap.body).includes("1390000"), {
  students: classroomBootstrap?.body.students?.length ?? 0
}));

const profileDraft = teacherToken && firstStudent
  ? await request(`/api/students/${firstStudent.id}/profile/draft`, { method: "POST", token: teacherToken, body: {} })
  : null;
checks.push(assertCheck("profile draft includes teacher preview narrative", profileDraft?.ok && profileDraft.body.snapshot?.draftStatus === "draft" && profileDraft.body.snapshot?.narrative?.generatedBy === "AI生成", {
  draftStatus: profileDraft?.body.snapshot?.draftStatus ?? null,
  aiGenerated: profileDraft?.body.snapshot?.narrative?.aiGenerated ?? null
}));

const profilePublish = teacherToken && firstStudent && profileDraft?.body.snapshot
  ? await request(`/api/students/${firstStudent.id}/profile/publish`, { method: "POST", token: teacherToken, body: { snapshot: profileDraft.body.snapshot } })
  : null;
checks.push(assertCheck("profile publish requires teacher confirmation", profilePublish?.ok && profilePublish.body.snapshot?.draftStatus === "published" && Boolean(profilePublish.body.snapshot?.publishedAt), {
  draftStatus: profilePublish?.body.snapshot?.draftStatus ?? null,
  publishedAt: Boolean(profilePublish?.body.snapshot?.publishedAt)
}));

const failed = checks.filter((check) => !check.ok);
console.log(JSON.stringify({ apiBaseUrl, generatedAt: new Date().toISOString(), checks }, null, 2));
if (failed.length) {
  process.exitCode = 1;
}
