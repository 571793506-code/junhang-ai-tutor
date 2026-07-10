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

export function validateAssessmentPartition(parsed = {}, partition = {}) {
  const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const items = sections.flatMap((section) => Array.isArray(section?.items) ? section.items : []);
  const codes = [];
  if (!sections.length) codes.push("missing_sections");
  if (!items.length) codes.push("missing_items");

  const allowedItemTypes = new Set(Array.isArray(partition?.itemTypes) ? partition.itemTypes : []);
  if (items.some((item) => item?.itemType && allowedItemTypes.size > 0 && !allowedItemTypes.has(item.itemType))) {
    codes.push("disallowed_item_type");
  }
  if (items.some((item) => (
    !String(item?.prompt || "").trim() ||
    !String(item?.answer || "").trim() ||
    !Array.isArray(item?.analysisSteps) ||
    !item.analysisSteps.some((step) => String(step || "").trim()) ||
    (!String(item?.knowledgePoint || "").trim() && !String(item?.commonMistake || "").trim())
  ))) {
    codes.push("incomplete_item");
  }

  const uniqueCodes = [...new Set(codes)];
  const partitionId = partition?.id || "unknown";
  return {
    valid: uniqueCodes.length === 0,
    codes: uniqueCodes,
    issues: uniqueCodes.map((code) => `partition:${partitionId}:${code}`)
  };
}
