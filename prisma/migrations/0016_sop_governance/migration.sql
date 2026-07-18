BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
ALTER EXTENSION pgcrypto SET SCHEMA public;

CREATE TYPE "SopScope" AS ENUM ('facility', 'lab');
CREATE TYPE "SopApprovalDecision" AS ENUM ('approved', 'rejected');

ALTER TABLE "CommandReceipt"
  ADD COLUMN "actorAuthzVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "databasePrincipal" TEXT NOT NULL DEFAULT SESSION_USER;

UPDATE "CommandReceipt" receipt
SET "actorAuthzVersion" = actor."authzVersion"
FROM "User" actor
WHERE actor.id = receipt."actorId";

CREATE FUNCTION "stamp_command_receipt_principal"()
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
  RETURN NEW;
END $$;

CREATE TRIGGER "CommandReceipt_principal_stamp"
BEFORE INSERT ON "CommandReceipt"
FOR EACH ROW EXECUTE FUNCTION "stamp_command_receipt_principal"();

CREATE FUNCTION "protect_sop_command_receipt_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."commandType" LIKE 'sop.%'
    AND (
      NEW.id IS DISTINCT FROM OLD.id
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
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'SOP command receipt identity and principal evidence are immutable';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "CommandReceipt_sop_identity_guard"
BEFORE UPDATE ON "CommandReceipt"
FOR EACH ROW EXECUTE FUNCTION "protect_sop_command_receipt_identity"();

CREATE FUNCTION "sop_content_hash"(title TEXT, category TEXT, content_markdown TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT encode(
    public.digest(convert_to(title || E'\n' || category || E'\n' || content_markdown, 'UTF8'), 'sha256'),
    'hex'
  );
$$;

CREATE TABLE "SopDocument" (
  id TEXT PRIMARY KEY,
  scope "SopScope" NOT NULL,
  "labId" TEXT,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  "currentVersionId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SopDocument_scope_lab_check" CHECK (
    (scope = 'facility' AND "labId" IS NULL)
    OR (scope = 'lab' AND "labId" IS NOT NULL)
  ),
  CONSTRAINT "SopDocument_version_check" CHECK (version >= 1),
  CONSTRAINT "SopDocument_code_check" CHECK (LENGTH(BTRIM(code)) > 0),
  CONSTRAINT "SopDocument_title_check" CHECK (LENGTH(BTRIM(title)) > 0),
  CONSTRAINT "SopDocument_category_check" CHECK (LENGTH(BTRIM(category)) > 0)
);

CREATE TABLE "SopVersion" (
  id TEXT PRIMARY KEY,
  "sopId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  "contentMarkdown" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "changeSummary" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SopVersion_version_number_check" CHECK ("versionNumber" >= 1),
  CONSTRAINT "SopVersion_title_check" CHECK (LENGTH(BTRIM(title)) > 0),
  CONSTRAINT "SopVersion_category_check" CHECK (LENGTH(BTRIM(category)) > 0),
  CONSTRAINT "SopVersion_content_hash_check" CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "SopVersion_content_hash_matches_check" CHECK (
    "contentHash" = "sop_content_hash"(title, category, "contentMarkdown")
  ),
  CONSTRAINT "SopVersion_change_summary_check" CHECK (LENGTH(BTRIM("changeSummary")) > 0)
);

CREATE TABLE "SopVersionApproval" (
  id TEXT PRIMARY KEY,
  "sopId" TEXT NOT NULL,
  "sopVersionId" TEXT NOT NULL,
  decision "SopApprovalDecision" NOT NULL,
  "decidedById" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note TEXT
);

CREATE TABLE "SopAssignment" (
  id TEXT PRIMARY KEY,
  "sopId" TEXT NOT NULL,
  "sopVersionId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "assignedById" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3),
  reason TEXT NOT NULL,
  "revokedById" TEXT,
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "SopAssignment_version_check" CHECK (version >= 1),
  CONSTRAINT "SopAssignment_reason_check" CHECK (LENGTH(BTRIM(reason)) > 0),
  CONSTRAINT "SopAssignment_due_check" CHECK ("dueAt" IS NULL OR "dueAt" >= "assignedAt"),
  CONSTRAINT "SopAssignment_revocation_check" CHECK (
    ("revokedById" IS NULL AND "revokedAt" IS NULL AND "revocationReason" IS NULL)
    OR
    ("revokedById" IS NOT NULL AND "revokedAt" IS NOT NULL AND LENGTH(BTRIM("revocationReason")) > 0)
  )
);

CREATE TABLE "SopAcknowledgement" (
  id TEXT PRIMARY KEY,
  "assignmentId" TEXT NOT NULL,
  "sopId" TEXT NOT NULL,
  "sopVersionId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attestation TEXT NOT NULL,
  CONSTRAINT "SopAcknowledgement_content_hash_check" CHECK ("contentHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "SopAcknowledgement_attestation_check" CHECK (LENGTH(BTRIM(attestation)) > 0)
);

CREATE UNIQUE INDEX "SopDocument_currentVersionId_key" ON "SopDocument" ("currentVersionId");
CREATE UNIQUE INDEX "SopDocument_currentVersionId_id_key" ON "SopDocument" ("currentVersionId", id);
CREATE UNIQUE INDEX "SopDocument_facility_code_key" ON "SopDocument" (code) WHERE scope = 'facility';
CREATE UNIQUE INDEX "SopDocument_lab_code_key" ON "SopDocument" ("labId", code) WHERE scope = 'lab';
CREATE INDEX "SopDocument_labId_active_idx" ON "SopDocument" ("labId", active);
CREATE INDEX "SopDocument_createdById_createdAt_idx" ON "SopDocument" ("createdById", "createdAt");

CREATE UNIQUE INDEX "SopVersion_sopId_versionNumber_key" ON "SopVersion" ("sopId", "versionNumber");
CREATE UNIQUE INDEX "SopVersion_id_sopId_key" ON "SopVersion" (id, "sopId");
CREATE INDEX "SopVersion_createdById_createdAt_idx" ON "SopVersion" ("createdById", "createdAt");

CREATE UNIQUE INDEX "SopVersionApproval_sopVersionId_key" ON "SopVersionApproval" ("sopVersionId");
CREATE UNIQUE INDEX "SopVersionApproval_sopVersionId_sopId_key"
  ON "SopVersionApproval" ("sopVersionId", "sopId");
CREATE INDEX "SopVersionApproval_sopId_decision_idx" ON "SopVersionApproval" ("sopId", decision);
CREATE INDEX "SopVersionApproval_decidedById_decidedAt_idx" ON "SopVersionApproval" ("decidedById", "decidedAt");

CREATE UNIQUE INDEX "SopAssignment_id_sopId_sopVersionId_labId_key"
  ON "SopAssignment" (id, "sopId", "sopVersionId", "labId");
CREATE UNIQUE INDEX "SopAssignment_one_active_per_lab_sop_key"
  ON "SopAssignment" ("labId", "sopId") WHERE "revokedAt" IS NULL;
CREATE INDEX "SopAssignment_sopId_labId_idx" ON "SopAssignment" ("sopId", "labId");
CREATE INDEX "SopAssignment_sopVersionId_idx" ON "SopAssignment" ("sopVersionId");
CREATE INDEX "SopAssignment_labId_assignedAt_idx" ON "SopAssignment" ("labId", "assignedAt");
CREATE INDEX "SopAssignment_assignedById_assignedAt_idx" ON "SopAssignment" ("assignedById", "assignedAt");
CREATE INDEX "SopAssignment_revokedById_revokedAt_idx" ON "SopAssignment" ("revokedById", "revokedAt");

CREATE UNIQUE INDEX "SopAcknowledgement_assignmentId_userId_key"
  ON "SopAcknowledgement" ("assignmentId", "userId");
CREATE INDEX "SopAcknowledgement_sopId_sopVersionId_idx"
  ON "SopAcknowledgement" ("sopId", "sopVersionId");
CREATE INDEX "SopAcknowledgement_labId_acknowledgedAt_idx"
  ON "SopAcknowledgement" ("labId", "acknowledgedAt");
CREATE INDEX "SopAcknowledgement_userId_acknowledgedAt_idx"
  ON "SopAcknowledgement" ("userId", "acknowledgedAt");

ALTER TABLE "SopDocument"
  ADD CONSTRAINT "SopDocument_labId_fkey"
    FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SopDocument_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SopVersion"
  ADD CONSTRAINT "SopVersion_sopId_fkey"
    FOREIGN KEY ("sopId") REFERENCES "SopDocument"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SopVersion_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SopDocument"
  ADD CONSTRAINT "SopDocument_currentVersionId_id_fkey"
    FOREIGN KEY ("currentVersionId", id) REFERENCES "SopVersion"(id, "sopId") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "SopVersionApproval"
  ADD CONSTRAINT "SopVersionApproval_sopVersionId_sopId_fkey"
    FOREIGN KEY ("sopVersionId", "sopId") REFERENCES "SopVersion"(id, "sopId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "SopVersionApproval_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SopAssignment"
  ADD CONSTRAINT "SopAssignment_sopId_fkey"
    FOREIGN KEY ("sopId") REFERENCES "SopDocument"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SopAssignment_sopVersionId_sopId_fkey"
    FOREIGN KEY ("sopVersionId", "sopId") REFERENCES "SopVersion"(id, "sopId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "SopAssignment_labId_fkey"
    FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SopAssignment_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SopAssignment_revokedById_fkey"
    FOREIGN KEY ("revokedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SopAcknowledgement"
  ADD CONSTRAINT "SopAcknowledgement_assignmentId_sopId_sopVersionId_labId_fkey"
    FOREIGN KEY ("assignmentId", "sopId", "sopVersionId", "labId")
    REFERENCES "SopAssignment"(id, "sopId", "sopVersionId", "labId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "SopAcknowledgement_sopVersionId_sopId_fkey"
    FOREIGN KEY ("sopVersionId", "sopId") REFERENCES "SopVersion"(id, "sopId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "SopAcknowledgement_labId_fkey"
    FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SopAcknowledgement_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "sop_command_context_valid"(
  command_type TEXT,
  aggregate_type TEXT,
  aggregate_id TEXT,
  actor_id TEXT,
  expected_version INTEGER,
  command_lab_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(current_setting('mcm.sop_actor_id', true), '') = actor_id
    AND COALESCE(current_setting('mcm.sop_command_type', true), '') = command_type
    AND EXISTS (
      SELECT 1
      FROM "CommandReceipt" receipt
      JOIN "User" actor ON actor.id = receipt."actorId"
      WHERE receipt.id = current_setting('mcm.sop_receipt_id', true)
        AND receipt."actorId" = actor_id
        AND receipt."commandType" = command_type
        AND receipt."aggregateType" = aggregate_type
        AND receipt."aggregateId" = aggregate_id
        AND receipt."expectedVersion" IS NOT DISTINCT FROM expected_version
        AND receipt."labId" IS NOT DISTINCT FROM command_lab_id
        AND receipt."actorAuthzVersion" = actor."authzVersion"
        AND receipt."databasePrincipal" = SESSION_USER
        AND receipt.status = 'processing'
        AND actor.active
    );
$$;

CREATE FUNCTION "sop_actor_can_manage_scope"(actor_id TEXT, sop_scope "SopScope", lab_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "User" actor
    WHERE actor.id = actor_id
      AND actor.active
      AND (
        (sop_scope = 'facility' AND actor.role IN ('facility_admin', 'admin', 'cmu_staff', 'colony_manager'))
        OR (
          sop_scope = 'lab'
          AND actor.role = 'lab_user'
          AND EXISTS (
            SELECT 1
            FROM "LabMembership" membership
            JOIN "Lab" lab ON lab.id = membership."labId"
            WHERE membership."userId" = actor.id
              AND membership."labId" = lab_id
              AND membership.active
              AND membership.role IN ('owner', 'manager')
              AND lab.active
          )
        )
      )
  );
$$;

CREATE FUNCTION "sop_actor_can_approve_version"(actor_id TEXT, sop_id TEXT, version_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "SopVersion" version
    JOIN "SopDocument" document ON document.id = version."sopId"
    JOIN "User" actor ON actor.id = actor_id
    WHERE version.id = version_id
      AND version."sopId" = sop_id
      AND actor.active
      AND (
        (
          document.scope = 'facility'
          AND actor.role IN ('facility_admin', 'admin')
          AND version."createdById" <> actor.id
        )
        OR (
          document.scope = 'lab'
          AND actor.role = 'lab_user'
          AND EXISTS (
            SELECT 1
            FROM "LabMembership" membership
            JOIN "Lab" lab ON lab.id = membership."labId"
            WHERE membership."userId" = actor.id
              AND membership."labId" = document."labId"
              AND membership.active
              AND membership.role IN ('owner', 'manager')
              AND lab.active
          )
        )
      )
  );
$$;

CREATE FUNCTION "sop_actor_is_active_lab_member"(actor_id TEXT, lab_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "User" actor
    JOIN "LabMembership" membership ON membership."userId" = actor.id
    JOIN "Lab" lab ON lab.id = membership."labId"
    WHERE actor.id = actor_id
      AND actor.active
      AND actor.role = 'lab_user'
      AND membership."labId" = lab_id
      AND membership.active
      AND lab.active
  );
$$;

CREATE FUNCTION "protect_sop_document_identity_and_current_version"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  approved_current BOOLEAN;
  actor_id TEXT;
  command_type TEXT;
  old_current_number INTEGER;
  new_current_number INTEGER;
  new_current_title TEXT;
  new_current_category TEXT;
BEGIN
  actor_id := current_setting('mcm.sop_actor_id', true);
  command_type := current_setting('mcm.sop_command_type', true);

  IF TG_OP = 'INSERT' THEN
    IF NEW."currentVersionId" IS NOT NULL
      OR NOT "sop_command_context_valid"('sop.create', 'sop_document', NEW.id, NEW."createdById", NULL, NEW."labId")
      OR NOT "sop_actor_can_manage_scope"(NEW."createdById", NEW.scope, NEW."labId")
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SOP document creation requires an authorized active command receipt';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.scope IS DISTINCT FROM OLD.scope
    OR NEW."labId" IS DISTINCT FROM OLD."labId"
    OR NEW.code IS DISTINCT FROM OLD.code
    OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'SOP document code, scope, ownership, and creation identity are immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'SOP document updates must advance aggregate version exactly once';
  END IF;
  IF NOT "sop_command_context_valid"(command_type, 'sop_document', NEW.id, actor_id, OLD.version, NEW."labId") THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SOP document update is not bound to its active versioned command receipt';
  END IF;
  IF command_type NOT IN ('sop.version.create', 'sop.version.decide', 'sop.assign') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Unsupported SOP document transition';
  END IF;
  IF command_type <> 'sop.version.decide'
    AND (
      NEW."currentVersionId" IS DISTINCT FROM OLD."currentVersionId"
      OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.category IS DISTINCT FROM OLD.category
      OR NEW.active IS DISTINCT FROM OLD.active
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Drafting or assigning an SOP cannot alter controlled document metadata';
  END IF;

  IF NEW."currentVersionId" IS NOT NULL THEN
    EXECUTE format(
      'SELECT
         EXISTS (
           SELECT 1
           FROM %I."SopVersion" version
           JOIN %I."SopVersionApproval" approval
             ON approval."sopVersionId" = version.id
            AND approval."sopId" = version."sopId"
          WHERE version.id = $1
            AND version."sopId" = $2
            AND approval.decision = ''approved''
         ),
         (SELECT "versionNumber" FROM %I."SopVersion" WHERE id = $1 AND "sopId" = $2),
         (SELECT title FROM %I."SopVersion" WHERE id = $1 AND "sopId" = $2),
         (SELECT category FROM %I."SopVersion" WHERE id = $1 AND "sopId" = $2)',
      TG_TABLE_SCHEMA,
      TG_TABLE_SCHEMA,
      TG_TABLE_SCHEMA,
      TG_TABLE_SCHEMA,
      TG_TABLE_SCHEMA
    ) INTO approved_current, new_current_number, new_current_title, new_current_category
      USING NEW."currentVersionId", NEW.id;
    IF NOT approved_current THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The current SOP version must belong to the document and have an approved immutable approval';
    END IF;
    IF OLD."currentVersionId" IS NOT NULL THEN
      EXECUTE format(
        'SELECT "versionNumber" FROM %I."SopVersion" WHERE id = $1 AND "sopId" = $2',
        TG_TABLE_SCHEMA
      ) INTO old_current_number USING OLD."currentVersionId", OLD.id;
      IF NEW."currentVersionId" IS DISTINCT FROM OLD."currentVersionId"
        AND new_current_number <= old_current_number
      THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Controlled SOP versions may only advance monotonically; rollback requires a new version';
      END IF;
    END IF;
    IF NEW.title IS DISTINCT FROM new_current_title OR NEW.category IS DISTINCT FROM new_current_category THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Controlled SOP metadata must match the current approved version';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SopDocument_identity_current_version_guard"
BEFORE INSERT OR UPDATE ON "SopDocument"
FOR EACH ROW EXECUTE FUNCTION "protect_sop_document_identity_and_current_version"();

CREATE FUNCTION "validate_sop_version_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  document_scope "SopScope";
  document_lab_id TEXT;
  document_version INTEGER;
  expected_number INTEGER;
  command_type TEXT;
BEGIN
  SELECT scope, "labId", version
    INTO document_scope, document_lab_id, document_version
    FROM "SopDocument"
    WHERE id = NEW."sopId"
    FOR KEY SHARE;
  IF document_scope IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'SOP version document does not exist';
  END IF;
  SELECT COALESCE(MAX("versionNumber"), 0) + 1
    INTO expected_number
    FROM "SopVersion"
    WHERE "sopId" = NEW."sopId";
  IF NEW."versionNumber" <> expected_number THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SOP version numbers must advance exactly once';
  END IF;
  IF NEW."contentHash" <> "sop_content_hash"(NEW.title, NEW.category, NEW."contentMarkdown") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SOP content hash must be derived from the immutable title, category, and content';
  END IF;
  command_type := CASE WHEN NEW."versionNumber" = 1 THEN 'sop.create' ELSE 'sop.version.create' END;
  IF NOT "sop_command_context_valid"(
      command_type,
      'sop_document',
      NEW."sopId",
      NEW."createdById",
      CASE WHEN command_type = 'sop.create' THEN NULL ELSE document_version END,
      document_lab_id
    )
    OR NOT "sop_actor_can_manage_scope"(NEW."createdById", document_scope, document_lab_id)
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SOP version creation requires its authorized active command receipt';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SopVersion_insert_guard"
BEFORE INSERT ON "SopVersion"
FOR EACH ROW EXECUTE FUNCTION "validate_sop_version_insert"();

CREATE FUNCTION "validate_sop_version_approval_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  document_version INTEGER;
  document_lab_id TEXT;
BEGIN
  SELECT version, "labId" INTO document_version, document_lab_id
    FROM "SopDocument"
    WHERE id = NEW."sopId"
    FOR KEY SHARE;
  IF NOT "sop_command_context_valid"(
      'sop.version.decide',
      'sop_document',
      NEW."sopId",
      NEW."decidedById",
      document_version,
      document_lab_id
    )
    OR NOT "sop_actor_can_approve_version"(NEW."decidedById", NEW."sopId", NEW."sopVersionId")
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SOP approval requires an authorized independent approver and active command receipt';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SopVersionApproval_insert_guard"
BEFORE INSERT ON "SopVersionApproval"
FOR EACH ROW EXECUTE FUNCTION "validate_sop_version_approval_insert"();

CREATE FUNCTION "prevent_sop_ledger_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL ELSE OLD END;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = TG_TABLE_NAME || ' is an immutable SOP governance ledger';
END $$;

CREATE TRIGGER "SopVersion_append_only"
BEFORE UPDATE OR DELETE ON "SopVersion"
FOR EACH ROW EXECUTE FUNCTION "prevent_sop_ledger_mutation"();
CREATE TRIGGER "SopVersionApproval_append_only"
BEFORE UPDATE OR DELETE ON "SopVersionApproval"
FOR EACH ROW EXECUTE FUNCTION "prevent_sop_ledger_mutation"();
CREATE TRIGGER "SopAcknowledgement_append_only"
BEFORE UPDATE OR DELETE ON "SopAcknowledgement"
FOR EACH ROW EXECUTE FUNCTION "prevent_sop_ledger_mutation"();
CREATE TRIGGER "SopVersion_truncate_guard"
BEFORE TRUNCATE ON "SopVersion"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_sop_ledger_mutation"();
CREATE TRIGGER "SopVersionApproval_truncate_guard"
BEFORE TRUNCATE ON "SopVersionApproval"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_sop_ledger_mutation"();
CREATE TRIGGER "SopAcknowledgement_truncate_guard"
BEFORE TRUNCATE ON "SopAcknowledgement"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_sop_ledger_mutation"();

CREATE FUNCTION "validate_sop_assignment_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  approved_binding BOOLEAN;
  actor_id TEXT;
  command_type TEXT;
  document_scope "SopScope";
  document_lab_id TEXT;
  document_version INTEGER;
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'SOP assignments cannot be deleted or truncated';
  END IF;

  actor_id := current_setting('mcm.sop_actor_id', true);
  command_type := current_setting('mcm.sop_command_type', true);
  SELECT scope, "labId", version
    INTO document_scope, document_lab_id, document_version
    FROM "SopDocument"
    WHERE id = NEW."sopId"
    FOR KEY SHARE;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."revokedAt" IS NOT NULL
      OR NEW."revokedAt" IS NULL
      OR NEW."revokedById" IS NULL
      OR NEW."revocationReason" IS NULL
      OR LENGTH(BTRIM(NEW."revocationReason")) = 0
      OR NEW.version <> OLD.version + 1
      OR NEW.id IS DISTINCT FROM OLD.id
      OR NEW."sopId" IS DISTINCT FROM OLD."sopId"
      OR NEW."sopVersionId" IS DISTINCT FROM OLD."sopVersionId"
      OR NEW."labId" IS DISTINCT FROM OLD."labId"
      OR NEW."assignedById" IS DISTINCT FROM OLD."assignedById"
      OR NEW."assignedAt" IS DISTINCT FROM OLD."assignedAt"
      OR NEW."dueAt" IS DISTINCT FROM OLD."dueAt"
      OR NEW.reason IS DISTINCT FROM OLD.reason
    THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'An SOP assignment may only be revoked once; its identity and exact version binding are immutable';
    END IF;
    IF NEW."revokedById" IS DISTINCT FROM actor_id
      OR NOT "sop_actor_can_manage_scope"(actor_id, document_scope, document_lab_id)
      OR NOT (
        (
          command_type = 'sop.assign'
          AND "sop_command_context_valid"('sop.assign', 'sop_document', NEW."sopId", actor_id, document_version, document_lab_id)
        )
        OR (
          command_type = 'sop.assignment.revoke'
          AND "sop_command_context_valid"('sop.assignment.revoke', 'sop_assignment', NEW.id, actor_id, OLD.version, document_lab_id)
        )
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SOP assignment revocation requires its authorized active command receipt';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."assignedById" IS DISTINCT FROM actor_id
    OR NOT "sop_actor_can_manage_scope"(actor_id, document_scope, document_lab_id)
    OR NOT "sop_command_context_valid"('sop.assign', 'sop_document', NEW."sopId", actor_id, document_version, document_lab_id)
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SOP assignment creation requires its authorized active command receipt';
  END IF;

  EXECUTE format(
    'SELECT EXISTS (
       SELECT 1
       FROM %I."SopDocument" document
       JOIN %I."SopVersion" version
         ON version."sopId" = document.id
        AND version.id = $2
       JOIN %I."SopVersionApproval" approval
         ON approval."sopVersionId" = version.id
        AND approval."sopId" = document.id
      WHERE document.id = $1
        AND document."currentVersionId" = $2
        AND approval.decision = ''approved''
        AND (document.scope = ''facility'' OR document."labId" = $3)
     )',
    TG_TABLE_SCHEMA,
    TG_TABLE_SCHEMA,
    TG_TABLE_SCHEMA
  ) INTO approved_binding USING NEW."sopId", NEW."sopVersionId", NEW."labId";
  IF NOT approved_binding THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SOP assignments must bind the current approved exact version valid for the target lab';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SopAssignment_write_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "SopAssignment"
FOR EACH ROW EXECUTE FUNCTION "validate_sop_assignment_write"();
CREATE TRIGGER "SopAssignment_truncate_guard"
BEFORE TRUNCATE ON "SopAssignment"
FOR EACH STATEMENT EXECUTE FUNCTION "validate_sop_assignment_write"();

CREATE FUNCTION "validate_sop_acknowledgement_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  valid_binding BOOLEAN;
  assignment_version INTEGER;
BEGIN
  SELECT version INTO assignment_version
    FROM "SopAssignment"
    WHERE id = NEW."assignmentId"
    FOR KEY SHARE;
  IF NEW."userId" IS DISTINCT FROM current_setting('mcm.sop_actor_id', true)
    OR NOT "sop_command_context_valid"(
      'sop.acknowledge',
      'sop_assignment',
      NEW."assignmentId",
      NEW."userId",
      assignment_version,
      NEW."labId"
    )
    OR NOT "sop_actor_is_active_lab_member"(NEW."userId", NEW."labId")
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SOP acknowledgement requires the assigned user, active lab, and active command receipt';
  END IF;
  IF NEW.attestation <> 'I reviewed and understand this exact SOP version.' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SOP acknowledgement attestation must explicitly confirm the assigned exact version';
  END IF;
  EXECUTE format(
    'SELECT TRUE
       FROM %I."SopAssignment" assignment
       JOIN %I."SopVersion" version
         ON version.id = assignment."sopVersionId"
        AND version."sopId" = assignment."sopId"
       JOIN %I."User" acknowledgement_user ON acknowledgement_user.id = $5
       JOIN %I."LabMembership" membership
         ON membership."userId" = acknowledgement_user.id
        AND membership."labId" = assignment."labId"
      WHERE assignment.id = $1
        AND assignment."sopId" = $2
        AND assignment."sopVersionId" = $3
        AND assignment."labId" = $4
        AND assignment."revokedAt" IS NULL
        AND version."contentHash" = $6
        AND acknowledgement_user.active
        AND membership.active
      FOR KEY SHARE OF assignment, acknowledgement_user, membership',
    TG_TABLE_SCHEMA,
    TG_TABLE_SCHEMA,
    TG_TABLE_SCHEMA,
    TG_TABLE_SCHEMA
  ) INTO valid_binding USING
    NEW."assignmentId",
    NEW."sopId",
    NEW."sopVersionId",
    NEW."labId",
    NEW."userId",
    NEW."contentHash";
  IF NOT COALESCE(valid_binding, FALSE) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'SOP acknowledgement must match an active assignment lab, exact version hash, active user, and active lab membership';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SopAcknowledgement_binding_guard"
BEFORE INSERT ON "SopAcknowledgement"
FOR EACH ROW EXECUTE FUNCTION "validate_sop_acknowledgement_insert"();

CREATE FUNCTION "sop_create_document_version"(
  document_id TEXT,
  version_id TEXT,
  sop_scope "SopScope",
  lab_id TEXT,
  sop_code TEXT,
  sop_title TEXT,
  sop_category TEXT,
  content_markdown TEXT,
  content_hash TEXT,
  change_summary TEXT,
  actor_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $$
BEGIN
  INSERT INTO "SopDocument" (
    id, scope, "labId", code, title, category, "createdById", "updatedAt"
  ) VALUES (
    document_id, sop_scope, lab_id, sop_code, sop_title, sop_category, actor_id, CURRENT_TIMESTAMP
  );
  INSERT INTO "SopVersion" (
    id, "sopId", "versionNumber", title, category, "contentMarkdown", "contentHash",
    "changeSummary", "createdById"
  ) VALUES (
    version_id, document_id, 1, sop_title, sop_category, content_markdown, content_hash,
    change_summary, actor_id
  );
  RETURN TRUE;
END $$;

CREATE FUNCTION "sop_create_version"(
  version_id TEXT,
  sop_id TEXT,
  version_number INTEGER,
  sop_title TEXT,
  sop_category TEXT,
  content_markdown TEXT,
  content_hash TEXT,
  change_summary TEXT,
  actor_id TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $$
DECLARE
  resulting_version INTEGER;
BEGIN
  INSERT INTO "SopVersion" (
    id, "sopId", "versionNumber", title, category, "contentMarkdown", "contentHash",
    "changeSummary", "createdById"
  ) VALUES (
    version_id, sop_id, version_number, sop_title, sop_category, content_markdown, content_hash,
    change_summary, actor_id
  );
  UPDATE "SopDocument"
    SET version = version + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = sop_id
    RETURNING version INTO resulting_version;
  RETURN resulting_version;
END $$;

CREATE FUNCTION "sop_decide_version"(
  approval_id TEXT,
  sop_id TEXT,
  version_id TEXT,
  approval_decision "SopApprovalDecision",
  decision_note TEXT,
  actor_id TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $$
DECLARE
  resulting_version INTEGER;
  version_title TEXT;
  version_category TEXT;
BEGIN
  SELECT title, category INTO version_title, version_category
    FROM "SopVersion"
    WHERE id = version_id AND "sopId" = sop_id
    FOR KEY SHARE;
  INSERT INTO "SopVersionApproval" (
    id, "sopId", "sopVersionId", decision, "decidedById", note
  ) VALUES (
    approval_id, sop_id, version_id, approval_decision, actor_id, decision_note
  );
  UPDATE "SopDocument"
    SET
      "currentVersionId" = CASE WHEN approval_decision = 'approved' THEN version_id ELSE "currentVersionId" END,
      title = CASE WHEN approval_decision = 'approved' THEN version_title ELSE title END,
      category = CASE WHEN approval_decision = 'approved' THEN version_category ELSE category END,
      active = CASE WHEN approval_decision = 'approved' THEN TRUE ELSE active END,
      version = version + 1,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = sop_id
    RETURNING version INTO resulting_version;
  RETURN resulting_version;
END $$;

CREATE FUNCTION "sop_assign_version"(
  assignment_id TEXT,
  sop_id TEXT,
  version_id TEXT,
  lab_id TEXT,
  due_at TIMESTAMP(3),
  assignment_reason TEXT,
  actor_id TEXT,
  assigned_at TIMESTAMP(3)
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $$
DECLARE
  resulting_version INTEGER;
BEGIN
  UPDATE "SopAssignment"
    SET
      "revokedAt" = assigned_at,
      "revokedById" = actor_id,
      "revocationReason" = 'Superseded by a newly assigned immutable version.',
      version = version + 1
    WHERE "sopId" = sop_id AND "labId" = lab_id AND "revokedAt" IS NULL;
  INSERT INTO "SopAssignment" (
    id, "sopId", "sopVersionId", "labId", "assignedById", "assignedAt", "dueAt", reason
  ) VALUES (
    assignment_id, sop_id, version_id, lab_id, actor_id, assigned_at, due_at, assignment_reason
  );
  UPDATE "SopDocument"
    SET version = version + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE id = sop_id
    RETURNING version INTO resulting_version;
  RETURN resulting_version;
END $$;

CREATE FUNCTION "sop_revoke_assignment"(
  assignment_id TEXT,
  revocation_reason TEXT,
  actor_id TEXT,
  revoked_at TIMESTAMP(3)
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $$
DECLARE
  resulting_version INTEGER;
BEGIN
  UPDATE "SopAssignment"
    SET
      "revokedAt" = revoked_at,
      "revokedById" = actor_id,
      "revocationReason" = revocation_reason,
      version = version + 1
    WHERE id = assignment_id
    RETURNING version INTO resulting_version;
  RETURN resulting_version;
END $$;

CREATE FUNCTION "sop_acknowledge_assignment"(
  acknowledgement_id TEXT,
  assignment_id TEXT,
  sop_id TEXT,
  version_id TEXT,
  lab_id TEXT,
  actor_id TEXT,
  content_hash TEXT,
  acknowledged_at TIMESTAMP(3),
  attestation_text TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path FROM CURRENT
AS $$
BEGIN
  INSERT INTO "SopAcknowledgement" (
    id, "assignmentId", "sopId", "sopVersionId", "labId", "userId", "contentHash",
    "acknowledgedAt", attestation
  ) VALUES (
    acknowledgement_id, assignment_id, sop_id, version_id, lab_id, actor_id, content_hash,
    acknowledged_at, attestation_text
  );
  RETURN TRUE;
END $$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  "SopDocument", "SopVersion", "SopVersionApproval", "SopAssignment", "SopAcknowledgement"
FROM PUBLIC;

REVOKE ALL ON FUNCTION
  "sop_create_document_version"(TEXT, TEXT, "SopScope", TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT),
  "sop_create_version"(TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT),
  "sop_decide_version"(TEXT, TEXT, TEXT, "SopApprovalDecision", TEXT, TEXT),
  "sop_assign_version"(TEXT, TEXT, TEXT, TEXT, TIMESTAMP(3), TEXT, TEXT, TIMESTAMP(3)),
  "sop_revoke_assignment"(TEXT, TEXT, TEXT, TIMESTAMP(3)),
  "sop_acknowledge_assignment"(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMP(3), TEXT)
FROM PUBLIC;

COMMIT;
