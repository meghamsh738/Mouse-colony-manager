-- M16: repository-complete, synthetic-only operational reconciliation.
-- This migration adds append-only evidence and guarded workflow state. It does
-- not rewrite historical animal, cage, ownership, or movement evidence.

BEGIN;

-- Extend the exact M13 intake-personnel contract to the M16 authoritative
-- manifest confirmation command. Fail migration if the expected predecessor
-- definition is not present rather than silently weakening the guard.
DO $$
DECLARE
  original_definition TEXT;
  updated_definition TEXT;
  original_clause TEXT := 'WHEN NEW."commandType" LIKE ''animal_intake.%'' OR NEW."commandType" LIKE ''intake.%'' OR NEW."commandType" LIKE ''cage_intake.%''';
  updated_clause TEXT := 'WHEN NEW."commandType" = ''m16.shipment.confirm'' OR NEW."commandType" LIKE ''animal_intake.%'' OR NEW."commandType" LIKE ''intake.%'' OR NEW."commandType" LIKE ''cage_intake.%''';
BEGIN
  SELECT pg_get_functiondef('mcm_m13_guard_compliance_snapshot()'::regprocedure) INTO original_definition;
  updated_definition := replace(original_definition, original_clause, updated_clause);
  IF updated_definition = original_definition THEN
    RAISE EXCEPTION 'M16 could not extend the exact M13 intake personnel guard';
  END IF;
  EXECUTE updated_definition;
END $$;

ALTER TABLE "QuarantineCase"
  ADD COLUMN "releaseDutyAssignmentId" TEXT,
  ADD COLUMN "releaseDutyVersion" INTEGER,
  ADD COLUMN "releaseIdentityLinkId" TEXT,
  ADD COLUMN "releaseAuthenticatedAt" TIMESTAMPTZ(3),
  ADD COLUMN "releaseAuthzVersion" INTEGER,
  ADD COLUMN "releaseAssuranceLevel" TEXT,
  ADD COLUMN "releaseCommandReceiptId" TEXT;

ALTER TABLE "QuarantineCase"
  ADD CONSTRAINT "QuarantineCase_release_duty_fkey"
    FOREIGN KEY ("releaseDutyAssignmentId")
    REFERENCES "FacilityDutyAssignment"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "QuarantineCase_release_identity_fkey"
    FOREIGN KEY ("releaseIdentityLinkId") REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "QuarantineCase_release_receipt_fkey"
    FOREIGN KEY ("releaseCommandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "QuarantineCase_release_receipt_key" UNIQUE ("releaseCommandReceiptId"),
  ADD CONSTRAINT "QuarantineCase_release_evidence_complete_check" CHECK (
    status <> 'released'::"QuarantineCaseStatus" OR (
      "releaseDutyAssignmentId" IS NOT NULL AND "releaseDutyVersion" IS NOT NULL
      AND "releaseIdentityLinkId" IS NOT NULL AND "releaseAuthenticatedAt" IS NOT NULL
      AND "releaseAuthzVersion" IS NOT NULL AND "releaseAssuranceLevel" IS NOT NULL
      AND "releaseCommandReceiptId" IS NOT NULL
    )
  ) NOT VALID;

CREATE TABLE "ShipmentManifest" (
  id TEXT PRIMARY KEY,
  "labId" TEXT NOT NULL REFERENCES "Lab"(id) ON DELETE RESTRICT,
  "sourceType" TEXT NOT NULL CHECK ("sourceType" IN ('vendor','internal_transfer','other_controlled')),
  "sourceName" TEXT NOT NULL CHECK (char_length(btrim("sourceName")) BETWEEN 2 AND 160),
  "externalReference" TEXT NOT NULL CHECK (char_length(btrim("externalReference")) BETWEEN 2 AND 160),
  "expectedAt" TIMESTAMPTZ(3) NOT NULL,
  "healthEvidenceStatus" TEXT NOT NULL DEFAULT 'missing' CHECK ("healthEvidenceStatus" IN ('missing','pending','compatible','incompatible','positive')),
  "healthEvidenceSummary" TEXT,
  status TEXT NOT NULL DEFAULT 'expected' CHECK (status IN ('expected','receiving','partially_received','received','exception','cancelled')),
  "protocolAuthorizationId" TEXT REFERENCES "ProtocolAuthorization"(id) ON DELETE RESTRICT,
  "intakeBatchId" TEXT UNIQUE REFERENCES "AnimalIntakeBatch"(id) ON DELETE RESTRICT,
  "quarantineCaseId" TEXT UNIQUE REFERENCES "QuarantineCase"(id) ON DELETE RESTRICT,
  "createdById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT "ShipmentManifest_lab_source_reference_key" UNIQUE ("labId", "sourceType", "externalReference"),
  CONSTRAINT "ShipmentManifest_id_lab_key" UNIQUE (id, "labId"),
  CONSTRAINT "ShipmentManifest_health_summary_check" CHECK (
    "healthEvidenceStatus" IN ('missing','pending') OR char_length(btrim(COALESCE("healthEvidenceSummary",''))) >= 3
  )
);

CREATE INDEX "ShipmentManifest_lab_status_expected_idx" ON "ShipmentManifest"("labId", status, "expectedAt");

CREATE TABLE "ShipmentManifestItem" (
  id TEXT PRIMARY KEY,
  "manifestId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "expectedIdentifier" TEXT NOT NULL CHECK (char_length(btrim("expectedIdentifier")) BETWEEN 1 AND 160),
  "strainId" TEXT NOT NULL REFERENCES "Strain"(id) ON DELETE RESTRICT,
  "expectedSex" "Sex" NOT NULL,
  "expectedDob" DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'expected' CHECK (status IN ('expected','accepted','exception','missing')),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT "ShipmentManifestItem_manifest_fkey" FOREIGN KEY ("manifestId", "labId") REFERENCES "ShipmentManifest"(id, "labId") ON DELETE RESTRICT,
  CONSTRAINT "ShipmentManifestItem_manifest_identifier_key" UNIQUE ("manifestId", "expectedIdentifier"),
  CONSTRAINT "ShipmentManifestItem_id_manifest_key" UNIQUE (id, "manifestId")
);
CREATE INDEX "ShipmentManifestItem_lab_status_idx" ON "ShipmentManifestItem"("labId", status);

CREATE TABLE "ShipmentReceiptSession" (
  id TEXT PRIMARY KEY,
  "manifestId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','ready_for_confirmation','finalized','cancelled')),
  "startedById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finalizedById" TEXT REFERENCES "User"(id) ON DELETE RESTRICT,
  "finalizedAt" TIMESTAMPTZ(3),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT "ShipmentReceiptSession_manifest_fkey" FOREIGN KEY ("manifestId", "labId") REFERENCES "ShipmentManifest"(id, "labId") ON DELETE RESTRICT,
  CONSTRAINT "ShipmentReceiptSession_id_manifest_key" UNIQUE (id, "manifestId"),
  CONSTRAINT "ShipmentReceiptSession_finalize_check" CHECK (
    (status = 'finalized' AND "finalizedById" IS NOT NULL AND "finalizedAt" IS NOT NULL)
    OR (status <> 'finalized' AND "finalizedById" IS NULL AND "finalizedAt" IS NULL)
  )
);
CREATE UNIQUE INDEX "ShipmentReceiptSession_one_open_idx" ON "ShipmentReceiptSession"("manifestId") WHERE status IN ('in_progress','ready_for_confirmation');
CREATE INDEX "ShipmentReceiptSession_lab_status_idx" ON "ShipmentReceiptSession"("labId", status);

CREATE TABLE "ShipmentReceiptObservation" (
  id TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "manifestId" TEXT NOT NULL,
  "manifestItemId" TEXT,
  "labId" TEXT NOT NULL,
  "observedIdentifier" TEXT NOT NULL CHECK (char_length(btrim("observedIdentifier")) BETWEEN 1 AND 160),
  outcome TEXT NOT NULL CHECK (outcome IN ('matched','duplicate','unknown','mismatched','damaged','dead_on_arrival','rejected')),
  "observedSex" "Sex",
  "observedDob" DATE,
  "discrepancyCodes" JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("discrepancyCodes") = 'array'),
  "operationalCondition" TEXT,
  "observedById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "observedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "commandReceiptId" TEXT NOT NULL UNIQUE REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT,
  CONSTRAINT "ShipmentReceiptObservation_session_fkey" FOREIGN KEY ("sessionId", "manifestId") REFERENCES "ShipmentReceiptSession"(id, "manifestId") ON DELETE RESTRICT,
  CONSTRAINT "ShipmentReceiptObservation_item_fkey" FOREIGN KEY ("manifestItemId", "manifestId") REFERENCES "ShipmentManifestItem"(id, "manifestId") ON DELETE RESTRICT,
  CONSTRAINT "ShipmentReceiptObservation_session_identifier_key" UNIQUE ("sessionId", "observedIdentifier"),
  CONSTRAINT "ShipmentReceiptObservation_match_check" CHECK ((outcome IN ('matched','mismatched','damaged','dead_on_arrival') AND "manifestItemId" IS NOT NULL) OR outcome IN ('duplicate','unknown','rejected')),
  CONSTRAINT "ShipmentReceiptObservation_condition_check" CHECK (outcome = 'matched' OR char_length(btrim(COALESCE("operationalCondition",''))) >= 3)
);
CREATE INDEX "ShipmentReceiptObservation_manifest_time_idx" ON "ShipmentReceiptObservation"("manifestId", "observedAt");
CREATE INDEX "ShipmentReceiptObservation_lab_outcome_idx" ON "ShipmentReceiptObservation"("labId", outcome);

CREATE TABLE "ShipmentHealthEvidence" (
  id TEXT PRIMARY KEY,
  "manifestId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "evidenceType" TEXT NOT NULL CHECK ("evidenceType" IN ('vendor_certificate','sentinel_panel','transfer_health_packet')),
  "testCode" TEXT NOT NULL CHECK (char_length(btrim("testCode")) BETWEEN 2 AND 120),
  result TEXT NOT NULL CHECK (result IN ('negative','positive','inconclusive','incompatible')),
  "collectedAt" DATE NOT NULL,
  "issuedAt" TIMESTAMPTZ(3) NOT NULL,
  issuer TEXT NOT NULL CHECK (char_length(btrim(issuer)) BETWEEN 2 AND 160),
  "operationalSummary" TEXT NOT NULL CHECK (char_length(btrim("operationalSummary")) BETWEEN 3 AND 600),
  "recordedById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "commandReceiptId" TEXT NOT NULL UNIQUE REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT,
  CONSTRAINT "ShipmentHealthEvidence_manifest_fkey" FOREIGN KEY ("manifestId", "labId") REFERENCES "ShipmentManifest"(id, "labId") ON DELETE RESTRICT
);
CREATE INDEX "ShipmentHealthEvidence_manifest_issued_idx" ON "ShipmentHealthEvidence"("manifestId", "issuedAt");
CREATE INDEX "ShipmentHealthEvidence_lab_result_idx" ON "ShipmentHealthEvidence"("labId", result);

CREATE TABLE "ShipmentHealthDecision" (
  id TEXT PRIMARY KEY,
  "manifestId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('compatible','blocked')),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 600),
  "evidenceCount" INTEGER NOT NULL CHECK ("evidenceCount" > 0),
  "evidenceLatestAt" TIMESTAMPTZ(3) NOT NULL,
  "assessedById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "assessedByAuthzVersion" INTEGER NOT NULL CHECK ("assessedByAuthzVersion" > 0),
  "dutyAssignmentId" TEXT NOT NULL REFERENCES "FacilityDutyAssignment"(id) ON DELETE RESTRICT,
  "dutyAssignmentVersion" INTEGER NOT NULL CHECK ("dutyAssignmentVersion" > 0),
  "identityLinkId" TEXT NOT NULL REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT,
  "authenticatedAt" TIMESTAMPTZ(3) NOT NULL,
  "assuranceLevel" TEXT NOT NULL,
  "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "commandReceiptId" TEXT NOT NULL UNIQUE REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT,
  CONSTRAINT "ShipmentHealthDecision_manifest_fkey" FOREIGN KEY ("manifestId", "labId") REFERENCES "ShipmentManifest"(id, "labId") ON DELETE RESTRICT,
  CONSTRAINT "ShipmentHealthDecision_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT
);
CREATE INDEX "ShipmentHealthDecision_manifest_time_idx" ON "ShipmentHealthDecision"("manifestId", "decidedAt");
CREATE INDEX "ShipmentHealthDecision_lab_decision_idx" ON "ShipmentHealthDecision"("labId", decision);

