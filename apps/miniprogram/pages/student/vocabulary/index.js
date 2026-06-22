const dictionary = {
  carry: {
    term: "carry",
    partOfSpeech: "v.",
    partOfSpeechCn: "动词",
    meaning: "搬、拿、携带。常见易错点是第三人称单数和过去式。",
    changes: [
      { label: "第三人称单数", value: "carries：y 变 i 再加 es" },
      { label: "过去式 / 过去分词", value: "carried：y 变 i 再加 ed" },
      { label: "现在分词", value: "carrying：直接加 ing" }
    ]
  },
  bright: {
    term: "bright",
    partOfSpeech: "adj.",
    partOfSpeechCn: "形容词",
    meaning: "明亮的、聪明的。注意比较级和最高级。",
    changes: [
      { label: "比较级", value: "brighter" },
      { label: "最高级", value: "brightest" }
    ]
  },
  go: {
    term: "go",
    partOfSpeech: "v.",
    partOfSpeechCn: "动词",
    meaning: "去、走。是不规则动词。",
    changes: [
      { label: "过去式", value: "went" },
      { label: "过去分词", value: "gone" },
      { label: "第三人称单数", value: "goes" }
    ]
  }
};

function fallback(term) {
  return {
    term: term || "word",
    partOfSpeech: "n.",
    partOfSpeechCn: "名词",
    meaning: "这个词还没有加入本地词库，后续会接入 AI 词汇解释。",
    changes: [
      { label: "复数", value: "通常加 s，特殊变化需要单独记忆" }
    ]
  };
}

Page({
  data: {
    result: dictionary.carry,
    term: "carry"
  },
  setTerm(event) {
    this.setData({ term: event.detail.value });
  },
  lookup() {
    const key = this.data.term.trim().toLowerCase();
    this.setData({ result: dictionary[key] || fallback(this.data.term.trim()) });
  }
});
