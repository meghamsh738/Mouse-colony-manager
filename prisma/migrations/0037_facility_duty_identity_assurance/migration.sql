BEGIN;

CREATE TYPE "FacilityDuty" AS ENUM (
  'designated_veterinarian',
  'welfare_officer',
  'protocol_reviewer',
  'training_administrator',
  'billing_administrator',
  'data_steward'
);

CREATE TYPE "FacilityDutyRequestType" AS ENUM ('grant', 'revoke');
CREATE TYPE "FacilityDutyRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired');
CREATE TYPE "FacilityDutyEventType" AS ENUM ('requested', 'approved', 'rejected', 'expired', 'activated', 'revoked');
CREATE TYPE "ExternalIdentityProvider" AS ENUM ('synthetic', 'oidc', 'saml');
CREATE TYPE "IdentityAssuranceLevel" AS ENUM ('password', 'mfa', 'phishing_resistant', 'synthetic_mfa');
CREATE TYPE "ExternalIdentityEventType" AS ENUM ('linked', 'assurance_changed', 'revoked');

CREATE TABLE "FacilityDutyRequest" (
  id TEXT PRIMARY KEY,
  "requestType" "FacilityDutyRequestType" NOT NULL,
  duty "FacilityDuty" NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "targetAuthzVersion" INTEGER NOT NULL,
  "assignmentId" TEXT,
  "assignmentVersion" INTEGER,
  "requestedValidFrom" TIMESTAMPTZ,
  "requestedValidUntil" TIMESTAMPTZ,
  status "FacilityDutyRequestStatus" NOT NULL DEFAULT 'pending',
  reason TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "requestedByAuthzVersion" INTEGER NOT NULL,
  "requestedAssurance" "IdentityAssuranceLevel" NOT NULL,
  "requestedIdentityLinkId" TEXT NOT NULL,
  "requestedAuthenticatedAt" TIMESTAMPTZ NOT NULL,
  "decidedById" TEXT,
  "decidedByAuthzVersion" INTEGER,
  "decidedAssurance" "IdentityAssuranceLevel",
  "decidedIdentityLinkId" TEXT,
  "decidedAuthenticatedAt" TIMESTAMPTZ,
  "decisionReason" TEXT,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "decidedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "FacilityDutyRequest_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FacilityDutyRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FacilityDutyRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FacilityDutyRequest_snapshot_check" CHECK ("targetAuthzVersion" > 0 AND "requestedByAuthzVersion" > 0 AND ("decidedByAuthzVersion" IS NULL OR "decidedByAuthzVersion" > 0)),
  CONSTRAINT "FacilityDutyRequest_reason_check" CHECK (char_length(btrim(reason)) BETWEEN 5 AND 500),
  CONSTRAINT "FacilityDutyRequest_expiry_check" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '24 hours'),
  CONSTRAINT "FacilityDutyRequest_binding_check" CHECK (
    (
      "requestType" = 'grant'
      AND "assignmentId" IS NULL
      AND "assignmentVersion" IS NULL
      AND "requestedValidFrom" IS NOT NULL
      AND "requestedValidUntil" IS NOT NULL
      AND "requestedValidUntil" >= "requestedValidFrom" + INTERVAL '1 minute'
      AND "requestedValidUntil" <= "requestedValidFrom" + INTERVAL '366 days'
    )
    OR
    (
      "requestType" = 'revoke'
      AND "assignmentId" IS NOT NULL
      AND "assignmentVersion" IS NOT NULL
      AND "assignmentVersion" > 0
      AND "requestedValidFrom" IS NULL
      AND "requestedValidUntil" IS NULL
    )
  ),
  CONSTRAINT "FacilityDutyRequest_decision_check" CHECK (
    (status = 'pending' AND "decidedById" IS NULL AND "decidedByAuthzVersion" IS NULL AND "decidedAssurance" IS NULL AND "decidedIdentityLinkId" IS NULL AND "decidedAuthenticatedAt" IS NULL AND "decidedAt" IS NULL AND "decisionReason" IS NULL)
    OR (status = 'expired' AND "decidedById" IS NULL AND "decidedByAuthzVersion" IS NULL AND "decidedAssurance" IS NULL AND "decidedIdentityLinkId" IS NULL AND "decidedAuthenticatedAt" IS NULL AND "decidedAt" IS NULL)
    OR (status = 'approved' AND "decidedById" IS NOT NULL AND "decidedByAuthzVersion" IS NOT NULL AND "decidedAssurance" IS NOT NULL AND "decidedIdentityLinkId" IS NOT NULL AND "decidedAuthenticatedAt" IS NOT NULL AND "decidedAt" IS NOT NULL)
    OR (status = 'rejected' AND "decidedById" IS NOT NULL AND "decidedByAuthzVersion" IS NOT NULL AND "decidedAssurance" IS NOT NULL AND "decidedIdentityLinkId" IS NOT NULL AND "decidedAuthenticatedAt" IS NOT NULL AND "decidedAt" IS NOT NULL AND char_length(btrim("decisionReason")) BETWEEN 5 AND 500)
  ),
  CONSTRAINT "FacilityDutyRequest_independence_check" CHECK (
    "decidedById" IS NULL OR ("decidedById" <> "requestedById" AND "decidedById" <> "targetUserId")
  ),
  CONSTRAINT "FacilityDutyRequest_version_check" CHECK (version > 0)
);

