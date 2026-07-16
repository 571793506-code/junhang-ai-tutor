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

function text(value) {
  return String(value ?? "").trim();
}

function textList(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

export function normalizeDictionaryTerm(value) {
  const term = text(value).toLowerCase();
  return /^[a-z]+(?:['-][a-z]+)*$/.test(term) ? term : "";
}

export function normalizeDictionaryDraft(queryTerm, draft = {}) {
  return {
    schemaVersion: text(draft.schemaVersion),
    queryTerm: normalizeDictionaryTerm(draft.queryTerm || queryTerm),
    headword: normalizeDictionaryTerm(draft.headword),
    phonetic: text(draft.phonetic),
    queryRelation: {
      type: text(draft.queryRelation?.type),
      label: text(draft.queryRelation?.label)
    },
    parts: Array.isArray(draft.parts) ? draft.parts.map((item) => ({
      part: text(item?.part),
      partCn: text(item?.partCn),
      meanings: textList(item?.meanings)
    })).filter((item) => item.part && item.partCn && item.meanings.length) : [],
    forms: Array.isArray(draft.forms) ? draft.forms.map((item) => ({
      term: normalizeDictionaryTerm(item?.term),
      type: text(item?.type),
      label: text(item?.label)
    })).filter((item) => item.term) : [],
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
