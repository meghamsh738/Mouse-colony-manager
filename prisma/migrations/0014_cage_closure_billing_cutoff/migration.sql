BEGIN;

LOCK TABLE "Cage", "Animal", "CageChargePeriod", "Invoice", "InvoiceLineItem"
  IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE "CageClosure" (
  "id" TEXT NOT NULL,
  "cageId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "chargePeriodId" TEXT NOT NULL,
  "reviewSnapshotId" TEXT,
  "closedAt" TIMESTAMP(3) NOT NULL,
  "billingCutoffAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "closedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CageClosure_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CageClosure_reason_check" CHECK (LENGTH(BTRIM("reason")) >= 3),
  CONSTRAINT "CageClosure_cutoff_matches_closed_at_check" CHECK ("billingCutoffAt" = "closedAt")
);

CREATE UNIQUE INDEX "CageClosure_cageId_key" ON "CageClosure"("cageId");
CREATE UNIQUE INDEX "CageClosure_cageId_labId_key" ON "CageClosure"("cageId", "labId");
CREATE UNIQUE INDEX "CageClosure_chargePeriodId_key" ON "CageClosure"("chargePeriodId");
CREATE UNIQUE INDEX "CageClosure_chargePeriodId_cageId_labId_key" ON "CageClosure"("chargePeriodId", "cageId", "labId");
CREATE UNIQUE INDEX "CageClosure_reviewSnapshotId_key" ON "CageClosure"("reviewSnapshotId");
CREATE INDEX "CageClosure_labId_closedAt_idx" ON "CageClosure"("labId", "closedAt");
CREATE INDEX "CageClosure_closedAt_idx" ON "CageClosure"("closedAt");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Cage" WHERE status = 'closed' AND active) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Closed cages still marked active must be reconciled before the cage-closure migration can continue.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "Cage" cage
    JOIN "Animal" animal ON animal."currentCageId" = cage.id
    WHERE cage.status = 'closed'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Closed cages with assigned animals must be reconciled before the cage-closure migration can continue.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Cage" cage
    WHERE cage.status = 'closed'
      AND NOT EXISTS (SELECT 1 FROM "CageChargePeriod" period WHERE period."cageId" = cage.id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Closed cages without charge history must be reconciled before the cage-closure migration can continue.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "Cage" cage
    WHERE cage.status = 'closed'
      AND (
        SELECT period."labId"
        FROM "CageChargePeriod" period
        WHERE period."cageId" = cage.id
        ORDER BY period."startedAt" DESC, period.id DESC
        LIMIT 1
      ) IS DISTINCT FROM cage."labId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A closed cage final charge period must belong to its closing lab before the cage-closure migration can continue.';
  END IF;
  IF EXISTS (
    SELECT "cageId"
    FROM "CageChargePeriod"
    WHERE "endedAt" IS NULL
    GROUP BY "cageId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Cages with multiple open charge periods must be reconciled before the cage-closure migration can continue.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "CageChargePeriod" period
    JOIN "Cage" cage ON cage.id = period."cageId"
    WHERE period."endedAt" IS NULL
      AND period."labId" <> cage."labId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Open cage charge periods must belong to the cage current lab before the cage-closure migration can continue.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "CageChargePeriod" left_period
    JOIN "CageChargePeriod" right_period
      ON right_period."cageId" = left_period."cageId"
      AND right_period.id > left_period.id
    WHERE left_period."startedAt" < COALESCE(right_period."endedAt", 'infinity'::timestamp)
      AND right_period."startedAt" < COALESCE(left_period."endedAt", 'infinity'::timestamp)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Cages with overlapping charge periods must be reconciled before the cage-closure migration can continue.';
  END IF;
END $$;

WITH closure_cutoffs AS (
  SELECT
    cage.id AS "cageId",
    GREATEST(
      cage."lastUpdatedAt",
      COALESCE(MAX(period."startedAt"), cage."lastUpdatedAt"),
      COALESCE(MAX(period."endedAt"), cage."lastUpdatedAt")
    ) AS cutoff
  FROM "Cage" cage
  LEFT JOIN "CageChargePeriod" period ON period."cageId" = cage.id
  WHERE cage.status = 'closed'
  GROUP BY cage.id, cage."lastUpdatedAt"
)
UPDATE "CageChargePeriod" period
SET "endedAt" = cutoffs.cutoff
FROM closure_cutoffs cutoffs
WHERE period."cageId" = cutoffs."cageId"
  AND period."endedAt" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CageChargePeriod"
    WHERE "endedAt" IS NOT NULL AND "endedAt" < "startedAt"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Charge periods ending before they start must be reconciled before the cage-closure migration can continue.';
  END IF;
  IF EXISTS (
    WITH closure_cutoffs AS (
      SELECT
        cage.id AS "cageId",
        GREATEST(
          cage."lastUpdatedAt",
          COALESCE(MAX(period."startedAt"), cage."lastUpdatedAt"),
          COALESCE(MAX(period."endedAt"), cage."lastUpdatedAt")
        ) AS cutoff
      FROM "Cage" cage
      JOIN "CageChargePeriod" period ON period."cageId" = cage.id
      WHERE cage.status = 'closed'
      GROUP BY cage.id, cage."lastUpdatedAt"
    ), final_periods AS (
      SELECT DISTINCT ON (period."cageId")
        period."cageId",
        period."endedAt"
      FROM "CageChargePeriod" period
      JOIN closure_cutoffs cutoffs ON cutoffs."cageId" = period."cageId"
      ORDER BY period."cageId", period."startedAt" DESC, period.id DESC
    )
    SELECT 1
    FROM closure_cutoffs cutoff
    JOIN final_periods final_period ON final_period."cageId" = cutoff."cageId"
    WHERE final_period."endedAt" IS DISTINCT FROM cutoff.cutoff
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A legacy closed cage final charge period must end exactly at its derived closure cutoff before the cage-closure migration can continue.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "InvoiceLineItem" line
    JOIN "CageChargePeriod" period ON period.id = line."chargePeriodId"
    WHERE line."cageId" <> period."cageId" OR line."categoryId" <> period."categoryId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice lines that disagree with their cage charge period must be reconciled before the cage-closure migration can continue.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "Invoice" invoice
    WHERE invoice.status IN ('finalized', 'void')
      AND (
        invoice."periodEnd" <= invoice."periodStart"
        OR (
          invoice."finalizedAt" IS NOT NULL
          AND invoice."periodEnd" > invoice."finalizedAt"
        )
        OR invoice."subtotalCents" IS DISTINCT FROM COALESCE((
          SELECT SUM(line."amountCents")::integer
          FROM "InvoiceLineItem" line
          WHERE line."invoiceId" = invoice.id
        ), 0)
        OR (invoice.status = 'finalized' AND (
          invoice."finalizedAt" IS NULL
          OR invoice."finalizedById" IS NULL
          OR invoice."voidedAt" IS NOT NULL
          OR invoice."voidedById" IS NOT NULL
          OR invoice."voidReason" IS NOT NULL
        ))
        OR (invoice.status = 'void' AND (
          invoice."voidedAt" IS NULL
          OR invoice."voidedById" IS NULL
          OR LENGTH(BTRIM(COALESCE(invoice."voidReason", ''))) < 1
          OR (invoice."finalizedAt" IS NULL) <> (invoice."finalizedById" IS NULL)
        ))
        OR EXISTS (
          SELECT 1
          FROM "InvoiceLineItem" line
          JOIN "CageChargePeriod" period ON period.id = line."chargePeriodId"
          WHERE line."invoiceId" = invoice.id
            AND (
              period."labId" <> invoice."labId"
              OR period."cageId" <> line."cageId"
              OR period."categoryId" <> line."categoryId"
              OR period."dailyRateCents" <> line."dailyRateCents"
              OR period."currencyCode" <> invoice."currencyCode"
              OR line."serviceStart" < period."startedAt"
              OR (period."endedAt" IS NOT NULL AND line."serviceEnd" > period."endedAt")
              OR line."serviceStart" < invoice."periodStart"
              OR line."serviceEnd" > invoice."periodEnd"
              OR line."serviceEnd" <= line."serviceStart"
              OR line."dayCount" <= 0
              OR line."dayCount" <> CEIL(EXTRACT(EPOCH FROM (line."serviceEnd" - line."serviceStart")) / 86400.0)::integer
              OR line."dailyRateCents" < 0
              OR line."amountCents" <> line."dayCount" * line."dailyRateCents"
            )
        )
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Existing finalized or void invoices must have internally consistent immutable billing history before the cage-closure migration can continue.';
  END IF;
  IF EXISTS (
    WITH closure_cutoffs AS (
      SELECT
        cage.id AS "cageId",
        GREATEST(
          cage."lastUpdatedAt",
          COALESCE(MAX(period."startedAt"), cage."lastUpdatedAt"),
          COALESCE(MAX(period."endedAt"), cage."lastUpdatedAt")
        ) AS cutoff
      FROM "Cage" cage
      JOIN "CageChargePeriod" period ON period."cageId" = cage.id
      WHERE cage.status = 'closed'
      GROUP BY cage.id, cage."lastUpdatedAt"
    )
    SELECT 1
    FROM closure_cutoffs cutoff
    JOIN "CageChargePeriod" period ON period."cageId" = cutoff."cageId"
    JOIN "InvoiceLineItem" line ON line."chargePeriodId" = period.id
    JOIN "Invoice" invoice ON invoice.id = line."invoiceId"
    WHERE invoice.status IN ('draft', 'finalized')
      AND line."serviceEnd" > cutoff.cutoff
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice service beyond a legacy cage closure cutoff must be reconciled before the cage-closure migration can continue.';
  END IF;
END $$;

ALTER TABLE "CageChargePeriod" ADD CONSTRAINT "CageChargePeriod_date_order_check"
  CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");
CREATE UNIQUE INDEX "CageChargePeriod_one_open_per_cage_key"
  ON "CageChargePeriod"("cageId") WHERE "endedAt" IS NULL;
CREATE UNIQUE INDEX "CageChargePeriod_id_cageId_labId_key"
  ON "CageChargePeriod"(id, "cageId", "labId");
CREATE UNIQUE INDEX "CageChargePeriod_id_cageId_categoryId_key"
  ON "CageChargePeriod"(id, "cageId", "categoryId");
ALTER TABLE "InvoiceLineItem" DROP CONSTRAINT "InvoiceLineItem_chargePeriodId_fkey";
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_chargePeriodId_cageId_categoryId_fkey"
  FOREIGN KEY ("chargePeriodId", "cageId", "categoryId") REFERENCES "CageChargePeriod"(id, "cageId", "categoryId") ON DELETE RESTRICT ON UPDATE NO ACTION;

WITH closure_cutoffs AS (
  SELECT
    cage.id AS "cageId",
    cage."labId",
    GREATEST(
      cage."lastUpdatedAt",
      COALESCE(MAX(period."startedAt"), cage."lastUpdatedAt"),
      COALESCE(MAX(period."endedAt"), cage."lastUpdatedAt")
    ) AS cutoff
  FROM "Cage" cage
  JOIN "CageChargePeriod" period ON period."cageId" = cage.id
  WHERE cage.status = 'closed'
  GROUP BY cage.id, cage."labId", cage."lastUpdatedAt"
), final_periods AS (
  SELECT DISTINCT ON (period."cageId")
    period."cageId",
    period.id AS "chargePeriodId"
  FROM "CageChargePeriod" period
  JOIN closure_cutoffs cutoffs ON cutoffs."cageId" = period."cageId"
  ORDER BY period."cageId", period."startedAt" DESC, period.id DESC
)
INSERT INTO "CageClosure" (
  id, "cageId", "labId", "chargePeriodId", "closedAt", "billingCutoffAt", reason
)
SELECT
  'legacy-cage-closure-' || MD5(cutoffs."cageId"),
  cutoffs."cageId",
  cutoffs."labId",
  final_periods."chargePeriodId",
  cutoffs.cutoff,
  cutoffs.cutoff,
  'Legacy closed cage backfill.'
FROM closure_cutoffs cutoffs
JOIN final_periods ON final_periods."cageId" = cutoffs."cageId";

ALTER TABLE "CageClosure" ADD CONSTRAINT "CageClosure_cageId_labId_fkey"
  FOREIGN KEY ("cageId", "labId") REFERENCES "Cage"("id", "labId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "CageClosure" ADD CONSTRAINT "CageClosure_labId_fkey"
  FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CageClosure" ADD CONSTRAINT "CageClosure_chargePeriodId_cageId_labId_fkey"
  FOREIGN KEY ("chargePeriodId", "cageId", "labId") REFERENCES "CageChargePeriod"(id, "cageId", "labId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "CageClosure" ADD CONSTRAINT "CageClosure_reviewSnapshotId_fkey"
  FOREIGN KEY ("reviewSnapshotId") REFERENCES "WorkflowReviewSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CageClosure" ADD CONSTRAINT "CageClosure_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION "validate_cage_closure_insert"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  cage_status "CageStatus";
  cage_active BOOLEAN;
  cage_version INTEGER;
  review_payload JSONB;
  review_lab_id TEXT;
  review_draft_id TEXT;
  reviewed_expected_version INTEGER;
  period_cage_id TEXT;
  period_lab_id TEXT;
  period_category_id TEXT;
  period_daily_rate_cents INTEGER;
  period_currency_code TEXT;
  period_started_at TIMESTAMP(3);
  period_ended_at TIMESTAMP(3);
BEGIN
  IF NEW."reviewSnapshotId" IS NULL OR NEW."closedById" IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A new cage closure requires its actor-bound cage-closure review snapshot.';
  END IF;

  SELECT snapshot.payload, draft."labId", draft.id
  INTO review_payload, review_lab_id, review_draft_id
    FROM "WorkflowReviewSnapshot" snapshot
    JOIN "WorkflowDraft" draft ON draft.id = snapshot."draftId"
    WHERE snapshot.id = NEW."reviewSnapshotId"
      AND snapshot."createdById" = NEW."closedById"
      AND draft."actorId" = NEW."closedById"
      AND draft."workflowType" = 'cage.closure'
      AND draft.status = 'submitted'
  FOR UPDATE OF draft;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A new cage closure requires its actor-bound cage-closure review snapshot.';
  END IF;
  reviewed_expected_version := (review_payload #>> '{expectedVersion}')::integer;
  IF review_lab_id IS DISTINCT FROM NEW."labId"
    OR review_payload #>> '{command,labId}' IS DISTINCT FROM NEW."labId"
    OR review_payload #>> '{command,cageId}' IS DISTINCT FROM NEW."cageId"
    OR NEW."closedAt" IS DISTINCT FROM (review_payload #>> '{command,closedAt}')::date::timestamp
    OR NEW."closedAt" IS DISTINCT FROM DATE_TRUNC('day', NEW."closedAt")
    OR BTRIM(review_payload #>> '{command,reason}') IS DISTINCT FROM BTRIM(NEW.reason)
    OR review_payload #>> '{command,expectedChargePeriodId}' IS DISTINCT FROM NEW."chargePeriodId"
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The cage closure does not match its immutable reviewed payload.';
  END IF;

  SELECT status, active, version
  INTO cage_status, cage_active, cage_version
  FROM "Cage"
  WHERE id = NEW."cageId"
  FOR UPDATE;

  IF cage_status IS NULL OR cage_status <> 'closed' OR cage_active THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cage closure requires an inactive cage in closed status.';
  END IF;
  IF reviewed_expected_version IS NULL OR cage_version <> reviewed_expected_version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'The cage version no longer matches its immutable closure review.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "CommandReceipt" receipt
    WHERE receipt."actorId" = NEW."closedById"
      AND receipt."labId" = NEW."labId"
      AND receipt."workflowDraftId" = review_draft_id
      AND receipt."commandType" = 'cage.close'
      AND receipt."aggregateType" = 'cage'
      AND receipt."aggregateId" = NEW."cageId"
      AND receipt."expectedVersion" = reviewed_expected_version
      AND receipt.status = 'processing'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cage closure requires its active version-bound command receipt.';
  END IF;
  IF EXISTS (SELECT 1 FROM "Animal" WHERE "currentCageId" = NEW."cageId") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cage closure cannot retain assigned animals.';
  END IF;
  IF jsonb_typeof(review_payload #> '{command,assignments}') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Cage closure movements do not match the immutable reviewed assignment plan.';
  END IF;
  IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(review_payload #> '{command,assignments}') assignment
      WHERE NOT EXISTS (
        SELECT 1
        FROM "AnimalMovement" movement
        JOIN "Animal" animal ON animal.id = movement."animalId"
        JOIN "Cage" destination ON destination.id = movement."toCageId"
        WHERE movement."animalId" = assignment ->> 'animalId'
          AND movement."fromCageId" = NEW."cageId"
          AND movement."toCageId" = assignment ->> 'toCageId'
          AND movement."movedById" = NEW."closedById"
          AND movement."movedAt" = NEW."closedAt"
          AND movement.reason = 'Cage closure: ' || BTRIM(NEW.reason)
          AND animal."currentCageId" = movement."toCageId"
          AND animal."owningLabId" = NEW."labId"
          AND destination."labId" = NEW."labId"
          AND destination.active
          AND destination.status NOT IN ('closed', 'retired')
          AND NOT EXISTS (SELECT 1 FROM "CageClosure" closed_destination WHERE closed_destination."cageId" = destination.id)
      )
    ) OR (
      SELECT COUNT(*)
      FROM "AnimalMovement" movement
      WHERE movement."fromCageId" = NEW."cageId"
        AND movement."movedById" = NEW."closedById"
        AND movement."movedAt" = NEW."closedAt"
        AND movement.reason = 'Cage closure: ' || BTRIM(NEW.reason)
    ) <> jsonb_array_length(review_payload #> '{command,assignments}')
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Cage closure movements do not match the immutable reviewed assignment plan.';
  END IF;

  SELECT "cageId", "labId", "categoryId", "dailyRateCents", "currencyCode", "startedAt", "endedAt"
  INTO period_cage_id, period_lab_id, period_category_id, period_daily_rate_cents, period_currency_code, period_started_at, period_ended_at
  FROM "CageChargePeriod"
  WHERE id = NEW."chargePeriodId"
  FOR UPDATE;

  IF period_cage_id IS NULL OR period_cage_id <> NEW."cageId" OR period_lab_id <> NEW."labId" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The cage closure must reference the cage''s final charge period.';
  END IF;
  IF review_payload #>> '{command,expectedChargeCategoryId}' IS DISTINCT FROM period_category_id
    OR (review_payload #>> '{command,expectedDailyRateCents}')::integer IS DISTINCT FROM period_daily_rate_cents
    OR review_payload #>> '{command,expectedCurrencyCode}' IS DISTINCT FROM period_currency_code
    OR ((review_payload #>> '{command,expectedChargePeriodStartedAt}')::timestamptz AT TIME ZONE 'UTC') IS DISTINCT FROM period_started_at
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The cage closure final charge period does not match its immutable financial review.';
  END IF;
  IF period_ended_at IS NULL OR period_ended_at <> NEW."billingCutoffAt" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The final charge period must end at the immutable cage billing cutoff.';
  END IF;
  IF period_started_at > NEW."billingCutoffAt" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cage billing cutoff cannot predate its final charge period.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "CageChargePeriod"
    WHERE "cageId" = NEW."cageId"
      AND ("endedAt" IS NULL OR "startedAt" > NEW."billingCutoffAt" OR "endedAt" > NEW."billingCutoffAt")
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'All cage charge periods must end on or before the closure billing cutoff.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "InvoiceLineItem" line
    JOIN "Invoice" invoice ON invoice.id = line."invoiceId"
    JOIN "CageChargePeriod" period ON period.id = line."chargePeriodId"
    WHERE period."cageId" = NEW."cageId"
      AND invoice.status IN ('draft', 'finalized')
      AND line."serviceEnd" > NEW."billingCutoffAt"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Draft or finalized invoice service extends beyond the cage billing cutoff.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "CageClosure_insert_guard"
BEFORE INSERT ON "CageClosure"
FOR EACH ROW EXECUTE FUNCTION "validate_cage_closure_insert"();

CREATE FUNCTION "protect_cage_closure_history"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Cage closures are append-only.' USING ERRCODE = '23514';
END $$;

CREATE TRIGGER "CageClosure_append_only"
BEFORE UPDATE OR DELETE ON "CageClosure"
FOR EACH ROW EXECUTE FUNCTION "protect_cage_closure_history"();

CREATE FUNCTION "protect_closed_cage_billing_history"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_cage_id TEXT;
  previous_cage_id TEXT;
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  target_cage_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."cageId" ELSE NEW."cageId" END;
  previous_cage_id := CASE WHEN TG_OP = 'UPDATE' THEN OLD."cageId" ELSE NULL END;

  PERFORM cage.id
  FROM "Cage" cage
  WHERE cage.id IN (target_cage_id, previous_cage_id)
  ORDER BY cage.id
  FOR UPDATE;

  IF (
    (TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM "CageClosure" WHERE "cageId" = NEW."cageId"))
    OR (TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM "CageClosure" WHERE "cageId" = OLD."cageId"))
    OR (
      TG_OP = 'UPDATE'
      AND EXISTS (SELECT 1 FROM "CageClosure" WHERE "cageId" IN (OLD."cageId", NEW."cageId"))
    )
  ) THEN
    RAISE EXCEPTION 'Charge periods for a closed cage are immutable.' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1
    FROM "InvoiceLineItem" line
    JOIN "Invoice" invoice ON invoice.id = line."invoiceId"
    WHERE line."chargePeriodId" = OLD.id
      AND invoice.status IN ('finalized', 'void')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Charge periods referenced by terminal invoices cannot be deleted.';
  END IF;

  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1
    FROM "InvoiceLineItem" line
    JOIN "Invoice" invoice ON invoice.id = line."invoiceId"
    WHERE line."chargePeriodId" = OLD.id
      AND invoice.status IN ('finalized', 'void')
      AND (
        NEW.id IS DISTINCT FROM OLD.id
        OR NEW."cageId" <> line."cageId"
        OR NEW."labId" <> invoice."labId"
        OR NEW."categoryId" <> line."categoryId"
        OR NEW."dailyRateCents" <> line."dailyRateCents"
        OR NEW."currencyCode" <> invoice."currencyCode"
        OR NEW."startedAt" > line."serviceStart"
        OR (NEW."endedAt" IS NOT NULL AND NEW."endedAt" < line."serviceEnd")
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = 'Charge-period changes cannot invalidate terminal invoice service history.';
  END IF;

  IF TG_OP <> 'DELETE' AND EXISTS (
    SELECT 1
    FROM "CageChargePeriod" period
    WHERE period."cageId" = NEW."cageId"
      AND period.id <> NEW.id
      AND period."startedAt" < COALESCE(NEW."endedAt", 'infinity'::timestamp)
      AND NEW."startedAt" < COALESCE(period."endedAt", 'infinity'::timestamp)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Cage charge periods cannot overlap.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER "CageChargePeriod_closed_cage_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "CageChargePeriod"
FOR EACH ROW EXECUTE FUNCTION "protect_closed_cage_billing_history"();

CREATE FUNCTION "protect_closed_cage_movement_history"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  affected_cage_ids TEXT[];
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  affected_cage_ids := CASE
    WHEN TG_OP = 'INSERT' THEN ARRAY[NEW."fromCageId", NEW."toCageId"]
    WHEN TG_OP = 'DELETE' THEN ARRAY[OLD."fromCageId", OLD."toCageId"]
    ELSE ARRAY[OLD."fromCageId", OLD."toCageId", NEW."fromCageId", NEW."toCageId"]
  END;

  PERFORM cage.id
  FROM "Cage" cage
  WHERE cage.id = ANY(affected_cage_ids)
  ORDER BY cage.id
  FOR UPDATE;

  IF (
    (TG_OP = 'INSERT' AND EXISTS (
      SELECT 1 FROM "CageClosure" WHERE "cageId" IN (NEW."fromCageId", NEW."toCageId")
    ))
    OR (TG_OP = 'DELETE' AND EXISTS (
      SELECT 1 FROM "CageClosure" WHERE "cageId" IN (OLD."fromCageId", OLD."toCageId")
    ))
    OR (TG_OP = 'UPDATE' AND EXISTS (
      SELECT 1 FROM "CageClosure" WHERE "cageId" IN (
        OLD."fromCageId", OLD."toCageId", NEW."fromCageId", NEW."toCageId"
      )
    ))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Movement history linked to a closed cage is immutable.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER "AnimalMovement_closed_cage_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "AnimalMovement"
FOR EACH ROW EXECUTE FUNCTION "protect_closed_cage_movement_history"();

CREATE FUNCTION "protect_closed_cage_reopening"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "CageClosure" WHERE "cageId" = OLD.id)
    AND (
      NEW.status <> 'closed'
      OR NEW.active
      OR NEW."labId" IS DISTINCT FROM OLD."labId"
      OR NEW."roomId" IS DISTINCT FROM OLD."roomId"
      OR NEW."rackId" IS DISTINCT FROM OLD."rackId"
      OR NEW."cageNumber" IS DISTINCT FROM OLD."cageNumber"
      OR NEW."capacityOverride" IS DISTINCT FROM OLD."capacityOverride"
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cage with an immutable closure record cannot be reopened or operationally reassigned.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Cage_closed_state_guard"
BEFORE UPDATE OF status, active, "labId", "roomId", "rackId", "cageNumber", "capacityOverride" ON "Cage"
FOR EACH ROW EXECUTE FUNCTION "protect_closed_cage_reopening"();

CREATE FUNCTION "require_explicit_cage_closure"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  current_status "CageStatus";
  current_active BOOLEAN;
BEGIN
  SELECT status, active INTO current_status, current_active
  FROM "Cage"
  WHERE id = NEW.id;

  IF current_status IS NULL THEN
    RETURN NULL;
  END IF;
  IF current_status = 'closed' AND NOT EXISTS (SELECT 1 FROM "CageClosure" WHERE "cageId" = NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Closed cage state requires an explicit cage closure record.';
  END IF;
  IF EXISTS (SELECT 1 FROM "CageClosure" WHERE "cageId" = NEW.id)
    AND (current_status <> 'closed' OR current_active) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cage with an immutable closure record must remain closed and inactive.';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "Cage_explicit_closure_required"
AFTER INSERT OR UPDATE ON "Cage"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "require_explicit_cage_closure"();

CREATE FUNCTION "validate_animal_active_cage_assignment"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  assigned_cage_id TEXT;
  animal_lab_id TEXT;
  cage_lab_id TEXT;
  cage_status "CageStatus";
  cage_active BOOLEAN;
BEGIN
  SELECT animal."currentCageId", animal."owningLabId"
  INTO assigned_cage_id, animal_lab_id
  FROM "Animal" animal
  WHERE animal.id = NEW.id;

  IF NOT FOUND OR assigned_cage_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT cage."labId", cage.status, cage.active
  INTO cage_lab_id, cage_status, cage_active
  FROM "Cage" cage
  WHERE cage.id = assigned_cage_id
  FOR UPDATE;
  IF cage_lab_id IS NULL
    OR animal_lab_id IS DISTINCT FROM cage_lab_id
    OR NOT cage_active
    OR cage_status IN ('closed', 'retired')
    OR EXISTS (SELECT 1 FROM "CageClosure" closure WHERE closure."cageId" = assigned_cage_id)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Animals can only be assigned to an active operational cage in their owning lab.';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "Animal_active_cage_assignment_guard"
AFTER INSERT OR UPDATE OF "currentCageId", "owningLabId" ON "Animal"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_animal_active_cage_assignment"();

CREATE FUNCTION "validate_open_charge_period_current_lab"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_cage_id TEXT;
BEGIN
  target_cage_id := CASE
    WHEN TG_TABLE_NAME = 'Cage' THEN to_jsonb(NEW) ->> 'id'
    ELSE to_jsonb(NEW) ->> 'cageId'
  END;

  PERFORM cage.id
  FROM "Cage" cage
  WHERE cage.id = target_cage_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM "CageChargePeriod" period
    JOIN "Cage" cage ON cage.id = period."cageId"
    WHERE period."cageId" = target_cage_id
      AND period."endedAt" IS NULL
      AND period."labId" <> cage."labId"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An open cage charge period must belong to the cage current lab.';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "CageChargePeriod_current_lab_guard"
AFTER INSERT OR UPDATE OF "cageId", "labId", "endedAt" ON "CageChargePeriod"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_open_charge_period_current_lab"();

CREATE CONSTRAINT TRIGGER "Cage_current_charge_lab_guard"
AFTER UPDATE OF "labId" ON "Cage"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_open_charge_period_current_lab"();

CREATE FUNCTION "validate_invoice_finalization_against_charge_periods"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status IN ('finalized', 'void') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoices must be created as drafts before a terminal billing state is recorded.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IN ('finalized', 'void') AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'finalized' THEN
      IF NEW."finalizedAt" IS NULL OR NEW."finalizedById" IS NULL
        OR NEW."voidedAt" IS NOT NULL OR NEW."voidedById" IS NOT NULL OR NEW."voidReason" IS NOT NULL
      THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice finalization requires its actor and timestamp without void metadata.';
      END IF;
      IF NEW."periodEnd" > NEW."finalizedAt" THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice service must be complete before finalization.';
      END IF;
    END IF;
    PERFORM period.id
    FROM "InvoiceLineItem" line
    JOIN "CageChargePeriod" period ON period.id = line."chargePeriodId"
    WHERE line."invoiceId" = NEW.id
    ORDER BY period.id
    FOR UPDATE OF period;
    IF NEW."periodEnd" <= NEW."periodStart" OR EXISTS (
      SELECT 1
      FROM "InvoiceLineItem" line
      JOIN "CageChargePeriod" period ON period.id = line."chargePeriodId"
      WHERE line."invoiceId" = NEW.id
        AND (
          period."labId" <> NEW."labId"
          OR period."cageId" <> line."cageId"
          OR period."categoryId" <> line."categoryId"
          OR period."dailyRateCents" <> line."dailyRateCents"
          OR period."currencyCode" <> NEW."currencyCode"
          OR line."serviceStart" < period."startedAt"
          OR (period."endedAt" IS NOT NULL AND line."serviceEnd" > period."endedAt")
          OR line."serviceStart" < NEW."periodStart"
          OR line."serviceEnd" > NEW."periodEnd"
          OR line."serviceEnd" <= line."serviceStart"
          OR line."dayCount" <= 0
          OR line."dayCount" <> CEIL(EXTRACT(EPOCH FROM (line."serviceEnd" - line."serviceStart")) / 86400.0)::integer
          OR line."dailyRateCents" < 0
          OR line."amountCents" <> line."dayCount" * line."dailyRateCents"
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice line items no longer match current cage charge periods; reconcile the draft before recording a terminal state.';
    END IF;
    IF NEW."subtotalCents" IS DISTINCT FROM COALESCE((
      SELECT SUM(line."amountCents")::integer
      FROM "InvoiceLineItem" line
      WHERE line."invoiceId" = NEW.id
    ), 0) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice subtotal does not match its immutable line-item calculation.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Invoice_charge_period_finalization_guard"
BEFORE INSERT OR UPDATE OF status ON "Invoice"
FOR EACH ROW EXECUTE FUNCTION "validate_invoice_finalization_against_charge_periods"();

CREATE FUNCTION "validate_invoice_line_write"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  old_invoice_id TEXT;
  new_invoice_id TEXT;
  target_invoice_status "InvoiceStatus";
  target_invoice_lab_id TEXT;
  target_invoice_currency_code TEXT;
  target_invoice_period_start TIMESTAMP(3);
  target_invoice_period_end TIMESTAMP(3);
  period_cage_id TEXT;
  period_lab_id TEXT;
  period_category_id TEXT;
  period_daily_rate_cents INTEGER;
  period_currency_code TEXT;
  period_started_at TIMESTAMP(3);
  period_ended_at TIMESTAMP(3);
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    old_invoice_id := OLD."invoiceId";
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    new_invoice_id := NEW."invoiceId";
  END IF;

  PERFORM invoice.id
  FROM "Invoice" invoice
  WHERE invoice.id IN (old_invoice_id, new_invoice_id)
  ORDER BY invoice.id
  FOR UPDATE OF invoice;

  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1 FROM "Invoice" WHERE id = old_invoice_id AND status IN ('finalized', 'void')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Finalized or void invoice line items are immutable.';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
    SELECT 1 FROM "Invoice" WHERE id = new_invoice_id AND status IN ('finalized', 'void')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Finalized or void invoice line items are immutable.';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status, "labId", "currencyCode", "periodStart", "periodEnd"
    INTO target_invoice_status, target_invoice_lab_id, target_invoice_currency_code,
      target_invoice_period_start, target_invoice_period_end
    FROM "Invoice"
    WHERE id = NEW."invoiceId";
    IF NOT FOUND OR target_invoice_status <> 'draft' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice lines require an existing mutable draft invoice.';
    END IF;

    SELECT "cageId", "labId", "categoryId", "dailyRateCents", "currencyCode", "startedAt", "endedAt"
    INTO period_cage_id, period_lab_id, period_category_id, period_daily_rate_cents,
      period_currency_code, period_started_at, period_ended_at
    FROM "CageChargePeriod"
    WHERE id = NEW."chargePeriodId"
    FOR UPDATE;
    IF NOT FOUND
      OR period_cage_id <> NEW."cageId"
      OR period_lab_id <> target_invoice_lab_id
      OR period_category_id <> NEW."categoryId"
      OR period_daily_rate_cents <> NEW."dailyRateCents"
      OR period_currency_code <> target_invoice_currency_code
      OR NEW."serviceStart" < period_started_at
      OR (period_ended_at IS NOT NULL AND NEW."serviceEnd" > period_ended_at)
      OR NEW."serviceStart" < target_invoice_period_start
      OR NEW."serviceEnd" > target_invoice_period_end
      OR NEW."serviceEnd" <= NEW."serviceStart"
      OR NEW."dayCount" <= 0
      OR NEW."dayCount" <> CEIL(EXTRACT(EPOCH FROM (NEW."serviceEnd" - NEW."serviceStart")) / 86400.0)::integer
      OR NEW."dailyRateCents" < 0
      OR NEW."amountCents" <> NEW."dayCount" * NEW."dailyRateCents"
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice line items must match their locked draft invoice and cage charge period.';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER "InvoiceLineItem_finalized_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLineItem"
FOR EACH ROW EXECUTE FUNCTION "validate_invoice_line_write"();

CREATE FUNCTION "protect_terminal_invoice_delete"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)' THEN
    RETURN OLD;
  END IF;
  IF OLD.status IN ('finalized', 'void') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Finalized or void invoices are append-only and cannot be deleted.';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER "Invoice_terminal_delete_guard"
BEFORE DELETE ON "Invoice"
FOR EACH ROW EXECUTE FUNCTION "protect_terminal_invoice_delete"();

CREATE FUNCTION "protect_finalized_invoice_state"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A void invoice is immutable.';
  END IF;
  IF OLD.status <> 'void' AND NEW.status = 'void' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW."invoiceNumber" IS DISTINCT FROM OLD."invoiceNumber"
    OR NEW."labId" IS DISTINCT FROM OLD."labId"
    OR NEW."periodStart" IS DISTINCT FROM OLD."periodStart"
    OR NEW."periodEnd" IS DISTINCT FROM OLD."periodEnd"
    OR NEW."currencyCode" IS DISTINCT FROM OLD."currencyCode"
    OR NEW."subtotalCents" IS DISTINCT FROM OLD."subtotalCents"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR (OLD.status = 'draft' AND (NEW."finalizedAt" IS NOT NULL OR NEW."finalizedById" IS NOT NULL))
    OR NEW."voidedAt" IS NULL
    OR NEW."voidedById" IS NULL
    OR LENGTH(BTRIM(COALESCE(NEW."voidReason", ''))) < 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Voiding requires an actor, timestamp, reason, and unchanged financial history.';
  END IF;
  IF OLD.status = 'finalized' AND (
    NEW.status <> 'void'
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW."invoiceNumber" IS DISTINCT FROM OLD."invoiceNumber"
    OR NEW."labId" IS DISTINCT FROM OLD."labId"
    OR NEW."periodStart" IS DISTINCT FROM OLD."periodStart"
    OR NEW."periodEnd" IS DISTINCT FROM OLD."periodEnd"
    OR NEW."currencyCode" IS DISTINCT FROM OLD."currencyCode"
    OR NEW."subtotalCents" IS DISTINCT FROM OLD."subtotalCents"
    OR NEW."finalizedAt" IS DISTINCT FROM OLD."finalizedAt"
    OR NEW."finalizedById" IS DISTINCT FROM OLD."finalizedById"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."voidedAt" IS NULL
    OR NEW."voidedById" IS NULL
    OR LENGTH(BTRIM(COALESCE(NEW."voidReason", ''))) < 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finalized invoice can only transition to void without changing its financial history.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "Invoice_finalized_state_guard"
BEFORE UPDATE ON "Invoice"
FOR EACH ROW EXECUTE FUNCTION "protect_finalized_invoice_state"();

COMMIT;