CREATE TABLE "FacilityDutyAssignment" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  duty "FacilityDuty" NOT NULL,
  "validFrom" TIMESTAMPTZ NOT NULL,
  "validUntil" TIMESTAMPTZ NOT NULL,
  "grantRequestId" TEXT NOT NULL UNIQUE,
  "revokeRequestId" TEXT UNIQUE,
  "revokedAt" TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FacilityDutyAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FacilityDutyAssignment_grantRequestId_fkey" FOREIGN KEY ("grantRequestId") REFERENCES "FacilityDutyRequest"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FacilityDutyAssignment_revokeRequestId_fkey" FOREIGN KEY ("revokeRequestId") REFERENCES "FacilityDutyRequest"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FacilityDutyAssignment_validity_check" CHECK (
    "validUntil" >= "validFrom" + INTERVAL '1 minute'
    AND "validUntil" <= "validFrom" + INTERVAL '366 days'
  ),
  CONSTRAINT "FacilityDutyAssignment_revocation_check" CHECK (
    ("revokedAt" IS NULL AND "revokeRequestId" IS NULL)
    OR ("revokedAt" IS NOT NULL AND "revokeRequestId" IS NOT NULL)
  ),
  CONSTRAINT "FacilityDutyAssignment_version_check" CHECK (version > 0),
  CONSTRAINT "FacilityDutyAssignment_id_version_key" UNIQUE (id, version)
);

ALTER TABLE "FacilityDutyRequest"
  ADD CONSTRAINT "FacilityDutyRequest_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "FacilityDutyAssignment"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FacilityDutyLifecycleEvent" (
  id TEXT PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  "assignmentId" TEXT,
  "targetUserId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "eventType" "FacilityDutyEventType" NOT NULL,
  detail JSONB,
  "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FacilityDutyLifecycleEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FacilityDutyRequest"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FacilityDutyLifecycleEvent_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "FacilityDutyAssignment"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FacilityDutyLifecycleEvent_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FacilityDutyLifecycleEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ExternalIdentityLink" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  provider "ExternalIdentityProvider" NOT NULL,
  "providerSubject" TEXT NOT NULL,
  assurance "IdentityAssuranceLevel" NOT NULL,
  "linkedById" TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ExternalIdentityLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExternalIdentityLink_linkedById_fkey" FOREIGN KEY ("linkedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExternalIdentityLink_subject_check" CHECK (char_length(btrim("providerSubject")) BETWEEN 3 AND 320),
  CONSTRAINT "ExternalIdentityLink_lifecycle_check" CHECK ((active AND "revokedAt" IS NULL) OR (NOT active AND "revokedAt" IS NOT NULL)),
  CONSTRAINT "ExternalIdentityLink_version_check" CHECK (version > 0),
  CONSTRAINT "ExternalIdentityLink_provider_subject_key" UNIQUE (provider, "providerSubject"),
  CONSTRAINT "ExternalIdentityLink_user_provider_key" UNIQUE ("userId", provider)
);

