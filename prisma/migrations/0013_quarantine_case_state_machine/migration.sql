CREATE TYPE "QuarantineCaseStatus" AS ENUM (
  'admitted',
  'under_observation',
  'exception_open',
  'release_requested',
  'released',
  'cancelled'
);

CREATE TYPE "QuarantineObservationResult" AS ENUM (
  'clear',
  'monitor',
  'exception',
  'exception_resolved'
);

CREATE UNIQUE INDEX "AnimalIntakeBatch_id_labId_key" ON "AnimalIntakeBatch"("id", "labId");

CREATE TABLE "QuarantineCase" (
  "id" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "cageId" TEXT NOT NULL,
  "intakeBatchId" TEXT,
  "status" "QuarantineCaseStatus" NOT NULL DEFAULT 'admitted',
  "admittedAt" TIMESTAMP(3) NOT NULL,
  "minimumReleaseAt" TIMESTAMP(3) NOT NULL,
  "admissionReason" TEXT NOT NULL,
  "admittedById" TEXT NOT NULL,
  "releaseRequestedAt" TIMESTAMP(3),
  "releaseRequestedById" TEXT,
  "releaseRequestReason" TEXT,
  "releasedAt" TIMESTAMP(3),
  "releasedById" TEXT,
  "releaseReason" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QuarantineCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuarantineCase_release_after_admission_check" CHECK ("minimumReleaseAt" >= "admittedAt"),
  CONSTRAINT "QuarantineCase_request_coherence_check" CHECK (
    ("status" = 'release_requested' AND "releaseRequestedAt" IS NOT NULL AND "releaseRequestedById" IS NOT NULL AND LENGTH(BTRIM("releaseRequestReason")) >= 3)
    OR "status" <> 'release_requested'
  ),
  CONSTRAINT "QuarantineCase_release_coherence_check" CHECK (
    ("status" = 'released' AND "releasedAt" IS NOT NULL AND "releasedById" IS NOT NULL AND LENGTH(BTRIM("releaseReason")) >= 3)
    OR "status" <> 'released'
  ),
  CONSTRAINT "QuarantineCase_cancel_coherence_check" CHECK (
    ("status" = 'cancelled' AND "cancelledAt" IS NOT NULL)
    OR "status" <> 'cancelled'
  )
);

CREATE TABLE "QuarantineObservation" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "observedById" TEXT NOT NULL,
  "result" "QuarantineObservationResult" NOT NULL,
  "severity" "AlertSeverity" NOT NULL,
  "note" TEXT NOT NULL,
  "followupRequired" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuarantineObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuarantineObservation_note_check" CHECK (LENGTH(BTRIM("note")) >= 3)
);

CREATE UNIQUE INDEX "QuarantineCase_id_labId_key" ON "QuarantineCase"("id", "labId");
CREATE INDEX "QuarantineCase_labId_status_idx" ON "QuarantineCase"("labId", "status");
CREATE INDEX "QuarantineCase_cageId_status_idx" ON "QuarantineCase"("cageId", "status");
CREATE INDEX "QuarantineCase_minimumReleaseAt_status_idx" ON "QuarantineCase"("minimumReleaseAt", "status");
CREATE INDEX "QuarantineCase_intakeBatchId_idx" ON "QuarantineCase"("intakeBatchId");
CREATE UNIQUE INDEX "QuarantineCase_one_open_per_cage_key" ON "QuarantineCase"("cageId")
WHERE "status" IN ('admitted', 'under_observation', 'exception_open', 'release_requested');

CREATE INDEX "QuarantineObservation_labId_observedAt_idx" ON "QuarantineObservation"("labId", "observedAt");
CREATE INDEX "QuarantineObservation_caseId_observedAt_idx" ON "QuarantineObservation"("caseId", "observedAt");
CREATE INDEX "QuarantineObservation_result_observedAt_idx" ON "QuarantineObservation"("result", "observedAt");

