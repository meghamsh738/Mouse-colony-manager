BEGIN;

CREATE TYPE "CorrectionDomain" AS ENUM ('litter_birth', 'litter_weaning', 'animal_move', 'animal_lifecycle', 'cross_lab_transfer', 'procedure_occurrence', 'biosample');
CREATE TYPE "CorrectionRequestStatus" AS ENUM ('pending', 'applied', 'rejected', 'blocked');
CREATE TYPE "CorrectionEventType" AS ENUM ('requested', 'blocked', 'applied', 'rejected');

CREATE TABLE "CorrectionRequest" (
  id TEXT PRIMARY KEY,
  "labId" TEXT NOT NULL,
  domain "CorrectionDomain" NOT NULL,
  "targetEntityType" TEXT NOT NULL,
  "targetEntityId" TEXT NOT NULL,
  "targetVersion" INTEGER,
  "sourceEventAt" TIMESTAMPTZ(6) NOT NULL,
  reason TEXT NOT NULL,
  "originalSnapshot" JSONB NOT NULL,
  "proposedCorrection" JSONB NOT NULL,
  status "CorrectionRequestStatus" NOT NULL DEFAULT 'pending',
  "blockCode" TEXT,
  "blockDetail" JSONB,
  "policyMarker" TEXT NOT NULL DEFAULT 'synthetic-controlled-metadata-supersession-v1',
  "requestedById" TEXT NOT NULL,
  "requesterAuthzVersion" INTEGER NOT NULL,
  "requesterAssurance" "IdentityAssuranceLevel" NOT NULL,
  "requesterIdentityLinkId" TEXT,
  "requesterAuthenticatedAt" TIMESTAMPTZ(6) NOT NULL,
  "requestCommandReceiptId" TEXT NOT NULL UNIQUE,
  "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedById" TEXT,
  "deciderAuthzVersion" INTEGER,
  "deciderAssurance" "IdentityAssuranceLevel",
  "deciderDutyAssignmentId" TEXT,
  "deciderDutyAssignmentVersion" INTEGER,
  "deciderIdentityLinkId" TEXT,
  "deciderAuthenticatedAt" TIMESTAMPTZ(6),
  "decisionCommandReceiptId" TEXT UNIQUE,
  "decisionReason" TEXT,
  "decidedAt" TIMESTAMPTZ(6),
  version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CorrectionRequest_policy_marker_check" CHECK ("policyMarker" = 'synthetic-controlled-metadata-supersession-v1'),
  CONSTRAINT "CorrectionRequest_snapshots_check" CHECK (jsonb_typeof("originalSnapshot") = 'object' AND jsonb_typeof("proposedCorrection") = 'object'),
  CONSTRAINT "CorrectionRequest_reason_check" CHECK (char_length(reason) BETWEEN 8 AND 2000),
  CONSTRAINT "CorrectionRequest_block_state_check" CHECK (
    (status = 'blocked' AND "blockCode" IS NOT NULL)
    OR (status IN ('pending', 'applied') AND "blockCode" IS NULL)
    OR status = 'rejected'
  ),
  CONSTRAINT "CorrectionRequest_decision_state_check" CHECK (
    (status IN ('pending', 'blocked') AND "decidedById" IS NULL AND "deciderAuthzVersion" IS NULL
      AND "deciderAssurance" IS NULL AND "deciderDutyAssignmentId" IS NULL
      AND "deciderDutyAssignmentVersion" IS NULL AND "deciderIdentityLinkId" IS NULL
      AND "deciderAuthenticatedAt" IS NULL AND "decisionCommandReceiptId" IS NULL
      AND "decisionReason" IS NULL AND "decidedAt" IS NULL AND version = 1)
    OR (status IN ('applied', 'rejected') AND "decidedById" IS NOT NULL AND "deciderAuthzVersion" IS NOT NULL
      AND "deciderAssurance" IS NOT NULL AND "deciderDutyAssignmentId" IS NOT NULL
      AND "deciderDutyAssignmentVersion" IS NOT NULL AND "deciderIdentityLinkId" IS NOT NULL
      AND "deciderAuthenticatedAt" IS NOT NULL AND "decisionCommandReceiptId" IS NOT NULL
      AND "decisionReason" IS NOT NULL AND "decidedAt" IS NOT NULL AND version = 2)
  ),
  UNIQUE (id, "labId")
);

