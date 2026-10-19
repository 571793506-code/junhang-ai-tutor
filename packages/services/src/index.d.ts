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

export declare function normalizeDictionaryTerm(value: unknown): string;
export declare function validateDictionaryDraft(
  queryTerm: string,
  draft: Record<string, unknown>
): { ok: boolean; issues: string[]; card: Record<string, unknown> };
export declare function queryStudentDictionaryService(
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

export declare function matchApprovedContentContext(
  input?: Record<string, unknown>,
  sources?: Array<Record<string, unknown>>
): Record<string, unknown>;

export declare function validateAssessmentContentContext(
  input?: Record<string, unknown>,
  contentContext?: Record<string, unknown>
): Record<string, unknown>;

export declare function buildGenerationContext(
  input?: Record<string, unknown>,
  options?: Record<string, unknown>
): Record<string, unknown>;

export declare function buildSubmissionGradingContext(
  input?: Record<string, unknown>,
  options?: Record<string, unknown>
): Record<string, unknown>;

export declare function buildStudentProfileContext(
  input?: Record<string, unknown>
): Record<string, unknown>;

export declare function buildAssessmentBlueprintCheck(
  input?: Record<string, unknown>
): Record<string, unknown>;

export declare function gradeSubmissionService(
  config: Record<string, string | undefined>,
  input?: Record<string, unknown>,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>>;

export declare function verifiedRecognitionCorrections(
  questions: Array<Record<string, unknown>>,
  teacherId?: string
): Array<{ questionNo: string; studentAnswer: unknown }>;

export declare function dictationSpeechService(
  config: Record<string, string | undefined>,
  input?: Record<string, unknown>,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>>;

export interface TeachingWorkflowActor {
  teacherId: string;
}

export interface TeachingWorkflowCommand {
  action: "revise" | "confirm" | "restore" | "cancel";
  operationKey: string;
  expectedRevision: number;
  patch?: Record<string, unknown>;
  targetQuestionIds?: string[];
  targetExplanation?: true;
  instruction?: string;
  revision?: number;
}

export declare function inheritQuestionConfirmations(
  previousSnapshot?: Record<string, unknown>,
  nextSnapshot?: Record<string, unknown>,
  affectedQuestionIds?: string[]
): Record<string, unknown>;

export declare function createTeachingWorkflowService(options: {
  repository: Record<string, unknown>;
  resolveConfirmedArchive?: ((context: Record<string, unknown>) => Promise<Record<string, unknown> | null>) | null;
  runner?: ((input: Record<string, unknown>) => Promise<Record<string, unknown>>) | null;
  validateSnapshot?: ((snapshot: Record<string, unknown>, context: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>) | null;
  createDraft?: ((input: { actor: TeachingWorkflowActor; input: Record<string, unknown>; workflow: { id: string; module: string; revision: number }; signal: AbortSignal }) => Promise<{ request: Record<string, unknown>; snapshot: Record<string, unknown>; subjectRef?: string }>) | null;
}): {
  create(input: {
    actor: TeachingWorkflowActor;
    input: { requestKey: string; module: "generation" | "grading"; request?: Record<string, unknown> };
  }): Promise<Record<string, unknown>>;
  get(input: { actor: TeachingWorkflowActor; workflowId: string; revision?: number | null }): Promise<Record<string, unknown>>;
  list(input: { actor: TeachingWorkflowActor; module: "generation" | "grading" }): Promise<Array<Record<string, unknown>>>;
  execute(input: {
    actor: TeachingWorkflowActor;
    workflowId: string;
    command: TeachingWorkflowCommand;
  }): Promise<Record<string, unknown>>;
};

export declare function createTeachingWorkflowValidator(options?: {
  resolveGradingSource?: ((context: Record<string, unknown>) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null) | null;
}): (snapshot: Record<string, unknown>, context?: Record<string, unknown>) => Promise<{
  ok: boolean;
  issues: Array<{ code: string; questionId?: string }>;
  snapshot?: Record<string, unknown>;
}>;

export declare function buildTeachingWorkflowArchive(input: {
  actor: TeachingWorkflowActor;
  workflow: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  submissionId: string;
  confirmedAt: string;
  previousArchive?: Record<string, unknown> | null;
  resolveGradingSource: (context: Record<string, unknown>) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
}): Promise<Record<string, unknown>>;

export declare function reuseArchivedQuestionConfirmations(input: {
  actor: TeachingWorkflowActor;
  request?: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  archive: Record<string, unknown> | null;
}): Record<string, unknown>;

export declare function selectCurrentTeachingEvidence<T extends Record<string, unknown>>(student: T): T;

export declare function isTeachingWorkflowArchiveSubmission(submission: Record<string, unknown>, studentId: string): boolean;

export declare function createTeachingWorkflowArchiveService(options: {
  repository: Record<string, unknown>;
  authorizeStudent?: ((context: Record<string, unknown>) => Promise<boolean> | boolean) | null;
  resolveArchiveEvidence?: ((context: Record<string, unknown>) => Promise<Record<string, unknown>>) | null;
  now?: () => Date;
}): {
  publish(input: { actor: TeachingWorkflowActor; workflowId: string; expectedRevision: number }): Promise<{
    status: "archived";
    archiveId: string;
    workflowId: string;
    revision: number;
    currentRevision: number;
    replayed: boolean;
  }>;
};

export declare function createTeachingWorkflowAssignmentService(options?: {
  repository?: Record<string, unknown>;
  authorizeTarget?: ((context: Record<string, any>) => Promise<boolean> | boolean) | null;
  validateSnapshot?: ((snapshot: Record<string, unknown>, context: Record<string, any>) => Promise<Record<string, any>>) | null;
  now?: () => Date;
}): {
  publish(input: { actor: TeachingWorkflowActor; workflowId: string; expectedRevision: number }): Promise<{
    status: "assignment_ready"; assignmentId: string; workflowId: string; revision: number; currentRevision: number; replayed: boolean;
  }>;
  verify(input: { actor: TeachingWorkflowActor; assignment: Record<string, any> }): Promise<boolean>;
};
