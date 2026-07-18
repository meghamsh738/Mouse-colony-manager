BEGIN;

-- Keep validation and constraint installation on one stable snapshot. These
-- locks can wait behind active writes, so deploy this migration in a controlled
-- window and monitor lock waits on populated databases.
LOCK TABLE
  "Project",
  "Experiment",
  "SampleRecord",
  "CryostorageRecord",
  "GenotypingRecord",
  "HealthNote",
  "Attachment",
  "ExperimentAssignment",
  "AnimalProjectAllocation",
  "BreedingSetup",
  "BreedingAdult",
  "AnimalIntakeBatch",
  "Animal",
  "Cage"
IN ACCESS EXCLUSIVE MODE;

-- Fail closed before adding enforcement. These checks intentionally report
-- retained-data mismatches rather than changing ownership or linked records.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Experiment" e
    JOIN "Project" p ON p.id = e."projectId"
    WHERE e."labId" IS DISTINCT FROM p."labId"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'same-lab migration blocked: Experiment.project contains a lab mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SampleRecord" s
    JOIN "Animal" a ON a.id = s."animalId"
    WHERE s."labId" IS DISTINCT FROM a."owningLabId"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'same-lab migration blocked: SampleRecord.animal contains a lab mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SampleRecord" s
    JOIN "Project" p ON p.id = s."projectId"
    WHERE s."projectId" IS NOT NULL
      AND s."labId" IS DISTINCT FROM p."labId"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'same-lab migration blocked: SampleRecord.project contains a lab mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "CryostorageRecord" c
    JOIN "Project" p ON p.id = c."projectId"
    WHERE c."projectId" IS NOT NULL
      AND c."labId" IS DISTINCT FROM p."labId"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'same-lab migration blocked: CryostorageRecord.project contains a lab mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "GenotypingRecord" g
    JOIN "Animal" a ON a.id = g."animalId"
    WHERE g."labId" IS DISTINCT FROM a."owningLabId"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'same-lab migration blocked: GenotypingRecord.animal contains a lab mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "HealthNote" h
    JOIN "Animal" a ON a.id = h."animalId"
    WHERE h."animalId" IS NOT NULL
      AND h."labId" IS DISTINCT FROM a."owningLabId"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'same-lab migration blocked: HealthNote.animal contains a lab mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "HealthNote" h
    JOIN "Cage" c ON c.id = h."cageId"
    WHERE h."cageId" IS NOT NULL
      AND h."labId" IS DISTINCT FROM c."labId"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'same-lab migration blocked: HealthNote.cage contains a lab mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Attachment" attachment
    LEFT JOIN "Animal" a ON a.id = attachment."animalId"
    LEFT JOIN "Cage" c ON c.id = attachment."cageId"
    LEFT JOIN "HealthNote" h ON h.id = attachment."healthNoteId"
    LEFT JOIN "GenotypingRecord" g ON g.id = attachment."genotypingRecordId"
    WHERE (attachment."animalId" IS NOT NULL AND attachment."labId" IS DISTINCT FROM a."owningLabId")
       OR (attachment."cageId" IS NOT NULL AND attachment."labId" IS DISTINCT FROM c."labId")
       OR (attachment."healthNoteId" IS NOT NULL AND attachment."labId" IS DISTINCT FROM h."labId")
       OR (attachment."genotypingRecordId" IS NOT NULL AND attachment."labId" IS DISTINCT FROM g."labId")
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'same-lab migration blocked: Attachment contains a linked-entity lab mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ExperimentAssignment" assignment
    JOIN "Experiment" e ON e.id = assignment."experimentId"
    JOIN "Animal" a ON a.id = assignment."animalId"
    WHERE assignment.status NOT IN ('completed', 'cancelled')
      AND e."labId" IS DISTINCT FROM a."owningLabId"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'same-lab migration blocked: ExperimentAssignment experiment/animal contains a lab mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "AnimalProjectAllocation" allocation
    JOIN "Animal" a ON a.id = allocation."animalId"
    JOIN "Project" p ON p.id = allocation."projectId"
    WHERE allocation."endedAt" IS NULL
      AND a."owningLabId" IS DISTINCT FROM p."labId"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'same-lab migration blocked: AnimalProjectAllocation animal/project contains a lab mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "BreedingAdult" adult
    JOIN "BreedingSetup" setup ON setup.id = adult."breedingSetupId"
    JOIN "Animal" a ON a.id = adult."animalId"
    WHERE setup.status IN ('planned', 'active', 'paused')
      AND setup."labId" IS DISTINCT FROM a."owningLabId"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'same-lab migration blocked: BreedingAdult setup/animal contains a lab mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Animal" a
    JOIN "Cage" c ON c.id = a."currentCageId"
    WHERE a."currentCageId" IS NOT NULL
      AND a."owningLabId" IS DISTINCT FROM c."labId"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'same-lab migration blocked: Animal.currentCage contains a lab mismatch';
  END IF;
