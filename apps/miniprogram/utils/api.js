const session = require("./session");
const encodingGuard = require("./encodingGuard");

function baseUrl() {
  const app = getApp();
  return app.globalData.apiBaseUrl.replace(/\/$/, "");
}

function authHeader() {
  const token = session.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${baseUrl()}${path}`,
      method: options.method || "GET",
      data: options.data || {},
      header: {
        "Content-Type": "application/json",
        ...authHeader(),
        ...(options.header || {})
      },
      success(res) {
        const body = encodingGuard.normalizePayload(res.data || {});
        if (res.statusCode >= 200 && res.statusCode < 300 && body.ok !== false) {
          resolve(body);
          return;
        }
        if (res.statusCode === 401 || res.statusCode === 403) {
          session.clearAll();
        }
        reject(new Error(body.message || body.error || `HTTP ${res.statusCode}`));
      },
      fail(error) {
        reject(new Error(error.errMsg || "网络请求失败"));
      }
    });
  });
}

function uploadSubmission({ files, fields }) {
  const safeFiles = Array.isArray(files) ? files : [];
  if (!safeFiles.length) {
    return request("/api/submissions/grade", {
      method: "POST",
      data: {
        ...fields,
        imageNames: []
      }
    });
  }

  return request("/api/submissions/batches", {
    method: "POST",
    data: {
      ...fields,
      imageTotal: safeFiles.length
    }
  }).then((batch) => {
    const uploads = safeFiles.map((filePath, index) =>
      new Promise((resolve, reject) => {
        wx.uploadFile({
          url: `${baseUrl()}/api/submissions/grade`,
          filePath,
          name: "images",
        formData: {
            ...fields,
            assignmentId: batch.assignmentId,
            batchId: batch.batchId,
            imageIndex: String(index + 1),
            imageTotal: String(safeFiles.length)
          },
          header: authHeader(),
          success(res) {
            const body = encodingGuard.normalizePayload(res.data ? JSON.parse(res.data) : {});
            if (res.statusCode >= 200 && res.statusCode < 300 && body.ok !== false) {
              resolve(body);
              return;
            }
            if (res.statusCode === 401 || res.statusCode === 403) {
              session.clearAll();
            }
            reject(new Error(body.message || body.error || `HTTP ${res.statusCode}`));
          },
          fail(error) {
            reject(new Error(error.errMsg || "图片上传失败"));
          }
        });
      })
    );

    return Promise.all(uploads).then((results) => ({
      ok: true,
      assignmentId: batch.assignmentId,
      batchId: batch.batchId,
      uploadedCount: results.length,
      results
    }));
  });
}

module.exports = {
  askQuestion(input) {
    return request("/api/ai/qa", { method: "POST", data: input });
  },
  generateVocabulary(input) {
    return request("/api/ai/vocabulary", { method: "POST", data: input });
  },
  bootstrap() {
    return request("/api/bootstrap");
  },
  draftAssessment(input) {
    return request("/api/assessments/draft", { method: "POST", data: input });
  },
  exportAssessmentDraft(assignmentId) {
    return request(`/api/assessments/${assignmentId}/draft-export`, { method: "POST", data: {} });
  },
  reviewAssessmentDraft(assignmentId, input) {
    return request(`/api/assessments/${assignmentId}/draft-review`, { method: "POST", data: input || {} });
  },
  exportAssessmentPrint(assignmentId) {
    return request(`/api/assessments/${assignmentId}/print-export`, { method: "POST", data: {} });
  },
  draftTask(input) {
    return request("/api/teacher/tasks", { method: "POST", data: input });
  },
  loginStudent(input) {
    return request("/api/student-login", { method: "POST", data: input });
  },
  loginTeacher(input) {
    return request("/api/teacher-login", { method: "POST", data: input });
  },
  loginDevice(input) {
    return request("/api/classroom/device-login", { method: "POST", data: input });
  },
  askClassroomVoice(input) {
    return request("/api/classroom/voice-qa", { method: "POST", data: input });
  },
  completeTask(taskId, input) {
    return request(`/api/tasks/${taskId}/complete`, { method: "PATCH", data: input || {} });
  },
  getClassroomDevice(deviceId) {
    return request(`/api/classroom/devices/${deviceId}`);
  },
  lockClassroomDevice(deviceId, input) {
    return request(`/api/classroom/devices/${deviceId}/lock`, { method: "POST", data: input || {} });
  },
  publishClassroomBroadcast(input) {
    return request("/api/classroom/broadcasts", { method: "POST", data: input });
  },
  publishDictation(input) {
    return request("/api/classroom/dictation", { method: "POST", data: input });
  },
  publishReading(input) {
    return request("/api/classroom/reading", { method: "POST", data: input });
  },
  unlockClassroomDevice(deviceId, input) {
    return request(`/api/classroom/devices/${deviceId}/unlock`, { method: "POST", data: input || {} });
  },
  registerStudent(input) {
    return request("/api/students", { method: "POST", data: input });
  },
  resetStudentCode(studentId, input) {
    return request(`/api/students/${studentId}/reset-access-code`, { method: "POST", data: input || {} });
  },
  status() {
    return request("/api/status");
  },
  teacherAiStatus() {
    return request("/api/ai/status");
  },
  getContentIndex() {
    return request("/api/content/index");
  },
  listKnowledgeSources(input = {}) {
    const query = Object.keys(input)
      .filter((key) => input[key])
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(input[key])}`)
      .join("&");
    return request(`/api/knowledge/sources${query ? `?${query}` : ""}`);
  },
  syncKnowledgeSourcesFromIndex(input) {
    return request("/api/knowledge/sources/sync-content-index", { method: "POST", data: input || {} });
  },
  createKnowledgeSource(input) {
    return request("/api/knowledge/sources", { method: "POST", data: input });
  },
  reviewKnowledgeSource(sourceId, input) {
    return request(`/api/knowledge/sources/${sourceId}/review`, { method: "PATCH", data: input || {} });
  },
  updateStudentAccess(studentId, input) {
    return request(`/api/students/${studentId}/access-status`, { method: "PATCH", data: input });
  },
  listReviewSubmissions() {
    return request("/api/review/submissions");
  },
  markSubmissionReviewed(submissionId, input) {
    return request(`/api/review/submissions/${submissionId}/mark-reviewed`, { method: "POST", data: input || {} });
  },
  listGradingWorkbenches() {
    return request("/api/grading/workbench");
  },
  getGradingWorkbench(submissionId) {
    return request(`/api/grading/workbench/${submissionId}`);
  },
  updateGradingWorkbenchQuestion(submissionId, questionId, input) {
    return request(`/api/grading/workbench/${submissionId}/questions/${questionId}`, { method: "PATCH", data: input || {} });
  },
  archiveGradingWorkbench(submissionId, input) {
    return request(`/api/grading/workbench/${submissionId}/archive`, { method: "POST", data: input || {} });
  },
  draftStudentProfile(studentId) {
    return request(`/api/students/${studentId}/profile/draft`, { method: "POST", data: {} });
  },
  publishStudentProfile(studentId, input) {
    return request(`/api/students/${studentId}/profile/publish`, { method: "POST", data: input || {} });
  },
  verifySession() {
    return request("/api/session/verify");
  },
  uploadSubmission
};