CREATE TABLE "ShipmentReconciliationSummary" (
  id TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL UNIQUE REFERENCES "ShipmentReceiptSession"(id) ON DELETE RESTRICT,
  "manifestId" TEXT NOT NULL UNIQUE REFERENCES "ShipmentManifest"(id) ON DELETE RESTRICT,
  "labId" TEXT NOT NULL REFERENCES "Lab"(id) ON DELETE RESTRICT,
  "expectedCount" INTEGER NOT NULL CHECK ("expectedCount" >= 0),
  "acceptedCount" INTEGER NOT NULL CHECK ("acceptedCount" >= 0),
  "exceptionCount" INTEGER NOT NULL CHECK ("exceptionCount" >= 0),
  "missingCount" INTEGER NOT NULL CHECK ("missingCount" >= 0),
  "affectedIntakeBatchId" TEXT REFERENCES "AnimalIntakeBatch"(id) ON DELETE RESTRICT,
  "affectedQuarantineCaseId" TEXT REFERENCES "QuarantineCase"(id) ON DELETE RESTRICT,
  result TEXT NOT NULL CHECK (result IN ('received','partial','exception_only')),
  summary JSONB NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  "finalizedById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "finalizedAt" TIMESTAMPTZ(3) NOT NULL,
  "commandReceiptId" TEXT NOT NULL UNIQUE REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT,
  CONSTRAINT "ShipmentReconciliationSummary_count_check" CHECK ("acceptedCount" + "missingCount" <= "expectedCount")
);
CREATE INDEX "ShipmentReconciliationSummary_lab_time_idx" ON "ShipmentReconciliationSummary"("labId", "finalizedAt");

CREATE TABLE "CensusSession" (
  id TEXT PRIMARY KEY,
  "labId" TEXT NOT NULL REFERENCES "Lab"(id) ON DELETE RESTRICT,
  "facilityId" TEXT NOT NULL REFERENCES "Facility"(id) ON DELETE RESTRICT,
  "roomId" TEXT NOT NULL REFERENCES "Room"(id) ON DELETE RESTRICT,
  "rackLabel" TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','review','signed_off','cancelled')),
  "ownerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "startedById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "signedOffById" TEXT REFERENCES "User"(id) ON DELETE RESTRICT,
  "signedOffAt" TIMESTAMPTZ(3),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT "CensusSession_id_lab_key" UNIQUE (id, "labId"),
  CONSTRAINT "CensusSession_signoff_check" CHECK ((status = 'signed_off' AND "signedOffById" IS NOT NULL AND "signedOffAt" IS NOT NULL) OR status <> 'signed_off')
);
CREATE INDEX "CensusSession_lab_status_started_idx" ON "CensusSession"("labId", status, "startedAt");
CREATE INDEX "CensusSession_room_status_idx" ON "CensusSession"("roomId", status);

CREATE TABLE "CensusObservation" (
  id TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "cageId" TEXT REFERENCES "Cage"(id) ON DELETE RESTRICT,
  "observedIdentifier" TEXT NOT NULL CHECK (char_length(btrim("observedIdentifier")) BETWEEN 1 AND 160),
  "observedLiveCount" INTEGER CHECK ("observedLiveCount" >= 0),
  "observedMaleCount" INTEGER CHECK ("observedMaleCount" >= 0),
  "observedFemaleCount" INTEGER CHECK ("observedFemaleCount" >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('matched','count_mismatch','unknown','wrong_location','damaged_label','empty')),
  "discrepancyCodes" JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("discrepancyCodes") = 'array'),
  "operationalCondition" TEXT,
  "observedById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "observedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "commandReceiptId" TEXT NOT NULL UNIQUE REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT,
  CONSTRAINT "CensusObservation_session_fkey" FOREIGN KEY ("sessionId", "labId") REFERENCES "CensusSession"(id, "labId") ON DELETE RESTRICT,
  CONSTRAINT "CensusObservation_session_identifier_key" UNIQUE ("sessionId", "observedIdentifier"),
  CONSTRAINT "CensusObservation_cage_check" CHECK ((outcome IN ('matched','count_mismatch','wrong_location','damaged_label','empty') AND "cageId" IS NOT NULL) OR outcome = 'unknown'),
  CONSTRAINT "CensusObservation_count_sum_check" CHECK ("observedLiveCount" IS NULL OR COALESCE("observedMaleCount",0) + COALESCE("observedFemaleCount",0) <= "observedLiveCount")
);
CREATE INDEX "CensusObservation_session_time_idx" ON "CensusObservation"("sessionId", "observedAt");
CREATE INDEX "CensusObservation_lab_outcome_idx" ON "CensusObservation"("labId", outcome);

CREATE TABLE "CensusDiscrepancy" (
  id TEXT PRIMARY KEY,
  "sessionId" TEXT NOT NULL REFERENCES "CensusSession"(id) ON DELETE RESTRICT,
  "observationId" TEXT NOT NULL UNIQUE REFERENCES "CensusObservation"(id) ON DELETE RESTRICT,
  "labId" TEXT NOT NULL REFERENCES "Lab"(id) ON DELETE RESTRICT,
  "discrepancyType" TEXT NOT NULL CHECK ("discrepancyType" IN ('count','unknown','wrong_location','damaged_label','empty')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','resolved','signed_off','rejected')),
  "ownerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "resolutionReason" TEXT,
  "resolvedById" TEXT REFERENCES "User"(id) ON DELETE RESTRICT,
  "resolvedAt" TIMESTAMPTZ(3),
  "signedOffById" TEXT REFERENCES "User"(id) ON DELETE RESTRICT,
  "signedOffAt" TIMESTAMPTZ(3),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT "CensusDiscrepancy_resolution_check" CHECK (status IN ('open','assigned') OR char_length(btrim(COALESCE("resolutionReason",''))) >= 3)
);
CREATE INDEX "CensusDiscrepancy_lab_status_idx" ON "CensusDiscrepancy"("labId", status);
CREATE INDEX "CensusDiscrepancy_owner_status_idx" ON "CensusDiscrepancy"("ownerId", status);

CREATE TABLE "CageCapacityException" (
  id TEXT PRIMARY KEY,
  "cageId" TEXT NOT NULL REFERENCES "Cage"(id) ON DELETE RESTRICT,
  "labId" TEXT NOT NULL REFERENCES "Lab"(id) ON DELETE RESTRICT,
  "additionalCapacity" INTEGER NOT NULL CHECK ("additionalCapacity" BETWEEN 1 AND 20),
  reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 600),
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  "approvedById" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "revokedById" TEXT REFERENCES "User"(id) ON DELETE RESTRICT,
  "revokedAt" TIMESTAMPTZ(3),
  "revokeReason" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT "CageCapacityException_window_check" CHECK ("expiresAt" > "startsAt" AND "expiresAt" <= "startsAt" + INTERVAL '30 days'),
  CONSTRAINT "CageCapacityException_revoke_check" CHECK ((status = 'revoked' AND "revokedById" IS NOT NULL AND "revokedAt" IS NOT NULL AND char_length(btrim(COALESCE("revokeReason",''))) >= 3) OR status <> 'revoked')
);
CREATE UNIQUE INDEX "CageCapacityException_one_active_idx" ON "CageCapacityException"("cageId") WHERE status = 'active';
CREATE INDEX "CageCapacityException_lab_status_expiry_idx" ON "CageCapacityException"("labId", status, "expiresAt");

CREATE TABLE "TransferCustodyEvent" (
  id TEXT PRIMARY KEY,
  "requestId" TEXT NOT NULL REFERENCES "LabTransferRequest"(id) ON DELETE RESTRICT,
  "sourceLabId" TEXT NOT NULL REFERENCES "Lab"(id) ON DELETE RESTRICT,
  "destinationLabId" TEXT NOT NULL REFERENCES "Lab"(id) ON DELETE RESTRICT,
  "packetVersion" INTEGER NOT NULL CHECK ("packetVersion" > 0),
  "packetHash" TEXT NOT NULL CHECK (char_length("packetHash") = 64),
  "eventType" TEXT NOT NULL CHECK ("eventType" IN ('dispatched','dispatch_cancelled','destination_received','partial_failure')),
  "expectedItemCount" INTEGER NOT NULL CHECK ("expectedItemCount" >= 0),
  "observedItemCount" INTEGER NOT NULL CHECK ("observedItemCount" >= 0),
  "operationalFacts" JSONB NOT NULL CHECK (
    jsonb_typeof("operationalFacts") = 'object'
    AND ("operationalFacts" - ARRAY['policyMarker','quarantineRequired','packetFields','reason','healthStatus','quarantineStatus','treatmentStatus','licenceStatus','safetyStatus']::TEXT[]) = '{}'::jsonb
  ),
  "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "actorLabId" TEXT REFERENCES "Lab"(id) ON DELETE RESTRICT,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "commandReceiptId" TEXT NOT NULL UNIQUE REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT,
  CONSTRAINT "TransferCustodyEvent_lab_check" CHECK ("sourceLabId" <> "destinationLabId"),
  CONSTRAINT "TransferCustodyEvent_count_check" CHECK ("observedItemCount" <= "expectedItemCount")
);
CREATE UNIQUE INDEX "TransferCustodyEvent_dispatch_once_idx" ON "TransferCustodyEvent"("requestId") WHERE "eventType" = 'dispatched';
CREATE UNIQUE INDEX "TransferCustodyEvent_terminal_once_idx" ON "TransferCustodyEvent"("requestId") WHERE "eventType" IN ('dispatch_cancelled','destination_received','partial_failure');
CREATE INDEX "TransferCustodyEvent_request_time_idx" ON "TransferCustodyEvent"("requestId", "occurredAt");

CREATE TABLE "TransferCustodyExpectedItem" (
  id TEXT PRIMARY KEY,
  "custodyEventId" TEXT NOT NULL REFERENCES "TransferCustodyEvent"(id) ON DELETE RESTRICT,
  "requestId" TEXT NOT NULL REFERENCES "LabTransferRequest"(id) ON DELETE RESTRICT,
  "transferItemId" TEXT NOT NULL REFERENCES "LabTransferItem"(id) ON DELETE RESTRICT,
  "animalId" TEXT NOT NULL REFERENCES "Animal"(id) ON DELETE RESTRICT,
  "frozenIdentifier" TEXT NOT NULL CHECK (char_length(btrim("frozenIdentifier")) BETWEEN 1 AND 160),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransferCustodyExpectedItem_event_transfer_item_key" UNIQUE ("custodyEventId", "transferItemId"),
  CONSTRAINT "TransferCustodyExpectedItem_event_animal_key" UNIQUE ("custodyEventId", "animalId"),
  CONSTRAINT "TransferCustodyExpectedItem_event_identifier_key" UNIQUE ("custodyEventId", "frozenIdentifier")
);
CREATE INDEX "TransferCustodyExpectedItem_request_animal_idx" ON "TransferCustodyExpectedItem"("requestId", "animalId");

CREATE TABLE "TransferCustodyItemEvidence" (
  id TEXT PRIMARY KEY,
  "custodyEventId" TEXT NOT NULL REFERENCES "TransferCustodyEvent"(id) ON DELETE RESTRICT,
  "requestId" TEXT NOT NULL REFERENCES "LabTransferRequest"(id) ON DELETE RESTRICT,
  "expectedItemId" TEXT NOT NULL REFERENCES "TransferCustodyExpectedItem"(id) ON DELETE RESTRICT,
  "animalId" TEXT NOT NULL REFERENCES "Animal"(id) ON DELETE RESTRICT,
  "expectedIdentifier" TEXT NOT NULL,
  "observedIdentifier" TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('received','missing','mismatched','damaged','dead_on_arrival')),
  "operationalCondition" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransferCustodyItemEvidence_event_expected_item_key" UNIQUE ("custodyEventId", "expectedItemId"),
  CONSTRAINT "TransferCustodyItemEvidence_event_identifier_key" UNIQUE ("custodyEventId", "expectedIdentifier"),
  CONSTRAINT "TransferCustodyItemEvidence_condition_check" CHECK (outcome = 'received' OR char_length(btrim(COALESCE("operationalCondition",''))) >= 3)
);
CREATE INDEX "TransferCustodyItemEvidence_request_outcome_idx" ON "TransferCustodyItemEvidence"("requestId", outcome);

