import type { TeachingExecution } from "./index.js";
export declare function recognizeImages(
  config: Record<string, string | undefined>,
  input?: Record<string, unknown>,
  execution?: Pick<TeachingExecution, "call" | "signal" | "now"> & { timeoutMs?: number; maxTokens?: number }
): Promise<Record<string, unknown>>;