CREATE TABLE "ExternalIdentityLifecycleEvent" (
  id TEXT PRIMARY KEY,
  "identityLinkId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "eventType" "ExternalIdentityEventType" NOT NULL,
  assurance "IdentityAssuranceLevel" NOT NULL,
  detail JSONB,
  "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalIdentityLifecycleEvent_identityLinkId_fkey" FOREIGN KEY ("identityLinkId") REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ExternalIdentityLifecycleEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "FacilityDutyRequest"
  ADD CONSTRAINT "FacilityDutyRequest_requestedIdentityLinkId_fkey"
  FOREIGN KEY ("requestedIdentityLinkId") REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FacilityDutyRequest_decidedIdentityLinkId_fkey"
  FOREIGN KEY ("decidedIdentityLinkId") REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "FacilityDutyRequest_status_expiresAt_idx" ON "FacilityDutyRequest"(status, "expiresAt");
CREATE INDEX "FacilityDutyRequest_targetUserId_duty_status_idx" ON "FacilityDutyRequest"("targetUserId", duty, status);
CREATE INDEX "FacilityDutyRequest_requestedById_status_idx" ON "FacilityDutyRequest"("requestedById", status);
CREATE INDEX "FacilityDutyRequest_requestedIdentityLinkId_idx" ON "FacilityDutyRequest"("requestedIdentityLinkId");
CREATE INDEX "FacilityDutyRequest_decidedIdentityLinkId_idx" ON "FacilityDutyRequest"("decidedIdentityLinkId");
CREATE INDEX "FacilityDutyRequest_assignmentId_assignmentVersion_idx" ON "FacilityDutyRequest"("assignmentId", "assignmentVersion");
CREATE UNIQUE INDEX "FacilityDutyRequest_pending_grant_key" ON "FacilityDutyRequest"("targetUserId", duty) WHERE status = 'pending' AND "requestType" = 'grant';
CREATE UNIQUE INDEX "FacilityDutyRequest_pending_revoke_key" ON "FacilityDutyRequest"("assignmentId") WHERE status = 'pending' AND "requestType" = 'revoke';
CREATE INDEX "FacilityDutyAssignment_userId_duty_validity_idx" ON "FacilityDutyAssignment"("userId", duty, "validFrom", "validUntil");
CREATE INDEX "FacilityDutyAssignment_validUntil_revokedAt_idx" ON "FacilityDutyAssignment"("validUntil", "revokedAt");
CREATE INDEX "FacilityDutyLifecycleEvent_requestId_occurredAt_idx" ON "FacilityDutyLifecycleEvent"("requestId", "occurredAt");
CREATE INDEX "FacilityDutyLifecycleEvent_assignmentId_occurredAt_idx" ON "FacilityDutyLifecycleEvent"("assignmentId", "occurredAt");
CREATE INDEX "FacilityDutyLifecycleEvent_targetUserId_occurredAt_idx" ON "FacilityDutyLifecycleEvent"("targetUserId", "occurredAt");
CREATE INDEX "ExternalIdentityLink_userId_active_idx" ON "ExternalIdentityLink"("userId", active);
CREATE INDEX "ExternalIdentityLifecycleEvent_identityLinkId_occurredAt_idx" ON "ExternalIdentityLifecycleEvent"("identityLinkId", "occurredAt");

CREATE FUNCTION "mcm_facility_admin_snapshot_is_current"(actor_id TEXT, actor_authz_version INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "User" actor
    WHERE actor.id = actor_id
      AND actor.active
      AND actor."authzVersion" = actor_authz_version
      AND actor.role IN ('facility_admin', 'admin')
  );
$$;

CREATE FUNCTION "mcm_identity_assurance_snapshot_is_current"(
  subject_user_id TEXT,
  identity_link_id TEXT,
  asserted_assurance "IdentityAssuranceLevel",
  authenticated_at TIMESTAMPTZ,
  evidence_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT authenticated_at IS NOT NULL
    AND evidence_at IS NOT NULL
    AND authenticated_at <= evidence_at
    AND authenticated_at >= evidence_at - INTERVAL '10 minutes'
    AND asserted_assurance IN ('mfa', 'phishing_resistant', 'synthetic_mfa')
    AND EXISTS (
      SELECT 1
      FROM "ExternalIdentityLink" identity_link
      WHERE identity_link.id = identity_link_id
        AND identity_link."userId" = subject_user_id
        AND identity_link.active
        AND identity_link."revokedAt" IS NULL
        AND identity_link.assurance = asserted_assurance
        AND (
          (asserted_assurance = 'synthetic_mfa' AND identity_link.provider = 'synthetic')
          OR (asserted_assurance IN ('mfa', 'phishing_resistant') AND identity_link.provider IN ('oidc', 'saml'))
        )
    );
$$;

CREATE FUNCTION "mcm_guard_facility_duty_request"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_record RECORD;
  assignment_record RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Facility duty requests must begin pending at version 1';
    END IF;
    IF NOT "mcm_facility_admin_snapshot_is_current"(NEW."requestedById", NEW."requestedByAuthzVersion") THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Facility duty requester authority snapshot is not current';
    END IF;
    IF NOT "mcm_identity_assurance_snapshot_is_current"(
      NEW."requestedById",
      NEW."requestedIdentityLinkId",
      NEW."requestedAssurance",
      NEW."requestedAuthenticatedAt",
      NEW."createdAt"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Facility duty requester assurance evidence is unavailable, stale, or mismatched';
    END IF;
    SELECT active, role, "authzVersion" INTO target_record FROM "User" WHERE id = NEW."targetUserId" FOR SHARE;
    IF NOT FOUND OR NOT target_record.active OR target_record.role = 'it_head' OR target_record."authzVersion" <> NEW."targetAuthzVersion" THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Facility duty target is unavailable or its authorization snapshot is stale';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - ARRAY['status','decidedById','decidedByAuthzVersion','decidedAssurance','decidedIdentityLinkId','decidedAuthenticatedAt','decisionReason','decidedAt','version']::text[])
      <> (to_jsonb(OLD) - ARRAY['status','decidedById','decidedByAuthzVersion','decidedAssurance','decidedIdentityLinkId','decidedAuthenticatedAt','decisionReason','decidedAt','version']::text[])
     OR NEW.version <> OLD.version + 1
     OR OLD.status <> 'pending'
     OR NEW.status NOT IN ('approved', 'rejected', 'expired') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Facility duty request identity, snapshots, and terminal history are immutable';
  END IF;

  IF NEW.status = 'expired' THEN
    RETURN NEW;
  END IF;

  IF OLD."expiresAt" <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Expired facility duty requests cannot be decided';
  END IF;
  IF NOT "mcm_facility_admin_snapshot_is_current"(OLD."requestedById", OLD."requestedByAuthzVersion")
     OR NOT "mcm_facility_admin_snapshot_is_current"(NEW."decidedById", NEW."decidedByAuthzVersion") THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Facility duty maker-checker authority changed';
  END IF;
  IF NOT "mcm_identity_assurance_snapshot_is_current"(
    NEW."decidedById",
    NEW."decidedIdentityLinkId",
    NEW."decidedAssurance",
    NEW."decidedAuthenticatedAt",
    NEW."decidedAt"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Facility duty decider assurance evidence is unavailable, stale, or mismatched';
  END IF;
  SELECT active, role, "authzVersion" INTO target_record FROM "User" WHERE id = OLD."targetUserId" FOR SHARE;
  IF NOT FOUND OR NOT target_record.active OR target_record.role = 'it_head' OR target_record."authzVersion" <> OLD."targetAuthzVersion" THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Facility duty target authorization snapshot changed';
  END IF;

  IF NEW.status = 'approved' AND OLD."requestType" = 'revoke' THEN
    SELECT id, "userId", duty, version, "revokedAt", "validUntil" INTO assignment_record
    FROM "FacilityDutyAssignment"
    WHERE id = OLD."assignmentId"
    FOR UPDATE;
    IF NOT FOUND
       OR assignment_record."userId" <> OLD."targetUserId"
       OR assignment_record.duty <> OLD.duty
       OR assignment_record.version <> OLD."assignmentVersion"
       OR assignment_record."revokedAt" IS NOT NULL
       OR assignment_record."validUntil" <= CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Facility duty revocation binding is stale';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "FacilityDutyRequest_governance_guard"
BEFORE INSERT OR UPDATE ON "FacilityDutyRequest"
FOR EACH ROW EXECUTE FUNCTION "mcm_guard_facility_duty_request"();

CREATE FUNCTION "mcm_guard_facility_duty_assignment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  grant_record RECORD;
  revoke_record RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NEW."userId", OLD."userId") || ':' || COALESCE(NEW.duty, OLD.duty)::text, 0));

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO grant_record FROM "FacilityDutyRequest" WHERE id = NEW."grantRequestId" FOR SHARE;
    IF NOT FOUND
       OR grant_record."requestType" <> 'grant'
       OR grant_record.status <> 'approved'
       OR grant_record."targetUserId" <> NEW."userId"
       OR grant_record.duty <> NEW.duty
       OR grant_record."requestedValidFrom" <> NEW."validFrom"
       OR grant_record."requestedValidUntil" <> NEW."validUntil" THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Facility duty assignment must match an approved immutable grant request';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "FacilityDutyAssignment" existing
      WHERE existing."userId" = NEW."userId"
        AND existing.duty = NEW.duty
        AND existing."revokedAt" IS NULL
        AND tstzrange(existing."validFrom", existing."validUntil", '[)') && tstzrange(NEW."validFrom", NEW."validUntil", '[)')
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23P01', MESSAGE = 'Facility duty assignments cannot overlap';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF current_setting('mcm.allow_destructive_seed', true) = 'true' THEN RETURN OLD; END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Facility duty assignment history cannot be deleted';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['revokeRequestId','revokedAt','version']::text[])
      <> (to_jsonb(OLD) - ARRAY['revokeRequestId','revokedAt','version']::text[])
     OR OLD."revokedAt" IS NOT NULL
     OR NEW."revokedAt" IS NULL
     OR NEW."revokeRequestId" IS NULL
     OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Facility duty assignment identity and validity are immutable; only one approved revocation is allowed';
  END IF;
  SELECT * INTO revoke_record FROM "FacilityDutyRequest" WHERE id = NEW."revokeRequestId" FOR SHARE;
  IF NOT FOUND
     OR revoke_record."requestType" <> 'revoke'
     OR revoke_record.status <> 'approved'
     OR revoke_record."assignmentId" <> OLD.id
     OR revoke_record."assignmentVersion" <> OLD.version
     OR revoke_record."targetUserId" <> OLD."userId"
     OR revoke_record.duty <> OLD.duty THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Facility duty revocation must match an approved immutable revoke request';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FacilityDutyAssignment_governance_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "FacilityDutyAssignment"