CREATE TABLE "TransferCustodyReconciliation" (
  id TEXT PRIMARY KEY,
  "requestId" TEXT NOT NULL REFERENCES "LabTransferRequest"(id) ON DELETE RESTRICT,
  "custodyEventId" TEXT NOT NULL UNIQUE REFERENCES "TransferCustodyEvent"(id) ON DELETE RESTRICT,
  "labId" TEXT NOT NULL REFERENCES "Lab"(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','signed_off','rejected')),
  "ownerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "resolutionReason" TEXT,
  "resolvedById" TEXT REFERENCES "User"(id) ON DELETE RESTRICT,
  "resolvedAt" TIMESTAMPTZ(3),
  "signedOffById" TEXT REFERENCES "User"(id) ON DELETE RESTRICT,
  "signedOffAt" TIMESTAMPTZ(3),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT "TransferCustodyReconciliation_resolution_check" CHECK (status = 'open' OR char_length(btrim(COALESCE("resolutionReason",''))) >= 3)
);
CREATE INDEX "TransferCustodyReconciliation_lab_status_idx" ON "TransferCustodyReconciliation"("labId", status);
CREATE INDEX "TransferCustodyReconciliation_request_status_idx" ON "TransferCustodyReconciliation"("requestId", status);

CREATE TABLE "OperationalReconciliationEvent" (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL CHECK (domain IN ('shipment','census','capacity','quarantine','transfer_custody')),
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "labId" TEXT NOT NULL REFERENCES "Lab"(id) ON DELETE RESTRICT,
  "eventType" TEXT NOT NULL,
  "previousStatus" TEXT,
  "resultingStatus" TEXT NOT NULL,
  "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
  "actorAuthzVersion" INTEGER NOT NULL,
  "actorRoleSnapshot" TEXT NOT NULL,
  "dutyAssignmentId" TEXT,
  "dutyAssignmentVersion" INTEGER,
  "identityLinkId" TEXT REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT,
  "authenticatedAt" TIMESTAMPTZ(3),
  "assuranceLevel" TEXT,
  evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence) = 'object' AND NOT (evidence ? 'sourcePrivateNote')),
  "commandReceiptId" TEXT NOT NULL UNIQUE REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationalReconciliationEvent_duty_fkey" FOREIGN KEY ("dutyAssignmentId") REFERENCES "FacilityDutyAssignment"(id) ON DELETE RESTRICT,
  CONSTRAINT "OperationalReconciliationEvent_duty_pair_check" CHECK (("dutyAssignmentId" IS NULL) = ("dutyAssignmentVersion" IS NULL))
);
CREATE INDEX "OperationalReconciliationEvent_domain_aggregate_time_idx" ON "OperationalReconciliationEvent"(domain, "aggregateId", "occurredAt");
CREATE INDEX "OperationalReconciliationEvent_lab_time_idx" ON "OperationalReconciliationEvent"("labId", "occurredAt");

CREATE FUNCTION "mcm_m16_destructive_seed_allowed"()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND current_setting('session_replication_role') = 'replica'
$$;

CREATE FUNCTION "mcm_m16_validate_cross_association"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF "mcm_m16_destructive_seed_allowed"() THEN RETURN NEW; END IF;
  CASE TG_TABLE_NAME
    WHEN 'ShipmentManifest' THEN
      IF NEW."protocolAuthorizationId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "ProtocolAuthorization" p WHERE p.id = NEW."protocolAuthorizationId" AND p."labId" = NEW."labId"
      ) THEN RAISE EXCEPTION 'Shipment manifest protocol must belong to the exact receiving lab'; END IF;
    WHEN 'ShipmentReceiptObservation' THEN
      IF NOT EXISTS (
        SELECT 1 FROM "ShipmentReceiptSession" s
        WHERE s.id = NEW."sessionId" AND s."manifestId" = NEW."manifestId" AND s."labId" = NEW."labId"
      ) THEN RAISE EXCEPTION 'Shipment observation session, manifest, and lab must be the exact same parent'; END IF;
      IF NEW."manifestItemId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "ShipmentManifestItem" i
        WHERE i.id = NEW."manifestItemId" AND i."manifestId" = NEW."manifestId" AND i."labId" = NEW."labId"
      ) THEN RAISE EXCEPTION 'Shipment observation item must belong to the exact manifest and lab'; END IF;
    WHEN 'ShipmentReconciliationSummary' THEN
      IF NOT EXISTS (
        SELECT 1 FROM "ShipmentReceiptSession" s JOIN "ShipmentManifest" m ON m.id = s."manifestId" AND m."labId" = s."labId"
        WHERE s.id = NEW."sessionId" AND s."manifestId" = NEW."manifestId" AND s."labId" = NEW."labId"
      ) THEN RAISE EXCEPTION 'Shipment summary session, manifest, and lab must be the exact same receipt'; END IF;
      IF NEW."affectedIntakeBatchId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "AnimalIntakeBatch" b WHERE b.id = NEW."affectedIntakeBatchId" AND b."labId" = NEW."labId"
      ) THEN RAISE EXCEPTION 'Shipment summary intake batch must belong to the exact receiving lab'; END IF;
      IF NEW."affectedQuarantineCaseId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "QuarantineCase" q
        WHERE q.id = NEW."affectedQuarantineCaseId" AND q."labId" = NEW."labId"
          AND q."intakeBatchId" IS NOT DISTINCT FROM NEW."affectedIntakeBatchId"
      ) THEN RAISE EXCEPTION 'Shipment summary quarantine case must match the exact intake batch and lab'; END IF;
    WHEN 'CensusSession' THEN
      IF NOT EXISTS (SELECT 1 FROM "Room" r WHERE r.id = NEW."roomId" AND r."facilityId" = NEW."facilityId") THEN
        RAISE EXCEPTION 'Census room must belong to the exact facility';
      END IF;
    WHEN 'CensusObservation' THEN
      IF NEW."cageId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "Cage" c WHERE c.id = NEW."cageId" AND c."labId" = NEW."labId"
      ) THEN RAISE EXCEPTION 'Census cage must belong to the exact census lab'; END IF;
      IF NEW.outcome IN ('matched','count_mismatch','damaged_label','empty') AND NOT EXISTS (
        SELECT 1 FROM "Cage" c JOIN "CensusSession" s ON s.id = NEW."sessionId" AND s."labId" = NEW."labId"
        WHERE c.id = NEW."cageId" AND c."labId" = NEW."labId" AND c."roomId" = s."roomId"
      ) THEN RAISE EXCEPTION 'Census in-room outcome requires a cage in the exact session room'; END IF;
      IF NEW.outcome = 'wrong_location' AND NOT EXISTS (
        SELECT 1 FROM "Cage" c JOIN "CensusSession" s ON s.id = NEW."sessionId" AND s."labId" = NEW."labId"
        WHERE c.id = NEW."cageId" AND c."labId" = NEW."labId" AND c."roomId" <> s."roomId"
      ) THEN RAISE EXCEPTION 'Census wrong-location outcome requires an authorized cage outside the session room'; END IF;
      IF NEW.outcome = 'unknown' AND NEW."cageId" IS NOT NULL THEN
        RAISE EXCEPTION 'Census unknown outcome cannot be associated to a known cage';
      END IF;
    WHEN 'CensusDiscrepancy' THEN
      IF NOT EXISTS (
        SELECT 1 FROM "CensusObservation" o JOIN "CensusSession" s ON s.id = o."sessionId" AND s."labId" = o."labId"
        WHERE o.id = NEW."observationId" AND o."sessionId" = NEW."sessionId" AND o."labId" = NEW."labId"
      ) THEN RAISE EXCEPTION 'Census discrepancy session, observation, and lab must be the exact same evidence'; END IF;
    WHEN 'CageCapacityException' THEN
      IF NOT EXISTS (SELECT 1 FROM "Cage" c WHERE c.id = NEW."cageId" AND c."labId" = NEW."labId") THEN
        RAISE EXCEPTION 'Capacity exception cage must belong to the exact lab';
      END IF;
    WHEN 'TransferCustodyEvent' THEN
      IF NOT EXISTS (
        SELECT 1 FROM "LabTransferRequest" r WHERE r.id = NEW."requestId"
          AND r."sourceLabId" = NEW."sourceLabId" AND r."destinationLabId" = NEW."destinationLabId"
      ) THEN RAISE EXCEPTION 'Custody event must match the exact transfer source and destination labs'; END IF;
    WHEN 'TransferCustodyExpectedItem' THEN
      IF NOT EXISTS (
        SELECT 1 FROM "TransferCustodyEvent" e
        JOIN "LabTransferItem" i ON i.id = NEW."transferItemId" AND i."requestId" = e."requestId" AND i."animalId" = NEW."animalId" AND i.active
        JOIN "Animal" a ON a.id = i."animalId"
        WHERE e.id = NEW."custodyEventId" AND e."requestId" = NEW."requestId" AND e."eventType" = 'dispatched'
          AND a."facilityAnimalId" = NEW."frozenIdentifier"
      ) THEN RAISE EXCEPTION 'Custody expected item must freeze the exact active transfer item, animal, and identifier'; END IF;
    WHEN 'TransferCustodyItemEvidence' THEN
      IF NOT EXISTS (
        SELECT 1 FROM "TransferCustodyEvent" e
        JOIN "TransferCustodyExpectedItem" x ON x.id = NEW."expectedItemId" AND x."requestId" = e."requestId"
          AND x."animalId" = NEW."animalId" AND x."frozenIdentifier" = NEW."expectedIdentifier"
        JOIN "TransferCustodyEvent" dispatch ON dispatch.id = x."custodyEventId" AND dispatch."requestId" = e."requestId"
          AND dispatch."eventType" = 'dispatched' AND dispatch."packetVersion" = e."packetVersion" AND dispatch."packetHash" = e."packetHash"
        JOIN "LabTransferItem" i ON i.id = x."transferItemId" AND i."requestId" = e."requestId" AND i."animalId" = NEW."animalId" AND i.active
        WHERE e.id = NEW."custodyEventId" AND e."requestId" = NEW."requestId"
          AND e."eventType" IN ('destination_received','partial_failure')
      ) THEN RAISE EXCEPTION 'Custody receipt item must match the exact frozen dispatched transfer item'; END IF;
    WHEN 'TransferCustodyReconciliation' THEN
      IF NOT EXISTS (
        SELECT 1 FROM "TransferCustodyEvent" e JOIN "LabTransferRequest" r ON r.id = e."requestId"
        WHERE e.id = NEW."custodyEventId" AND e."requestId" = NEW."requestId"
          AND e."destinationLabId" = NEW."labId" AND r."destinationLabId" = NEW."labId"
      ) THEN RAISE EXCEPTION 'Custody reconciliation event, request, and destination lab must be the exact same transfer'; END IF;
    ELSE RAISE EXCEPTION 'Unexpected M16 cross-association table %', TG_TABLE_NAME;
  END CASE;
  RETURN NEW;
END $$;

CREATE TRIGGER "ShipmentManifest_cross_association_guard" BEFORE INSERT OR UPDATE ON "ShipmentManifest" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_validate_cross_association"();
CREATE TRIGGER "ShipmentReceiptObservation_cross_association_guard" BEFORE INSERT OR UPDATE ON "ShipmentReceiptObservation" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_validate_cross_association"();
CREATE TRIGGER "ShipmentReconciliationSummary_cross_association_guard" BEFORE INSERT OR UPDATE ON "ShipmentReconciliationSummary" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_validate_cross_association"();
CREATE TRIGGER "CensusSession_cross_association_guard" BEFORE INSERT OR UPDATE ON "CensusSession" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_validate_cross_association"();
CREATE TRIGGER "CensusObservation_cross_association_guard" BEFORE INSERT OR UPDATE ON "CensusObservation" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_validate_cross_association"();
CREATE TRIGGER "CensusDiscrepancy_cross_association_guard" BEFORE INSERT OR UPDATE ON "CensusDiscrepancy" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_validate_cross_association"();
CREATE TRIGGER "CageCapacityException_cross_association_guard" BEFORE INSERT OR UPDATE ON "CageCapacityException" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_validate_cross_association"();
CREATE TRIGGER "TransferCustodyEvent_cross_association_guard" BEFORE INSERT OR UPDATE ON "TransferCustodyEvent" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_validate_cross_association"();
CREATE TRIGGER "TransferCustodyExpectedItem_cross_association_guard" BEFORE INSERT OR UPDATE ON "TransferCustodyExpectedItem" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_validate_cross_association"();
CREATE TRIGGER "TransferCustodyItemEvidence_cross_association_guard" BEFORE INSERT OR UPDATE ON "TransferCustodyItemEvidence" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_validate_cross_association"();
CREATE TRIGGER "TransferCustodyReconciliation_cross_association_guard" BEFORE INSERT OR UPDATE ON "TransferCustodyReconciliation" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_validate_cross_association"();

