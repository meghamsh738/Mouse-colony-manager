BEGIN;

CREATE TYPE "LabTransferSubjectType" AS ENUM ('cage', 'animals');
CREATE TYPE "LabTransferRequestStatus" AS ENUM (
  'requested',
  'destination_accepted',
  'destination_rejected',
  'cancelled',
  'finalized'
);
CREATE TYPE "LabTransferEventType" AS ENUM (
  'requested',
  'packet_revised',
  'destination_accepted',
  'destination_rejected',
  'cancelled',
  'override_applied',
  'finalized'
);

LOCK TABLE "Cage", "Animal", "AnimalMovement", "CageLabTransfer", "AnimalLabTransfer", "QuarantineCase"
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "CageLabTransfer") OR EXISTS (SELECT 1 FROM "AnimalLabTransfer") THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Legacy lab-transfer history must be reconciled to approval requests before migration 0015 can continue.';
  END IF;
END $$;

ALTER TABLE "QuarantineCase" DROP CONSTRAINT "QuarantineCase_cageId_labId_fkey";
ALTER TABLE "QuarantineCase"
  ADD CONSTRAINT "QuarantineCase_cageId_fkey"
  FOREIGN KEY ("cageId") REFERENCES "Cage"(id) ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "AnimalMovement" ADD COLUMN "requestId" TEXT;

CREATE TABLE "LabTransferRequest" (
  id TEXT PRIMARY KEY,
  "subjectType" "LabTransferSubjectType" NOT NULL,
  "sourceLabId" TEXT NOT NULL,
  "destinationLabId" TEXT NOT NULL,
  "sourceCageId" TEXT,
  "destinationCageId" TEXT,
  reason TEXT NOT NULL,
  "sourcePrivateNote" TEXT,
  "requestedEffectiveAt" TIMESTAMP(3) NOT NULL,
  status "LabTransferRequestStatus" NOT NULL DEFAULT 'requested',
  "packetVersion" INTEGER NOT NULL DEFAULT 1,
  "acceptedPacketVersion" INTEGER,
  "acceptedPacketHash" TEXT,
  "requestedById" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "destinationDecisionById" TEXT,
  "destinationDecisionAt" TIMESTAMP(3),
  "destinationDecisionNote" TEXT,
  "finalizedById" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "overrideApprovedById" TEXT,
  "overrideApprovedAt" TIMESTAMP(3),
  "overrideReason" TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LabTransferRequest_source_destination_check"
    CHECK ("sourceLabId" <> "destinationLabId"),
  CONSTRAINT "LabTransferRequest_version_check"
    CHECK (version >= 1 AND "packetVersion" >= 1),
  CONSTRAINT "LabTransferRequest_subject_check"
    CHECK (
      ("subjectType" = 'cage' AND "sourceCageId" IS NOT NULL AND "destinationCageId" IS NULL)
      OR
      ("subjectType" = 'animals' AND "sourceCageId" IS NULL)
    ),
  CONSTRAINT "LabTransferRequest_acceptance_check"
    CHECK (
      (
        status IN ('destination_accepted', 'finalized')
        AND "acceptedPacketVersion" = "packetVersion"
        AND "acceptedPacketHash" IS NOT NULL
        AND "destinationDecisionById" IS NOT NULL
        AND "destinationDecisionAt" IS NOT NULL
      )
      OR
      (
        status NOT IN ('destination_accepted', 'finalized')
        AND "acceptedPacketVersion" IS NULL
        AND "acceptedPacketHash" IS NULL
      )
    ),
  CONSTRAINT "LabTransferRequest_rejection_check"
    CHECK (
      status <> 'destination_rejected'
      OR ("destinationDecisionById" IS NOT NULL AND "destinationDecisionAt" IS NOT NULL)
    ),
  CONSTRAINT "LabTransferRequest_animal_destination_check"
    CHECK (
      "subjectType" <> 'animals'
      OR status NOT IN ('destination_accepted', 'finalized')
      OR "destinationCageId" IS NOT NULL
    ),
  CONSTRAINT "LabTransferRequest_finalization_check"
    CHECK (
      status <> 'finalized'
      OR ("finalizedById" IS NOT NULL AND "finalizedAt" IS NOT NULL)
    ),
  CONSTRAINT "LabTransferRequest_override_check"
    CHECK (
      ("overrideApprovedById" IS NULL AND "overrideApprovedAt" IS NULL AND "overrideReason" IS NULL)
      OR
      ("overrideApprovedById" IS NOT NULL AND "overrideApprovedAt" IS NOT NULL AND LENGTH(BTRIM("overrideReason")) >= 10)
    )
);