END $$;

-- Current-state relations are represented in Prisma with composite keys. The
-- foreign keys are deferrable so a lab transfer can update both sides in one
-- transaction without an order-dependent integrity gap.
ALTER TABLE "Cage"
  ADD CONSTRAINT "Cage_id_labId_key" UNIQUE ("id", "labId");

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_id_labId_key" UNIQUE ("id", "labId");

CREATE INDEX "BreedingAdult_animalId_idx" ON "BreedingAdult" ("animalId");

ALTER TABLE "Animal"
  DROP CONSTRAINT "Animal_currentCageId_fkey";

ALTER TABLE "Animal"
  ADD CONSTRAINT "Animal_currentCageId_owningLabId_fkey"
  FOREIGN KEY ("currentCageId", "owningLabId")
  REFERENCES "Cage" ("id", "labId")
  ON DELETE NO ACTION
  ON UPDATE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "Experiment"
  DROP CONSTRAINT "Experiment_projectId_fkey";

ALTER TABLE "Experiment"
  ADD CONSTRAINT "Experiment_projectId_labId_fkey"
  FOREIGN KEY ("projectId", "labId")
  REFERENCES "Project" ("id", "labId")
  ON DELETE NO ACTION
  ON UPDATE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

-- Samples, genotype results, welfare notes, attachments, cryostorage records,
-- ended allocations, non-current breeding participation, intake batches, and
-- completed/cancelled assignments are historical records. Their ownership at
-- linkage time is provenance and must not be rewritten by a later transfer.
-- Deferrable constraint triggers enforce same-lab linkage on insert or when a
-- link/status key changes, while deliberately preserving ended history.
CREATE FUNCTION "assert_same_lab_historical_link"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'SampleRecord' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "Animal" a
      WHERE a.id = NEW."animalId" AND a."owningLabId" = NEW."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SampleRecord.animal must belong to SampleRecord.labId';
    END IF;
    IF NEW."projectId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Project" p
      WHERE p.id = NEW."projectId" AND p."labId" = NEW."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SampleRecord.project must belong to SampleRecord.labId';
    END IF;

  ELSIF TG_TABLE_NAME = 'CryostorageRecord' THEN
    IF NEW."projectId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Project" p
      WHERE p.id = NEW."projectId" AND p."labId" = NEW."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CryostorageRecord.project must belong to CryostorageRecord.labId';
    END IF;

  ELSIF TG_TABLE_NAME = 'GenotypingRecord' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "Animal" a
      WHERE a.id = NEW."animalId" AND a."owningLabId" = NEW."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'GenotypingRecord.animal must belong to GenotypingRecord.labId';
    END IF;

  ELSIF TG_TABLE_NAME = 'HealthNote' THEN
    IF NEW."animalId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Animal" a
      WHERE a.id = NEW."animalId" AND a."owningLabId" = NEW."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HealthNote.animal must belong to HealthNote.labId';
    END IF;
    IF NEW."cageId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Cage" c
      WHERE c.id = NEW."cageId" AND c."labId" = NEW."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'HealthNote.cage must belong to HealthNote.labId';
    END IF;

  ELSIF TG_TABLE_NAME = 'Attachment' THEN
    IF NEW."animalId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Animal" a
      WHERE a.id = NEW."animalId" AND a."owningLabId" = NEW."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Attachment.animal must belong to Attachment.labId';
    END IF;
    IF NEW."cageId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "Cage" c
      WHERE c.id = NEW."cageId" AND c."labId" = NEW."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Attachment.cage must belong to Attachment.labId';
    END IF;
    IF NEW."healthNoteId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "HealthNote" h
      WHERE h.id = NEW."healthNoteId" AND h."labId" = NEW."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Attachment.healthNote must belong to Attachment.labId';
    END IF;
    IF NEW."genotypingRecordId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "GenotypingRecord" g
      WHERE g.id = NEW."genotypingRecordId" AND g."labId" = NEW."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Attachment.genotypingRecord must belong to Attachment.labId';
    END IF;

  ELSIF TG_TABLE_NAME = 'ExperimentAssignment' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "Experiment" e
      JOIN "Animal" a ON a.id = NEW."animalId"
      WHERE e.id = NEW."experimentId" AND e."labId" = a."owningLabId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ExperimentAssignment experiment and animal must belong to the same lab';
    END IF;

  ELSIF TG_TABLE_NAME = 'AnimalProjectAllocation' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "Animal" a
      JOIN "Project" p ON p.id = NEW."projectId"
      WHERE a.id = NEW."animalId" AND a."owningLabId" = p."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'AnimalProjectAllocation animal and project must belong to the same lab';
    END IF;

  ELSIF TG_TABLE_NAME = 'BreedingAdult' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "BreedingSetup" setup
      JOIN "Animal" a ON a.id = NEW."animalId"
      WHERE setup.id = NEW."breedingSetupId" AND setup."labId" = a."owningLabId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'BreedingAdult setup and animal must belong to the same lab';
    END IF;

  ELSIF TG_TABLE_NAME = 'Animal' THEN
    IF NEW."intakeBatchId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "AnimalIntakeBatch" batch
      WHERE batch.id = NEW."intakeBatchId" AND batch."labId" = NEW."owningLabId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Animal intake batch must belong to the animal owning lab at initial linkage';
    END IF;
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "SampleRecord_same_lab_check"
AFTER INSERT OR UPDATE OF "labId", "animalId", "projectId" ON "SampleRecord"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION "assert_same_lab_historical_link"();

