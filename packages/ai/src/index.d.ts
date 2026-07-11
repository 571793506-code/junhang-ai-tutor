export type ProviderStatus = "ready" | "blocked" | "unavailable";
export type AiProviderId = "deepseek" | "minimax" | "gpt56";

export interface AiProviderSnapshot {
  id: AiProviderId;
  label: string;
  status: ProviderStatus;
  model: string;
  assessmentModel?: string;
  assessmentFallbackModel?: string;
  baseUrl: string;
  reason: string;
  capabilities: string[];
}

export interface AiFeatureSnapshot {
  id: string;
  label: string;
  providerId: AiProviderId;
  appSurface: string;
  status: ProviderStatus;
  reason: string;
}

export interface AiStartupSnapshot {
  mode: string;
  generatedAt: string;
  providers: AiProviderSnapshot[];
  features: AiFeatureSnapshot[];
}

export interface RuntimeConfigLike {
  [key: string]: string | undefined;
}

export declare const providerCatalog: Array<{
  id: AiProviderId;
  label: string;
  baseUrlKey: string;
  modelKey: string;
  defaultBaseUrl: string;
  defaultModel: string;
  capabilities: string[];
}>;

export declare const capabilityCatalog: Array<{
  id: string;
  label: string;
  providerId: AiProviderId;
  appSurface: string;
}>;

export declare function normalizeRuntimeConfig(config?: RuntimeConfigLike): {
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  deepseekAssessmentModel: string;
  deepseekAssessmentFallbackModel: string;
  deepseekEmergencyFallbackModel: string;
  minimaxApiKey: string;
  minimaxBaseUrl: string;
  minimaxModel: string;
  minimaxSpeechModel: string;
  minimaxT2aBaseUrl: string;
  minimaxBalanceStatus: string;
  ocrEngine: string;
  ocrEnabled: boolean;
  ocrHttpUrl: string;
  ocrHttpApiKey: string;
  ocrVisionProvider: string;
  ocrVisionBaseUrl: string;
  ocrVisionApiKey: string;
  ocrVisionModel: string;
  ocrTesseractLang: string;
  gpt56ApiKey: string;
  gpt56BaseUrl: string;
  gpt56Model: string;
  gpt56GenerationTimeoutMs: number;
  gpt56GradingTimeoutMs: number;
  gpt56ReviewTimeoutMs: number;
  gpt56ReasoningEffortEnabled: boolean;
  gpt56SolFallbackEnabled: boolean;
  gpt56SolModel: string;
  gpt56SolFallbackTimeoutMs: number;
};

export declare function describeModelError(error?: unknown): {
  message: string;
  status: number | null;
  code: string | null;
};
export declare function classifySolEscalationError(error?: unknown): {
  allowed: boolean;
  triggerClass: "availability" | "configuration";
  triggerCode: string;
};
export declare function solEscalationEnabled(runtime?: {
  gpt56SolFallbackEnabled?: boolean;
  gpt56ReasoningEffortEnabled?: boolean;
  gpt56SolModel?: string;
}): boolean;
export declare function validateAssessmentPartition(
  parsed?: Record<string, unknown>,
  partition?: { id?: string; itemTypes?: string[] }
): {
  valid: boolean;
  codes: string[];
  issues: string[];
};

export interface AssessmentExecutionOptions {
  role?: string;
  model?: string;
  reasoningEffort?: string;
  timeoutMs?: number;
  disableSolEscalation?: boolean;
  evidenceSufficient?: boolean;
  now?: () => number;
}

export interface SubmissionExecutionOptions {
  role?: string;
  model?: string;
  reasoningEffort?: string;
  timeoutMs?: number;
  disableSolEscalation?: boolean;
}

export type QaQuestionIntent = "concept" | "method" | "error_reasoning" | "expression" | "other";
export type QaDifficultySignal = "none" | "possible" | "clear";
export type QaConfidence = "low" | "medium" | "high";
export type QaSafetyStatus = "pass" | "blocked";
export type QaMode = "GUIDED_THINKING" | "KNOWLEDGE_EXPLANATION";

