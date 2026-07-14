import assert from "node:assert/strict";
import test from "node:test";

import { filterNewReviewedMistakes } from "./grading-mistake-archive.js";

test("does not rearchive dialogue-confirmed questions from the same submission", () => {
  const reviewedMistakes = [
    { prompt: "第2题：乘法计算", metadata: { questionNos: ["2"] } },
    { prompt: "第3题：乘法计算", metadata: { questionNos: ["3"] } },
    { prompt: "第5题：除法计算", metadata: { questionNos: ["5"] } }
  ];
  const existingMistakes = [{
    metadata: {
      sourceSubmissionId: "submission-1",
      questionNos: ["2", "3"],
      archiveSource: "teacher-dialogue-archive"
    }
  }];

  assert.deepEqual(
    filterNewReviewedMistakes(existingMistakes, reviewedMistakes, "submission-1"),
    [{ prompt: "第5题：除法计算", metadata: { questionNos: ["5"] } }]
  );
});

test("keeps reviewed mistakes when the archived evidence belongs to another submission", () => {
  const reviewedMistakes = [{ prompt: "第2题：乘法计算", metadata: { questionNos: ["2"] } }];
  const existingMistakes = [{ metadata: { sourceSubmissionId: "submission-other", questionNos: ["2"] } }];

  assert.deepEqual(
    filterNewReviewedMistakes(existingMistakes, reviewedMistakes, "submission-1"),
    reviewedMistakes
  );
});