CREATE FUNCTION "mcm_m16_assert_command_context"(expected_lab TEXT)
RETURNS "CommandReceipt" LANGUAGE plpgsql AS $$
DECLARE receipt "CommandReceipt";
BEGIN
  SELECT * INTO receipt FROM "CommandReceipt"
  WHERE id = NULLIF(current_setting('mcm.reconciliation_receipt_id', true), '')
    AND "actorId" = NULLIF(current_setting('mcm.reconciliation_actor_id', true), '')
    AND "commandType" = NULLIF(current_setting('mcm.reconciliation_command_type', true), '')
    AND "commandType" LIKE 'm16.%'
    AND status = 'processing'::"CommandReceiptStatus"
    AND "transactionId" = txid_current()
    AND (expected_lab IS NULL OR "labId" = expected_lab);
  IF receipt.id IS NULL THEN
    RAISE EXCEPTION 'M16 state mutation requires the exact processing command receipt in the current transaction';
  END IF;
  RETURN receipt;
END $$;

CREATE FUNCTION "mcm_m16_derive_manifest_health_status"(manifest_id TEXT)
RETURNS TEXT LANGUAGE plpgsql STABLE AS $$
DECLARE
  evidence_count INTEGER;
  latest_evidence_at TIMESTAMPTZ(3);
  has_positive BOOLEAN;
  has_incompatible BOOLEAN;
  has_inconclusive BOOLEAN;
  compatible_decisions INTEGER;
  blocked_decisions INTEGER;
BEGIN
  SELECT count(*), max("recordedAt"), bool_or(result = 'positive'), bool_or(result = 'incompatible'), bool_or(result = 'inconclusive')
    INTO evidence_count, latest_evidence_at, has_positive, has_incompatible, has_inconclusive
  FROM "ShipmentHealthEvidence" WHERE "manifestId" = manifest_id;
  IF evidence_count = 0 THEN RETURN 'missing'; END IF;
  IF has_positive THEN RETURN 'positive'; END IF;
  IF has_incompatible THEN RETURN 'incompatible'; END IF;
  IF has_inconclusive THEN RETURN 'pending'; END IF;
  SELECT count(*) FILTER (WHERE decision = 'compatible'), count(*) FILTER (WHERE decision = 'blocked')
    INTO compatible_decisions, blocked_decisions
  FROM "ShipmentHealthDecision"
  WHERE "manifestId" = manifest_id AND "evidenceCount" = evidence_count AND "evidenceLatestAt" = latest_evidence_at;
  IF blocked_decisions > 0 THEN RETURN 'incompatible'; END IF;
  IF compatible_decisions > 0 THEN RETURN 'compatible'; END IF;
  RETURN 'pending';
END $$;

CREATE FUNCTION "mcm_m16_guard_state"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  lab_id TEXT;
  receipt "CommandReceipt";
  command_type TEXT;
  new_row JSONB;
  old_row JSONB;
BEGIN
  IF "mcm_m16_destructive_seed_allowed"() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'M16 reconciliation state is retained and cannot be deleted'; END IF;
  lab_id := NEW."labId";
  receipt := "mcm_m16_assert_command_context"(lab_id);
  command_type := receipt."commandType";
  new_row := to_jsonb(NEW);
  old_row := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;

  IF TG_OP = 'INSERT' THEN
    CASE TG_TABLE_NAME
      WHEN 'ShipmentManifest' THEN
        IF command_type <> 'm16.shipment.create' OR receipt."aggregateType" <> 'shipment_manifest'
           OR receipt."aggregateId" <> NEW.id OR NEW.status <> 'expected' OR NEW.version <> 1 THEN
          RAISE EXCEPTION 'Shipment manifest insert requires exact m16.shipment.create aggregate and initial state';
        END IF;
      WHEN 'ShipmentManifestItem' THEN
        IF command_type <> 'm16.shipment.create' OR receipt."aggregateType" <> 'shipment_manifest'
           OR receipt."aggregateId" <> NEW."manifestId" OR NEW.status <> 'expected' OR NEW.version <> 1 THEN
          RAISE EXCEPTION 'Shipment item insert requires exact m16.shipment.create manifest aggregate';
        END IF;
      WHEN 'ShipmentReceiptSession' THEN
        IF command_type <> 'm16.shipment.start_receipt' OR receipt."aggregateType" <> 'shipment_manifest'
           OR receipt."aggregateId" <> NEW."manifestId" OR NEW.status <> 'in_progress' OR NEW.version <> 1 THEN
          RAISE EXCEPTION 'Receipt session insert requires exact m16.shipment.start_receipt manifest aggregate';
        END IF;
      WHEN 'CensusSession' THEN
        IF command_type <> 'm16.census.start' OR receipt."aggregateType" <> 'census_session'
           OR receipt."aggregateId" <> NEW.id OR NEW.status <> 'in_progress' OR NEW.version <> 1 THEN
          RAISE EXCEPTION 'Census insert requires exact m16.census.start aggregate';
        END IF;
      WHEN 'CensusDiscrepancy' THEN
        IF command_type <> 'm16.census.observe' OR receipt."aggregateType" <> 'census_session'
           OR receipt."aggregateId" <> NEW."sessionId" OR NEW.status <> 'open' OR NEW.version <> 1 THEN
          RAISE EXCEPTION 'Census discrepancy insert requires exact m16.census.observe session aggregate';
        END IF;
      WHEN 'CageCapacityException' THEN
        IF command_type <> 'm16.capacity.grant' OR receipt."aggregateType" <> 'capacity_exception'
           OR receipt."aggregateId" <> NEW.id OR NEW.status <> 'active' OR NEW.version <> 1 THEN
          RAISE EXCEPTION 'Capacity exception insert requires exact m16.capacity.grant aggregate';
        END IF;
      WHEN 'TransferCustodyReconciliation' THEN
        IF command_type <> 'm16.transfer.receive' OR receipt."aggregateType" <> 'lab_transfer_request'
           OR receipt."aggregateId" <> NEW."requestId" OR NEW.status <> 'open' OR NEW.version <> 1 THEN
          RAISE EXCEPTION 'Custody reconciliation insert requires exact m16.transfer.receive request aggregate';
        END IF;
      ELSE RAISE EXCEPTION 'Unexpected guarded M16 state table %', TG_TABLE_NAME;
    END CASE;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW."labId" <> OLD."labId" OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'M16 state updates require immutable identity/lab and exact optimistic version increment';
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'ShipmentManifest' THEN
      IF command_type = 'm16.shipment.health_evidence' OR command_type = 'm16.shipment.health_decision' THEN
        IF receipt."aggregateType" <> 'shipment_manifest' OR receipt."aggregateId" <> NEW.id
           OR (new_row - ARRAY['healthEvidenceStatus','healthEvidenceSummary','updatedAt','version']::TEXT[])
              IS DISTINCT FROM (old_row - ARRAY['healthEvidenceStatus','healthEvidenceSummary','updatedAt','version']::TEXT[])
           OR NEW.status <> OLD.status
           OR NEW."healthEvidenceStatus" <> "mcm_m16_derive_manifest_health_status"(NEW.id) THEN
          RAISE EXCEPTION 'Shipment health update violates exact command, aggregate, field mask, or derived status';
        END IF;
      ELSIF command_type = 'm16.shipment.start_receipt' THEN
        IF receipt."aggregateType" <> 'shipment_manifest' OR receipt."aggregateId" <> NEW.id
           OR OLD.status <> 'expected' OR NEW.status <> 'receiving'
           OR (new_row - ARRAY['status','updatedAt','version']::TEXT[]) IS DISTINCT FROM (old_row - ARRAY['status','updatedAt','version']::TEXT[]) THEN
          RAISE EXCEPTION 'Shipment receiving transition requires exact start-receipt mutation';
        END IF;
      ELSIF command_type = 'm16.shipment.confirm' THEN
        IF receipt."aggregateType" <> 'shipment_receipt_session'
           OR NOT EXISTS (SELECT 1 FROM "ShipmentReceiptSession" s WHERE s.id = receipt."aggregateId" AND s."manifestId" = NEW.id)
           OR OLD.status <> 'receiving' OR NEW.status NOT IN ('received','partially_received','exception')
           OR (new_row - ARRAY['status','intakeBatchId','quarantineCaseId','updatedAt','version']::TEXT[])
              IS DISTINCT FROM (old_row - ARRAY['status','intakeBatchId','quarantineCaseId','updatedAt','version']::TEXT[]) THEN
          RAISE EXCEPTION 'Shipment finalization requires exact confirm command and field mask';
        END IF;
      ELSE RAISE EXCEPTION 'Command % cannot mutate ShipmentManifest', command_type;
      END IF;
    WHEN 'ShipmentManifestItem' THEN
      IF command_type <> 'm16.shipment.confirm' OR receipt."aggregateType" <> 'shipment_receipt_session'
         OR NOT EXISTS (SELECT 1 FROM "ShipmentReceiptSession" s WHERE s.id = receipt."aggregateId" AND s."manifestId" = NEW."manifestId")
         OR OLD.status <> 'expected' OR NEW.status NOT IN ('accepted','exception','missing')
         OR (new_row - ARRAY['status','version']::TEXT[]) IS DISTINCT FROM (old_row - ARRAY['status','version']::TEXT[]) THEN
        RAISE EXCEPTION 'Shipment item mutation requires exact confirm command and terminal field mask';
      END IF;
    WHEN 'ShipmentReceiptSession' THEN
      IF command_type = 'm16.shipment.observe' THEN
        IF receipt."aggregateType" <> 'shipment_receipt_session' OR receipt."aggregateId" <> NEW.id
           OR OLD.status NOT IN ('in_progress','ready_for_confirmation') OR NEW.status <> 'ready_for_confirmation'
           OR (new_row - ARRAY['status','version']::TEXT[]) IS DISTINCT FROM (old_row - ARRAY['status','version']::TEXT[]) THEN
          RAISE EXCEPTION 'Receipt observation requires exact session state mutation';
        END IF;
      ELSIF command_type = 'm16.shipment.confirm' THEN
        IF receipt."aggregateType" <> 'shipment_receipt_session' OR receipt."aggregateId" <> NEW.id
           OR OLD.status NOT IN ('in_progress','ready_for_confirmation') OR NEW.status <> 'finalized'
           OR NEW."finalizedById" <> receipt."actorId" OR NEW."finalizedAt" IS NULL
           OR (new_row - ARRAY['status','finalizedById','finalizedAt','version']::TEXT[])
              IS DISTINCT FROM (old_row - ARRAY['status','finalizedById','finalizedAt','version']::TEXT[]) THEN
          RAISE EXCEPTION 'Receipt finalization requires exact confirm command and evidence fields';
        END IF;
      ELSE RAISE EXCEPTION 'Command % cannot mutate ShipmentReceiptSession', command_type;
      END IF;
    WHEN 'CensusSession' THEN
      IF command_type = 'm16.census.observe' THEN
        IF receipt."aggregateType" <> 'census_session' OR receipt."aggregateId" <> NEW.id OR OLD.status <> 'in_progress' OR NEW.status <> OLD.status
           OR (new_row - 'version') IS DISTINCT FROM (old_row - 'version') THEN
          RAISE EXCEPTION 'Census observation may only increment the exact open session version';
        END IF;
      ELSIF command_type = 'm16.census.submit_review' THEN
        IF receipt."aggregateType" <> 'census_session' OR receipt."aggregateId" <> NEW.id OR OLD.status <> 'in_progress' OR NEW.status <> 'review'
           OR (new_row - ARRAY['status','version']::TEXT[]) IS DISTINCT FROM (old_row - ARRAY['status','version']::TEXT[]) THEN
          RAISE EXCEPTION 'Census review submission requires exact transition';
        END IF;
      ELSIF command_type = 'm16.census.sign_off' THEN
        IF receipt."aggregateType" <> 'census_session' OR receipt."aggregateId" <> NEW.id OR OLD.status <> 'review' OR NEW.status <> 'signed_off'
           OR NEW."signedOffById" <> receipt."actorId" OR NEW."signedOffAt" IS NULL
           OR (new_row - ARRAY['status','signedOffById','signedOffAt','version']::TEXT[])
              IS DISTINCT FROM (old_row - ARRAY['status','signedOffById','signedOffAt','version']::TEXT[]) THEN
          RAISE EXCEPTION 'Census sign-off requires exact independent sign-off transition';
        END IF;
        IF receipt."actorId" IN (NEW."startedById", NEW."ownerId")
           OR EXISTS (SELECT 1 FROM "CensusObservation" o WHERE o."sessionId" = NEW.id AND o."observedById" = receipt."actorId")
           OR EXISTS (SELECT 1 FROM "CensusDiscrepancy" d WHERE d."sessionId" = NEW.id AND d."resolvedById" = receipt."actorId") THEN
          RAISE EXCEPTION 'Census signer must be independent from starter, owner, every observer, and every discrepancy resolver';
        END IF;
      ELSIF command_type = 'm16.census.cancel' THEN
        IF receipt."aggregateType" <> 'census_session' OR receipt."aggregateId" <> NEW.id OR OLD.status NOT IN ('in_progress','review') OR NEW.status <> 'cancelled'
           OR (new_row - ARRAY['status','version']::TEXT[]) IS DISTINCT FROM (old_row - ARRAY['status','version']::TEXT[]) THEN
          RAISE EXCEPTION 'Census cancellation requires exact transition';
        END IF;
      ELSE RAISE EXCEPTION 'Command % cannot mutate CensusSession', command_type;
      END IF;
    WHEN 'CensusDiscrepancy' THEN
      IF receipt."aggregateType" <> 'census_discrepancy' OR receipt."aggregateId" <> NEW.id
         OR (new_row - ARRAY['status','resolutionReason','resolvedById','resolvedAt','signedOffById','signedOffAt','version']::TEXT[])
            IS DISTINCT FROM (old_row - ARRAY['status','resolutionReason','resolvedById','resolvedAt','signedOffById','signedOffAt','version']::TEXT[]) THEN
        RAISE EXCEPTION 'Census discrepancy mutation violates exact aggregate or field mask';
      END IF;
      IF command_type = 'm16.census.discrepancy_resolve' AND NOT (OLD.status IN ('open','assigned') AND NEW.status = 'resolved' AND NEW."resolvedById" = receipt."actorId" AND NEW."resolvedAt" IS NOT NULL)
         OR command_type = 'm16.census.discrepancy_sign_off' AND NOT (OLD.status = 'resolved' AND NEW.status = 'signed_off' AND NEW."signedOffById" = receipt."actorId" AND NEW."signedOffAt" IS NOT NULL)
         OR command_type = 'm16.census.discrepancy_reject' AND NOT (OLD.status IN ('open','assigned','resolved') AND NEW.status = 'rejected') THEN
        RAISE EXCEPTION 'Census discrepancy command does not match the requested transition';
      END IF;
      IF command_type NOT IN ('m16.census.discrepancy_resolve','m16.census.discrepancy_sign_off','m16.census.discrepancy_reject') THEN
        RAISE EXCEPTION 'Command % cannot mutate CensusDiscrepancy', command_type;
      END IF;
    WHEN 'CageCapacityException' THEN
      IF command_type <> 'm16.capacity.revoke' OR receipt."aggregateType" <> 'capacity_exception' OR receipt."aggregateId" <> NEW.id
         OR OLD.status <> 'active' OR NEW.status <> 'revoked' OR NEW."revokedById" <> receipt."actorId" OR NEW."revokedAt" IS NULL
         OR (new_row - ARRAY['status','revokedById','revokedAt','revokeReason','version']::TEXT[])
            IS DISTINCT FROM (old_row - ARRAY['status','revokedById','revokedAt','revokeReason','version']::TEXT[]) THEN
        RAISE EXCEPTION 'Capacity revocation requires exact command, transition, and field mask';
      END IF;
    WHEN 'TransferCustodyReconciliation' THEN
      IF receipt."aggregateType" <> 'transfer_custody_reconciliation' OR receipt."aggregateId" <> NEW.id
         OR (new_row - ARRAY['status','resolutionReason','resolvedById','resolvedAt','signedOffById','signedOffAt','version']::TEXT[])
            IS DISTINCT FROM (old_row - ARRAY['status','resolutionReason','resolvedById','resolvedAt','signedOffById','signedOffAt','version']::TEXT[]) THEN
        RAISE EXCEPTION 'Custody reconciliation mutation violates exact aggregate or field mask';
      END IF;
      IF command_type = 'm16.transfer.reconciliation_resolve' AND NOT (OLD.status = 'open' AND NEW.status = 'resolved' AND NEW."resolvedById" = receipt."actorId" AND NEW."resolvedAt" IS NOT NULL)
         OR command_type = 'm16.transfer.reconciliation_sign_off' AND NOT (OLD.status = 'resolved' AND NEW.status = 'signed_off' AND NEW."signedOffById" = receipt."actorId" AND NEW."signedOffAt" IS NOT NULL)
         OR command_type = 'm16.transfer.reconciliation_reject' AND NOT (OLD.status IN ('open','resolved') AND NEW.status = 'rejected') THEN
        RAISE EXCEPTION 'Custody reconciliation command does not match the requested transition';
      END IF;
      IF command_type NOT IN ('m16.transfer.reconciliation_resolve','m16.transfer.reconciliation_sign_off','m16.transfer.reconciliation_reject') THEN
        RAISE EXCEPTION 'Command % cannot mutate TransferCustodyReconciliation', command_type;
      END IF;
    ELSE RAISE EXCEPTION 'Unexpected guarded M16 state table %', TG_TABLE_NAME;
  END CASE;
  RETURN NEW;
