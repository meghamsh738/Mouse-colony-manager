BEGIN;

CREATE TYPE "StrainDirectoryListingStatus" AS ENUM ('draft', 'shared', 'paused');
CREATE TYPE "StrainDirectoryRequestType" AS ENUM ('contact', 'material');
CREATE TYPE "StrainDirectoryRequestStatus" AS ENUM ('submitted', 'accepted', 'declined', 'cancelled');
CREATE TYPE "StrainDirectoryRequestEventType" AS ENUM ('submitted', 'accepted', 'declined', 'cancelled');

CREATE TABLE "StrainDirectoryListing" (
  id TEXT NOT NULL,
  "strainId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "contactUserId" TEXT NOT NULL,
  status "StrainDirectoryListingStatus" NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  "sharedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StrainDirectoryListing_pkey" PRIMARY KEY (id),
  CONSTRAINT "StrainDirectoryListing_strainId_labId_key" UNIQUE ("strainId", "labId"),
  CONSTRAINT "StrainDirectoryListing_version_check" CHECK (version >= 1),
  CONSTRAINT "StrainDirectoryListing_shared_at_check" CHECK (
    (status = 'shared' AND "sharedAt" IS NOT NULL)
    OR (status IN ('draft', 'paused') AND "sharedAt" IS NULL)
  )
);

CREATE TABLE "StrainDirectoryRequest" (
  id TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "requesterUserId" TEXT NOT NULL,
  "requesterLabId" TEXT NOT NULL,
  "requestType" "StrainDirectoryRequestType" NOT NULL,
  purpose TEXT,
  status "StrainDirectoryRequestStatus" NOT NULL DEFAULT 'submitted',
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionReason" TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StrainDirectoryRequest_pkey" PRIMARY KEY (id),
  CONSTRAINT "StrainDirectoryRequest_version_check" CHECK (version >= 1),
  CONSTRAINT "StrainDirectoryRequest_purpose_check" CHECK (
    purpose IS NULL OR char_length(btrim(purpose)) BETWEEN 3 AND 500
  ),
  CONSTRAINT "StrainDirectoryRequest_decision_reason_check" CHECK (
    "decisionReason" IS NULL OR char_length(btrim("decisionReason")) BETWEEN 3 AND 500
  ),
  CONSTRAINT "StrainDirectoryRequest_decision_check" CHECK (
    (
      status = 'submitted'
      AND "decidedById" IS NULL
      AND "decidedAt" IS NULL
      AND "decisionReason" IS NULL
    )
    OR (
      status = 'accepted'
      AND "decidedById" IS NOT NULL
      AND "decidedAt" IS NOT NULL
      AND "decidedAt" >= "createdAt"
    )
    OR (
      status IN ('declined', 'cancelled')
      AND "decidedById" IS NOT NULL
      AND "decidedAt" IS NOT NULL
      AND "decidedAt" >= "createdAt"
      AND char_length(btrim("decisionReason")) BETWEEN 3 AND 500
    )
  )
);

CREATE TABLE "StrainDirectoryRequestEvent" (
  id TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "eventType" "StrainDirectoryRequestEventType" NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorRole" "UserRole" NOT NULL,
  "actorLabId" TEXT,
  reason TEXT,
  metadata JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StrainDirectoryRequestEvent_pkey" PRIMARY KEY (id),
  CONSTRAINT "StrainDirectoryRequestEvent_requestId_eventType_key" UNIQUE ("requestId", "eventType"),
  CONSTRAINT "StrainDirectoryRequestEvent_reason_check" CHECK (
    reason IS NULL OR char_length(reason) <= 500
  )
);

CREATE INDEX "StrainDirectoryListing_status_labId_idx"
  ON "StrainDirectoryListing" (status, "labId");
CREATE INDEX "StrainDirectoryListing_contactUserId_status_idx"
  ON "StrainDirectoryListing" ("contactUserId", status);
CREATE INDEX "StrainDirectoryRequest_listingId_status_createdAt_idx"
  ON "StrainDirectoryRequest" ("listingId", status, "createdAt");
CREATE INDEX "StrainDirectoryRequest_requesterUserId_status_createdAt_idx"
  ON "StrainDirectoryRequest" ("requesterUserId", status, "createdAt");
CREATE INDEX "StrainDirectoryRequest_requesterLabId_status_createdAt_idx"
  ON "StrainDirectoryRequest" ("requesterLabId", status, "createdAt");
CREATE INDEX "StrainDirectoryRequestEvent_requestId_createdAt_idx"
  ON "StrainDirectoryRequestEvent" ("requestId", "createdAt");
CREATE INDEX "StrainDirectoryRequestEvent_actorId_createdAt_idx"
  ON "StrainDirectoryRequestEvent" ("actorId", "createdAt");
CREATE INDEX "StrainDirectoryRequestEvent_actorLabId_createdAt_idx"
  ON "StrainDirectoryRequestEvent" ("actorLabId", "createdAt");

