const TRANSIENT_STATUS = new Set([408, 500, 502, 503, 504, 524]);
const TRANSIENT_CODE = /\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)\b/i;
const CONFIGURATION_CODE = /insufficient_quota|context_length|invalid_(api_)?key|invalid_request|model_not_found/i;
const ACCOUNT_CONFIGURATION = /quota|usage[_\s-]*limit|spending[_\s-]*limit|plan[_-]+limit|\bplan\b|subscription|balance|billing|额度|余额|账户/i;

export function describeModelError(error = {}) {
  const message = String(error?.message || error || "");
  const status = Number(error?.status || message.match(/^\s*(\d{3})\b/)?.[1]) || null;
  const code = String(error?.code || error?.cause?.code || "").trim() || null;
  return { message, status, code };
}

export function classifySolEscalationError(error = {}) {
  const detail = describeModelError(error);
  const text = `${detail.code || ""} ${detail.message}`;
  const quotaOrConfig =
    detail.status === 401 ||
    detail.status === 403 ||
    CONFIGURATION_CODE.test(text) ||
    ACCOUNT_CONFIGURATION.test(text);

  if (quotaOrConfig) {
    return {
      allowed: false,
      triggerClass: "configuration",
      triggerCode: detail.code || String(detail.status || "configuration")
    };
  }

  const transient429 =
    detail.status === 429 && /rate[_\s-]*limit|capacity|concurr|限流|并发|拥塞/i.test(text);
  const transient =
    /MODEL_TIMEOUT/i.test(text) ||
    TRANSIENT_STATUS.has(detail.status) ||
    transient429 ||
    detail.code === "invalid_upstream_response" ||
    TRANSIENT_CODE.test(text);

  return transient
    ? {
        allowed: true,
        triggerClass: "availability",
        triggerCode: detail.code || String(detail.status || "network")
      }
    : {
        allowed: false,
        triggerClass: "configuration",
        triggerCode: detail.code || String(detail.status || "configuration")
      };
}

export function solEscalationEnabled(runtime = {}) {
  return (
    runtime.gpt56SolFallbackEnabled === true &&
    runtime.gpt56ReasoningEffortEnabled === true &&
    Boolean(runtime.gpt56SolModel)
  );
}

export function assessmentReadingRequirements(partition = {}) {
  const english = partition.subject === "英语";
  const comprehensive = !partition.purpose || partition.purpose === "comprehensive";
  const formal = partition.kind === "试卷";
  const practice = partition.kind === "练习";
  const minimumGroups = comprehensive && english && formal ? 2 : 1;
  const minimumGroupLength = english ? formal ? 280 : practice ? 150 : 120 : formal ? 700 : 550;
  const contextualDefault = english ? formal ? 6 : practice ? 3 : 4 : 4;
  // Comprehensive English must also meet the service's existing reading gate.
  const contextualTarget = english && comprehensive ? 6 : contextualDefault;
  return {
    lengthUnit: english ? "words" : "chineseCharacters", minimumGroups, minimumGroupLength,
    minimumTotalLength: minimumGroupLength * minimumGroups,
    minimumContextualQuestions: Math.min(contextualTarget, partition.targetItemCount || contextualDefault)
  };
}

export function assessmentReadingIssues(readingItems = [], partition = {}) {
  const codes = [];
  const requirements = assessmentReadingRequirements(partition);
  const passageGroups = new Map();
  for (const item of readingItems) {
    const passageText = String(item?.passageText || item?.passage || item?.materialText || "").trim();
    const groupId = String(item?.passageGroupId || item?.passageTitle || passageText.slice(0, 80) || "missing").trim();
    const group = passageGroups.get(groupId) || { passageText, passageTexts: new Set() };
    if (passageText) group.passageTexts.add(passageText);
    if (passageText.length > group.passageText.length) group.passageText = passageText;
    passageGroups.set(groupId, group);
  }
  const groups = [...passageGroups.values()];
  if (!groups.length || groups.some((group) => !group.passageText)) codes.push("reading_passage_missing");
  if (groups.some((group) => group.passageTexts.size > 1)) codes.push("reading_passage_inconsistent");
  const distinctPassages = new Set(groups.filter(group => group.passageText).map(group => group.passageText.replace(/\s+/g, " ").slice(0, 80)));
  if (distinctPassages.size < requirements.minimumGroups) codes.push("reading_passage_groups_insufficient");
  if (groups.some((group) => {
    const length = requirements.lengthUnit === "words"
      ? (group.passageText.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) || []).length
      : group.passageText.replace(/[^\u4e00-\u9fa5]/g, "").length;
    return length < requirements.minimumGroupLength;
  })) codes.push("reading_passage_too_short");
  const contextualQuestionCount = readingItems.filter((item) => /according|passage|infer|main idea|best title|why|because|learn from|根据|短文|联系上下文|推断|主要内容|原因|作者|题目/i.test(String(item?.prompt || ""))).length;
  if (contextualQuestionCount < requirements.minimumContextualQuestions) codes.push("reading_context_questions_insufficient");
  return codes;
}

export function validateAssessmentPartition(parsed = {}, partition = {}) {
  const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const items = sections.flatMap((section) => Array.isArray(section?.items) ? section.items : []);
  const codes = [];
  if (!sections.length) codes.push("missing_sections");
  if (!items.length) codes.push("missing_items");

  const allowedItemTypes = new Set(Array.isArray(partition?.itemTypes) ? partition.itemTypes : []);
  if (items.some((item) => !String(item?.itemType ?? "").trim())) {
    codes.push("missing_item_type");
  }
  if (items.some((item) => {
    const itemType = String(item?.itemType ?? "").trim();
    return itemType && allowedItemTypes.size > 0 && !allowedItemTypes.has(itemType);
  })) {
    codes.push("disallowed_item_type");
  }
  if (items.some((item) => (
    !String(item?.prompt || "").trim() ||
    item?.answer == null ||
    (typeof item.answer === "string" && !item.answer.trim()) ||
    !Array.isArray(item?.analysisSteps) ||
    !item.analysisSteps.some((step) => String(step || "").trim()) ||
    (!String(item?.knowledgePoint || "").trim() && !String(item?.commonMistake || "").trim())
  ))) {
    codes.push("incomplete_item");
  }

  if (allowedItemTypes.has("reading")) {
    const readingItems = items.filter((item) => String(item?.itemType || "").trim() === "reading");
    codes.push(...assessmentReadingIssues(readingItems, partition));
  }

  const uniqueCodes = [...new Set(codes)];
  const partitionId = partition?.id || "unknown";
  return {
    valid: uniqueCodes.length === 0,
    codes: uniqueCodes,
    issues: uniqueCodes.map((code) => `partition:${partitionId}:${code}`)
  };
}
