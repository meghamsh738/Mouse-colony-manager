BEGIN;

CREATE TYPE "WorkflowDraftStatus" AS ENUM ('draft', 'review', 'submitted', 'committed', 'cancelled', 'expired');
CREATE TYPE "CommandReceiptStatus" AS ENUM ('processing', 'succeeded', 'failed');
CREATE TYPE "OutboxMessageStatus" AS ENUM ('pending', 'leased', 'retry', 'delivered', 'dead_letter', 'cancelled');
CREATE TYPE "OutboxAttemptStatus" AS ENUM ('processing', 'delivered', 'failed');
CREATE TYPE "FacilityIdentifierType" AS ENUM ('animal', 'cage');
CREATE TYPE "MigrationRunStatus" AS ENUM ('planned', 'running', 'succeeded', 'failed', 'rolled_back');
CREATE TYPE "OwnershipExceptionStatus" AS ENUM ('open', 'resolved', 'rejected');

ALTER TABLE "Animal" ADD COLUMN "facilityAnimalId" TEXT;
ALTER TABLE "Animal" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Cage" ADD COLUMN "facilityCageId" TEXT;
ALTER TABLE "Cage" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "AnimalIntakeBatch" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "BreedingSetup" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Litter" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Experiment" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Invoice" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

DO $$
DECLARE
  animal_count INTEGER;
  cage_count INTEGER;
  reserved_animal_ids INTEGER;
  reserved_cage_ids INTEGER;
BEGIN
  SELECT COUNT(*) INTO animal_count FROM "Animal";
  SELECT COUNT(*) INTO cage_count FROM "Cage";
  SELECT COUNT(DISTINCT identifier) INTO reserved_animal_ids
  FROM (
    SELECT "animalId" AS identifier FROM "Animal"
    UNION ALL
    SELECT "labId" AS identifier FROM "Animal"
  ) identifiers
  WHERE identifier ~ '^[0-9]{4}$' AND identifier::integer BETWEEN 1 AND 9999;
  SELECT COUNT(DISTINCT barcode) INTO reserved_cage_ids
  FROM "Cage" WHERE barcode ~ '^[0-9]{4}$' AND barcode::integer BETWEEN 1000 AND 9999;
  IF animal_count + reserved_animal_ids > 9999 THEN
    RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'animal facility ID sequence exhausted during migration (maximum 9999)';
  END IF;
  IF cage_count + reserved_cage_ids > 9000 THEN
    RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'cage facility ID sequence exhausted during migration (1000-9999)';
  END IF;
END $$;

WITH reserved AS (
  SELECT "animalId" AS identifier FROM "Animal" WHERE "animalId" ~ '^[0-9]{4}$' AND "animalId"::integer BETWEEN 1 AND 9999
  UNION
  SELECT "labId" AS identifier FROM "Animal" WHERE "labId" ~ '^[0-9]{4}$' AND "labId"::integer BETWEEN 1 AND 9999
), available AS (
  SELECT value AS sequence_value, ROW_NUMBER() OVER (ORDER BY value) AS row_number
  FROM generate_series(1, 9999) value
  WHERE LPAD(value::text, 4, '0') NOT IN (SELECT identifier FROM reserved)
), numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "animalId", id) AS row_number FROM "Animal"
)
UPDATE "Animal" animal
SET "facilityAnimalId" = LPAD(available.sequence_value::text, 4, '0')
FROM numbered JOIN available USING (row_number)
WHERE animal.id = numbered.id;

WITH reserved AS (
  SELECT barcode AS identifier FROM "Cage" WHERE barcode ~ '^[0-9]{4}$' AND barcode::integer BETWEEN 1000 AND 9999
), available AS (
  SELECT value AS sequence_value, ROW_NUMBER() OVER (ORDER BY value) AS row_number
  FROM generate_series(1000, 9999) value
  WHERE LPAD(value::text, 4, '0') NOT IN (SELECT identifier FROM reserved)
), numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY barcode, id) AS row_number FROM "Cage"
)
UPDATE "Cage" cage
SET "facilityCageId" = LPAD(available.sequence_value::text, 4, '0')
FROM numbered JOIN available USING (row_number)
WHERE cage.id = numbered.id;

