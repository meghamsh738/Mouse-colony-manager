BEGIN;

CREATE TABLE "CageUserAssignment" (
  id TEXT NOT NULL,
  "cageId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assignedById" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "endedById" TEXT,
  "endReason" TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,

  CONSTRAINT "CageUserAssignment_pkey" PRIMARY KEY (id),
  CONSTRAINT "CageUserAssignment_time_order_check"
    CHECK ("endedAt" IS NULL OR "endedAt" >= "assignedAt"),
  CONSTRAINT "CageUserAssignment_end_context_check"
    CHECK (
      ("endedAt" IS NULL AND "endedById" IS NULL AND "endReason" IS NULL)
      OR
      ("endedAt" IS NOT NULL AND "endedById" IS NOT NULL AND char_length(btrim("endReason")) BETWEEN 3 AND 500)
    ),
  CONSTRAINT "CageUserAssignment_version_check" CHECK (version >= 1),
  CONSTRAINT "CageUserAssignment_reason_check"
    CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500)
);

CREATE UNIQUE INDEX "CageUserAssignment_cageId_userId_assignedAt_key"
  ON "CageUserAssignment" ("cageId", "userId", "assignedAt");
CREATE UNIQUE INDEX "CageUserAssignment_active_cage_user_key"
  ON "CageUserAssignment" ("cageId", "userId")
  WHERE "endedAt" IS NULL;
CREATE INDEX "CageUserAssignment_labId_userId_endedAt_idx"
  ON "CageUserAssignment" ("labId", "userId", "endedAt");
CREATE INDEX "CageUserAssignment_cageId_endedAt_idx"
  ON "CageUserAssignment" ("cageId", "endedAt");
CREATE INDEX "CageUserAssignment_assignedById_assignedAt_idx"
  ON "CageUserAssignment" ("assignedById", "assignedAt");
CREATE INDEX "CageUserAssignment_endedById_endedAt_idx"
  ON "CageUserAssignment" ("endedById", "endedAt");