CREATE TABLE "CorrectionLifecycleEvent" (
  id TEXT PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "eventType" "CorrectionEventType" NOT NULL,
  "fromStatus" "CorrectionRequestStatus",
  "toStatus" "CorrectionRequestStatus" NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorAuthzVersion" INTEGER NOT NULL,
  assurance "IdentityAssuranceLevel" NOT NULL,
  "dutyAssignmentId" TEXT,
  "dutyAssignmentVersion" INTEGER,
  "identityLinkId" TEXT,
  "authenticatedAt" TIMESTAMPTZ(6) NOT NULL,
  "commandReceiptId" TEXT NOT NULL UNIQUE,
  detail JSONB,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CorrectionSupersession" (
  id TEXT PRIMARY KEY,
  "requestId" TEXT NOT NULL UNIQUE,
  "labId" TEXT NOT NULL,
  domain "CorrectionDomain" NOT NULL,
  "targetEntityType" TEXT NOT NULL,
  "targetEntityId" TEXT NOT NULL,
  "originalSnapshot" JSONB NOT NULL,
  "effectiveProjection" JSONB NOT NULL,
  "sourceEventAt" TIMESTAMPTZ(6) NOT NULL,
  "appliedAt" TIMESTAMPTZ(6) NOT NULL,
  "appliedById" TEXT NOT NULL,
  "commandReceiptId" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorrectionSupersession_snapshots_check" CHECK (jsonb_typeof("originalSnapshot") = 'object' AND jsonb_typeof("effectiveProjection") = 'object'),
  UNIQUE ("requestId", "labId"),
  UNIQUE (domain, "targetEntityId")
);

CREATE TABLE "CorrectionReconciliation" (
  id TEXT PRIMARY KEY,
  "requestId" TEXT NOT NULL UNIQUE,
  "labId" TEXT NOT NULL,
  "downstreamRecords" JSONB NOT NULL,
  result JSONB NOT NULL,
  "physicalMutationRequired" BOOLEAN NOT NULL DEFAULT false,
  "reconciledAt" TIMESTAMPTZ(6) NOT NULL,
  "commandReceiptId" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CorrectionReconciliation_shape_check" CHECK (
    jsonb_typeof("downstreamRecords") = 'array' AND jsonb_typeof(result) = 'object'
      AND "physicalMutationRequired" = false
      AND result->>'outcome' = 'reconciled'
      AND COALESCE((result->>'physicalMutationRequired')::boolean, true) = false
      AND COALESCE((result->>'sourceRecordMutated')::boolean, true) = false
  ),
  UNIQUE ("requestId", "labId")
);

ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT;
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_requestReceipt_fkey" FOREIGN KEY ("requestCommandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT;
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_decisionReceipt_fkey" FOREIGN KEY ("decisionCommandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT;
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_requestIdentity_fkey" FOREIGN KEY ("requesterIdentityLinkId") REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT;
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_deciderIdentity_fkey" FOREIGN KEY ("deciderIdentityLinkId") REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT;
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_deciderDuty_fkey" FOREIGN KEY ("deciderDutyAssignmentId") REFERENCES "FacilityDutyAssignment"(id) ON DELETE RESTRICT;

ALTER TABLE "CorrectionLifecycleEvent" ADD CONSTRAINT "CorrectionLifecycleEvent_request_fkey" FOREIGN KEY ("requestId", "labId") REFERENCES "CorrectionRequest"(id, "labId") ON DELETE RESTRICT;
ALTER TABLE "CorrectionLifecycleEvent" ADD CONSTRAINT "CorrectionLifecycleEvent_lab_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT;
ALTER TABLE "CorrectionLifecycleEvent" ADD CONSTRAINT "CorrectionLifecycleEvent_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "CorrectionLifecycleEvent" ADD CONSTRAINT "CorrectionLifecycleEvent_receipt_fkey" FOREIGN KEY ("commandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT;
ALTER TABLE "CorrectionLifecycleEvent" ADD CONSTRAINT "CorrectionLifecycleEvent_duty_fkey" FOREIGN KEY ("dutyAssignmentId") REFERENCES "FacilityDutyAssignment"(id) ON DELETE RESTRICT;
ALTER TABLE "CorrectionLifecycleEvent" ADD CONSTRAINT "CorrectionLifecycleEvent_identity_fkey" FOREIGN KEY ("identityLinkId") REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT;

ALTER TABLE "CorrectionSupersession" ADD CONSTRAINT "CorrectionSupersession_request_fkey" FOREIGN KEY ("requestId", "labId") REFERENCES "CorrectionRequest"(id, "labId") ON DELETE RESTRICT;
ALTER TABLE "CorrectionSupersession" ADD CONSTRAINT "CorrectionSupersession_lab_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT;
ALTER TABLE "CorrectionSupersession" ADD CONSTRAINT "CorrectionSupersession_actor_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "CorrectionSupersession" ADD CONSTRAINT "CorrectionSupersession_receipt_fkey" FOREIGN KEY ("commandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT;