ALTER TABLE "Animal" ALTER COLUMN "facilityAnimalId" SET NOT NULL;
ALTER TABLE "Cage" ALTER COLUMN "facilityCageId" SET NOT NULL;
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_facilityAnimalId_key" UNIQUE ("facilityAnimalId");
ALTER TABLE "Cage" ADD CONSTRAINT "Cage_facilityCageId_key" UNIQUE ("facilityCageId");
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_facilityAnimalId_format" CHECK ("facilityAnimalId" ~ '^[0-9]{4}$' AND "facilityAnimalId"::integer BETWEEN 1 AND 9999);
ALTER TABLE "Cage" ADD CONSTRAINT "Cage_facilityCageId_format" CHECK ("facilityCageId" ~ '^[0-9]{4}$' AND "facilityCageId"::integer BETWEEN 1000 AND 9999);

CREATE TABLE "WorkflowDraft" (
  id TEXT PRIMARY KEY,
  "workflowType" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "labId" TEXT,
  status "WorkflowDraftStatus" NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "committedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "WorkflowDraft_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkflowDraft_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkflowDraft_version_check" CHECK (version >= 1)
);
CREATE INDEX "WorkflowDraft_actorId_status_idx" ON "WorkflowDraft" ("actorId", status);
CREATE INDEX "WorkflowDraft_labId_status_idx" ON "WorkflowDraft" ("labId", status);
CREATE INDEX "WorkflowDraft_workflowType_status_idx" ON "WorkflowDraft" ("workflowType", status);
CREATE INDEX "WorkflowDraft_expiresAt_status_idx" ON "WorkflowDraft" ("expiresAt", status);

CREATE TABLE "WorkflowReviewSnapshot" (
  id TEXT PRIMARY KEY,
  "draftId" TEXT NOT NULL,
  "draftVersion" INTEGER NOT NULL,
  payload JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowReviewSnapshot_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "WorkflowDraft"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkflowReviewSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkflowReviewSnapshot_draftVersion_check" CHECK ("draftVersion" >= 1),
  CONSTRAINT "WorkflowReviewSnapshot_draftId_draftVersion_key" UNIQUE ("draftId", "draftVersion")
);
CREATE INDEX "WorkflowReviewSnapshot_createdById_createdAt_idx" ON "WorkflowReviewSnapshot" ("createdById", "createdAt");

CREATE TABLE "CommandReceipt" (
  id TEXT PRIMARY KEY,
  "actorId" TEXT NOT NULL,
  "labId" TEXT,
  "workflowDraftId" TEXT,
  "commandType" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  status "CommandReceiptStatus" NOT NULL DEFAULT 'processing',
  "aggregateType" TEXT,
  "aggregateId" TEXT,
  "expectedVersion" INTEGER,
  "resultingVersion" INTEGER,
  result JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "CommandReceipt_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommandReceipt_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommandReceipt_workflowDraftId_fkey" FOREIGN KEY ("workflowDraftId") REFERENCES "WorkflowDraft"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CommandReceipt_actorId_commandType_idempotencyKey_key" UNIQUE ("actorId", "commandType", "idempotencyKey"),
  CONSTRAINT "CommandReceipt_idempotency_key_nonempty" CHECK (LENGTH(BTRIM("idempotencyKey")) > 0)
);
CREATE INDEX "CommandReceipt_requestId_idx" ON "CommandReceipt" ("requestId");
CREATE INDEX "CommandReceipt_labId_startedAt_idx" ON "CommandReceipt" ("labId", "startedAt");
CREATE INDEX "CommandReceipt_aggregateType_aggregateId_idx" ON "CommandReceipt" ("aggregateType", "aggregateId");

