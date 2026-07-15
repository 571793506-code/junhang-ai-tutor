function readableText(value, fallback = "") {
  const text = String(value ?? "").trim();
  if (!text || /\?{2,}/.test(text)) return fallback;
  return text;
}

export function cleanVocabularyEntryForStudent(entry = {}) {
  const card = entry.card && typeof entry.card === "object" ? entry.card : {};
  const related = Array.isArray(card.related)
    ? card.related
      .map((item) => ({
        word: readableText(item?.word),
        part: readableText(item?.part),
        partCn: readableText(item?.partCn),
        meaning: readableText(item?.meaning)
      }))
      .filter((item) => item.word)
    : [];
  const examples = Array.isArray(card.examples)
    ? card.examples.map((item) => readableText(item)).filter(Boolean)
    : [];
  return {
    id: String(entry.id || ""),
    word: readableText(entry.word || card.word, "word"),
    card: {
      word: readableText(card.word || entry.word, "word"),
      phonetic: readableText(card.phonetic),
      part: readableText(card.part),
      partCn: readableText(card.partCn),
      meaning: readableText(card.meaning),
      related,
      examples,
      pitfall: readableText(card.pitfall)
    }
  };
}
