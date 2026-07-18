BEGIN;

CREATE TYPE "CryostorageRequestType" AS ENUM ('store', 'recover', 'discard');
CREATE TYPE "CryostorageRequestStatus" AS ENUM ('submitted', 'completed', 'rejected', 'cancelled');
CREATE TYPE "CryostorageRequestEventType" AS ENUM ('submitted', 'completed', 'rejected', 'cancelled');
CREATE TYPE "CryostorageOperationType" AS ENUM ('store', 'recover', 'discard');

ALTER TABLE "CryostorageRecord"
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "CryostorageRecord_version_check" CHECK (version >= 1);

CREATE UNIQUE INDEX "CryostorageRecord_id_labId_key"
  ON "CryostorageRecord" (id, "labId");

ALTER TABLE "CryostorageRecord"
  DROP CONSTRAINT "CryostorageRecord_projectId_fkey",
  ADD CONSTRAINT "CryostorageRecord_projectId_labId_fkey"
    FOREIGN KEY ("projectId", "labId")
    REFERENCES "Project" (id, "labId")
    ON DELETE NO ACTION
    ON UPDATE NO ACTION
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE "CryostorageRequest" (
  id TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "requestType" "CryostorageRequestType" NOT NULL,
  status "CryostorageRequestStatus" NOT NULL DEFAULT 'submitted',
  "targetRecordId" TEXT,
  "targetRecordVersion" INTEGER,
  "strainId" TEXT,
  "projectId" TEXT,
  "sampleLabel" TEXT,
  "materialType" TEXT,
  "requestedQuantityLabel" TEXT,
  "requestedStorageLocation" TEXT,
  "requestedFor" TIMESTAMP(3) NOT NULL,
  notes TEXT,
  "requestedById" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionReason" TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CryostorageRequest_pkey" PRIMARY KEY (id),
  CONSTRAINT "CryostorageRequest_version_check" CHECK (version >= 1),
  CONSTRAINT "CryostorageRequest_requested_for_check" CHECK ("requestedFor" >= "requestedAt" - INTERVAL '1 day'),
  CONSTRAINT "CryostorageRequest_notes_check" CHECK (notes IS NULL OR char_length(notes) <= 1000),
  CONSTRAINT "CryostorageRequest_storage_location_check"
    CHECK ("requestedStorageLocation" IS NULL OR char_length("requestedStorageLocation") <= 160),
  CONSTRAINT "CryostorageRequest_quantity_check"
    CHECK ("requestedQuantityLabel" IS NULL OR char_length("requestedQuantityLabel") <= 100),
  CONSTRAINT "CryostorageRequest_payload_check" CHECK (
    (
      "requestType" = 'store'
      AND "targetRecordId" IS NULL
      AND "targetRecordVersion" IS NULL
      AND "strainId" IS NOT NULL
      AND char_length(btrim("sampleLabel")) BETWEEN 3 AND 80
      AND char_length(btrim("materialType")) BETWEEN 2 AND 80
    )
    OR
    (
      "requestType" IN ('recover', 'discard')
      AND "targetRecordId" IS NOT NULL
      AND "targetRecordVersion" >= 1
      AND "strainId" IS NULL
      AND "projectId" IS NULL
      AND "sampleLabel" IS NULL
      AND "materialType" IS NULL
    )
  ),
  CONSTRAINT "CryostorageRequest_decision_check" CHECK (
    (
      status = 'submitted'
      AND "decidedById" IS NULL
      AND "decidedAt" IS NULL
      AND "decisionReason" IS NULL
    )
    OR
    (
      status = 'completed'
      AND "decidedById" IS NOT NULL
      AND "decidedAt" IS NOT NULL
      AND "decidedAt" >= "requestedAt"
      AND ("decisionReason" IS NULL OR char_length(btrim("decisionReason")) BETWEEN 3 AND 1000)
    )
    OR
    (
      status IN ('rejected', 'cancelled')
      AND "decidedById" IS NOT NULL
      AND "decidedAt" IS NOT NULL
      AND "decidedAt" >= "requestedAt"
      AND char_length(btrim("decisionReason")) BETWEEN 3 AND 1000
    )
  )
);

CREATE TABLE "CryostorageRequestEvent" (
  id TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "eventType" "CryostorageRequestEventType" NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorRole" "UserRole" NOT NULL,
  "actorLabId" TEXT,
  reason TEXT,
  metadata JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CryostorageRequestEvent_pkey" PRIMARY KEY (id),
  CONSTRAINT "CryostorageRequestEvent_reason_check" CHECK (reason IS NULL OR char_length(reason) <= 1000)
);

