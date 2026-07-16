function value(input) {
  return String(input ?? "").trim();
}

function list(input, map) {
  return Array.isArray(input) ? input.map(map).filter(Boolean) : [];
}

export function cleanStudentDictionaryEntry(entry = {}) {
  return {
    schemaVersion: value(entry.schemaVersion),
    headword: value(entry.headword),
    phonetic: value(entry.phonetic),
    queryRelation: {
      term: value(entry.queryRelation?.term),
      headword: value(entry.queryRelation?.headword),
      type: value(entry.queryRelation?.type),
      label: value(entry.queryRelation?.label)
    },
    parts: list(entry.parts, (item) => ({
      part: value(item?.part),
      partCn: value(item?.partCn),
      meanings: list(item?.meanings, value)
    })),
    forms: list(entry.forms, (item) => ({
      term: value(item?.term),
      type: value(item?.type),
      label: value(item?.label)
    })),
    wordFamily: list(entry.wordFamily, (item) => ({
      word: value(item?.word),
      partCn: value(item?.partCn),
      meaning: value(item?.meaning)
    })),
    synonyms: list(entry.synonyms, (item) => ({
      word: value(item?.word),
      meaning: value(item?.meaning),
      difference: value(item?.difference)
    })),
    antonyms: list(entry.antonyms, (item) => ({
      word: value(item?.word),
      meaning: value(item?.meaning)
    })),
    collocations: list(entry.collocations, (item) => ({
      phrase: value(item?.phrase),
      meaning: value(item?.meaning)
    })),
    examples: list(entry.examples, (item) => ({
      sentence: value(item?.sentence),
      translation: value(item?.translation)
    })),
    usageNotes: list(entry.usageNotes, value),
    pitfalls: list(entry.pitfalls, value)
  };
}
