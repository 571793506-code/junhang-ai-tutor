const vocabularyBank = {
  carry: {
    term: "carry",
    meaning: "携带；运送；承载",
    partOfSpeech: "v.",
    collocations: ["carry a bag", "carry out a plan", "carry on"],
    examples: [
      "I carry my lunch box to school.",
      "We should carry out the plan carefully."
    ],
    pitfalls: ["第三人称单数：carry -> carries", "过去式/过去分词：carry -> carried", "现在分词：carry -> carrying", "不要和 bring 完全等同"]
  },
  bright: {
    term: "bright",
    meaning: "明亮的；聪明的",
    partOfSpeech: "adj.",
    collocations: ["bright light", "bright idea", "bright smile"],
    examples: [
      "The classroom is bright.",
      "She has a bright idea."
    ],
    pitfalls: ["比较级：bright -> brighter", "最高级：bright -> brightest", "既可以形容光，也可以形容人聪明"]
  }
};

export function composeDemoQaAnswer(question, studentName = "学生") {
  const normalized = question.trim();
  const asksPastTense = /过去式|went|go|yesterday/i.test(normalized);
  const asksGeometry = /三角形|等腰|角度/.test(normalized);

  if (asksGeometry) {
    return {
      providerId: "deepseek",
      headline: "先判断已知角的位置，再分别列情况。",
      steps: [
        "如果 40° 是顶角，两个底角相等，各是 (180° - 40°) ÷ 2 = 70°。",
        "如果 40° 是底角，另一个底角也是 40°，顶角是 100°。",
        "等腰三角形题目没有说明角的位置时，要做分类讨论。"
      ],
      practice: "练一题：等腰三角形一个角是 50°，其他两个角可能是多少？",
      note: `${studentName} 最近在这个点上容易只算一种情况，答题前先写“分两种情况”。`
    };
  }

  if (asksPastTense) {
    return {
      providerId: "deepseek",
      headline: "看到 yesterday，先把动词切到过去式。",
      steps: [
        "先找时间词：yesterday 表示过去发生的事。",
        "再找动词原形：go 的过去式是不规则变化 went。",
        "句子答案是：Yesterday I went to school by bus."
      ],
      practice: "再练一句：Last Sunday, she ____ (visit) her grandparents.",
      note: `${studentName} 可以把常见不规则动词单独做成小卡片。`
    };
  }

  return {
    providerId: "deepseek",
    headline: "先把问题拆成知识点、例子和练习三步。",
    steps: [
      "用自己的话说出题目在问什么。",
      "找出关键词和已知条件。",
      "做一道同类小题确认是否真的会了。"
    ],
    practice: "把你要问的题目贴完整，我会按六年级能理解的方式拆解。",
    note: "先按固定答疑模板演示，正式接入后会生成更贴合学生记录的回答。"
  };
}

export function composeDemoVocabularyAnswer(term) {
  const key = term.trim().toLowerCase();
  return vocabularyBank[key] || {
    term: term.trim() || "carry",
    meaning: "演示词条未收录，正式接入后会生成对应解释。",
    partOfSpeech: "n./v./adj.",
    collocations: ["核心搭配 1", "核心搭配 2", "考试常见搭配"],
    examples: ["Please put the word into a simple sentence."],
    pitfalls: ["先确认词性，再写句子。", "动词要注意三单、过去式和现在分词变化。"]
  };
}