CREATE TABLE "LabTransferItem" (
  id TEXT PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  "animalId" TEXT NOT NULL,
  "sourceCageId" TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "LabTransferPacket" (
  id TEXT PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  version INTEGER NOT NULL,
  "destinationPayload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LabTransferPacket_version_check" CHECK (version >= 1)
);

CREATE TABLE "LabTransferEvent" (
  id TEXT PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  "eventType" "LabTransferEventType" NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorRole" "UserRole" NOT NULL,
  "actorLabId" TEXT,
  "packetVersion" INTEGER NOT NULL,
  reason TEXT,
  metadata JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LabTransferEvent_packet_version_check" CHECK ("packetVersion" >= 1)
);

ALTER TABLE "CageLabTransfer" ADD COLUMN "requestId" TEXT NOT NULL;
ALTER TABLE "AnimalLabTransfer" ADD COLUMN "requestId" TEXT NOT NULL;

CREATE UNIQUE INDEX "LabTransferRequest_open_source_cage_key"
  ON "LabTransferRequest" ("sourceCageId")
  WHERE "sourceCageId" IS NOT NULL
    AND status IN ('requested', 'destination_accepted', 'destination_rejected');
CREATE INDEX "LabTransferRequest_sourceLabId_status_idx" ON "LabTransferRequest" ("sourceLabId", status);
CREATE INDEX "LabTransferRequest_destinationLabId_status_idx" ON "LabTransferRequest" ("destinationLabId", status);
CREATE INDEX "LabTransferRequest_status_requestedAt_idx" ON "LabTransferRequest" (status, "requestedAt");
CREATE INDEX "LabTransferRequest_sourceCageId_idx" ON "LabTransferRequest" ("sourceCageId");
CREATE INDEX "LabTransferRequest_destinationCageId_idx" ON "LabTransferRequest" ("destinationCageId");

CREATE UNIQUE INDEX "LabTransferItem_requestId_animalId_key" ON "LabTransferItem" ("requestId", "animalId");
CREATE UNIQUE INDEX "LabTransferItem_active_animal_key" ON "LabTransferItem" ("animalId") WHERE active;
CREATE INDEX "LabTransferItem_animalId_idx" ON "LabTransferItem" ("animalId");
CREATE INDEX "LabTransferItem_sourceCageId_idx" ON "LabTransferItem" ("sourceCageId");

CREATE UNIQUE INDEX "LabTransferPacket_requestId_version_key" ON "LabTransferPacket" ("requestId", version);
CREATE INDEX "LabTransferPacket_createdById_createdAt_idx" ON "LabTransferPacket" ("createdById", "createdAt");

CREATE INDEX "LabTransferEvent_requestId_createdAt_idx" ON "LabTransferEvent" ("requestId", "createdAt");
CREATE INDEX "LabTransferEvent_actorId_createdAt_idx" ON "LabTransferEvent" ("actorId", "createdAt");
CREATE INDEX "LabTransferEvent_actorLabId_createdAt_idx" ON "LabTransferEvent" ("actorLabId", "createdAt");

CREATE UNIQUE INDEX "CageLabTransfer_requestId_key" ON "CageLabTransfer" ("requestId");
CREATE INDEX "AnimalLabTransfer_requestId_idx" ON "AnimalLabTransfer" ("requestId");
CREATE UNIQUE INDEX "AnimalLabTransfer_requestId_animalId_key" ON "AnimalLabTransfer" ("requestId", "animalId");
CREATE INDEX "AnimalMovement_requestId_idx" ON "AnimalMovement" ("requestId");

ALTER TABLE "LabTransferRequest"
  ADD CONSTRAINT "LabTransferRequest_sourceLabId_fkey"
  FOREIGN KEY ("sourceLabId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferRequest_destinationLabId_fkey"
  FOREIGN KEY ("destinationLabId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferRequest_sourceCageId_fkey"
  FOREIGN KEY ("sourceCageId") REFERENCES "Cage"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferRequest_destinationCageId_fkey"
  FOREIGN KEY ("destinationCageId") REFERENCES "Cage"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferRequest_destinationDecisionById_fkey"
  FOREIGN KEY ("destinationDecisionById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferRequest_finalizedById_fkey"
  FOREIGN KEY ("finalizedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferRequest_overrideApprovedById_fkey"
  FOREIGN KEY ("overrideApprovedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LabTransferItem"
  ADD CONSTRAINT "LabTransferItem_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "LabTransferRequest"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferItem_animalId_fkey"
  FOREIGN KEY ("animalId") REFERENCES "Animal"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferItem_sourceCageId_fkey"
  FOREIGN KEY ("sourceCageId") REFERENCES "Cage"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LabTransferPacket"
  ADD CONSTRAINT "LabTransferPacket_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "LabTransferRequest"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferPacket_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LabTransferEvent"
  ADD CONSTRAINT "LabTransferEvent_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "LabTransferRequest"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferEvent_actorLabId_fkey"
  FOREIGN KEY ("actorLabId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CageLabTransfer"
  ADD CONSTRAINT "CageLabTransfer_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "LabTransferRequest"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnimalLabTransfer"
  ADD CONSTRAINT "AnimalLabTransfer_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "LabTransferRequest"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnimalMovement"
  ADD CONSTRAINT "AnimalMovement_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "LabTransferRequest"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_lab_transfer_ledger_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL ELSE OLD END;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = TG_TABLE_NAME || ' is append-only';
END $$;

CREATE TRIGGER "LabTransferPacket_append_only"
BEFORE UPDATE OR DELETE ON "LabTransferPacket"
FOR EACH ROW EXECUTE FUNCTION "prevent_lab_transfer_ledger_mutation"();

CREATE TRIGGER "LabTransferEvent_append_only"
BEFORE UPDATE OR DELETE ON "LabTransferEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_lab_transfer_ledger_mutation"();
CREATE TRIGGER "CageLabTransfer_append_only"
BEFORE UPDATE OR DELETE ON "CageLabTransfer"
FOR EACH ROW EXECUTE FUNCTION "prevent_lab_transfer_ledger_mutation"();
CREATE TRIGGER "AnimalLabTransfer_append_only"
BEFORE UPDATE OR DELETE ON "AnimalLabTransfer"
FOR EACH ROW EXECUTE FUNCTION "prevent_lab_transfer_ledger_mutation"();

CREATE TRIGGER "LabTransferRequest_truncate_guard"
BEFORE TRUNCATE ON "LabTransferRequest"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_lab_transfer_ledger_mutation"();
CREATE TRIGGER "LabTransferItem_truncate_guard"
BEFORE TRUNCATE ON "LabTransferItem"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_lab_transfer_ledger_mutation"();
CREATE TRIGGER "LabTransferPacket_truncate_guard"
BEFORE TRUNCATE ON "LabTransferPacket"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_lab_transfer_ledger_mutation"();
CREATE TRIGGER "LabTransferEvent_truncate_guard"
BEFORE TRUNCATE ON "LabTransferEvent"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_lab_transfer_ledger_mutation"();
CREATE TRIGGER "CageLabTransfer_truncate_guard"
BEFORE TRUNCATE ON "CageLabTransfer"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_lab_transfer_ledger_mutation"();
CREATE TRIGGER "AnimalLabTransfer_truncate_guard"
BEFORE TRUNCATE ON "AnimalLabTransfer"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_lab_transfer_ledger_mutation"();
CREATE TRIGGER "AnimalMovement_truncate_guard"
BEFORE TRUNCATE ON "AnimalMovement"
FOR EACH STATEMENT EXECUTE FUNCTION "prevent_lab_transfer_ledger_mutation"();

CREATE OR REPLACE FUNCTION "prevent_cross_lab_movement_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN OLD;
  END IF;
  IF OLD."requestId" IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Cross-lab AnimalMovement is append-only';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER "AnimalMovement_cross_lab_append_only"
BEFORE UPDATE OR DELETE ON "AnimalMovement"
FOR EACH ROW EXECUTE FUNCTION "prevent_cross_lab_movement_mutation"();

CREATE OR REPLACE FUNCTION "lab_transfer_command_context_valid"(
  request_id TEXT,
  command_type TEXT,
  actor_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(current_setting('mcm.lab_transfer_request_id', true), '') = request_id
    AND COALESCE(current_setting('mcm.lab_transfer_command_type', true), '') = command_type
    AND COALESCE(current_setting('mcm.lab_transfer_actor_id', true), '') = actor_id
    AND EXISTS (
      SELECT 1
      FROM "CommandReceipt" receipt
      JOIN "User" actor ON actor.id = receipt."actorId"
      WHERE receipt.id = current_setting('mcm.lab_transfer_receipt_id', true)
        AND receipt."actorId" = actor_id
        AND receipt."commandType" = command_type
        AND receipt."aggregateType" = 'lab_transfer_request'
        AND receipt."aggregateId" = request_id
        AND receipt.status = 'processing'
        AND actor.active
    );
$$;

CREATE OR REPLACE FUNCTION "lab_transfer_actor_is_lab_principal"(actor_id TEXT, lab_id TEXT)
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
      AND membership.role IN ('owner', 'manager')
      AND lab.active
  );
$$;

CREATE OR REPLACE FUNCTION "lab_transfer_actor_is_finalizer"(actor_id TEXT, facility_only BOOLEAN DEFAULT FALSE)
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
        (facility_only AND actor.role IN ('facility_admin', 'admin'))
        OR
        (NOT facility_only AND actor.role IN ('facility_admin', 'admin', 'cmu_staff', 'colony_manager'))
      )
  );
$$;

CREATE OR REPLACE FUNCTION "assert_open_quarantine_case_cage_lab"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('admitted', 'under_observation', 'exception_open', 'release_requested')
    AND NOT EXISTS (
      SELECT 1 FROM "Cage" cage WHERE cage.id = NEW."cageId" AND cage."labId" = NEW."labId"
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Open quarantine cases must match the cage current lab';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "QuarantineCase_open_cage_lab_guard"
BEFORE INSERT OR UPDATE OF "cageId", "labId", status ON "QuarantineCase"
FOR EACH ROW EXECUTE FUNCTION "assert_open_quarantine_case_cage_lab"();

CREATE OR REPLACE FUNCTION "assert_lab_transfer_request_command"()
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
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LabTransferRequest is append-only';
  END IF;

  actor_id := current_setting('mcm.lab_transfer_actor_id', true);
  command_type := current_setting('mcm.lab_transfer_command_type', true);

  IF TG_OP = 'INSERT' THEN
    IF NOT "lab_transfer_command_context_valid"(NEW.id, 'lab_transfer.request', NEW."requestedById")
      OR NOT "lab_transfer_actor_is_lab_principal"(NEW."requestedById", NEW."sourceLabId")
      OR NEW.status <> 'requested'
      OR NEW.version <> 1
      OR NEW."packetVersion" <> 1
      OR NEW."acceptedPacketVersion" IS NOT NULL
      OR NEW."acceptedPacketHash" IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Lab transfer requests require an authorized source-lab command receipt';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT "lab_transfer_command_context_valid"(NEW.id, command_type, actor_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Lab transfer update is not bound to its command receipt';
  END IF;
  IF OLD.status IN ('cancelled', 'finalized') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Terminal lab transfer requests are immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW."subjectType" IS DISTINCT FROM OLD."subjectType"
    OR NEW."sourceLabId" IS DISTINCT FROM OLD."sourceLabId"
    OR NEW."sourceCageId" IS DISTINCT FROM OLD."sourceCageId"
    OR NEW."requestedById" IS DISTINCT FROM OLD."requestedById"
    OR NEW."requestedAt" IS DISTINCT FROM OLD."requestedAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Lab transfer request identity fields are immutable';
  END IF;

  IF command_type = 'lab_transfer.revise' THEN
    IF NOT "lab_transfer_actor_is_lab_principal"(actor_id, OLD."sourceLabId")
      OR NEW.status <> 'requested'
      OR NEW.version <> OLD.version + 1
      OR NEW."packetVersion" <> OLD."packetVersion" + 1
      OR NEW."acceptedPacketVersion" IS NOT NULL
      OR NEW."acceptedPacketHash" IS NOT NULL
      OR NEW."destinationDecisionById" IS NOT NULL
      OR NEW."destinationDecisionAt" IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid lab transfer revision';
    END IF;
  ELSIF command_type = 'lab_transfer.destination_accept' THEN
    IF NOT "lab_transfer_actor_is_lab_principal"(actor_id, NEW."destinationLabId") THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Destination approval requires an active destination owner or manager';
    END IF;
    IF NEW.status = 'requested' THEN
      IF OLD.status <> 'requested'
        OR NEW."subjectType" <> 'animals'
        OR NEW."destinationCageId" IS NULL
        OR NEW."packetVersion" <> OLD."packetVersion" + 1
        OR NEW.version <> OLD.version
      THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid destination placement preparation';
      END IF;
    ELSIF NEW.status = 'destination_accepted' THEN
      IF OLD.status <> 'requested'
        OR NEW.version <> OLD.version + 1
        OR NEW."destinationDecisionById" IS DISTINCT FROM actor_id
        OR NEW."acceptedPacketVersion" IS DISTINCT FROM NEW."packetVersion"
        OR NOT EXISTS (
          SELECT 1 FROM "LabTransferPacket" packet
          WHERE packet."requestId" = NEW.id
            AND packet.version = NEW."acceptedPacketVersion"
            AND packet."payloadHash" = NEW."acceptedPacketHash"
        )
      THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Destination acceptance must match the current immutable packet';
      END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid destination acceptance transition';
    END IF;
  ELSIF command_type = 'lab_transfer.destination_reject' THEN
    IF NOT "lab_transfer_actor_is_lab_principal"(actor_id, NEW."destinationLabId")
      OR OLD.status <> 'requested'
      OR NEW.status <> 'destination_rejected'
      OR NEW.version <> OLD.version + 1
      OR NEW."destinationDecisionById" IS DISTINCT FROM actor_id
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid destination rejection transition';
    END IF;
  ELSIF command_type = 'lab_transfer.cancel' THEN
    IF NOT "lab_transfer_actor_is_lab_principal"(actor_id, OLD."sourceLabId")
      OR NEW.status <> 'cancelled'
      OR NEW.version <> OLD.version + 1
      OR NEW."acceptedPacketVersion" IS NOT NULL
      OR NEW."acceptedPacketHash" IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid lab transfer cancellation';
    END IF;
  ELSIF command_type = 'lab_transfer.finalize' THEN
    IF NOT "lab_transfer_actor_is_finalizer"(actor_id, FALSE)
      OR OLD.status <> 'destination_accepted'
      OR NEW.status <> 'finalized'
      OR NEW.version <> OLD.version + 1
      OR NEW."finalizedById" IS DISTINCT FROM actor_id
      OR NEW."acceptedPacketVersion" IS DISTINCT FROM NEW."packetVersion"
      OR NOT EXISTS (
        SELECT 1 FROM "LabTransferPacket" packet
        WHERE packet."requestId" = NEW.id
          AND packet.version = NEW."acceptedPacketVersion"
          AND packet."payloadHash" = NEW."acceptedPacketHash"
      )
      OR (
        NEW."overrideApprovedById" IS NOT NULL
        AND (
          NEW."overrideApprovedById" IS DISTINCT FROM actor_id
          OR NOT "lab_transfer_actor_is_finalizer"(actor_id, TRUE)
        )
      )
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid lab transfer finalization';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Unsupported lab transfer command context';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "LabTransferRequest_command_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "LabTransferRequest"
FOR EACH ROW EXECUTE FUNCTION "assert_lab_transfer_request_command"();

CREATE OR REPLACE FUNCTION "assert_lab_transfer_packet_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  request_row "LabTransferRequest"%ROWTYPE;
  actor_id TEXT;
  command_type TEXT;
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN NEW;
  END IF;
  actor_id := current_setting('mcm.lab_transfer_actor_id', true);
  command_type := current_setting('mcm.lab_transfer_command_type', true);
  SELECT * INTO request_row FROM "LabTransferRequest" WHERE id = NEW."requestId";
  IF NOT FOUND
    OR NOT "lab_transfer_command_context_valid"(NEW."requestId", command_type, actor_id)
    OR NEW."createdById" IS DISTINCT FROM actor_id
    OR NEW.version IS DISTINCT FROM request_row."packetVersion"
    OR NEW."payloadHash" !~ '^[0-9a-f]{64}$'
    OR NEW."destinationPayload"->>'requestId' IS DISTINCT FROM NEW."requestId"
    OR NEW."destinationPayload"->'sourceLab'->>'id' IS DISTINCT FROM request_row."sourceLabId"
    OR NEW."destinationPayload"->'destinationLab'->>'id' IS DISTINCT FROM request_row."destinationLabId"
    OR (
      command_type IN ('lab_transfer.request', 'lab_transfer.revise')
      AND NOT "lab_transfer_actor_is_lab_principal"(actor_id, request_row."sourceLabId")
    )
    OR (
      command_type = 'lab_transfer.destination_accept'
      AND NOT "lab_transfer_actor_is_lab_principal"(actor_id, request_row."destinationLabId")
    )
    OR command_type NOT IN ('lab_transfer.request', 'lab_transfer.revise', 'lab_transfer.destination_accept')
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Transfer packet insert is not authorized by the current command';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "LabTransferPacket_insert_guard"
BEFORE INSERT ON "LabTransferPacket"
FOR EACH ROW EXECUTE FUNCTION "assert_lab_transfer_packet_insert"();

CREATE OR REPLACE FUNCTION "assert_lab_transfer_item_command"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  request_id TEXT;
  actor_id TEXT;
  command_type TEXT;
  request_row "LabTransferRequest"%ROWTYPE;
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  request_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."requestId" ELSE NEW."requestId" END;
  actor_id := current_setting('mcm.lab_transfer_actor_id', true);
  command_type := current_setting('mcm.lab_transfer_command_type', true);
  SELECT * INTO request_row FROM "LabTransferRequest" WHERE id = request_id;
  IF NOT FOUND OR NOT "lab_transfer_command_context_valid"(request_id, command_type, actor_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Transfer item mutation is not bound to its command receipt';
  END IF;
  IF command_type IN ('lab_transfer.request', 'lab_transfer.revise', 'lab_transfer.cancel') THEN
    IF NOT "lab_transfer_actor_is_lab_principal"(actor_id, request_row."sourceLabId") THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Only the source-lab principal may change transfer items';
    END IF;
  ELSIF command_type = 'lab_transfer.finalize' THEN
    IF NOT "lab_transfer_actor_is_finalizer"(actor_id, FALSE)
      OR TG_OP <> 'UPDATE'
      OR OLD.active IS NOT TRUE
      OR NEW.active IS NOT FALSE
      OR NEW.id IS DISTINCT FROM OLD.id
      OR NEW."requestId" IS DISTINCT FROM OLD."requestId"
      OR NEW."animalId" IS DISTINCT FROM OLD."animalId"
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Finalization may only deactivate approved transfer items';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Unsupported transfer item command';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER "LabTransferItem_command_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "LabTransferItem"
FOR EACH ROW EXECUTE FUNCTION "assert_lab_transfer_item_command"();

CREATE OR REPLACE FUNCTION "assert_lab_transfer_event_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  request_row "LabTransferRequest"%ROWTYPE;
  actor_id TEXT;
  command_type TEXT;
  expected_event "LabTransferEventType";
  current_actor_role "UserRole";
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN NEW;
  END IF;
  actor_id := current_setting('mcm.lab_transfer_actor_id', true);
  command_type := current_setting('mcm.lab_transfer_command_type', true);
  SELECT * INTO request_row FROM "LabTransferRequest" WHERE id = NEW."requestId";
  SELECT role INTO current_actor_role FROM "User" WHERE id = actor_id AND active;
  expected_event := CASE command_type
    WHEN 'lab_transfer.request' THEN 'requested'::"LabTransferEventType"
    WHEN 'lab_transfer.revise' THEN 'packet_revised'::"LabTransferEventType"
    WHEN 'lab_transfer.destination_accept' THEN
      CASE WHEN NEW."eventType" = 'packet_revised' THEN 'packet_revised'::"LabTransferEventType" ELSE 'destination_accepted'::"LabTransferEventType" END
    WHEN 'lab_transfer.destination_reject' THEN 'destination_rejected'::"LabTransferEventType"
    WHEN 'lab_transfer.cancel' THEN 'cancelled'::"LabTransferEventType"
    WHEN 'lab_transfer.finalize' THEN
      CASE WHEN NEW."eventType" = 'override_applied' THEN 'override_applied'::"LabTransferEventType" ELSE 'finalized'::"LabTransferEventType" END
    ELSE NULL
  END;
  IF NOT FOUND
    OR expected_event IS NULL
    OR NEW."eventType" IS DISTINCT FROM expected_event
    OR NOT "lab_transfer_command_context_valid"(NEW."requestId", command_type, actor_id)
    OR NEW."actorId" IS DISTINCT FROM actor_id
    OR NEW."actorRole" IS DISTINCT FROM current_actor_role
    OR NEW."packetVersion" IS DISTINCT FROM request_row."packetVersion"
    OR NOT EXISTS (
      SELECT 1 FROM "LabTransferPacket" packet
      WHERE packet."requestId" = NEW."requestId" AND packet.version = NEW."packetVersion"
    )
    OR (
      command_type IN ('lab_transfer.request', 'lab_transfer.revise', 'lab_transfer.cancel')
      AND (
        NOT "lab_transfer_actor_is_lab_principal"(actor_id, request_row."sourceLabId")
        OR NEW."actorLabId" IS DISTINCT FROM request_row."sourceLabId"
      )
    )
    OR (
      command_type IN ('lab_transfer.destination_accept', 'lab_transfer.destination_reject')
      AND (
        NOT "lab_transfer_actor_is_lab_principal"(actor_id, request_row."destinationLabId")
        OR NEW."actorLabId" IS DISTINCT FROM request_row."destinationLabId"
      )
    )
    OR (
      command_type = 'lab_transfer.finalize'
      AND (
        NEW."actorLabId" IS NOT NULL
        OR NOT "lab_transfer_actor_is_finalizer"(actor_id, NEW."eventType" = 'override_applied')
      )
    )
    OR (
      NEW."eventType" = 'destination_accepted'
      AND (
        request_row.status <> 'destination_accepted'
        OR request_row."acceptedPacketVersion" IS DISTINCT FROM NEW."packetVersion"
        OR NOT EXISTS (
          SELECT 1 FROM "LabTransferPacket" packet
          WHERE packet."requestId" = request_row.id
            AND packet.version = request_row."acceptedPacketVersion"
            AND packet."payloadHash" = request_row."acceptedPacketHash"
        )
      )
    )
    OR (NEW."eventType" = 'finalized' AND request_row.status <> 'finalized')
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Transfer event insert is not authorized by the current command state';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "LabTransferEvent_insert_guard"
BEFORE INSERT ON "LabTransferEvent"
FOR EACH ROW EXECUTE FUNCTION "assert_lab_transfer_event_insert"();

CREATE OR REPLACE FUNCTION "assert_lab_transfer_history_insert"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  actor_id TEXT;
  request_row "LabTransferRequest"%ROWTYPE;
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'AnimalMovement' AND NEW."requestId" IS NULL THEN RETURN NEW; END IF;
  actor_id := current_setting('mcm.lab_transfer_actor_id', true);
  SELECT * INTO request_row FROM "LabTransferRequest" WHERE id = NEW."requestId";
  IF NOT FOUND
    OR request_row.status <> 'destination_accepted'
    OR NOT "lab_transfer_command_context_valid"(NEW."requestId", 'lab_transfer.finalize', actor_id)
    OR NOT "lab_transfer_actor_is_finalizer"(actor_id, FALSE)
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Transfer history insert requires an accepted finalization command';
  END IF;

  IF TG_TABLE_NAME = 'CageLabTransfer' THEN
    IF request_row."subjectType" <> 'cage'
      OR NEW."cageId" IS DISTINCT FROM request_row."sourceCageId"
      OR NEW."fromLabId" IS DISTINCT FROM request_row."sourceLabId"
      OR NEW."toLabId" IS DISTINCT FROM request_row."destinationLabId"
      OR NEW."movedById" IS DISTINCT FROM actor_id
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Cage transfer history does not match its approved request'; END IF;
  ELSIF TG_TABLE_NAME = 'AnimalLabTransfer' THEN
    IF NEW."fromLabId" IS DISTINCT FROM request_row."sourceLabId"
      OR NEW."toLabId" IS DISTINCT FROM request_row."destinationLabId"
      OR NEW."movedById" IS DISTINCT FROM actor_id
      OR NOT EXISTS (
        SELECT 1 FROM "LabTransferItem" item
        WHERE item."requestId" = request_row.id AND item."animalId" = NEW."animalId" AND item.active
      )
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Animal transfer history does not match its approved request'; END IF;
  ELSIF TG_TABLE_NAME = 'AnimalMovement' THEN
    IF request_row."subjectType" <> 'animals'
      OR NEW."toCageId" IS DISTINCT FROM request_row."destinationCageId"
      OR NEW."movedById" IS DISTINCT FROM actor_id
      OR NOT EXISTS (
        SELECT 1 FROM "LabTransferItem" item
        WHERE item."requestId" = request_row.id AND item."animalId" = NEW."animalId" AND item.active
      )
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Cross-lab movement does not match its approved request'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "CageLabTransfer_insert_guard"
BEFORE INSERT ON "CageLabTransfer"
FOR EACH ROW EXECUTE FUNCTION "assert_lab_transfer_history_insert"();
CREATE TRIGGER "AnimalLabTransfer_insert_guard"
BEFORE INSERT ON "AnimalLabTransfer"
FOR EACH ROW EXECUTE FUNCTION "assert_lab_transfer_history_insert"();
CREATE TRIGGER "AnimalMovement_transfer_insert_guard"
BEFORE INSERT ON "AnimalMovement"
FOR EACH ROW EXECUTE FUNCTION "assert_lab_transfer_history_insert"();

CREATE OR REPLACE FUNCTION "assert_lab_ownership_change_has_transfer"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  request_id TEXT;
  actor_id TEXT;
  request_row "LabTransferRequest"%ROWTYPE;
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN NEW;
  END IF;
  request_id := current_setting('mcm.lab_transfer_request_id', true);
  actor_id := current_setting('mcm.lab_transfer_actor_id', true);

  IF TG_TABLE_NAME = 'Cage' THEN
    IF OLD."labId" IS NOT DISTINCT FROM NEW."labId" THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'Animal' THEN
    IF OLD."owningLabId" IS NOT DISTINCT FROM NEW."owningLabId" THEN RETURN NEW; END IF;
  END IF;

  SELECT * INTO request_row FROM "LabTransferRequest" WHERE id = request_id;
  IF NOT FOUND
    OR request_row.status <> 'destination_accepted'
    OR request_row."acceptedPacketVersion" IS DISTINCT FROM request_row."packetVersion"
    OR NOT EXISTS (
      SELECT 1 FROM "LabTransferPacket" packet
      WHERE packet."requestId" = request_row.id
        AND packet.version = request_row."acceptedPacketVersion"
        AND packet."payloadHash" = request_row."acceptedPacketHash"
    )
    OR NOT "lab_transfer_command_context_valid"(request_id, 'lab_transfer.finalize', actor_id)
    OR NOT "lab_transfer_actor_is_finalizer"(actor_id, FALSE)
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Ownership changes require a current accepted lab-transfer finalization';
  END IF;

  IF TG_TABLE_NAME = 'Cage' THEN
    IF request_row."subjectType" <> 'cage'
      OR request_row."sourceCageId" IS DISTINCT FROM OLD.id
      OR request_row."sourceLabId" IS DISTINCT FROM OLD."labId"
      OR request_row."destinationLabId" IS DISTINCT FROM NEW."labId"
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Cage ownership change does not match the approved request'; END IF;
  ELSIF TG_TABLE_NAME = 'Animal' THEN
    IF request_row."sourceLabId" IS DISTINCT FROM OLD."owningLabId"
      OR request_row."destinationLabId" IS DISTINCT FROM NEW."owningLabId"
      OR NOT EXISTS (
        SELECT 1 FROM "LabTransferItem" item
        WHERE item."requestId" = request_row.id AND item."animalId" = OLD.id AND item.active
      )
      OR (
        request_row."subjectType" = 'cage'
        AND request_row."sourceCageId" IS DISTINCT FROM OLD."currentCageId"
      )
      OR (
        request_row."subjectType" = 'animals'
        AND request_row."destinationCageId" IS DISTINCT FROM NEW."currentCageId"
      )
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Animal ownership change does not match the approved request'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Cage_lab_transfer_guard"
BEFORE UPDATE OF "labId" ON "Cage"
FOR EACH ROW EXECUTE FUNCTION "assert_lab_ownership_change_has_transfer"();
CREATE TRIGGER "Animal_lab_transfer_guard"
BEFORE UPDATE OF "owningLabId" ON "Animal"
FOR EACH ROW EXECUTE FUNCTION "assert_lab_ownership_change_has_transfer"();

CREATE OR REPLACE FUNCTION "assert_lab_transfer_commit_complete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  request_id TEXT;
  request_row "LabTransferRequest"%ROWTYPE;
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'Cage' THEN
    IF OLD."labId" IS NOT DISTINCT FROM NEW."labId" THEN RETURN NULL; END IF;
  ELSIF TG_TABLE_NAME = 'Animal' THEN
    IF OLD."owningLabId" IS NOT DISTINCT FROM NEW."owningLabId" THEN RETURN NULL; END IF;
  END IF;
  request_id := current_setting('mcm.lab_transfer_request_id', true);
  SELECT * INTO request_row FROM "LabTransferRequest" WHERE id = request_id;
  IF NOT FOUND
    OR request_row.status <> 'finalized'
    OR NOT EXISTS (
      SELECT 1 FROM "LabTransferEvent" event
      WHERE event."requestId" = request_row.id AND event."eventType" = 'finalized'
    )
    OR EXISTS (
      SELECT 1 FROM "LabTransferItem" item WHERE item."requestId" = request_row.id AND item.active
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Lab transfer transaction is missing final request, event, or item state';
  END IF;

  IF TG_TABLE_NAME = 'Cage' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "CageLabTransfer" transfer
      WHERE transfer."requestId" = request_row.id
        AND transfer."cageId" = NEW.id
        AND transfer."fromLabId" = OLD."labId"
        AND transfer."toLabId" = NEW."labId"
    )
      OR NOT EXISTS (
        SELECT 1 FROM "CageChargePeriod" period
        WHERE period."cageId" = NEW.id AND period."labId" = NEW."labId" AND period."endedAt" IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM "CageChargePeriod" period
        WHERE period."cageId" = NEW.id AND period."labId" = OLD."labId" AND period."endedAt" IS NULL
      )
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Cage transfer did not atomically preserve history and billing boundaries'; END IF;
  ELSIF TG_TABLE_NAME = 'Animal' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "AnimalLabTransfer" transfer
      WHERE transfer."requestId" = request_row.id
        AND transfer."animalId" = NEW.id
        AND transfer."fromLabId" = OLD."owningLabId"
        AND transfer."toLabId" = NEW."owningLabId"
    )
      OR (
        request_row."subjectType" = 'animals'
        AND NOT EXISTS (
          SELECT 1 FROM "AnimalMovement" movement
          WHERE movement."requestId" = request_row.id
            AND movement."animalId" = NEW.id
            AND movement."fromCageId" IS NOT DISTINCT FROM OLD."currentCageId"
            AND movement."toCageId" IS NOT DISTINCT FROM NEW."currentCageId"
        )
      )
    THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Animal transfer did not atomically preserve ownership and movement history'; END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "Cage_lab_transfer_commit_guard"
AFTER UPDATE OF "labId" ON "Cage"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_lab_transfer_commit_complete"();
CREATE CONSTRAINT TRIGGER "Animal_lab_transfer_commit_guard"
AFTER UPDATE OF "owningLabId" ON "Animal"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_lab_transfer_commit_complete"();

COMMIT;
