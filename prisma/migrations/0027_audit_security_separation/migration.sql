BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';

CREATE TYPE "SecurityEventSeverity" AS ENUM ('info', 'warning', 'critical');
CREATE TYPE "SecurityEventOutcome" AS ENUM ('succeeded', 'denied', 'failed');

ALTER TABLE "AuditLog"
  ADD COLUMN "actorRole" TEXT,
  ADD COLUMN "labId" TEXT,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "commandReceiptId" TEXT,
  ADD COLUMN "commandType" TEXT,
  ADD COLUMN "commandAggregateType" TEXT,
  ADD COLUMN "commandAggregateId" TEXT;

ALTER TABLE "CommandReceipt"
  ADD COLUMN "transactionId" BIGINT NOT NULL DEFAULT txid_current();

CREATE OR REPLACE FUNCTION "stamp_command_receipt_principal"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT "authzVersion" INTO NEW."actorAuthzVersion"
  FROM "User"
  WHERE id = NEW."actorId";
  IF NEW."actorAuthzVersion" IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Command receipt actor does not exist';
  END IF;
  NEW."databasePrincipal" := SESSION_USER;
  NEW."transactionId" := txid_current();
  RETURN NEW;
END $$;

CREATE FUNCTION "protect_command_receipt_audit_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW."actorId" IS DISTINCT FROM OLD."actorId"
    OR NEW."actorAuthzVersion" IS DISTINCT FROM OLD."actorAuthzVersion"
    OR NEW."databasePrincipal" IS DISTINCT FROM OLD."databasePrincipal"
    OR NEW."labId" IS DISTINCT FROM OLD."labId"
    OR NEW."workflowDraftId" IS DISTINCT FROM OLD."workflowDraftId"
    OR NEW."commandType" IS DISTINCT FROM OLD."commandType"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."requestHash" IS DISTINCT FROM OLD."requestHash"
    OR NEW."requestId" IS DISTINCT FROM OLD."requestId"
    OR NEW."expectedVersion" IS DISTINCT FROM OLD."expectedVersion"
    OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
    OR NEW."transactionId" IS DISTINCT FROM OLD."transactionId"
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Command receipt audit identity is immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "CommandReceipt_audit_identity_guard"
BEFORE UPDATE ON "CommandReceipt"
FOR EACH ROW EXECUTE FUNCTION "protect_command_receipt_audit_identity"();

ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_actorId_fkey";
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "AuditLog_labId_fkey"
  FOREIGN KEY ("labId") REFERENCES "Lab"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "AuditLog_commandReceiptId_fkey"
  FOREIGN KEY ("commandReceiptId") REFERENCES "CommandReceipt"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
  ADD CONSTRAINT "AuditLog_actorRole_nonempty_check"
  CHECK ("actorRole" IS NULL OR LENGTH(BTRIM("actorRole")) > 0) NOT VALID,
  ADD CONSTRAINT "AuditLog_requestId_nonempty_check"
  CHECK ("requestId" IS NULL OR LENGTH(BTRIM("requestId")) > 0) NOT VALID,
  ADD CONSTRAINT "AuditLog_command_context_check"
  CHECK (
    ("commandReceiptId" IS NULL AND "commandType" IS NULL AND "commandAggregateType" IS NULL AND "commandAggregateId" IS NULL)
    OR ("commandReceiptId" IS NOT NULL AND "commandType" IS NOT NULL)
  ) NOT VALID;

