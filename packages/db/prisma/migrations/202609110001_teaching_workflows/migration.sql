CREATE TABLE "TeachingWorkflow" (
  "id" TEXT NOT NULL,
  "ownerTeacherId" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "subjectRef" TEXT,
  "requestKey" TEXT NOT NULL,
  "currentRevision" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL,
  "request" JSONB NOT NULL,
  "checkpoint" JSONB,
  "activeOperationKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TeachingWorkflow_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "TeachingWorkflowRevision" (
  "id" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "baseRevision" INTEGER NOT NULL,
  "operationKey" TEXT NOT NULL,
  "commandFingerprint" TEXT,
  "operation" TEXT NOT NULL,
  "actorTeacherId" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "affectedQuestionIds" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeachingWorkflowRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeachingWorkflow_ownerTeacherId_requestKey_key" ON "TeachingWorkflow"("ownerTeacherId", "requestKey");
CREATE INDEX "TeachingWorkflow_ownerTeacherId_status_idx" ON "TeachingWorkflow"("ownerTeacherId", "status");
CREATE UNIQUE INDEX "TeachingWorkflowRevision_workflowId_revision_key" ON "TeachingWorkflowRevision"("workflowId", "revision");
CREATE UNIQUE INDEX "TeachingWorkflowRevision_workflowId_operationKey_key" ON "TeachingWorkflowRevision"("workflowId", "operationKey");
CREATE INDEX "TeachingWorkflowRevision_actorTeacherId_idx" ON "TeachingWorkflowRevision"("actorTeacherId");
ALTER TABLE "TeachingWorkflowRevision" ADD CONSTRAINT "TeachingWorkflowRevision_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "TeachingWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
