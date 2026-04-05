-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'colony_manager', 'animal_staff', 'researcher', 'read_only');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('male', 'female', 'unknown');

-- CreateEnum
CREATE TYPE "CageStatus" AS ENUM ('active', 'breeding', 'quarantine', 'experiment', 'retired', 'closed');

-- CreateEnum
CREATE TYPE "AnimalStatus" AS ENUM ('planned', 'born', 'nursing', 'weaned', 'colony_holding', 'breeding', 'reserved', 'in_experiment', 'experiment_completed', 'euthanized', 'dead', 'transferred_out', 'archived');

-- CreateEnum
CREATE TYPE "OutcomeStatus" AS ENUM ('alive', 'euthanized', 'dead', 'transferred', 'missing');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('planned', 'active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('planned', 'reserved', 'active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "HealthNoteType" AS ENUM ('routine_welfare', 'adverse_effect', 'veterinary_concern', 'breeding_concern', 'underweight', 'overweight', 'grooming_issue', 'aggression', 'pregnancy_suspicion', 'delivery_observed', 'post_procedure_monitoring');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('open', 'acknowledged', 'resolved');

-- CreateEnum
CREATE TYPE "GenotypeCallStatus" AS ENUM ('pending', 'provisional', 'confirmed', 'conflict');

-- CreateEnum
CREATE TYPE "BreedingStatus" AS ENUM ('planned', 'active', 'paused', 'retired', 'failed');

-- CreateEnum
CREATE TYPE "RuleCategory" AS ENUM ('breeding', 'welfare', 'compliance', 'genotype', 'experiment', 'capacity');

-- CreateEnum
CREATE TYPE "BreedingAdultRole" AS ENUM ('sire', 'dam', 'support');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rack" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "rackNumber" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "Rack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cage" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "rackId" TEXT NOT NULL,
    "cageNumber" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "status" "CageStatus" NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "welfareFlags" JSONB,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Strain" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "background" TEXT,
    "notes" TEXT,
    "maintenanceRules" JSONB,

    CONSTRAINT "Strain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allele" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gene" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "notes" TEXT,
    "harmfulHomozygous" BOOLEAN NOT NULL DEFAULT false,
    "maintainAsHet" BOOLEAN NOT NULL DEFAULT false,
    "prohibitedPairings" JSONB,

    CONSTRAINT "Allele_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Animal" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "sex" "Sex" NOT NULL,
    "dob" TIMESTAMP(3) NOT NULL,
    "strainId" TEXT NOT NULL,
    "currentCageId" TEXT,
    "status" "AnimalStatus" NOT NULL,
    "originType" TEXT NOT NULL,
    "sireId" TEXT,
    "damId" TEXT,
    "breedingGeneration" TEXT,
    "healthStatus" TEXT,
    "projectSummary" TEXT,
    "experimentalStatus" TEXT,
    "outcomeStatus" "OutcomeStatus" NOT NULL DEFAULT 'alive',
    "deathDate" TIMESTAMP(3),
    "deathReason" TEXT,
    "notes" TEXT,

    CONSTRAINT "Animal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimalAllele" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "alleleId" TEXT NOT NULL,
    "zygosity" TEXT NOT NULL,
    "callStatus" "GenotypeCallStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "AnimalAllele_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenotypingRecord" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "assayType" TEXT NOT NULL,
    "sampleId" TEXT,
    "markerTested" TEXT NOT NULL,
    "resultText" TEXT NOT NULL,
    "attachmentUrl" TEXT,
    "sampleDate" TIMESTAMP(3) NOT NULL,
    "resultDate" TIMESTAMP(3) NOT NULL,
    "operatorId" TEXT,
    "provider" TEXT,
    "verifiedById" TEXT,
    "finalCall" TEXT NOT NULL,
    "status" "GenotypeCallStatus" NOT NULL DEFAULT 'pending',
    "confidence" TEXT,

    CONSTRAINT "GenotypingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreedingSetup" (
    "id" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" "BreedingStatus" NOT NULL,
    "targetGenotype" TEXT NOT NULL,
    "targetSex" "Sex",
    "notes" TEXT,

    CONSTRAINT "BreedingSetup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreedingAdult" (
    "id" TEXT NOT NULL,
    "breedingSetupId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "role" "BreedingAdultRole" NOT NULL,

    CONSTRAINT "BreedingAdult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Litter" (
    "id" TEXT NOT NULL,
    "breedingSetupId" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3) NOT NULL,
    "litterSizeBirth" INTEGER NOT NULL,
    "litterSizeWean" INTEGER,
    "notes" TEXT,

    CONSTRAINT "Litter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LitterAnimal" (
    "id" TEXT NOT NULL,
    "litterId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,

    CONSTRAINT "LitterAnimal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimalProjectAllocation" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "chargeable" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "AnimalProjectAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "experimentCode" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "ExperimentStatus" NOT NULL,
    "notes" TEXT,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentAssignment" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "treatmentGroup" TEXT,
    "notes" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ExperimentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthNote" (
    "id" TEXT NOT NULL,
    "animalId" TEXT,
    "cageId" TEXT,
    "noteType" "HealthNoteType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "note" TEXT NOT NULL,
    "followupRequired" BOOLEAN NOT NULL DEFAULT false,
    "actionTaken" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "animalId" TEXT,
    "cageId" TEXT,
    "healthNoteId" TEXT,
    "genotypingRecordId" TEXT,
    "label" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "storageUrl" TEXT NOT NULL,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimalStatusEvent" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "fromStatus" "AnimalStatus",
    "toStatus" "AnimalStatus" NOT NULL,
    "happenedAt" TIMESTAMP(3) NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,

    CONSTRAINT "AnimalStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimalMovement" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "fromCageId" TEXT,
    "toCageId" TEXT,
    "movedById" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "AnimalMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CageMovement" (
    "id" TEXT NOT NULL,
    "cageId" TEXT NOT NULL,
    "fromLocation" TEXT NOT NULL,
    "toLocation" TEXT NOT NULL,
    "movedById" TEXT,
    "movedAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "CageMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleConfig" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "RuleCategory" NOT NULL,
    "valueType" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "criticalBlock" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'open',
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previousValue" JSONB,
    "newValue" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Room_facilityId_roomNumber_key" ON "Room"("facilityId", "roomNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Rack_roomId_rackNumber_key" ON "Rack"("roomId", "rackNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Cage_barcode_key" ON "Cage"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Cage_rackId_cageNumber_key" ON "Cage"("rackId", "cageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Strain_name_key" ON "Strain"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Allele_name_key" ON "Allele"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Animal_animalId_key" ON "Animal"("animalId");

-- CreateIndex
CREATE UNIQUE INDEX "Animal_labId_key" ON "Animal"("labId");

-- CreateIndex
CREATE INDEX "Animal_status_idx" ON "Animal"("status");

-- CreateIndex
CREATE INDEX "Animal_sex_idx" ON "Animal"("sex");

-- CreateIndex
CREATE INDEX "Animal_currentCageId_idx" ON "Animal"("currentCageId");

-- CreateIndex
CREATE UNIQUE INDEX "AnimalAllele_animalId_alleleId_key" ON "AnimalAllele"("animalId", "alleleId");

-- CreateIndex
CREATE INDEX "GenotypingRecord_animalId_idx" ON "GenotypingRecord"("animalId");

-- CreateIndex
CREATE UNIQUE INDEX "BreedingAdult_breedingSetupId_animalId_key" ON "BreedingAdult"("breedingSetupId", "animalId");

-- CreateIndex
CREATE UNIQUE INDEX "LitterAnimal_litterId_animalId_key" ON "LitterAnimal"("litterId", "animalId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_projectCode_key" ON "Project"("projectCode");

-- CreateIndex
CREATE INDEX "AnimalProjectAllocation_animalId_idx" ON "AnimalProjectAllocation"("animalId");

-- CreateIndex
CREATE INDEX "AnimalProjectAllocation_projectId_idx" ON "AnimalProjectAllocation"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Experiment_experimentCode_key" ON "Experiment"("experimentCode");

-- CreateIndex
CREATE INDEX "ExperimentAssignment_animalId_idx" ON "ExperimentAssignment"("animalId");

-- CreateIndex
CREATE INDEX "ExperimentAssignment_experimentId_idx" ON "ExperimentAssignment"("experimentId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleConfig_key_key" ON "RuleConfig"("key");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rack" ADD CONSTRAINT "Rack_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cage" ADD CONSTRAINT "Cage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cage" ADD CONSTRAINT "Cage_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_strainId_fkey" FOREIGN KEY ("strainId") REFERENCES "Strain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_currentCageId_fkey" FOREIGN KEY ("currentCageId") REFERENCES "Cage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_sireId_fkey" FOREIGN KEY ("sireId") REFERENCES "Animal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_damId_fkey" FOREIGN KEY ("damId") REFERENCES "Animal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalAllele" ADD CONSTRAINT "AnimalAllele_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalAllele" ADD CONSTRAINT "AnimalAllele_alleleId_fkey" FOREIGN KEY ("alleleId") REFERENCES "Allele"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenotypingRecord" ADD CONSTRAINT "GenotypingRecord_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenotypingRecord" ADD CONSTRAINT "GenotypingRecord_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenotypingRecord" ADD CONSTRAINT "GenotypingRecord_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreedingAdult" ADD CONSTRAINT "BreedingAdult_breedingSetupId_fkey" FOREIGN KEY ("breedingSetupId") REFERENCES "BreedingSetup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreedingAdult" ADD CONSTRAINT "BreedingAdult_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Litter" ADD CONSTRAINT "Litter_breedingSetupId_fkey" FOREIGN KEY ("breedingSetupId") REFERENCES "BreedingSetup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LitterAnimal" ADD CONSTRAINT "LitterAnimal_litterId_fkey" FOREIGN KEY ("litterId") REFERENCES "Litter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LitterAnimal" ADD CONSTRAINT "LitterAnimal_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalProjectAllocation" ADD CONSTRAINT "AnimalProjectAllocation_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalProjectAllocation" ADD CONSTRAINT "AnimalProjectAllocation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentAssignment" ADD CONSTRAINT "ExperimentAssignment_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentAssignment" ADD CONSTRAINT "ExperimentAssignment_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthNote" ADD CONSTRAINT "HealthNote_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthNote" ADD CONSTRAINT "HealthNote_cageId_fkey" FOREIGN KEY ("cageId") REFERENCES "Cage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthNote" ADD CONSTRAINT "HealthNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_cageId_fkey" FOREIGN KEY ("cageId") REFERENCES "Cage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_healthNoteId_fkey" FOREIGN KEY ("healthNoteId") REFERENCES "HealthNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_genotypingRecordId_fkey" FOREIGN KEY ("genotypingRecordId") REFERENCES "GenotypingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalStatusEvent" ADD CONSTRAINT "AnimalStatusEvent_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalStatusEvent" ADD CONSTRAINT "AnimalStatusEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalMovement" ADD CONSTRAINT "AnimalMovement_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalMovement" ADD CONSTRAINT "AnimalMovement_movedById_fkey" FOREIGN KEY ("movedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CageMovement" ADD CONSTRAINT "CageMovement_cageId_fkey" FOREIGN KEY ("cageId") REFERENCES "Cage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CageMovement" ADD CONSTRAINT "CageMovement_movedById_fkey" FOREIGN KEY ("movedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