CREATE TABLE "CryostorageOperation" (
  id TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "operationType" "CryostorageOperationType" NOT NULL,
  "previousStatus" "CryostorageStatus",
  "resultingStatus" "CryostorageStatus" NOT NULL,
  "performedAt" TIMESTAMP(3) NOT NULL,
  "performedById" TEXT NOT NULL,
  "storageLocation" TEXT,
  "quantityLabel" TEXT,
  notes TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CryostorageOperation_pkey" PRIMARY KEY (id),
  CONSTRAINT "CryostorageOperation_requestId_key" UNIQUE ("requestId"),
  CONSTRAINT "CryostorageOperation_notes_check" CHECK (notes IS NULL OR char_length(notes) <= 1000),
  CONSTRAINT "CryostorageOperation_location_check" CHECK ("storageLocation" IS NULL OR char_length("storageLocation") <= 160),
  CONSTRAINT "CryostorageOperation_quantity_check" CHECK ("quantityLabel" IS NULL OR char_length("quantityLabel") <= 100),
  CONSTRAINT "CryostorageOperation_status_check" CHECK (
    (
      "operationType" = 'store'
      AND "previousStatus" IS NULL
      AND "resultingStatus" = 'stored'
    )
    OR
    (
      "operationType" = 'recover'
      AND "previousStatus" IN ('stored', 'reserved')
      AND "resultingStatus" IN ('recovered', 'depleted')
    )
    OR
    (
      "operationType" = 'discard'
      AND "previousStatus" IN ('stored', 'reserved', 'recovered')
      AND "resultingStatus" = 'discarded'
    )
  )
);

CREATE INDEX "CryostorageRequest_labId_status_requestedAt_idx"
  ON "CryostorageRequest" ("labId", status, "requestedAt");
CREATE INDEX "CryostorageRequest_requestedById_requestedAt_idx"
  ON "CryostorageRequest" ("requestedById", "requestedAt");
CREATE INDEX "CryostorageRequest_targetRecordId_idx" ON "CryostorageRequest" ("targetRecordId");
CREATE INDEX "CryostorageRequest_projectId_idx" ON "CryostorageRequest" ("projectId");
CREATE INDEX "CryostorageRequest_strainId_idx" ON "CryostorageRequest" ("strainId");
CREATE INDEX "CryostorageRequestEvent_requestId_createdAt_idx"
  ON "CryostorageRequestEvent" ("requestId", "createdAt");
CREATE INDEX "CryostorageRequestEvent_actorId_createdAt_idx"
  ON "CryostorageRequestEvent" ("actorId", "createdAt");
CREATE INDEX "CryostorageRequestEvent_actorLabId_createdAt_idx"
  ON "CryostorageRequestEvent" ("actorLabId", "createdAt");
CREATE INDEX "CryostorageOperation_recordId_performedAt_idx"
  ON "CryostorageOperation" ("recordId", "performedAt");
CREATE INDEX "CryostorageOperation_labId_performedAt_idx"
  ON "CryostorageOperation" ("labId", "performedAt");
CREATE INDEX "CryostorageOperation_performedById_performedAt_idx"
  ON "CryostorageOperation" ("performedById", "performedAt");

