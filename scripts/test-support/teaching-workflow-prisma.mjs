// In-memory Prisma surface for service/repository contracts, not PostgreSQL evidence.
const copy = (value) => structuredClone(value);
const matches = (where, row) => Object.entries(where).every(([field, expected]) => {
  if (field === "OR") return expected.some((item) => matches(item, row));
  if (field === "AND") return expected.every((item) => matches(item, row));
  if (expected && typeof expected === "object") {
    if ("in" in expected) return expected.in.includes(row[field]);
    if ("not" in expected) return row[field] !== expected.not;
    if ("startsWith" in expected) return typeof row[field] === "string" && row[field].startsWith(expected.startsWith);
  }
  return row[field] === expected;
});

export function fakeWorkflowPrisma({ workflows = [], revisions = [] } = {}) {
  const model = (rows, name) => ({
    findUnique: async ({ where }) => copy(rows.find((row) => {
      if (where.id) return row.id === where.id;
      if (where.ownerTeacherId_requestKey) return matches(where.ownerTeacherId_requestKey, row);
      const compound = where.workflowId_revision || where.workflowId_operationKey;
      return compound && matches(compound, row);
    }) || null),
    findFirst: async ({ where, orderBy = [] }) => {
      const selected = rows.filter((row) => matches(where, row));
      for (const order of [...(Array.isArray(orderBy) ? orderBy : [orderBy])].reverse()) {
        const [field, direction] = Object.entries(order)[0];
        selected.sort((a, b) => a[field] < b[field] ? (direction === "asc" ? -1 : 1) : a[field] > b[field] ? (direction === "asc" ? 1 : -1) : 0);
      }
      return copy(selected[0] || null);
    },
    findMany: async ({ where }) => copy(rows.filter((row) => matches(where, row))),
    count: async ({ where }) => rows.filter((row) => matches(where, row)).length,
    create: async ({ data }) => {
      const duplicate = rows.some((row) => (data.id && row.id === data.id) || (name === "workflow"
        ? row.ownerTeacherId === data.ownerTeacherId && row.requestKey === data.requestKey
        : row.workflowId === data.workflowId && (row.revision === data.revision || row.operationKey === data.operationKey)));
      if (duplicate) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      const row = { id: `${name}-${rows.length + 1}`, ...copy(data), checkpoint: data.checkpoint ?? null, activeOperationKey: data.activeOperationKey ?? null };
      if (name === "workflow" && data.revisions?.create) {
        revisions.push({ ...copy(data.revisions.create), id: `revision-${revisions.length + 1}`, workflowId: row.id });
        delete row.revisions;
      }
      rows.push(row);
      return copy(row);
    },
    update: async ({ where, data }) => {
      const row = rows.find((candidate) => matches(where, candidate));
      if (!row) throw new Error("NOT_FOUND");
      Object.assign(row, copy(data));
      return copy(row);
    },
    updateMany: async ({ where, data }) => {
      const selected = rows.filter((row) => matches(where, row));
      for (const row of selected) {
        for (const [field, value] of Object.entries(data)) row[field] = value?.increment ? row[field] + value.increment : copy(value);
      }
      return { count: selected.length };
    }
  });
  const db = { teachingWorkflow: model(workflows, "workflow"), teachingWorkflowRevision: model(revisions, "revision") };
  // No locks or rollback simulation: dedicated PostgreSQL tests cover those properties.
  db.$transaction = async (run) => run(db);
  return db;
}
