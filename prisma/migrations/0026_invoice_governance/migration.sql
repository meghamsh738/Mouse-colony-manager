BEGIN;

LOCK TABLE "Invoice", "InvoiceLineItem", "CageChargePeriod", "CageChargeCategory"
  IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION "is_supported_billing_currency"(currency_code TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT currency_code = ANY (ARRAY[
    'AED','AFN','ALL','AMD','ANG','AOA','ARS','AUD','AWG','AZN',
    'BAM','BBD','BDT','BGN','BHD','BIF','BMD','BND','BOB','BRL',
    'BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHF','CLP','CNY',
    'COP','CRC','CUC','CUP','CVE','CZK','DJF','DKK','DOP','DZD',
    'EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP',
    'GMD','GNF','GTQ','GYD','HKD','HNL','HRK','HTG','HUF','IDR',
    'ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS',
    'KHR','KMF','KPW','KRW','KWD','KYD','KZT','LAK','LBP','LKR',
    'LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP',
    'MRU','MUR','MVR','MWK','MXN','MYR','MZN','NAD','NGN','NIO',
    'NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN',
    'PYG','QAR','RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG',
    'SEK','SGD','SHP','SLE','SLL','SOS','SRD','SSP','STN','SVC',
    'SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD',
    'TZS','UAH','UGX','USD','UYU','UZS','VES','VND','VUV','WST',
    'XAF','XCD','XCG','XDR','XOF','XPF','XSU','YER','ZAR','ZMW',
    'ZWG','ZWL'
  ]::TEXT[])
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CageChargePeriod"
    WHERE "startedAt" <> date_trunc('day', "startedAt")
      OR ("endedAt" IS NOT NULL AND (
        "endedAt" <= "startedAt"
        OR
        "endedAt" <> date_trunc('day', "endedAt")
        OR EXTRACT(EPOCH FROM ("endedAt" - "startedAt"))::bigint % 86400 <> 0
      ))
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Cage charge periods with fractional UTC service days must be reconciled before invoice governance can continue.';
  END IF;

  IF EXISTS (SELECT 1 FROM "CageChargeCategory" WHERE NOT "is_supported_billing_currency"("currencyCode"))
    OR EXISTS (SELECT 1 FROM "CageChargePeriod" WHERE NOT "is_supported_billing_currency"("currencyCode"))
    OR EXISTS (SELECT 1 FROM "Invoice" WHERE NOT "is_supported_billing_currency"("currencyCode"))
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Billing currency codes must use three uppercase ISO-style letters before invoice governance can continue.';
  END IF;
END
$$;

ALTER TABLE "CageChargeCategory"
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "CageChargeCategory_currency_code_format_check" CHECK ("is_supported_billing_currency"("currencyCode"));

ALTER TABLE "CageChargePeriod"
  DROP CONSTRAINT "CageChargePeriod_date_order_check",
  ADD CONSTRAINT "CageChargePeriod_date_order_check" CHECK ("endedAt" IS NULL OR "endedAt" > "startedAt"),
  ADD CONSTRAINT "CageChargePeriod_currency_code_format_check" CHECK ("is_supported_billing_currency"("currencyCode"));

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_currency_code_format_check" CHECK ("is_supported_billing_currency"("currencyCode"));

UPDATE "InvoiceLineItem" line
SET description = category.name || ' [' || category.code || ']'
FROM "CageChargeCategory" category
WHERE category.id = line."categoryId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "InvoiceLineItem"
    WHERE "serviceStart" <> date_trunc('day', "serviceStart")
      OR "serviceEnd" <> date_trunc('day', "serviceEnd")
      OR EXTRACT(EPOCH FROM ("serviceEnd" - "serviceStart"))::bigint % 86400 <> 0
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Invoice line items with fractional UTC service days must be reconciled before invoice governance can continue.';
  END IF;
END
$$;

CREATE TYPE "InvoiceAdjustmentType" AS ENUM ('debit', 'credit');

ALTER TABLE "Invoice"
  ADD COLUMN "finalNumber" TEXT,
  ADD COLUMN "adjustmentTotalCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalCents" INTEGER NOT NULL DEFAULT 0;

UPDATE "Invoice"
SET "totalCents" = "subtotalCents";

CREATE SEQUENCE "InvoiceFinalNumber_seq" AS BIGINT MINVALUE 1 START WITH 1 INCREMENT BY 1 NO CYCLE;

WITH terminal AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      ORDER BY COALESCE("finalizedAt", "voidedAt", "createdAt"), id
    ) AS sequence_value,
    EXTRACT(YEAR FROM COALESCE("finalizedAt", "voidedAt", "createdAt"))::integer AS sequence_year
  FROM "Invoice"
  WHERE "finalizedAt" IS NOT NULL
)
UPDATE "Invoice" invoice
SET "finalNumber" = 'INV-' || terminal.sequence_year::text || '-' || LPAD(terminal.sequence_value::text, 6, '0')
FROM terminal
WHERE invoice.id = terminal.id;

