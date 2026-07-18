-- This reconciliation is the empty-instance baseline. Existing databases must
-- be reconciled through the populated expand/backfill workflow and then mark
-- this migration applied only after a zero-diff proof.
DO $$
DECLARE
  candidate_table TEXT;
  contains_rows BOOLEAN;
BEGIN
  FOR candidate_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = current_schema()
      AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I LIMIT 1)', current_schema(), candidate_table)
      INTO contains_rows;

    IF contains_rows THEN
      RAISE EXCEPTION '0005_schema_reconciliation requires an empty database; table % contains rows. Use populated migration rehearsal and migrate resolve after zero-diff verification', candidate_table;
    END IF;
  END LOOP;
END $$;

-- CreateEnum
CREATE TYPE "LabMembershipRole" AS ENUM ('owner', 'manager', 'staff', 'viewer');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'finalized', 'void');

-- CreateEnum
CREATE TYPE "AnimalIntakeDisposition" AS ENUM ('holding', 'quarantine');

-- AlterTable
ALTER TABLE "Animal" ADD COLUMN     "intakeBatchId" TEXT,
ADD COLUMN     "owningLabId" TEXT,
ADD COLUMN     "sourceAnimalId" TEXT;

-- AlterTable
ALTER TABLE "Cage" ADD COLUMN     "capacityOverride" INTEGER,
ADD COLUMN     "labId" TEXT;

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "cageBarcodePrefix" TEXT NOT NULL DEFAULT 'CM',
ADD COLUMN     "maxCageOccupancy" INTEGER NOT NULL DEFAULT 6;

-- CreateTable
CREATE TABLE "Lab" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "billingContact" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabMembership" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "LabMembershipRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimalIntakeBatch" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "orderReference" TEXT NOT NULL,
    "arrivalDate" TIMESTAMP(3) NOT NULL,
    "disposition" "AnimalIntakeDisposition" NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnimalIntakeBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CageChargeCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "dailyRateCents" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CageChargeCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CageChargePeriod" (
    "id" TEXT NOT NULL,
    "cageId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "dailyRateCents" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "CageChargePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CageLabTransfer" (
    "id" TEXT NOT NULL,
    "cageId" TEXT NOT NULL,
    "fromLabId" TEXT NOT NULL,
    "toLabId" TEXT NOT NULL,
    "movedById" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "CageLabTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimalLabTransfer" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "fromLabId" TEXT NOT NULL,
    "toLabId" TEXT NOT NULL,
    "movedById" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "AnimalLabTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "cageId" TEXT NOT NULL,
    "chargePeriodId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "serviceStart" TIMESTAMP(3) NOT NULL,
    "serviceEnd" TIMESTAMP(3) NOT NULL,
    "dayCount" INTEGER NOT NULL,
    "dailyRateCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lab_code_key" ON "Lab"("code");

-- CreateIndex
CREATE INDEX "LabMembership_userId_idx" ON "LabMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LabMembership_labId_userId_key" ON "LabMembership"("labId", "userId");

-- CreateIndex
CREATE INDEX "AnimalIntakeBatch_labId_idx" ON "AnimalIntakeBatch"("labId");

-- CreateIndex
CREATE INDEX "AnimalIntakeBatch_arrivalDate_idx" ON "AnimalIntakeBatch"("arrivalDate");

-- CreateIndex
CREATE UNIQUE INDEX "CageChargeCategory_code_key" ON "CageChargeCategory"("code");

-- CreateIndex
CREATE INDEX "CageChargePeriod_cageId_idx" ON "CageChargePeriod"("cageId");

-- CreateIndex
CREATE INDEX "CageChargePeriod_labId_idx" ON "CageChargePeriod"("labId");

-- CreateIndex
CREATE INDEX "CageChargePeriod_categoryId_idx" ON "CageChargePeriod"("categoryId");

-- CreateIndex
CREATE INDEX "CageChargePeriod_startedAt_idx" ON "CageChargePeriod"("startedAt");