ALTER TABLE "CorrectionReconciliation" ADD CONSTRAINT "CorrectionReconciliation_request_fkey" FOREIGN KEY ("requestId", "labId") REFERENCES "CorrectionRequest"(id, "labId") ON DELETE RESTRICT;
ALTER TABLE "CorrectionReconciliation" ADD CONSTRAINT "CorrectionReconciliation_lab_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT;
ALTER TABLE "CorrectionReconciliation" ADD CONSTRAINT "CorrectionReconciliation_receipt_fkey" FOREIGN KEY ("commandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT;

CREATE INDEX "CorrectionRequest_lab_status_requested_idx" ON "CorrectionRequest"("labId", status, "requestedAt");
CREATE INDEX "CorrectionRequest_status_requested_idx" ON "CorrectionRequest"(status, "requestedAt");
CREATE INDEX "CorrectionRequest_target_idx" ON "CorrectionRequest"(domain, "targetEntityId");
CREATE INDEX "CorrectionRequest_requester_idx" ON "CorrectionRequest"("requestedById", "requestedAt");
CREATE INDEX "CorrectionLifecycleEvent_request_idx" ON "CorrectionLifecycleEvent"("requestId", "occurredAt");
CREATE INDEX "CorrectionLifecycleEvent_lab_idx" ON "CorrectionLifecycleEvent"("labId", "occurredAt");
CREATE INDEX "CorrectionLifecycleEvent_actor_idx" ON "CorrectionLifecycleEvent"("actorId", "occurredAt");
CREATE INDEX "CorrectionSupersession_target_idx" ON "CorrectionSupersession"(domain, "targetEntityId", "appliedAt");
CREATE INDEX "CorrectionSupersession_lab_idx" ON "CorrectionSupersession"("labId", "appliedAt");
CREATE INDEX "CorrectionReconciliation_lab_idx" ON "CorrectionReconciliation"("labId", "reconciledAt");

CREATE OR REPLACE FUNCTION mcm_correction_receipt_matches(target_request_id TEXT, target_lab_id TEXT, expected_command TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "CommandReceipt" receipt
    JOIN "User" actor ON actor.id = receipt."actorId"
    WHERE receipt.id = NULLIF(current_setting('mcm.audit_receipt_id', true), '')
      AND receipt.status = 'processing' AND receipt."completedAt" IS NULL
      AND receipt."transactionId" = txid_current()
      AND receipt."actorId" = NULLIF(current_setting('mcm.audit_actor_id', true), '')
      AND receipt."commandType" = expected_command
      AND receipt."commandType" = NULLIF(current_setting('mcm.audit_command_type', true), '')
      AND receipt."requestHash" = NULLIF(current_setting('mcm.audit_request_hash', true), '')
      AND receipt."aggregateType" = 'correction_request' AND receipt."aggregateId" = target_request_id
      AND receipt."labId" = target_lab_id
      AND actor.active AND actor.role <> 'it_head'::"UserRole"
      AND actor."authzVersion" = receipt."actorAuthzVersion"
  )
$$;

CREATE OR REPLACE FUNCTION mcm_correction_current_steward(actor_id TEXT, assignment_id TEXT, assignment_version INTEGER)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "FacilityDutyAssignment" duty
    JOIN "User" actor ON actor.id = duty."userId"
    WHERE duty.id = assignment_id AND duty."userId" = actor_id
      AND duty.version = assignment_version AND duty.duty = 'data_steward'::"FacilityDuty"
      AND duty."revokedAt" IS NULL AND duty."validFrom" <= CURRENT_TIMESTAMP AND duty."validUntil" > CURRENT_TIMESTAMP
      AND actor.active AND actor.role <> 'it_head'::"UserRole"
  )
$$;

