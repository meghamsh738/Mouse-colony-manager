BEGIN;

CREATE TYPE "ProtocolAuthorizationStatus" AS ENUM ('draft', 'active', 'suspended', 'expired', 'revoked', 'legacy_unverified');
CREATE TYPE "ProtocolPersonnelRole" AS ENUM ('principal_investigator', 'named_researcher', 'procedure_operator', 'breeding_operator', 'intake_operator', 'transfer_coordinator');
CREATE TYPE "ProtocolCountAllocationType" AS ENUM ('reserve', 'release', 'consume');
CREATE TYPE "ProtocolCountAllocationStatus" AS ENUM ('open', 'partially_settled', 'consumed', 'released', 'mixed');
CREATE TYPE "ComplianceCountOperation" AS ENUM ('none', 'reserve', 'release', 'consume');
CREATE TYPE "CompetencyEvidenceStatus" AS ENUM ('current', 'expired', 'revoked');
CREATE TYPE "CompetencyEventType" AS ENUM ('created', 'renewed', 'expired', 'revoked');

CREATE TABLE "ProtocolAuthorization" (
  id TEXT PRIMARY KEY,
  "labId" TEXT NOT NULL,
  "protocolCode" TEXT NOT NULL,
  title TEXT NOT NULL,
  status "ProtocolAuthorizationStatus" NOT NULL DEFAULT 'legacy_unverified',
  "currentVersionId" TEXT UNIQUE,
  "createdById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "reviewedByAuthzVersion" INTEGER,
  "reviewedAssurance" "IdentityAssuranceLevel",
  "reviewedIdentityLinkId" TEXT,
  "reviewedAuthenticatedAt" TIMESTAMPTZ(3),
  "reviewedDutyAssignmentId" TEXT,
  "reviewedDutyAssignmentVersion" INTEGER,
  "reviewedAt" TIMESTAMPTZ(3),
  "activatedAt" TIMESTAMPTZ(3),
  "suspendedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "statusReason" TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProtocolAuthorization_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolAuthorization_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolAuthorization_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolAuthorization_reviewedIdentityLinkId_fkey" FOREIGN KEY ("reviewedIdentityLinkId") REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolAuthorization_reviewedDutyAssignment_fkey" FOREIGN KEY ("reviewedDutyAssignmentId", "reviewedDutyAssignmentVersion") REFERENCES "FacilityDutyAssignment"(id, version) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ProtocolAuthorization_labId_protocolCode_key" UNIQUE ("labId", "protocolCode"),
  CONSTRAINT "ProtocolAuthorization_id_labId_key" UNIQUE (id, "labId"),
  CONSTRAINT "ProtocolAuthorization_currentVersionId_id_key" UNIQUE ("currentVersionId", id),
  CONSTRAINT "ProtocolAuthorization_version_check" CHECK (version > 0),
  CONSTRAINT "ProtocolAuthorization_text_check" CHECK (char_length(btrim("protocolCode")) BETWEEN 2 AND 80 AND char_length(btrim(title)) BETWEEN 3 AND 240),
  CONSTRAINT "ProtocolAuthorization_status_check" CHECK (
    (status IN ('active', 'suspended', 'expired', 'revoked') AND "currentVersionId" IS NOT NULL AND "reviewedById" IS NOT NULL
      AND "reviewedByAuthzVersion" IS NOT NULL AND "reviewedAssurance" IS NOT NULL AND "reviewedIdentityLinkId" IS NOT NULL
      AND "reviewedAuthenticatedAt" IS NOT NULL AND "reviewedDutyAssignmentId" IS NOT NULL
      AND "reviewedDutyAssignmentVersion" IS NOT NULL AND "reviewedAt" IS NOT NULL
      AND (status <> 'active' OR "activatedAt" IS NOT NULL)
      AND (status <> 'suspended' OR "suspendedAt" IS NOT NULL)
      AND (status <> 'revoked' OR "revokedAt" IS NOT NULL))
    OR (status IN ('draft', 'legacy_unverified') AND "reviewedById" IS NULL AND "reviewedAt" IS NULL AND "activatedAt" IS NULL AND "suspendedAt" IS NULL AND "revokedAt" IS NULL)
  )
);

CREATE TABLE "ProtocolAuthorizationVersion" (
  id TEXT PRIMARY KEY,
  "authorizationId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "contentPayload" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL DEFAULT 'synthetic-fail-closed-v1',
  "validFrom" TIMESTAMPTZ(3) NOT NULL,
  "validUntil" TIMESTAMPTZ(3) NOT NULL,
  "approvedAnimalCount" INTEGER NOT NULL,
  summary TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "creationCommandReceiptId" TEXT NOT NULL UNIQUE,
  "scopeSealedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProtocolAuthorizationVersion_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "ProtocolAuthorization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolAuthorizationVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolAuthorizationVersion_creationReceipt_fkey" FOREIGN KEY ("creationCommandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolAuthorizationVersion_authorizationId_versionNumber_key" UNIQUE ("authorizationId", "versionNumber"),
  CONSTRAINT "ProtocolAuthorizationVersion_id_authorizationId_key" UNIQUE (id, "authorizationId"),
  CONSTRAINT "ProtocolAuthorizationVersion_validity_check" CHECK ("versionNumber" > 0 AND "validUntil" > "validFrom" AND "approvedAnimalCount" >= 0),
  CONSTRAINT "ProtocolAuthorizationVersion_hash_check" CHECK ("contentHash" = encode(public.digest(convert_to("contentPayload", 'UTF8'), 'sha256'), 'hex') AND "policyVersion" = 'synthetic-fail-closed-v1')
);

ALTER TABLE "ProtocolAuthorization"
  ADD CONSTRAINT "ProtocolAuthorization_currentVersionId_id_fkey"
  FOREIGN KEY ("currentVersionId", id) REFERENCES "ProtocolAuthorizationVersion"(id, "authorizationId") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "ProtocolAuthorizationLifecycleEvent" (
  id TEXT PRIMARY KEY,
  "authorizationId" TEXT NOT NULL,
  "fromStatus" "ProtocolAuthorizationStatus",
  "toStatus" "ProtocolAuthorizationStatus" NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorAuthzVersion" INTEGER NOT NULL,
  assurance "IdentityAssuranceLevel" NOT NULL,
  "identityLinkId" TEXT NOT NULL,
  "authenticatedAt" TIMESTAMPTZ(3) NOT NULL,
  "dutyAssignmentId" TEXT NOT NULL,
  "dutyAssignmentVersion" INTEGER NOT NULL,
  "commandReceiptId" TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProtocolAuthorizationLifecycleEvent_authorization_fkey" FOREIGN KEY ("authorizationId") REFERENCES "ProtocolAuthorization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolAuthorizationLifecycleEvent_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolAuthorizationLifecycleEvent_identity_fkey" FOREIGN KEY ("identityLinkId") REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolAuthorizationLifecycleEvent_duty_fkey" FOREIGN KEY ("dutyAssignmentId", "dutyAssignmentVersion") REFERENCES "FacilityDutyAssignment"(id, version) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ProtocolAuthorizationLifecycleEvent_receipt_fkey" FOREIGN KEY ("commandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolAuthorizationLifecycleEvent_snapshot_check" CHECK ("actorAuthzVersion" > 0 AND "dutyAssignmentVersion" > 0 AND char_length(btrim(reason)) BETWEEN 3 AND 500)
);