SELECT setval(
  '"InvoiceFinalNumber_seq"',
  GREATEST((SELECT COUNT(*) FROM "Invoice" WHERE "finalNumber" IS NOT NULL), 1),
  EXISTS (SELECT 1 FROM "Invoice" WHERE "finalNumber" IS NOT NULL)
);

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_finalNumber_key" UNIQUE ("finalNumber"),
  ADD CONSTRAINT "Invoice_adjustment_total_check" CHECK ("totalCents" = "subtotalCents" + "adjustmentTotalCents"),
  ADD CONSTRAINT "Invoice_nonnegative_total_check" CHECK ("totalCents" >= 0),
  ADD CONSTRAINT "Invoice_final_number_format_check" CHECK (
    "finalNumber" IS NULL OR "finalNumber" ~ '^INV-[0-9]{4}-[0-9]{6,}$'
  ),
  ADD CONSTRAINT "Invoice_final_number_state_check" CHECK (
    (status = 'draft' AND "finalNumber" IS NULL)
    OR (status = 'finalized' AND "finalNumber" IS NOT NULL)
    OR (status = 'void' AND (
      ("finalizedAt" IS NULL AND "finalNumber" IS NULL)
      OR ("finalizedAt" IS NOT NULL AND "finalNumber" IS NOT NULL)
    ))
  );

CREATE TABLE "InvoiceAdjustment" (
  id TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "adjustmentType" "InvoiceAdjustmentType" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  reason TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "reversesAdjustmentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InvoiceAdjustment_pkey" PRIMARY KEY (id),
  CONSTRAINT "InvoiceAdjustment_positive_amount_check" CHECK ("amountCents" > 0),
  CONSTRAINT "InvoiceAdjustment_reason_required_check" CHECK (LENGTH(BTRIM(reason)) > 0)
);

CREATE UNIQUE INDEX "InvoiceAdjustment_reversesAdjustmentId_key"
  ON "InvoiceAdjustment"("reversesAdjustmentId");
CREATE INDEX "InvoiceAdjustment_invoiceId_createdAt_idx"
  ON "InvoiceAdjustment"("invoiceId", "createdAt");
CREATE INDEX "InvoiceAdjustment_labId_createdAt_idx"
  ON "InvoiceAdjustment"("labId", "createdAt");
CREATE INDEX "InvoiceAdjustment_createdById_createdAt_idx"
  ON "InvoiceAdjustment"("createdById", "createdAt");

ALTER TABLE "InvoiceAdjustment"
  ADD CONSTRAINT "InvoiceAdjustment_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InvoiceAdjustment_labId_fkey"
    FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InvoiceAdjustment_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InvoiceAdjustment_reversesAdjustmentId_fkey"
    FOREIGN KEY ("reversesAdjustmentId") REFERENCES "InvoiceAdjustment"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_charge_period_utc_boundaries"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."startedAt" <> date_trunc('day', NEW."startedAt")
    OR (NEW."endedAt" IS NOT NULL AND (
      NEW."endedAt" <= NEW."startedAt"
      OR
      NEW."endedAt" <> date_trunc('day', NEW."endedAt")
      OR EXTRACT(EPOCH FROM (NEW."endedAt" - NEW."startedAt"))::bigint % 86400 <> 0
    ))
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Cage charge periods must use exact UTC calendar-day boundaries.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "CageChargePeriod_utc_boundary_guard"
BEFORE INSERT OR UPDATE ON "CageChargePeriod"
FOR EACH ROW EXECUTE FUNCTION "validate_charge_period_utc_boundaries"();

