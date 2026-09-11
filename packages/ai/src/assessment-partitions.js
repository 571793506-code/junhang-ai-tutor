import { normalizeTeachingPurpose } from "@junhang/core";

const plans = {
  数学: {
    quiz: [
      { id: "fill", title: "一、填空题", itemTypes: ["fill"], defaultItemCount: 6 },
      { id: "choice", title: "二、选择题", itemTypes: ["choice"], defaultItemCount: 4 },
      { id: "calculation", title: "三、计算题", itemTypes: ["calculation"], defaultItemCount: 4 },
      { id: "solution", title: "四、解答题", itemTypes: ["solution"], defaultItemCount: 4 }
    ],
    practice: [
      { id: "fill", title: "一、基础巩固", itemTypes: ["fill"], defaultItemCount: 4 },
      { id: "choice", title: "二、易错辨析", itemTypes: ["choice"], defaultItemCount: 4 },
      { id: "calculation", title: "三、计算题", itemTypes: ["calculation"], defaultItemCount: 4 },
      { id: "solution", title: "四、解决问题", itemTypes: ["solution"], defaultItemCount: 4 }
    ],
    formal: [
      { id: "fill", title: "一、填空题", itemTypes: ["fill"], defaultItemCount: 12 },
      { id: "choice", title: "二、选择题", itemTypes: ["choice"], defaultItemCount: 8 },
      { id: "calculation", title: "三、计算题", itemTypes: ["calculation"], defaultItemCount: 8 },
      { id: "solution", title: "四、解答题", itemTypes: ["solution"], defaultItemCount: 6 }
    ]
  },
  语文: {
    quiz: [
      { id: "foundation", title: "一、基础知识", itemTypes: ["fill"], defaultItemCount: 8 },
      { id: "application", title: "二、积累与应用", itemTypes: ["solution"], defaultItemCount: 6 },
      { id: "reading", title: "三、阅读理解", itemTypes: ["reading"], defaultItemCount: 6 }
    ],
    practice: [
      { id: "foundation", title: "一、薄弱点巩固", itemTypes: ["fill"], defaultItemCount: 6 },
      { id: "application", title: "二、表达与应用", itemTypes: ["solution"], defaultItemCount: 6 },
      { id: "reading", title: "三、阅读提升", itemTypes: ["reading"], defaultItemCount: 6 }
    ],
    formal: [
      { id: "foundation", title: "一、基础知识", itemTypes: ["fill"], defaultItemCount: 10 },
      { id: "application", title: "二、积累与运用", itemTypes: ["solution"], defaultItemCount: 8 },
      { id: "reading", title: "三、阅读理解", itemTypes: ["reading"], defaultItemCount: 10 },
      { id: "writing", title: "四、写作题", itemTypes: ["writing"], defaultItemCount: 1 }
    ]
  },
  英语: {
    quiz: [
      { id: "vocabulary", title: "一、词汇与短语", itemTypes: ["fill"], defaultItemCount: 8 },
      { id: "sentences", title: "二、句子运用", itemTypes: ["solution"], defaultItemCount: 2 },
      { id: "choice", title: "三、单项选择题", itemTypes: ["choice"], defaultItemCount: 4 },
      { id: "reading", title: "四、阅读理解", itemTypes: ["reading"], defaultItemCount: 6 }
    ],
    practice: [
      { id: "vocabulary", title: "一、针对性词汇巩固", itemTypes: ["fill"], defaultItemCount: 4 },
      { id: "sentences", title: "二、句型表达练习", itemTypes: ["solution"], defaultItemCount: 4 },
      { id: "choice", title: "三、易错选择题", itemTypes: ["choice"], defaultItemCount: 4 },
      { id: "reading", title: "四、短阅读巩固", itemTypes: ["reading"], defaultItemCount: 4 }
    ],
    formal: [
      { id: "language", title: "一、单项选择题", itemTypes: ["choice"], defaultItemCount: 14 },
      { id: "vocabulary", title: "二、词汇运用", itemTypes: ["fill"], defaultItemCount: 14 },
      { id: "reading", title: "三、阅读理解", itemTypes: ["reading"], defaultItemCount: 10 },
      { id: "writing", title: "四、写作", itemTypes: ["writing"], defaultItemCount: 1 }
    ]
  }
};

