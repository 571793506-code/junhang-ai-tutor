const plans = {
  数学: {
    compact: [
      { id: "foundation-calculation", title: "基础概念与计算", itemTypes: ["fill", "choice", "calculation"] },
      { id: "application", title: "解决问题", itemTypes: ["solution", "operation"] }
    ],
    formal: [
      { id: "foundation", title: "基础概念", itemTypes: ["fill", "choice", "judgment"] },
      { id: "calculation", title: "计算能力", itemTypes: ["calculation"] },
      { id: "application", title: "解决问题", itemTypes: ["solution"] },
      { id: "operation", title: "图形与操作", itemTypes: ["operation", "solution"] }
    ]
  },
  语文: {
    compact: [
      { id: "foundation-application", title: "基础知识与积累运用", itemTypes: ["fill", "choice", "solution"] },
      { id: "reading", title: "阅读理解", itemTypes: ["reading"] }
    ],
    formal: [
      { id: "foundation", title: "基础知识", itemTypes: ["fill", "choice"] },
      { id: "application", title: "积累与运用", itemTypes: ["fill", "solution"] },
      { id: "reading", title: "阅读理解", itemTypes: ["reading"] },
      { id: "writing", title: "习作表达", itemTypes: ["writing"] }
    ]
  },
  英语: {
    compact: [
      { id: "language", title: "词汇、句型与辨析", itemTypes: ["fill", "choice", "solution"] },
      { id: "reading", title: "阅读理解", itemTypes: ["reading"] }
    ],
    formal: [
      { id: "language", title: "语言知识", itemTypes: ["choice"] },
      { id: "vocabulary", title: "词汇运用", itemTypes: ["fill"] },
      { id: "reading", title: "阅读理解", itemTypes: ["reading"] },
      { id: "writing", title: "书面表达", itemTypes: ["writing"] }
    ]
  }
};

export function buildAssessmentPartitions(input = {}) {
  const subject = plans[input.subject] ? input.subject : "数学";
  const tier = input.kind === "试卷" ? "formal" : "compact";
  return plans[subject][tier].map((partition, index) => ({
    ...partition,
    orderIndex: index + 1,
    subject,
    kind: input.kind || "练习"
  }));
}

export async function mapWithConcurrency(items, concurrency, worker) {
  const source = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(source.length || 1, Number(concurrency) || 1));
  const results = new Array(source.length);
  let nextIndex = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (nextIndex < source.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(source[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