CREATE FUNCTION "protect_charge_period_append_only_history"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Cage charge periods are append-only and cannot be deleted.';
  END IF;
  IF OLD."endedAt" IS NOT NULL
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW."cageId" IS DISTINCT FROM OLD."cageId"
    OR NEW."labId" IS DISTINCT FROM OLD."labId"
    OR NEW."categoryId" IS DISTINCT FROM OLD."categoryId"
    OR NEW."dailyRateCents" IS DISTINCT FROM OLD."dailyRateCents"
    OR NEW."currencyCode" IS DISTINCT FROM OLD."currencyCode"
    OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
    OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW."endedAt" IS NULL
    OR NEW."endedAt" <= OLD."startedAt"
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A cage charge period may only be closed once; corrections require a replacement period.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "CageChargePeriod_append_only_guard"
BEFORE UPDATE OR DELETE ON "CageChargePeriod"
FOR EACH ROW EXECUTE FUNCTION "protect_charge_period_append_only_history"();

CREATE FUNCTION "protect_charge_period_truncate"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Cage charge period history cannot be truncated.';
END $$;

CREATE TRIGGER "CageChargePeriod_truncate_guard"
BEFORE TRUNCATE ON "CageChargePeriod"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_charge_period_truncate"();

CREATE FUNCTION "validate_invoice_adjustment_write"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  invoice_row "Invoice"%ROWTYPE;
  reversed_row "InvoiceAdjustment"%ROWTYPE;
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice adjustments are append-only; record an opposite adjustment instead.';
  END IF;

  SELECT * INTO invoice_row
  FROM "Invoice"
  WHERE id = NEW."invoiceId"
  FOR UPDATE;

  IF invoice_row.id IS NULL
    OR invoice_row.status <> 'draft'
    OR invoice_row."labId" <> NEW."labId"
    OR NEW."amountCents" <= 0
    OR LENGTH(BTRIM(NEW.reason)) < 1
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Adjustments require a matching mutable draft invoice, positive amount, and reason.';
  END IF;

  IF NEW."reversesAdjustmentId" IS NOT NULL THEN
    SELECT * INTO reversed_row
    FROM "InvoiceAdjustment"
    WHERE id = NEW."reversesAdjustmentId"
    FOR UPDATE;

    IF reversed_row.id IS NULL
      OR reversed_row."invoiceId" <> NEW."invoiceId"
      OR reversed_row."labId" <> NEW."labId"
      OR reversed_row."amountCents" <> NEW."amountCents"
      OR reversed_row."adjustmentType" = NEW."adjustmentType"
      OR reversed_row."reversesAdjustmentId" IS NOT NULL
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An adjustment reversal must exactly offset one original adjustment on the same draft.';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "InvoiceAdjustment_append_only_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceAdjustment"
FOR EACH ROW EXECUTE FUNCTION "validate_invoice_adjustment_write"();

CREATE FUNCTION "protect_invoice_adjustment_truncate"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice adjustment history cannot be truncated.';
END $$;

CREATE TRIGGER "InvoiceAdjustment_truncate_guard"
BEFORE TRUNCATE ON "InvoiceAdjustment"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_invoice_adjustment_truncate"();

CREATE FUNCTION "validate_invoice_financial_totals"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_invoice_id TEXT;
  invoice_row "Invoice"%ROWTYPE;
  calculated_subtotal INTEGER;
  calculated_adjustments INTEGER;