function wantsListening(input = {}) {
  const text = `${input.requirement || ""} ${input.specialRequirements || ""} ${input.title || ""}`;
  if (/不需要听力|无需听力|不要听力|不含听力|无听力|不用听力|no listening|without listening/i.test(text)) return false;
  return /听力|听音|listening|audio|录音/i.test(text);
}

function allocateItemCounts(partitions, requestedItemCount) {
  const requested = Number(requestedItemCount);
  if (!Number.isFinite(requested) || requested <= 0) return partitions.map((partition) => partition.defaultItemCount);
  const total = partitions.reduce((sum, partition) => sum + partition.defaultItemCount, 0);
  const target = Math.max(partitions.length, Math.round(requested));
  const allocations = partitions.map((partition, index) => {
    const exact = (partition.defaultItemCount / total) * target;
    return { index, count: Math.max(1, Math.round(exact)), remainder: exact - Math.floor(exact) };
  });
  let remaining = target - allocations.reduce((sum, allocation) => sum + allocation.count, 0);
  const order = [...allocations].sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; remaining > 0; index = (index + 1) % order.length) {
    order[index].count += 1;
    remaining -= 1;
  }
  while (remaining < 0) {
    const candidate = [...allocations]
      .filter((allocation) => allocation.count > 1)
      .sort((left, right) => right.count - left.count || left.index - right.index)[0];
    if (!candidate) break;
    candidate.count -= 1;
    remaining += 1;
  }
  return allocations.sort((left, right) => left.index - right.index).map((allocation) => allocation.count);
}

export function buildAssessmentPartitions(input = {}) {
  const { purpose, requestedItemTypes, dayPlan } = normalizeTeachingPurpose(input);
  if (purpose === "explanation") return [{ id: "explanation", title: "知识讲解", itemTypes: [], purpose }];
  if (purpose === "multi_day") return dayPlan.map((day, index) => ({
    id: day.dayId, dayId: day.dayId, title: `第 ${index + 1} 天：${day.goal}`, goal: day.goal,
    itemTypes: day.requestedItemTypes, targetItemCount: day.requestedItemCount, purpose,
    subject: input.subject, kind: input.kind || "练习", orderIndex: index + 1
  }));
  if (purpose === "focused") {
    const total = input.requestedItemCount == null ? requestedItemTypes.length * 4 : Number(input.requestedItemCount);
    return requestedItemTypes.map((type, index) => ({
      id: type, title: `专项 ${index + 1}`, itemTypes: [type], purpose,
      targetItemCount: Math.floor(total / requestedItemTypes.length) + (index < total % requestedItemTypes.length ? 1 : 0),
      subject: input.subject, kind: input.kind || "练习", orderIndex: index + 1
    }));
  }
  const subject = plans[input.subject] ? input.subject : "数学";
  const kind = input.kind === "试卷" ? "formal" : input.kind === "小测" ? "quiz" : "practice";
  const partitions = [...plans[subject][kind]];
  if (subject === "英语" && kind === "formal" && wantsListening(input)) {
    partitions.unshift({ id: "listening", title: "一、听力", itemTypes: ["listening"], defaultItemCount: 8 });
    partitions[1].title = "二、单项选择题";
    partitions[2].title = "三、词汇运用";
    partitions[3].title = "四、阅读理解";
    partitions[4].title = "五、写作";
  }
  const counts = allocateItemCounts(partitions, kind === "formal" ? null : input.requestedItemCount);
  return partitions.map((partition, index) => ({
    ...partition,
    orderIndex: index + 1,
    subject,
    kind: input.kind || "练习",
    targetItemCount: counts[index]
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