ALTER TABLE "QuarantineCase" ADD CONSTRAINT "QuarantineCase_labId_fkey"
  FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuarantineCase" ADD CONSTRAINT "QuarantineCase_cageId_labId_fkey"
  FOREIGN KEY ("cageId", "labId") REFERENCES "Cage"("id", "labId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "QuarantineCase" ADD CONSTRAINT "QuarantineCase_intakeBatchId_labId_fkey"
  FOREIGN KEY ("intakeBatchId", "labId") REFERENCES "AnimalIntakeBatch"("id", "labId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "QuarantineCase" ADD CONSTRAINT "QuarantineCase_admittedById_fkey"
  FOREIGN KEY ("admittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuarantineCase" ADD CONSTRAINT "QuarantineCase_releaseRequestedById_fkey"
  FOREIGN KEY ("releaseRequestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuarantineCase" ADD CONSTRAINT "QuarantineCase_releasedById_fkey"
  FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuarantineObservation" ADD CONSTRAINT "QuarantineObservation_caseId_labId_fkey"
  FOREIGN KEY ("caseId", "labId") REFERENCES "QuarantineCase"("id", "labId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "QuarantineObservation" ADD CONSTRAINT "QuarantineObservation_labId_fkey"
  FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuarantineObservation" ADD CONSTRAINT "QuarantineObservation_observedById_fkey"
  FOREIGN KEY ("observedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "QuarantineCase_version_bump"
BEFORE UPDATE ON "QuarantineCase"
FOR EACH ROW EXECUTE FUNCTION "bump_or_validate_aggregate_version"();

CREATE FUNCTION "protect_quarantine_case_transition"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'admitted' AND NEW.status IN ('under_observation', 'exception_open', 'cancelled'))
    OR (OLD.status = 'under_observation' AND NEW.status IN ('exception_open', 'release_requested', 'cancelled'))
    OR (OLD.status = 'exception_open' AND NEW.status IN ('under_observation', 'cancelled'))
    OR (OLD.status = 'release_requested' AND NEW.status IN ('under_observation', 'exception_open', 'released', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'Invalid quarantine case transition from % to %.', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "QuarantineCase_transition_guard"
BEFORE UPDATE OF "status" ON "QuarantineCase"
FOR EACH ROW EXECUTE FUNCTION "protect_quarantine_case_transition"();

CREATE FUNCTION "protect_open_quarantine_animal_containment"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."currentCageId" IS DISTINCT FROM NEW."currentCageId"
    AND OLD."currentCageId" IS NOT NULL
    AND NOT (
      NEW."currentCageId" IS NULL
      AND NEW."outcomeStatus" IN ('euthanized', 'dead', 'transferred')
    )
    AND EXISTS (
      SELECT 1
      FROM "QuarantineCase" qc
      WHERE qc."cageId" = OLD."currentCageId"
        AND qc.status IN ('admitted', 'under_observation', 'exception_open', 'release_requested')
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Animals in an open quarantine case can only leave through reviewed quarantine release.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Animal_open_quarantine_containment"
BEFORE UPDATE OF "currentCageId", "outcomeStatus" ON "Animal"
FOR EACH ROW EXECUTE FUNCTION "protect_open_quarantine_animal_containment"();

CREATE FUNCTION "protect_open_quarantine_cage_containment"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (
      OLD."labId" IS DISTINCT FROM NEW."labId"
      OR OLD.status IS DISTINCT FROM NEW.status
      OR OLD.active IS DISTINCT FROM NEW.active
    )
    AND EXISTS (
      SELECT 1
      FROM "QuarantineCase" qc
      WHERE qc."cageId" = OLD.id
        AND qc.status IN ('admitted', 'under_observation', 'exception_open', 'release_requested')
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Cage ownership and operational state are locked while quarantine is open.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Cage_open_quarantine_containment"
BEFORE UPDATE OF "labId", status, active ON "Cage"
FOR EACH ROW EXECUTE FUNCTION "protect_open_quarantine_cage_containment"();

CREATE FUNCTION "protect_quarantine_observation_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  case_status "QuarantineCaseStatus";
BEGIN
  SELECT status INTO case_status
  FROM "QuarantineCase"
  WHERE id = NEW."caseId"
  FOR UPDATE;

  IF case_status IN ('release_requested', 'released', 'cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Quarantine observations cannot be added after release is requested or the case is terminal.';
  END IF;
  IF case_status = 'exception_open' AND NEW.result <> 'exception_resolved' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An open quarantine exception requires explicit resolution.';
  END IF;
  IF case_status <> 'exception_open' AND NEW.result = 'exception_resolved' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'No open quarantine exception is available to resolve.';
  END IF;
  IF NEW.result = 'exception' AND NEW.severity = 'info' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A quarantine exception must be warning or critical severity.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "QuarantineObservation_state_guard"
BEFORE INSERT ON "QuarantineObservation"
FOR EACH ROW EXECUTE FUNCTION "protect_quarantine_observation_insert"();

CREATE FUNCTION "protect_quarantine_observation_history"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Quarantine observations are append-only.' USING ERRCODE = '23514';
END $$;

CREATE TRIGGER "QuarantineObservation_append_only"
BEFORE UPDATE OR DELETE ON "QuarantineObservation"
FOR EACH ROW EXECUTE FUNCTION "protect_quarantine_observation_history"();