CREATE TABLE "OutboxMessage" (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  "dedupeKey" TEXT UNIQUE,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "actorId" TEXT,
  "actorAuthzVersion" INTEGER,
  "labId" TEXT,
  "requiredCapability" TEXT,
  payload JSONB NOT NULL,
  status "OutboxMessageStatus" NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseToken" TEXT UNIQUE,
  "workerType" TEXT,
  "leasedAt" TIMESTAMP(3),
  "leaseExpiresAt" TIMESTAMP(3),
  "authorizedAt" TIMESTAMP(3),
  "authorizedCapability" TEXT,
  "authorizedActorAuthzVersion" INTEGER,
  "deliveredAt" TIMESTAMP(3),
  "deadLetteredAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutboxMessage_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "OutboxMessage_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OutboxMessage_attempt_bounds" CHECK ("attemptCount" >= 0 AND "maxAttempts" > 0 AND "attemptCount" <= "maxAttempts")
);
CREATE INDEX "OutboxMessage_status_availableAt_idx" ON "OutboxMessage" (status, "availableAt");
CREATE INDEX "OutboxMessage_topic_status_idx" ON "OutboxMessage" (topic, status);
CREATE INDEX "OutboxMessage_labId_status_idx" ON "OutboxMessage" ("labId", status);
CREATE INDEX "OutboxMessage_leaseExpiresAt_idx" ON "OutboxMessage" ("leaseExpiresAt");

CREATE TABLE "OutboxDeliveryAttempt" (
  id TEXT PRIMARY KEY,
  "messageId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "workerId" TEXT NOT NULL,
  "workerType" TEXT NOT NULL,
  "leaseToken" TEXT NOT NULL UNIQUE,
  status "OutboxAttemptStatus" NOT NULL DEFAULT 'processing',
  "authorizedAt" TIMESTAMP(3) NOT NULL,
  "authorizedCapability" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  CONSTRAINT "OutboxDeliveryAttempt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OutboxMessage"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutboxDeliveryAttempt_messageId_attemptNumber_key" UNIQUE ("messageId", "attemptNumber"),
  CONSTRAINT "OutboxDeliveryAttempt_attemptNumber_check" CHECK ("attemptNumber" > 0)
);
CREATE INDEX "OutboxDeliveryAttempt_workerId_startedAt_idx" ON "OutboxDeliveryAttempt" ("workerId", "startedAt");

CREATE TABLE "FacilityIdentitySequence" (
  "entityType" "FacilityIdentifierType" PRIMARY KEY,
  "nextValue" INTEGER NOT NULL,
  "minimumValue" INTEGER NOT NULL,
  "maximumValue" INTEGER NOT NULL,
  width INTEGER NOT NULL DEFAULT 4,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FacilityIdentitySequence_bounds" CHECK (
    "minimumValue" >= 0 AND "maximumValue" >= "minimumValue" AND
    "nextValue" >= "minimumValue" AND "nextValue" <= "maximumValue" + 1 AND width BETWEEN 1 AND 12
  )
);

CREATE TABLE "FacilityIdentifierAssignment" (
  id TEXT PRIMARY KEY,
  "entityType" "FacilityIdentifierType" NOT NULL,
  "sequenceValue" INTEGER NOT NULL,
  "displayId" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FacilityIdentifierAssignment_entityType_fkey" FOREIGN KEY ("entityType") REFERENCES "FacilityIdentitySequence"("entityType") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FacilityIdentifierAssignment_entityType_sequenceValue_key" UNIQUE ("entityType", "sequenceValue"),
  CONSTRAINT "FacilityIdentifierAssignment_entityType_displayId_key" UNIQUE ("entityType", "displayId"),
  CONSTRAINT "FacilityIdentifierAssignment_entityType_entityId_key" UNIQUE ("entityType", "entityId")
);
CREATE INDEX "FacilityIdentifierAssignment_entityId_idx" ON "FacilityIdentifierAssignment" ("entityId");

CREATE TABLE "LegacyIdentifierAlias" (
  id TEXT PRIMARY KEY,
  "entityType" "FacilityIdentifierType" NOT NULL,
  "entityId" TEXT NOT NULL,
  alias TEXT NOT NULL,
  "canonicalDisplayId" TEXT NOT NULL,
  source TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacyIdentifierAlias_entityType_alias_key" UNIQUE ("entityType", alias)
);
CREATE INDEX "LegacyIdentifierAlias_entityType_entityId_idx" ON "LegacyIdentifierAlias" ("entityType", "entityId");

