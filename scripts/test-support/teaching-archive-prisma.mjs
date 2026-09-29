// Serial copy-on-write transaction simulator. This tests repository orchestration,
// not PostgreSQL isolation, row-lock behavior, Prisma JSON queries or constraints.
export function fakeTeachingArchivePrisma(initial) {
  let state = structuredClone({ workflows: [], revisions: [], submissions: [], mistakes: [], assignments: [], ...initial });
  let queue = Promise.resolve();
  const events = [];
  const copy = (value) => structuredClone(value);
  const db = {
    events,
    failAt: null,
    snapshot: () => copy(state),
    seed: (next) => { state = copy({ ...state, ...next }); },
    async $transaction(run) {
      const wait = queue; let release;
      queue = new Promise((resolve) => { release = resolve; });
      await wait;
      const draft = copy(state);
      const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
      const tx = {
        subject: { findFirst: async () => ({ id: "test-subject" }) },
        assignment: {
          findUnique: async ({ where }) => copy(draft.assignments.find((row) => row.id === where.id) || null),
          create: async ({ data }) => {
            if (draft.assignments.some((row) => row.id === data.id)) throw Object.assign(new Error("Duplicate"), { code: "P2002" });
            const row = { ...copy(data), items: data.items.create.map((item, i) => ({ ...copy(item), id: `${data.id}-${i}` })) };
            draft.assignments.push(row); events.push("assignment"); return copy(row);
          }
        },
        teachingWorkflow: {
          updateMany: async ({ where, data }) => {
            events.push("lock");
            const rows = draft.workflows.filter((row) => matches(row, where));
            rows.forEach((row) => Object.assign(row, data));
            return { count: rows.length };
          },
          findFirst: async ({ where }) => copy(draft.workflows.find((row) => matches(row, where)) || null)
        },
        teachingWorkflowRevision: {
          findUnique: async ({ where }) => copy(draft.revisions.find((row) => matches(row, where.workflowId_revision)) || null)
        },
        submission: {
          findUnique: async ({ where }) => copy(draft.submissions.find((row) => row.id === where.id) || null),
          findMany: async ({ where }) => copy(draft.submissions.filter((row) => row.studentId === where.studentId &&
            row.content?.workflowArchive?.workflowId === where.content.equals)),
          create: async ({ data }) => {
            events.push("submission");
            if (db.failAt === "submission") throw new Error("TEST_SUBMISSION_FAILURE");
            if (draft.submissions.some((row) => row.id === data.id)) throw Object.assign(new Error("Duplicate"), { code: "P2002" });
            const row = { ...copy(data), grading: copy(data.grading.create) };
            draft.submissions.push(row);
            return copy(row);
          }
        },
        mistakeRecord: {
          createMany: async ({ data }) => {
            events.push("mistakes");
            if (db.failAt === "mistakes") throw new Error("TEST_MISTAKES_FAILURE");
            if (data.some((entry) => draft.mistakes.some((row) => row.id === entry.id))) throw Object.assign(new Error("Duplicate"), { code: "P2002" });
            draft.mistakes.push(...copy(data));
            return { count: data.length };
          }
        }
      };
      try {
        const result = await run(tx);
        if (db.failAt === "commit") throw new Error("TEST_COMMIT_FAILURE");
        state = draft; events.push("commit");
        return result;
      } catch (error) { events.push("rollback"); throw error; }
      finally { release(); }
    }
  };
  return db;
}
