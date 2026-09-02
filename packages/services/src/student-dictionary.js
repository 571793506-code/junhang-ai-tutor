import { generateStudentDictionaryDraft } from "@junhang/ai";
import { inspectEncodingPayload } from "@junhang/core";
import {
  findDictionaryEntryByTerm,
  recordModelRun,
  upsertDictionaryEntryWithAliases
} from "@junhang/db";

export const DICTIONARY_SCHEMA_VERSION = "student-dictionary-entry-v1";
export const DICTIONARY_RELATION_TYPES = new Set([
  "headword",
  "plural",
  "third_person",
  "past",
  "past_participle",
  "present_participle",
  "comparative",
  "superlative",
  "irregular"
]);

const DICTIONARY_RELATION_ALIASES = new Map([
  ["base-form", "headword"],
  ["base", "headword"],
  ["lemma", "headword"],
  ["third-person-singular-present", "third_person"],
  ["third-person-singular", "third_person"],
  ["simple-past", "past"],
  ["past-tense", "past"],
  ["past-participle", "past_participle"],
  ["present-participle", "present_participle"],
  ["present-participle-gerund", "present_participle"],
  ["gerund", "present_participle"],
  ["past-tense-and-past-participle", "past"]
]);

function text(value) {
  if (value && typeof value === "object") return "";
  const result = String(value ?? "").trim();
  return result === "[object Object]" ? "" : result;
}

function textList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") return text(item);
    for (const key of ["meaning", "meaningCn", "translation", "text", "definition", "cn", "zh", "label", "value"]) {
      const candidate = text(item[key]);
      if (candidate) return candidate;
    }
    return "";
  }).filter(Boolean);
}