ALTER TABLE "CryostorageRequest"
  ADD CONSTRAINT "CryostorageRequest_labId_fkey"
    FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CryostorageRequest_targetRecordId_labId_fkey"
    FOREIGN KEY ("targetRecordId", "labId") REFERENCES "CryostorageRecord"(id, "labId") ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "CryostorageRequest_strainId_fkey"
    FOREIGN KEY ("strainId") REFERENCES "Strain"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CryostorageRequest_projectId_labId_fkey"
    FOREIGN KEY ("projectId", "labId") REFERENCES "Project"(id, "labId") ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "CryostorageRequest_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CryostorageRequest_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CryostorageRequestEvent"
  ADD CONSTRAINT "CryostorageRequestEvent_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "CryostorageRequest"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CryostorageRequestEvent_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CryostorageRequestEvent_actorLabId_fkey"
    FOREIGN KEY ("actorLabId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CryostorageOperation"
  ADD CONSTRAINT "CryostorageOperation_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "CryostorageRequest"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CryostorageOperation_recordId_labId_fkey"
    FOREIGN KEY ("recordId", "labId") REFERENCES "CryostorageRecord"(id, "labId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "CryostorageOperation_labId_fkey"
    FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CryostorageOperation_performedById_fkey"
    FOREIGN KEY ("performedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "cryostorage_request_command_context_valid"(
  command_type TEXT,
  request_id TEXT,
  lab_id TEXT,
  actor_id TEXT,
  expected_version INTEGER
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "CommandReceipt" receipt
    JOIN "User" actor ON actor.id = receipt."actorId"
    WHERE receipt.id = current_setting('mcm.cryostorage_receipt_id', true)
      AND receipt."actorId" = actor_id
      AND receipt."commandType" = command_type
      AND receipt.status = 'processing'
      AND receipt."actorAuthzVersion" = actor."authzVersion"
      AND receipt."databasePrincipal" = SESSION_USER
      AND receipt."labId" = lab_id
      AND receipt."aggregateType" = 'cryostorage_request'
      AND receipt."aggregateId" = request_id
      AND receipt."expectedVersion" IS NOT DISTINCT FROM expected_version
      AND actor.active
  )
$$;

CREATE FUNCTION "validate_cryostorage_request_write"()
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
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Cryostorage request history cannot be deleted or truncated';
  END IF;

  actor_id := current_setting('mcm.cryostorage_actor_id', true);
  command_type := current_setting('mcm.cryostorage_command_type', true);

  IF TG_OP = 'INSERT' THEN
    IF command_type <> 'cryostorage.request.submit'
      OR NEW.status <> 'submitted'
      OR NEW."requestedById" IS DISTINCT FROM actor_id
      OR NEW.version <> 1
      OR NOT "cryostorage_request_command_context_valid"(command_type, NEW.id, NEW."labId", actor_id, NULL)
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Cryostorage requests require an authorized submit command';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW."labId" IS DISTINCT FROM OLD."labId"
      OR NEW."requestType" IS DISTINCT FROM OLD."requestType"
      OR NEW."targetRecordId" IS DISTINCT FROM OLD."targetRecordId"
      OR NEW."targetRecordVersion" IS DISTINCT FROM OLD."targetRecordVersion"
      OR NEW."strainId" IS DISTINCT FROM OLD."strainId"
      OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
      OR NEW."sampleLabel" IS DISTINCT FROM OLD."sampleLabel"
      OR NEW."materialType" IS DISTINCT FROM OLD."materialType"
      OR NEW."requestedQuantityLabel" IS DISTINCT FROM OLD."requestedQuantityLabel"
      OR NEW."requestedStorageLocation" IS DISTINCT FROM OLD."requestedStorageLocation"
      OR NEW."requestedFor" IS DISTINCT FROM OLD."requestedFor"
      OR NEW.notes IS DISTINCT FROM OLD.notes
      OR NEW."requestedById" IS DISTINCT FROM OLD."requestedById"
      OR NEW."requestedAt" IS DISTINCT FROM OLD."requestedAt"
      OR OLD.status <> 'submitted'
      OR NEW.version <> OLD.version + 1
      OR NEW."decidedById" IS DISTINCT FROM actor_id
      OR NOT (
        (command_type = 'cryostorage.request.cancel' AND NEW.status = 'cancelled')
        OR
        (command_type = 'cryostorage.request.execute' AND NEW.status IN ('completed', 'rejected'))
      )
      OR NOT "cryostorage_request_command_context_valid"(command_type, NEW.id, NEW."labId", actor_id, OLD.version)
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Cryostorage request transitions require an authorized command';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE FUNCTION "validate_cryostorage_event_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  actor_id TEXT;
  command_type TEXT;
  request_row "CryostorageRequest"%ROWTYPE;
  expected_version INTEGER;
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Cryostorage request events are append-only';
  END IF;

  actor_id := current_setting('mcm.cryostorage_actor_id', true);
  command_type := current_setting('mcm.cryostorage_command_type', true);
  SELECT * INTO request_row FROM "CryostorageRequest" WHERE id = NEW."requestId";
  expected_version := CASE WHEN command_type = 'cryostorage.request.submit' THEN NULL ELSE request_row.version - 1 END;

  IF NEW."actorId" IS DISTINCT FROM actor_id
    OR NEW."actorRole" IS DISTINCT FROM (SELECT role FROM "User" WHERE id = actor_id)
    OR NOT (
      (command_type = 'cryostorage.request.submit' AND NEW."eventType" = 'submitted' AND request_row.status = 'submitted')
      OR
      (command_type = 'cryostorage.request.cancel' AND NEW."eventType" = 'cancelled' AND request_row.status = 'cancelled')
      OR
      (command_type = 'cryostorage.request.execute' AND NEW."eventType" = request_row.status::text::"CryostorageRequestEventType" AND request_row.status IN ('completed', 'rejected'))
    )
    OR NOT "cryostorage_request_command_context_valid"(command_type, request_row.id, request_row."labId", actor_id, expected_version)
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Cryostorage request events require the matching authorized command';
  END IF;

  RETURN NEW;
END
$$;

CREATE FUNCTION "validate_cryostorage_operation_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  actor_id TEXT;
  request_row "CryostorageRequest"%ROWTYPE;
  record_row "CryostorageRecord"%ROWTYPE;
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Cryostorage operations are append-only';
  END IF;

  actor_id := current_setting('mcm.cryostorage_actor_id', true);
  SELECT * INTO request_row FROM "CryostorageRequest" WHERE id = NEW."requestId";
  SELECT * INTO record_row FROM "CryostorageRecord" WHERE id = NEW."recordId";

  IF current_setting('mcm.cryostorage_command_type', true) <> 'cryostorage.request.execute'
    OR NEW."performedById" IS DISTINCT FROM actor_id
    OR request_row.status <> 'completed'
    OR request_row."requestType"::text IS DISTINCT FROM NEW."operationType"::text
    OR request_row."labId" IS DISTINCT FROM NEW."labId"
    OR record_row."labId" IS DISTINCT FROM NEW."labId"
    OR record_row.status IS DISTINCT FROM NEW."resultingStatus"
    OR (
      request_row."requestType" IN ('recover', 'discard')
      AND request_row."targetRecordId" IS DISTINCT FROM NEW."recordId"
    )
    OR NOT "cryostorage_request_command_context_valid"(
      'cryostorage.request.execute', request_row.id, request_row."labId", actor_id, request_row.version - 1
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Cryostorage operations require the matching completed request command';
  END IF;

  RETURN NEW;
END
$$;

CREATE FUNCTION "assert_cryostorage_request_completion_row"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  request_status "CryostorageRequestStatus";
  operation_count INTEGER;
BEGIN
  SELECT status INTO request_status FROM "CryostorageRequest" WHERE id = NEW.id;
  SELECT COUNT(*) INTO operation_count FROM "CryostorageOperation" WHERE "requestId" = NEW.id;

  IF (request_status = 'completed' AND operation_count <> 1)
    OR (request_status <> 'completed' AND operation_count <> 0)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Completed cryostorage requests require exactly one matching operation';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION "assert_cryostorage_operation_completion_row"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  request_status "CryostorageRequestStatus";
  operation_count INTEGER;
BEGIN
  SELECT status INTO request_status FROM "CryostorageRequest" WHERE id = NEW."requestId";
  SELECT COUNT(*) INTO operation_count FROM "CryostorageOperation" WHERE "requestId" = NEW."requestId";

  IF (request_status = 'completed' AND operation_count <> 1)
    OR (request_status <> 'completed' AND operation_count <> 0)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Completed cryostorage requests require exactly one matching operation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "CryostorageRequest_write_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "CryostorageRequest"
FOR EACH ROW EXECUTE FUNCTION "validate_cryostorage_request_write"();
CREATE TRIGGER "CryostorageRequest_truncate_guard"
BEFORE TRUNCATE ON "CryostorageRequest"
FOR EACH STATEMENT EXECUTE FUNCTION "validate_cryostorage_request_write"();

CREATE TRIGGER "CryostorageRequestEvent_write_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "CryostorageRequestEvent"
FOR EACH ROW EXECUTE FUNCTION "validate_cryostorage_event_write"();
CREATE TRIGGER "CryostorageRequestEvent_truncate_guard"
BEFORE TRUNCATE ON "CryostorageRequestEvent"
FOR EACH STATEMENT EXECUTE FUNCTION "validate_cryostorage_event_write"();

CREATE TRIGGER "CryostorageOperation_write_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "CryostorageOperation"
FOR EACH ROW EXECUTE FUNCTION "validate_cryostorage_operation_write"();
CREATE TRIGGER "CryostorageOperation_truncate_guard"
BEFORE TRUNCATE ON "CryostorageOperation"
FOR EACH STATEMENT EXECUTE FUNCTION "validate_cryostorage_operation_write"();

CREATE CONSTRAINT TRIGGER "CryostorageRequest_completion_guard"
AFTER INSERT OR UPDATE ON "CryostorageRequest"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_cryostorage_request_completion_row"();
CREATE CONSTRAINT TRIGGER "CryostorageOperation_completion_guard"
AFTER INSERT ON "CryostorageOperation"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_cryostorage_operation_completion_row"();

COMMIT;