CREATE OR REPLACE FUNCTION mcm_correction_current_requester(actor_id TEXT, target_lab_id TEXT, target_domain "CorrectionDomain")
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "User" actor
    JOIN "Lab" lab ON lab.id = target_lab_id AND lab.active
    WHERE actor.id = actor_id AND actor.active AND actor.role <> 'it_head'::"UserRole"
      AND (
        actor.role IN ('facility_admin'::"UserRole", 'admin'::"UserRole")
        OR (
          actor.role IN ('cmu_staff'::"UserRole", 'colony_manager'::"UserRole")
          AND target_domain IN ('litter_birth'::"CorrectionDomain", 'litter_weaning'::"CorrectionDomain", 'animal_move'::"CorrectionDomain", 'animal_lifecycle'::"CorrectionDomain", 'procedure_occurrence'::"CorrectionDomain")
        )
        OR (
          actor.role IN ('lab_user'::"UserRole", 'animal_staff'::"UserRole", 'researcher'::"UserRole", 'read_only'::"UserRole")
          AND EXISTS (
            SELECT 1 FROM "LabMembership" membership
            WHERE membership."userId" = actor.id AND membership."labId" = target_lab_id AND membership.active
              AND membership.role IN ('owner'::"LabMembershipRole", 'manager'::"LabMembershipRole", 'staff'::"LabMembershipRole")
              AND (
                target_domain IN ('litter_birth'::"CorrectionDomain", 'litter_weaning'::"CorrectionDomain", 'animal_move'::"CorrectionDomain", 'animal_lifecycle'::"CorrectionDomain", 'biosample'::"CorrectionDomain")
                OR (target_domain = 'cross_lab_transfer'::"CorrectionDomain" AND membership.role IN ('owner'::"LabMembershipRole", 'manager'::"LabMembershipRole"))
              )
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION mcm_correction_request_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_actor TEXT := NULLIF(current_setting('mcm.audit_actor_id', true), '');
BEGIN
  IF NOT mcm_correction_receipt_matches(NEW.id, NEW."labId", 'corrections.request.submit')
    OR NEW."requestCommandReceiptId" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_receipt_id', true), '')
    OR NEW."requestedById" IS DISTINCT FROM receipt_actor
    OR NEW."requesterAuthzVersion" IS DISTINCT FROM (SELECT "actorAuthzVersion" FROM "CommandReceipt" WHERE id = NEW."requestCommandReceiptId")
    OR NOT mcm_correction_current_requester(NEW."requestedById", NEW."labId", NEW.domain)
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'correction request receipt or requester evidence is mismatched'; END IF;
  IF NEW.status NOT IN ('pending', 'blocked') OR NEW.version <> 1
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'new correction requests must be pending or explicitly blocked'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mcm_correction_request_update_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_command TEXT := CASE NEW.status WHEN 'applied' THEN 'corrections.request.apply' WHEN 'rejected' THEN 'corrections.request.reject' END;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'correction requests cannot be deleted'; END IF;
  IF expected_command IS NULL OR NOT mcm_correction_receipt_matches(OLD.id, OLD."labId", expected_command)
    OR NEW."decisionCommandReceiptId" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_receipt_id', true), '')
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'correction decision receipt is mismatched'; END IF;
  IF OLD.status NOT IN ('pending', 'blocked') OR NEW.status NOT IN ('applied', 'rejected')
    OR (OLD.status = 'blocked' AND NEW.status <> 'rejected')
    OR NEW.version <> OLD.version + 1
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'invalid correction request transition'; END IF;
  IF NEW.id <> OLD.id OR NEW."labId" <> OLD."labId" OR NEW.domain <> OLD.domain
    OR NEW."targetEntityType" <> OLD."targetEntityType" OR NEW."targetEntityId" <> OLD."targetEntityId"
    OR NEW."targetVersion" IS DISTINCT FROM OLD."targetVersion" OR NEW."sourceEventAt" <> OLD."sourceEventAt"
    OR NEW.reason <> OLD.reason OR NEW."originalSnapshot" <> OLD."originalSnapshot"
    OR NEW."proposedCorrection" <> OLD."proposedCorrection" OR NEW."blockCode" IS DISTINCT FROM OLD."blockCode"
    OR NEW."blockDetail" IS DISTINCT FROM OLD."blockDetail" OR NEW."policyMarker" <> OLD."policyMarker"
    OR NEW."requestedById" <> OLD."requestedById" OR NEW."requesterAuthzVersion" <> OLD."requesterAuthzVersion"
    OR NEW."requesterAssurance" <> OLD."requesterAssurance" OR NEW."requesterIdentityLinkId" IS DISTINCT FROM OLD."requesterIdentityLinkId"
    OR NEW."requesterAuthenticatedAt" <> OLD."requesterAuthenticatedAt" OR NEW."requestCommandReceiptId" <> OLD."requestCommandReceiptId"
    OR NEW."requestedAt" <> OLD."requestedAt" OR NEW."createdAt" <> OLD."createdAt"
  THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'correction request evidence is immutable'; END IF;
  IF NEW."decidedById" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_actor_id', true), '')
    OR NEW."decidedById" = OLD."requestedById"
    OR NEW."deciderAuthzVersion" IS DISTINCT FROM (SELECT "actorAuthzVersion" FROM "CommandReceipt" WHERE id = NEW."decisionCommandReceiptId")
    OR NOT mcm_correction_current_steward(NEW."decidedById", NEW."deciderDutyAssignmentId", NEW."deciderDutyAssignmentVersion")
    OR NOT mcm_identity_assurance_snapshot_is_current(NEW."decidedById", NEW."deciderIdentityLinkId", NEW."deciderAssurance", NEW."deciderAuthenticatedAt", NEW."decidedAt")
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'correction decision requires an independent current Data Steward with fresh identity'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mcm_correction_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_command TEXT := CASE NEW."eventType"
  WHEN 'requested' THEN 'corrections.request.submit'
  WHEN 'blocked' THEN 'corrections.request.submit'
  WHEN 'applied' THEN 'corrections.request.apply'
  WHEN 'rejected' THEN 'corrections.request.reject' END;
DECLARE request_row "CorrectionRequest"%ROWTYPE;
BEGIN
  SELECT * INTO request_row FROM "CorrectionRequest" WHERE id = NEW."requestId" AND "labId" = NEW."labId";
  IF NOT FOUND OR NOT mcm_correction_receipt_matches(NEW."requestId", NEW."labId", expected_command)
    OR NEW."commandReceiptId" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_receipt_id', true), '')
    OR NEW."actorId" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_actor_id', true), '')
    OR NEW."actorAuthzVersion" IS DISTINCT FROM (SELECT "actorAuthzVersion" FROM "CommandReceipt" WHERE id = NEW."commandReceiptId")
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'correction lifecycle evidence is mismatched'; END IF;
  IF NOT (
    (NEW."eventType" = 'requested' AND NEW."fromStatus" IS NULL AND NEW."toStatus" = 'pending' AND request_row.status = 'pending')
    OR (NEW."eventType" = 'blocked' AND NEW."fromStatus" IS NULL AND NEW."toStatus" = 'blocked' AND request_row.status = 'blocked')
    OR (NEW."eventType" = 'applied' AND NEW."fromStatus" = 'pending' AND NEW."toStatus" = 'applied' AND request_row.status = 'applied')
    OR (NEW."eventType" = 'rejected' AND NEW."fromStatus" IN ('pending', 'blocked') AND NEW."toStatus" = 'rejected' AND request_row.status = 'rejected')
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'invalid correction lifecycle transition'; END IF;
  IF NEW."eventType" IN ('requested', 'blocked') THEN
    IF NEW."actorId" <> request_row."requestedById" OR NEW."dutyAssignmentId" IS NOT NULL OR NEW."dutyAssignmentVersion" IS NOT NULL
    THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'correction request event actor is mismatched'; END IF;
  ELSE
    IF NEW."actorId" <> request_row."decidedById"
      OR NOT mcm_correction_current_steward(NEW."actorId", NEW."dutyAssignmentId", NEW."dutyAssignmentVersion")
      OR NOT mcm_identity_assurance_snapshot_is_current(NEW."actorId", NEW."identityLinkId", NEW.assurance, NEW."authenticatedAt", NEW."occurredAt")
    THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'correction decision event requires current steward evidence'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mcm_correction_supersession_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_row "CorrectionRequest"%ROWTYPE;
BEGIN
  SELECT * INTO request_row FROM "CorrectionRequest" WHERE id = NEW."requestId" AND "labId" = NEW."labId";
  IF NOT FOUND OR request_row.status <> 'pending'
    OR NOT mcm_correction_receipt_matches(NEW."requestId", NEW."labId", 'corrections.request.apply')
    OR NEW."commandReceiptId" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_receipt_id', true), '')
    OR NEW."appliedById" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_actor_id', true), '')
    OR NEW.domain <> request_row.domain OR NEW."targetEntityType" <> request_row."targetEntityType"
    OR NEW."targetEntityId" <> request_row."targetEntityId" OR NEW."originalSnapshot" <> request_row."originalSnapshot"
    OR NEW."sourceEventAt" <> request_row."sourceEventAt"
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'correction supersession receipt or source evidence is mismatched'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mcm_correction_reconciliation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_status "CorrectionRequestStatus";
BEGIN
  SELECT status INTO request_status FROM "CorrectionRequest" WHERE id = NEW."requestId" AND "labId" = NEW."labId";
  IF request_status <> 'pending'
    OR NOT mcm_correction_receipt_matches(NEW."requestId", NEW."labId", 'corrections.request.apply')
    OR NEW."commandReceiptId" IS DISTINCT FROM NULLIF(current_setting('mcm.audit_receipt_id', true), '')
    OR NEW."physicalMutationRequired"
  THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'correction reconciliation must prove a same-receipt metadata-only application'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mcm_correction_require_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_id TEXT := CASE WHEN TG_OP = 'INSERT' THEN NEW."requestCommandReceiptId" ELSE NEW."decisionCommandReceiptId" END;
DECLARE expected_event "CorrectionEventType" := CASE
  WHEN TG_OP = 'INSERT' AND NEW.status = 'pending' THEN 'requested'
  WHEN TG_OP = 'INSERT' AND NEW.status = 'blocked' THEN 'blocked'
  WHEN NEW.status = 'applied' THEN 'applied'
  WHEN NEW.status = 'rejected' THEN 'rejected' END;
DECLARE event_count INTEGER;
DECLARE audit_count INTEGER;
DECLARE supersession_count INTEGER;
DECLARE reconciliation_count INTEGER;
DECLARE expected_actor TEXT := CASE WHEN TG_OP = 'INSERT' THEN NEW."requestedById" ELSE NEW."decidedById" END;
BEGIN
  SELECT count(*) INTO event_count FROM "CorrectionLifecycleEvent" event
    WHERE event."requestId" = NEW.id AND event."labId" = NEW."labId" AND event."commandReceiptId" = receipt_id
      AND event."eventType" = expected_event AND event."toStatus" = NEW.status
      AND event."actorId" = expected_actor
      AND event."actorAuthzVersion" = CASE WHEN TG_OP = 'INSERT' THEN NEW."requesterAuthzVersion" ELSE NEW."deciderAuthzVersion" END
      AND event.assurance = CASE WHEN TG_OP = 'INSERT' THEN NEW."requesterAssurance" ELSE NEW."deciderAssurance" END
      AND event."identityLinkId" IS NOT DISTINCT FROM CASE WHEN TG_OP = 'INSERT' THEN NEW."requesterIdentityLinkId" ELSE NEW."deciderIdentityLinkId" END
      AND event."authenticatedAt" = CASE WHEN TG_OP = 'INSERT' THEN NEW."requesterAuthenticatedAt" ELSE NEW."deciderAuthenticatedAt" END
      AND event."dutyAssignmentId" IS NOT DISTINCT FROM CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE NEW."deciderDutyAssignmentId" END
      AND event."dutyAssignmentVersion" IS NOT DISTINCT FROM CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE NEW."deciderDutyAssignmentVersion" END;
  SELECT count(*) INTO audit_count FROM "AuditLog" audit
    WHERE audit."commandReceiptId" = receipt_id AND audit."requestId" = (SELECT "requestId" FROM "CommandReceipt" WHERE id = receipt_id)
      AND audit."commandType" = (SELECT "commandType" FROM "CommandReceipt" WHERE id = receipt_id)
      AND audit."commandAggregateType" = 'correction_request' AND audit."commandAggregateId" = NEW.id
      AND audit."labId" = NEW."labId" AND audit."entityType" = 'CorrectionRequest' AND audit."entityId" = NEW.id
      AND audit.action = expected_event::text AND audit."actorId" = expected_actor;
  SELECT count(*) INTO supersession_count FROM "CorrectionSupersession" WHERE "requestId" = NEW.id AND "commandReceiptId" = receipt_id;
  SELECT count(*) INTO reconciliation_count FROM "CorrectionReconciliation" WHERE "requestId" = NEW.id AND "commandReceiptId" = receipt_id;
  IF event_count <> 1 OR audit_count <> 1
    OR (NEW.status = 'applied' AND (supersession_count <> 1 OR reconciliation_count <> 1))
    OR (NEW.status <> 'applied' AND (supersession_count <> 0 OR reconciliation_count <> 0))
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'correction mutation requires exact same-receipt lifecycle, audit, supersession, and reconciliation parity'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION mcm_correction_event_requires_request_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_row "CorrectionRequest"%ROWTYPE;
DECLARE expected_receipt TEXT;
BEGIN
  SELECT * INTO request_row FROM "CorrectionRequest" WHERE id = NEW."requestId" AND "labId" = NEW."labId";
  expected_receipt := CASE WHEN NEW."eventType" IN ('requested', 'blocked')
    THEN request_row."requestCommandReceiptId" ELSE request_row."decisionCommandReceiptId" END;
  IF NOT FOUND OR request_row.status <> NEW."toStatus" OR expected_receipt IS DISTINCT FROM NEW."commandReceiptId"
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'correction lifecycle event requires its exact same-receipt request mutation'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION mcm_correction_application_requires_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request_row "CorrectionRequest"%ROWTYPE;
DECLARE request_found BOOLEAN;
DECLARE event_count INTEGER;
DECLARE audit_count INTEGER;
DECLARE supersession_count INTEGER;
DECLARE reconciliation_count INTEGER;
BEGIN
  SELECT * INTO request_row FROM "CorrectionRequest" WHERE id = NEW."requestId" AND "labId" = NEW."labId";
  request_found := FOUND;
  SELECT count(*) INTO event_count FROM "CorrectionLifecycleEvent" event
    WHERE event."requestId" = NEW."requestId" AND event."labId" = NEW."labId"
      AND event."commandReceiptId" = NEW."commandReceiptId" AND event."eventType" = 'applied'
      AND event."fromStatus" = 'pending' AND event."toStatus" = 'applied'
      AND event."actorId" = request_row."decidedById";
  SELECT count(*) INTO audit_count FROM "AuditLog" audit
    WHERE audit."commandReceiptId" = NEW."commandReceiptId" AND audit."actorId" = request_row."decidedById"
      AND audit."commandAggregateType" = 'correction_request' AND audit."commandAggregateId" = NEW."requestId"
      AND audit."labId" = NEW."labId" AND audit."entityType" = 'CorrectionRequest'
      AND audit."entityId" = NEW."requestId" AND audit.action = 'applied';
  SELECT count(*) INTO supersession_count FROM "CorrectionSupersession"
    WHERE "requestId" = NEW."requestId" AND "labId" = NEW."labId" AND "commandReceiptId" = NEW."commandReceiptId";
  SELECT count(*) INTO reconciliation_count FROM "CorrectionReconciliation"
    WHERE "requestId" = NEW."requestId" AND "labId" = NEW."labId" AND "commandReceiptId" = NEW."commandReceiptId";
  IF NOT request_found OR request_row.status <> 'applied'
    OR request_row."decisionCommandReceiptId" IS DISTINCT FROM NEW."commandReceiptId"
    OR event_count <> 1 OR audit_count <> 1 OR supersession_count <> 1 OR reconciliation_count <> 1
  THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'correction application evidence requires an exact same-receipt pending-to-applied transition'; END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION mcm_correction_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = TG_TABLE_NAME || ' correction evidence is immutable'; END $$;
CREATE OR REPLACE FUNCTION mcm_correction_reject_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = TG_TABLE_NAME || ' correction evidence cannot be truncated'; END $$;

-- The immutable proposal keys are the exact corrected-field mask. The
-- effective projection intentionally retains the full approval-time snapshot
-- for audit reconstruction, but ordinary reads and later writes may only
-- treat fields named by this mask as superseded.
CREATE OR REPLACE FUNCTION mcm_correction_field_is_masked(
  target_domain "CorrectionDomain",
  target_entity_id TEXT,
  target_field TEXT
) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "CorrectionSupersession" supersession
    JOIN "CorrectionRequest" request
      ON request.id = supersession."requestId"
      AND request."labId" = supersession."labId"
    WHERE supersession.domain = target_domain
      AND supersession."targetEntityId" = target_entity_id
      AND request.status = 'applied'::"CorrectionRequestStatus"
      AND request."proposedCorrection" ? target_field
  )
$$;

CREATE OR REPLACE FUNCTION mcm_correction_guard_sample_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."collectedAt" IS DISTINCT FROM OLD."collectedAt"
    AND mcm_correction_field_is_masked('biosample'::"CorrectionDomain", OLD.id, 'collectedAt')
  THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'collectedAt is locked by an applied biosample correction'; END IF;
  IF NEW.notes IS DISTINCT FROM OLD.notes
    AND mcm_correction_field_is_masked('biosample'::"CorrectionDomain", OLD.id, 'notes')
  THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'notes is locked by an applied biosample correction'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mcm_correction_guard_litter_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."birthDate" IS DISTINCT FROM OLD."birthDate"
    AND mcm_correction_field_is_masked('litter_birth'::"CorrectionDomain", OLD.id, 'birthDate')
  THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'birthDate is locked by an applied litter correction'; END IF;
  IF NEW.notes IS DISTINCT FROM OLD.notes
    AND mcm_correction_field_is_masked('litter_birth'::"CorrectionDomain", OLD.id, 'notes')
  THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'notes is locked by an applied litter correction'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mcm_correction_guard_transfer_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reason IS DISTINCT FROM OLD.reason
    AND mcm_correction_field_is_masked('cross_lab_transfer'::"CorrectionDomain", OLD.id, 'reason')
  THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'reason is locked by an applied transfer correction'; END IF;
  IF NEW."requestedEffectiveAt" IS DISTINCT FROM OLD."requestedEffectiveAt"
    AND mcm_correction_field_is_masked('cross_lab_transfer'::"CorrectionDomain", OLD.id, 'requestedEffectiveAt')
  THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'requestedEffectiveAt is locked by an applied transfer correction'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mcm_correction_immutable_movement_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'
  THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'AnimalMovement is immutable operational history';
END $$;

CREATE TRIGGER "CorrectionRequest_insert_guard" BEFORE INSERT ON "CorrectionRequest" FOR EACH ROW EXECUTE FUNCTION mcm_correction_request_insert_guard();
CREATE TRIGGER "CorrectionRequest_update_delete_guard" BEFORE UPDATE OR DELETE ON "CorrectionRequest" FOR EACH ROW EXECUTE FUNCTION mcm_correction_request_update_guard();
CREATE CONSTRAINT TRIGGER "CorrectionRequest_pair_guard" AFTER INSERT OR UPDATE ON "CorrectionRequest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mcm_correction_require_pair();
CREATE TRIGGER "CorrectionLifecycleEvent_insert_guard" BEFORE INSERT ON "CorrectionLifecycleEvent" FOR EACH ROW EXECUTE FUNCTION mcm_correction_event_guard();
CREATE CONSTRAINT TRIGGER "CorrectionLifecycleEvent_reverse_pair_guard" AFTER INSERT ON "CorrectionLifecycleEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mcm_correction_event_requires_request_mutation();
CREATE TRIGGER "CorrectionLifecycleEvent_immutable" BEFORE UPDATE OR DELETE ON "CorrectionLifecycleEvent" FOR EACH ROW EXECUTE FUNCTION mcm_correction_immutable();
CREATE TRIGGER "CorrectionSupersession_insert_guard" BEFORE INSERT ON "CorrectionSupersession" FOR EACH ROW EXECUTE FUNCTION mcm_correction_supersession_guard();
CREATE CONSTRAINT TRIGGER "CorrectionSupersession_reverse_pair_guard" AFTER INSERT ON "CorrectionSupersession" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mcm_correction_application_requires_transition();
CREATE TRIGGER "CorrectionSupersession_immutable" BEFORE UPDATE OR DELETE ON "CorrectionSupersession" FOR EACH ROW EXECUTE FUNCTION mcm_correction_immutable();
CREATE TRIGGER "CorrectionReconciliation_insert_guard" BEFORE INSERT ON "CorrectionReconciliation" FOR EACH ROW EXECUTE FUNCTION mcm_correction_reconciliation_guard();
CREATE CONSTRAINT TRIGGER "CorrectionReconciliation_reverse_pair_guard" AFTER INSERT ON "CorrectionReconciliation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION mcm_correction_application_requires_transition();
CREATE TRIGGER "CorrectionReconciliation_immutable" BEFORE UPDATE OR DELETE ON "CorrectionReconciliation" FOR EACH ROW EXECUTE FUNCTION mcm_correction_immutable();

CREATE TRIGGER "CorrectionRequest_no_truncate" BEFORE TRUNCATE ON "CorrectionRequest" EXECUTE FUNCTION mcm_correction_reject_truncate();
CREATE TRIGGER "CorrectionLifecycleEvent_no_truncate" BEFORE TRUNCATE ON "CorrectionLifecycleEvent" EXECUTE FUNCTION mcm_correction_reject_truncate();
CREATE TRIGGER "CorrectionSupersession_no_truncate" BEFORE TRUNCATE ON "CorrectionSupersession" EXECUTE FUNCTION mcm_correction_reject_truncate();
CREATE TRIGGER "CorrectionReconciliation_no_truncate" BEFORE TRUNCATE ON "CorrectionReconciliation" EXECUTE FUNCTION mcm_correction_reject_truncate();

CREATE TRIGGER "SampleRecord_corrected_field_guard" BEFORE UPDATE ON "SampleRecord" FOR EACH ROW EXECUTE FUNCTION mcm_correction_guard_sample_fields();
CREATE TRIGGER "Litter_corrected_field_guard" BEFORE UPDATE ON "Litter" FOR EACH ROW EXECUTE FUNCTION mcm_correction_guard_litter_fields();
CREATE TRIGGER "LabTransferRequest_corrected_field_guard" BEFORE UPDATE ON "LabTransferRequest" FOR EACH ROW EXECUTE FUNCTION mcm_correction_guard_transfer_fields();
CREATE TRIGGER "AnimalMovement_correction_source_immutable" BEFORE UPDATE OR DELETE ON "AnimalMovement" FOR EACH ROW EXECUTE FUNCTION mcm_correction_immutable_movement_source();

COMMIT;