export interface QaLearningSignal {
  knowledgePoints: string[];
  questionIntent: QaQuestionIntent;
  difficultySignal: QaDifficultySignal;
  misconceptionHypotheses: string[];
  followUpNeeded: boolean;
  confidence: QaConfidence;
  safetyStatus: QaSafetyStatus;
  profileEligibility: boolean;
  blockedReason: string | null;
}

export interface QaNormalizedOutput {
  studentAnswer: string;
  learningSignal: QaLearningSignal | null;
  structureValid: boolean;
}

export interface QaRuntimeResult extends QaNormalizedOutput {
  available: boolean;
  providerId: "gpt56";
  model?: string;
  mode: QaMode;
  answer: string;
  status?: "unavailable";
  reason?: string;
  raw?: unknown;
  error?: string;
  modelRun: Record<string, unknown>;
}

export declare const QA_LEARNING_SIGNAL_SCHEMA_VERSION: "qa-learning-signal-v1";
export declare const QA_UNAVAILABLE_ANSWER: "AI 问答暂时不可用，请稍后再试。";
export declare const QA_BLOCKED_ANSWER: "这个问题暂时不能直接回答，请换一种安全、清楚的方式提问。";
export declare function normalizeQaModelOutput(text: unknown): QaNormalizedOutput;
export declare function unavailableQaOutput(reason?: unknown): QaNormalizedOutput;

export declare function buildAiStartupSnapshot(config?: RuntimeConfigLike): AiStartupSnapshot;
export declare function createDemoAiSnapshot(): AiStartupSnapshot;
export declare function routeCapability(capabilityId: string, snapshot?: AiStartupSnapshot): AiFeatureSnapshot;
export declare function buildModelOrchestrationPlan(config?: RuntimeConfigLike): Record<string, unknown>;
export declare function callOpenAiCompatibleChat(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  temperature?: number;
  responseFormat?: unknown;
  maxTokens?: number;
  timeoutMs?: number;
  reasoningEffort?: string;
}): Promise<unknown>;
export declare function callDeepSeekChat(config: RuntimeConfigLike, messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>): Promise<unknown>;
export declare function callMiniMaxChat(config: RuntimeConfigLike, messages: Array<{ role: string; content: string }>): Promise<unknown>;
export declare function callGpt55Chat(config: RuntimeConfigLike, messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>): Promise<unknown>;
export declare function callGpt56Chat(config: RuntimeConfigLike, messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>): Promise<unknown>;
export declare function extractChatText(body: unknown): string;
export declare function inferClassroomQaMode(question?: string): QaMode;
export declare function answerStudentQuestion(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<QaRuntimeResult>;
export declare function generateVocabularyCard(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function draftTeacherTask(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function draftAssessment(
  config: RuntimeConfigLike,
  input?: Record<string, unknown>,
  execution?: AssessmentExecutionOptions
): Promise<Record<string, unknown>>;
export declare function generateSubmissionReferenceAnswers(config: RuntimeConfigLike, input?: Record<string, unknown>, execution?: SubmissionExecutionOptions): Promise<Record<string, unknown>>;
export declare function gradeSubmissionText(config: RuntimeConfigLike, input?: Record<string, unknown>, execution?: SubmissionExecutionOptions): Promise<Record<string, unknown>>;
export declare function draftStudentProfileNarrative(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function reviewWithMiniMax(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function reviewWithGpt55(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function reviewWithGpt56(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function buildDictationSpeechPlan(input?: Record<string, unknown>): Record<string, unknown>;
export declare function createMiniMaxSpeechTask(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;

export declare function composeDemoQaAnswer(question: string, studentName?: string): {
  providerId: "gpt56";
  headline: string;
  steps: string[];
  practice: string;
  note: string;
};

export declare function composeDemoVocabularyAnswer(term: string): {
  term: string;
  meaning: string;
  partOfSpeech: string;
  collocations: string[];
  examples: string[];
  pitfalls: string[];
};
