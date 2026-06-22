export type ProviderStatus = "ready" | "blocked" | "unavailable";
export type AiProviderId = "deepseek" | "minimax" | "gpt55";

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
  gpt55ApiKey: string;
  gpt55BaseUrl: string;
  gpt55Model: string;
  gpt55ReviewTimeoutMs: number;
};

export declare function buildAiStartupSnapshot(config?: RuntimeConfigLike): AiStartupSnapshot;
export declare function createDemoAiSnapshot(): AiStartupSnapshot;
export declare function routeCapability(capabilityId: string, snapshot?: AiStartupSnapshot): AiFeatureSnapshot;
export declare function callOpenAiCompatibleChat(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  temperature?: number;
  responseFormat?: unknown;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<unknown>;
export declare function callDeepSeekChat(config: RuntimeConfigLike, messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>): Promise<unknown>;
export declare function callMiniMaxChat(config: RuntimeConfigLike, messages: Array<{ role: string; content: string }>): Promise<unknown>;
export declare function callGpt55Chat(config: RuntimeConfigLike, messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>): Promise<unknown>;
export declare function extractChatText(body: unknown): string;
export declare function inferClassroomQaMode(question?: string): "GUIDED_THINKING" | "KNOWLEDGE_EXPLANATION";
export declare function answerStudentQuestion(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function generateVocabularyCard(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function draftTeacherTask(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function draftAssessment(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function generateSubmissionReferenceAnswers(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function gradeSubmissionText(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function draftStudentProfileNarrative(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function reviewWithMiniMax(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function reviewWithGpt55(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;
export declare function buildDictationSpeechPlan(input?: Record<string, unknown>): Record<string, unknown>;
export declare function createMiniMaxSpeechTask(config: RuntimeConfigLike, input?: Record<string, unknown>): Promise<Record<string, unknown>>;

export declare function composeDemoQaAnswer(question: string, studentName?: string): {
  providerId: "deepseek";
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
