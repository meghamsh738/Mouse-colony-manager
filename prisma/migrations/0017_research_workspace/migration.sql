BEGIN;

ALTER TABLE "Experiment"
  ADD COLUMN "plannedStartAt" TIMESTAMP(3),
  ADD COLUMN "plannedEndAt" TIMESTAMP(3),
  ADD COLUMN "operationalContact" TEXT,
  ADD COLUMN "procedureSummary" TEXT,
  ADD COLUMN "treatmentSummary" TEXT,
  ADD COLUMN "welfareRisks" TEXT,
  ADD COLUMN "scheduleNotes" TEXT,
  ADD COLUMN "operationalNotes" TEXT,
  ADD COLUMN "resultSummary" TEXT;

ALTER TABLE "Experiment"
  ADD CONSTRAINT "Experiment_planned_dates_check"
    CHECK ("plannedEndAt" IS NULL OR "plannedStartAt" IS NULL OR "plannedEndAt" >= "plannedStartAt");

CREATE UNIQUE INDEX "Experiment_id_labId_key" ON "Experiment" (id, "labId");

ALTER TABLE "SampleRecord"
  ADD COLUMN "experimentId" TEXT,
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "SampleRecord_version_check" CHECK (version >= 1);

CREATE INDEX "SampleRecord_experimentId_idx" ON "SampleRecord" ("experimentId");

ALTER TABLE "SampleRecord" DROP CONSTRAINT "SampleRecord_projectId_fkey";

ALTER TABLE "SampleRecord"
  ADD CONSTRAINT "SampleRecord_projectId_labId_fkey"
    FOREIGN KEY ("projectId", "labId") REFERENCES "Project"(id, "labId") ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "SampleRecord_experimentId_labId_fkey"
    FOREIGN KEY ("experimentId", "labId") REFERENCES "Experiment"(id, "labId") ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT;