export function normalizeDictionaryTerm(value) {
  const term = text(value).toLowerCase();
  return /^[a-z]+(?:['-][a-z]+)*$/.test(term) ? term : "";
}

export function normalizeDictionaryRelationType(type, label = "", context = {}) {
  const rawType = text(type).toLowerCase();
  if (DICTIONARY_RELATION_TYPES.has(rawType)) return rawType;
  const aliased = DICTIONARY_RELATION_ALIASES.get(rawType);
  if (aliased) return aliased;
  if (rawType === "inflected-form" || rawType === "inflected") {
    const relationLabel = text(label);
    if (/第三人称|三单/.test(relationLabel)) return "third_person";
    if (/过去式/.test(relationLabel)) return "past";
    if (/过去分词/.test(relationLabel)) return "past_participle";
    if (/现在分词|动名词/.test(relationLabel)) return "present_participle";
    if (/比较级/.test(relationLabel)) return "comparative";
    if (/最高级/.test(relationLabel)) return "superlative";
    if (/复数/.test(relationLabel)) return "plural";
    if (context.term && context.term === context.headword) return "headword";
  }
  return "";
}

export function normalizeDictionaryDraft(queryTerm, draft = {}) {
  const normalizedQuery = normalizeDictionaryTerm(draft.queryTerm || queryTerm);
  const headword = normalizeDictionaryTerm(draft.headword);
  const rawForms = Array.isArray(draft.forms) ? draft.forms : [];
  const forms = rawForms.flatMap((item) => {
    const term = normalizeDictionaryTerm(item?.term);
    const rawType = text(item?.type).toLowerCase();
    const label = text(item?.label);
    if (!term) return [];
    if (rawType === "past-tense-and-past-participle" || /过去式和过去分词/.test(label)) {
      return [
        { term, type: "past", label: label || "过去式" },
        { term, type: "past_participle", label: label || "过去分词" }
      ];
    }
    return [{
      term,
      type: normalizeDictionaryRelationType(rawType, label, { term, queryTerm: normalizedQuery, headword }),
      label
    }];
  });
  let queryRelationType = normalizeDictionaryRelationType(
    draft.queryRelation?.type,
    draft.queryRelation?.label,
    { term: normalizedQuery, queryTerm: normalizedQuery, headword }
  );
  if (!queryRelationType && normalizedQuery !== headword) {
    queryRelationType = forms.find((item) => item.term === normalizedQuery)?.type || "";
  }
  return {
    schemaVersion: text(draft.schemaVersion),
    queryTerm: normalizedQuery,
    headword,
    phonetic: text(draft.phonetic),
    queryRelation: {
      type: queryRelationType,
      label: text(draft.queryRelation?.label)
    },
    parts: Array.isArray(draft.parts) ? draft.parts.map((item) => ({
      part: text(item?.part),
      partCn: text(item?.partCn),
      meanings: textList(item?.meanings)
    })).filter((item) => item.part && item.partCn && item.meanings.length) : [],
    forms,
    wordFamily: Array.isArray(draft.wordFamily) ? draft.wordFamily.map((item) => ({
      word: normalizeDictionaryTerm(item?.word),
      partCn: text(item?.partCn),
      meaning: text(item?.meaning)
    })).filter((item) => item.word && item.partCn && item.meaning) : [],
    synonyms: Array.isArray(draft.synonyms) ? draft.synonyms.map((item) => ({
      word: normalizeDictionaryTerm(item?.word),
      meaning: text(item?.meaning),
      difference: text(item?.difference)
    })).filter((item) => item.word && item.meaning) : [],
    antonyms: Array.isArray(draft.antonyms) ? draft.antonyms.map((item) => ({
      word: normalizeDictionaryTerm(item?.word),
      meaning: text(item?.meaning)
    })).filter((item) => item.word && item.meaning) : [],
    collocations: Array.isArray(draft.collocations) ? draft.collocations.map((item) => ({
      phrase: text(item?.phrase),
      meaning: text(item?.meaning)
    })).filter((item) => item.phrase && item.meaning) : [],
    examples: Array.isArray(draft.examples) ? draft.examples.map((item) => ({
      sentence: text(item?.sentence),
      translation: text(item?.translation)
    })).filter((item) => item.sentence && item.translation) : [],
    usageNotes: textList(draft.usageNotes),
    pitfalls: textList(draft.pitfalls)
  };
}

export function sharedDictionaryCard(card) {
  const { queryTerm: _queryTerm, queryRelation: _queryRelation, ...shared } = card;
  return shared;
}

export function validateDictionaryDraft(queryTerm, draft) {
  const query = normalizeDictionaryTerm(queryTerm);
  const card = normalizeDictionaryDraft(query, draft);
  const issues = [];
  if (!query) issues.push("invalid-query");
  if (card.queryTerm !== query) issues.push("query-term-mismatch");
  if (card.schemaVersion !== DICTIONARY_SCHEMA_VERSION) issues.push("invalid-schema-version");
  if (!card.headword || !card.phonetic) issues.push("missing-headword-or-phonetic");
  if (!card.parts.length) issues.push("missing-parts");
  if (card.examples.length < 2) issues.push("missing-bilingual-examples");
  if (!DICTIONARY_RELATION_TYPES.has(card.queryRelation.type) || !card.queryRelation.label) {
    issues.push("invalid-query-relation");
  }
  if (query === card.headword && card.queryRelation.type !== "headword") {
    issues.push("headword-relation-mismatch");
  }
  if (query !== card.headword) {
    const matchingForm = card.forms.find((item) =>
      item.term === query && item.type === card.queryRelation.type && item.label
    );
    if (!matchingForm) issues.push("query-form-not-explained");
  }
  if (card.forms.some((item) => !DICTIONARY_RELATION_TYPES.has(item.type) || !item.label)) {
    issues.push("invalid-form");
  }
  if (!inspectEncodingPayload(card).ok) issues.push("invalid-encoding");
  return { ok: issues.length === 0, issues, card };
}

export function buildDictionaryAliases(queryTerm, card) {
  const query = normalizeDictionaryTerm(queryTerm);
  const aliases = new Map();
  aliases.set(card.headword, {
    term: card.headword,
    relationType: "headword",
    relationLabel: `${card.headword} 的原形`
  });
  for (const form of card.forms) {
    if (!aliases.has(form.term)) {
      aliases.set(form.term, {
        term: form.term,
        relationType: form.type,
        relationLabel: `${form.term} 是 ${card.headword} 的${form.label}`
      });
    }
  }
  if (query !== card.headword) {
    const queryForm = card.forms.find((item) =>
      item.term === query && item.type === card.queryRelation.type
    );
    if (queryForm) {
      aliases.set(query, {
        term: query,
        relationType: card.queryRelation.type,
        relationLabel: card.queryRelation.label
      });
    }
  }
  return [...aliases.values()];
}

export function buildStudentDictionaryEntry(card, alias) {
  return {
    ...sharedDictionaryCard(card),
    queryRelation: {
      term: alias.term,
      headword: card.headword,
      type: alias.relationType,
      label: alias.relationLabel
    }
  };
}

function unavailableResult() {
  return {
    ok: false,
    error: "DICTIONARY_QUERY_UNAVAILABLE",
    message: "暂时无法完成查询，请稍后重试。"
  };
}

export async function queryStudentDictionaryService(config, input = {}, options = {}) {
  const term = normalizeDictionaryTerm(input.word);
  if (!term) {
    return { ok: false, error: "DICTIONARY_WORD_INVALID", message: "请输入英文单词。" };
  }

  const findEntry = options.findEntry || findDictionaryEntryByTerm;
  const generateDraft = options.generateDraft || generateStudentDictionaryDraft;
  const saveEntry = options.saveEntry || upsertDictionaryEntryWithAliases;
  const recordRun = options.recordRun || recordModelRun;

  let cached = null;
  try {
    cached = await findEntry(term, { prisma: options.prisma });
  } catch {
    return unavailableResult();
  }

  if (cached?.entry?.card) {
    const validated = validateDictionaryDraft(term, {
      ...cached.entry.card,
      queryTerm: term,
      queryRelation: {
        type: cached.relationType,
        label: cached.relationLabel
      }
    });
    if (validated.ok) {
      return { ok: true, entry: buildStudentDictionaryEntry(validated.card, cached) };
    }
  }

  let generated = null;
  try {
    generated = await generateDraft(config, { word: term });
    if (generated.modelRun && options.persist !== false) {
      await recordRun(generated.modelRun, { prisma: options.prisma });
    }
  } catch {
    return unavailableResult();
  }
  if (!generated?.available || !generated.draft) return unavailableResult();

  const validated = validateDictionaryDraft(term, generated.draft);
  if (!validated.ok) return unavailableResult();
  const aliases = buildDictionaryAliases(term, validated.card);
  const queryAlias = aliases.find((item) => item.term === term);
  if (!queryAlias) return unavailableResult();

  if (options.persist !== false) {
    try {
      await saveEntry({
        headword: validated.card.headword,
        schemaVersion: DICTIONARY_SCHEMA_VERSION,
        card: sharedDictionaryCard(validated.card),
        aliases
      }, { prisma: options.prisma });
    } catch {
      return unavailableResult();
    }
  }

  return { ok: true, entry: buildStudentDictionaryEntry(validated.card, queryAlias) };
}
