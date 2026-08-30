BEGIN;

CREATE TYPE "WelfareCaseSubjectType" AS ENUM ('animal', 'cage');
CREATE TYPE "WelfareCaseStatus" AS ENUM ('open', 'triaged', 'under_observation', 'treatment_ordered', 'escalated', 'closed', 'cancelled');
CREATE TYPE "WelfareTreatmentOrderStatus" AS ENUM ('proposed', 'approved', 'active', 'stopped', 'completed', 'cancelled');
CREATE TYPE "WelfareAdministrationOutcome" AS ENUM ('administered', 'not_administered', 'error');
CREATE TYPE "WelfareEscalationStatus" AS ENUM ('open', 'acknowledged', 'resolved');
CREATE TYPE "WelfareCaseEventType" AS ENUM (
  'opened', 'triaged', 'observation_recorded', 'treatment_ordered', 'treatment_approved',
  'treatment_stopped', 'treatment_completed', 'administration_recorded',
  'escalated', 'escalation_acknowledged', 'escalation_resolved', 'closed', 'cancelled'
);

CREATE TABLE "WelfareCase" (
  id TEXT PRIMARY KEY,
  "labId" TEXT NOT NULL,
  "subjectType" "WelfareCaseSubjectType" NOT NULL,
  "animalId" TEXT,
  "cageId" TEXT,
  "reopenedFromCaseId" TEXT,
  status "WelfareCaseStatus" NOT NULL DEFAULT 'open',
  severity "AlertSeverity" NOT NULL,
  "operationalSummary" TEXT NOT NULL,
  "privateClinicalSummary" TEXT NOT NULL,
  "policyMarker" TEXT NOT NULL DEFAULT 'synthetic-fail-closed-v1',
  "openedAt" TIMESTAMPTZ(6) NOT NULL,
  "openedById" TEXT NOT NULL,
  "openedCommandReceiptId" TEXT NOT NULL UNIQUE,
  "lastCommandReceiptId" TEXT NOT NULL UNIQUE,
  "triagedAt" TIMESTAMPTZ(6),
  "triagedById" TEXT,
  "closedAt" TIMESTAMPTZ(6),
  "closedById" TEXT,
  "closureReason" TEXT,
  "cancelledAt" TIMESTAMPTZ(6),
  "cancelledById" TEXT,
  "cancellationCode" TEXT,
  "cancellationReason" TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "WelfareCase_subject_exactly_one_check" CHECK (
    ("subjectType" = 'animal' AND "animalId" IS NOT NULL AND "cageId" IS NULL)
    OR ("subjectType" = 'cage' AND "cageId" IS NOT NULL AND "animalId" IS NULL)
  ),
  CONSTRAINT "WelfareCase_policy_marker_check" CHECK ("policyMarker" = 'synthetic-fail-closed-v1'),
  CONSTRAINT "WelfareCase_terminal_metadata_check" CHECK (
    (status = 'closed' AND "closedAt" IS NOT NULL AND "closedById" IS NOT NULL AND "closureReason" IS NOT NULL
      AND "cancelledAt" IS NULL AND "cancelledById" IS NULL AND "cancellationCode" IS NULL AND "cancellationReason" IS NULL)
    OR (status = 'cancelled' AND "cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL
      AND "cancellationCode" IN ('duplicate', 'not_a_case') AND "cancellationReason" IS NOT NULL
      AND "closedAt" IS NULL AND "closedById" IS NULL AND "closureReason" IS NULL)
    OR (status NOT IN ('closed', 'cancelled') AND "closedAt" IS NULL AND "closedById" IS NULL AND "closureReason" IS NULL
      AND "cancelledAt" IS NULL AND "cancelledById" IS NULL AND "cancellationCode" IS NULL AND "cancellationReason" IS NULL)
  ),
  UNIQUE (id, "labId")
);

