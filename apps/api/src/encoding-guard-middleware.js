import { inspectEncodingPayload, normalizeDisplayPayload } from "@junhang/core";

const watchedMethods = new Set(["POST", "PUT", "PATCH"]);

export function createEncodingGuardMiddleware(options = {}) {
  const enabled = options.enabled !== false;
  const normalizeInput = options.normalizeInput !== false;
  const normalizeOutput = options.normalizeOutput !== false;
  const warn = options.warn || console.warn;

  return function encodingGuard(req, res, next) {
    if (!enabled) return next();
    if (req.path === "/api/encoding/check") return next();

    if (normalizeInput && watchedMethods.has(req.method) && req.body && typeof req.body === "object") {
      const report = inspectEncodingPayload(req.body, { maxIssues: 20 });
      if (!report.ok) {
        warn("[encoding-guard] request mojibake normalized", {
          method: req.method,
          path: req.path,
          issueCount: report.issueCount,
          samples: report.issues.slice(0, 3)
        });
        req.body = normalizeDisplayPayload(req.body);
      }
    }

    if (normalizeOutput) {
      const originalJson = res.json.bind(res);
      res.json = (payload) => {
        const report = inspectEncodingPayload(payload, { maxIssues: 20 });
        if (!report.ok) {
          warn("[encoding-guard] response mojibake normalized", {
            method: req.method,
            path: req.path,
            issueCount: report.issueCount,
            samples: report.issues.slice(0, 3)
          });
          return originalJson(normalizeDisplayPayload(payload));
        }
        return originalJson(payload);
      };
    }

    next();
  };
}