ALTER TABLE "CageUserAssignment"
  ADD CONSTRAINT "CageUserAssignment_cageId_fkey"
    FOREIGN KEY ("cageId") REFERENCES "Cage"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CageUserAssignment_labId_userId_fkey"
    FOREIGN KEY ("labId", "userId") REFERENCES "LabMembership"("labId", "userId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  ADD CONSTRAINT "CageUserAssignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CageUserAssignment_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CageUserAssignment_endedById_fkey"
    FOREIGN KEY ("endedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "cage_assignment_command_context_valid"(
  command_type TEXT,
  cage_id TEXT,
  lab_id TEXT,
  actor_id TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "CommandReceipt" receipt
    JOIN "User" actor ON actor.id = receipt."actorId"
    WHERE receipt.id = current_setting('mcm.cage_assignment_receipt_id', true)
      AND receipt."actorId" = actor_id
      AND receipt."commandType" = command_type
      AND receipt.status = 'processing'
      AND receipt."actorAuthzVersion" = actor."authzVersion"
      AND receipt."databasePrincipal" = SESSION_USER
      AND actor.active
      AND (
        (
          command_type IN ('cage.responsibility.update', 'cage.close')
          AND receipt."labId" = lab_id
          AND receipt."aggregateType" = 'cage'
          AND receipt."aggregateId" = cage_id
          AND receipt."expectedVersion" = (SELECT cage.version FROM "Cage" cage WHERE cage.id = cage_id)
        )
        OR
        (
          command_type = 'lab_transfer.finalize'
          AND receipt."labId" IS NULL
          AND receipt."aggregateType" = 'lab_transfer_request'
          AND EXISTS (
            SELECT 1
            FROM "LabTransferRequest" request
            WHERE request.id = receipt."aggregateId"
              AND request."sourceCageId" = cage_id
              AND request."sourceLabId" = lab_id
          )
        )
      )
  )
$$;

CREATE FUNCTION "validate_cage_user_assignment_write"()
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
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Cage responsibility history cannot be deleted or truncated';
  END IF;

  actor_id := current_setting('mcm.cage_assignment_actor_id', true);
  command_type := current_setting('mcm.cage_assignment_command_type', true);

  IF TG_OP = 'INSERT' THEN
    IF command_type <> 'cage.responsibility.update'
      OR NEW."assignedById" IS DISTINCT FROM actor_id
      OR NOT "cage_assignment_command_context_valid"(command_type, NEW."cageId", NEW."labId", actor_id)
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Cage responsibility assignment requires an authorized command receipt';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW."cageId" IS DISTINCT FROM OLD."cageId"
      OR NEW."labId" IS DISTINCT FROM OLD."labId"
      OR NEW."userId" IS DISTINCT FROM OLD."userId"
      OR NEW."assignedById" IS DISTINCT FROM OLD."assignedById"
      OR NEW."assignedAt" IS DISTINCT FROM OLD."assignedAt"
      OR NEW.reason IS DISTINCT FROM OLD.reason
      OR OLD."endedAt" IS NOT NULL
      OR NEW."endedAt" IS NULL
      OR NEW."endedById" IS DISTINCT FROM actor_id
      OR NEW.version <> OLD.version + 1
      OR command_type NOT IN ('cage.responsibility.update', 'lab_transfer.finalize', 'cage.close')
      OR NOT "cage_assignment_command_context_valid"(command_type, NEW."cageId", NEW."labId", actor_id)
    THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Cage responsibility history is immutable except for an authorized close';
    END IF;
  END IF;

  IF NEW."endedAt" IS NULL AND NOT EXISTS (
    SELECT 1
    FROM "Cage" cage
    JOIN "LabMembership" membership
      ON membership."labId" = NEW."labId" AND membership."userId" = NEW."userId"
    JOIN "User" responsible_user ON responsible_user.id = membership."userId"
    JOIN "Lab" lab ON lab.id = membership."labId"
    WHERE cage.id = NEW."cageId"
      AND cage."labId" = NEW."labId"
      AND cage.active
      AND cage.status <> 'closed'
      AND membership.active
      AND membership.role IN ('owner', 'manager', 'staff')
      AND responsible_user.active
      AND lab.active
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Active cage responsibility requires the current cage lab and an active operational lab member';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "CageUserAssignment_write_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "CageUserAssignment"
FOR EACH ROW EXECUTE FUNCTION "validate_cage_user_assignment_write"();

CREATE TRIGGER "CageUserAssignment_truncate_guard"
BEFORE TRUNCATE ON "CageUserAssignment"
FOR EACH STATEMENT EXECUTE FUNCTION "validate_cage_user_assignment_write"();

CREATE FUNCTION "prevent_cage_state_change_with_active_assignments"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW."labId" IS DISTINCT FROM OLD."labId"
    OR (OLD.active AND NOT NEW.active)
    OR (OLD.status <> 'closed' AND NEW.status = 'closed')
  ) AND EXISTS (
    SELECT 1
    FROM "CageUserAssignment" assignment
    WHERE assignment."cageId" = OLD.id AND assignment."endedAt" IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'End active cage responsibilities before transferring the cage to another lab';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "Cage_active_responsibility_lab_guard"
BEFORE UPDATE OF "labId", active, status ON "Cage"
FOR EACH ROW EXECUTE FUNCTION "prevent_cage_state_change_with_active_assignments"();

CREATE FUNCTION "prevent_active_responsibility_principal_removal"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'User' THEN
    IF OLD.active AND NOT NEW.active AND EXISTS (
      SELECT 1 FROM "CageUserAssignment" assignment
      WHERE assignment."userId" = OLD.id AND assignment."endedAt" IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reassign active cages before deactivating this user';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'Lab' THEN
    IF OLD.active AND NOT NEW.active AND EXISTS (
      SELECT 1 FROM "CageUserAssignment" assignment
      WHERE assignment."labId" = OLD.id AND assignment."endedAt" IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reassign or close active cages before deactivating this lab';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM "CageUserAssignment" assignment
    WHERE assignment."labId" = OLD."labId"
      AND assignment."userId" = OLD."userId"
      AND assignment."endedAt" IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reassign active cages before removing this lab membership';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF (
    NEW."labId" IS DISTINCT FROM OLD."labId"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR (OLD.active AND NOT NEW.active)
    OR (NEW.role NOT IN ('owner', 'manager', 'staff'))
  ) AND EXISTS (
    SELECT 1 FROM "CageUserAssignment" assignment
    WHERE assignment."labId" = OLD."labId"
      AND assignment."userId" = OLD."userId"
      AND assignment."endedAt" IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reassign active cages before removing this lab membership';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "User_active_cage_responsibility_guard"
BEFORE UPDATE OF active ON "User"
FOR EACH ROW EXECUTE FUNCTION "prevent_active_responsibility_principal_removal"();

CREATE TRIGGER "Lab_active_cage_responsibility_guard"
BEFORE UPDATE OF active ON "Lab"
FOR EACH ROW EXECUTE FUNCTION "prevent_active_responsibility_principal_removal"();

CREATE TRIGGER "LabMembership_active_cage_responsibility_guard"
BEFORE UPDATE OF active, role, "labId", "userId" OR DELETE ON "LabMembership"
FOR EACH ROW EXECUTE FUNCTION "prevent_active_responsibility_principal_removal"();

COMMIT;