FOR EACH ROW EXECUTE FUNCTION "mcm_guard_facility_duty_assignment"();

CREATE FUNCTION "mcm_guard_external_identity_link"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_setting('mcm.allow_destructive_seed', true) = 'true' THEN RETURN OLD; END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'External identity link history cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['active','revokedAt','version']::text[])
      <> (to_jsonb(OLD) - ARRAY['active','revokedAt','version']::text[])
     OR NOT OLD.active OR NEW.active OR NEW."revokedAt" IS NULL OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'External identity mapping is immutable except for one revocation';
  END IF;
  UPDATE "User"
  SET "authzVersion" = "authzVersion" + 1
  WHERE id = OLD."userId";
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'External identity link user is unavailable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ExternalIdentityLink_governance_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "ExternalIdentityLink"
FOR EACH ROW EXECUTE FUNCTION "mcm_guard_external_identity_link"();

CREATE FUNCTION "mcm_guard_duty_lifecycle_event"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  request_record RECORD;
  assignment_record RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP IN ('DELETE', 'TRUNCATE') AND current_setting('mcm.allow_destructive_seed', true) = 'true' THEN
      RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL ELSE OLD END;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = TG_TABLE_NAME || ' is append-only lifecycle history';
  END IF;
  SELECT "targetUserId", duty INTO request_record FROM "FacilityDutyRequest" WHERE id = NEW."requestId";
  IF NOT FOUND OR request_record."targetUserId" <> NEW."targetUserId" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Facility duty event target must match its request';
  END IF;
  IF NEW."assignmentId" IS NOT NULL THEN
    SELECT "userId", duty INTO assignment_record FROM "FacilityDutyAssignment" WHERE id = NEW."assignmentId";
    IF NOT FOUND OR assignment_record."userId" <> NEW."targetUserId" OR assignment_record.duty <> request_record.duty THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Facility duty event assignment must match its request';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FacilityDutyLifecycleEvent_append_only"
