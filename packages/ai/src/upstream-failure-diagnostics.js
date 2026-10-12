const REQUEST_ID_HEADERS = ["x-request-id", "request-id", "x-amzn-requestid", "cf-ray"];
const REASON_HINTS = new Set(["channel_unavailable", "overloaded", "rate_limited", "maintenance", "upstream_connection_failure", "account_limit", "unknown"]);

function safeRequestId(value, secret = "") {
  return typeof value === "string" && /^[a-z0-9_-]{8,128}$/i.test(value) &&
    !/sk-|bearer|api[_-]?key|token|secret/i.test(value) && !(secret && value.includes(secret)) ? value : null;
}

// Hints describe upstream wording, not a verified root cause. Never retain text.
function reasonHint(message) {
  const text = typeof message === "string" ? message.slice(0, 4096) : "";
  if (/insufficient[_ -]?quota|balance|billing|额度|余额/i.test(text)) return "account_limit";
  if (/no available channel|channel unavailable|no healthy upstream|无可用渠道|无可用通道/i.test(text)) return "channel_unavailable";
  if (/rate[_ -]?limit|too many requests|限流/i.test(text)) return "rate_limited";
  if (/overload|capacity|server busy|过载|拥塞/i.test(text)) return "overloaded";
  if (/maintenance|维护/i.test(text)) return "maintenance";
  if (/upstream connect error|upstream connection|connection refused|connection reset/i.test(text)) return "upstream_connection_failure";
  return "unknown";
}

function retryAfterSeconds(value, now) {
  if (typeof value !== "string" || value.length > 64) return null;
  const seconds = /^\d{1,5}$/.test(value) ? Number(value)
    : /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)
      ? Math.ceil((Date.parse(value) - now) / 1000) : NaN;
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= 86400 ? seconds : null;
}

export function collectUpstreamFailureDiagnostics(headers, message, { secret = "", now = Date.now() } = {}) {
  let requestId = null, requestIdSource = null;
  for (const name of REQUEST_ID_HEADERS) {
    const candidate = safeRequestId(headers?.get(name), secret);
    if (candidate) { requestId = candidate; requestIdSource = name; break; }
  }
  return { requestId, requestIdSource, reasonHint: reasonHint(message), retryAfterSeconds: retryAfterSeconds(headers?.get("retry-after"), now) };
}

// Revalidate at the trace boundary; injected transports cannot append raw fields.
export function sanitizeUpstreamFailureDiagnostics(value) {
  if (!value || typeof value !== "object") return null;
  const requestId = REQUEST_ID_HEADERS.includes(value.requestIdSource) ? safeRequestId(value.requestId) : null;
  return { requestId, requestIdSource: requestId ? value.requestIdSource : null,
    reasonHint: REASON_HINTS.has(value.reasonHint) ? value.reasonHint : "unknown",
    retryAfterSeconds: Number.isInteger(value.retryAfterSeconds) && value.retryAfterSeconds >= 0 && value.retryAfterSeconds <= 86400 ? value.retryAfterSeconds : null };
}

export function sanitizeTransportDiagnostics(value) {
  if (!value || !["request_started", "response_headers", "response_body_complete"].includes(value.phase)) return null;
  const result = { phase: value.phase };
  if (value.status === null || Number.isInteger(value.status) && value.status >= 100 && value.status <= 599) result.status = value.status;
  for (const key of ["elapsedMs", "requestBytes", "responseBytes"]) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key];
  }
  return result;
}
