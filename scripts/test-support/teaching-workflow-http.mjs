import express from "express";
import { once } from "node:events";
import { createTeachingWorkflowService } from "../../packages/services/src/teaching-workflow-service.js";
import { createTeachingWorkflowRouter } from "../../apps/api/src/teaching-workflow-routes.js";
import { createSessionToken, requireSession } from "../../apps/api/src/session.js";
import { createTeachingWorkflowRepository } from "../../packages/db/src/teaching-workflow-repository.js";
import { fakeWorkflowPrisma } from "./teaching-workflow-prisma.mjs";

const copy = (value) => structuredClone(value);

// In-memory by default; explicit integration tests may inject an isolated PostgreSQL repository.
export async function workflowHttpFixture(t, options = {}) {
  const heads = new Map();
  const preparedInputs = [];
  const db = fakeWorkflowPrisma();
  const create = db.teachingWorkflow.create;
  let nextId = 0;
  db.teachingWorkflow.create = async ({ data }) => {
    const head = await create({ data: { ...data, id: `workflow-${++nextId}` } });
    heads.set(head.id, head);
    return head;
  };
  const repo = options.repository || createTeachingWorkflowRepository(db);
  const service = createTeachingWorkflowService({
    repository: repo,
    validateSnapshot: options.validateSnapshot || ((snapshot) => ({ ok: Array.isArray(snapshot?.questions) && snapshot.questions.every((q) => q.id && q.prompt && q.answer) })),
    runner: options.runner,
    resolveConfirmedArchive: options.resolveConfirmedArchive,
    createDraft: options.createDraft || (async ({ input }) => {
      preparedInputs.push(copy(input));
      return { request: input.request, snapshot: { questions: [{ id: "q1", prompt: "1+1", answer: "2", raw: "PRIVATE", metadata: { debug: "PRIVATE" } }], raw: "PRIVATE" } };
    })
  });
  const config = { SESSION_SECRET: "workflow-http-test-only-secret" };
  const tokens = { teacher: createSessionToken(config, { role: "teacher", teacherId: "t1" }), other: createSessionToken(config, { role: "teacher", teacherId: "t2" }), student: createSessionToken(config, { role: "student", studentId: "s1" }) };
  const app = express();
  app.use(express.json());
  app.use("/api/teaching", createTeachingWorkflowRouter({ service: Object.hasOwn(options, "service") ? options.service : service, archiveService: options.archiveService, assignmentService: options.assignmentService, requireTeacher: requireSession(config, ["teacher"]) }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { token = tokens.teacher, body, method = body === undefined ? "GET" : "POST" } = {}) => fetch(`${baseUrl}/api/teaching${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { service, repo, heads, preparedInputs, baseUrl, tokens, request };
}