BEFORE INSERT OR UPDATE OR DELETE ON "FacilityDutyLifecycleEvent"
FOR EACH ROW EXECUTE FUNCTION "mcm_guard_duty_lifecycle_event"();
CREATE TRIGGER "FacilityDutyLifecycleEvent_truncate_guard"
BEFORE TRUNCATE ON "FacilityDutyLifecycleEvent"
FOR EACH STATEMENT EXECUTE FUNCTION "mcm_guard_duty_lifecycle_event"();

CREATE FUNCTION "mcm_reject_lifecycle_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') AND current_setting('mcm.allow_destructive_seed', true) = 'true' THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL ELSE OLD END;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = TG_TABLE_NAME || ' is append-only lifecycle history';
END;
$$;

CREATE TRIGGER "ExternalIdentityLifecycleEvent_append_only"
BEFORE UPDATE OR DELETE ON "ExternalIdentityLifecycleEvent"
FOR EACH ROW EXECUTE FUNCTION "mcm_reject_lifecycle_mutation"();
CREATE TRIGGER "ExternalIdentityLifecycleEvent_truncate_guard"
BEFORE TRUNCATE ON "ExternalIdentityLifecycleEvent"
FOR EACH STATEMENT EXECUTE FUNCTION "mcm_reject_lifecycle_mutation"();

CREATE FUNCTION "mcm_guard_governance_truncate"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('mcm.allow_destructive_seed', true) = 'true' THEN RETURN NULL; END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = TG_TABLE_NAME || ' governance history cannot be truncated';
END;
$$;

CREATE TRIGGER "FacilityDutyRequest_delete_guard"
BEFORE DELETE ON "FacilityDutyRequest"
FOR EACH ROW EXECUTE FUNCTION "mcm_reject_lifecycle_mutation"();
CREATE TRIGGER "FacilityDutyRequest_truncate_guard"
BEFORE TRUNCATE ON "FacilityDutyRequest"
FOR EACH STATEMENT EXECUTE FUNCTION "mcm_guard_governance_truncate"();
CREATE TRIGGER "FacilityDutyAssignment_truncate_guard"
BEFORE TRUNCATE ON "FacilityDutyAssignment"
FOR EACH STATEMENT EXECUTE FUNCTION "mcm_guard_governance_truncate"();
CREATE TRIGGER "ExternalIdentityLink_truncate_guard"
BEFORE TRUNCATE ON "ExternalIdentityLink"
FOR EACH STATEMENT EXECUTE FUNCTION "mcm_guard_governance_truncate"();

COMMIT;