CREATE CONSTRAINT TRIGGER "CryostorageRecord_same_lab_check"
AFTER INSERT OR UPDATE OF "labId", "projectId" ON "CryostorageRecord"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION "assert_same_lab_historical_link"();

CREATE CONSTRAINT TRIGGER "GenotypingRecord_same_lab_check"
AFTER INSERT OR UPDATE OF "labId", "animalId" ON "GenotypingRecord"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION "assert_same_lab_historical_link"();

CREATE CONSTRAINT TRIGGER "HealthNote_same_lab_check"
AFTER INSERT OR UPDATE OF "labId", "animalId", "cageId" ON "HealthNote"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION "assert_same_lab_historical_link"();

CREATE CONSTRAINT TRIGGER "Attachment_same_lab_check"
AFTER INSERT OR UPDATE OF "labId", "animalId", "cageId", "healthNoteId", "genotypingRecordId" ON "Attachment"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION "assert_same_lab_historical_link"();

CREATE CONSTRAINT TRIGGER "ExperimentAssignment_same_lab_check"
AFTER INSERT OR UPDATE OF "animalId", "experimentId", "status" ON "ExperimentAssignment"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION "assert_same_lab_historical_link"();

CREATE CONSTRAINT TRIGGER "AnimalProjectAllocation_same_lab_check"
AFTER INSERT OR UPDATE OF "animalId", "projectId", "endedAt" ON "AnimalProjectAllocation"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION "assert_same_lab_historical_link"();

CREATE CONSTRAINT TRIGGER "BreedingAdult_same_lab_check"
AFTER INSERT OR UPDATE OF "breedingSetupId", "animalId" ON "BreedingAdult"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION "assert_same_lab_historical_link"();