END $$;

CREATE FUNCTION "mcm_m16_guard_append_only"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  receipt "CommandReceipt";
  evidence_count INTEGER;
  latest_evidence_at TIMESTAMPTZ(3);
  identity_assurance TEXT;
BEGIN
  IF "mcm_m16_destructive_seed_allowed"() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'M16 operational evidence is append-only'; END IF;
  receipt := "mcm_m16_assert_command_context"(NEW."labId");
  IF NEW."commandReceiptId" <> receipt.id THEN
    RAISE EXCEPTION 'M16 evidence requires the exact same-receipt command context';
  END IF;
  CASE TG_TABLE_NAME
    WHEN 'ShipmentReceiptObservation' THEN
      IF receipt."commandType" <> 'm16.shipment.observe' OR receipt."aggregateType" <> 'shipment_receipt_session' OR receipt."aggregateId" <> NEW."sessionId" OR NEW."observedById" <> receipt."actorId" THEN RAISE EXCEPTION 'M16 shipment observation requires exact command, actor, and aggregate'; END IF;
    WHEN 'ShipmentHealthEvidence' THEN
      IF receipt."commandType" <> 'm16.shipment.health_evidence' OR receipt."aggregateType" <> 'shipment_manifest' OR receipt."aggregateId" <> NEW."manifestId" OR NEW."recordedById" <> receipt."actorId" THEN RAISE EXCEPTION 'M16 health evidence requires exact recorder command, actor, and manifest'; END IF;
    WHEN 'ShipmentHealthDecision' THEN
      IF receipt."commandType" <> 'm16.shipment.health_decision' OR receipt."aggregateType" <> 'shipment_manifest' OR receipt."aggregateId" <> NEW."manifestId" OR NEW."assessedById" <> receipt."actorId" THEN
        RAISE EXCEPTION 'M16 health decision requires exact veterinary command, actor, and manifest';
      END IF;
      SELECT count(*), max("recordedAt") INTO evidence_count, latest_evidence_at FROM "ShipmentHealthEvidence" WHERE "manifestId" = NEW."manifestId";
      IF evidence_count = 0 OR NEW."evidenceCount" <> evidence_count OR NEW."evidenceLatestAt" <> latest_evidence_at THEN
        RAISE EXCEPTION 'Veterinary health decision must cover the exact current append-only evidence set';
      END IF;
      IF EXISTS (SELECT 1 FROM "ShipmentHealthEvidence" e WHERE e."manifestId" = NEW."manifestId" AND e."recordedById" = NEW."assessedById") THEN
        RAISE EXCEPTION 'Health evidence recorder cannot independently certify compatibility';
      END IF;
      IF NEW.decision = 'compatible' AND EXISTS (SELECT 1 FROM "ShipmentHealthEvidence" e WHERE e."manifestId" = NEW."manifestId" AND e.result <> 'negative') THEN
        RAISE EXCEPTION 'Compatibility requires an all-negative current evidence set';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM "FacilityDutyAssignment" d
        WHERE d.id = NEW."dutyAssignmentId" AND d.version = NEW."dutyAssignmentVersion"
          AND d."userId" = NEW."assessedById" AND d.duty = 'designated_veterinarian'::"FacilityDuty"
          AND d."revokedAt" IS NULL AND d."validFrom" <= CURRENT_TIMESTAMP AND d."validUntil" > CURRENT_TIMESTAMP
      ) THEN RAISE EXCEPTION 'Current Designated Veterinarian duty is required for health compatibility decision'; END IF;
      SELECT i.assurance::text INTO identity_assurance FROM "ExternalIdentityLink" i
      WHERE i.id = NEW."identityLinkId" AND i."userId" = NEW."assessedById" AND i.active AND i."revokedAt" IS NULL;
      IF identity_assurance IS NULL OR identity_assurance <> NEW."assuranceLevel"
         OR NEW."authenticatedAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
         OR NEW."authenticatedAt" > CURRENT_TIMESTAMP + INTERVAL '1 minute' THEN
        RAISE EXCEPTION 'Fresh current identity assurance is required for health compatibility decision';
      END IF;
    WHEN 'ShipmentReconciliationSummary' THEN
      IF receipt."commandType" <> 'm16.shipment.confirm' OR receipt."aggregateType" <> 'shipment_receipt_session' OR receipt."aggregateId" <> NEW."sessionId" OR NEW."finalizedById" <> receipt."actorId" THEN RAISE EXCEPTION 'M16 shipment summary requires exact confirmation command, actor, and session'; END IF;
    WHEN 'CensusObservation' THEN
      IF receipt."commandType" <> 'm16.census.observe' OR receipt."aggregateType" <> 'census_session' OR receipt."aggregateId" <> NEW."sessionId" OR NEW."observedById" <> receipt."actorId" THEN RAISE EXCEPTION 'M16 census observation requires exact command, actor, and session'; END IF;
    ELSE RAISE EXCEPTION 'Unexpected M16 evidence table %', TG_TABLE_NAME;
  END CASE;
  RETURN NEW;
END $$;

CREATE TRIGGER "ShipmentManifest_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ShipmentManifest" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_state"();
CREATE TRIGGER "ShipmentManifestItem_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ShipmentManifestItem" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_state"();
CREATE TRIGGER "ShipmentReceiptSession_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ShipmentReceiptSession" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_state"();
CREATE TRIGGER "CensusSession_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CensusSession" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_state"();
CREATE TRIGGER "CensusDiscrepancy_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CensusDiscrepancy" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_state"();
CREATE TRIGGER "CageCapacityException_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CageCapacityException" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_state"();
CREATE TRIGGER "TransferCustodyReconciliation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "TransferCustodyReconciliation" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_state"();
CREATE TRIGGER "ShipmentReceiptObservation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ShipmentReceiptObservation" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_append_only"();
CREATE TRIGGER "ShipmentHealthEvidence_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ShipmentHealthEvidence" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_append_only"();
CREATE TRIGGER "ShipmentHealthDecision_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ShipmentHealthDecision" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_append_only"();
CREATE TRIGGER "ShipmentReconciliationSummary_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ShipmentReconciliationSummary" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_append_only"();
CREATE TRIGGER "CensusObservation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CensusObservation" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_append_only"();

