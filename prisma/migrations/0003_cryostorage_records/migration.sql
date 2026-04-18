-- CreateEnum
CREATE TYPE "CryostorageStatus" AS ENUM ('stored', 'reserved', 'recovered', 'depleted', 'discarded');

-- CreateTable
CREATE TABLE "CryostorageRecord" (
    "id" TEXT NOT NULL,
    "strainId" TEXT NOT NULL,
    "projectId" TEXT,
    "sampleLabel" TEXT NOT NULL,
    "materialType" TEXT NOT NULL,
    "status" "CryostorageStatus" NOT NULL DEFAULT 'stored',
    "storedAt" TIMESTAMP(3) NOT NULL,
    "storageLocation" TEXT,
    "quantityLabel" TEXT,
    "recoveryNotes" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CryostorageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CryostorageRecord_sampleLabel_key" ON "CryostorageRecord"("sampleLabel");

-- CreateIndex
CREATE INDEX "CryostorageRecord_strainId_idx" ON "CryostorageRecord"("strainId");

-- CreateIndex
CREATE INDEX "CryostorageRecord_projectId_idx" ON "CryostorageRecord"("projectId");

-- CreateIndex
CREATE INDEX "CryostorageRecord_status_idx" ON "CryostorageRecord"("status");

-- CreateIndex
CREATE INDEX "CryostorageRecord_storedAt_idx" ON "CryostorageRecord"("storedAt");

-- AddForeignKey
ALTER TABLE "CryostorageRecord" ADD CONSTRAINT "CryostorageRecord_strainId_fkey" FOREIGN KEY ("strainId") REFERENCES "Strain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CryostorageRecord" ADD CONSTRAINT "CryostorageRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CryostorageRecord" ADD CONSTRAINT "CryostorageRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