CREATE CONSTRAINT TRIGGER "Animal_intake_batch_initial_lab_check"
AFTER INSERT OR UPDATE OF "intakeBatchId" ON "Animal"
DEFERRABLE INITIALLY IMMEDIATE
FOR EACH ROW EXECUTE FUNCTION "assert_same_lab_historical_link"();

-- Open assignments/allocations and planned/active/paused breeding setups are
-- current operational relationships. Transfers preserve ended history but may
-- not strand a current relation in another lab. Parent checks are deferred for
-- coordinated writes that close the relation before transferring ownership.
CREATE FUNCTION "assert_active_ownership_same_lab"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'Animal' AND EXISTS (
    SELECT 1
    FROM "ExperimentAssignment" assignment
    JOIN "Experiment" e ON e.id = assignment."experimentId"
    WHERE assignment."animalId" = NEW.id
      AND assignment.status NOT IN ('completed', 'cancelled')
      AND e."labId" IS DISTINCT FROM NEW."owningLabId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Animal transfer would leave an open ExperimentAssignment in another lab';
  END IF;

  IF TG_TABLE_NAME = 'Animal' AND EXISTS (
    SELECT 1
    FROM "AnimalProjectAllocation" allocation
    JOIN "Project" p ON p.id = allocation."projectId"
    WHERE allocation."animalId" = NEW.id
      AND allocation."endedAt" IS NULL
      AND p."labId" IS DISTINCT FROM NEW."owningLabId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Animal transfer would leave an open AnimalProjectAllocation in another lab';
  END IF;

  IF TG_TABLE_NAME = 'Animal' AND EXISTS (
    SELECT 1
    FROM "BreedingAdult" adult
    JOIN "BreedingSetup" setup ON setup.id = adult."breedingSetupId"
    WHERE adult."animalId" = NEW.id
      AND setup.status IN ('planned', 'active', 'paused')
      AND setup."labId" IS DISTINCT FROM NEW."owningLabId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Animal transfer would leave a current BreedingAdult relation in another lab';
  END IF;

  IF TG_TABLE_NAME = 'Experiment' AND EXISTS (
    SELECT 1
    FROM "ExperimentAssignment" assignment
    JOIN "Animal" a ON a.id = assignment."animalId"
    WHERE assignment."experimentId" = NEW.id
      AND assignment.status NOT IN ('completed', 'cancelled')
      AND a."owningLabId" IS DISTINCT FROM NEW."labId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Experiment lab change would leave an open ExperimentAssignment in another lab';
  END IF;

  IF TG_TABLE_NAME = 'Project' AND EXISTS (
    SELECT 1
    FROM "AnimalProjectAllocation" allocation
    JOIN "Animal" a ON a.id = allocation."animalId"
    WHERE allocation."projectId" = NEW.id
      AND allocation."endedAt" IS NULL
      AND a."owningLabId" IS DISTINCT FROM NEW."labId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Project lab change would leave an open AnimalProjectAllocation in another lab';
  END IF;

  IF TG_TABLE_NAME = 'BreedingSetup'
    AND NEW.status IN ('planned', 'active', 'paused')
    AND EXISTS (
      SELECT 1
      FROM "BreedingAdult" adult
      JOIN "Animal" a ON a.id = adult."animalId"
      WHERE adult."breedingSetupId" = NEW.id
        AND a."owningLabId" IS DISTINCT FROM NEW."labId"
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'BreedingSetup lab/status change would leave a current BreedingAdult relation in another lab';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "Animal_open_assignment_same_lab_check"
AFTER UPDATE OF "owningLabId" ON "Animal"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_active_ownership_same_lab"();

CREATE CONSTRAINT TRIGGER "Experiment_open_assignment_same_lab_check"
AFTER UPDATE OF "labId" ON "Experiment"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_active_ownership_same_lab"();

CREATE CONSTRAINT TRIGGER "Project_open_allocation_same_lab_check"
AFTER UPDATE OF "labId" ON "Project"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_active_ownership_same_lab"();

CREATE CONSTRAINT TRIGGER "BreedingSetup_current_adult_same_lab_check"
AFTER UPDATE OF "labId", "status" ON "BreedingSetup"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_active_ownership_same_lab"();

COMMIT;