CREATE TABLE "ProtocolProjectBinding" (
  id TEXT PRIMARY KEY,
  "authorizationVersionId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  CONSTRAINT "ProtocolProjectBinding_version_fkey" FOREIGN KEY ("authorizationVersionId") REFERENCES "ProtocolAuthorizationVersion"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolProjectBinding_lab_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolProjectBinding_project_lab_fkey" FOREIGN KEY ("projectId", "labId") REFERENCES "Project"(id, "labId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ProtocolProjectBinding_version_project_key" UNIQUE ("authorizationVersionId", "projectId")
);

CREATE TABLE "ProtocolExperimentBinding" (
  id TEXT PRIMARY KEY,
  "authorizationVersionId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  CONSTRAINT "ProtocolExperimentBinding_version_fkey" FOREIGN KEY ("authorizationVersionId") REFERENCES "ProtocolAuthorizationVersion"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolExperimentBinding_lab_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolExperimentBinding_experiment_lab_fkey" FOREIGN KEY ("experimentId", "labId") REFERENCES "Experiment"(id, "labId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ProtocolExperimentBinding_version_experiment_key" UNIQUE ("authorizationVersionId", "experimentId")
);

CREATE TABLE "ProtocolStrainBinding" (
  id TEXT PRIMARY KEY,
  "authorizationVersionId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "strainId" TEXT NOT NULL,
  CONSTRAINT "ProtocolStrainBinding_version_fkey" FOREIGN KEY ("authorizationVersionId") REFERENCES "ProtocolAuthorizationVersion"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolStrainBinding_lab_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolStrainBinding_strain_fkey" FOREIGN KEY ("strainId") REFERENCES "Strain"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolStrainBinding_version_strain_key" UNIQUE ("authorizationVersionId", "strainId")
);

CREATE TABLE "ProtocolProcedureBinding" (
  id TEXT PRIMARY KEY,
  "authorizationVersionId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "procedureCode" TEXT NOT NULL,
  CONSTRAINT "ProtocolProcedureBinding_version_fkey" FOREIGN KEY ("authorizationVersionId") REFERENCES "ProtocolAuthorizationVersion"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolProcedureBinding_lab_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolProcedureBinding_version_procedure_key" UNIQUE ("authorizationVersionId", "procedureCode"),
  CONSTRAINT "ProtocolProcedureBinding_code_check" CHECK (char_length(btrim("procedureCode")) BETWEEN 2 AND 80)
);

CREATE TABLE "ProtocolPersonnelBinding" (
  id TEXT PRIMARY KEY,
  "authorizationVersionId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleLabel" "ProtocolPersonnelRole" NOT NULL,
  CONSTRAINT "ProtocolPersonnelBinding_version_fkey" FOREIGN KEY ("authorizationVersionId") REFERENCES "ProtocolAuthorizationVersion"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolPersonnelBinding_lab_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolPersonnelBinding_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolPersonnelBinding_version_user_role_key" UNIQUE ("authorizationVersionId", "userId", "roleLabel")
);

CREATE TABLE "ProtocolCountLedger" (
  id TEXT PRIMARY KEY,
  "authorizationVersionId" TEXT NOT NULL UNIQUE,
  "approvedCount" INTEGER NOT NULL,
  "reservedCount" INTEGER NOT NULL DEFAULT 0,
  "consumedCount" INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProtocolCountLedger_version_fkey" FOREIGN KEY ("authorizationVersionId") REFERENCES "ProtocolAuthorizationVersion"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolCountLedger_count_check" CHECK (
    "approvedCount" >= 0 AND "reservedCount" >= 0 AND "consumedCount" >= 0
    AND "reservedCount" + "consumedCount" <= "approvedCount"
    AND version > 0
  )
);

CREATE TABLE "CompetencyEvidence" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "labId" TEXT NOT NULL,
  "procedureCode" TEXT NOT NULL,
  status "CompetencyEvidenceStatus" NOT NULL DEFAULT 'current',
  "currentVersionId" TEXT UNIQUE,
  "revokedAt" TIMESTAMPTZ(3),
  "governedById" TEXT NOT NULL,
  "governedByAuthzVersion" INTEGER NOT NULL,
  "governedAssurance" "IdentityAssuranceLevel" NOT NULL,
  "governedIdentityLinkId" TEXT NOT NULL,
  "governedAuthenticatedAt" TIMESTAMPTZ(3) NOT NULL,
  "governedDutyAssignmentId" TEXT NOT NULL,
  "governedDutyAssignmentVersion" INTEGER NOT NULL,
  "governedAt" TIMESTAMPTZ(3) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompetencyEvidence_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CompetencyEvidence_governedBy_fkey" FOREIGN KEY ("governedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CompetencyEvidence_governedIdentity_fkey" FOREIGN KEY ("governedIdentityLinkId") REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CompetencyEvidence_governedDuty_fkey" FOREIGN KEY ("governedDutyAssignmentId", "governedDutyAssignmentVersion") REFERENCES "FacilityDutyAssignment"(id, version) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "CompetencyEvidence_lab_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CompetencyEvidence_user_lab_procedure_key" UNIQUE ("userId", "labId", "procedureCode"),
  CONSTRAINT "CompetencyEvidence_id_lab_key" UNIQUE (id, "labId"),
  CONSTRAINT "CompetencyEvidence_currentVersionId_id_key" UNIQUE ("currentVersionId", id),
  CONSTRAINT "CompetencyEvidence_status_check" CHECK (
    version > 0 AND "governedByAuthzVersion" > 0 AND "governedDutyAssignmentVersion" > 0 AND char_length(btrim("procedureCode")) BETWEEN 2 AND 80
    AND ((status = 'revoked' AND "revokedAt" IS NOT NULL) OR (status <> 'revoked' AND "revokedAt" IS NULL))
  )
);

CREATE TABLE "CompetencyEvidenceVersion" (
  id TEXT PRIMARY KEY,
  "evidenceId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "evidenceType" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "contentPayload" TEXT NOT NULL,
  "validFrom" TIMESTAMPTZ(3) NOT NULL,
  "validUntil" TIMESTAMPTZ(3) NOT NULL,
  "issuedById" TEXT NOT NULL,
  "commandReceiptId" TEXT NOT NULL UNIQUE,
  "protocolVersionId" TEXT,
  note TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompetencyEvidenceVersion_evidence_fkey" FOREIGN KEY ("evidenceId") REFERENCES "CompetencyEvidence"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CompetencyEvidenceVersion_issuer_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CompetencyEvidenceVersion_receipt_fkey" FOREIGN KEY ("commandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CompetencyEvidenceVersion_protocol_fkey" FOREIGN KEY ("protocolVersionId") REFERENCES "ProtocolAuthorizationVersion"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CompetencyEvidenceVersion_evidence_version_key" UNIQUE ("evidenceId", "versionNumber"),
  CONSTRAINT "CompetencyEvidenceVersion_id_evidence_key" UNIQUE (id, "evidenceId"),
  CONSTRAINT "CompetencyEvidenceVersion_validity_check" CHECK ("versionNumber" > 0 AND "validUntil" > "validFrom"),
  CONSTRAINT "CompetencyEvidenceVersion_hash_check" CHECK ("contentHash" = encode(public.digest(convert_to("contentPayload", 'UTF8'), 'sha256'), 'hex'))
);

ALTER TABLE "CompetencyEvidence"
  ADD CONSTRAINT "CompetencyEvidence_currentVersionId_id_fkey"
  FOREIGN KEY ("currentVersionId", id) REFERENCES "CompetencyEvidenceVersion"(id, "evidenceId") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "CompetencyLifecycleEvent" (
  id TEXT PRIMARY KEY,
  "evidenceId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorAuthzVersion" INTEGER NOT NULL,
  assurance "IdentityAssuranceLevel" NOT NULL,
  "identityLinkId" TEXT NOT NULL,
  "authenticatedAt" TIMESTAMPTZ(3) NOT NULL,
  "dutyAssignmentId" TEXT NOT NULL,
  "dutyAssignmentVersion" INTEGER NOT NULL,
  "commandReceiptId" TEXT NOT NULL UNIQUE,
  "eventType" "CompetencyEventType" NOT NULL,
  "evidenceVersion" INTEGER NOT NULL,
  detail JSONB,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompetencyLifecycleEvent_evidence_fkey" FOREIGN KEY ("evidenceId") REFERENCES "CompetencyEvidence"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CompetencyLifecycleEvent_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CompetencyLifecycleEvent_identity_fkey" FOREIGN KEY ("identityLinkId") REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CompetencyLifecycleEvent_duty_fkey" FOREIGN KEY ("dutyAssignmentId", "dutyAssignmentVersion") REFERENCES "FacilityDutyAssignment"(id, version) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "CompetencyLifecycleEvent_receipt_fkey" FOREIGN KEY ("commandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CompetencyLifecycleEvent_version_check" CHECK ("evidenceVersion" > 0 AND "actorAuthzVersion" > 0 AND "dutyAssignmentVersion" > 0)
);

CREATE TABLE "ProtocolCountAllocation" (
  id TEXT PRIMARY KEY,
  "ledgerId" TEXT NOT NULL,
  "authorizationVersionId" TEXT NOT NULL,
  "allocationKey" TEXT NOT NULL UNIQUE,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "reservedQuantity" INTEGER NOT NULL,
  "consumedQuantity" INTEGER NOT NULL DEFAULT 0,
  "releasedQuantity" INTEGER NOT NULL DEFAULT 0,
  status "ProtocolCountAllocationStatus" NOT NULL DEFAULT 'open',
  version INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT NOT NULL,
  "createdCommandReceiptId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProtocolCountAllocation_ledger_fkey" FOREIGN KEY ("ledgerId") REFERENCES "ProtocolCountLedger"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolCountAllocation_version_fkey" FOREIGN KEY ("authorizationVersionId") REFERENCES "ProtocolAuthorizationVersion"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolCountAllocation_creator_fkey" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolCountAllocation_receipt_fkey" FOREIGN KEY ("createdCommandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolCountAllocation_id_version_key" UNIQUE (id, "authorizationVersionId"),
  CONSTRAINT "ProtocolCountAllocation_state_check" CHECK (
    "reservedQuantity" > 0 AND "consumedQuantity" >= 0 AND "releasedQuantity" >= 0
    AND "consumedQuantity" + "releasedQuantity" <= "reservedQuantity" AND version > 0
    AND ((status = 'open' AND "consumedQuantity" = 0 AND "releasedQuantity" = 0)
      OR (status = 'partially_settled' AND "consumedQuantity" + "releasedQuantity" > 0 AND "consumedQuantity" + "releasedQuantity" < "reservedQuantity")
      OR (status = 'consumed' AND "consumedQuantity" = "reservedQuantity")
      OR (status = 'released' AND "releasedQuantity" = "reservedQuantity")
      OR (status = 'mixed' AND "consumedQuantity" > 0 AND "releasedQuantity" > 0 AND "consumedQuantity" + "releasedQuantity" = "reservedQuantity"))
  )
);

CREATE TABLE "ProtocolCountAllocationHistory" (
  id TEXT PRIMARY KEY,
  "allocationId" TEXT NOT NULL,
  "ledgerId" TEXT NOT NULL,
  "authorizationVersionId" TEXT NOT NULL,
  "commandReceiptId" TEXT NOT NULL,
  "allocationKey" TEXT NOT NULL,
  "allocationType" "ProtocolCountAllocationType" NOT NULL,
  quantity INTEGER NOT NULL,
  "allocationReservedBefore" INTEGER NOT NULL,
  "allocationReservedAfter" INTEGER NOT NULL,
  "allocationConsumedBefore" INTEGER NOT NULL,
  "allocationConsumedAfter" INTEGER NOT NULL,
  "allocationReleasedBefore" INTEGER NOT NULL,
  "allocationReleasedAfter" INTEGER NOT NULL,
  "allocationVersionBefore" INTEGER NOT NULL,
  "allocationVersionAfter" INTEGER NOT NULL,
  "reservedBefore" INTEGER NOT NULL,
  "reservedAfter" INTEGER NOT NULL,
  "consumedBefore" INTEGER NOT NULL,
  "consumedAfter" INTEGER NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "commandAggregateType" TEXT NOT NULL,
  "commandAggregateId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProtocolCountAllocationHistory_allocation_fkey" FOREIGN KEY ("allocationId", "authorizationVersionId") REFERENCES "ProtocolCountAllocation"(id, "authorizationVersionId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ProtocolCountAllocationHistory_ledger_fkey" FOREIGN KEY ("ledgerId") REFERENCES "ProtocolCountLedger"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolCountAllocationHistory_version_fkey" FOREIGN KEY ("authorizationVersionId") REFERENCES "ProtocolAuthorizationVersion"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolCountAllocationHistory_receipt_fkey" FOREIGN KEY ("commandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolCountAllocationHistory_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProtocolCountAllocationHistory_receipt_key" UNIQUE ("commandReceiptId", "allocationKey"),
  CONSTRAINT "ProtocolCountAllocationHistory_count_check" CHECK (
    quantity > 0 AND "reservedBefore" >= 0 AND "reservedAfter" >= 0 AND "consumedBefore" >= 0 AND "consumedAfter" >= 0
    AND (
      ("allocationType" = 'reserve' AND "reservedAfter" = "reservedBefore" + quantity AND "consumedAfter" = "consumedBefore")
      OR ("allocationType" = 'release' AND "reservedAfter" = "reservedBefore" - quantity AND "consumedAfter" = "consumedBefore")
      OR ("allocationType" = 'consume' AND "reservedAfter" = "reservedBefore" - quantity AND "consumedAfter" = "consumedBefore" + quantity)
    )
    AND "allocationVersionAfter" = "allocationVersionBefore" + 1
  )
);

CREATE TABLE "ComplianceEvidenceSnapshot" (
  id TEXT PRIMARY KEY,
  "policyVersion" TEXT NOT NULL DEFAULT 'synthetic-fail-closed-v1',
  "protocolAuthorizationId" TEXT NOT NULL,
  "protocolVersionId" TEXT NOT NULL,
  "protocolContentHash" TEXT NOT NULL,
  "procedureCode" TEXT NOT NULL,
  "scopeHash" TEXT NOT NULL,
  "scopePayload" TEXT NOT NULL,
  "scopeSnapshot" JSONB NOT NULL,
  "requiredPersonnelRole" "ProtocolPersonnelRole" NOT NULL,
  "personnelBindingId" TEXT NOT NULL,
  "competencyEvidenceId" TEXT NOT NULL,
  "competencyVersionId" TEXT NOT NULL,
  "competencyContentHash" TEXT NOT NULL,
  assurance "IdentityAssuranceLevel" NOT NULL,
  "identityLinkId" TEXT NOT NULL,
  "authenticatedAt" TIMESTAMPTZ(3) NOT NULL,
  "dutyAssignmentId" TEXT,
  "dutyAssignmentVersion" INTEGER,
  "ledgerId" TEXT NOT NULL,
  "reservedBefore" INTEGER NOT NULL,
  "reservedAfter" INTEGER NOT NULL,
  "consumedBefore" INTEGER NOT NULL,
  "consumedAfter" INTEGER NOT NULL,
  "countOperation" "ComplianceCountOperation" NOT NULL,
  "countQuantity" INTEGER NOT NULL,
  "countAllocationSnapshot" JSONB NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorAuthzVersion" INTEGER NOT NULL,
  "labId" TEXT NOT NULL,
  "commandReceiptId" TEXT NOT NULL,
  "evidenceKey" TEXT NOT NULL DEFAULT 'primary',
  "commandType" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "evidencePayload" TEXT NOT NULL,
  "evaluatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComplianceEvidenceSnapshot_protocol_fkey" FOREIGN KEY ("protocolAuthorizationId") REFERENCES "ProtocolAuthorization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ComplianceEvidenceSnapshot_protocol_version_fkey" FOREIGN KEY ("protocolVersionId", "protocolAuthorizationId") REFERENCES "ProtocolAuthorizationVersion"(id, "authorizationId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ComplianceEvidenceSnapshot_personnel_fkey" FOREIGN KEY ("personnelBindingId") REFERENCES "ProtocolPersonnelBinding"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ComplianceEvidenceSnapshot_competency_fkey" FOREIGN KEY ("competencyEvidenceId", "labId") REFERENCES "CompetencyEvidence"(id, "labId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ComplianceEvidenceSnapshot_competency_version_fkey" FOREIGN KEY ("competencyVersionId", "competencyEvidenceId") REFERENCES "CompetencyEvidenceVersion"(id, "evidenceId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ComplianceEvidenceSnapshot_identity_fkey" FOREIGN KEY ("identityLinkId") REFERENCES "ExternalIdentityLink"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ComplianceEvidenceSnapshot_duty_fkey" FOREIGN KEY ("dutyAssignmentId", "dutyAssignmentVersion") REFERENCES "FacilityDutyAssignment"(id, version) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "ComplianceEvidenceSnapshot_ledger_fkey" FOREIGN KEY ("ledgerId") REFERENCES "ProtocolCountLedger"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ComplianceEvidenceSnapshot_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ComplianceEvidenceSnapshot_lab_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ComplianceEvidenceSnapshot_receipt_fkey" FOREIGN KEY ("commandReceiptId") REFERENCES "CommandReceipt"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ComplianceEvidenceSnapshot_policy_check" CHECK ("policyVersion" = 'synthetic-fail-closed-v1'),
  CONSTRAINT "ComplianceEvidenceSnapshot_hash_check" CHECK ("protocolContentHash" ~ '^[0-9a-f]{64}$' AND "competencyContentHash" ~ '^[0-9a-f]{64}$' AND "scopeHash" = encode(public.digest(convert_to("scopePayload", 'UTF8'), 'sha256'), 'hex') AND "scopeSnapshot" = "scopePayload"::jsonb AND "evidenceHash" = encode(public.digest(convert_to("evidencePayload", 'UTF8'), 'sha256'), 'hex')),
  CONSTRAINT "ComplianceEvidenceSnapshot_procedure_check" CHECK (char_length(btrim("procedureCode")) BETWEEN 2 AND 80),
  CONSTRAINT "ComplianceEvidenceSnapshot_actor_check" CHECK ("actorAuthzVersion" > 0),
  CONSTRAINT "ComplianceEvidenceSnapshot_count_check" CHECK ("reservedBefore" >= 0 AND "reservedAfter" >= 0 AND "consumedBefore" >= 0 AND "consumedAfter" >= 0),
  CONSTRAINT "ComplianceEvidenceSnapshot_operation_check" CHECK (("countOperation" = 'none' AND "countQuantity" = 0) OR ("countOperation" <> 'none' AND "countQuantity" > 0)),
  CONSTRAINT "ComplianceEvidenceSnapshot_duty_check" CHECK (("dutyAssignmentId" IS NULL) = ("dutyAssignmentVersion" IS NULL)),
  CONSTRAINT "ComplianceEvidenceSnapshot_receipt_evidence_key" UNIQUE ("commandReceiptId", "evidenceKey")
);

ALTER TABLE "Experiment" ADD COLUMN "protocolAuthorizationId" TEXT, ADD COLUMN "complianceEvidenceSnapshotId" TEXT;
ALTER TABLE "BreedingSetup" ADD COLUMN "protocolAuthorizationId" TEXT, ADD COLUMN "complianceEvidenceSnapshotId" TEXT;
ALTER TABLE "AnimalIntakeBatch" ADD COLUMN "protocolAuthorizationId" TEXT, ADD COLUMN "complianceEvidenceSnapshotId" TEXT;
ALTER TABLE "AnimalIntakeBatch" ADD COLUMN "protocolCountAllocationId" TEXT;
ALTER TABLE "Litter" ADD COLUMN "complianceEvidenceSnapshotId" TEXT, ADD COLUMN "protocolCountAllocationId" TEXT;
ALTER TABLE "ExperimentAssignment" ADD COLUMN "complianceEvidenceSnapshotId" TEXT, ADD COLUMN "protocolCountAllocationId" TEXT;
ALTER TABLE "LabTransferRequest"
  ADD COLUMN "sourceProtocolAuthorizationId" TEXT,
  ADD COLUMN "sourceComplianceEvidenceSnapshotId" TEXT,
  ADD COLUMN "destinationProtocolAuthorizationId" TEXT,
  ADD COLUMN "destinationComplianceEvidenceSnapshotId" TEXT,
  ADD COLUMN "destinationProtocolCountAllocationId" TEXT;
ALTER TABLE "ProcedurePlan" ADD COLUMN "protocolAuthorizationId" TEXT, ADD COLUMN "complianceEvidenceSnapshotId" TEXT;
ALTER TABLE "ProcedureOccurrence" ADD COLUMN "protocolAuthorizationId" TEXT, ADD COLUMN "complianceEvidenceSnapshotId" TEXT;
ALTER TABLE "ProcedureOccurrence" ADD COLUMN "protocolCountAllocationId" TEXT;

ALTER TABLE "Experiment"
  ADD CONSTRAINT "Experiment_protocolAuthorizationId_fkey" FOREIGN KEY ("protocolAuthorizationId") REFERENCES "ProtocolAuthorization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Experiment_complianceEvidenceSnapshotId_fkey" FOREIGN KEY ("complianceEvidenceSnapshotId") REFERENCES "ComplianceEvidenceSnapshot"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BreedingSetup"
  ADD CONSTRAINT "BreedingSetup_protocolAuthorizationId_fkey" FOREIGN KEY ("protocolAuthorizationId") REFERENCES "ProtocolAuthorization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "BreedingSetup_complianceEvidenceSnapshotId_fkey" FOREIGN KEY ("complianceEvidenceSnapshotId") REFERENCES "ComplianceEvidenceSnapshot"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnimalIntakeBatch"
  ADD CONSTRAINT "AnimalIntakeBatch_protocolAuthorizationId_fkey" FOREIGN KEY ("protocolAuthorizationId") REFERENCES "ProtocolAuthorization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AnimalIntakeBatch_complianceEvidenceSnapshotId_fkey" FOREIGN KEY ("complianceEvidenceSnapshotId") REFERENCES "ComplianceEvidenceSnapshot"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnimalIntakeBatch" ADD CONSTRAINT "AnimalIntakeBatch_protocolCountAllocationId_fkey" FOREIGN KEY ("protocolCountAllocationId") REFERENCES "ProtocolCountAllocation"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Litter"
  ADD CONSTRAINT "Litter_complianceEvidenceSnapshotId_fkey" FOREIGN KEY ("complianceEvidenceSnapshotId") REFERENCES "ComplianceEvidenceSnapshot"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Litter_protocolCountAllocationId_fkey" FOREIGN KEY ("protocolCountAllocationId") REFERENCES "ProtocolCountAllocation"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExperimentAssignment"
  ADD CONSTRAINT "ExperimentAssignment_complianceEvidenceSnapshotId_fkey" FOREIGN KEY ("complianceEvidenceSnapshotId") REFERENCES "ComplianceEvidenceSnapshot"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ExperimentAssignment_protocolCountAllocationId_fkey" FOREIGN KEY ("protocolCountAllocationId") REFERENCES "ProtocolCountAllocation"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabTransferRequest"
  ADD CONSTRAINT "LabTransferRequest_sourceProtocolAuthorizationId_fkey" FOREIGN KEY ("sourceProtocolAuthorizationId") REFERENCES "ProtocolAuthorization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferRequest_sourceComplianceEvidenceSnapshotId_fkey" FOREIGN KEY ("sourceComplianceEvidenceSnapshotId") REFERENCES "ComplianceEvidenceSnapshot"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferRequest_destinationProtocolAuthorizationId_fkey" FOREIGN KEY ("destinationProtocolAuthorizationId") REFERENCES "ProtocolAuthorization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferRequest_destinationComplianceEvidenceSnapshotId_fkey" FOREIGN KEY ("destinationComplianceEvidenceSnapshotId") REFERENCES "ComplianceEvidenceSnapshot"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "LabTransferRequest_destinationProtocolCountAllocationId_fkey" FOREIGN KEY ("destinationProtocolCountAllocationId") REFERENCES "ProtocolCountAllocation"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcedurePlan"
  ADD CONSTRAINT "ProcedurePlan_protocolAuthorizationId_fkey" FOREIGN KEY ("protocolAuthorizationId") REFERENCES "ProtocolAuthorization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProcedurePlan_complianceEvidenceSnapshotId_fkey" FOREIGN KEY ("complianceEvidenceSnapshotId") REFERENCES "ComplianceEvidenceSnapshot"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcedureOccurrence"
  ADD CONSTRAINT "ProcedureOccurrence_protocolAuthorizationId_fkey" FOREIGN KEY ("protocolAuthorizationId") REFERENCES "ProtocolAuthorization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProcedureOccurrence_complianceEvidenceSnapshotId_fkey" FOREIGN KEY ("complianceEvidenceSnapshotId") REFERENCES "ComplianceEvidenceSnapshot"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProcedureOccurrence" ADD CONSTRAINT "ProcedureOccurrence_protocolCountAllocationId_fkey" FOREIGN KEY ("protocolCountAllocationId") REFERENCES "ProtocolCountAllocation"(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ProtocolAuthorization_lab_status_idx" ON "ProtocolAuthorization"("labId", status);
CREATE INDEX "ProtocolAuthorizationLifecycleEvent_authorization_time_idx" ON "ProtocolAuthorizationLifecycleEvent"("authorizationId", "occurredAt");
CREATE INDEX "ProtocolAuthorizationVersion_validity_idx" ON "ProtocolAuthorizationVersion"("validFrom", "validUntil");
CREATE INDEX "ProtocolProjectBinding_lab_project_idx" ON "ProtocolProjectBinding"("labId", "projectId");
CREATE INDEX "ProtocolExperimentBinding_lab_experiment_idx" ON "ProtocolExperimentBinding"("labId", "experimentId");
CREATE INDEX "ProtocolStrainBinding_lab_strain_idx" ON "ProtocolStrainBinding"("labId", "strainId");
CREATE INDEX "ProtocolProcedureBinding_lab_code_idx" ON "ProtocolProcedureBinding"("labId", "procedureCode");
CREATE INDEX "ProtocolPersonnelBinding_lab_user_idx" ON "ProtocolPersonnelBinding"("labId", "userId");
CREATE INDEX "ProtocolCountLedger_version_state_idx" ON "ProtocolCountLedger"("authorizationVersionId", version);
CREATE INDEX "ProtocolCountAllocation_ledger_status_idx" ON "ProtocolCountAllocation"("ledgerId", status);
CREATE INDEX "ProtocolCountAllocation_aggregate_idx" ON "ProtocolCountAllocation"("aggregateType", "aggregateId");
CREATE INDEX "ProtocolCountAllocationHistory_allocation_time_idx" ON "ProtocolCountAllocationHistory"("allocationId", "occurredAt");
CREATE INDEX "ProtocolCountAllocationHistory_ledger_time_idx" ON "ProtocolCountAllocationHistory"("ledgerId", "occurredAt");
CREATE INDEX "ProtocolCountAllocationHistory_aggregate_idx" ON "ProtocolCountAllocationHistory"("aggregateType", "aggregateId");
CREATE INDEX "CompetencyEvidence_lab_procedure_status_idx" ON "CompetencyEvidence"("labId", "procedureCode", status);
CREATE INDEX "CompetencyEvidenceVersion_validity_idx" ON "CompetencyEvidenceVersion"("validFrom", "validUntil");
CREATE INDEX "CompetencyLifecycleEvent_evidence_time_idx" ON "CompetencyLifecycleEvent"("evidenceId", "occurredAt");
CREATE INDEX "ComplianceEvidenceSnapshot_protocol_idx" ON "ComplianceEvidenceSnapshot"("protocolAuthorizationId", "protocolVersionId");
CREATE INDEX "ComplianceEvidenceSnapshot_actor_time_idx" ON "ComplianceEvidenceSnapshot"("actorId", "evaluatedAt");
CREATE INDEX "ComplianceEvidenceSnapshot_aggregate_idx" ON "ComplianceEvidenceSnapshot"("aggregateType", "aggregateId");

CREATE FUNCTION "mcm_m13_has_active_duty"(subject_id TEXT, required_duty "FacilityDuty", evidence_at TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "FacilityDutyAssignment" assignment
    JOIN "User" subject ON subject.id = assignment."userId"
    WHERE assignment."userId" = subject_id
      AND assignment.duty = required_duty
      AND assignment."revokedAt" IS NULL
      AND assignment."validFrom" <= evidence_at
      AND assignment."validUntil" > evidence_at
      AND subject.active AND subject.role <> 'it_head'::"UserRole"
  );
$$;

CREATE FUNCTION "mcm_m13_governance_evidence_is_current"(
  subject_id TEXT,
  subject_authz_version INTEGER,
  asserted_assurance "IdentityAssuranceLevel",
  identity_link_id TEXT,
  authenticated_at TIMESTAMPTZ,
  duty_assignment_id TEXT,
  duty_assignment_version INTEGER,
  required_duty "FacilityDuty",
  evidence_at TIMESTAMPTZ
)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "User" subject
    JOIN "FacilityDutyAssignment" duty ON duty."userId" = subject.id
    WHERE subject.id = subject_id AND subject.active AND subject."authzVersion" = subject_authz_version
      AND subject.role <> 'it_head'::"UserRole"
      AND duty.id = duty_assignment_id AND duty.version = duty_assignment_version AND duty.duty = required_duty
      AND duty."revokedAt" IS NULL AND duty."validFrom" <= evidence_at AND duty."validUntil" > evidence_at
      AND "mcm_identity_assurance_snapshot_is_current"(subject_id, identity_link_id, asserted_assurance, authenticated_at, evidence_at)
  );
$$;

CREATE FUNCTION "mcm_m13_destructive_seed_allowed"()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT current_setting('mcm.allow_destructive_seed', true) = 'true'
    AND current_database() ~ '^mcm_test_[a-z0-9_]+$'
    AND (inet_server_addr() IS NULL OR inet_server_addr() <<= '127.0.0.0/8'::inet OR inet_server_addr() = '::1'::inet);
$$;

CREATE FUNCTION "mcm_m13_guard_protocol_binding"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE authorization_lab TEXT;
DECLARE creation_receipt_id TEXT;
DECLARE scope_sealed_at TIMESTAMPTZ;
DECLARE receipt_record RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND "mcm_m13_destructive_seed_allowed"() THEN RETURN OLD; END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Protocol version bindings are immutable';
  END IF;
  SELECT protocol_auth."labId", version_record."creationCommandReceiptId", version_record."scopeSealedAt"
    INTO authorization_lab, creation_receipt_id, scope_sealed_at
  FROM "ProtocolAuthorizationVersion" version_record
  JOIN "ProtocolAuthorization" protocol_auth ON protocol_auth.id = version_record."authorizationId"
  WHERE version_record.id = NEW."authorizationVersionId";
  IF authorization_lab IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Protocol authorization version is unavailable';
  END IF;
  IF NEW."labId" IS DISTINCT FROM authorization_lab THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Protocol binding must remain in the authorization lab';
  END IF;
  IF scope_sealed_at IS NOT NULL OR NULLIF(current_setting('mcm.audit_receipt_id', true), '') IS DISTINCT FROM creation_receipt_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol version scope is sealed or its creation receipt is unavailable';
  END IF;
  SELECT * INTO receipt_record FROM "CommandReceipt" WHERE id = creation_receipt_id FOR SHARE;
  IF NOT FOUND OR receipt_record.status <> 'processing' OR receipt_record."transactionId" <> txid_current()
     OR receipt_record."labId" IS DISTINCT FROM authorization_lab THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol binding creation receipt is not current';
  END IF;
  IF TG_TABLE_NAME = 'ProtocolPersonnelBinding' AND NOT EXISTS (
    SELECT 1 FROM "LabMembership" membership
    JOIN "User" subject ON subject.id = membership."userId"
    WHERE membership."labId" = NEW."labId" AND membership."userId" = to_jsonb(NEW)->>'userId' AND membership.active
      AND subject.active AND subject.role <> 'it_head'::"UserRole"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Named protocol personnel must be an active member of the authorization lab';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProtocolProjectBinding_lab_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProtocolProjectBinding" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_protocol_binding"();
CREATE TRIGGER "ProtocolExperimentBinding_lab_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProtocolExperimentBinding" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_protocol_binding"();
CREATE TRIGGER "ProtocolStrainBinding_lab_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProtocolStrainBinding" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_protocol_binding"();
CREATE TRIGGER "ProtocolProcedureBinding_lab_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProtocolProcedureBinding" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_protocol_binding"();
CREATE TRIGGER "ProtocolPersonnelBinding_lab_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProtocolPersonnelBinding" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_protocol_binding"();

CREATE FUNCTION "mcm_m13_guard_protocol_authorization"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_record RECORD;
DECLARE receipt_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "mcm_m13_destructive_seed_allowed"() THEN RETURN OLD; END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Protocol authorization history cannot be deleted';
  END IF;
  receipt_id := NULLIF(current_setting('mcm.audit_receipt_id', true), '');
  IF TG_OP = 'INSERT' AND (
    NEW.status NOT IN ('draft', 'legacy_unverified') OR NEW."currentVersionId" IS NOT NULL OR receipt_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM "CommandReceipt" receipt WHERE receipt.id = receipt_id AND receipt.status = 'processing'
        AND receipt."transactionId" = txid_current() AND receipt."actorId" = NEW."createdById"
        AND receipt."labId" IS NOT DISTINCT FROM NEW."labId"
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol authorization creation requires a matching command receipt';
  END IF;
  IF NEW."currentVersionId" IS NOT NULL THEN
    SELECT "authorizationId", "validFrom", "validUntil", "scopeSealedAt", "creationCommandReceiptId" INTO version_record
    FROM "ProtocolAuthorizationVersion" WHERE id = NEW."currentVersionId";
    IF NOT FOUND OR version_record."authorizationId" <> NEW.id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Current protocol version must belong to its authorization';
    END IF;
    IF version_record."scopeSealedAt" IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Current protocol version scope must be sealed';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'draft' AND OLD."currentVersionId" IS NULL THEN
      IF receipt_id IS DISTINCT FROM version_record."creationCommandReceiptId" OR NEW.version <> OLD.version + 1 OR NOT EXISTS (
        SELECT 1 FROM "CommandReceipt" receipt
        WHERE receipt.id = receipt_id AND receipt.status = 'processing' AND receipt."transactionId" = txid_current()
          AND receipt."actorId" = NEW."createdById" AND receipt."labId" IS NOT DISTINCT FROM NEW."labId"
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Draft protocol sealing requires its current creation receipt';
      END IF;
    END IF;
    IF NEW.status = 'active' AND NOT (version_record."validFrom" <= CURRENT_TIMESTAMP AND version_record."validUntil" > CURRENT_TIMESTAMP) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only a currently valid protocol version can be active';
    END IF;
  END IF;
  IF NEW.status IN ('active', 'suspended', 'expired', 'revoked') THEN
    IF NEW."reviewedById" = NEW."createdById" THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol creator cannot review the same authorization';
    END IF;
    IF NOT "mcm_m13_governance_evidence_is_current"(
      NEW."reviewedById", NEW."reviewedByAuthzVersion", NEW."reviewedAssurance", NEW."reviewedIdentityLinkId",
      NEW."reviewedAuthenticatedAt", NEW."reviewedDutyAssignmentId", NEW."reviewedDutyAssignmentVersion",
      'protocol_reviewer', NEW."reviewedAt"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Current protocol reviewer assurance and duty evidence is required';
    END IF;
    receipt_id := NULLIF(current_setting('mcm.audit_receipt_id', true), '');
    IF receipt_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM "CommandReceipt" receipt WHERE receipt.id = receipt_id AND receipt.status = 'processing'
        AND receipt."transactionId" = txid_current() AND receipt."actorId" = NEW."reviewedById"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol governance requires a matching command receipt';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NOT EXISTS (
      SELECT 1 FROM "ProtocolAuthorizationLifecycleEvent" event
      WHERE event."authorizationId" = NEW.id AND event."commandReceiptId" = receipt_id
        AND event."fromStatus" = OLD.status AND event."toStatus" = NEW.status
        AND event."actorId" = NEW."reviewedById" AND event."actorAuthzVersion" = NEW."reviewedByAuthzVersion"
        AND event.assurance = NEW."reviewedAssurance" AND event."identityLinkId" = NEW."reviewedIdentityLinkId"
        AND event."authenticatedAt" = NEW."reviewedAuthenticatedAt"
        AND event."dutyAssignmentId" = NEW."reviewedDutyAssignmentId" AND event."dutyAssignmentVersion" = NEW."reviewedDutyAssignmentVersion"
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Protocol status transition requires immutable governance evidence';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW."labId", NEW."protocolCode", NEW.title, NEW."createdById", NEW."createdAt")
       IS DISTINCT FROM (OLD.id, OLD."labId", OLD."protocolCode", OLD.title, OLD."createdById", OLD."createdAt") THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Protocol authorization identity and creator evidence are immutable';
    END IF;
    IF OLD.status = 'draft' AND NEW.status = 'draft' THEN
      IF OLD."currentVersionId" IS NOT NULL OR NEW."currentVersionId" IS NULL OR NEW.version <> OLD.version + 1
         OR (NEW."reviewedById", NEW."reviewedAt", NEW."activatedAt", NEW."suspendedAt", NEW."revokedAt", NEW."statusReason")
            IS DISTINCT FROM (OLD."reviewedById", OLD."reviewedAt", OLD."activatedAt", OLD."suspendedAt", OLD."revokedAt", OLD."statusReason") THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Draft protocol root may only bind its sealed current version once';
      END IF;
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      IF NEW."currentVersionId" IS DISTINCT FROM OLD."currentVersionId" OR NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Protocol governance transition cannot replace scope or skip versions';
      END IF;
    ELSE
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Protocol authorization updates require a sealed draft or governance transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProtocolAuthorization_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProtocolAuthorization" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_protocol_authorization"();

CREATE FUNCTION "mcm_m13_guard_protocol_event"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status "ProtocolAuthorizationStatus";
DECLARE receipt_record RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND "mcm_m13_destructive_seed_allowed"() THEN RETURN OLD; END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Protocol authorization lifecycle events are immutable';
  END IF;
  IF NULLIF(current_setting('mcm.audit_receipt_id', true), '') <> NEW."commandReceiptId" THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol governance receipt context is missing or mismatched';
  END IF;
  SELECT * INTO receipt_record FROM "CommandReceipt" WHERE id = NEW."commandReceiptId" FOR SHARE;
  IF NOT FOUND OR receipt_record.status <> 'processing' OR receipt_record."transactionId" <> txid_current() OR receipt_record."actorId" <> NEW."actorId" THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol governance receipt is not current';
  END IF;
  SELECT status INTO current_status FROM "ProtocolAuthorization" WHERE id = NEW."authorizationId" FOR UPDATE;
  IF NOT FOUND OR current_status IS DISTINCT FROM NEW."fromStatus" THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Protocol authorization status snapshot is stale';
  END IF;
  IF EXISTS (SELECT 1 FROM "ProtocolAuthorization" protocol_auth WHERE protocol_auth.id = NEW."authorizationId" AND protocol_auth."createdById" = NEW."actorId") THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol creator cannot approve the same authorization';
  END IF;
  IF NOT "mcm_m13_governance_evidence_is_current"(
    NEW."actorId", NEW."actorAuthzVersion", NEW.assurance, NEW."identityLinkId", NEW."authenticatedAt",
    NEW."dutyAssignmentId", NEW."dutyAssignmentVersion", 'protocol_reviewer', NEW."occurredAt"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol reviewer evidence is unavailable, stale, or mismatched';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProtocolAuthorizationLifecycleEvent_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProtocolAuthorizationLifecycleEvent" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_protocol_event"();

CREATE FUNCTION "mcm_m13_guard_protocol_version"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_record RECORD;
DECLARE authorization_record RECORD;
DECLARE payload JSONB;
DECLARE mismatch_field TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM "ProtocolAuthorizationVersion" existing WHERE existing."authorizationId" = NEW."authorizationId" AND existing."versionNumber" >= NEW."versionNumber") THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Protocol versions must increase monotonically';
    END IF;
    SELECT status, "labId", "protocolCode", title INTO authorization_record FROM "ProtocolAuthorization" WHERE id = NEW."authorizationId" FOR SHARE;
    IF NOT FOUND OR authorization_record.status <> 'draft' OR NEW."scopeSealedAt" IS NOT NULL
       OR NULLIF(current_setting('mcm.audit_receipt_id', true), '') IS DISTINCT FROM NEW."creationCommandReceiptId" THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol version creation requires an unsealed draft and matching receipt context';
    END IF;
    SELECT * INTO receipt_record FROM "CommandReceipt" WHERE id = NEW."creationCommandReceiptId" FOR SHARE;
    IF NOT FOUND OR receipt_record.status <> 'processing' OR receipt_record."transactionId" <> txid_current()
       OR receipt_record."actorId" <> NEW."createdById" OR receipt_record."labId" IS DISTINCT FROM authorization_record."labId" THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol version creation receipt is not current';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."scopeSealedAt" IS NULL AND NEW."scopeSealedAt" IS NOT NULL
     AND NULLIF(current_setting('mcm.audit_receipt_id', true), '') = OLD."creationCommandReceiptId"
     AND (NEW.id, NEW."authorizationId", NEW."versionNumber", NEW."contentHash", NEW."contentPayload", NEW."policyVersion", NEW."validFrom", NEW."validUntil",
          NEW."approvedAnimalCount", NEW.summary, NEW."createdById", NEW."creationCommandReceiptId", NEW."createdAt")
       IS NOT DISTINCT FROM
         (OLD.id, OLD."authorizationId", OLD."versionNumber", OLD."contentHash", OLD."contentPayload", OLD."policyVersion", OLD."validFrom", OLD."validUntil",
          OLD."approvedAnimalCount", OLD.summary, OLD."createdById", OLD."creationCommandReceiptId", OLD."createdAt") THEN
    SELECT status, "labId", "protocolCode", title
      INTO authorization_record
      FROM "ProtocolAuthorization"
      WHERE id = NEW."authorizationId"
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Protocol authorization is unavailable while sealing its version';
    END IF;
    SELECT *
      INTO receipt_record
      FROM "CommandReceipt"
      WHERE id = OLD."creationCommandReceiptId"
      FOR SHARE;
    IF NOT FOUND OR receipt_record.status <> 'processing' OR receipt_record."transactionId" <> txid_current()
       OR receipt_record."actorId" <> NEW."createdById"
       OR receipt_record."labId" IS DISTINCT FROM authorization_record."labId" THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol version sealing receipt is not current';
    END IF;
    payload := NEW."contentPayload"::jsonb;
    mismatch_field := CASE
      WHEN payload->>'policyVersion' IS DISTINCT FROM NEW."policyVersion" THEN 'policyVersion'
      WHEN payload->>'labId' IS DISTINCT FROM authorization_record."labId" THEN 'labId'
      WHEN payload->>'protocolCode' IS DISTINCT FROM authorization_record."protocolCode" THEN 'protocolCode'
      WHEN payload->>'title' IS DISTINCT FROM authorization_record.title THEN 'title'
      WHEN (payload->>'validFrom')::TIMESTAMPTZ IS DISTINCT FROM NEW."validFrom" THEN 'validFrom'
      WHEN (payload->>'validUntil')::TIMESTAMPTZ IS DISTINCT FROM NEW."validUntil" THEN 'validUntil'
      WHEN (payload->>'approvedAnimalCount')::INTEGER IS DISTINCT FROM NEW."approvedAnimalCount" THEN 'approvedAnimalCount'
      WHEN payload->>'summary' IS DISTINCT FROM NEW.summary THEN 'summary'
      WHEN COALESCE((SELECT to_jsonb(array_agg(binding."projectId" ORDER BY binding."projectId")) FROM "ProtocolProjectBinding" binding WHERE binding."authorizationVersionId" = NEW.id), '[]'::jsonb) IS DISTINCT FROM COALESCE(payload->'projectIds', '[]'::jsonb) THEN 'projectIds'
      WHEN COALESCE((SELECT to_jsonb(array_agg(binding."experimentId" ORDER BY binding."experimentId")) FROM "ProtocolExperimentBinding" binding WHERE binding."authorizationVersionId" = NEW.id), '[]'::jsonb) IS DISTINCT FROM COALESCE(payload->'experimentIds', '[]'::jsonb) THEN 'experimentIds'
      WHEN COALESCE((SELECT to_jsonb(array_agg(binding."strainId" ORDER BY binding."strainId")) FROM "ProtocolStrainBinding" binding WHERE binding."authorizationVersionId" = NEW.id), '[]'::jsonb) IS DISTINCT FROM COALESCE(payload->'strainIds', '[]'::jsonb) THEN 'strainIds'
      WHEN COALESCE((SELECT to_jsonb(array_agg(binding."procedureCode" ORDER BY binding."procedureCode")) FROM "ProtocolProcedureBinding" binding WHERE binding."authorizationVersionId" = NEW.id), '[]'::jsonb) IS DISTINCT FROM COALESCE(payload->'procedureCodes', '[]'::jsonb) THEN 'procedureCodes'
      WHEN COALESCE((SELECT jsonb_agg(jsonb_build_object('roleLabel', binding."roleLabel", 'userId', binding."userId") ORDER BY binding."userId", binding."roleLabel"::text) FROM "ProtocolPersonnelBinding" binding WHERE binding."authorizationVersionId" = NEW.id), '[]'::jsonb) IS DISTINCT FROM COALESCE(payload->'personnel', '[]'::jsonb) THEN 'personnel'
      ELSE NULL
    END;
    IF mismatch_field IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Protocol version canonical payload does not match its sealed scope bindings', DETAIL = 'Mismatched canonical field: ' || mismatch_field;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND "mcm_m13_destructive_seed_allowed"() THEN RETURN OLD; END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Protocol authorization versions are immutable';
END;
$$;
CREATE TRIGGER "ProtocolAuthorizationVersion_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "ProtocolAuthorizationVersion" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_protocol_version"();

CREATE FUNCTION "mcm_m13_guard_competency"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_record RECORD;
DECLARE receipt_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "mcm_m13_destructive_seed_allowed"() THEN RETURN OLD; END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Competency evidence cannot be deleted';
  END IF;
  IF NOT "mcm_m13_governance_evidence_is_current"(
    NEW."governedById", NEW."governedByAuthzVersion", NEW."governedAssurance", NEW."governedIdentityLinkId",
    NEW."governedAuthenticatedAt", NEW."governedDutyAssignmentId", NEW."governedDutyAssignmentVersion",
    'training_administrator', NEW."governedAt"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Current training administrator assurance and duty evidence is required';
  END IF;
  IF NEW."userId" = NEW."governedById" THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Training administrator cannot issue their own competency evidence';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "LabMembership" membership JOIN "User" subject ON subject.id = membership."userId"
    WHERE membership."labId" = NEW."labId" AND membership."userId" = NEW."userId" AND membership.active
      AND subject.active AND subject.role <> 'it_head'::"UserRole"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Competency subject must be an active member of the evidence lab';
  END IF;
  receipt_id := NULLIF(current_setting('mcm.audit_receipt_id', true), '');
  IF receipt_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM "CommandReceipt" receipt WHERE receipt.id = receipt_id AND receipt.status = 'processing'
      AND receipt."transactionId" = txid_current() AND receipt."actorId" = NEW."governedById"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Competency governance requires a matching command receipt';
  END IF;
  IF NEW."currentVersionId" IS NOT NULL THEN
    SELECT "evidenceId", "validFrom", "validUntil" INTO version_record FROM "CompetencyEvidenceVersion" WHERE id = NEW."currentVersionId";
    IF NOT FOUND OR version_record."evidenceId" <> NEW.id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Current competency version must belong to its evidence';
    END IF;
    IF NEW.status = 'current' AND NOT (version_record."validFrom" <= CURRENT_TIMESTAMP AND version_record."validUntil" > CURRENT_TIMESTAMP) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Only current competency evidence can be active';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."userId", NEW."labId", NEW."procedureCode") IS DISTINCT FROM (OLD."userId", OLD."labId", OLD."procedureCode") THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Competency subject and scope are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CompetencyEvidence_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CompetencyEvidence" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_competency"();

CREATE FUNCTION "mcm_m13_guard_competency_event"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_record RECORD;
DECLARE evidence_record RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND "mcm_m13_destructive_seed_allowed"() THEN RETURN OLD; END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Competency lifecycle events are immutable';
  END IF;
  IF NULLIF(current_setting('mcm.audit_receipt_id', true), '') <> NEW."commandReceiptId" THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Competency governance receipt context is missing or mismatched';
  END IF;
  SELECT * INTO receipt_record FROM "CommandReceipt" WHERE id = NEW."commandReceiptId" FOR SHARE;
  IF NOT FOUND OR receipt_record.status <> 'processing' OR receipt_record."transactionId" <> txid_current() OR receipt_record."actorId" <> NEW."actorId" THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Competency governance receipt is not current';
  END IF;
  SELECT version, "governedById", "governedByAuthzVersion", "governedAssurance", "governedIdentityLinkId",
    "governedAuthenticatedAt", "governedDutyAssignmentId", "governedDutyAssignmentVersion", "governedAt"
    INTO evidence_record FROM "CompetencyEvidence" WHERE id = NEW."evidenceId" FOR SHARE;
  IF NOT FOUND OR evidence_record.version <> NEW."evidenceVersion"
     OR evidence_record."governedById" <> NEW."actorId" OR evidence_record."governedByAuthzVersion" <> NEW."actorAuthzVersion"
     OR evidence_record."governedAssurance" <> NEW.assurance OR evidence_record."governedIdentityLinkId" <> NEW."identityLinkId"
     OR evidence_record."governedAuthenticatedAt" <> NEW."authenticatedAt"
     OR evidence_record."governedDutyAssignmentId" <> NEW."dutyAssignmentId" OR evidence_record."governedDutyAssignmentVersion" <> NEW."dutyAssignmentVersion"
     OR evidence_record."governedAt" <> NEW."occurredAt" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Competency lifecycle event must match its durable governance evidence';
  END IF;
  IF NOT "mcm_m13_governance_evidence_is_current"(
    NEW."actorId", NEW."actorAuthzVersion", NEW.assurance, NEW."identityLinkId", NEW."authenticatedAt",
    NEW."dutyAssignmentId", NEW."dutyAssignmentVersion", 'training_administrator', NEW."occurredAt"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Training administrator evidence is unavailable, stale, or mismatched';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CompetencyLifecycleEvent_governance_guard" BEFORE INSERT ON "CompetencyLifecycleEvent" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_competency_event"();

CREATE FUNCTION "mcm_m13_reject_history_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') AND "mcm_m13_destructive_seed_allowed"() THEN
    RETURN CASE WHEN TG_OP = 'TRUNCATE' THEN NULL ELSE OLD END;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = TG_TABLE_NAME || ' is append-only immutable evidence';
END;
$$;

CREATE FUNCTION "mcm_m13_guard_competency_version"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_record RECORD;
DECLARE evidence_record RECORD;
DECLARE payload JSONB;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND "mcm_m13_destructive_seed_allowed"() THEN RETURN OLD; END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Competency evidence versions are immutable';
  END IF;
  IF NULLIF(current_setting('mcm.audit_receipt_id', true), '') IS DISTINCT FROM NEW."commandReceiptId" THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Competency version receipt context is missing or mismatched';
  END IF;
  SELECT * INTO receipt_record FROM "CommandReceipt" WHERE id = NEW."commandReceiptId" FOR SHARE;
  SELECT "userId", "labId", "procedureCode" INTO evidence_record FROM "CompetencyEvidence" WHERE id = NEW."evidenceId" FOR SHARE;
  IF receipt_record.id IS NULL OR evidence_record."labId" IS NULL OR receipt_record.status <> 'processing'
     OR receipt_record."transactionId" <> txid_current() OR receipt_record."actorId" <> NEW."issuedById"
     OR receipt_record."labId" IS DISTINCT FROM evidence_record."labId" THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Competency version creation receipt is not current';
  END IF;
  IF EXISTS (SELECT 1 FROM "CompetencyEvidenceVersion" prior WHERE prior."evidenceId" = NEW."evidenceId" AND prior."versionNumber" >= NEW."versionNumber") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Competency evidence versions must increase monotonically';
  END IF;
  payload := NEW."contentPayload"::jsonb;
  IF payload->>'userId' IS DISTINCT FROM evidence_record."userId"
     OR payload->>'labId' IS DISTINCT FROM evidence_record."labId"
     OR payload->>'procedureCode' IS DISTINCT FROM evidence_record."procedureCode"
     OR payload->>'evidenceType' IS DISTINCT FROM NEW."evidenceType"
     OR (payload->>'versionNumber')::INTEGER IS DISTINCT FROM NEW."versionNumber"
     OR (payload->>'validFrom')::TIMESTAMPTZ IS DISTINCT FROM NEW."validFrom"
     OR (payload->>'validUntil')::TIMESTAMPTZ IS DISTINCT FROM NEW."validUntil"
     OR NULLIF(payload->>'protocolVersionId', '') IS DISTINCT FROM NEW."protocolVersionId"
     OR NULLIF(payload->>'note', '') IS DISTINCT FROM NEW.note THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Competency version canonical payload does not match its immutable evidence fields';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CompetencyEvidenceVersion_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CompetencyEvidenceVersion" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_competency_version"();
CREATE TRIGGER "CompetencyLifecycleEvent_immutable" BEFORE UPDATE OR DELETE ON "CompetencyLifecycleEvent" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_reject_history_mutation"();
CREATE TRIGGER "CompetencyLifecycleEvent_truncate_guard" BEFORE TRUNCATE ON "CompetencyLifecycleEvent" FOR EACH STATEMENT EXECUTE FUNCTION "mcm_m13_reject_history_mutation"();
CREATE TRIGGER "ProtocolAuthorizationLifecycleEvent_immutable" BEFORE UPDATE OR DELETE ON "ProtocolAuthorizationLifecycleEvent" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_reject_history_mutation"();
CREATE TRIGGER "ProtocolAuthorizationLifecycleEvent_truncate_guard" BEFORE TRUNCATE ON "ProtocolAuthorizationLifecycleEvent" FOR EACH STATEMENT EXECUTE FUNCTION "mcm_m13_reject_history_mutation"();

CREATE FUNCTION "mcm_m13_guard_ledger"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_id TEXT;
DECLARE version_record RECORD;
DECLARE receipt_record RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."reservedCount" <> 0 OR NEW."consumedCount" <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Protocol count ledgers must begin empty';
    END IF;
    SELECT version_row."approvedAnimalCount", version_row."scopeSealedAt", version_row."creationCommandReceiptId", protocol_auth."labId"
      INTO version_record
    FROM "ProtocolAuthorizationVersion" version_row
    JOIN "ProtocolAuthorization" protocol_auth ON protocol_auth.id = version_row."authorizationId"
    WHERE version_row.id = NEW."authorizationVersionId" FOR SHARE;
    IF NOT FOUND OR version_record."scopeSealedAt" IS NOT NULL OR NEW."approvedCount" <> version_record."approvedAnimalCount"
       OR NULLIF(current_setting('mcm.audit_receipt_id', true), '') IS DISTINCT FROM version_record."creationCommandReceiptId" THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol count ledger creation requires the unsealed version creation receipt';
    END IF;
    SELECT * INTO receipt_record FROM "CommandReceipt" WHERE id = version_record."creationCommandReceiptId" FOR SHARE;
    IF NOT FOUND OR receipt_record.status <> 'processing' OR receipt_record."transactionId" <> txid_current()
       OR receipt_record."labId" IS DISTINCT FROM version_record."labId" THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol count ledger creation receipt is not current';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF "mcm_m13_destructive_seed_allowed"() THEN RETURN OLD; END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Protocol count ledgers cannot be deleted';
  END IF;
  receipt_id := NULLIF(current_setting('mcm.compliance_receipt_id', true), '');
  IF receipt_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM "CommandReceipt" receipt
    WHERE receipt.id = receipt_id AND receipt.status = 'processing' AND receipt."transactionId" = txid_current()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol count updates require an active command receipt';
  END IF;
  IF NEW.id <> OLD.id OR NEW."authorizationVersionId" <> OLD."authorizationVersionId" OR NEW."approvedCount" <> OLD."approvedCount" OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Protocol count ledger identity and approved count are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProtocolCountLedger_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProtocolCountLedger" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_ledger"();

CREATE FUNCTION "mcm_m13_transfer_source_release_allowed"(
  receipt_id TEXT,
  allocation_aggregate_type TEXT,
  allocation_aggregate_id TEXT,
  authorization_version_id TEXT
)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT allocation_aggregate_type = 'experiment_assignment' AND EXISTS (
    SELECT 1
    FROM "CommandReceipt" receipt
    JOIN "User" actor ON actor.id = receipt."actorId" AND actor.active AND actor.role = 'facility_admin'
    JOIN "LabTransferRequest" request ON request.id = receipt."aggregateId"
    JOIN "LabTransferItem" item ON item."requestId" = request.id AND item.active
    JOIN "ExperimentAssignment" assignment ON assignment.id = allocation_aggregate_id AND assignment."animalId" = item."animalId"
    JOIN "Experiment" experiment ON experiment.id = assignment."experimentId"
    JOIN "ProtocolAuthorizationVersion" version_record ON version_record.id = authorization_version_id
    JOIN "ProtocolAuthorization" protocol_auth ON protocol_auth.id = version_record."authorizationId"
    WHERE receipt.id = receipt_id
      AND receipt.status = 'processing'
      AND receipt."transactionId" = txid_current()
      AND receipt."commandType" = 'lab_transfer.finalize'
      AND receipt."aggregateType" = 'lab_transfer_request'
      AND request.status = 'destination_accepted'
      AND request."acceptedPacketVersion" = request."packetVersion"
      AND request."acceptedPacketHash" IS NOT NULL
      AND request."sourceLabId" = protocol_auth."labId"
      AND experiment."protocolAuthorizationId" = protocol_auth.id
      AND assignment.status IN ('reserved', 'active')
  );
$$;

CREATE FUNCTION "mcm_m13_guard_count_allocation"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_record RECORD;
DECLARE authorization_lab TEXT;
DECLARE transfer_source_release BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF "mcm_m13_destructive_seed_allowed"() THEN RETURN OLD; END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Protocol count allocations cannot be deleted';
  END IF;
  IF NULLIF(current_setting('mcm.compliance_receipt_id', true), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol allocation mutation requires receipt context';
  END IF;
  SELECT * INTO receipt_record FROM "CommandReceipt"
  WHERE id = NULLIF(current_setting('mcm.compliance_receipt_id', true), '') FOR SHARE;
  SELECT protocol_auth."labId" INTO authorization_lab
  FROM "ProtocolAuthorizationVersion" version_record
  JOIN "ProtocolAuthorization" protocol_auth ON protocol_auth.id = version_record."authorizationId"
  JOIN "ProtocolCountLedger" ledger ON ledger."authorizationVersionId" = version_record.id
  WHERE version_record.id = NEW."authorizationVersionId" AND ledger.id = NEW."ledgerId";
  IF TG_OP = 'UPDATE' THEN
    transfer_source_release := NEW."consumedQuantity" = OLD."consumedQuantity"
      AND NEW."releasedQuantity" > OLD."releasedQuantity"
      AND "mcm_m13_transfer_source_release_allowed"(
        receipt_record.id,
        NEW."aggregateType",
        NEW."aggregateId",
        NEW."authorizationVersionId"
      );
  END IF;
  IF receipt_record.id IS NULL OR receipt_record.status <> 'processing' OR receipt_record."transactionId" <> txid_current()
     OR (TG_OP = 'INSERT' AND receipt_record."actorId" <> NEW."createdById")
     OR (receipt_record."labId" IS DISTINCT FROM authorization_lab AND NOT (
       (NEW."aggregateType" = 'lab_transfer_request'
        AND receipt_record."commandType" IN ('lab_transfer.revise', 'lab_transfer.cancel', 'lab_transfer.finalize'))
       OR transfer_source_release
     )) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Protocol allocation actor, lab, aggregate, or receipt is mismatched';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."createdCommandReceiptId" <> receipt_record.id OR NEW.version <> 1 OR NEW."consumedQuantity" <> 0 OR NEW."releasedQuantity" <> 0 OR NEW.status <> 'open' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'New protocol allocation state is invalid';
    END IF;
  ELSIF NEW.id <> OLD.id OR NEW."ledgerId" <> OLD."ledgerId" OR NEW."authorizationVersionId" <> OLD."authorizationVersionId"
     OR NEW."allocationKey" <> OLD."allocationKey" OR NEW."aggregateType" <> OLD."aggregateType" OR NEW."aggregateId" <> OLD."aggregateId"
     OR NEW."reservedQuantity" <> OLD."reservedQuantity" OR NEW."createdById" <> OLD."createdById"
     OR NEW."createdCommandReceiptId" <> OLD."createdCommandReceiptId" OR NEW.version <> OLD.version + 1
     OR NEW."consumedQuantity" < OLD."consumedQuantity" OR NEW."releasedQuantity" < OLD."releasedQuantity" THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Protocol allocation identity, reservation, and settled quantities are immutable or monotonic';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProtocolCountAllocation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProtocolCountAllocation" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_count_allocation"();
CREATE TRIGGER "ProtocolCountAllocation_truncate_guard" BEFORE TRUNCATE ON "ProtocolCountAllocation" FOR EACH STATEMENT EXECUTE FUNCTION "mcm_m13_reject_history_mutation"();

CREATE FUNCTION "mcm_m13_guard_allocation"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_record RECORD;
DECLARE ledger_record RECORD;
DECLARE allocation_record RECORD;
DECLARE authorization_lab TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND "mcm_m13_destructive_seed_allowed"() THEN RETURN OLD; END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Protocol count allocation history is immutable';
  END IF;
  IF NULLIF(current_setting('mcm.compliance_receipt_id', true), '') <> NEW."commandReceiptId" THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Allocation receipt context is missing or mismatched';
  END IF;
  SELECT * INTO receipt_record FROM "CommandReceipt" WHERE id = NEW."commandReceiptId" FOR SHARE;
  IF NOT FOUND OR receipt_record.status <> 'processing' OR receipt_record."transactionId" <> txid_current() OR receipt_record."actorId" <> NEW."actorId" THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Allocation command receipt is not current';
  END IF;
  SELECT protocol_auth."labId" INTO authorization_lab
  FROM "ProtocolAuthorizationVersion" version_record
  JOIN "ProtocolAuthorization" protocol_auth ON protocol_auth.id = version_record."authorizationId"
  WHERE version_record.id = NEW."authorizationVersionId";
  IF authorization_lab IS NULL OR (receipt_record."labId" IS DISTINCT FROM authorization_lab AND NOT (
       (NEW."aggregateType" = 'lab_transfer_request'
        AND receipt_record."commandType" IN ('lab_transfer.revise', 'lab_transfer.cancel', 'lab_transfer.finalize'))
       OR (NEW."allocationType" = 'release'
        AND NEW."commandAggregateType" = 'lab_transfer_request'
        AND "mcm_m13_transfer_source_release_allowed"(
          NEW."commandReceiptId",
          NEW."aggregateType",
          NEW."aggregateId",
          NEW."authorizationVersionId"
        ))
     ))
     OR receipt_record."aggregateType" IS DISTINCT FROM NEW."commandAggregateType"
     OR receipt_record."aggregateId" IS DISTINCT FROM NEW."commandAggregateId" THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Allocation actor, lab, or aggregate does not match its command receipt';
  END IF;
  SELECT * INTO ledger_record FROM "ProtocolCountLedger" WHERE id = NEW."ledgerId" FOR SHARE;
  IF NOT FOUND OR ledger_record."authorizationVersionId" <> NEW."authorizationVersionId" OR ledger_record."reservedCount" <> NEW."reservedAfter" OR ledger_record."consumedCount" <> NEW."consumedAfter" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Allocation history must match the locked ledger result';
  END IF;
  SELECT * INTO allocation_record FROM "ProtocolCountAllocation" WHERE id = NEW."allocationId" FOR SHARE;
  IF NOT FOUND OR allocation_record."ledgerId" <> NEW."ledgerId" OR allocation_record."authorizationVersionId" <> NEW."authorizationVersionId"
     OR allocation_record."aggregateType" <> NEW."aggregateType" OR allocation_record."aggregateId" <> NEW."aggregateId"
     OR allocation_record."reservedQuantity" <> NEW."allocationReservedAfter"
     OR allocation_record."consumedQuantity" <> NEW."allocationConsumedAfter" OR allocation_record."releasedQuantity" <> NEW."allocationReleasedAfter"
     OR allocation_record.version <> NEW."allocationVersionAfter"
     OR NEW."allocationReservedBefore" <> NEW."allocationReservedAfter"
     OR (NEW."allocationType" = 'reserve' AND (NEW."allocationConsumedBefore" <> 0 OR NEW."allocationConsumedAfter" <> 0 OR NEW."allocationReleasedBefore" <> 0 OR NEW."allocationReleasedAfter" <> 0 OR NEW."allocationVersionBefore" <> 0 OR NEW."allocationVersionAfter" <> 1))
     OR (NEW."allocationType" = 'release' AND (NEW."allocationConsumedAfter" <> NEW."allocationConsumedBefore" OR NEW."allocationReleasedAfter" <> NEW."allocationReleasedBefore" + NEW.quantity))
     OR (NEW."allocationType" = 'consume' AND (NEW."allocationReleasedAfter" <> NEW."allocationReleasedBefore" OR NEW."allocationConsumedAfter" <> NEW."allocationConsumedBefore" + NEW.quantity)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Allocation history must match the exact versioned allocation transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProtocolCountAllocationHistory_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ProtocolCountAllocationHistory" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_allocation"();
CREATE TRIGGER "ProtocolCountAllocationHistory_truncate_guard" BEFORE TRUNCATE ON "ProtocolCountAllocationHistory" FOR EACH STATEMENT EXECUTE FUNCTION "mcm_m13_reject_history_mutation"();

CREATE FUNCTION "mcm_m13_require_ledger_history_pair"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_id TEXT;
BEGIN
  receipt_id := NULLIF(current_setting('mcm.compliance_receipt_id', true), '');
  IF receipt_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM "ProtocolCountAllocationHistory" history
    WHERE history."ledgerId" = NEW.id AND history."commandReceiptId" = receipt_id
      AND history."reservedBefore" = OLD."reservedCount" AND history."reservedAfter" = NEW."reservedCount"
      AND history."consumedBefore" = OLD."consumedCount" AND history."consumedAfter" = NEW."consumedCount"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Protocol count ledger transition requires matching immutable allocation history';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "ProtocolCountLedger_history_pair"
AFTER UPDATE ON "ProtocolCountLedger" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "mcm_m13_require_ledger_history_pair"();

CREATE FUNCTION "mcm_m13_require_allocation_history_pair"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_id TEXT;
BEGIN
  receipt_id := NULLIF(current_setting('mcm.compliance_receipt_id', true), '');
  IF receipt_id IS NULL OR (TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM "ProtocolCountAllocationHistory" history
    WHERE history."allocationId" = NEW.id AND history."commandReceiptId" = receipt_id
      AND history."allocationType" = 'reserve' AND history."allocationVersionBefore" = 0 AND history."allocationVersionAfter" = 1
      AND history."allocationReservedBefore" = NEW."reservedQuantity" AND history."allocationReservedAfter" = NEW."reservedQuantity"
      AND history."allocationConsumedBefore" = 0 AND history."allocationConsumedAfter" = 0
      AND history."allocationReleasedBefore" = 0 AND history."allocationReleasedAfter" = 0
  )) OR (TG_OP = 'UPDATE' AND NOT EXISTS (
    SELECT 1 FROM "ProtocolCountAllocationHistory" history
    WHERE history."allocationId" = NEW.id AND history."commandReceiptId" = receipt_id
      AND history."allocationVersionBefore" = OLD.version AND history."allocationVersionAfter" = NEW.version
      AND history."allocationConsumedBefore" = OLD."consumedQuantity" AND history."allocationConsumedAfter" = NEW."consumedQuantity"
      AND history."allocationReleasedBefore" = OLD."releasedQuantity" AND history."allocationReleasedAfter" = NEW."releasedQuantity"
  )) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Protocol allocation transition requires matching immutable history';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "ProtocolCountAllocation_history_pair"
AFTER INSERT OR UPDATE ON "ProtocolCountAllocation" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "mcm_m13_require_allocation_history_pair"();

CREATE FUNCTION "mcm_m13_guard_compliance_snapshot"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt_record RECORD;
DECLARE protocol_record RECORD;
DECLARE personnel_record RECORD;
DECLARE competency_record RECORD;
DECLARE ledger_record RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND "mcm_m13_destructive_seed_allowed"() THEN RETURN OLD; END IF;
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Compliance evidence snapshots are immutable';
  END IF;
  IF NULLIF(current_setting('mcm.compliance_receipt_id', true), '') <> NEW."commandReceiptId" THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Compliance receipt context is missing or mismatched';
  END IF;
  SELECT * INTO receipt_record FROM "CommandReceipt" WHERE id = NEW."commandReceiptId" FOR SHARE;
  IF NOT FOUND OR receipt_record.status <> 'processing' OR receipt_record."transactionId" <> txid_current()
     OR receipt_record."actorId" <> NEW."actorId" OR receipt_record."labId" IS DISTINCT FROM NEW."labId"
     OR receipt_record."commandType" <> NEW."commandType" OR receipt_record."actorAuthzVersion" <> NEW."actorAuthzVersion" THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Compliance snapshot command receipt is not current';
  END IF;
  IF NEW."evidencePayload"::jsonb->>'policyVersion' IS DISTINCT FROM NEW."policyVersion"
     OR NEW."evidencePayload"::jsonb->>'protocolAuthorizationId' IS DISTINCT FROM NEW."protocolAuthorizationId"
     OR NEW."evidencePayload"::jsonb->>'protocolVersionId' IS DISTINCT FROM NEW."protocolVersionId"
     OR NEW."evidencePayload"::jsonb->>'protocolContentHash' IS DISTINCT FROM NEW."protocolContentHash"
     OR NEW."evidencePayload"::jsonb->>'procedureCode' IS DISTINCT FROM NEW."procedureCode"
     OR NEW."evidencePayload"::jsonb->>'scopeHash' IS DISTINCT FROM NEW."scopeHash"
     OR NEW."evidencePayload"::jsonb->>'scopePayload' IS DISTINCT FROM NEW."scopePayload"
     OR NEW."evidencePayload"::jsonb->'scopeSnapshot' IS DISTINCT FROM NEW."scopeSnapshot"
     OR NEW."evidencePayload"::jsonb->>'requiredPersonnelRole' IS DISTINCT FROM NEW."requiredPersonnelRole"::text
     OR NEW."evidencePayload"::jsonb->>'personnelBindingId' IS DISTINCT FROM NEW."personnelBindingId"
     OR NEW."evidencePayload"::jsonb->>'competencyEvidenceId' IS DISTINCT FROM NEW."competencyEvidenceId"
     OR NEW."evidencePayload"::jsonb->>'competencyVersionId' IS DISTINCT FROM NEW."competencyVersionId"
     OR NEW."evidencePayload"::jsonb->>'competencyContentHash' IS DISTINCT FROM NEW."competencyContentHash"
     OR NEW."evidencePayload"::jsonb->>'assurance' IS DISTINCT FROM NEW.assurance::text
     OR NEW."evidencePayload"::jsonb->>'identityLinkId' IS DISTINCT FROM NEW."identityLinkId"
     OR (NEW."evidencePayload"::jsonb->>'authenticatedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."authenticatedAt"
     OR NEW."evidencePayload"::jsonb->>'dutyAssignmentId' IS DISTINCT FROM NEW."dutyAssignmentId"
     OR (NEW."evidencePayload"::jsonb->>'dutyAssignmentVersion')::INTEGER IS DISTINCT FROM NEW."dutyAssignmentVersion"
     OR NEW."evidencePayload"::jsonb->>'ledgerId' IS DISTINCT FROM NEW."ledgerId"
     OR (NEW."evidencePayload"::jsonb->>'reservedBefore')::INTEGER IS DISTINCT FROM NEW."reservedBefore"
     OR (NEW."evidencePayload"::jsonb->>'reservedAfter')::INTEGER IS DISTINCT FROM NEW."reservedAfter"
     OR (NEW."evidencePayload"::jsonb->>'consumedBefore')::INTEGER IS DISTINCT FROM NEW."consumedBefore"
     OR (NEW."evidencePayload"::jsonb->>'consumedAfter')::INTEGER IS DISTINCT FROM NEW."consumedAfter"
     OR NEW."evidencePayload"::jsonb->>'actorId' IS DISTINCT FROM NEW."actorId"
     OR (NEW."evidencePayload"::jsonb->>'actorAuthzVersion')::INTEGER IS DISTINCT FROM NEW."actorAuthzVersion"
     OR NEW."evidencePayload"::jsonb->>'labId' IS DISTINCT FROM NEW."labId"
     OR NEW."evidencePayload"::jsonb->>'commandReceiptId' IS DISTINCT FROM NEW."commandReceiptId"
     OR NEW."evidencePayload"::jsonb->>'evidenceKey' IS DISTINCT FROM NEW."evidenceKey"
     OR NEW."evidencePayload"::jsonb->>'commandType' IS DISTINCT FROM NEW."commandType"
     OR NEW."evidencePayload"::jsonb->>'aggregateType' IS DISTINCT FROM NEW."aggregateType"
     OR NEW."evidencePayload"::jsonb->>'aggregateId' IS DISTINCT FROM NEW."aggregateId"
     OR NEW."evidencePayload"::jsonb->>'countOperation' IS DISTINCT FROM NEW."countOperation"::text
     OR (NEW."evidencePayload"::jsonb->>'countQuantity')::INTEGER IS DISTINCT FROM NEW."countQuantity"
     OR NEW."evidencePayload"::jsonb->'countAllocationSnapshot' IS DISTINCT FROM NEW."countAllocationSnapshot"
     OR (NEW."evidencePayload"::jsonb->>'evaluatedAt')::TIMESTAMPTZ IS DISTINCT FROM NEW."evaluatedAt" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Compliance snapshot canonical payload does not match its immutable evidence columns';
  END IF;
  SELECT protocol_auth.status, protocol_auth."labId", protocol_auth."currentVersionId", version_record."contentHash", version_record."validFrom", version_record."validUntil"
    INTO protocol_record
  FROM "ProtocolAuthorization" protocol_auth
  JOIN "ProtocolAuthorizationVersion" version_record ON version_record.id = NEW."protocolVersionId" AND version_record."authorizationId" = protocol_auth.id
  WHERE protocol_auth.id = NEW."protocolAuthorizationId" FOR SHARE;
  IF NOT FOUND OR protocol_record.status <> 'active' OR protocol_record."labId" <> NEW."labId"
     OR protocol_record."currentVersionId" <> NEW."protocolVersionId" OR protocol_record."contentHash" <> NEW."protocolContentHash"
     OR protocol_record."validFrom" > NEW."evaluatedAt" OR protocol_record."validUntil" <= NEW."evaluatedAt" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Compliance snapshot protocol evidence is not current';
  END IF;
  IF NEW."scopeSnapshot"->>'labId' IS DISTINCT FROM NEW."labId"
     OR NEW."scopeSnapshot"->>'procedureCode' IS DISTINCT FROM NEW."procedureCode"
     OR (NEW."scopeSnapshot"->>'projectId' IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "ProtocolProjectBinding" binding
       WHERE binding."authorizationVersionId" = NEW."protocolVersionId" AND binding."labId" = NEW."labId"
         AND binding."projectId" = NEW."scopeSnapshot"->>'projectId'
     ))
     OR (NEW."scopeSnapshot"->>'experimentId' IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "ProtocolExperimentBinding" binding
       WHERE binding."authorizationVersionId" = NEW."protocolVersionId" AND binding."labId" = NEW."labId"
         AND binding."experimentId" = NEW."scopeSnapshot"->>'experimentId'
     ))
     OR NOT EXISTS (
       SELECT 1 FROM "ProtocolProcedureBinding" binding
       WHERE binding."authorizationVersionId" = NEW."protocolVersionId" AND binding."labId" = NEW."labId"
         AND binding."procedureCode" = NEW."procedureCode"
     )
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(COALESCE(NEW."scopeSnapshot"->'strainIds', '[]'::jsonb)) strain(value)
       WHERE NOT EXISTS (
         SELECT 1 FROM "ProtocolStrainBinding" binding
         WHERE binding."authorizationVersionId" = NEW."protocolVersionId" AND binding."labId" = NEW."labId" AND binding."strainId" = strain.value
       )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Compliance snapshot requested scope is not bound to the protocol version';
  END IF;
  SELECT * INTO personnel_record FROM "ProtocolPersonnelBinding" WHERE id = NEW."personnelBindingId" FOR SHARE;
  IF NOT FOUND OR personnel_record."authorizationVersionId" <> NEW."protocolVersionId" OR personnel_record."labId" <> NEW."labId"
     OR personnel_record."userId" <> NEW."actorId" OR personnel_record."roleLabel" <> NEW."requiredPersonnelRole" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Actor is not named protocol personnel';
  END IF;
  IF NOT (NEW."scopeSnapshot"->'requiredPersonnelRoles' @> jsonb_build_array(NEW."requiredPersonnelRole"::text))
     OR (CASE
       WHEN NEW."commandType" LIKE 'breeding.%' OR NEW."commandType" LIKE 'breeding_setup.%'
         THEN NEW."requiredPersonnelRole" <> 'breeding_operator'
       WHEN NEW."commandType" LIKE 'experiment.%'
         THEN NEW."requiredPersonnelRole" NOT IN ('principal_investigator', 'named_researcher')
       WHEN NEW."commandType" LIKE 'lab_transfer.%'
         THEN NEW."requiredPersonnelRole" <> 'transfer_coordinator'
       WHEN NEW."commandType" LIKE 'animal_intake.%' OR NEW."commandType" LIKE 'intake.%' OR NEW."commandType" LIKE 'cage_intake.%'
         THEN NEW."requiredPersonnelRole" <> 'intake_operator'
       WHEN NEW."commandType" LIKE 'procedure.%'
         THEN NEW."requiredPersonnelRole" <> 'procedure_operator'
       ELSE TRUE
     END) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Compliance snapshot personnel role is not allowed for this command';
  END IF;
  SELECT evidence.status, evidence."userId", evidence."labId", evidence."procedureCode", evidence."currentVersionId", version_record.id AS version_id, version_record."contentHash", version_record."validFrom", version_record."validUntil"
    INTO competency_record
  FROM "CompetencyEvidence" evidence
  JOIN "CompetencyEvidenceVersion" version_record ON version_record.id = NEW."competencyVersionId" AND version_record."evidenceId" = evidence.id
  WHERE evidence.id = NEW."competencyEvidenceId" FOR SHARE;
  IF NOT FOUND OR competency_record.status <> 'current' OR competency_record."userId" <> NEW."actorId" OR competency_record."labId" <> NEW."labId"
     OR competency_record."procedureCode" <> NEW."procedureCode"
     OR competency_record."currentVersionId" <> NEW."competencyVersionId"
     OR competency_record."contentHash" <> NEW."competencyContentHash"
     OR competency_record."validFrom" > NEW."evaluatedAt" OR competency_record."validUntil" <= NEW."evaluatedAt" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Compliance snapshot competency evidence is not current';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "User" actor WHERE actor.id = NEW."actorId" AND actor.active
      AND actor."authzVersion" = NEW."actorAuthzVersion" AND actor.role <> 'it_head'::"UserRole"
  ) OR NOT EXISTS (
    SELECT 1 FROM "LabMembership" membership
    WHERE membership."userId" = NEW."actorId" AND membership."labId" = NEW."labId" AND membership.active
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Compliance snapshot actor authorization is stale';
  END IF;
  IF NOT "mcm_identity_assurance_snapshot_is_current"(NEW."actorId", NEW."identityLinkId", NEW.assurance, NEW."authenticatedAt", NEW."evaluatedAt") THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Compliance snapshot identity assurance is unavailable or stale';
  END IF;
  SELECT * INTO ledger_record FROM "ProtocolCountLedger" WHERE id = NEW."ledgerId" FOR SHARE;
  IF NOT FOUND OR ledger_record."authorizationVersionId" <> NEW."protocolVersionId" OR ledger_record."reservedCount" <> NEW."reservedAfter" OR ledger_record."consumedCount" <> NEW."consumedAfter" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Compliance snapshot count evidence does not match the ledger';
  END IF;
  IF (NEW."countOperation" = 'none' AND (jsonb_array_length(NEW."countAllocationSnapshot") <> 0
       OR NEW."reservedBefore" <> NEW."reservedAfter" OR NEW."consumedBefore" <> NEW."consumedAfter"))
     OR (NEW."countOperation" <> 'none' AND (
       jsonb_array_length(NEW."countAllocationSnapshot") = 0
       OR COALESCE((SELECT sum((item->>'quantity')::INTEGER) FROM jsonb_array_elements(NEW."countAllocationSnapshot") item), 0) <> NEW."countQuantity"
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(NEW."countAllocationSnapshot") item
         WHERE NOT EXISTS (
           SELECT 1 FROM "ProtocolCountAllocation" allocation
           WHERE allocation.id = item->>'id' AND allocation."ledgerId" = NEW."ledgerId"
             AND allocation."authorizationVersionId" = NEW."protocolVersionId"
             AND allocation."aggregateId" = item->>'aggregateId'
             AND EXISTS (
               SELECT 1 FROM "ProtocolCountAllocationHistory" history
               WHERE history."allocationId" = allocation.id AND history."commandReceiptId" = NEW."commandReceiptId"
                 AND history."allocationType"::text = NEW."countOperation"::text
                 AND history.quantity = (item->>'quantity')::INTEGER
             )
         )
       )
     )) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Compliance snapshot count operation does not match exact allocations';
  END IF;
  IF NEW."dutyAssignmentId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "FacilityDutyAssignment" duty
    WHERE duty.id = NEW."dutyAssignmentId" AND duty.version = NEW."dutyAssignmentVersion" AND duty."userId" = NEW."actorId"
      AND duty."revokedAt" IS NULL AND duty."validFrom" <= NEW."evaluatedAt" AND duty."validUntil" > NEW."evaluatedAt"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Compliance snapshot duty evidence is unavailable or stale';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ComplianceEvidenceSnapshot_guard" BEFORE INSERT OR UPDATE OR DELETE ON "ComplianceEvidenceSnapshot" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_compliance_snapshot"();
CREATE TRIGGER "ComplianceEvidenceSnapshot_truncate_guard" BEFORE TRUNCATE ON "ComplianceEvidenceSnapshot" FOR EACH STATEMENT EXECUTE FUNCTION "mcm_m13_reject_history_mutation"();

CREATE FUNCTION "mcm_m13_guard_transfer_compliance_evidence"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destination_changed BOOLEAN := TG_OP = 'INSERT';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    destination_changed := OLD."destinationComplianceEvidenceSnapshotId" IS DISTINCT FROM NEW."destinationComplianceEvidenceSnapshotId"
      OR OLD."destinationProtocolCountAllocationId" IS DISTINCT FROM NEW."destinationProtocolCountAllocationId";
  END IF;
  IF NEW."sourceProtocolAuthorizationId" IS NOT NULL OR NEW."sourceComplianceEvidenceSnapshotId" IS NOT NULL THEN
    IF NEW."sourceProtocolAuthorizationId" IS NULL OR NEW."sourceComplianceEvidenceSnapshotId" IS NULL OR NOT EXISTS (
      SELECT 1 FROM "ComplianceEvidenceSnapshot" snapshot
      JOIN "ProtocolAuthorization" protocol_auth ON protocol_auth.id = snapshot."protocolAuthorizationId"
      WHERE snapshot.id = NEW."sourceComplianceEvidenceSnapshotId"
        AND snapshot."protocolAuthorizationId" = NEW."sourceProtocolAuthorizationId"
        AND snapshot."aggregateType" = 'lab_transfer_request' AND snapshot."aggregateId" = NEW.id
        AND snapshot."labId" = NEW."sourceLabId" AND protocol_auth."labId" = NEW."sourceLabId"
        AND snapshot."actorId" = NEW."requestedById" AND snapshot."procedureCode" = 'transfer'
        AND snapshot."commandType" IN ('lab_transfer.request', 'lab_transfer.revise')
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Source transfer protocol evidence is missing or mismatched';
    END IF;
  END IF;
  IF NEW."destinationProtocolAuthorizationId" IS NOT NULL OR NEW."destinationComplianceEvidenceSnapshotId" IS NOT NULL OR NEW."destinationProtocolCountAllocationId" IS NOT NULL THEN
    IF NEW."destinationProtocolAuthorizationId" IS NULL OR NEW."destinationComplianceEvidenceSnapshotId" IS NULL OR NEW."destinationProtocolCountAllocationId" IS NULL OR NOT EXISTS (
      SELECT 1 FROM "ComplianceEvidenceSnapshot" snapshot
      JOIN "ProtocolAuthorization" protocol_auth ON protocol_auth.id = snapshot."protocolAuthorizationId"
      JOIN "ProtocolCountAllocation" allocation ON allocation.id = NEW."destinationProtocolCountAllocationId"
      WHERE snapshot.id = NEW."destinationComplianceEvidenceSnapshotId"
        AND snapshot."protocolAuthorizationId" = NEW."destinationProtocolAuthorizationId"
        AND snapshot."aggregateType" = 'lab_transfer_request' AND snapshot."aggregateId" = NEW.id
        AND snapshot."labId" = NEW."destinationLabId" AND protocol_auth."labId" = NEW."destinationLabId"
        AND snapshot."actorId" = NEW."destinationDecisionById" AND snapshot."procedureCode" = 'transfer'
        AND snapshot."commandType" = 'lab_transfer.destination_accept'
        AND allocation."authorizationVersionId" = snapshot."protocolVersionId"
        AND allocation."aggregateType" = 'lab_transfer_request' AND allocation."aggregateId" = NEW.id
        AND (NOT destination_changed OR (
          snapshot."countOperation" = 'reserve' AND snapshot."countQuantity" = allocation."reservedQuantity"
          AND allocation."reservedQuantity" = (SELECT count(*) FROM "LabTransferItem" item WHERE item."requestId" = NEW.id AND item.active)
        ))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Destination transfer protocol evidence is missing or mismatched';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "LabTransferRequest_compliance_evidence_guard"
BEFORE INSERT OR UPDATE ON "LabTransferRequest" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_transfer_compliance_evidence"();

CREATE FUNCTION "mcm_m13_guard_domain_evidence_link"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data JSONB := to_jsonb(NEW);
DECLARE old_data JSONB;
DECLARE snapshot_id TEXT := row_data->>'complianceEvidenceSnapshotId';
DECLARE allocation_id TEXT := row_data->>'protocolCountAllocationId';
DECLARE protocol_id TEXT := row_data->>'protocolAuthorizationId';
DECLARE expected_aggregate_type TEXT;
DECLARE snapshot_record RECORD;
DECLARE link_changed BOOLEAN;
BEGIN
  expected_aggregate_type := CASE TG_TABLE_NAME
    WHEN 'Experiment' THEN 'experiment'
    WHEN 'BreedingSetup' THEN 'breeding_setup'
    WHEN 'Litter' THEN 'litter'
    WHEN 'ExperimentAssignment' THEN 'experiment_assignment'
    WHEN 'AnimalIntakeBatch' THEN 'intake_batch'
    WHEN 'ProcedurePlan' THEN 'procedure_plan'
    WHEN 'ProcedureOccurrence' THEN 'procedure_occurrence'
    ELSE NULL
  END;
  IF TG_OP = 'UPDATE' THEN
    old_data := to_jsonb(OLD);
    link_changed := old_data->>'complianceEvidenceSnapshotId' IS DISTINCT FROM snapshot_id;
    IF (old_data->>'protocolAuthorizationId' IS DISTINCT FROM protocol_id AND NOT (
         TG_TABLE_NAME = 'Experiment' AND old_data->>'status' = 'planned' AND row_data->>'status' = 'planned'
         AND old_data->>'complianceEvidenceSnapshotId' IS NULL AND snapshot_id IS NULL
         AND NULLIF(current_setting('mcm.audit_receipt_id', true), '') IS NOT NULL
       ))
       OR (old_data->>'protocolCountAllocationId' IS NOT NULL AND old_data->>'protocolCountAllocationId' IS DISTINCT FROM allocation_id)
       OR (old_data->>'complianceEvidenceSnapshotId' IS NOT NULL AND link_changed AND TG_TABLE_NAME NOT IN ('Experiment', 'BreedingSetup')) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Frozen domain compliance evidence links are immutable';
    END IF;
  ELSE
    link_changed := snapshot_id IS NOT NULL;
  END IF;
  IF snapshot_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO snapshot_record FROM "ComplianceEvidenceSnapshot" snapshot WHERE snapshot.id = snapshot_id FOR SHARE;
  IF NOT FOUND OR snapshot_record."aggregateType" <> expected_aggregate_type OR snapshot_record."aggregateId" <> row_data->>'id'
     OR (protocol_id IS NOT NULL AND snapshot_record."protocolAuthorizationId" <> protocol_id)
     OR (link_changed AND snapshot_record."commandReceiptId" IS DISTINCT FROM NULLIF(current_setting('mcm.compliance_receipt_id', true), '')) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Domain row compliance evidence does not match its exact aggregate and command';
  END IF;
  IF allocation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ProtocolCountAllocation" allocation
    WHERE allocation.id = allocation_id AND allocation."authorizationVersionId" = snapshot_record."protocolVersionId"
      AND ((TG_TABLE_NAME = 'ProcedureOccurrence' AND allocation."aggregateType" = 'experiment_assignment'
            AND allocation."aggregateId" = row_data->>'assignmentId'
            AND EXISTS (
              SELECT 1 FROM "ProtocolCountAllocationHistory" history
              WHERE history."allocationId" = allocation.id AND history."commandReceiptId" = snapshot_record."commandReceiptId"
                AND history."allocationType" = 'consume' AND history."commandAggregateType" = 'procedure_plan'
                AND history."commandAggregateId" = row_data->>'planId'
            ))
        OR (TG_TABLE_NAME <> 'ProcedureOccurrence' AND allocation."aggregateType" = expected_aggregate_type
            AND allocation."aggregateId" = row_data->>'id'))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Domain row protocol allocation does not match its exact aggregate';
  END IF;
  IF snapshot_record."countOperation" <> 'none' AND allocation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Count-changing compliance evidence requires an exact domain allocation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "BreedingSetup_compliance_link_guard" BEFORE INSERT OR UPDATE ON "BreedingSetup" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_domain_evidence_link"();
CREATE TRIGGER "Experiment_compliance_link_guard" BEFORE INSERT OR UPDATE ON "Experiment" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_domain_evidence_link"();
CREATE TRIGGER "Litter_compliance_link_guard" BEFORE INSERT OR UPDATE ON "Litter" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_domain_evidence_link"();
CREATE TRIGGER "ExperimentAssignment_compliance_link_guard" BEFORE INSERT OR UPDATE ON "ExperimentAssignment" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_domain_evidence_link"();
CREATE TRIGGER "AnimalIntakeBatch_compliance_link_guard" BEFORE INSERT OR UPDATE ON "AnimalIntakeBatch" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_domain_evidence_link"();
CREATE TRIGGER "ProcedurePlan_compliance_link_guard" BEFORE INSERT OR UPDATE ON "ProcedurePlan" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_domain_evidence_link"();
CREATE TRIGGER "ProcedureOccurrence_compliance_link_guard" BEFORE INSERT OR UPDATE ON "ProcedureOccurrence" FOR EACH ROW EXECUTE FUNCTION "mcm_m13_guard_domain_evidence_link"();

CREATE FUNCTION "mcm_m13_guard_truncate"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF "mcm_m13_destructive_seed_allowed"() THEN RETURN NULL; END IF;
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = TG_TABLE_NAME || ' compliance history cannot be truncated';
END;
$$;
CREATE TRIGGER "ProtocolAuthorization_truncate_guard" BEFORE TRUNCATE ON "ProtocolAuthorization" FOR EACH STATEMENT EXECUTE FUNCTION "mcm_m13_guard_truncate"();
CREATE TRIGGER "ProtocolAuthorizationVersion_truncate_guard" BEFORE TRUNCATE ON "ProtocolAuthorizationVersion" FOR EACH STATEMENT EXECUTE FUNCTION "mcm_m13_guard_truncate"();
CREATE TRIGGER "ProtocolCountLedger_truncate_guard" BEFORE TRUNCATE ON "ProtocolCountLedger" FOR EACH STATEMENT EXECUTE FUNCTION "mcm_m13_guard_truncate"();
CREATE TRIGGER "CompetencyEvidence_truncate_guard" BEFORE TRUNCATE ON "CompetencyEvidence" FOR EACH STATEMENT EXECUTE FUNCTION "mcm_m13_guard_truncate"();

COMMIT;