ALTER TABLE "StrainDirectoryListing"
  ADD CONSTRAINT "StrainDirectoryListing_strainId_fkey"
    FOREIGN KEY ("strainId") REFERENCES "Strain"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StrainDirectoryListing_labId_fkey"
    FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StrainDirectoryListing_labId_contactUserId_fkey"
    FOREIGN KEY ("labId", "contactUserId") REFERENCES "LabMembership"("labId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "StrainDirectoryRequest"
  ADD CONSTRAINT "StrainDirectoryRequest_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "StrainDirectoryListing"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StrainDirectoryRequest_requesterUserId_fkey"
    FOREIGN KEY ("requesterUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StrainDirectoryRequest_requesterLabId_fkey"
    FOREIGN KEY ("requesterLabId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StrainDirectoryRequest_decidedById_fkey"
    FOREIGN KEY ("decidedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StrainDirectoryRequestEvent"
  ADD CONSTRAINT "StrainDirectoryRequestEvent_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "StrainDirectoryRequest"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StrainDirectoryRequestEvent_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StrainDirectoryRequestEvent_actorLabId_fkey"
    FOREIGN KEY ("actorLabId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_strain_directory_listing_contact"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "LabMembership" membership
    JOIN "Lab" lab ON lab.id = membership."labId"
    JOIN "User" contact ON contact.id = membership."userId"
    WHERE membership."labId" = NEW."labId"
      AND membership."userId" = NEW."contactUserId"
      AND membership.active
      AND membership.role IN ('owner', 'manager')
      AND lab.active
      AND contact.active
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Directory contact must be an active owner or manager of the active holding lab';
  END IF;

  IF NEW.status = 'shared' AND NOT EXISTS (
    SELECT 1
    FROM "Animal" animal
    WHERE animal."strainId" = NEW."strainId"
      AND animal."owningLabId" = NEW."labId"
      AND animal.status NOT IN ('euthanized', 'dead', 'transferred_out', 'archived')
    UNION ALL
    SELECT 1
    FROM "CryostorageRecord" cryostorage
    WHERE cryostorage."strainId" = NEW."strainId"
      AND cryostorage."labId" = NEW."labId"
      AND cryostorage.status IN ('stored', 'reserved')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A shared directory listing requires an active colony or cryopreserved material';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "StrainDirectoryListing_contact_guard"
BEFORE INSERT OR UPDATE OF "labId", "contactUserId", status ON "StrainDirectoryListing"
FOR EACH ROW EXECUTE FUNCTION "validate_strain_directory_listing_contact"();

CREATE FUNCTION "validate_strain_directory_request_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  holding_lab_id TEXT;
  listing_status "StrainDirectoryListingStatus";
BEGIN
  SELECT "labId", status
  INTO holding_lab_id, listing_status
  FROM "StrainDirectoryListing"
  WHERE id = NEW."listingId";

  IF listing_status IS DISTINCT FROM 'shared' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Directory requests require a shared listing';
  END IF;

  IF holding_lab_id = NEW."requesterLabId" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Directory requests must be cross-lab';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "LabMembership" membership
    JOIN "Lab" lab ON lab.id = membership."labId"
    JOIN "User" requester ON requester.id = membership."userId"
    WHERE membership."labId" = NEW."requesterLabId"
      AND membership."userId" = NEW."requesterUserId"
      AND membership.active
      AND lab.active
      AND requester.active
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Directory requester must be an active member of an active requester lab';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "StrainDirectoryRequest_insert_guard"
BEFORE INSERT ON "StrainDirectoryRequest"
FOR EACH ROW EXECUTE FUNCTION "validate_strain_directory_request_insert"();

CREATE FUNCTION "protect_strain_directory_request_event"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL ELSE OLD END;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Strain directory request history is immutable';
END
$$;

CREATE TRIGGER "StrainDirectoryRequestEvent_append_only"
BEFORE UPDATE OR DELETE ON "StrainDirectoryRequestEvent"
FOR EACH ROW EXECUTE FUNCTION "protect_strain_directory_request_event"();
CREATE TRIGGER "StrainDirectoryRequestEvent_truncate_guard"
BEFORE TRUNCATE ON "StrainDirectoryRequestEvent"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_strain_directory_request_event"();

CREATE FUNCTION "strain_directory_command_context_valid"(
  command_type TEXT,
  aggregate_type TEXT,
  aggregate_id TEXT,
  expected_version INTEGER,
  lab_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "CommandReceipt" receipt
    JOIN "User" actor ON actor.id = receipt."actorId"
    WHERE receipt.id = current_setting('mcm.audit_receipt_id', true)
      AND receipt."actorId" = current_setting('mcm.audit_actor_id', true)
      AND receipt."commandType" = command_type
      AND receipt."aggregateType" = aggregate_type
      AND receipt."aggregateId" = aggregate_id
      AND receipt."expectedVersion" IS NOT DISTINCT FROM expected_version
      AND receipt.status = 'processing'
      AND receipt."completedAt" IS NULL
      AND receipt."actorAuthzVersion" = actor."authzVersion"
      AND receipt."databasePrincipal" = SESSION_USER
      AND actor.active
      AND (
        receipt."labId" = lab_id
        OR (
          receipt."labId" IS NULL
          AND actor.role IN ('facility_admin', 'admin')
        )
      )
  )
$$;

CREATE FUNCTION "validate_strain_directory_listing_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Strain directory listings cannot be deleted or truncated';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT "strain_directory_command_context_valid"(
      'strain_directory.listing.create', 'strain_directory_listing', NEW.id, NULL, NEW."labId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Directory listing creation requires an authenticated command receipt';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW."strainId" IS DISTINCT FROM OLD."strainId"
    OR NEW."labId" IS DISTINCT FROM OLD."labId"
    OR NEW.version <> OLD.version + 1
    OR NOT "strain_directory_command_context_valid"(
      'strain_directory.listing.update', 'strain_directory_listing', OLD.id, OLD.version, OLD."labId"
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Directory listing updates require an authenticated versioned command receipt';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "StrainDirectoryListing_command_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "StrainDirectoryListing"
FOR EACH ROW EXECUTE FUNCTION "validate_strain_directory_listing_write"();
CREATE TRIGGER "StrainDirectoryListing_truncate_guard"
BEFORE TRUNCATE ON "StrainDirectoryListing"
FOR EACH STATEMENT EXECUTE FUNCTION "validate_strain_directory_listing_write"();

CREATE FUNCTION "validate_strain_directory_request_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Strain directory requests cannot be deleted or truncated';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT "strain_directory_command_context_valid"(
      'strain_directory.request.submit', 'strain_directory_request', NEW.id, NULL, NEW."requesterLabId"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Directory request submission requires an authenticated command receipt';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW."listingId" IS DISTINCT FROM OLD."listingId"
    OR NEW."requesterUserId" IS DISTINCT FROM OLD."requesterUserId"
    OR NEW."requesterLabId" IS DISTINCT FROM OLD."requesterLabId"
    OR NEW."requestType" IS DISTINCT FROM OLD."requestType"
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR OLD.status <> 'submitted'
    OR NEW.status NOT IN ('accepted', 'declined')
    OR NEW."decidedById" <> current_setting('mcm.audit_actor_id', true)
    OR NEW.version <> OLD.version + 1
    OR NOT "strain_directory_command_context_valid"(
      'strain_directory.request.decide', 'strain_directory_request', OLD.id, OLD.version,
      (SELECT "labId" FROM "StrainDirectoryListing" WHERE id = OLD."listingId")
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Directory request decisions require an authenticated versioned command receipt';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "StrainDirectoryRequest_command_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "StrainDirectoryRequest"
FOR EACH ROW EXECUTE FUNCTION "validate_strain_directory_request_write"();
CREATE TRIGGER "StrainDirectoryRequest_truncate_guard"
BEFORE TRUNCATE ON "StrainDirectoryRequest"
FOR EACH STATEMENT EXECUTE FUNCTION "validate_strain_directory_request_write"();

CREATE FUNCTION "validate_strain_directory_request_event_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  current_request "StrainDirectoryRequest"%ROWTYPE;
  expected_command TEXT;
  expected_version INTEGER;
  command_lab_id TEXT;
BEGIN
  SELECT request.* INTO current_request FROM "StrainDirectoryRequest" request WHERE request.id = NEW."requestId";
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Directory request event requires an existing request';
  END IF;
  expected_command := CASE NEW."eventType"
    WHEN 'submitted' THEN 'strain_directory.request.submit'
    WHEN 'accepted' THEN 'strain_directory.request.decide'
    WHEN 'declined' THEN 'strain_directory.request.decide'
    ELSE NULL
  END;
  expected_version := CASE WHEN NEW."eventType" = 'submitted' THEN NULL ELSE current_request.version - 1 END;
  command_lab_id := CASE
    WHEN NEW."eventType" = 'submitted' THEN current_request."requesterLabId"
    ELSE (SELECT "labId" FROM "StrainDirectoryListing" WHERE id = current_request."listingId")
  END;
  IF expected_command IS NULL
    OR current_request.status::text <> NEW."eventType"::text
    OR NEW."actorId" <> current_setting('mcm.audit_actor_id', true)
    OR NEW."actorLabId" IS DISTINCT FROM command_lab_id
    OR NOT "strain_directory_command_context_valid"(
      expected_command, 'strain_directory_request', current_request.id, expected_version, command_lab_id
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Directory request events require the matching authenticated command transition';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "StrainDirectoryRequestEvent_insert_guard"
BEFORE INSERT ON "StrainDirectoryRequestEvent"
FOR EACH ROW EXECUTE FUNCTION "validate_strain_directory_request_event_insert"();

COMMIT;
