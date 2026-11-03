const SAFE_ERRORS = new Set(["SESSION_REQUIRED", "SESSION_FORBIDDEN", "WORKFLOW_FORBIDDEN", "WORKFLOW_NOT_FOUND", "WORKFLOW_REVISION_NOT_FOUND", "WORKFLOW_VERSION_CONFLICT", "WORKFLOW_REQUEST_KEY_REUSED", "WORKFLOW_OPERATION_KEY_REUSED", "WORKFLOW_CANCELLED", "WORKFLOW_UNAVAILABLE", "WORKFLOW_EXECUTION_UNAVAILABLE", "WORKFLOW_VALIDATION_UNAVAILABLE", "WORKFLOW_INPUT_INVALID", "WORKFLOW_SNAPSHOT_INVALID"]);
for (const code of ["WORKFLOW_ARCHIVE_UNAVAILABLE", "WORKFLOW_ARCHIVE_EVIDENCE_REQUIRED", "WORKFLOW_ARCHIVE_INVALID"]) SAFE_ERRORS.add(code);
for (const code of ["WORKFLOW_REQUEST_INCOMPLETE", "WORKFLOW_CONTEXT_REQUIRED", "WORKFLOW_EVIDENCE_CHANGED", "WORKFLOW_EXECUTION_FAILED"]) SAFE_ERRORS.add(code);
for (const code of ["WORKFLOW_ASSIGNMENT_UNAVAILABLE", "WORKFLOW_ASSIGNMENT_INVALID", "WORKFLOW_CONFIRMATION_REQUIRED"]) SAFE_ERRORS.add(code);
for (const code of ["WORKFLOW_COMMAND_INVALID", "WORKFLOW_TARGET_SCOPE_INVALID", "WORKFLOW_EXPLANATION_PATCH_INVALID"]) SAFE_ERRORS.add(code);
SAFE_ERRORS.add("WORKFLOW_RECOVERY_NOT_ALLOWED");
function fail(code, status = 0) { throw Object.assign(new Error(code), { code, status }); }

export function createTeachingWorkflowClient({ baseUrl, session, fetchImpl = fetch, timeoutMs = 300000 } = {}) {
  if (typeof session?.sessionToken !== "string" || !session.sessionToken.trim()) fail("SESSION_REQUIRED", 401);
  let base;
  try { base = new URL(baseUrl); } catch { fail("WORKFLOW_API_URL_INVALID"); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== "/") fail("WORKFLOW_API_URL_INVALID");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) fail("WORKFLOW_TIMEOUT_INVALID");
  const segment = (value) => {
    if (typeof value !== "string" || !value.trim() || value === "." || value === "..") fail("WORKFLOW_INPUT_INVALID");
    return encodeURIComponent(value);
  };
  const request = async (suffix, body, archiveId, publication = "archive") => {
    let response;
    try {
      response = await fetchImpl(new URL(`/api/teaching/workflows${suffix}`, base), {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${session.sessionToken}`, "Content-Type": "application/json" },
        redirect: "error", signal: AbortSignal.timeout(timeoutMs),
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch { fail("WORKFLOW_CONNECTION_FAILED"); }
    let data;
    try { data = await response.json(); } catch { fail("WORKFLOW_RESPONSE_INVALID", response.status); }
    if (!response.ok || data?.ok !== true) fail(SAFE_ERRORS.has(data?.error) ? data.error : "WORKFLOW_REQUEST_FAILED", response.status);
    if (archiveId !== undefined) {
      const view = data[publication];
      const expectedStatus = publication === "assignment" ? "assignment_ready" : "archived";
      if (typeof view?.id !== "string" || !view.id.trim() || view.workflowId !== archiveId || view.status !== expectedStatus ||
        !Number.isSafeInteger(view.revision) || view.revision < 1 || view.revision !== body.expectedRevision ||
        !Number.isSafeInteger(view.currentRevision) || view.currentRevision < view.revision || typeof view.replayed !== "boolean") fail("WORKFLOW_RESPONSE_INVALID", response.status);
      return { id: view.id, workflowId: view.workflowId, revision: view.revision, currentRevision: view.currentRevision, status: expectedStatus, replayed: view.replayed };
    }
    if (typeof data.workflow?.id !== "string" || !Number.isSafeInteger(data.workflow.revision) || !data.workflow.content) fail("WORKFLOW_RESPONSE_INVALID", response.status);
    return data.workflow;
  };
  return {
    create: (input) => request("", input),
    get: (id) => request(`/${segment(id)}`),
    getRevision: (id, revision) => {
      if (!Number.isSafeInteger(revision) || revision < 1) fail("WORKFLOW_REVISION_INVALID");
      return request(`/${segment(id)}/revisions/${revision}`);
    },
    execute: (id, command) => request(`/${segment(id)}/commands`, command),
    recover: (id, input) => {
      if (!Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 1 || typeof input.operationKey !== "string" || !input.operationKey.trim()) fail("WORKFLOW_INPUT_INVALID");
      return request(`/${segment(id)}/recover`, { expectedRevision: input.expectedRevision, operationKey: input.operationKey });
    },
    assignment: (id, input) => {
      if (!Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 1) fail("WORKFLOW_INPUT_INVALID");
      return request(`/${segment(id)}/assignment`, { expectedRevision: input.expectedRevision }, id, "assignment");
    },
    archive: (id, input) => {
      if (!Number.isSafeInteger(input?.expectedRevision) || input.expectedRevision < 1) fail("WORKFLOW_INPUT_INVALID");
      return request(`/${segment(id)}/archive`, { expectedRevision: input.expectedRevision }, id);
    }
  };
}
