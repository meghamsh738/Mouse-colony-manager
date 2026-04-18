-- CreateEnum
CREATE TYPE "SampleStatus" AS ENUM ('collected', 'stored', 'allocated', 'consumed', 'discarded');

-- CreateTable
CREATE TABLE "SampleRecord" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "projectId" TEXT,
    "sampleLabel" TEXT NOT NULL,
    "sampleType" TEXT NOT NULL,
    "status" "SampleStatus" NOT NULL DEFAULT 'stored',
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "storageLocation" TEXT,
    "quantityLabel" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SampleRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SampleRecord_sampleLabel_key" ON "SampleRecord"("sampleLabel");

-- CreateIndex
CREATE INDEX "SampleRecord_animalId_idx" ON "SampleRecord"("animalId");

-- CreateIndex
CREATE INDEX "SampleRecord_projectId_idx" ON "SampleRecord"("projectId");

-- CreateIndex
CREATE INDEX "SampleRecord_status_idx" ON "SampleRecord"("status");

-- CreateIndex
CREATE INDEX "SampleRecord_collectedAt_idx" ON "SampleRecord"("collectedAt");

-- AddForeignKey
ALTER TABLE "SampleRecord" ADD CONSTRAINT "SampleRecord_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleRecord" ADD CONSTRAINT "SampleRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleRecord" ADD CONSTRAINT "SampleRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