CREATE TABLE "SecurityEvent" (
  id TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  severity "SecurityEventSeverity" NOT NULL DEFAULT 'info',
  outcome "SecurityEventOutcome" NOT NULL,
  "actorId" TEXT,
  "actorRole" TEXT NOT NULL DEFAULT 'system',
  "scopeLabId" TEXT,
  "correlationId" TEXT,
  "dedupeKey" TEXT,
  "subjectType" TEXT,
  "subjectId" TEXT,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY (id),
  CONSTRAINT "SecurityEvent_eventType_check" CHECK ("eventType" ~ '^[a-z][a-z0-9_.-]{2,119}$'),
  CONSTRAINT "SecurityEvent_actorRole_check" CHECK (LENGTH(BTRIM("actorRole")) > 0),
  CONSTRAINT "SecurityEvent_correlationId_check" CHECK ("correlationId" IS NULL OR LENGTH(BTRIM("correlationId")) > 0),
  CONSTRAINT "SecurityEvent_dedupeKey_check" CHECK ("dedupeKey" IS NULL OR LENGTH(BTRIM("dedupeKey")) > 0),
  CONSTRAINT "SecurityEvent_subject_pair_check" CHECK (("subjectType" IS NULL) = ("subjectId" IS NULL)),
  CONSTRAINT "SecurityEvent_source_check" CHECK (LENGTH(BTRIM(source)) BETWEEN 2 AND 120),
  CONSTRAINT "SecurityEvent_summary_check" CHECK (LENGTH(BTRIM(summary)) BETWEEN 2 AND 500),
  CONSTRAINT "SecurityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SecurityEvent_scopeLabId_fkey" FOREIGN KEY ("scopeLabId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SecurityEvent_dedupeKey_key" ON "SecurityEvent"("dedupeKey");
CREATE INDEX "SecurityEvent_occurredAt_idx" ON "SecurityEvent"("occurredAt");
CREATE INDEX "SecurityEvent_eventType_occurredAt_idx" ON "SecurityEvent"("eventType", "occurredAt");
CREATE INDEX "SecurityEvent_severity_occurredAt_idx" ON "SecurityEvent"(severity, "occurredAt");
CREATE INDEX "SecurityEvent_actorId_occurredAt_idx" ON "SecurityEvent"("actorId", "occurredAt");
CREATE INDEX "SecurityEvent_scopeLabId_occurredAt_idx" ON "SecurityEvent"("scopeLabId", "occurredAt");
CREATE INDEX "SecurityEvent_correlationId_idx" ON "SecurityEvent"("correlationId");

CREATE FUNCTION "canonical_audit_actor_role"(database_role TEXT)
RETURNS TEXT
IMMUTABLE
LANGUAGE sql
AS $$
  SELECT CASE database_role
    WHEN 'admin' THEN 'facility_admin'
    WHEN 'colony_manager' THEN 'cmu_staff'
    WHEN 'animal_staff' THEN 'lab_user'
    WHEN 'researcher' THEN 'lab_user'
    WHEN 'read_only' THEN 'lab_user'
    ELSE COALESCE(database_role, 'system')
  END
$$;

CREATE FUNCTION "stamp_operational_audit_context"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  database_role TEXT;
  receipt_id TEXT;
  context_actor_id TEXT;
  context_command_type TEXT;
  context_request_hash TEXT;
  receipt_row "CommandReceipt"%ROWTYPE;
BEGIN
  IF NEW."actorId" IS NULL THEN
    NEW."actorRole" := 'system';
  ELSE
    SELECT role::text INTO STRICT database_role FROM "User" WHERE id = NEW."actorId";
    NEW."actorRole" := "canonical_audit_actor_role"(database_role);
  END IF;

  receipt_id := NULLIF(current_setting('mcm.audit_receipt_id', true), '');
  context_actor_id := NULLIF(current_setting('mcm.audit_actor_id', true), '');
  context_command_type := NULLIF(current_setting('mcm.audit_command_type', true), '');
  context_request_hash := NULLIF(current_setting('mcm.audit_request_hash', true), '');
  IF receipt_id IS NOT NULL THEN
    SELECT receipt.*
    INTO receipt_row
    FROM "CommandReceipt" receipt
    WHERE receipt.id = receipt_id
      AND receipt."actorId" IS NOT DISTINCT FROM NEW."actorId"
      AND receipt."actorId" IS NOT DISTINCT FROM context_actor_id
      AND receipt."commandType" IS NOT DISTINCT FROM context_command_type
      AND receipt."requestHash" IS NOT DISTINCT FROM context_request_hash
      AND receipt.status = 'processing'
      AND receipt."completedAt" IS NULL
      AND receipt."transactionId" = txid_current();

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Audit command context is not current or does not match its receipt';
    END IF;
    IF NEW."commandReceiptId" IS NOT NULL AND NEW."commandReceiptId" <> receipt_row.id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Audit receipt relation conflicts with current command context';
    END IF;
    IF NEW."requestId" IS NOT NULL AND NEW."requestId" <> receipt_row."requestId" THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Audit request context conflicts with its command receipt';
    END IF;
    IF NEW."labId" IS NOT NULL AND NEW."labId" IS DISTINCT FROM receipt_row."labId" THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Audit lab context conflicts with its command receipt';
    END IF;
    IF NEW."commandType" IS NOT NULL AND NEW."commandType" <> receipt_row."commandType" THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Audit command type conflicts with its command receipt';
    END IF;

    NEW."commandReceiptId" := receipt_row.id;
    NEW."requestId" := receipt_row."requestId";
    NEW."labId" := receipt_row."labId";
    NEW."commandType" := receipt_row."commandType";
    NEW."commandAggregateType" := receipt_row."aggregateType";
    NEW."commandAggregateId" := receipt_row."aggregateId";
  ELSIF NEW."labId" IS NOT NULL
    OR NEW."requestId" IS NOT NULL
    OR NEW."commandReceiptId" IS NOT NULL
    OR NEW."commandType" IS NOT NULL
    OR NEW."commandAggregateType" IS NOT NULL
    OR NEW."commandAggregateId" IS NOT NULL
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Unreceipted audit command, lab, and request context is not authoritative';
  END IF;

  RETURN NEW;
END
$$;

CREATE FUNCTION "stamp_security_event_actor"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  database_role TEXT;
BEGIN
  IF NEW.source = 'legacy_audit_backfill'
    AND NEW."dedupeKey" LIKE 'legacy-audit:%'
    AND NEW.id = 'security-legacy-' || SUBSTRING(NEW."dedupeKey" FROM LENGTH('legacy-audit:') + 1)
    AND EXISTS (
      SELECT 1
      FROM "AuditLog" audit
      WHERE audit.id = SUBSTRING(NEW."dedupeKey" FROM LENGTH('legacy-audit:') + 1)
        AND audit."entityType" IN ('user_invitation', 'user_role', 'user_access')
        AND audit."actorId" IS NOT DISTINCT FROM NEW."actorId"
        AND audit."entityType" IS NOT DISTINCT FROM NEW."subjectType"
        AND audit."entityId" IS NOT DISTINCT FROM NEW."subjectId"
        AND audit."timestamp" IS NOT DISTINCT FROM NEW."occurredAt"
    )
  THEN
    NEW."actorRole" := CASE WHEN NEW."actorId" IS NULL THEN 'system' ELSE 'legacy_unsnapshotted' END;
  ELSIF NEW."actorId" IS NULL THEN
    NEW."actorRole" := 'system';
  ELSE
    SELECT role::text INTO STRICT database_role FROM "User" WHERE id = NEW."actorId";
    NEW."actorRole" := "canonical_audit_actor_role"(database_role);
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION "protect_operational_audit_history"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Operational audit history is append-only';
END
$$;

CREATE FUNCTION "protect_security_event_history"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Security event history is append-only';
END
$$;

CREATE TRIGGER "AuditLog_context_stamp"
BEFORE INSERT ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION "stamp_operational_audit_context"();
CREATE TRIGGER "AuditLog_append_only_guard"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION "protect_operational_audit_history"();
CREATE TRIGGER "AuditLog_truncate_guard"
BEFORE TRUNCATE ON "AuditLog"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_operational_audit_history"();

CREATE TRIGGER "SecurityEvent_actor_stamp"
BEFORE INSERT ON "SecurityEvent"
FOR EACH ROW EXECUTE FUNCTION "stamp_security_event_actor"();
CREATE TRIGGER "SecurityEvent_append_only_guard"
BEFORE UPDATE OR DELETE ON "SecurityEvent"
FOR EACH ROW EXECUTE FUNCTION "protect_security_event_history"();
CREATE TRIGGER "SecurityEvent_truncate_guard"
BEFORE TRUNCATE ON "SecurityEvent"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_security_event_history"();

COMMIT;