CREATE FUNCTION "mcm_m16_guard_transfer_append_only"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scope_lab TEXT; receipt "CommandReceipt"; request_row "LabTransferRequest"; dispatch_row "TransferCustodyEvent";
BEGIN
  IF "mcm_m16_destructive_seed_allowed"() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'M16 transfer custody evidence is append-only'; END IF;
  scope_lab := COALESCE(NEW."actorLabId", NEW."sourceLabId");
  receipt := "mcm_m16_assert_command_context"(scope_lab);
  IF NEW."commandReceiptId" <> receipt.id OR receipt."aggregateType" <> 'lab_transfer_request' OR receipt."aggregateId" <> NEW."requestId" THEN
    RAISE EXCEPTION 'M16 custody event requires exact same-receipt transfer aggregate parity';
  END IF;
  IF (NEW."eventType" = 'dispatched' AND receipt."commandType" <> 'm16.transfer.dispatch')
     OR (NEW."eventType" = 'dispatch_cancelled' AND receipt."commandType" <> 'm16.transfer.cancel_dispatch')
     OR (NEW."eventType" IN ('destination_received','partial_failure') AND receipt."commandType" <> 'm16.transfer.receive') THEN
    RAISE EXCEPTION 'M16 custody event type requires its exact command type';
  END IF;
  IF NEW."actorId" <> receipt."actorId" THEN RAISE EXCEPTION 'M16 custody event actor must match the command receipt'; END IF;
  SELECT * INTO request_row FROM "LabTransferRequest" WHERE id = NEW."requestId";
  IF request_row.id IS NULL OR request_row."sourceLabId" <> NEW."sourceLabId" OR request_row."destinationLabId" <> NEW."destinationLabId" THEN
    RAISE EXCEPTION 'M16 custody event must match the exact transfer labs';
  END IF;
  IF NEW."eventType" IN ('dispatched','dispatch_cancelled') AND NEW."actorLabId" IS DISTINCT FROM request_row."sourceLabId" THEN
    RAISE EXCEPTION 'Dispatch custody evidence requires source-lab command scope';
  END IF;
  IF NEW."eventType" IN ('destination_received','partial_failure') AND NEW."actorLabId" IS DISTINCT FROM request_row."destinationLabId" THEN
    RAISE EXCEPTION 'Destination custody evidence requires destination-lab command scope';
  END IF;
  IF NEW."eventType" = 'dispatched' THEN
    IF request_row.status <> 'destination_accepted'::"LabTransferRequestStatus"
       OR request_row."acceptedPacketVersion" IS DISTINCT FROM NEW."packetVersion"
       OR request_row."acceptedPacketHash" IS DISTINCT FROM NEW."packetHash"
       OR NEW."observedItemCount" <> NEW."expectedItemCount" THEN
      RAISE EXCEPTION 'Dispatch requires the exact accepted packet and full dispatched count';
    END IF;
  ELSE
    SELECT * INTO dispatch_row FROM "TransferCustodyEvent" WHERE "requestId" = NEW."requestId" AND "eventType" = 'dispatched';
    IF dispatch_row.id IS NULL OR dispatch_row."packetVersion" <> NEW."packetVersion" OR dispatch_row."packetHash" <> NEW."packetHash" OR dispatch_row."expectedItemCount" <> NEW."expectedItemCount" THEN
      RAISE EXCEPTION 'Terminal custody evidence requires the exact prior dispatch packet';
    END IF;
    IF NEW."eventType" = 'dispatch_cancelled' AND (request_row.status = 'finalized'::"LabTransferRequestStatus" OR NEW."observedItemCount" <> 0) THEN
      RAISE EXCEPTION 'Dispatch cancellation must precede finalization and report zero received items';
    END IF;
    IF NEW."eventType" IN ('destination_received','partial_failure') AND request_row.status <> 'finalized'::"LabTransferRequestStatus" THEN
      RAISE EXCEPTION 'Destination receipt requires the finalized transfer workflow';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "TransferCustodyEvent_guard" BEFORE INSERT OR UPDATE OR DELETE ON "TransferCustodyEvent" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_transfer_append_only"();

CREATE FUNCTION "mcm_m16_guard_custody_item"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF "mcm_m16_destructive_seed_allowed"() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'M16 transfer custody item evidence is append-only'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "TransferCustodyEvent" e JOIN "CommandReceipt" r ON r.id = e."commandReceiptId"
    WHERE e.id = NEW."custodyEventId" AND e."requestId" = NEW."requestId"
      AND r.id = NULLIF(current_setting('mcm.reconciliation_receipt_id', true), '')
      AND r."transactionId" = txid_current()
  ) THEN RAISE EXCEPTION 'Custody item evidence requires its same-receipt custody event'; END IF;
  IF TG_TABLE_NAME = 'TransferCustodyExpectedItem'
     AND NOT EXISTS (SELECT 1 FROM "TransferCustodyEvent" e WHERE e.id = NEW."custodyEventId" AND e."eventType" = 'dispatched') THEN
    RAISE EXCEPTION 'Frozen custody expected items require the same-receipt dispatch event';
  ELSIF TG_TABLE_NAME = 'TransferCustodyItemEvidence'
     AND NOT EXISTS (SELECT 1 FROM "TransferCustodyEvent" e WHERE e.id = NEW."custodyEventId" AND e."eventType" IN ('destination_received','partial_failure')) THEN
    RAISE EXCEPTION 'Custody receipt item evidence requires the same-receipt terminal event';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "TransferCustodyExpectedItem_guard" BEFORE INSERT OR UPDATE OR DELETE ON "TransferCustodyExpectedItem" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_custody_item"();
CREATE TRIGGER "TransferCustodyItemEvidence_guard" BEFORE INSERT OR UPDATE OR DELETE ON "TransferCustodyItemEvidence" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_custody_item"();

CREATE FUNCTION "mcm_m16_custody_item_parity"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE active_transfer_count INTEGER; expected_count INTEGER; item_count INTEGER; observed_count INTEGER; exception_count INTEGER;
BEGIN
  IF "mcm_m16_destructive_seed_allowed"() THEN RETURN NULL; END IF;
  SELECT count(*) INTO active_transfer_count
  FROM "LabTransferItem"
  WHERE "requestId" = NEW."requestId" AND active = TRUE;
  SELECT count(*) INTO expected_count FROM "TransferCustodyExpectedItem" WHERE "custodyEventId" = NEW.id AND "requestId" = NEW."requestId";
  SELECT count(*), count(*) FILTER (WHERE "observedIdentifier" IS NOT NULL), count(*) FILTER (WHERE outcome <> 'received')
    INTO item_count, observed_count, exception_count
  FROM "TransferCustodyItemEvidence" WHERE "custodyEventId" = NEW.id AND "requestId" = NEW."requestId";
  IF NEW."eventType" = 'dispatched' AND (
       active_transfer_count = 0
       OR NEW."expectedItemCount" <> active_transfer_count
       OR expected_count <> active_transfer_count
       OR item_count <> 0
     ) THEN
    RAISE EXCEPTION 'Dispatch custody expected-item set must exactly match the active transfer item count';
  END IF;
  IF NEW."eventType" = 'dispatch_cancelled' AND (expected_count <> 0 OR item_count <> 0) THEN
    RAISE EXCEPTION 'Dispatch and cancellation events cannot carry destination item evidence';
  END IF;
  IF NEW."eventType" IN ('destination_received','partial_failure') AND (expected_count <> 0 OR item_count <> NEW."expectedItemCount" OR observed_count <> NEW."observedItemCount") THEN
    RAISE EXCEPTION 'Destination custody item evidence must exactly match event counts';
  END IF;
  IF NEW."eventType" = 'destination_received' AND exception_count <> 0 THEN
    RAISE EXCEPTION 'Complete destination receipt cannot contain custody exceptions';
  END IF;
  IF NEW."eventType" = 'partial_failure' AND exception_count = 0 THEN
    RAISE EXCEPTION 'Partial custody failure requires at least one explicit item exception';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "TransferCustodyEvent_item_parity"
AFTER INSERT ON "TransferCustodyEvent" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "mcm_m16_custody_item_parity"();

CREATE FUNCTION "mcm_m16_forbid_truncate"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'M16 retained reconciliation state and evidence cannot be truncated';
END $$;
CREATE TRIGGER "ShipmentManifest_no_truncate" BEFORE TRUNCATE ON "ShipmentManifest" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "ShipmentManifestItem_no_truncate" BEFORE TRUNCATE ON "ShipmentManifestItem" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "ShipmentReceiptSession_no_truncate" BEFORE TRUNCATE ON "ShipmentReceiptSession" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "ShipmentReceiptObservation_no_truncate" BEFORE TRUNCATE ON "ShipmentReceiptObservation" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "ShipmentHealthEvidence_no_truncate" BEFORE TRUNCATE ON "ShipmentHealthEvidence" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "ShipmentHealthDecision_no_truncate" BEFORE TRUNCATE ON "ShipmentHealthDecision" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "ShipmentReconciliationSummary_no_truncate" BEFORE TRUNCATE ON "ShipmentReconciliationSummary" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "CensusSession_no_truncate" BEFORE TRUNCATE ON "CensusSession" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "CensusObservation_no_truncate" BEFORE TRUNCATE ON "CensusObservation" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "CensusDiscrepancy_no_truncate" BEFORE TRUNCATE ON "CensusDiscrepancy" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "CageCapacityException_no_truncate" BEFORE TRUNCATE ON "CageCapacityException" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "TransferCustodyEvent_no_truncate" BEFORE TRUNCATE ON "TransferCustodyEvent" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "TransferCustodyExpectedItem_no_truncate" BEFORE TRUNCATE ON "TransferCustodyExpectedItem" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "TransferCustodyItemEvidence_no_truncate" BEFORE TRUNCATE ON "TransferCustodyItemEvidence" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "TransferCustodyReconciliation_no_truncate" BEFORE TRUNCATE ON "TransferCustodyReconciliation" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE TRIGGER "OperationalReconciliationEvent_no_truncate" BEFORE TRUNCATE ON "OperationalReconciliationEvent" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();

CREATE FUNCTION "mcm_m16_guard_event"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt "CommandReceipt";
BEGIN
  IF "mcm_m16_destructive_seed_allowed"() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'M16 lifecycle events are append-only'; END IF;
  receipt := "mcm_m16_assert_command_context"(NEW."labId");
  IF NEW."commandReceiptId" <> receipt.id OR NEW."actorId" <> receipt."actorId" OR NEW."actorAuthzVersion" <> receipt."actorAuthzVersion"
     OR NEW."aggregateType" <> receipt."aggregateType" OR NEW."aggregateId" <> receipt."aggregateId" THEN
    RAISE EXCEPTION 'M16 event identity, authorization, and aggregate must match the exact command receipt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = NEW."actorId" AND u.active AND u."authzVersion" = NEW."actorAuthzVersion") THEN
    RAISE EXCEPTION 'M16 event actor authorization is no longer current';
  END IF;
  CASE receipt."commandType"
    WHEN 'm16.shipment.create' THEN IF NEW.domain <> 'shipment' OR NEW."eventType" <> 'created' THEN RAISE EXCEPTION 'M16 command requires exact shipment-created event'; END IF;
    WHEN 'm16.shipment.health_evidence' THEN IF NEW.domain <> 'shipment' OR NEW."eventType" <> 'health_evidence_recorded' THEN RAISE EXCEPTION 'M16 command requires exact health-evidence event'; END IF;
    WHEN 'm16.shipment.health_decision' THEN IF NEW.domain <> 'shipment' OR NEW."eventType" <> 'health_compatibility_decided' THEN RAISE EXCEPTION 'M16 command requires exact health-decision event'; END IF;
    WHEN 'm16.shipment.start_receipt' THEN IF NEW.domain <> 'shipment' OR NEW."eventType" <> 'receiving_started' THEN RAISE EXCEPTION 'M16 command requires exact receiving-start event'; END IF;
    WHEN 'm16.shipment.observe' THEN IF NEW.domain <> 'shipment' OR NEW."eventType" <> 'observation_recorded' THEN RAISE EXCEPTION 'M16 command requires exact shipment-observation event'; END IF;
    WHEN 'm16.shipment.confirm' THEN IF NEW.domain <> 'shipment' OR NEW."eventType" <> 'receipt_confirmed' THEN RAISE EXCEPTION 'M16 command requires exact shipment-confirm event'; END IF;
    WHEN 'm16.census.start' THEN IF NEW.domain <> 'census' OR NEW."eventType" <> 'started' THEN RAISE EXCEPTION 'M16 command requires exact census-start event'; END IF;
    WHEN 'm16.census.observe' THEN IF NEW.domain <> 'census' OR NEW."eventType" <> 'observation_recorded' THEN RAISE EXCEPTION 'M16 command requires exact census-observation event'; END IF;
    WHEN 'm16.census.submit_review' THEN IF NEW.domain <> 'census' OR NEW."eventType" <> 'submit_review' THEN RAISE EXCEPTION 'M16 command requires exact census-review event'; END IF;
    WHEN 'm16.census.sign_off' THEN IF NEW.domain <> 'census' OR NEW."eventType" <> 'sign_off' THEN RAISE EXCEPTION 'M16 command requires exact census-signoff event'; END IF;
    WHEN 'm16.census.cancel' THEN IF NEW.domain <> 'census' OR NEW."eventType" <> 'cancel' THEN RAISE EXCEPTION 'M16 command requires exact census-cancel event'; END IF;
    WHEN 'm16.census.discrepancy_resolve' THEN IF NEW.domain <> 'census' OR NEW."eventType" <> 'discrepancy_resolve' THEN RAISE EXCEPTION 'M16 command requires exact discrepancy-resolve event'; END IF;
    WHEN 'm16.census.discrepancy_sign_off' THEN IF NEW.domain <> 'census' OR NEW."eventType" <> 'discrepancy_sign_off' THEN RAISE EXCEPTION 'M16 command requires exact discrepancy-signoff event'; END IF;
    WHEN 'm16.census.discrepancy_reject' THEN IF NEW.domain <> 'census' OR NEW."eventType" <> 'discrepancy_reject' THEN RAISE EXCEPTION 'M16 command requires exact discrepancy-reject event'; END IF;
    WHEN 'm16.capacity.grant' THEN IF NEW.domain <> 'capacity' OR NEW."eventType" <> 'granted' THEN RAISE EXCEPTION 'M16 command requires exact capacity-grant event'; END IF;
    WHEN 'm16.capacity.revoke' THEN IF NEW.domain <> 'capacity' OR NEW."eventType" <> 'revoked' THEN RAISE EXCEPTION 'M16 command requires exact capacity-revoke event'; END IF;
    WHEN 'm16.transfer.dispatch' THEN IF NEW.domain <> 'transfer_custody' OR NEW."eventType" <> 'dispatched' THEN RAISE EXCEPTION 'M16 command requires exact custody-dispatch event'; END IF;
    WHEN 'm16.transfer.cancel_dispatch' THEN IF NEW.domain <> 'transfer_custody' OR NEW."eventType" <> 'dispatch_cancelled' THEN RAISE EXCEPTION 'M16 command requires exact custody-cancel event'; END IF;
    WHEN 'm16.transfer.receive' THEN IF NEW.domain <> 'transfer_custody' OR NEW."eventType" NOT IN ('destination_received','partial_failure') THEN RAISE EXCEPTION 'M16 command requires exact custody-receipt event'; END IF;
    WHEN 'm16.transfer.reconciliation_resolve' THEN IF NEW.domain <> 'transfer_custody' OR NEW."eventType" <> 'reconciliation_resolve' THEN RAISE EXCEPTION 'M16 command requires exact custody-resolution event'; END IF;
    WHEN 'm16.transfer.reconciliation_sign_off' THEN IF NEW.domain <> 'transfer_custody' OR NEW."eventType" <> 'reconciliation_sign_off' THEN RAISE EXCEPTION 'M16 command requires exact custody-signoff event'; END IF;
    WHEN 'm16.transfer.reconciliation_reject' THEN IF NEW.domain <> 'transfer_custody' OR NEW."eventType" <> 'reconciliation_reject' THEN RAISE EXCEPTION 'M16 command requires exact custody-reject event'; END IF;
    WHEN 'm16.quarantine.release' THEN IF NEW.domain <> 'quarantine' OR NEW."eventType" <> 'veterinary_release' THEN RAISE EXCEPTION 'M16 command requires exact quarantine-release event'; END IF;
    ELSE RAISE EXCEPTION 'Unknown M16 command/event matrix entry %', receipt."commandType";
  END CASE;
  IF NEW."dutyAssignmentId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "FacilityDutyAssignment" d
    WHERE d.id = NEW."dutyAssignmentId" AND d.version = NEW."dutyAssignmentVersion"
      AND d."userId" = NEW."actorId" AND d."revokedAt" IS NULL
      AND d."validFrom" <= CURRENT_TIMESTAMP AND d."validUntil" > CURRENT_TIMESTAMP
  ) THEN RAISE EXCEPTION 'M16 duty version is an insert-validated historical snapshot'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "OperationalReconciliationEvent_guard" BEFORE INSERT OR UPDATE OR DELETE ON "OperationalReconciliationEvent" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_guard_event"();

