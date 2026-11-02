function optionalNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

import { externalRecognitionArchiveBlockers } from "./external-grading-recognition.js";

function questionNo(question, index) {
  return String(question?.questionNo || question?.no || index + 1);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasMistakeEvidence(question) {
  if (!["wrong", "partial"].includes(question?.status)) return true;
  return Boolean(
    hasText(question?.knowledgePoint) &&
    (hasText(question?.errorStep) || hasText(question?.explanation))
  );
}

function isReviewedQuestion(question) {
  const score = optionalNumber(question?.score);
  const maxScore = optionalNumber(question?.maxScore);
  return Boolean(
    question?.reviewedByTeacher === true &&
    question?.status &&
    question.status !== "uncertain" &&
    score != null &&
    maxScore != null &&
    score >= 0 &&
    maxScore > 0 &&
    hasMistakeEvidence(question)
  );
}

export function gradingQuestionReviewState(questions = []) {
  const normalized = Array.isArray(questions) ? questions : [];
  const unresolvedQuestionNos = [];
  let score = 0;
  let reviewed = 0;

  normalized.forEach((question, index) => {
    if (!isReviewedQuestion(question)) {
      unresolvedQuestionNos.push(questionNo(question, index));
      return;
    }
    reviewed += 1;
    score += Number(question.score);
  });

  const readyForArchive = normalized.length > 0 && unresolvedQuestionNos.length === 0;
  return {
    questions: normalized,
    total: normalized.length,
    reviewed,
    unresolved: unresolvedQuestionNos.length,
    unresolvedQuestionNos,
    readyForArchive,
    score: readyForArchive ? Number(score.toFixed(2)) : null
  };
}

// The caller supplies a server-validated source package. Group membership must
// come from that source, never from OCR, question order or a teacher score patch.
export function gradingSourceScoreGroups(questions = [], sourcePackage = null) {
  const source = sourcePackage?.questions;
  if (!Array.isArray(source) || !source.length || !Array.isArray(questions) || questions.length !== source.length) return null;
  const byNo = new Map();
  for (const question of questions) {
    const no = String(question?.questionNo ?? "").trim();
    if (!no || byNo.has(no)) return null;
    byNo.set(no, question);
  }
  const groups = new Map();
  const seen = new Set();
  for (const item of source) {
    const no = String(item?.questionNo ?? "").trim();
    const id = item?.context?.scoreGroup;
    const question = byNo.get(no);
    const maxScore = optionalNumber(item?.maxScore);
    if (!no || seen.has(no) || !question || !["base", "bonus"].includes(id) || maxScore == null || maxScore <= 0 || optionalNumber(question.maxScore) !== maxScore) return null;
    seen.add(no);
    const group = groups.get(id) || { id, label: id === "base" ? "基础" : "附加", score: 0, maxScore: 0, total: 0, reviewed: 0, pending: 0 };
    group.maxScore += maxScore;
    group.total += 1;
    if (isReviewedQuestion(question) && Number(question.score) <= maxScore) {
      group.reviewed += 1;
      group.score += Number(question.score);
    } else {
      group.pending += 1;
    }
    groups.set(id, group);
  }
  for (const id of ["base", "bonus"]) {
    const declared = optionalNumber(sourcePackage[`${id}Score`]);
    if (declared != null && Math.abs(declared - (groups.get(id)?.maxScore || 0)) > 0.001) return null;
  }
  return ["base", "bonus"].filter(id => groups.has(id)).map(id => {
    const group = groups.get(id);
    return { ...group, maxScore: Number(group.maxScore.toFixed(2)), score: group.pending ? null : Number(group.score.toFixed(2)) };
  });
}

export function requireAllQuestionsReviewedForArchive(result = {}, externalPacket = null) {
  const state = gradingQuestionReviewState(result.questionResults);
  if (!state.readyForArchive) {
    return {
      ok: false,
      error: "QUESTIONS_REVIEW_REQUIRED",
      message: state.total
        ? "请逐题确认所有题目的状态、得分和满分；错题和半对题还需补充知识点和错因定位后再归档。"
        : "当前批改结果缺少逐题结果，请重新识别或补录题目后再归档。",
      state
    };
  }
  if (externalPacket) {
    const archiveBlockers = externalRecognitionArchiveBlockers(externalPacket);
    if (archiveBlockers.length) {
      return {
        ok: false,
        error: "EXTERNAL_RECOGNITION_REVIEW_REQUIRED",
        message: "外部练习册仍有答案来源、图片质量或逐题证据未确认，暂不能归档。",
        state,
        archiveBlockers
      };
    }
  }
  return { ok: true, state };
}