CREATE TABLE "MigrationRun" (
  id TEXT PRIMARY KEY,
  "runKey" TEXT NOT NULL UNIQUE,
  "migrationType" TEXT NOT NULL,
  status "MigrationRunStatus" NOT NULL DEFAULT 'planned',
  "initiatedById" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  summary JSONB,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MigrationRun_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "MigrationRun_migrationType_status_idx" ON "MigrationRun" ("migrationType", status);

CREATE TABLE "OwnershipException" (
  id TEXT PRIMARY KEY,
  "migrationRunId" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "fieldName" TEXT NOT NULL,
  "currentValue" JSONB,
  candidates JSONB,
  reason TEXT NOT NULL,
  status "OwnershipExceptionStatus" NOT NULL DEFAULT 'open',
  resolution JSONB,
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "OwnershipException_migrationRunId_fkey" FOREIGN KEY ("migrationRunId") REFERENCES "MigrationRun"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OwnershipException_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "OwnershipException_migrationRunId_status_idx" ON "OwnershipException" ("migrationRunId", status);
CREATE INDEX "OwnershipException_entityType_entityId_status_idx" ON "OwnershipException" ("entityType", "entityId", status);
CREATE UNIQUE INDEX "OwnershipException_open_entity_field_key"
  ON "OwnershipException" ("entityType", "entityId", "fieldName") WHERE status = 'open';

INSERT INTO "FacilityIdentitySequence" ("entityType", "nextValue", "minimumValue", "maximumValue", width, "updatedAt")
VALUES
  ('animal', COALESCE((SELECT MAX("facilityAnimalId"::integer) + 1 FROM "Animal"), 1), 1, 9999, 4, CURRENT_TIMESTAMP),
  ('cage', COALESCE((SELECT MAX("facilityCageId"::integer) + 1 FROM "Cage"), 1000), 1000, 9999, 4, CURRENT_TIMESTAMP);

INSERT INTO "FacilityIdentifierAssignment" (id, "entityType", "sequenceValue", "displayId", "entityId", "issuedAt")
SELECT 'facility-animal-' || id, 'animal', "facilityAnimalId"::integer, "facilityAnimalId", id, CURRENT_TIMESTAMP FROM "Animal";
INSERT INTO "FacilityIdentifierAssignment" (id, "entityType", "sequenceValue", "displayId", "entityId", "issuedAt")
SELECT 'facility-cage-' || id, 'cage', "facilityCageId"::integer, "facilityCageId", id, CURRENT_TIMESTAMP FROM "Cage";

INSERT INTO "LegacyIdentifierAlias" (id, "entityType", "entityId", alias, "canonicalDisplayId", source, "createdAt")
SELECT 'legacy-animal-' || id, 'animal', id, "animalId", "facilityAnimalId", 'migration-0010', CURRENT_TIMESTAMP
FROM "Animal" WHERE "animalId" <> "facilityAnimalId";
-- Colony IDs have deterministic precedence over lab IDs when retained data reused the same value.
INSERT INTO "LegacyIdentifierAlias" (id, "entityType", "entityId", alias, "canonicalDisplayId", source, "createdAt")
SELECT 'legacy-animal-lab-' || animal.id, 'animal', animal.id, animal."labId", animal."facilityAnimalId", 'migration-0010-lab-id', CURRENT_TIMESTAMP
FROM "Animal" animal
WHERE animal."labId" <> animal."facilityAnimalId"
  AND animal."labId" <> animal."animalId"
  AND NOT EXISTS (
    SELECT 1 FROM "LegacyIdentifierAlias" alias
    WHERE alias."entityType" = 'animal' AND alias.alias = animal."labId"
  );
INSERT INTO "LegacyIdentifierAlias" (id, "entityType", "entityId", alias, "canonicalDisplayId", source, "createdAt")
SELECT 'legacy-cage-' || id, 'cage', id, barcode, "facilityCageId", 'migration-0010', CURRENT_TIMESTAMP
FROM "Cage" WHERE barcode <> "facilityCageId";

CREATE FUNCTION "reject_legacy_alias_canonical_collision"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.alias ~ '^[0-9]{4}$' AND EXISTS (
    SELECT 1 FROM "FacilityIdentifierAssignment" assignment
    WHERE assignment."entityType" = NEW."entityType"
      AND assignment."displayId" = NEW.alias
      AND assignment."entityId" <> NEW."entityId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'legacy identifier collides with an assigned canonical facility ID';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "LegacyIdentifierAlias_canonical_collision"
BEFORE INSERT OR UPDATE OF alias, "entityType", "entityId" ON "LegacyIdentifierAlias"
FOR EACH ROW EXECUTE FUNCTION "reject_legacy_alias_canonical_collision"();

CREATE FUNCTION "reject_assignment_legacy_alias_collision"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "LegacyIdentifierAlias" alias
    WHERE alias."entityType" = NEW."entityType"
      AND alias.alias = NEW."displayId"
      AND alias."entityId" <> NEW."entityId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'canonical facility ID collides with a retained legacy identifier';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FacilityIdentifierAssignment_legacy_alias_collision"
BEFORE INSERT OR UPDATE OF "entityType", "displayId", "entityId" ON "FacilityIdentifierAssignment"
FOR EACH ROW EXECUTE FUNCTION "reject_assignment_legacy_alias_collision"();

CREATE FUNCTION "bump_or_validate_aggregate_version"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.version = OLD.version THEN
    NEW.version := OLD.version + 1;
  ELSIF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'aggregate version must advance by exactly one';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Animal_version_bump" BEFORE UPDATE ON "Animal" FOR EACH ROW EXECUTE FUNCTION "bump_or_validate_aggregate_version"();
CREATE TRIGGER "Cage_version_bump" BEFORE UPDATE ON "Cage" FOR EACH ROW EXECUTE FUNCTION "bump_or_validate_aggregate_version"();
CREATE TRIGGER "AnimalIntakeBatch_version_bump" BEFORE UPDATE ON "AnimalIntakeBatch" FOR EACH ROW EXECUTE FUNCTION "bump_or_validate_aggregate_version"();
CREATE TRIGGER "BreedingSetup_version_bump" BEFORE UPDATE ON "BreedingSetup" FOR EACH ROW EXECUTE FUNCTION "bump_or_validate_aggregate_version"();
CREATE TRIGGER "Litter_version_bump" BEFORE UPDATE ON "Litter" FOR EACH ROW EXECUTE FUNCTION "bump_or_validate_aggregate_version"();
CREATE TRIGGER "Experiment_version_bump" BEFORE UPDATE ON "Experiment" FOR EACH ROW EXECUTE FUNCTION "bump_or_validate_aggregate_version"();
CREATE TRIGGER "Invoice_version_bump" BEFORE UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION "bump_or_validate_aggregate_version"();
CREATE TRIGGER "WorkflowDraft_version_bump" BEFORE UPDATE ON "WorkflowDraft" FOR EACH ROW EXECUTE FUNCTION "bump_or_validate_aggregate_version"();

CREATE FUNCTION "protect_facility_identifier"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'Animal' AND NEW."facilityAnimalId" IS DISTINCT FROM OLD."facilityAnimalId" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'animal facility ID is immutable';
  END IF;
  IF TG_TABLE_NAME = 'Cage' AND NEW."facilityCageId" IS DISTINCT FROM OLD."facilityCageId" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'cage facility ID is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Animal_facility_id_immutable" BEFORE UPDATE OF "facilityAnimalId" ON "Animal" FOR EACH ROW EXECUTE FUNCTION "protect_facility_identifier"();
CREATE TRIGGER "Cage_facility_id_immutable" BEFORE UPDATE OF "facilityCageId" ON "Cage" FOR EACH ROW EXECUTE FUNCTION "protect_facility_identifier"();

CREATE FUNCTION "issue_facility_identifier"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  identifier_type "FacilityIdentifierType";
  display_id TEXT;
  sequence_value INTEGER;
  legacy_colony_id TEXT;
  legacy_lab_id TEXT;
  legacy_barcode TEXT;
  record_json JSONB;
  sequence_row "FacilityIdentitySequence"%ROWTYPE;
BEGIN
  record_json := to_jsonb(NEW);
  IF TG_TABLE_NAME = 'Animal' THEN
    identifier_type := 'animal';
    display_id := record_json ->> 'facilityAnimalId';
    legacy_colony_id := record_json ->> 'animalId';
    legacy_lab_id := record_json ->> 'labId';
  ELSE
    identifier_type := 'cage';
    display_id := record_json ->> 'facilityCageId';
    legacy_barcode := record_json ->> 'barcode';
  END IF;
  IF display_id !~ '^[0-9]{4}$' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'facility identifier must contain exactly four digits';
  END IF;
  sequence_value := display_id::integer;
  SELECT * INTO sequence_row FROM "FacilityIdentitySequence" WHERE "entityType" = identifier_type;
  IF NOT FOUND OR sequence_value < sequence_row."minimumValue" OR sequence_value > sequence_row."maximumValue"
    OR sequence_value >= sequence_row."nextValue" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'facility identifier was not reserved from the active sequence';
  END IF;
  INSERT INTO "FacilityIdentifierAssignment" (id, "entityType", "sequenceValue", "displayId", "entityId", "issuedAt")
  VALUES ('facility-' || identifier_type::text || '-' || NEW.id, identifier_type, sequence_value, display_id, NEW.id, CURRENT_TIMESTAMP);
  IF TG_TABLE_NAME = 'Animal' AND legacy_colony_id IS DISTINCT FROM display_id THEN
    INSERT INTO "LegacyIdentifierAlias" (id, "entityType", "entityId", alias, "canonicalDisplayId", source, "createdAt")
    VALUES ('legacy-animal-colony-' || NEW.id, identifier_type, NEW.id, legacy_colony_id, display_id, 'record-create-animal-id', CURRENT_TIMESTAMP);
  END IF;
  IF TG_TABLE_NAME = 'Animal' AND legacy_lab_id IS DISTINCT FROM display_id AND legacy_lab_id IS DISTINCT FROM legacy_colony_id THEN
    INSERT INTO "LegacyIdentifierAlias" (id, "entityType", "entityId", alias, "canonicalDisplayId", source, "createdAt")
    VALUES ('legacy-animal-lab-' || NEW.id, identifier_type, NEW.id, legacy_lab_id, display_id, 'record-create-lab-id', CURRENT_TIMESTAMP);
  END IF;
  IF TG_TABLE_NAME = 'Cage' AND legacy_barcode IS DISTINCT FROM display_id THEN
    INSERT INTO "LegacyIdentifierAlias" (id, "entityType", "entityId", alias, "canonicalDisplayId", source, "createdAt")
    VALUES ('legacy-cage-barcode-' || NEW.id, identifier_type, NEW.id, legacy_barcode, display_id, 'record-create-barcode', CURRENT_TIMESTAMP);
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "Animal_issue_facility_identifier"
AFTER INSERT ON "Animal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "issue_facility_identifier"();
CREATE CONSTRAINT TRIGGER "Cage_issue_facility_identifier"
AFTER INSERT ON "Cage" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "issue_facility_identifier"();

CREATE FUNCTION "reject_immutable_row_change"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND (
      current_database() ~* '(^|_)(test|e2e|disposable)($|_)'
      OR TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
    ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = TG_TABLE_NAME || ' rows are append-only';
END $$;
CREATE TRIGGER "WorkflowReviewSnapshot_immutable" BEFORE UPDATE OR DELETE ON "WorkflowReviewSnapshot" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_change"();
CREATE TRIGGER "FacilityIdentifierAssignment_immutable" BEFORE UPDATE OR DELETE ON "FacilityIdentifierAssignment" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_change"();
CREATE TRIGGER "LegacyIdentifierAlias_immutable" BEFORE UPDATE OR DELETE ON "LegacyIdentifierAlias" FOR EACH ROW EXECUTE FUNCTION "reject_immutable_row_change"();

CREATE FUNCTION "protect_facility_identity_sequence"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND (
      current_database() ~* '(^|_)(test|e2e|disposable)($|_)'
      OR TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
    ) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'facility identity sequences cannot be deleted';
  END IF;
  IF NEW."entityType" IS DISTINCT FROM OLD."entityType"
    OR NEW."minimumValue" IS DISTINCT FROM OLD."minimumValue"
    OR NEW."maximumValue" IS DISTINCT FROM OLD."maximumValue"
    OR NEW.width IS DISTINCT FROM OLD.width
    OR NEW."nextValue" < OLD."nextValue" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'facility identity sequence configuration is immutable and nextValue is monotonic';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FacilityIdentitySequence_monotonic"
BEFORE UPDATE OR DELETE ON "FacilityIdentitySequence"
FOR EACH ROW EXECUTE FUNCTION "protect_facility_identity_sequence"();

COMMIT;
