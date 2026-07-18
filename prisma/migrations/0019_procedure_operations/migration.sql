BEGIN;

CREATE TYPE "ProcedurePlanStatus" AS ENUM ('planned', 'completed', 'cancelled');
CREATE TYPE "ProcedureOccurrenceStatus" AS ENUM ('completed', 'not_performed', 'aborted');

CREATE UNIQUE INDEX "ExperimentAssignment_id_experimentId_key"
  ON "ExperimentAssignment" (id, "experimentId");

CREATE TABLE "ProcedurePlan" (
  id TEXT PRIMARY KEY,
  "labId" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "procedureCode" TEXT NOT NULL,
  title TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  status "ProcedurePlanStatus" NOT NULL DEFAULT 'planned',
  "sopId" TEXT NOT NULL,
  "sopVersionId" TEXT NOT NULL,
  "sopVersionNumber" INTEGER NOT NULL,
  "sopContentHash" TEXT NOT NULL,
  "sopAssignmentId" TEXT NOT NULL,
  "assignmentContextSnapshot" JSONB NOT NULL,
  "experimentContextSnapshot" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ProcedurePlan_version_check" CHECK (version >= 1),
  CONSTRAINT "ProcedurePlan_code_check" CHECK (LENGTH(BTRIM("procedureCode")) BETWEEN 2 AND 80),
  CONSTRAINT "ProcedurePlan_title_check" CHECK (LENGTH(BTRIM(title)) BETWEEN 2 AND 160),
  CONSTRAINT "ProcedurePlan_sop_version_check" CHECK ("sopVersionNumber" >= 1),
  CONSTRAINT "ProcedurePlan_sop_hash_check" CHECK ("sopContentHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ProcedurePlan_assignment_context_check" CHECK (jsonb_typeof("assignmentContextSnapshot") = 'object'),
  CONSTRAINT "ProcedurePlan_experiment_context_check" CHECK (jsonb_typeof("experimentContextSnapshot") = 'object')
);

CREATE UNIQUE INDEX "ProcedurePlan_id_labId_key" ON "ProcedurePlan" (id, "labId");
CREATE INDEX "ProcedurePlan_labId_status_scheduledAt_idx" ON "ProcedurePlan" ("labId", status, "scheduledAt");
CREATE INDEX "ProcedurePlan_experimentId_scheduledAt_idx" ON "ProcedurePlan" ("experimentId", "scheduledAt");
CREATE INDEX "ProcedurePlan_assignmentId_status_idx" ON "ProcedurePlan" ("assignmentId", status);
CREATE INDEX "ProcedurePlan_sopId_sopVersionId_idx" ON "ProcedurePlan" ("sopId", "sopVersionId");
CREATE INDEX "ProcedurePlan_sopAssignmentId_idx" ON "ProcedurePlan" ("sopAssignmentId");

ALTER TABLE "ProcedurePlan"
  ADD CONSTRAINT "ProcedurePlan_labId_fkey"
    FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProcedurePlan_experimentId_labId_fkey"
    FOREIGN KEY ("experimentId", "labId") REFERENCES "Experiment"(id, "labId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ProcedurePlan_assignmentId_experimentId_fkey"
    FOREIGN KEY ("assignmentId", "experimentId") REFERENCES "ExperimentAssignment"(id, "experimentId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ProcedurePlan_sopId_fkey"
    FOREIGN KEY ("sopId") REFERENCES "SopDocument"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProcedurePlan_sopVersionId_sopId_fkey"
    FOREIGN KEY ("sopVersionId", "sopId") REFERENCES "SopVersion"(id, "sopId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ProcedurePlan_sopAssignmentId_sopId_sopVersionId_labId_fkey"
    FOREIGN KEY ("sopAssignmentId", "sopId", "sopVersionId", "labId")
      REFERENCES "SopAssignment"(id, "sopId", "sopVersionId", "labId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ProcedurePlan_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProcedureOccurrence" (
  id TEXT PRIMARY KEY,
  "planId" TEXT NOT NULL,
  "occurrenceKey" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "animalId" TEXT NOT NULL,
  "experimentCodeSnapshot" TEXT NOT NULL,
  "animalFacilityIdSnapshot" TEXT NOT NULL,
  "cageBarcodeSnapshot" TEXT,
  "roomNumberSnapshot" TEXT,
  "rackNumberSnapshot" TEXT,
  "cageNumberSnapshot" TEXT,
  "procedureCode" TEXT NOT NULL,
  title TEXT NOT NULL,
  "plannedAt" TIMESTAMP(3) NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  status "ProcedureOccurrenceStatus" NOT NULL,
  "outcomeNote" TEXT,
  "planVersion" INTEGER NOT NULL,
  "sopId" TEXT NOT NULL,
  "sopVersionId" TEXT NOT NULL,
  "sopVersionNumber" INTEGER NOT NULL,
  "sopContentHash" TEXT NOT NULL,
  "sopAssignmentId" TEXT NOT NULL,
  "assignmentContextSnapshot" JSONB NOT NULL,
  "experimentContextSnapshot" JSONB NOT NULL,
  "executedById" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcedureOccurrence_key_check" CHECK (LENGTH(BTRIM("occurrenceKey")) BETWEEN 1 AND 120),
  CONSTRAINT "ProcedureOccurrence_plan_version_check" CHECK ("planVersion" >= 1),
  CONSTRAINT "ProcedureOccurrence_sop_version_check" CHECK ("sopVersionNumber" >= 1),
  CONSTRAINT "ProcedureOccurrence_sop_hash_check" CHECK ("sopContentHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ProcedureOccurrence_assignment_context_check" CHECK (jsonb_typeof("assignmentContextSnapshot") = 'object'),
  CONSTRAINT "ProcedureOccurrence_experiment_context_check" CHECK (jsonb_typeof("experimentContextSnapshot") = 'object'),
  CONSTRAINT "ProcedureOccurrence_outcome_note_check" CHECK (
    status = 'completed' OR ("outcomeNote" IS NOT NULL AND LENGTH(BTRIM("outcomeNote")) >= 3)
  )
);

CREATE UNIQUE INDEX "ProcedureOccurrence_planId_occurrenceKey_key"
  ON "ProcedureOccurrence" ("planId", "occurrenceKey");
CREATE INDEX "ProcedureOccurrence_labId_occurredAt_idx" ON "ProcedureOccurrence" ("labId", "occurredAt");
CREATE INDEX "ProcedureOccurrence_animalId_occurredAt_idx" ON "ProcedureOccurrence" ("animalId", "occurredAt");
CREATE INDEX "ProcedureOccurrence_planId_occurredAt_idx" ON "ProcedureOccurrence" ("planId", "occurredAt");
CREATE INDEX "ProcedureOccurrence_sopId_sopVersionId_idx" ON "ProcedureOccurrence" ("sopId", "sopVersionId");
CREATE INDEX "ProcedureOccurrence_sopAssignmentId_idx" ON "ProcedureOccurrence" ("sopAssignmentId");

ALTER TABLE "ProcedureOccurrence"
  ADD CONSTRAINT "ProcedureOccurrence_planId_labId_fkey"
    FOREIGN KEY ("planId", "labId") REFERENCES "ProcedurePlan"(id, "labId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ProcedureOccurrence_labId_fkey"
    FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProcedureOccurrence_experimentId_labId_fkey"
    FOREIGN KEY ("experimentId", "labId") REFERENCES "Experiment"(id, "labId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ProcedureOccurrence_assignmentId_experimentId_fkey"
    FOREIGN KEY ("assignmentId", "experimentId") REFERENCES "ExperimentAssignment"(id, "experimentId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ProcedureOccurrence_animalId_fkey"
    FOREIGN KEY ("animalId") REFERENCES "Animal"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProcedureOccurrence_sopId_fkey"
    FOREIGN KEY ("sopId") REFERENCES "SopDocument"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProcedureOccurrence_sopVersionId_sopId_fkey"
    FOREIGN KEY ("sopVersionId", "sopId") REFERENCES "SopVersion"(id, "sopId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ProcedureOccurrence_sopAssignmentId_sopId_sopVersionId_labId_fkey"
    FOREIGN KEY ("sopAssignmentId", "sopId", "sopVersionId", "labId")
      REFERENCES "SopAssignment"(id, "sopId", "sopVersionId", "labId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "ProcedureOccurrence_executedById_fkey"
    FOREIGN KEY ("executedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AnimalStatusEvent"
  ADD COLUMN "sopId" TEXT,
  ADD COLUMN "sopVersionId" TEXT,
  ADD COLUMN "sopVersionNumber" INTEGER,
  ADD COLUMN "sopContentHash" TEXT,
  ADD COLUMN "sopAssignmentId" TEXT,
  ADD CONSTRAINT "AnimalStatusEvent_sop_snapshot_check" CHECK (
    ("sopId" IS NULL AND "sopVersionId" IS NULL AND "sopVersionNumber" IS NULL AND "sopContentHash" IS NULL AND "sopAssignmentId" IS NULL)
    OR
    ("sopId" IS NOT NULL AND "sopVersionId" IS NOT NULL AND "sopVersionNumber" >= 1 AND "sopContentHash" ~ '^[0-9a-f]{64}$' AND "sopAssignmentId" IS NOT NULL)
  ),
  ADD CONSTRAINT "AnimalStatusEvent_sopId_fkey"
    FOREIGN KEY ("sopId") REFERENCES "SopDocument"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AnimalStatusEvent_sopVersionId_sopId_fkey"
    FOREIGN KEY ("sopVersionId", "sopId") REFERENCES "SopVersion"(id, "sopId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "AnimalStatusEvent_sopAssignmentId_fkey"
    FOREIGN KEY ("sopAssignmentId") REFERENCES "SopAssignment"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "AnimalStatusEvent_sopId_sopVersionId_idx"
  ON "AnimalStatusEvent" ("sopId", "sopVersionId");
CREATE INDEX "AnimalStatusEvent_sopAssignmentId_idx"
  ON "AnimalStatusEvent" ("sopAssignmentId");

CREATE FUNCTION "procedure_command_context_valid"(
  command_type TEXT,
  aggregate_type TEXT,
  aggregate_id TEXT,
  actor_id TEXT,
  expected_version INTEGER,
  lab_id TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT
    COALESCE(current_setting('mcm.procedure_actor_id', true), '') = actor_id
    AND COALESCE(current_setting('mcm.procedure_command_type', true), '') = command_type
    AND EXISTS (
      SELECT 1
      FROM "CommandReceipt" receipt
      JOIN "User" actor ON actor.id = receipt."actorId"
      WHERE receipt.id = current_setting('mcm.procedure_receipt_id', true)
        AND receipt."actorId" = actor_id
        AND receipt."commandType" = command_type
        AND receipt.status = 'processing'
        AND receipt."aggregateType" = aggregate_type
        AND receipt."aggregateId" = aggregate_id
        AND receipt."expectedVersion" IS NOT DISTINCT FROM expected_version
        AND receipt."labId" IS NOT DISTINCT FROM lab_id
        AND receipt."actorAuthzVersion" = actor."authzVersion"
        AND receipt."databasePrincipal" = SESSION_USER
        AND actor.active
    )
$$;

CREATE FUNCTION "procedure_actor_can_plan"(actor_id TEXT, lab_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "User" actor
    WHERE actor.id = actor_id
      AND actor.active
      AND (
        actor.role IN ('facility_admin', 'admin')
        OR (
          actor.role IN ('lab_user', 'animal_staff', 'researcher')
          AND EXISTS (
            SELECT 1
            FROM "LabMembership" membership
            JOIN "Lab" lab ON lab.id = membership."labId"
            WHERE membership."userId" = actor.id
              AND membership."labId" = lab_id
              AND membership.active
              AND lab.active
              AND membership.role IN ('owner', 'manager', 'staff')
          )
        )
      )
  )
$$;

CREATE FUNCTION "procedure_actor_can_execute"(actor_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "User" actor
    WHERE actor.id = actor_id
      AND actor.active
      AND actor.role IN ('facility_admin', 'admin', 'cmu_staff', 'colony_manager')
  )
$$;

CREATE FUNCTION "procedure_assignment_context"(assignment_id TEXT)
RETURNS JSONB
LANGUAGE SQL
STABLE
AS $$
  SELECT jsonb_build_object(
    'animalId', assignment."animalId",
    'startDate', assignment."startDate",
    'endDate', assignment."endDate",
    'treatmentGroup', assignment."treatmentGroup"
  )
  FROM "ExperimentAssignment" assignment
  WHERE assignment.id = assignment_id
$$;

CREATE FUNCTION "procedure_experiment_context"(experiment_id TEXT)
RETURNS JSONB
LANGUAGE SQL
STABLE
AS $$
  SELECT jsonb_build_object(
    'experimentCode', experiment."experimentCode",
    'title', experiment.title,
    'projectId', experiment."projectId",
    'projectCode', project."projectCode",
    'plannedStartAt', experiment."plannedStartAt",
    'plannedEndAt', experiment."plannedEndAt",
    'operationalContact', experiment."operationalContact",
    'procedureSummary', experiment."procedureSummary",
    'treatmentSummary', experiment."treatmentSummary",
    'welfareRisks', experiment."welfareRisks",
    'scheduleNotes', experiment."scheduleNotes",
    'operationalNotes', experiment."operationalNotes"
  )
  FROM "Experiment" experiment
  JOIN "Project" project ON project.id = experiment."projectId"
  WHERE experiment.id = experiment_id
$$;

CREATE FUNCTION "procedure_plan_binding_valid"(
  lab_id TEXT,
  experiment_id TEXT,
  assignment_id TEXT,
  sop_id TEXT,
  sop_version_id TEXT,
  sop_version_number INTEGER,
  sop_content_hash TEXT,
  sop_assignment_id TEXT,
  assignment_context JSONB,
  experiment_context JSONB,
  operational_at TIMESTAMP(3)
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "ExperimentAssignment" assignment
    JOIN "Experiment" experiment
      ON experiment.id = assignment."experimentId"
    JOIN "Animal" animal
      ON animal.id = assignment."animalId"
    JOIN "SopDocument" document
      ON document.id = sop_id
    JOIN "SopVersion" version
      ON version.id = sop_version_id
     AND version."sopId" = document.id
    JOIN "SopVersionApproval" approval
      ON approval."sopVersionId" = version.id
     AND approval."sopId" = document.id
    JOIN "SopAssignment" sop_assignment
      ON sop_assignment.id = sop_assignment_id
     AND sop_assignment."sopId" = document.id
     AND sop_assignment."sopVersionId" = version.id
     AND sop_assignment."labId" = lab_id
     AND sop_assignment."revokedAt" IS NULL
    WHERE assignment.id = assignment_id
      AND assignment."experimentId" = experiment_id
      AND assignment.status IN ('planned', 'reserved', 'active')
      AND experiment."labId" = lab_id
      AND experiment.status IN ('planned', 'active')
      AND animal."owningLabId" = lab_id
      AND animal."outcomeStatus" = 'alive'
      AND document."currentVersionId" = version.id
      AND (document.scope = 'facility' OR document."labId" = lab_id)
      AND document.active
      AND approval.decision = 'approved'
      AND version."versionNumber" = sop_version_number
      AND version."contentHash" = sop_content_hash
      AND assignment_context IS NOT DISTINCT FROM "procedure_assignment_context"(assignment_id)
      AND experiment_context IS NOT DISTINCT FROM "procedure_experiment_context"(experiment_id)
      AND operational_at >= version."createdAt"
      AND operational_at >= approval."decidedAt"
      AND operational_at >= sop_assignment."assignedAt"
  )
$$;

CREATE FUNCTION "validate_procedure_plan_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  actor_id TEXT;
  command_type TEXT;
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Procedure plans cannot be deleted or truncated';
  END IF;
  actor_id := current_setting('mcm.procedure_actor_id', true);
  command_type := current_setting('mcm.procedure_command_type', true);

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'planned' OR NEW.version <> 1 OR NEW."createdById" IS DISTINCT FROM actor_id
      OR NEW."scheduledAt" < NEW."createdAt"
      OR command_type <> 'procedure.plan.create'
      OR NOT "procedure_actor_can_plan"(actor_id, NEW."labId")
      OR NOT "procedure_command_context_valid"(command_type, 'procedure_plan', NEW.id, actor_id, NULL, NEW."labId")
      OR NOT "procedure_plan_binding_valid"(
        NEW."labId", NEW."experimentId", NEW."assignmentId", NEW."sopId", NEW."sopVersionId",
        NEW."sopVersionNumber", NEW."sopContentHash", NEW."sopAssignmentId",
        NEW."assignmentContextSnapshot", NEW."experimentContextSnapshot", NEW."scheduledAt"
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Procedure planning requires an authorized exact lab, assignment, SOP, and command receipt';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW."labId" IS DISTINCT FROM OLD."labId"
    OR NEW."experimentId" IS DISTINCT FROM OLD."experimentId"
    OR NEW."assignmentId" IS DISTINCT FROM OLD."assignmentId"
    OR NEW."procedureCode" IS DISTINCT FROM OLD."procedureCode"
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW."scheduledAt" IS DISTINCT FROM OLD."scheduledAt"
    OR NEW."sopId" IS DISTINCT FROM OLD."sopId"
    OR NEW."sopVersionId" IS DISTINCT FROM OLD."sopVersionId"
    OR NEW."sopVersionNumber" IS DISTINCT FROM OLD."sopVersionNumber"
    OR NEW."sopContentHash" IS DISTINCT FROM OLD."sopContentHash"
    OR NEW."sopAssignmentId" IS DISTINCT FROM OLD."sopAssignmentId"
    OR NEW."assignmentContextSnapshot" IS DISTINCT FROM OLD."assignmentContextSnapshot"
    OR NEW."experimentContextSnapshot" IS DISTINCT FROM OLD."experimentContextSnapshot"
    OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW.version <> OLD.version + 1
    OR OLD.status <> 'planned'
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Procedure plan identity and exact SOP binding are immutable';
  END IF;

  IF NEW.status = 'cancelled' THEN
    IF command_type <> 'procedure.plan.cancel'
      OR NOT "procedure_actor_can_plan"(actor_id, OLD."labId")
      OR NOT "procedure_command_context_valid"(command_type, 'procedure_plan', OLD.id, actor_id, OLD.version, OLD."labId")
      OR EXISTS (SELECT 1 FROM "ProcedureOccurrence" occurrence WHERE occurrence."planId" = OLD.id)
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Procedure cancellation requires plan authority, the current version, and no execution history';
    END IF;
  ELSIF NEW.status = 'completed' THEN
    IF command_type <> 'procedure.occurrence.record'
      OR NOT "procedure_actor_can_execute"(actor_id)
      OR NOT "procedure_command_context_valid"(command_type, 'procedure_plan', OLD.id, actor_id, OLD.version, OLD."labId")
      OR NOT EXISTS (
        SELECT 1 FROM "ProcedureOccurrence" occurrence
        WHERE occurrence."planId" = OLD.id AND occurrence."planVersion" = OLD.version
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Procedure completion requires an immutable occurrence and authorized execution receipt';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Invalid procedure plan state transition';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ProcedurePlan_write_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "ProcedurePlan"
FOR EACH ROW EXECUTE FUNCTION "validate_procedure_plan_write"();
CREATE TRIGGER "ProcedurePlan_truncate_guard"
BEFORE TRUNCATE ON "ProcedurePlan"
FOR EACH STATEMENT EXECUTE FUNCTION "validate_procedure_plan_write"();

CREATE FUNCTION "validate_procedure_occurrence_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  plan_record "ProcedurePlan"%ROWTYPE;
  assignment_animal_id TEXT;
  experiment_code TEXT;
  facility_animal_id TEXT;
  cage_barcode TEXT;
  room_number TEXT;
  rack_number TEXT;
  cage_number TEXT;
  actor_id TEXT;
BEGIN
  actor_id := current_setting('mcm.procedure_actor_id', true);
  SELECT * INTO plan_record FROM "ProcedurePlan" WHERE id = NEW."planId" FOR UPDATE;
  SELECT assignment."animalId", experiment."experimentCode", animal."facilityAnimalId",
         cage.barcode, room."roomNumber", rack."rackNumber", cage."cageNumber"
    INTO assignment_animal_id, experiment_code, facility_animal_id,
         cage_barcode, room_number, rack_number, cage_number
    FROM "ExperimentAssignment" assignment
    JOIN "Experiment" experiment ON experiment.id = assignment."experimentId"
    JOIN "Animal" animal ON animal.id = assignment."animalId"
    LEFT JOIN "Cage" cage ON cage.id = animal."currentCageId"
    LEFT JOIN "Room" room ON room.id = cage."roomId"
    LEFT JOIN "Rack" rack ON rack.id = cage."rackId"
   WHERE assignment.id = NEW."assignmentId";

  IF plan_record.id IS NULL
    OR plan_record.status <> 'planned'
    OR plan_record.version <> NEW."planVersion"
    OR NOT "procedure_actor_can_execute"(actor_id)
    OR NOT "procedure_command_context_valid"(
      'procedure.occurrence.record', 'procedure_plan', NEW."planId", actor_id, NEW."planVersion", NEW."labId"
    )
    OR NOT "procedure_plan_binding_valid"(
      plan_record."labId", plan_record."experimentId", plan_record."assignmentId", plan_record."sopId",
      plan_record."sopVersionId", plan_record."sopVersionNumber", plan_record."sopContentHash",
      plan_record."sopAssignmentId", plan_record."assignmentContextSnapshot",
      plan_record."experimentContextSnapshot", NEW."occurredAt"
    )
    OR NEW."labId" IS DISTINCT FROM plan_record."labId"
    OR NEW."experimentId" IS DISTINCT FROM plan_record."experimentId"
    OR NEW."assignmentId" IS DISTINCT FROM plan_record."assignmentId"
    OR NEW."animalId" IS DISTINCT FROM assignment_animal_id
    OR NEW."experimentCodeSnapshot" IS DISTINCT FROM experiment_code
    OR NEW."animalFacilityIdSnapshot" IS DISTINCT FROM facility_animal_id
    OR NEW."cageBarcodeSnapshot" IS DISTINCT FROM cage_barcode
    OR NEW."roomNumberSnapshot" IS DISTINCT FROM room_number
    OR NEW."rackNumberSnapshot" IS DISTINCT FROM rack_number
    OR NEW."cageNumberSnapshot" IS DISTINCT FROM cage_number
    OR NEW."procedureCode" IS DISTINCT FROM plan_record."procedureCode"
    OR NEW.title IS DISTINCT FROM plan_record.title
    OR NEW."plannedAt" IS DISTINCT FROM plan_record."scheduledAt"
    OR NEW."sopId" IS DISTINCT FROM plan_record."sopId"
    OR NEW."sopVersionId" IS DISTINCT FROM plan_record."sopVersionId"
    OR NEW."sopVersionNumber" IS DISTINCT FROM plan_record."sopVersionNumber"
    OR NEW."sopContentHash" IS DISTINCT FROM plan_record."sopContentHash"
    OR NEW."sopAssignmentId" IS DISTINCT FROM plan_record."sopAssignmentId"
    OR NEW."assignmentContextSnapshot" IS DISTINCT FROM plan_record."assignmentContextSnapshot"
    OR NEW."experimentContextSnapshot" IS DISTINCT FROM plan_record."experimentContextSnapshot"
    OR NEW."occurredAt" < plan_record."createdAt"
    OR NEW."executedById" IS DISTINCT FROM actor_id
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Procedure occurrence does not match the authorized current plan, animal, location, or exact SOP';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ProcedureOccurrence_insert_guard"
BEFORE INSERT ON "ProcedureOccurrence"
FOR EACH ROW EXECUTE FUNCTION "validate_procedure_occurrence_insert"();

CREATE FUNCTION "prevent_procedure_occurrence_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL ELSE OLD END;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Procedure occurrences are immutable operational history';
END $$;

CREATE TRIGGER "ProcedureOccurrence_append_only"
BEFORE UPDATE OR DELETE ON "ProcedureOccurrence"
FOR EACH ROW EXECUTE FUNCTION "prevent_procedure_occurrence_mutation"();
CREATE TRIGGER "ProcedureOccurrence_truncate_guard"
BEFORE TRUNCATE ON "ProcedureOccurrence"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_procedure_occurrence_mutation"();

CREATE FUNCTION "validate_animal_status_event_sop_snapshot"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."sopId" IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "SopVersion" version
    JOIN "SopDocument" document
      ON document.id = version."sopId"
    JOIN "SopVersionApproval" approval
      ON approval."sopVersionId" = version.id AND approval."sopId" = version."sopId"
    JOIN "Animal" animal
      ON animal.id = NEW."animalId"
    JOIN "SopAssignment" assignment
      ON assignment.id = NEW."sopAssignmentId"
     AND assignment."sopId" = document.id
     AND assignment."sopVersionId" = version.id
     AND assignment."labId" = animal."owningLabId"
     AND assignment."revokedAt" IS NULL
    WHERE version.id = NEW."sopVersionId"
      AND version."sopId" = NEW."sopId"
      AND version."versionNumber" = NEW."sopVersionNumber"
      AND version."contentHash" = NEW."sopContentHash"
      AND approval.decision = 'approved'
      AND document.active
      AND document."currentVersionId" = version.id
      AND (document.scope = 'facility' OR document."labId" = animal."owningLabId")
      AND NEW."happenedAt" >= version."createdAt"
      AND NEW."happenedAt" >= approval."decidedAt"
      AND NEW."happenedAt" >= assignment."assignedAt"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Animal lifecycle SOP provenance must match the current approved exact version assigned to the animal lab';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "AnimalStatusEvent_sop_snapshot_guard"
BEFORE INSERT ON "AnimalStatusEvent"
FOR EACH ROW EXECUTE FUNCTION "validate_animal_status_event_sop_snapshot"();

CREATE FUNCTION "prevent_animal_status_event_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL ELSE OLD END;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Animal lifecycle status events are append-only history';
END $$;

CREATE TRIGGER "AnimalStatusEvent_append_only"
BEFORE UPDATE OR DELETE ON "AnimalStatusEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_animal_status_event_mutation"();
CREATE TRIGGER "AnimalStatusEvent_truncate_guard"
BEFORE TRUNCATE ON "AnimalStatusEvent"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_animal_status_event_mutation"();

CREATE FUNCTION "block_animal_transfer_with_open_procedure"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."owningLabId" IS DISTINCT FROM OLD."owningLabId"
    AND EXISTS (
      SELECT 1
      FROM "ProcedurePlan" plan
      JOIN "ExperimentAssignment" assignment ON assignment.id = plan."assignmentId"
      WHERE assignment."animalId" = OLD.id AND plan.status = 'planned'
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Open procedure plans must be cancelled before transferring the animal to another lab';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Animal_open_procedure_transfer_guard"
BEFORE UPDATE OF "owningLabId" ON "Animal"
FOR EACH ROW EXECUTE FUNCTION "block_animal_transfer_with_open_procedure"();

COMMIT;