CREATE FUNCTION "mcm_m16_event_parity"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt "CommandReceipt"; audit_count INTEGER;
BEGIN
  IF "mcm_m16_destructive_seed_allowed"() THEN RETURN NULL; END IF;
  SELECT * INTO receipt FROM "CommandReceipt" WHERE id = NEW."commandReceiptId";
  IF receipt.status <> 'succeeded'::"CommandReceiptStatus" OR receipt."actorId" <> NEW."actorId"
     OR receipt."actorAuthzVersion" <> NEW."actorAuthzVersion" OR receipt."labId" <> NEW."labId"
     OR receipt."aggregateType" <> NEW."aggregateType" OR receipt."aggregateId" <> NEW."aggregateId"
     OR receipt."transactionId" <> txid_current() THEN
    RAISE EXCEPTION 'M16 event requires exact succeeded same-transaction receipt parity';
  END IF;
  SELECT count(*) INTO audit_count FROM "AuditLog" a
  WHERE a."commandReceiptId" = receipt.id AND a."actorId" = receipt."actorId"
    AND a."labId" = receipt."labId" AND a."commandType" = receipt."commandType"
    AND a."commandAggregateType" = receipt."aggregateType" AND a."commandAggregateId" = receipt."aggregateId";
  IF audit_count <> 1 THEN RAISE EXCEPTION 'M16 command requires exactly one matching audit row'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "OperationalReconciliationEvent_parity"
AFTER INSERT ON "OperationalReconciliationEvent" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "mcm_m16_event_parity"();

CREATE FUNCTION "mcm_m16_clinical_event_evidence_parity"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt "CommandReceipt"; evidence_count INTEGER;
BEGIN
  IF "mcm_m16_destructive_seed_allowed"() THEN RETURN NULL; END IF;
  SELECT * INTO receipt FROM "CommandReceipt" WHERE id = NEW."commandReceiptId";
  IF receipt."commandType" = 'm16.shipment.health_decision' THEN
    SELECT count(*) INTO evidence_count FROM "ShipmentHealthDecision" d
    WHERE d.id = NEW.evidence->>'healthDecisionId'
      AND d."commandReceiptId" = NEW."commandReceiptId"
      AND d."manifestId" = NEW."aggregateId" AND d."labId" = NEW."labId"
      AND d."assessedById" = NEW."actorId"
      AND d."assessedByAuthzVersion" = NEW."actorAuthzVersion"
      AND d."dutyAssignmentId" = NEW."dutyAssignmentId"
      AND d."dutyAssignmentVersion" = NEW."dutyAssignmentVersion"
      AND d."identityLinkId" = NEW."identityLinkId"
      AND d."authenticatedAt" = NEW."authenticatedAt"
      AND d."assuranceLevel" = NEW."assuranceLevel";
    IF evidence_count <> 1 THEN
      RAISE EXCEPTION 'Health decision event must exactly match immutable clinical decision evidence';
    END IF;
  ELSIF receipt."commandType" = 'm16.quarantine.release' THEN
    SELECT count(*) INTO evidence_count FROM "QuarantineCase" q
    WHERE q.id = NEW.evidence->>'quarantineCaseId'
      AND q.id = NEW."aggregateId" AND q."labId" = NEW."labId"
      AND q."releaseCommandReceiptId" = NEW."commandReceiptId"
      AND q."releasedById" = NEW."actorId"
      AND q."releaseAuthzVersion" = NEW."actorAuthzVersion"
      AND q."releaseDutyAssignmentId" = NEW."dutyAssignmentId"
      AND q."releaseDutyVersion" = NEW."dutyAssignmentVersion"
      AND q."releaseIdentityLinkId" = NEW."identityLinkId"
      AND q."releaseAuthenticatedAt" = NEW."authenticatedAt"
      AND q."releaseAssuranceLevel" = NEW."assuranceLevel";
    IF evidence_count <> 1 THEN
      RAISE EXCEPTION 'Quarantine release event must exactly match immutable clinical release evidence';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "OperationalReconciliationEvent_clinical_evidence_parity"
AFTER INSERT ON "OperationalReconciliationEvent" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "mcm_m16_clinical_event_evidence_parity"();

CREATE FUNCTION "mcm_m16_receipt_reverse_parity"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_count INTEGER;
  event_row "OperationalReconciliationEvent";
  effect_count INTEGER;
BEGIN
  IF "mcm_m16_destructive_seed_allowed"() OR NEW."commandType" NOT LIKE 'm16.%' OR NEW.status <> 'succeeded'::"CommandReceiptStatus" THEN RETURN NULL; END IF;
  SELECT count(*) INTO event_count FROM "OperationalReconciliationEvent" e
  WHERE e."commandReceiptId" = NEW.id AND e."actorId" = NEW."actorId" AND e."actorAuthzVersion" = NEW."actorAuthzVersion"
    AND e."labId" = NEW."labId" AND e."aggregateType" = NEW."aggregateType" AND e."aggregateId" = NEW."aggregateId";
  IF event_count <> 1 THEN RAISE EXCEPTION 'Successful M16 command requires exactly one same-receipt lifecycle event'; END IF;
  SELECT * INTO event_row FROM "OperationalReconciliationEvent" WHERE "commandReceiptId" = NEW.id;
  CASE NEW."commandType"
    WHEN 'm16.shipment.create' THEN
      SELECT count(*) INTO effect_count FROM "ShipmentManifest" m WHERE m.id = NEW."aggregateId" AND m."labId" = NEW."labId" AND m.status = event_row."resultingStatus" AND EXISTS (SELECT 1 FROM "ShipmentManifestItem" i WHERE i."manifestId" = m.id);
    WHEN 'm16.shipment.health_evidence' THEN
      SELECT count(*) INTO effect_count FROM "ShipmentHealthEvidence" e JOIN "ShipmentManifest" m ON m.id = e."manifestId" WHERE e."commandReceiptId" = NEW.id AND m.id = NEW."aggregateId" AND m."healthEvidenceStatus" = "mcm_m16_derive_manifest_health_status"(m.id);
    WHEN 'm16.shipment.health_decision' THEN
      SELECT count(*) INTO effect_count FROM "ShipmentHealthDecision" d JOIN "ShipmentManifest" m ON m.id = d."manifestId" WHERE d."commandReceiptId" = NEW.id AND m.id = NEW."aggregateId" AND m."healthEvidenceStatus" = "mcm_m16_derive_manifest_health_status"(m.id);
    WHEN 'm16.shipment.start_receipt' THEN
      SELECT count(*) INTO effect_count FROM "ShipmentManifest" m JOIN "ShipmentReceiptSession" s ON s."manifestId" = m.id WHERE m.id = NEW."aggregateId" AND m.status = 'receiving' AND s.id = event_row.evidence->>'sessionId' AND s.status = 'in_progress';
    WHEN 'm16.shipment.observe' THEN
      SELECT count(*) INTO effect_count FROM "ShipmentReceiptObservation" o JOIN "ShipmentReceiptSession" s ON s.id = o."sessionId" WHERE o."commandReceiptId" = NEW.id AND s.id = NEW."aggregateId" AND s.status = 'ready_for_confirmation';
    WHEN 'm16.shipment.confirm' THEN
      SELECT count(*) INTO effect_count
      FROM "ShipmentReconciliationSummary" x
      JOIN "ShipmentReceiptSession" s ON s.id = x."sessionId" AND s."manifestId" = x."manifestId" AND s."labId" = x."labId"
      JOIN "ShipmentManifest" m ON m.id = x."manifestId" AND m."labId" = x."labId"
      WHERE x."commandReceiptId" = NEW.id AND s.id = NEW."aggregateId" AND s.status = 'finalized'
        AND m.status IN ('received','partially_received','exception')
        AND m."intakeBatchId" IS NOT DISTINCT FROM x."affectedIntakeBatchId"
        AND m."quarantineCaseId" IS NOT DISTINCT FROM x."affectedQuarantineCaseId"
        AND (
          (x."acceptedCount" = 0 AND x."affectedIntakeBatchId" IS NULL AND x."affectedQuarantineCaseId" IS NULL)
          OR
          (x."acceptedCount" > 0 AND x."affectedIntakeBatchId" IS NOT NULL AND x."affectedQuarantineCaseId" IS NOT NULL
            AND EXISTS (SELECT 1 FROM "AnimalIntakeBatch" b WHERE b.id = x."affectedIntakeBatchId" AND b."labId" = x."labId")
            AND EXISTS (SELECT 1 FROM "QuarantineCase" q WHERE q.id = x."affectedQuarantineCaseId"
              AND q."labId" = x."labId" AND q."intakeBatchId" = x."affectedIntakeBatchId"))
        );
    WHEN 'm16.census.start' THEN
      SELECT count(*) INTO effect_count FROM "CensusSession" s WHERE s.id = NEW."aggregateId" AND s.status = 'in_progress';
    WHEN 'm16.census.observe' THEN
      SELECT count(*) INTO effect_count FROM "CensusObservation" o JOIN "CensusSession" s ON s.id = o."sessionId" WHERE o."commandReceiptId" = NEW.id AND s.id = NEW."aggregateId" AND s.status = 'in_progress';
    WHEN 'm16.census.submit_review' THEN SELECT count(*) INTO effect_count FROM "CensusSession" s WHERE s.id = NEW."aggregateId" AND s.status = 'review';
    WHEN 'm16.census.sign_off' THEN SELECT count(*) INTO effect_count FROM "CensusSession" s WHERE s.id = NEW."aggregateId" AND s.status = 'signed_off' AND s."signedOffById" = NEW."actorId";
    WHEN 'm16.census.cancel' THEN SELECT count(*) INTO effect_count FROM "CensusSession" s WHERE s.id = NEW."aggregateId" AND s.status = 'cancelled';
    WHEN 'm16.census.discrepancy_resolve' THEN SELECT count(*) INTO effect_count FROM "CensusDiscrepancy" d WHERE d.id = NEW."aggregateId" AND d.status = 'resolved' AND d."resolvedById" = NEW."actorId";
    WHEN 'm16.census.discrepancy_sign_off' THEN SELECT count(*) INTO effect_count FROM "CensusDiscrepancy" d WHERE d.id = NEW."aggregateId" AND d.status = 'signed_off' AND d."signedOffById" = NEW."actorId";
    WHEN 'm16.census.discrepancy_reject' THEN SELECT count(*) INTO effect_count FROM "CensusDiscrepancy" d WHERE d.id = NEW."aggregateId" AND d.status = 'rejected';
    WHEN 'm16.capacity.grant' THEN SELECT count(*) INTO effect_count FROM "CageCapacityException" x WHERE x.id = NEW."aggregateId" AND x.status = 'active';
    WHEN 'm16.capacity.revoke' THEN SELECT count(*) INTO effect_count FROM "CageCapacityException" x WHERE x.id = NEW."aggregateId" AND x.status = 'revoked' AND x."revokedById" = NEW."actorId";
    WHEN 'm16.transfer.dispatch' THEN SELECT count(*) INTO effect_count FROM "TransferCustodyEvent" e WHERE e."commandReceiptId" = NEW.id AND e."requestId" = NEW."aggregateId" AND e."eventType" = 'dispatched';
    WHEN 'm16.transfer.cancel_dispatch' THEN SELECT count(*) INTO effect_count FROM "TransferCustodyEvent" e WHERE e."commandReceiptId" = NEW.id AND e."requestId" = NEW."aggregateId" AND e."eventType" = 'dispatch_cancelled';
    WHEN 'm16.transfer.receive' THEN SELECT count(*) INTO effect_count FROM "TransferCustodyEvent" e WHERE e."commandReceiptId" = NEW.id AND e."requestId" = NEW."aggregateId" AND e."eventType" IN ('destination_received','partial_failure');
    WHEN 'm16.transfer.reconciliation_resolve' THEN SELECT count(*) INTO effect_count FROM "TransferCustodyReconciliation" x WHERE x.id = NEW."aggregateId" AND x.status = 'resolved' AND x."resolvedById" = NEW."actorId";
    WHEN 'm16.transfer.reconciliation_sign_off' THEN SELECT count(*) INTO effect_count FROM "TransferCustodyReconciliation" x WHERE x.id = NEW."aggregateId" AND x.status = 'signed_off' AND x."signedOffById" = NEW."actorId";
    WHEN 'm16.transfer.reconciliation_reject' THEN SELECT count(*) INTO effect_count FROM "TransferCustodyReconciliation" x WHERE x.id = NEW."aggregateId" AND x.status = 'rejected';
    WHEN 'm16.quarantine.release' THEN SELECT count(*) INTO effect_count FROM "QuarantineCase" q WHERE q.id = NEW."aggregateId" AND q.status = 'released'::"QuarantineCaseStatus" AND q."releaseCommandReceiptId" = NEW.id;
    ELSE RAISE EXCEPTION 'Unknown M16 command/effect matrix entry %', NEW."commandType";
  END CASE;
  IF effect_count <> 1 THEN
    IF NEW."commandType" = 'm16.shipment.confirm' THEN
      RAISE EXCEPTION 'Successful shipment confirmation requires exact manifest, receipt summary, intake batch, quarantine case, and lab lineage';
    END IF;
    RAISE EXCEPTION 'Successful M16 command requires its exact guarded state/evidence effect';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "CommandReceipt_m16_reverse_parity"
