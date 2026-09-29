import assert from "node:assert/strict";
import test from "node:test";
import { createAssignmentDraft } from "./repositories.js";
import { buildGradingSourcePackage, gradingSourcePackageToAssignmentItems, normalizeImportedGradingSourcePackage, validateGradingSourcePackage } from "@junhang/core/grading-source-package";

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

test("dialogue registration preserves zero and false answers, source numbers and full context", async () => {
  const context = { itemType: "reading", options: ["甲", "乙"], figure: { type: "rectangle", width: 3, height: 2 },
    sharedMaterial: { id: "m1", title: "分组", text: "第一段。\n第二段。" }, day: { dayId: "d2", goal: "阅读" } };
  const original = buildGradingSourcePackage({ id: "dialogue-original", title: "合成导入样本", grade: "四年级",
    metadata: { subject: "数学", kind: "练习" }, items: [0, false].map((answer, i) => ({
      orderIndex: `2-${i + 1}`, prompt: "根据材料作答", answer, score: 2, sourceContext: context
    })) }, { version: 7 }).package;
  const normalized = normalizeImportedGradingSourcePackage(original, { sourceId: "assignment-new" });
  let stored;
  const prisma = {
    subject: { async findFirst() { return { id: "math" }; } },
    assignment: {
      async create({ data }) {
        stored = { ...data, items: data.items.create.map((item) => ({ ...item, id: `item-${item.orderIndex}` })) };
        return structuredClone(stored);
      },
      async update({ data }) { stored.metadata = data.metadata; return structuredClone(stored); }
    },
    async $transaction(callback) { return callback(this); }
  };
  const registered = await createAssignmentDraft({ id: "assignment-new", title: normalized.package.title, subject: "数学", grade: "四年级",
    metadata: { subject: "数学", kind: "练习", totalScore: 4, gradingSourcePackageRequested: true },
    items: gradingSourcePackageToAssignmentItems(normalized.package) }, { prisma });
  const source = registered.metadata.gradingSourcePackage;
  assert.deepEqual(source.questions.map((q) => q.correctAnswer), [0, false]);
  assert.deepEqual(source.questions.map((q) => q.questionNo), ["2-1", "2-2"]);
  assert.deepEqual(source.questions.map((q) => q.context), [context, context]);
  assert.deepEqual(registered.items.map((q) => q.metadata.showPassage), [true, false]);
  assert.equal(source.version, 1); // Registration creates a new Assignment identity.
  assert.notEqual(source.fingerprint, original.fingerprint);
  assert.equal(validateGradingSourcePackage(source).ok, true);
  assert.deepEqual(normalizeImportedGradingSourcePackage(JSON.parse(JSON.stringify(source))).package, source);
  assert.equal(registered.metadata.generationReview, undefined);
});