CREATE TABLE "WelfareObservation" (
  id TEXT PRIMARY KEY, "caseId" TEXT NOT NULL, "labId" TEXT NOT NULL,
  "observedAt" TIMESTAMPTZ(6) NOT NULL, severity "AlertSeverity" NOT NULL,
  "operationalCode" TEXT NOT NULL, "privateNote" TEXT NOT NULL, "observedById" TEXT NOT NULL,
  "commandReceiptId" TEXT NOT NULL UNIQUE, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "WelfareTreatmentOrder" (
  id TEXT PRIMARY KEY, "caseId" TEXT NOT NULL, "labId" TEXT NOT NULL,
  status "WelfareTreatmentOrderStatus" NOT NULL DEFAULT 'proposed',
  medication TEXT NOT NULL, dose TEXT NOT NULL, route TEXT NOT NULL, frequency TEXT NOT NULL, instructions TEXT NOT NULL,
  "proposedAt" TIMESTAMPTZ(6) NOT NULL, "proposedById" TEXT NOT NULL,
  "proposedCommandReceiptId" TEXT NOT NULL UNIQUE,
  "lastCommandReceiptId" TEXT NOT NULL UNIQUE,
  "approvedAt" TIMESTAMPTZ(6), "approvedById" TEXT,
  "stoppedAt" TIMESTAMPTZ(6), "stoppedById" TEXT, "stopReason" TEXT,
  "completedAt" TIMESTAMPTZ(6), version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "WelfareTreatmentOrder_state_metadata_check" CHECK (
    (status = 'proposed' AND "approvedAt" IS NULL AND "approvedById" IS NULL AND "stoppedAt" IS NULL AND "stoppedById" IS NULL AND "completedAt" IS NULL)
    OR (status IN ('approved', 'active') AND "approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL AND "stoppedAt" IS NULL AND "stoppedById" IS NULL AND "completedAt" IS NULL)
    OR (status IN ('stopped', 'cancelled') AND "stoppedAt" IS NOT NULL AND "stoppedById" IS NOT NULL AND "stopReason" IS NOT NULL AND "completedAt" IS NULL)
    OR (status = 'completed' AND "approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL AND "completedAt" IS NOT NULL AND "stoppedAt" IS NULL)
  ),
  UNIQUE (id, "caseId", "labId")
);

CREATE TABLE "WelfareAdministrationAttempt" (
  id TEXT PRIMARY KEY, "caseId" TEXT NOT NULL, "orderId" TEXT NOT NULL, "labId" TEXT NOT NULL,
  "administeredAt" TIMESTAMPTZ(6) NOT NULL, outcome "WelfareAdministrationOutcome" NOT NULL,
  "actualDose" TEXT, "privateNote" TEXT, "administeredById" TEXT NOT NULL,
  "commandReceiptId" TEXT NOT NULL UNIQUE, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WelfareAdministrationAttempt_dose_check" CHECK (
    (outcome = 'administered' AND "actualDose" IS NOT NULL) OR outcome <> 'administered'
  )
);

CREATE TABLE "WelfareEscalation" (
  id TEXT PRIMARY KEY, "caseId" TEXT NOT NULL, "labId" TEXT NOT NULL,
  severity "AlertSeverity" NOT NULL, status "WelfareEscalationStatus" NOT NULL DEFAULT 'open',
  "operationalCode" TEXT NOT NULL, "privateReason" TEXT NOT NULL,
  "openedAt" TIMESTAMPTZ(6) NOT NULL, "openedById" TEXT NOT NULL,
  "openedCommandReceiptId" TEXT NOT NULL UNIQUE,
  "lastCommandReceiptId" TEXT NOT NULL UNIQUE,
  "acknowledgedAt" TIMESTAMPTZ(6), "acknowledgedById" TEXT,
  "resolvedAt" TIMESTAMPTZ(6), "resolvedById" TEXT, "resolutionNote" TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "WelfareEscalation_state_metadata_check" CHECK (
    (status = 'open' AND "acknowledgedAt" IS NULL AND "acknowledgedById" IS NULL AND "resolvedAt" IS NULL AND "resolvedById" IS NULL)
    OR (status = 'acknowledged' AND "acknowledgedAt" IS NOT NULL AND "acknowledgedById" IS NOT NULL AND "resolvedAt" IS NULL AND "resolvedById" IS NULL)
    OR (status = 'resolved' AND "acknowledgedAt" IS NOT NULL AND "acknowledgedById" IS NOT NULL
      AND "resolvedAt" IS NOT NULL AND "resolvedById" IS NOT NULL AND "resolutionNote" IS NOT NULL)
  ),
  UNIQUE (id, "caseId", "labId")
);

CREATE TABLE "WelfareCaseLifecycleEvent" (
  id TEXT PRIMARY KEY, "caseId" TEXT NOT NULL, "labId" TEXT NOT NULL,
  "eventType" "WelfareCaseEventType" NOT NULL, "fromStatus" "WelfareCaseStatus", "toStatus" "WelfareCaseStatus" NOT NULL,
  "actorId" TEXT NOT NULL, "actorAuthzVersion" INTEGER NOT NULL,
  assurance "IdentityAssuranceLevel" NOT NULL,
  "dutyAssignmentId" TEXT NOT NULL, "dutyAssignmentVersion" INTEGER NOT NULL,
  "identityLinkId" TEXT NOT NULL, "authenticatedAt" TIMESTAMPTZ(6) NOT NULL,
  "commandReceiptId" TEXT NOT NULL UNIQUE, detail JSONB,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "WelfareCase" ADD CONSTRAINT "WelfareCase_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareCase" ADD CONSTRAINT "WelfareCase_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareCase" ADD CONSTRAINT "WelfareCase_cageId_fkey" FOREIGN KEY ("cageId") REFERENCES "Cage"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareCase" ADD CONSTRAINT "WelfareCase_reopenedFromCaseId_fkey" FOREIGN KEY ("reopenedFromCaseId") REFERENCES "WelfareCase"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareCase" ADD CONSTRAINT "WelfareCase_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareCase" ADD CONSTRAINT "WelfareCase_triagedById_fkey" FOREIGN KEY ("triagedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareCase" ADD CONSTRAINT "WelfareCase_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareCase" ADD CONSTRAINT "WelfareCase_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareCase" ADD CONSTRAINT "WelfareCase_openedCommandReceiptId_fkey" FOREIGN KEY ("openedCommandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareCase" ADD CONSTRAINT "WelfareCase_lastCommandReceiptId_fkey" FOREIGN KEY ("lastCommandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WelfareObservation" ADD CONSTRAINT "WelfareObservation_caseId_labId_fkey" FOREIGN KEY ("caseId", "labId") REFERENCES "WelfareCase"(id, "labId") ON DELETE RESTRICT;
ALTER TABLE "WelfareObservation" ADD CONSTRAINT "WelfareObservation_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareObservation" ADD CONSTRAINT "WelfareObservation_observedById_fkey" FOREIGN KEY ("observedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareObservation" ADD CONSTRAINT "WelfareObservation_commandReceiptId_fkey" FOREIGN KEY ("commandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WelfareTreatmentOrder" ADD CONSTRAINT "WelfareTreatmentOrder_caseId_labId_fkey" FOREIGN KEY ("caseId", "labId") REFERENCES "WelfareCase"(id, "labId") ON DELETE RESTRICT;
ALTER TABLE "WelfareTreatmentOrder" ADD CONSTRAINT "WelfareTreatmentOrder_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareTreatmentOrder" ADD CONSTRAINT "WelfareTreatmentOrder_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareTreatmentOrder" ADD CONSTRAINT "WelfareTreatmentOrder_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareTreatmentOrder" ADD CONSTRAINT "WelfareTreatmentOrder_stoppedById_fkey" FOREIGN KEY ("stoppedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareTreatmentOrder" ADD CONSTRAINT "WelfareTreatmentOrder_proposedCommandReceiptId_fkey" FOREIGN KEY ("proposedCommandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareTreatmentOrder" ADD CONSTRAINT "WelfareTreatmentOrder_lastCommandReceiptId_fkey" FOREIGN KEY ("lastCommandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WelfareAdministrationAttempt" ADD CONSTRAINT "WelfareAdministrationAttempt_caseId_labId_fkey" FOREIGN KEY ("caseId", "labId") REFERENCES "WelfareCase"(id, "labId") ON DELETE RESTRICT;
ALTER TABLE "WelfareAdministrationAttempt" ADD CONSTRAINT "WelfareAdministrationAttempt_orderId_caseId_labId_fkey" FOREIGN KEY ("orderId", "caseId", "labId") REFERENCES "WelfareTreatmentOrder"(id, "caseId", "labId") ON DELETE RESTRICT;
ALTER TABLE "WelfareAdministrationAttempt" ADD CONSTRAINT "WelfareAdministrationAttempt_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareAdministrationAttempt" ADD CONSTRAINT "WelfareAdministrationAttempt_administeredById_fkey" FOREIGN KEY ("administeredById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareAdministrationAttempt" ADD CONSTRAINT "WelfareAdministrationAttempt_commandReceiptId_fkey" FOREIGN KEY ("commandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WelfareEscalation" ADD CONSTRAINT "WelfareEscalation_caseId_labId_fkey" FOREIGN KEY ("caseId", "labId") REFERENCES "WelfareCase"(id, "labId") ON DELETE RESTRICT;
ALTER TABLE "WelfareEscalation" ADD CONSTRAINT "WelfareEscalation_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareEscalation" ADD CONSTRAINT "WelfareEscalation_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareEscalation" ADD CONSTRAINT "WelfareEscalation_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareEscalation" ADD CONSTRAINT "WelfareEscalation_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareEscalation" ADD CONSTRAINT "WelfareEscalation_openedCommandReceiptId_fkey" FOREIGN KEY ("openedCommandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareEscalation" ADD CONSTRAINT "WelfareEscalation_lastCommandReceiptId_fkey" FOREIGN KEY ("lastCommandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WelfareCaseLifecycleEvent" ADD CONSTRAINT "WelfareCaseLifecycleEvent_caseId_labId_fkey" FOREIGN KEY ("caseId", "labId") REFERENCES "WelfareCase"(id, "labId") ON DELETE RESTRICT;
ALTER TABLE "WelfareCaseLifecycleEvent" ADD CONSTRAINT "WelfareCaseLifecycleEvent_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareCaseLifecycleEvent" ADD CONSTRAINT "WelfareCaseLifecycleEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareCaseLifecycleEvent" ADD CONSTRAINT "WelfareCaseLifecycleEvent_dutyAssignmentId_fkey" FOREIGN KEY ("dutyAssignmentId") REFERENCES "FacilityDutyAssignment"(id) ON DELETE RESTRICT;
ALTER TABLE "WelfareCaseLifecycleEvent" ADD CONSTRAINT "WelfareCaseLifecycleEvent_identityLinkId_fkey" FOREIGN KEY ("identityLinkId") REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WelfareCaseLifecycleEvent" ADD CONSTRAINT "WelfareCaseLifecycleEvent_commandReceiptId_fkey" FOREIGN KEY ("commandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "WelfareCase_active_animal_key" ON "WelfareCase"("animalId") WHERE "animalId" IS NOT NULL AND status NOT IN ('closed', 'cancelled');
CREATE UNIQUE INDEX "WelfareCase_active_cage_key" ON "WelfareCase"("cageId") WHERE "cageId" IS NOT NULL AND status NOT IN ('closed', 'cancelled');
CREATE INDEX "WelfareCase_labId_status_severity_idx" ON "WelfareCase"("labId", status, severity);
CREATE INDEX "WelfareCase_animalId_status_idx" ON "WelfareCase"("animalId", status);
CREATE INDEX "WelfareCase_cageId_status_idx" ON "WelfareCase"("cageId", status);
CREATE INDEX "WelfareCase_reopenedFromCaseId_idx" ON "WelfareCase"("reopenedFromCaseId");
CREATE INDEX "WelfareObservation_caseId_observedAt_idx" ON "WelfareObservation"("caseId", "observedAt");
CREATE INDEX "WelfareObservation_labId_severity_observedAt_idx" ON "WelfareObservation"("labId", severity, "observedAt");
CREATE INDEX "WelfareTreatmentOrder_caseId_status_idx" ON "WelfareTreatmentOrder"("caseId", status);
CREATE INDEX "WelfareTreatmentOrder_labId_status_idx" ON "WelfareTreatmentOrder"("labId", status);
CREATE INDEX "WelfareAdministrationAttempt_caseId_administeredAt_idx" ON "WelfareAdministrationAttempt"("caseId", "administeredAt");
CREATE INDEX "WelfareAdministrationAttempt_orderId_administeredAt_idx" ON "WelfareAdministrationAttempt"("orderId", "administeredAt");
CREATE INDEX "WelfareEscalation_caseId_status_severity_idx" ON "WelfareEscalation"("caseId", status, severity);
CREATE INDEX "WelfareEscalation_labId_status_severity_idx" ON "WelfareEscalation"("labId", status, severity);
CREATE INDEX "WelfareCaseLifecycleEvent_caseId_occurredAt_idx" ON "WelfareCaseLifecycleEvent"("caseId", "occurredAt");
CREATE INDEX "WelfareCaseLifecycleEvent_labId_occurredAt_idx" ON "WelfareCaseLifecycleEvent"("labId", "occurredAt");
CREATE INDEX "WelfareCaseLifecycleEvent_actorId_occurredAt_idx" ON "WelfareCaseLifecycleEvent"("actorId", "occurredAt");

CREATE OR REPLACE FUNCTION mcm_welfare_expected_command(event_type "WelfareCaseEventType", detail JSONB)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE event_type
    WHEN 'opened' THEN 'welfare.case.open'
    WHEN 'triaged' THEN 'welfare.case.triage'
    WHEN 'observation_recorded' THEN 'welfare.observation.record'
    WHEN 'treatment_ordered' THEN 'welfare.treatment.propose'
    WHEN 'treatment_approved' THEN 'welfare.treatment.approve'
    WHEN 'administration_recorded' THEN 'welfare.treatment.administer'
    WHEN 'treatment_stopped' THEN CASE WHEN COALESCE((detail->>'cancellation')::boolean, false)
      THEN 'welfare.treatment.cancel' ELSE 'welfare.treatment.stop' END
    WHEN 'treatment_completed' THEN 'welfare.treatment.complete'
    WHEN 'escalated' THEN 'welfare.escalation.open'
    WHEN 'escalation_acknowledged' THEN 'welfare.escalation.acknowledge'
    WHEN 'escalation_resolved' THEN 'welfare.escalation.resolve'
    WHEN 'closed' THEN 'welfare.case.close'
    WHEN 'cancelled' THEN 'welfare.case.cancel'
  END
$$;

CREATE OR REPLACE FUNCTION mcm_welfare_receipt_matches(target_case_id TEXT, target_lab_id TEXT, expected_command_type TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "CommandReceipt" receipt
    JOIN "User" actor ON actor.id = receipt."actorId"
    WHERE receipt.id = NULLIF(current_setting('mcm.audit_receipt_id', true), '')
      AND receipt.status = 'processing' AND receipt."completedAt" IS NULL
      AND receipt."transactionId" = txid_current()
      AND receipt."actorId" = NULLIF(current_setting('mcm.audit_actor_id', true), '')
      AND receipt."commandType" = NULLIF(current_setting('mcm.audit_command_type', true), '')
      AND receipt."requestHash" = NULLIF(current_setting('mcm.audit_request_hash', true), '')
      AND receipt."commandType" LIKE 'welfare.%'
      AND (expected_command_type IS NULL OR receipt."commandType" = expected_command_type)
      AND receipt."aggregateType" = 'welfare_case' AND receipt."aggregateId" = target_case_id
      AND receipt."labId" = target_lab_id
      AND actor.active AND actor.role <> 'it_head'::"UserRole"
      AND actor."authzVersion" = receipt."actorAuthzVersion"
  )
$$;

CREATE OR REPLACE FUNCTION mcm_welfare_receipt_has_current_duty(required_duty "FacilityDuty") RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "CommandReceipt" receipt
    JOIN "User" actor ON actor.id = receipt."actorId"
    JOIN "FacilityDutyAssignment" duty ON duty."userId" = receipt."actorId"
    WHERE receipt.id = NULLIF(current_setting('mcm.audit_receipt_id', true), '')
      AND receipt.status = 'processing' AND receipt."completedAt" IS NULL
      AND receipt."transactionId" = txid_current()
      AND receipt."actorId" = NULLIF(current_setting('mcm.audit_actor_id', true), '')
      AND actor.active AND actor."authzVersion" = receipt."actorAuthzVersion"
      AND duty.duty = required_duty
      AND duty."revokedAt" IS NULL AND duty."validFrom" <= CURRENT_TIMESTAMP AND duty."validUntil" > CURRENT_TIMESTAMP
  )
$$;

CREATE OR REPLACE FUNCTION mcm_welfare_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data JSONB := to_jsonb(NEW);
DECLARE bound_receipt TEXT := NULLIF(current_setting('mcm.audit_receipt_id', true), '');
DECLARE target_case_id TEXT := CASE WHEN TG_TABLE_NAME = 'WelfareCase' THEN row_data->>'id' ELSE row_data->>'caseId' END;
DECLARE target_lab_id TEXT := row_data->>'labId';
DECLARE receipt_field TEXT := CASE TG_TABLE_NAME
  WHEN 'WelfareCase' THEN row_data->>'openedCommandReceiptId'
  WHEN 'WelfareTreatmentOrder' THEN row_data->>'proposedCommandReceiptId'
  WHEN 'WelfareEscalation' THEN row_data->>'openedCommandReceiptId'
  ELSE row_data->>'commandReceiptId' END;
DECLARE row_actor_id TEXT := CASE TG_TABLE_NAME
  WHEN 'WelfareCase' THEN row_data->>'openedById'
  WHEN 'WelfareObservation' THEN row_data->>'observedById'
  WHEN 'WelfareTreatmentOrder' THEN row_data->>'proposedById'
  WHEN 'WelfareAdministrationAttempt' THEN row_data->>'administeredById'
  WHEN 'WelfareEscalation' THEN row_data->>'openedById'
  WHEN 'WelfareCaseLifecycleEvent' THEN row_data->>'actorId' END;
DECLARE expected_command TEXT := CASE TG_TABLE_NAME
  WHEN 'WelfareCase' THEN 'welfare.case.open'
  WHEN 'WelfareObservation' THEN 'welfare.observation.record'
  WHEN 'WelfareTreatmentOrder' THEN 'welfare.treatment.propose'
  WHEN 'WelfareAdministrationAttempt' THEN 'welfare.treatment.administer'
  WHEN 'WelfareEscalation' THEN 'welfare.escalation.open'
  WHEN 'WelfareCaseLifecycleEvent' THEN mcm_welfare_expected_command((row_data->>'eventType')::"WelfareCaseEventType", row_data->'detail') END;
BEGIN
  IF bound_receipt IS NULL OR receipt_field IS DISTINCT FROM bound_receipt
    OR NOT mcm_welfare_receipt_matches(target_case_id, target_lab_id, expected_command)
    OR row_actor_id IS DISTINCT FROM NULLIF(current_setting('mcm.audit_actor_id', true), '')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare write receipt, actor, command, aggregate, or lab mismatch'; END IF;
  IF TG_TABLE_NAME IN ('WelfareCase', 'WelfareTreatmentOrder', 'WelfareEscalation')
    AND row_data->>'lastCommandReceiptId' IS DISTINCT FROM bound_receipt
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare domain mutation receipt is mismatched'; END IF;
  IF TG_TABLE_NAME = 'WelfareCaseLifecycleEvent' AND (row_data->>'actorAuthzVersion')::integer IS DISTINCT FROM (
    SELECT receipt."actorAuthzVersion" FROM "CommandReceipt" receipt WHERE receipt.id = bound_receipt
  ) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare lifecycle actor authorization snapshot is mismatched'; END IF;
  IF TG_TABLE_NAME IN ('WelfareTreatmentOrder', 'WelfareAdministrationAttempt')
    AND NOT mcm_welfare_receipt_has_current_duty('designated_veterinarian')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare treatment writes require a current designated veterinarian receipt'; END IF;
  IF TG_TABLE_NAME = 'WelfareAdministrationAttempt' AND NOT EXISTS (
    SELECT 1 FROM "WelfareTreatmentOrder" treatment
    WHERE treatment.id = row_data->>'orderId' AND treatment."caseId" = target_case_id
      AND treatment."labId" = target_lab_id AND treatment.status IN ('approved', 'active')
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'administration requires an approved or active treatment order'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_case_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."subjectType" = 'animal' AND NOT EXISTS (
    SELECT 1 FROM "Animal" a WHERE a.id = NEW."animalId" AND a."owningLabId" = NEW."labId"
  ) THEN RAISE EXCEPTION 'welfare animal subject does not belong to case lab'; END IF;
  IF NEW."subjectType" = 'cage' AND NOT EXISTS (
    SELECT 1 FROM "Cage" c WHERE c.id = NEW."cageId" AND c."labId" = NEW."labId"
  ) THEN RAISE EXCEPTION 'welfare cage subject does not belong to case lab'; END IF;
  IF NEW."reopenedFromCaseId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "WelfareCase" prior WHERE prior.id = NEW."reopenedFromCaseId"
      AND prior.status IN ('closed', 'cancelled') AND prior."labId" = NEW."labId"
      AND prior."subjectType" = NEW."subjectType"
      AND prior."animalId" IS NOT DISTINCT FROM NEW."animalId"
      AND prior."cageId" IS NOT DISTINCT FROM NEW."cageId"
  ) THEN RAISE EXCEPTION 'reopened welfare case must link the same terminal subject'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_event_transition_valid(
  event_type "WelfareCaseEventType", from_status "WelfareCaseStatus", to_status "WelfareCaseStatus"
) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE event_type
    WHEN 'opened' THEN from_status IS NULL AND to_status = 'open'
    WHEN 'triaged' THEN from_status = 'open' AND to_status = 'triaged'
    WHEN 'observation_recorded' THEN
      (from_status IN ('open', 'triaged', 'under_observation') AND to_status = 'under_observation')
      OR (from_status IN ('treatment_ordered', 'escalated') AND to_status = from_status)
    WHEN 'treatment_ordered' THEN from_status IN ('triaged', 'under_observation', 'treatment_ordered', 'escalated')
      AND to_status = 'treatment_ordered'
    WHEN 'treatment_approved' THEN from_status = 'treatment_ordered' AND to_status = 'treatment_ordered'
    WHEN 'administration_recorded' THEN from_status = 'treatment_ordered' AND to_status = 'treatment_ordered'
    WHEN 'treatment_stopped' THEN from_status IN ('treatment_ordered', 'escalated')
      AND to_status IN ('under_observation', 'treatment_ordered')
    WHEN 'treatment_completed' THEN from_status IN ('treatment_ordered', 'escalated')
      AND to_status IN ('under_observation', 'treatment_ordered')
    WHEN 'escalated' THEN from_status IN ('open', 'triaged', 'under_observation', 'treatment_ordered', 'escalated')
      AND to_status = 'escalated'
    WHEN 'escalation_acknowledged' THEN from_status = 'escalated' AND to_status = 'escalated'
    WHEN 'escalation_resolved' THEN from_status = 'escalated'
      AND to_status IN ('under_observation', 'treatment_ordered')
    WHEN 'closed' THEN from_status IN ('under_observation', 'treatment_ordered', 'escalated') AND to_status = 'closed'
    WHEN 'cancelled' THEN from_status = 'open' AND to_status = 'cancelled'
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION mcm_welfare_event_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT mcm_welfare_event_transition_valid(NEW."eventType", NEW."fromStatus", NEW."toStatus")
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'welfare lifecycle event transition semantics are invalid'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "CommandReceipt" receipt
    JOIN "User" actor ON actor.id = NEW."actorId"
    JOIN "FacilityDutyAssignment" duty ON duty.id = NEW."dutyAssignmentId"
    WHERE receipt.id = NEW."commandReceiptId" AND receipt."actorId" = NEW."actorId"
      AND receipt.status = 'processing' AND receipt."transactionId" = txid_current()
      AND receipt."actorAuthzVersion" = NEW."actorAuthzVersion"
      AND actor.active AND actor."authzVersion" = NEW."actorAuthzVersion"
      AND duty.version = NEW."dutyAssignmentVersion" AND duty."userId" = NEW."actorId"
      AND duty.duty IN ('designated_veterinarian', 'welfare_officer')
      AND (NEW."eventType" IN ('opened', 'triaged', 'observation_recorded', 'escalated', 'escalation_acknowledged', 'cancelled')
        OR duty.duty = 'designated_veterinarian')
      AND duty."validFrom" <= CURRENT_TIMESTAMP AND duty."validUntil" > CURRENT_TIMESTAMP
      AND duty."revokedAt" IS NULL AND duty."validFrom" <= NEW."occurredAt" AND duty."validUntil" > NEW."occurredAt"
      AND "mcm_identity_assurance_snapshot_is_current"(
        NEW."actorId", NEW."identityLinkId", NEW.assurance, NEW."authenticatedAt", NEW."occurredAt"
      )
  ) THEN RAISE EXCEPTION 'welfare event evidence is stale or mismatched'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'welfare cases cannot be deleted'; END IF;
  IF NOT mcm_welfare_receipt_matches(NEW.id, NEW."labId", CASE
    WHEN NEW.status = 'triaged' THEN 'welfare.case.triage'
    WHEN NEW.status = 'closed' THEN 'welfare.case.close'
    WHEN NEW.status = 'cancelled' THEN 'welfare.case.cancel'
    ELSE NULL END)
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare case update receipt context is mismatched'; END IF;
  IF NEW."lastCommandReceiptId" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_receipt_id', true), '')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare case mutation receipt is mismatched'; END IF;
  IF NEW."labId" <> OLD."labId" OR NEW."subjectType" <> OLD."subjectType"
    OR NEW."animalId" IS DISTINCT FROM OLD."animalId" OR NEW."cageId" IS DISTINCT FROM OLD."cageId"
    OR NEW."reopenedFromCaseId" IS DISTINCT FROM OLD."reopenedFromCaseId"
    OR NEW."openedAt" <> OLD."openedAt" OR NEW."openedById" <> OLD."openedById"
    OR NEW."openedCommandReceiptId" <> OLD."openedCommandReceiptId" OR NEW."policyMarker" <> OLD."policyMarker"
    OR NEW.severity <> OLD.severity OR NEW."operationalSummary" <> OLD."operationalSummary"
    OR NEW."privateClinicalSummary" <> OLD."privateClinicalSummary"
    OR NEW.version <> OLD.version + 1 THEN RAISE EXCEPTION 'welfare case immutable fields or version changed'; END IF;
  IF OLD."triagedAt" IS NULL THEN
    IF NOT ((NEW."triagedAt" IS NULL AND NEW."triagedById" IS NULL)
      OR (OLD.status = 'open' AND NEW.status = 'triaged' AND NEW."triagedAt" IS NOT NULL AND NEW."triagedById" IS NOT NULL))
    THEN RAISE EXCEPTION 'welfare triage evidence may only be recorded once during triage'; END IF;
  ELSIF (NEW."triagedAt", NEW."triagedById") IS DISTINCT FROM (OLD."triagedAt", OLD."triagedById")
  THEN RAISE EXCEPTION 'welfare triage evidence is immutable'; END IF;
  IF NEW.status = 'triaged' AND NEW."triagedById" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_actor_id', true), '')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare triage actor is mismatched'; END IF;
  IF NEW.status = 'closed' AND NEW."closedById" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_actor_id', true), '')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare closure actor is mismatched'; END IF;
  IF NEW.status = 'cancelled' AND NEW."cancelledById" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_actor_id', true), '')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare cancellation actor is mismatched'; END IF;
  IF OLD.status IN ('closed', 'cancelled') THEN RAISE EXCEPTION 'terminal welfare cases are immutable'; END IF;
  IF NEW.status IN ('closed', 'cancelled') AND (
    EXISTS (SELECT 1 FROM "WelfareEscalation" escalation WHERE escalation."caseId" = OLD.id AND escalation.status <> 'resolved')
    OR EXISTS (SELECT 1 FROM "WelfareTreatmentOrder" treatment WHERE treatment."caseId" = OLD.id AND treatment.status IN ('proposed', 'approved', 'active'))
  ) THEN RAISE EXCEPTION 'terminal welfare cases require settled escalations and treatment orders'; END IF;
  IF NEW.status = 'cancelled' AND (OLD.status <> 'open' OR OLD."triagedAt" IS NOT NULL
    OR EXISTS (SELECT 1 FROM "WelfareObservation" observation WHERE observation."caseId" = OLD.id)
    OR EXISTS (SELECT 1 FROM "WelfareTreatmentOrder" treatment WHERE treatment."caseId" = OLD.id)
    OR EXISTS (SELECT 1 FROM "WelfareAdministrationAttempt" administration WHERE administration."caseId" = OLD.id)
    OR EXISTS (SELECT 1 FROM "WelfareEscalation" escalation WHERE escalation."caseId" = OLD.id))
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'only a pristine open untriaged welfare case can be cancelled'; END IF;
  IF NEW.status = 'closed' AND NOT mcm_welfare_receipt_has_current_duty('designated_veterinarian')
  THEN RAISE EXCEPTION 'welfare case closure requires a current designated veterinarian receipt'; END IF;
  IF NOT (
    (OLD.status = 'open' AND NEW.status IN ('triaged', 'under_observation', 'escalated', 'cancelled')) OR
    (OLD.status = 'triaged' AND NEW.status IN ('under_observation', 'treatment_ordered', 'escalated')) OR
    (OLD.status = 'under_observation' AND NEW.status IN ('under_observation', 'treatment_ordered', 'escalated', 'closed')) OR
    (OLD.status = 'treatment_ordered' AND NEW.status IN ('treatment_ordered', 'under_observation', 'escalated', 'closed')) OR
    (OLD.status = 'escalated' AND NEW.status IN ('escalated', 'under_observation', 'treatment_ordered', 'closed'))
  ) THEN RAISE EXCEPTION 'invalid welfare case transition % -> %', OLD.status, NEW.status; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = TG_TABLE_NAME || ' records are immutable'; END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_reject_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = TG_TABLE_NAME || ' clinical records cannot be truncated'; END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'welfare treatment orders cannot be deleted'; END IF;
  IF NOT mcm_welfare_receipt_matches(NEW."caseId", NEW."labId", CASE
    WHEN OLD.status = 'proposed' AND NEW.status = 'approved' THEN 'welfare.treatment.approve'
    WHEN OLD.status = 'proposed' AND NEW.status = 'cancelled' THEN 'welfare.treatment.cancel'
    WHEN NEW.status = 'active' THEN 'welfare.treatment.administer'
    WHEN NEW.status = 'stopped' THEN 'welfare.treatment.stop'
    WHEN NEW.status = 'completed' THEN 'welfare.treatment.complete' END)
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare treatment update receipt context is mismatched'; END IF;
  IF NOT mcm_welfare_receipt_has_current_duty('designated_veterinarian')
  THEN RAISE EXCEPTION 'welfare treatment updates require a current designated veterinarian receipt'; END IF;
  IF NULLIF(current_setting('mcm.audit_receipt_id', true), '') IS NULL OR NEW.version <> OLD.version + 1
    OR NEW.id <> OLD.id OR NEW."caseId" <> OLD."caseId" OR NEW."labId" <> OLD."labId"
    OR NEW.medication <> OLD.medication OR NEW.dose <> OLD.dose OR NEW.route <> OLD.route
    OR NEW.frequency <> OLD.frequency OR NEW.instructions <> OLD.instructions
    OR NEW."proposedAt" <> OLD."proposedAt" OR NEW."proposedById" <> OLD."proposedById"
    OR NEW."proposedCommandReceiptId" <> OLD."proposedCommandReceiptId"
  THEN RAISE EXCEPTION 'welfare order immutable fields or version changed'; END IF;
  IF NEW."lastCommandReceiptId" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_receipt_id', true), '')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare order mutation receipt is mismatched'; END IF;
  IF OLD."approvedAt" IS NULL THEN
    IF NOT ((NEW."approvedAt" IS NULL AND NEW."approvedById" IS NULL)
      OR (OLD.status = 'proposed' AND NEW.status = 'approved' AND NEW."approvedAt" IS NOT NULL AND NEW."approvedById" IS NOT NULL))
    THEN RAISE EXCEPTION 'welfare treatment approval evidence may only be recorded once during approval'; END IF;
  ELSIF (NEW."approvedAt", NEW."approvedById") IS DISTINCT FROM (OLD."approvedAt", OLD."approvedById")
  THEN RAISE EXCEPTION 'welfare treatment approval evidence is immutable'; END IF;
  IF NEW.status = 'approved' AND NEW."approvedById" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_actor_id', true), '')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare treatment approval actor is mismatched'; END IF;
  IF NEW.status IN ('stopped', 'cancelled') AND NEW."stoppedById" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_actor_id', true), '')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare treatment stop actor is mismatched'; END IF;
  IF NOT (
    (OLD.status = 'proposed' AND NEW.status IN ('approved', 'cancelled')) OR
    (OLD.status = 'approved' AND NEW.status IN ('active', 'stopped', 'completed')) OR
    (OLD.status = 'active' AND NEW.status IN ('active', 'stopped', 'completed'))
  ) THEN RAISE EXCEPTION 'invalid welfare order transition % -> %', OLD.status, NEW.status; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_escalation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'welfare escalations cannot be deleted'; END IF;
  IF NOT mcm_welfare_receipt_matches(NEW."caseId", NEW."labId", CASE NEW.status
    WHEN 'acknowledged' THEN 'welfare.escalation.acknowledge'
    WHEN 'resolved' THEN 'welfare.escalation.resolve' END)
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare escalation update receipt context is mismatched'; END IF;
  IF NULLIF(current_setting('mcm.audit_receipt_id', true), '') IS NULL OR NEW.version <> OLD.version + 1
    OR NEW.id <> OLD.id OR NEW."caseId" <> OLD."caseId" OR NEW."labId" <> OLD."labId"
    OR NEW.severity <> OLD.severity OR NEW."operationalCode" <> OLD."operationalCode"
    OR NEW."privateReason" <> OLD."privateReason" OR NEW."openedAt" <> OLD."openedAt"
    OR NEW."openedById" <> OLD."openedById" OR NEW."openedCommandReceiptId" <> OLD."openedCommandReceiptId"
  THEN RAISE EXCEPTION 'welfare escalation immutable fields or version changed'; END IF;
  IF NEW."lastCommandReceiptId" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_receipt_id', true), '')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare escalation mutation receipt is mismatched'; END IF;
  IF OLD."acknowledgedAt" IS NULL THEN
    IF NOT (OLD.status = 'open' AND NEW.status = 'acknowledged' AND NEW."acknowledgedAt" IS NOT NULL AND NEW."acknowledgedById" IS NOT NULL)
    THEN RAISE EXCEPTION 'welfare escalation acknowledgement evidence may only be recorded once during acknowledgement'; END IF;
  ELSIF (NEW."acknowledgedAt", NEW."acknowledgedById") IS DISTINCT FROM (OLD."acknowledgedAt", OLD."acknowledgedById")
  THEN RAISE EXCEPTION 'welfare escalation acknowledgement evidence is immutable'; END IF;
  IF NEW.status = 'acknowledged' AND NEW."acknowledgedById" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_actor_id', true), '')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare escalation acknowledgement actor is mismatched'; END IF;
  IF NEW.status = 'resolved' AND NEW."resolvedById" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_actor_id', true), '')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'welfare escalation resolution actor is mismatched'; END IF;
  IF NOT ((OLD.status = 'open' AND NEW.status = 'acknowledged') OR (OLD.status = 'acknowledged' AND NEW.status = 'resolved'))
  THEN RAISE EXCEPTION 'invalid welfare escalation transition % -> %', OLD.status, NEW.status; END IF;
  IF NEW.status = 'resolved' AND NOT mcm_welfare_receipt_has_current_duty('designated_veterinarian')
  THEN RAISE EXCEPTION 'welfare escalation resolution requires a current designated veterinarian receipt'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_require_case_event_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_id TEXT := NULLIF(current_setting('mcm.audit_receipt_id', true), '');
DECLARE matching_events INTEGER;
BEGIN
  SELECT count(*) INTO matching_events FROM "WelfareCaseLifecycleEvent" event
  WHERE event."caseId" = NEW.id AND event."labId" = NEW."labId" AND event."commandReceiptId" = receipt_id
    AND event."fromStatus" IS NOT DISTINCT FROM CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END
    AND event."toStatus" = NEW.status
    AND mcm_welfare_expected_command(event."eventType", event.detail)
      = NULLIF(current_setting('mcm.audit_command_type', true), '');
  IF receipt_id IS NULL OR matching_events <> 1
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'welfare case mutation requires one exact same-receipt lifecycle event'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_require_order_event_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_id TEXT := NULLIF(current_setting('mcm.audit_receipt_id', true), '');
DECLARE expected_event "WelfareCaseEventType" := CASE
  WHEN TG_OP = 'INSERT' THEN 'treatment_ordered'
  WHEN OLD.status = 'proposed' AND NEW.status = 'approved' THEN 'treatment_approved'
  WHEN OLD.status = 'proposed' AND NEW.status = 'cancelled' THEN 'treatment_stopped'
  WHEN NEW.status = 'active' THEN 'administration_recorded'
  WHEN NEW.status = 'stopped' THEN 'treatment_stopped'
  WHEN NEW.status = 'completed' THEN 'treatment_completed' END;
DECLARE matching_events INTEGER;
BEGIN
  SELECT count(*) INTO matching_events FROM "WelfareCaseLifecycleEvent" event
  WHERE event."caseId" = NEW."caseId" AND event."labId" = NEW."labId" AND event."commandReceiptId" = receipt_id
    AND event."eventType" = expected_event AND event.detail->>'orderId' = NEW.id;
  IF receipt_id IS NULL OR expected_event IS NULL OR matching_events <> 1
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'welfare treatment mutation requires one exact same-receipt lifecycle event'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_require_escalation_event_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_id TEXT := NULLIF(current_setting('mcm.audit_receipt_id', true), '');
DECLARE expected_event "WelfareCaseEventType" := CASE
  WHEN TG_OP = 'INSERT' THEN 'escalated'
  WHEN NEW.status = 'acknowledged' THEN 'escalation_acknowledged'
  WHEN NEW.status = 'resolved' THEN 'escalation_resolved' END;
DECLARE matching_events INTEGER;
BEGIN
  SELECT count(*) INTO matching_events FROM "WelfareCaseLifecycleEvent" event
  WHERE event."caseId" = NEW."caseId" AND event."labId" = NEW."labId" AND event."commandReceiptId" = receipt_id
    AND event."eventType" = expected_event AND event.detail->>'escalationId' = NEW.id;
  IF receipt_id IS NULL OR expected_event IS NULL OR matching_events <> 1
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'welfare escalation mutation requires one exact same-receipt lifecycle event'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_require_observation_event_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matching_events INTEGER;
BEGIN
  SELECT count(*) INTO matching_events FROM "WelfareCaseLifecycleEvent" event
  WHERE event."commandReceiptId" = NEW."commandReceiptId"
    AND event."caseId" = NEW."caseId" AND event."labId" = NEW."labId"
    AND event."actorId" = NEW."observedById" AND event."eventType" = 'observation_recorded';
  IF matching_events <> 1
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'welfare observation requires one exact same-receipt lifecycle event'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_require_administration_event_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matching_events INTEGER;
BEGIN
  SELECT count(*) INTO matching_events FROM "WelfareCaseLifecycleEvent" event
  WHERE event."commandReceiptId" = NEW."commandReceiptId"
    AND event."caseId" = NEW."caseId" AND event."labId" = NEW."labId"
    AND event."actorId" = NEW."administeredById" AND event."eventType" = 'administration_recorded'
    AND event.detail->>'orderId' = NEW."orderId";
  IF matching_events <> 1
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'welfare administration requires one exact same-receipt lifecycle event'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_require_clinical_row_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matching_rows INTEGER;
BEGIN
  IF NEW."eventType" = 'observation_recorded' THEN
    SELECT count(*) INTO matching_rows FROM "WelfareObservation" observation
    WHERE observation."commandReceiptId" = NEW."commandReceiptId"
      AND observation."caseId" = NEW."caseId" AND observation."labId" = NEW."labId"
      AND observation."observedById" = NEW."actorId";
  ELSIF NEW."eventType" = 'administration_recorded' THEN
    SELECT count(*) INTO matching_rows FROM "WelfareAdministrationAttempt" administration
    WHERE administration."commandReceiptId" = NEW."commandReceiptId"
      AND administration."caseId" = NEW."caseId" AND administration."labId" = NEW."labId"
      AND administration."administeredById" = NEW."actorId"
      AND administration."orderId" = NEW.detail->>'orderId';
  ELSE
    RETURN NULL;
  END IF;
  IF matching_rows <> 1
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'welfare lifecycle event requires one exact same-receipt clinical row'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_require_domain_mutation_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matching_rows INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "WelfareCase" welfare_case
    WHERE welfare_case.id = NEW."caseId" AND welfare_case."labId" = NEW."labId"
      AND welfare_case."lastCommandReceiptId" = NEW."commandReceiptId"
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'welfare lifecycle event requires the exact same-receipt case mutation'; END IF;
  IF NEW."eventType" IN ('treatment_ordered', 'treatment_approved',
    'treatment_stopped', 'treatment_completed', 'administration_recorded') THEN
    SELECT count(*) INTO matching_rows FROM "WelfareTreatmentOrder" treatment
    WHERE treatment.id = NEW.detail->>'orderId'
      AND treatment."caseId" = NEW."caseId" AND treatment."labId" = NEW."labId"
      AND treatment."lastCommandReceiptId" = NEW."commandReceiptId"
      AND CASE NEW."eventType"
        WHEN 'treatment_ordered' THEN treatment.status = 'proposed'
        WHEN 'treatment_approved' THEN treatment.status = 'approved'
        WHEN 'administration_recorded' THEN treatment.status = 'active'
        WHEN 'treatment_stopped' THEN treatment.status IN ('stopped', 'cancelled')
        WHEN 'treatment_completed' THEN treatment.status = 'completed'
        ELSE false END;
  ELSIF NEW."eventType" IN ('escalated', 'escalation_acknowledged', 'escalation_resolved') THEN
    SELECT count(*) INTO matching_rows FROM "WelfareEscalation" escalation
    WHERE escalation.id = NEW.detail->>'escalationId'
      AND escalation."caseId" = NEW."caseId" AND escalation."labId" = NEW."labId"
      AND escalation."lastCommandReceiptId" = NEW."commandReceiptId"
      AND CASE NEW."eventType"
        WHEN 'escalated' THEN escalation.status = 'open'
        WHEN 'escalation_acknowledged' THEN escalation.status = 'acknowledged'
        WHEN 'escalation_resolved' THEN escalation.status = 'resolved'
        ELSE false END;
  ELSE
    RETURN NULL;
  END IF;
  IF matching_rows <> 1
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'welfare lifecycle event requires one exact same-receipt domain mutation'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION mcm_welfare_require_event_audit_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matching_audits INTEGER;
BEGIN
  SELECT count(*) INTO matching_audits FROM "AuditLog" audit
  JOIN "CommandReceipt" receipt ON receipt.id = NEW."commandReceiptId"
  WHERE audit."commandReceiptId" = NEW."commandReceiptId" AND audit."actorId" = NEW."actorId"
    AND audit."labId" = NEW."labId" AND audit."entityType" = 'WelfareCase' AND audit."entityId" = NEW."caseId"
    AND audit.action = NEW."eventType"::text
    AND audit."requestId" = receipt."requestId" AND audit."commandType" = receipt."commandType"
    AND audit."commandAggregateType" = receipt."aggregateType"
    AND audit."commandAggregateId" = receipt."aggregateId";
  IF matching_audits <> 1
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'welfare lifecycle event requires one exact receipt-event-audit record'; END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER "WelfareCase_receipt_guard" BEFORE INSERT ON "WelfareCase" FOR EACH ROW EXECUTE FUNCTION mcm_welfare_receipt_guard();
CREATE TRIGGER "WelfareCase_subject_guard" BEFORE INSERT ON "WelfareCase" FOR EACH ROW EXECUTE FUNCTION mcm_welfare_case_insert_guard();
CREATE TRIGGER "WelfareCase_update_guard" BEFORE UPDATE OR DELETE ON "WelfareCase" FOR EACH ROW EXECUTE FUNCTION mcm_welfare_case_guard();
CREATE TRIGGER "WelfareObservation_receipt_guard" BEFORE INSERT ON "WelfareObservation" FOR EACH ROW EXECUTE FUNCTION mcm_welfare_receipt_guard();
CREATE TRIGGER "WelfareObservation_immutable" BEFORE UPDATE OR DELETE ON "WelfareObservation" FOR EACH ROW EXECUTE FUNCTION mcm_welfare_immutable();
CREATE TRIGGER "WelfareAdministration_receipt_guard" BEFORE INSERT ON "WelfareAdministrationAttempt" FOR EACH ROW EXECUTE FUNCTION mcm_welfare_receipt_guard();
CREATE TRIGGER "WelfareAdministration_immutable" BEFORE UPDATE OR DELETE ON "WelfareAdministrationAttempt" FOR EACH ROW EXECUTE FUNCTION mcm_welfare_immutable();
CREATE TRIGGER "WelfareCaseEvent_receipt_guard" BEFORE INSERT ON "WelfareCaseLifecycleEvent" FOR EACH ROW EXECUTE FUNCTION mcm_welfare_receipt_guard();
CREATE TRIGGER "WelfareCaseEvent_evidence_guard" BEFORE INSERT ON "WelfareCaseLifecycleEvent" FOR EACH ROW EXECUTE FUNCTION mcm_welfare_event_evidence_guard();
CREATE TRIGGER "WelfareCaseEvent_immutable" BEFORE UPDATE OR DELETE ON "WelfareCaseLifecycleEvent" FOR EACH ROW EXECUTE FUNCTION mcm_welfare_immutable();
CREATE TRIGGER "WelfareOrder_receipt_guard" BEFORE INSERT ON "WelfareTreatmentOrder" FOR EACH ROW EXECUTE FUNCTION mcm_welfare_receipt_guard();
CREATE TRIGGER "WelfareOrder_update_guard" BEFORE UPDATE OR DELETE ON "WelfareTreatmentOrder" FOR EACH ROW EXECUTE FUNCTION mcm_welfare_order_guard();
CREATE TRIGGER "WelfareEscalation_receipt_guard" BEFORE INSERT ON "WelfareEscalation" FOR EACH ROW EXECUTE FUNCTION mcm_welfare_receipt_guard();
CREATE TRIGGER "WelfareEscalation_update_guard" BEFORE UPDATE OR DELETE ON "WelfareEscalation" FOR EACH ROW EXECUTE FUNCTION mcm_welfare_escalation_guard();

CREATE TRIGGER "WelfareCase_truncate_guard" BEFORE TRUNCATE ON "WelfareCase" FOR EACH STATEMENT EXECUTE FUNCTION mcm_welfare_reject_truncate();
CREATE TRIGGER "WelfareObservation_truncate_guard" BEFORE TRUNCATE ON "WelfareObservation" FOR EACH STATEMENT EXECUTE FUNCTION mcm_welfare_reject_truncate();
CREATE TRIGGER "WelfareTreatmentOrder_truncate_guard" BEFORE TRUNCATE ON "WelfareTreatmentOrder" FOR EACH STATEMENT EXECUTE FUNCTION mcm_welfare_reject_truncate();
CREATE TRIGGER "WelfareAdministration_truncate_guard" BEFORE TRUNCATE ON "WelfareAdministrationAttempt" FOR EACH STATEMENT EXECUTE FUNCTION mcm_welfare_reject_truncate();
CREATE TRIGGER "WelfareEscalation_truncate_guard" BEFORE TRUNCATE ON "WelfareEscalation" FOR EACH STATEMENT EXECUTE FUNCTION mcm_welfare_reject_truncate();
CREATE TRIGGER "WelfareCaseEvent_truncate_guard" BEFORE TRUNCATE ON "WelfareCaseLifecycleEvent" FOR EACH STATEMENT EXECUTE FUNCTION mcm_welfare_reject_truncate();

CREATE CONSTRAINT TRIGGER "WelfareCase_event_pair" AFTER INSERT OR UPDATE ON "WelfareCase"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mcm_welfare_require_case_event_pair();
CREATE CONSTRAINT TRIGGER "WelfareTreatmentOrder_event_pair" AFTER INSERT OR UPDATE ON "WelfareTreatmentOrder"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mcm_welfare_require_order_event_pair();
CREATE CONSTRAINT TRIGGER "WelfareEscalation_event_pair" AFTER INSERT OR UPDATE ON "WelfareEscalation"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mcm_welfare_require_escalation_event_pair();
CREATE CONSTRAINT TRIGGER "WelfareObservation_event_pair" AFTER INSERT ON "WelfareObservation"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mcm_welfare_require_observation_event_pair();
CREATE CONSTRAINT TRIGGER "WelfareAdministration_event_pair" AFTER INSERT ON "WelfareAdministrationAttempt"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mcm_welfare_require_administration_event_pair();
CREATE CONSTRAINT TRIGGER "WelfareCaseEvent_clinical_row_pair" AFTER INSERT ON "WelfareCaseLifecycleEvent"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mcm_welfare_require_clinical_row_pair();
CREATE CONSTRAINT TRIGGER "WelfareCaseEvent_domain_mutation_pair" AFTER INSERT ON "WelfareCaseLifecycleEvent"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mcm_welfare_require_domain_mutation_pair();
CREATE CONSTRAINT TRIGGER "WelfareCaseEvent_audit_pair" AFTER INSERT ON "WelfareCaseLifecycleEvent"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mcm_welfare_require_event_audit_pair();

COMMIT;
