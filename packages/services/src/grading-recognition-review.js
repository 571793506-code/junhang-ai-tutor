import { isDeepStrictEqual } from "node:util";

// Call only with a server-owned snapshot or a validated immutable archive.
// Recognition review verifies transcription, never scores or archive permission.
export function verifiedRecognitionCorrections(questions = [], teacherId) {
  if (typeof teacherId !== "string" || !teacherId.trim()) return [];
  const counts = new Map();
  for (const q of questions) counts.set(String(q.questionNo), (counts.get(String(q.questionNo)) || 0) + 1);
  return questions.filter((q) => q.questionNo != null && counts.get(String(q.questionNo)) === 1 &&
    q.studentAnswer != null && q.studentAnswerReview?.actorTeacherId === teacherId &&
    isDeepStrictEqual(q.studentAnswerReview.studentAnswer, q.studentAnswer))
    .map((q) => ({ questionNo: String(q.questionNo), studentAnswer: structuredClone(q.studentAnswer) }));
}

export function applyVerifiedRecognitionCorrections(input, corrections = []) {
  if (!Array.isArray(input.ocrQuestions)) return input;
  const matches = Array.isArray(corrections) ? corrections : [];
  return { ...input, ocrQuestions: input.ocrQuestions.map((raw) => {
    const { studentAnswerReview, recognitionReview, ...q } = raw;
    const candidates = matches.filter((c) => String(c.questionNo) === String(q.questionNo));
    const unique = input.ocrQuestions.filter((other) => String(other.questionNo) === String(q.questionNo)).length === 1;
    return q.studentAnswer != null && unique && candidates.length === 1 && isDeepStrictEqual(candidates[0].studentAnswer, q.studentAnswer)
      ? { ...q, recognitionReview: { status: "teacher_corrected", field: "studentAnswer" } } : q;
  }) };
}
