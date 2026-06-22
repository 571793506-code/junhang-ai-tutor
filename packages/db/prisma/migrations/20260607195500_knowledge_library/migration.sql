-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "subject" TEXT,
    "grade" TEXT,
    "edition" TEXT,
    "volume" TEXT,
    "unit" TEXT,
    "lesson" TEXT,
    "sourceUrl" TEXT,
    "sourcePath" TEXT,
    "markdownPath" TEXT,
    "licenseStatus" TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "allowedForGeneration" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "summary" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "preview" TEXT,
    "knowledgePoints" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceReview" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "teacherId" TEXT,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeSource_subject_grade_idx" ON "KnowledgeSource"("subject", "grade");

-- CreateIndex
CREATE INDEX "KnowledgeSource_sourceType_reviewStatus_idx" ON "KnowledgeSource"("sourceType", "reviewStatus");

-- CreateIndex
CREATE INDEX "KnowledgeSource_allowedForGeneration_idx" ON "KnowledgeSource"("allowedForGeneration");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_sourceId_orderIndex_idx" ON "KnowledgeChunk"("sourceId", "orderIndex");

-- CreateIndex
CREATE INDEX "SourceReview_sourceId_createdAt_idx" ON "SourceReview"("sourceId", "createdAt");

-- CreateIndex
CREATE INDEX "SourceReview_teacherId_idx" ON "SourceReview"("teacherId");

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceReview" ADD CONSTRAINT "SourceReview_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
