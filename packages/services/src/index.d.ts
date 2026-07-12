export interface QaSanitizeTextOptions {
  maxLength?: number;
  rejectInternal?: boolean;
}

export interface QaSanitizedAnswer {
  text: string;
  contentAvailable: boolean;
}

export interface QaLearningSignalRecord {
  knowledgePoints: string[];
  questionIntent: "concept" | "method" | "error_reasoning" | "expression" | "other";
  difficultySignal: "none" | "possible" | "clear";
  misconceptionHypotheses: string[];
  followUpNeeded: boolean;
  confidence: "low" | "medium" | "high";
  safetyStatus: "pass" | "blocked";
}

export interface QaLearningRecord {
  actorRole: "student" | "classroom" | "teacher" | "unknown";
  identityConfirmed: boolean;
  available: boolean;
  mode: "GUIDED_THINKING" | "KNOWLEDGE_EXPLANATION";
  learningSignal: QaLearningSignalRecord | null;
  profileEligibility: boolean;
  blockedReason:
    | "teacher-test"
    | "identity-unconfirmed"
    | "model-unavailable"
    | "unsafe-content"
    | "malformed-output"
    | null;
  schemaVersion: "qa-learning-signal-v1";
}

export declare function sanitizeQaText(
  value: unknown,
  options?: QaSanitizeTextOptions
): string;

export declare function sanitizeQaAnswer(value: unknown): QaSanitizedAnswer;

export declare function buildQaLearningRecord(
  input?: Record<string, unknown>,
  result?: Record<string, unknown>
): QaLearningRecord;

export declare function answerStudentQuestionService(
  config: Record<string, string | undefined>,
  input?: Record<string, unknown>,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>>;

export declare function generateVocabularyCardService(
  config: Record<string, string | undefined>,
  input?: Record<string, unknown>,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>>;

export declare function draftTeacherTaskService(
  config: Record<string, string | undefined>,
  input?: Record<string, unknown>,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>>;

export declare function draftAssessmentService(
  config: Record<string, string | undefined>,
  input?: Record<string, unknown>,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>>;

export declare function buildAssessmentBlueprintCheck(
  input?: Record<string, unknown>
): Record<string, unknown>;

export declare function gradeSubmissionService(
  config: Record<string, string | undefined>,
  input?: Record<string, unknown>,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>>;

export declare function dictationSpeechService(
  config: Record<string, string | undefined>,
  input?: Record<string, unknown>,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>>;