BEGIN
  target_invoice_id := CASE
    WHEN TG_TABLE_NAME = 'Invoice' THEN COALESCE(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id')
    ELSE COALESCE(to_jsonb(NEW) ->> 'invoiceId', to_jsonb(OLD) ->> 'invoiceId')
  END;

  SELECT * INTO invoice_row FROM "Invoice" WHERE id = target_invoice_id;
  IF invoice_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM("amountCents"), 0)::integer
  INTO calculated_subtotal
  FROM "InvoiceLineItem"
  WHERE "invoiceId" = target_invoice_id;

  SELECT COALESCE(SUM(
    CASE WHEN "adjustmentType" = 'debit' THEN "amountCents" ELSE -"amountCents" END
  ), 0)::integer
  INTO calculated_adjustments
  FROM "InvoiceAdjustment"
  WHERE "invoiceId" = target_invoice_id;

  IF invoice_row."subtotalCents" IS DISTINCT FROM calculated_subtotal
    OR invoice_row."adjustmentTotalCents" IS DISTINCT FROM calculated_adjustments
    OR invoice_row."totalCents" IS DISTINCT FROM calculated_subtotal + calculated_adjustments
    OR invoice_row."totalCents" < 0
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice totals must equal immutable line items plus append-only adjustments.';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "Invoice_financial_totals_guard"
AFTER INSERT OR UPDATE ON "Invoice"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_invoice_financial_totals"();

CREATE CONSTRAINT TRIGGER "InvoiceLineItem_financial_totals_guard"
AFTER INSERT OR UPDATE OR DELETE ON "InvoiceLineItem"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_invoice_financial_totals"();

CREATE CONSTRAINT TRIGGER "InvoiceAdjustment_financial_totals_guard"
AFTER INSERT OR UPDATE OR DELETE ON "InvoiceAdjustment"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "validate_invoice_financial_totals"();