AFTER INSERT OR UPDATE ON "CommandReceipt" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "mcm_m16_receipt_reverse_parity"();

CREATE FUNCTION "mcm_m16_mutation_reverse_parity"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt "CommandReceipt"; event_count INTEGER; audit_count INTEGER;
BEGIN
  IF "mcm_m16_destructive_seed_allowed"() THEN RETURN NULL; END IF;
  SELECT * INTO receipt FROM "CommandReceipt"
  WHERE id = NULLIF(current_setting('mcm.reconciliation_receipt_id', true), '')
    AND status = 'succeeded'::"CommandReceiptStatus" AND "transactionId" = txid_current();
  IF receipt.id IS NULL THEN RAISE EXCEPTION 'M16 state/evidence mutation requires a succeeded same-transaction receipt'; END IF;
  SELECT count(*) INTO event_count FROM "OperationalReconciliationEvent" e WHERE e."commandReceiptId" = receipt.id;
  SELECT count(*) INTO audit_count FROM "AuditLog" a WHERE a."commandReceiptId" = receipt.id AND a."actorId" = receipt."actorId"
    AND a."labId" = receipt."labId" AND a."commandType" = receipt."commandType"
    AND a."commandAggregateType" = receipt."aggregateType" AND a."commandAggregateId" = receipt."aggregateId";
  IF event_count <> 1 OR audit_count <> 1 THEN RAISE EXCEPTION 'M16 state/evidence requires exact deferred event, audit, and receipt pairing'; END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "ShipmentManifest_reverse_parity" AFTER INSERT OR UPDATE ON "ShipmentManifest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();
CREATE CONSTRAINT TRIGGER "ShipmentManifestItem_reverse_parity" AFTER INSERT OR UPDATE ON "ShipmentManifestItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();
CREATE CONSTRAINT TRIGGER "ShipmentReceiptSession_reverse_parity" AFTER INSERT OR UPDATE ON "ShipmentReceiptSession" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();
CREATE CONSTRAINT TRIGGER "ShipmentReceiptObservation_reverse_parity" AFTER INSERT ON "ShipmentReceiptObservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();
CREATE CONSTRAINT TRIGGER "ShipmentHealthEvidence_reverse_parity" AFTER INSERT ON "ShipmentHealthEvidence" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();
CREATE CONSTRAINT TRIGGER "ShipmentHealthDecision_reverse_parity" AFTER INSERT ON "ShipmentHealthDecision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();
CREATE CONSTRAINT TRIGGER "ShipmentReconciliationSummary_reverse_parity" AFTER INSERT ON "ShipmentReconciliationSummary" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();
CREATE CONSTRAINT TRIGGER "CensusSession_reverse_parity" AFTER INSERT OR UPDATE ON "CensusSession" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();
CREATE CONSTRAINT TRIGGER "CensusObservation_reverse_parity" AFTER INSERT ON "CensusObservation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();
CREATE CONSTRAINT TRIGGER "CensusDiscrepancy_reverse_parity" AFTER INSERT OR UPDATE ON "CensusDiscrepancy" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();
CREATE CONSTRAINT TRIGGER "CageCapacityException_reverse_parity" AFTER INSERT OR UPDATE ON "CageCapacityException" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();
CREATE CONSTRAINT TRIGGER "TransferCustodyEvent_reverse_parity" AFTER INSERT ON "TransferCustodyEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();
CREATE CONSTRAINT TRIGGER "TransferCustodyExpectedItem_reverse_parity" AFTER INSERT ON "TransferCustodyExpectedItem" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();
CREATE CONSTRAINT TRIGGER "TransferCustodyItemEvidence_reverse_parity" AFTER INSERT ON "TransferCustodyItemEvidence" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();
CREATE CONSTRAINT TRIGGER "TransferCustodyReconciliation_reverse_parity" AFTER INSERT OR UPDATE ON "TransferCustodyReconciliation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();

CREATE FUNCTION "mcm_m16_quarantine_release_guard"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt "CommandReceipt"; identity_assurance TEXT;
BEGIN
  IF "mcm_m16_destructive_seed_allowed"() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD."releaseCommandReceiptId" IS NOT NULL THEN RAISE EXCEPTION 'M16 quarantine release evidence is retained and cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."releaseCommandReceiptId" IS NOT NULL AND (
    NEW."releaseDutyAssignmentId" IS DISTINCT FROM OLD."releaseDutyAssignmentId"
    OR NEW."releaseDutyVersion" IS DISTINCT FROM OLD."releaseDutyVersion"
    OR NEW."releaseIdentityLinkId" IS DISTINCT FROM OLD."releaseIdentityLinkId"
    OR NEW."releaseAuthenticatedAt" IS DISTINCT FROM OLD."releaseAuthenticatedAt"
    OR NEW."releaseAuthzVersion" IS DISTINCT FROM OLD."releaseAuthzVersion"
    OR NEW."releaseAssuranceLevel" IS DISTINCT FROM OLD."releaseAssuranceLevel"
    OR NEW."releaseCommandReceiptId" IS DISTINCT FROM OLD."releaseCommandReceiptId"
    OR NEW."releasedById" IS DISTINCT FROM OLD."releasedById"
    OR NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt"
    OR NEW."releaseReason" IS DISTINCT FROM OLD."releaseReason"
  ) THEN RAISE EXCEPTION 'M16 quarantine release evidence is sealed after first assignment'; END IF;
  IF NEW.status = 'released'::"QuarantineCaseStatus" AND OLD.status <> 'released'::"QuarantineCaseStatus" THEN
    receipt := "mcm_m16_assert_command_context"(NEW."labId");
    IF receipt."commandType" <> 'm16.quarantine.release' OR NEW."releaseCommandReceiptId" <> receipt.id
       OR NEW."releasedById" <> receipt."actorId" OR NEW."releaseAuthzVersion" <> receipt."actorAuthzVersion" THEN
      RAISE EXCEPTION 'Quarantine release requires exact M16 veterinary command evidence';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "FacilityDutyAssignment" d
      WHERE d.id = NEW."releaseDutyAssignmentId" AND d.version = NEW."releaseDutyVersion"
        AND d."userId" = receipt."actorId" AND d.duty = 'designated_veterinarian'::"FacilityDuty"
        AND d."revokedAt" IS NULL AND d."validFrom" <= CURRENT_TIMESTAMP AND d."validUntil" > CURRENT_TIMESTAMP
    ) THEN RAISE EXCEPTION 'Current Designated Veterinarian duty is required for release'; END IF;
    SELECT i.assurance::text INTO identity_assurance FROM "ExternalIdentityLink" i
    WHERE i.id = NEW."releaseIdentityLinkId" AND i."userId" = receipt."actorId" AND i.active AND i."revokedAt" IS NULL;
    IF identity_assurance IS NULL OR identity_assurance <> NEW."releaseAssuranceLevel"
       OR NEW."releaseAuthenticatedAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
       OR NEW."releaseAuthenticatedAt" > CURRENT_TIMESTAMP + INTERVAL '1 minute' THEN
      RAISE EXCEPTION 'Fresh current identity assurance is required for quarantine release';
    END IF;
    IF NEW."intakeBatchId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "ShipmentManifest" m WHERE m."intakeBatchId" = NEW."intakeBatchId"
        AND (m."healthEvidenceStatus" <> 'compatible' OR "mcm_m16_derive_manifest_health_status"(m.id) <> 'compatible')
    ) THEN RAISE EXCEPTION 'Compatible shipment health evidence is required for release'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "QuarantineCase_m16_release_guard" BEFORE UPDATE OR DELETE ON "QuarantineCase" FOR EACH ROW EXECUTE FUNCTION "mcm_m16_quarantine_release_guard"();
CREATE TRIGGER "QuarantineCase_m16_no_truncate" BEFORE TRUNCATE ON "QuarantineCase" EXECUTE FUNCTION "mcm_m16_forbid_truncate"();
CREATE CONSTRAINT TRIGGER "QuarantineCase_m16_reverse_parity"
AFTER UPDATE ON "QuarantineCase" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW."releaseCommandReceiptId" IS NOT NULL AND OLD."releaseCommandReceiptId" IS DISTINCT FROM NEW."releaseCommandReceiptId")
EXECUTE FUNCTION "mcm_m16_mutation_reverse_parity"();

-- Existing released rows predate M16 veterinary evidence and remain retained.
-- The NOT VALID constraint and transition trigger enforce evidence on new rows.

COMMIT;
