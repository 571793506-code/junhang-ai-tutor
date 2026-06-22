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
const skipAi = env.FLOW_SKIP_AI === "1" || env.FLOW_LIGHT === "1";

async function request(route, options = {}) {
  try {
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
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    return { status: response.status, ok: response.ok && body.ok !== false, body };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      body: {
        error: "NETWORK_ERROR",
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function pass(name, ok, detail = {}) {
  return { name, ok: Boolean(ok), detail };
}

const checks = [];

const health = await request("/health");
checks.push(pass("api health and database", health.ok && health.body.database?.ok, {
  database: health.body.database?.reason || null
}));

const anonymousBootstrap = await request("/api/bootstrap");
checks.push(pass("anonymous bootstrap is protected", anonymousBootstrap.status === 401, {
  status: anonymousBootstrap.status
}));

const publicStatus = await request("/api/status");
checks.push(pass("public status is parent/student safe", publicStatus.ok && (publicStatus.body.ai?.providers || []).length === 0, {
  features: publicStatus.body.ai?.features?.length || 0
}));

const teacherLogin = await request("/api/teacher-login", {
  method: "POST",
  body: {
    phone: env.SMOKE_TEACHER_PHONE || "13800000001",
    accessCode: env.SMOKE_TEACHER_CODE || "T8JH21"
  }
});
const teacherToken = teacherLogin.body.sessionToken;
checks.push(pass("teacher login", teacherLogin.ok && teacherToken, { status: teacherLogin.status }));

const teacherBootstrap = teacherToken ? await request("/api/bootstrap", { token: teacherToken }) : null;
checks.push(pass("teacher sees management data", teacherBootstrap?.ok && teacherBootstrap.body.students?.length >= 1 && teacherBootstrap.body.classroomDevices?.length >= 1, {
  students: teacherBootstrap?.body.students?.length || 0,
  devices: teacherBootstrap?.body.classroomDevices?.length || 0
}));

const teacherStatus = teacherToken ? await request("/api/ai/status", { token: teacherToken }) : null;
checks.push(pass("teacher sees provider operations", teacherStatus?.ok && teacherStatus.body.ai?.providers?.length >= 2, {
  providers: teacherStatus?.body.ai?.providers?.map((item) => `${item.id}:${item.status}`) || []
}));

const firstStudent = teacherBootstrap?.body.students?.[0] || {};
const task = teacherToken && !skipAi ? await request("/api/teacher/tasks", {
  method: "POST",
  token: teacherToken,
  body: {
    studentId: firstStudent.id,
    studentName: firstStudent.displayName,
    subject: "英语",
    title: "系统流畅性检查任务",
    requirement: "生成一条可被学生端看到的今日任务。",
    minutes: 10
  }
}) : null;
checks.push(skipAi
  ? pass("teacher task generation skipped in light mode", true, { skipped: true })
  : pass("teacher can create today task", task?.ok && task.body.result?.persisted?.learningTaskId, {
      learningTaskId: task?.body.result?.persisted?.learningTaskId || null
    }));

const assessment = teacherToken && !skipAi ? await request("/api/assessments/draft", {
  method: "POST",
  token: teacherToken,
  body: {
    targetScope: "student",
    studentId: firstStudent.id,
    grade: firstStudent.grade || "六年级",
    subject: "数学",
    kind: "小测",
    difficulty: "基础",
    requirement: "两页 A4，检查排版模板和生成记录。"
  }
}) : null;
checks.push(skipAi
  ? pass("assessment generation skipped in light mode", true, { skipped: true })
  : pass("teacher can draft assessment", assessment?.ok && assessment.body.result?.persisted?.assignmentId, {
      assignmentId: assessment?.body.result?.persisted?.assignmentId || null
    }));

const assessmentId = assessment?.body.result?.persisted?.assignmentId;
const assessmentDraftExport = teacherToken && assessmentId && !skipAi
  ? await request(`/api/assessments/${assessmentId}/draft-export`, { method: "POST", token: teacherToken, body: {} })
  : null;
checks.push(skipAi
  ? pass("assessment draft PDF export skipped in light mode", true, { skipped: true })
  : pass("teacher can export assessment review draft PDF", assessmentDraftExport?.ok && assessmentDraftExport.body.asset?.url, {
      url: assessmentDraftExport?.body.asset?.url || null
    }));

const assessmentReview = teacherToken && assessmentId && !skipAi
  ? await request(`/api/assessments/${assessmentId}/draft-review`, { method: "POST", token: teacherToken, body: { decision: "accept" } })
  : null;
const assessmentPrint = teacherToken && assessmentId && !skipAi
  ? await request(`/api/assessments/${assessmentId}/print-export`, { method: "POST", token: teacherToken, body: {} })
  : null;
checks.push(skipAi
  ? pass("assessment final PDF export skipped in light mode", true, { skipped: true })
  : pass("teacher accepts draft before final PDF export", assessmentReview?.ok && assessmentPrint?.ok && assessmentPrint.body.assets?.length >= 2, {
      reviewStatus: assessmentReview?.body.reviewStatus || null,
      assets: assessmentPrint?.body.assets?.map((asset) => asset.title) || []
    }));

const profile = teacherToken && firstStudent.id && !skipAi
  ? await request(`/api/students/${firstStudent.id}/profile/aggregate`, { method: "POST", token: teacherToken, body: {} })
  : null;
checks.push(skipAi
  ? pass("profile AI aggregation skipped in light mode", true, { skipped: true })
  : pass("student profile aggregates", profile?.ok && profile.body.snapshot?.narrative?.generatedBy, {
      weeklyScore: profile?.body.snapshot?.weeklyScore ?? null,
      generatedBy: profile?.body.snapshot?.narrative?.generatedBy || null
    }));

const studentLogin = await request("/api/student-login", {
  method: "POST",
  body: {
    displayName: env.SMOKE_STUDENT_NAME || "李子越",
    guardianPhone: env.SMOKE_STUDENT_PHONE || "13900005678",
    accessCode: env.SMOKE_STUDENT_CODE || "LZY6P9"
  }
});
const studentToken = studentLogin.body.sessionToken;
checks.push(pass("student login", studentLogin.ok && studentToken, { status: studentLogin.status }));

const studentBootstrap = studentToken ? await request("/api/bootstrap", { token: studentToken }) : null;
checks.push(pass("student sees scoped learning data", studentBootstrap?.ok && studentBootstrap.body.students?.length === 1 && !JSON.stringify(studentBootstrap.body).includes("DeepSeek"), {
  students: studentBootstrap?.body.students?.length || 0,
  tasks: studentBootstrap?.body.tasks?.length || 0
}));

const qa = studentToken && !skipAi ? await request("/api/ai/qa", {
  method: "POST",
  token: studentToken,
  body: {
    studentId: studentLogin.body.student?.id,
    studentName: studentLogin.body.student?.displayName,
    subject: "数学",
    question: "等腰三角形一个角是40度，应该怎么思考？"
  }
}) : null;
checks.push(skipAi
  ? pass("student qa skipped in light mode", true, { skipped: true })
  : pass("student qa works", qa?.ok && qa.body.result?.answer, {
      available: qa?.body.result?.available ?? null,
      mode: qa?.body.result?.mode || null
    }));

const deviceLogin = await request("/api/classroom/device-login", {
  method: "POST",
  body: { bindingCode: env.SMOKE_DEVICE_CODE || "PAD6JH" }
});
const deviceToken = deviceLogin.body.sessionToken;
checks.push(pass("classroom login", deviceLogin.ok && deviceToken, { status: deviceLogin.status }));

const classroomBootstrap = deviceToken ? await request("/api/bootstrap", { token: deviceToken }) : null;
checks.push(pass("classroom data is scoped and private", classroomBootstrap?.ok && !JSON.stringify(classroomBootstrap.body).includes("guardianPhone") && !JSON.stringify(classroomBootstrap.body).includes("accessCode"), {
  students: classroomBootstrap?.body.students?.length || 0,
  broadcasts: classroomBootstrap?.body.classroomBroadcasts?.length || 0
}));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({
  apiBaseUrl,
  generatedAt: new Date().toISOString(),
  ok: failed.length === 0,
  checks
}, null, 2));

if (failed.length) process.exitCode = 1;