CREATE OR REPLACE FUNCTION "validate_invoice_line_write"()
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

  IF TG_OP IN ('UPDATE', 'DELETE') THEN old_invoice_id := OLD."invoiceId"; END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN new_invoice_id := NEW."invoiceId"; END IF;

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
      OR NEW."serviceStart" <> date_trunc('day', NEW."serviceStart")
      OR NEW."serviceEnd" <> date_trunc('day', NEW."serviceEnd")
      OR EXTRACT(EPOCH FROM (NEW."serviceEnd" - NEW."serviceStart"))::bigint % 86400 <> 0
      OR NEW."dayCount" <= 0
      OR NEW."dayCount" <> EXTRACT(EPOCH FROM (NEW."serviceEnd" - NEW."serviceStart"))::bigint / 86400
      OR NEW."dailyRateCents" < 0
      OR NEW."amountCents" <> NEW."dayCount" * NEW."dailyRateCents"
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice line items must use exact UTC calendar days and match their locked draft and charge period.';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE OR REPLACE FUNCTION "validate_invoice_finalization_against_charge_periods"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  calculated_adjustments INTEGER;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status IN ('finalized', 'void') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoices must be created as drafts before a terminal billing state is recorded.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IN ('finalized', 'void') AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'finalized' THEN
      IF NEW."finalizedAt" IS NULL OR NEW."finalizedById" IS NULL
        OR NEW."finalNumber" IS NULL
        OR NEW."voidedAt" IS NOT NULL OR NEW."voidedById" IS NOT NULL OR NEW."voidReason" IS NOT NULL
      THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice finalization requires a final number, actor, and timestamp without void metadata.';
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
          OR line."serviceStart" <> date_trunc('day', line."serviceStart")
          OR line."serviceEnd" <> date_trunc('day', line."serviceEnd")
          OR EXTRACT(EPOCH FROM (line."serviceEnd" - line."serviceStart"))::bigint % 86400 <> 0
          OR line."dayCount" <= 0
          OR line."dayCount" <> EXTRACT(EPOCH FROM (line."serviceEnd" - line."serviceStart"))::bigint / 86400
          OR line."dailyRateCents" < 0
          OR line."amountCents" <> line."dayCount" * line."dailyRateCents"
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice line items no longer match exact UTC cage charge periods; reconcile the draft before recording a terminal state.';
    END IF;
    IF NEW."subtotalCents" IS DISTINCT FROM COALESCE((
      SELECT SUM(line."amountCents")::integer
      FROM "InvoiceLineItem" line
      WHERE line."invoiceId" = NEW.id
    ), 0) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice subtotal does not match its immutable line-item calculation.';
    END IF;
    SELECT COALESCE(SUM(
      CASE WHEN "adjustmentType" = 'debit' THEN "amountCents" ELSE -"amountCents" END
    ), 0)::integer
    INTO calculated_adjustments
    FROM "InvoiceAdjustment"
    WHERE "invoiceId" = NEW.id;
    IF NEW."adjustmentTotalCents" IS DISTINCT FROM calculated_adjustments
      OR NEW."totalCents" IS DISTINCT FROM NEW."subtotalCents" + calculated_adjustments
      OR NEW."totalCents" < 0
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invoice total does not match its append-only adjustments.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "protect_finalized_invoice_state"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A void invoice is immutable.';
  END IF;
  IF OLD."finalNumber" IS NOT NULL AND NEW."finalNumber" IS DISTINCT FROM OLD."finalNumber" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A final invoice number is immutable.';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'finalized' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW."invoiceNumber" IS DISTINCT FROM OLD."invoiceNumber"
    OR NEW."labId" IS DISTINCT FROM OLD."labId"
    OR NEW."periodStart" IS DISTINCT FROM OLD."periodStart"
    OR NEW."periodEnd" IS DISTINCT FROM OLD."periodEnd"
    OR NEW."currencyCode" IS DISTINCT FROM OLD."currencyCode"
    OR NEW."subtotalCents" IS DISTINCT FROM OLD."subtotalCents"
    OR NEW."adjustmentTotalCents" IS DISTINCT FROM OLD."adjustmentTotalCents"
    OR NEW."totalCents" IS DISTINCT FROM OLD."totalCents"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW.version <> OLD.version + 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Finalization may only assign terminal metadata and the next immutable invoice version.';
  END IF;
  IF OLD.status <> 'void' AND NEW.status = 'void' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW."invoiceNumber" IS DISTINCT FROM OLD."invoiceNumber"
    OR NEW."labId" IS DISTINCT FROM OLD."labId"
    OR NEW."periodStart" IS DISTINCT FROM OLD."periodStart"
    OR NEW."periodEnd" IS DISTINCT FROM OLD."periodEnd"
    OR NEW."currencyCode" IS DISTINCT FROM OLD."currencyCode"
    OR NEW."subtotalCents" IS DISTINCT FROM OLD."subtotalCents"
    OR NEW."adjustmentTotalCents" IS DISTINCT FROM OLD."adjustmentTotalCents"
    OR NEW."totalCents" IS DISTINCT FROM OLD."totalCents"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR (OLD.status = 'draft' AND (NEW."finalizedAt" IS NOT NULL OR NEW."finalizedById" IS NOT NULL OR NEW."finalNumber" IS NOT NULL))
    OR NEW."voidedAt" IS NULL
    OR NEW."voidedById" IS NULL
    OR LENGTH(BTRIM(COALESCE(NEW."voidReason", ''))) < 1
    OR NEW.version <> OLD.version + 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Voiding requires an actor, timestamp, reason, next version, and unchanged financial history.';
  END IF;
  IF OLD.status = 'finalized' AND (
    NEW.status <> 'void'
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW."invoiceNumber" IS DISTINCT FROM OLD."invoiceNumber"
    OR NEW."finalNumber" IS DISTINCT FROM OLD."finalNumber"
    OR NEW."labId" IS DISTINCT FROM OLD."labId"
    OR NEW."periodStart" IS DISTINCT FROM OLD."periodStart"
    OR NEW."periodEnd" IS DISTINCT FROM OLD."periodEnd"
    OR NEW."currencyCode" IS DISTINCT FROM OLD."currencyCode"
    OR NEW."subtotalCents" IS DISTINCT FROM OLD."subtotalCents"
    OR NEW."adjustmentTotalCents" IS DISTINCT FROM OLD."adjustmentTotalCents"
    OR NEW."totalCents" IS DISTINCT FROM OLD."totalCents"
    OR NEW."finalizedAt" IS DISTINCT FROM OLD."finalizedAt"
    OR NEW."finalizedById" IS DISTINCT FROM OLD."finalizedById"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR NEW."voidedAt" IS NULL
    OR NEW."voidedById" IS NULL
    OR LENGTH(BTRIM(COALESCE(NEW."voidReason", ''))) < 1
    OR NEW.version <> OLD.version + 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A finalized invoice can only transition to void without changing its financial history.';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