-- CreateIndex
CREATE INDEX "CageLabTransfer_cageId_idx" ON "CageLabTransfer"("cageId");

-- CreateIndex
CREATE INDEX "CageLabTransfer_fromLabId_idx" ON "CageLabTransfer"("fromLabId");

-- CreateIndex
CREATE INDEX "CageLabTransfer_toLabId_idx" ON "CageLabTransfer"("toLabId");

-- CreateIndex
CREATE INDEX "AnimalLabTransfer_animalId_idx" ON "AnimalLabTransfer"("animalId");

-- CreateIndex
CREATE INDEX "AnimalLabTransfer_fromLabId_idx" ON "AnimalLabTransfer"("fromLabId");

-- CreateIndex
CREATE INDEX "AnimalLabTransfer_toLabId_idx" ON "AnimalLabTransfer"("toLabId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_labId_idx" ON "Invoice"("labId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_periodStart_periodEnd_idx" ON "Invoice"("periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_cageId_idx" ON "InvoiceLineItem"("cageId");

-- CreateIndex
CREATE INDEX "Animal_owningLabId_idx" ON "Animal"("owningLabId");

-- CreateIndex
CREATE INDEX "Animal_intakeBatchId_idx" ON "Animal"("intakeBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "Animal_intakeBatchId_sourceAnimalId_key" ON "Animal"("intakeBatchId", "sourceAnimalId");

-- CreateIndex
CREATE INDEX "Cage_labId_idx" ON "Cage"("labId");

-- CreateIndex
CREATE UNIQUE INDEX "Facility_cageBarcodePrefix_key" ON "Facility"("cageBarcodePrefix");

-- AddForeignKey
ALTER TABLE "LabMembership" ADD CONSTRAINT "LabMembership_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabMembership" ADD CONSTRAINT "LabMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cage" ADD CONSTRAINT "Cage_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_owningLabId_fkey" FOREIGN KEY ("owningLabId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_intakeBatchId_fkey" FOREIGN KEY ("intakeBatchId") REFERENCES "AnimalIntakeBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalIntakeBatch" ADD CONSTRAINT "AnimalIntakeBatch_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalIntakeBatch" ADD CONSTRAINT "AnimalIntakeBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CageChargePeriod" ADD CONSTRAINT "CageChargePeriod_cageId_fkey" FOREIGN KEY ("cageId") REFERENCES "Cage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CageChargePeriod" ADD CONSTRAINT "CageChargePeriod_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CageChargePeriod" ADD CONSTRAINT "CageChargePeriod_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CageChargeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CageLabTransfer" ADD CONSTRAINT "CageLabTransfer_cageId_fkey" FOREIGN KEY ("cageId") REFERENCES "Cage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CageLabTransfer" ADD CONSTRAINT "CageLabTransfer_fromLabId_fkey" FOREIGN KEY ("fromLabId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CageLabTransfer" ADD CONSTRAINT "CageLabTransfer_toLabId_fkey" FOREIGN KEY ("toLabId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CageLabTransfer" ADD CONSTRAINT "CageLabTransfer_movedById_fkey" FOREIGN KEY ("movedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalLabTransfer" ADD CONSTRAINT "AnimalLabTransfer_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalLabTransfer" ADD CONSTRAINT "AnimalLabTransfer_fromLabId_fkey" FOREIGN KEY ("fromLabId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalLabTransfer" ADD CONSTRAINT "AnimalLabTransfer_toLabId_fkey" FOREIGN KEY ("toLabId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalLabTransfer" ADD CONSTRAINT "AnimalLabTransfer_movedById_fkey" FOREIGN KEY ("movedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_cageId_fkey" FOREIGN KEY ("cageId") REFERENCES "Cage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_chargePeriodId_fkey" FOREIGN KEY ("chargePeriodId") REFERENCES "CageChargePeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CageChargeCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
