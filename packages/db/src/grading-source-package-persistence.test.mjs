import assert from "node:assert/strict";
import test from "node:test";
import { createAssignmentDraft } from "./repositories.js";

test("generated assessment drafts persist a canonical grading source package", async () => {
  const writes = [];
  const prisma = {
    subject: {
      async findFirst() {
        return { id: "subject-math" };
      }
    },
    assignment: {
      async create({ data }) {
        writes.push({ type: "create", data });
        return {
          id: "assignment-source-2",
          title: data.title,
          grade: data.grade,
          metadata: data.metadata,
          items: data.items.create.map((item) => ({ ...item, id: `item-${item.orderIndex}` }))
        };
      },
      async update({ data }) {
        writes.push({ type: "update", data });
        return {
          id: "assignment-source-2",
          metadata: data.metadata,
          items: []
        };
      }
    },
    async $transaction(callback) {
      return callback(this);
    }
  };

  const assignment = await createAssignmentDraft({
    subject: "数学",
    title: "计算练习",
    grade: "五年级",
    items: [
      {
        itemType: "calculation",
        prompt: "计算 36 x 4。",
        answer: "144",
        rubric: "列竖式计算。",
        metadata: { score: 4, analysisSteps: ["列式", "计算"], knowledgePoint: "乘法" }
      },
      {
        itemType: "calculation",
        prompt: "计算 72 - 18。",
        answer: "54",
        rubric: "注意借位。",
        metadata: { score: 6, analysisSteps: ["借位", "计算"], knowledgePoint: "减法" }
      }
    ],
    metadata: {
      subject: "数学",
      kind: "练习",
      totalScore: 10,
      gradingSourcePackageRequested: true
    }
  }, { prisma });

  assert.equal(writes.length, 2);
  assert.equal(writes[0].data.metadata.gradingSourcePackageRequested, undefined);
  assert.equal(assignment.metadata.gradingSourcePackage.sourceId, "assignment-source-2");
  assert.equal(assignment.metadata.gradingSourcePackage.questions[1].correctAnswer, "54");
  assert.equal(assignment.metadata.gradingSourcePackage.questions[1].maxScore, 6);
});

test("invalid grading sources roll back the assignment write", async () => {
  let rolledBack = false;
  const transactionalPrisma = {
    subject: {
      async findFirst() {
        return { id: "subject-math" };
      }
    },
    assignment: {
      async create() {
        throw new Error("assignment creation must use the transaction client");
      }
    },
    async $transaction(callback) {
      const tx = {
        assignment: {
          async create({ data }) {
            return {
              id: "assignment-invalid-source",
              title: data.title,
              grade: data.grade,
              metadata: data.metadata,
              items: data.items.create.map((item) => ({ ...item, id: `item-${item.orderIndex}` }))
            };
          },
          async update() {
            throw new Error("invalid sources must not be updated");
          }
        }
      };
      try {
        return await callback(tx);
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    }
  };

  await assert.rejects(
    createAssignmentDraft({
      subject: "数学",
      title: "缺少答案的练习",
      grade: "五年级",
      items: [{ itemType: "calculation", prompt: "计算 36 x 4。", metadata: { score: 10 } }],
      metadata: { subject: "数学", kind: "练习", totalScore: 10, gradingSourcePackageRequested: true }
    }, { prisma: transactionalPrisma }),
    (error) => error?.code === "GRADING_SOURCE_PACKAGE_INVALID"
  );

  assert.equal(rolledBack, true);
});
