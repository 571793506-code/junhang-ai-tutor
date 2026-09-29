// Plan scores before content generation. Never rescale an existing rubric.
export function allocateAssessmentScores(types, { subject, kind } = {}) {
  const exam = kind === "试卷";
  const total = exam ? 100 : 60;
  const scores = types.map((type) => {
    if (subject === "数学") return ["fill", "choice"].includes(type) ? (exam ? 2 : 3) : type === "calculation" ? (exam ? 5 : 6) : (exam ? 6 : 8);
    if (subject === "语文") return type === "fill" ? 3 : type === "writing" ? 30 : type === "reading" ? (exam ? 4 : 5) : 4;
    return subject === "英语" ? (exam && type === "writing" ? 20 : 2) : 3;
  });
  let indexes = types.flatMap((type, i) => type !== "writing" ? [i] : []);
  if (!indexes.length) indexes = types.map((_, i) => i);
  let difference = total - scores.reduce((sum, score) => sum + score, 0);
  if (!scores.length || scores.length > total) throw new Error("ASSESSMENT_SCORE_ALLOCATION_INVALID");
  let cursor = indexes.length - 1;
  while (difference) {
    const index = indexes[cursor];
    if (difference > 0) { scores[index]++; difference--; }
    else if (scores[index] > 1) { scores[index]--; difference++; }
    else if (indexes.every((i) => scores[i] <= 1)) throw new Error("ASSESSMENT_SCORE_ALLOCATION_INVALID");
    cursor = cursor ? cursor - 1 : indexes.length - 1;
  }
  return scores;
}

// Check explicit, unambiguous statements only. Alternative methods/partial-credit
// prose cannot safely be summed by regex and still requires teacher review.
export function assessmentScoreIssues(item = {}) {
  const score = item.score ?? item.metadata?.score;
  if (!Number.isFinite(score) || score <= 0) return ["item_score_missing"];
  const issues = [];
  const prompt = String(item.prompt || "");
  const stated = [...prompt.matchAll(/[（(]\s*(\d+(?:\.\d+)?)\s*分\s*[）)]/g)].map((m) => Number(m[1]));
  if (stated.some((value) => Math.abs(value - score) > 0.001)) issues.push("prompt_score_conflict");
  const rubric = typeof item.rubric === "string" ? item.rubric : "";
  const explicit = [...rubric.matchAll(/(?:满分|总分|合计|共)\s*(\d+(?:\.\d+)?)\s*分/g)].map((m) => Number(m[1]));
  if (explicit.some((value) => Math.abs(value - score) > 0.001)) issues.push("rubric_score_conflict");
  const firstSentence = rubric.split(/[。\n]/)[0];
  const clauses = firstSentence.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
  const points = clauses.map((s) => s.match(/得\s*(\d+(?:\.\d+)?)\s*分$/));
  if (clauses.length > 1 && points.every(Boolean) && !/扣|或|只有|最多|最高|每|各|其余/.test(firstSentence)) {
    // A clause can contain several awards, e.g. "列式得2分，计算得1分".
    // Its final award is not the clause subtotal; count all explicit awards.
    const awards = [...firstSentence.matchAll(/得\s*(\d+(?:\.\d+)?)\s*分/g)];
    const sum = awards.reduce((total, m) => total + Number(m[1]), 0);
    if (Math.abs(sum - score) > 0.001) issues.push("rubric_score_conflict");
  }
  const objective = ["choice", "fill", "judgment"].includes(item.itemType);
  if (["calculation", "solution"].includes(item.itemType)) {
    const processAward = [...rubric.matchAll(/(?:方法|过程|步骤|列式|思路)(?:与运算关系|正确)?(?:分)?(?:\s*(?:得|给|占))?\s*(\d+(?:\.\d+)?)\s*分/g)]
      .some((match) => Number(match[1]) > 0);
    const resultOnlyFullCredit = rubric.split(/[。；;\n]/).some((clause) => {
      if (!/(?:只|仅)写(?:正确)?(?:结果|答案)/.test(clause)) return false;
      const award = clause.match(/(?:得|给)\s*(\d+(?:\.\d+)?)\s*分/);
      if (award && /(?:不|未|不能|不应|不可)\s*$/.test(clause.slice(0, award.index))) return false;
      return award && Number(award[1]) >= score;
    });
    if (processAward && resultOnlyFullCredit) issues.push("rubric_process_conflict");
  }
  // Explanations may contain steps; only explicit process awards in the rubric conflict.
  if (objective && rubric.split(/[。；;\n]/).some((clause) =>
    /(?:^|[，,\s])按[^。；;]*(?:过程|步骤)[^。；;]*(?:判分|评分|给分)/.test(clause) ||
    /(?:过程|步骤|列式|思路)[^，,。；;]{0,12}(?:得|给|占)\s*\d+(?:\.\d+)?\s*分/.test(clause))) issues.push("rubric_process_conflict");
  if (objective && !/错|未|不|漏|只|部分/.test(clauses[0] || "") && /^(?:选|填|答).+得\s*\d+(?:\.\d+)?\s*分$/.test(clauses[0] || "") && points[0] && Number(points[0][1]) !== score) issues.push("rubric_score_conflict");
  return [...new Set(issues)];
}
