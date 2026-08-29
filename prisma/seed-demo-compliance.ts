import type { Prisma, ProtocolPersonnelRole } from "@prisma/client";

import { canonicalJson, canonicalJsonHash } from "../src/lib/command-foundation";
import { SEEDED_DEV_EMAILS } from "../src/lib/seed-metadata";
import { seedDutyQaFixture } from "./seed-duty-qa";

const POLICY_VERSION = "synthetic-fail-closed-v1";
const DAY = 24 * 60 * 60 * 1_000;

export const DEMO_PROTOCOL_AUTHORIZATION_ID = "demo-protocol-authorization";
export const DEMO_ADMIN_IDENTITY_LINK_ID = "demo-compliance-identity-link-1";

const VERSION_ID = `${DEMO_PROTOCOL_AUTHORIZATION_ID}-v1`;
const LEDGER_ID = `${VERSION_ID}-ledger`;
const REVIEWER_ID = "user-manager";
const SUBJECT_ID = "user-admin";
const REVIEWER_IDENTITY_LINK_ID = "demo-compliance-identity-link-2";
const REVIEWER_DUTY_ID = "demo-compliance-duty-assignment-1";
const TRAINER_DUTY_ID = "demo-compliance-duty-assignment-2";

async function createReceipt(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    actorId: string;
    actorAuthzVersion: number;
    commandType: string;
    aggregateType: string;
    aggregateId: string;
  },
) {
  await tx.commandReceipt.create({
    data: {
      ...input,
      labId: "lab-microglia",
      idempotencyKey: input.id,
      requestHash: canonicalJsonHash({ fixture: input.id }),
      requestId: input.id,
      status: "succeeded",
      result: { fixture: "base-demo-compliance" },
      completedAt: new Date(),
    },
  });
}

/**
 * Installs the bounded synthetic compliance contract used by the base demo and
 * integration API tests. The caller has already applied the destructive-seed
 * guard; replication-role bypass is scoped to this fixture transaction only.
 */
export async function seedDemoComplianceFixture(tx: Prisma.TransactionClient) {
  const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`;
  // The base demo contains historical 2026 workflow dates, so its synthetic
  // authorization must cover those examples as well as today's test run.
  const validFrom = new Date("2025-01-01T00:00:00.000Z");
  const validUntil = new Date(now.getTime() + 365 * DAY);

  await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
  await seedDutyQaFixture(tx, {
    fixturePrefix: "demo-compliance",
    requesterId: SUBJECT_ID,
    approverId: REVIEWER_ID,
    grants: [{
      targetUserId: REVIEWER_ID,
      duties: ["protocol_reviewer", "training_administrator"],
    }],
    syntheticIdentities: [
      { userId: SUBJECT_ID, subject: SEEDED_DEV_EMAILS.admin },
      { userId: REVIEWER_ID, subject: SEEDED_DEV_EMAILS.manager },
    ],
  });

  const [creator, reviewer] = await Promise.all([
    tx.user.findUniqueOrThrow({ where: { id: SUBJECT_ID }, select: { authzVersion: true } }),
    tx.user.findUniqueOrThrow({ where: { id: REVIEWER_ID }, select: { authzVersion: true } }),
  ]);
  const creationReceiptId = `${DEMO_PROTOCOL_AUTHORIZATION_ID}-draft-receipt`;
  const activationReceiptId = `${DEMO_PROTOCOL_AUTHORIZATION_ID}-activate-receipt`;
  await createReceipt(tx, {
    id: creationReceiptId,
    actorId: SUBJECT_ID,
    actorAuthzVersion: creator.authzVersion,
    commandType: "protocol_authorization.draft.create",
    aggregateType: "protocol_authorization",
    aggregateId: DEMO_PROTOCOL_AUTHORIZATION_ID,
  });
  await createReceipt(tx, {
    id: activationReceiptId,
    actorId: REVIEWER_ID,
    actorAuthzVersion: reviewer.authzVersion,
    commandType: "protocol_authorization.activate",
    aggregateType: "protocol_authorization",
    aggregateId: DEMO_PROTOCOL_AUTHORIZATION_ID,
  });

  const personnel: Array<{ userId: string; roleLabel: ProtocolPersonnelRole }> = [
    { userId: SUBJECT_ID, roleLabel: "principal_investigator" },
    { userId: SUBJECT_ID, roleLabel: "named_researcher" },
    { userId: SUBJECT_ID, roleLabel: "breeding_operator" },
    { userId: SUBJECT_ID, roleLabel: "intake_operator" },
  ];
  const content = {
    labId: "lab-microglia",
    protocolCode: "DEMO-SYNTHETIC-BASE",
    title: "Synthetic base-demo animal-use authorization",
    summary: "Synthetic authorization for disposable base-demo and integration fixtures.",
    validFrom: validFrom.toISOString(),
    validUntil: validUntil.toISOString(),
    approvedAnimalCount: 250,
    projectIds: ["project-micro"],
    experimentIds: ["experiment-001", "experiment-002"],
    strainIds: ["strain-creer", "strain-creer-tdt", "strain-tdt"],
    procedureCodes: ["animal-use", "breeding", "intake"],
    personnel,
    policyVersion: POLICY_VERSION,
  };

  await tx.protocolAuthorization.create({
    data: {
      id: DEMO_PROTOCOL_AUTHORIZATION_ID,
      labId: "lab-microglia",
      protocolCode: content.protocolCode,
      title: content.title,
      status: "draft",
      createdById: SUBJECT_ID,
    },
  });
  await tx.protocolAuthorizationVersion.create({
    data: {
      id: VERSION_ID,
      authorizationId: DEMO_PROTOCOL_AUTHORIZATION_ID,
      versionNumber: 1,
      contentHash: canonicalJsonHash(content),
      contentPayload: canonicalJson(content),
      policyVersion: POLICY_VERSION,
      validFrom,
      validUntil,
      approvedAnimalCount: content.approvedAnimalCount,
      summary: content.summary,
      createdById: SUBJECT_ID,
      creationCommandReceiptId: creationReceiptId,
      scopeSealedAt: now,
    },
  });
  await Promise.all([
    tx.protocolProjectBinding.create({
      data: { id: `${VERSION_ID}-project`, authorizationVersionId: VERSION_ID, labId: "lab-microglia", projectId: "project-micro" },
    }),
    tx.protocolExperimentBinding.createMany({
      data: content.experimentIds.map((experimentId, index) => ({ id: `${VERSION_ID}-experiment-${index + 1}`, authorizationVersionId: VERSION_ID, labId: "lab-microglia", experimentId })),
    }),
    tx.protocolStrainBinding.createMany({
      data: content.strainIds.map((strainId, index) => ({ id: `${VERSION_ID}-strain-${index + 1}`, authorizationVersionId: VERSION_ID, labId: "lab-microglia", strainId })),
    }),
    tx.protocolProcedureBinding.createMany({
      data: content.procedureCodes.map((procedureCode, index) => ({ id: `${VERSION_ID}-procedure-${index + 1}`, authorizationVersionId: VERSION_ID, labId: "lab-microglia", procedureCode })),
    }),
    tx.protocolPersonnelBinding.createMany({
      data: personnel.map((binding, index) => ({ id: `${VERSION_ID}-person-${index + 1}`, authorizationVersionId: VERSION_ID, labId: "lab-microglia", ...binding })),
    }),
  ]);
  await tx.protocolCountLedger.create({
    data: { id: LEDGER_ID, authorizationVersionId: VERSION_ID, approvedCount: 250, reservedCount: 8, version: 2 },
  });
  await tx.protocolAuthorization.update({
    where: { id: DEMO_PROTOCOL_AUTHORIZATION_ID },
    data: {
      currentVersionId: VERSION_ID,
      status: "active",
      reviewedById: REVIEWER_ID,
      reviewedByAuthzVersion: reviewer.authzVersion,
      reviewedAssurance: "synthetic_mfa",
      reviewedIdentityLinkId: REVIEWER_IDENTITY_LINK_ID,
      reviewedAuthenticatedAt: now,
      reviewedDutyAssignmentId: REVIEWER_DUTY_ID,
      reviewedDutyAssignmentVersion: 1,
      reviewedAt: now,
      activatedAt: now,
      statusReason: "Approved synthetic base-demo fixture.",
      version: 2,
    },
  });
  await tx.protocolAuthorizationLifecycleEvent.create({
    data: {
      id: `${DEMO_PROTOCOL_AUTHORIZATION_ID}-activate-event`,
      authorizationId: DEMO_PROTOCOL_AUTHORIZATION_ID,
      fromStatus: "draft",
      toStatus: "active",
      actorId: REVIEWER_ID,
      actorAuthzVersion: reviewer.authzVersion,
      assurance: "synthetic_mfa",
      identityLinkId: REVIEWER_IDENTITY_LINK_ID,
      authenticatedAt: now,
      dutyAssignmentId: REVIEWER_DUTY_ID,
      dutyAssignmentVersion: 1,
      commandReceiptId: activationReceiptId,
      reason: "Approved synthetic base-demo fixture.",
      occurredAt: now,
    },
  });

  for (const procedureCode of content.procedureCodes) {
    const evidenceId = `demo-competency-${procedureCode}`;
    const evidenceVersionId = `${evidenceId}-v1`;
    const receiptId = `${evidenceId}-receipt`;
    const note = "Current synthetic competency for disposable integration scenarios.";
    const payload = {
      userId: SUBJECT_ID,
      labId: "lab-microglia",
      procedureCode,
      evidenceType: "synthetic_training_record",
      validFrom: validFrom.toISOString(),
      validUntil: validUntil.toISOString(),
      protocolVersionId: null,
      note,
      versionNumber: 1,
    };
    await createReceipt(tx, {
      id: receiptId,
      actorId: REVIEWER_ID,
      actorAuthzVersion: reviewer.authzVersion,
      commandType: "competency_evidence.create",
      aggregateType: "competency_evidence",
      aggregateId: evidenceId,
    });
    await tx.competencyEvidence.create({
      data: {
        id: evidenceId,
        userId: SUBJECT_ID,
        labId: "lab-microglia",
        procedureCode,
        status: "current",
        governedById: REVIEWER_ID,
        governedByAuthzVersion: reviewer.authzVersion,
        governedAssurance: "synthetic_mfa",
        governedIdentityLinkId: REVIEWER_IDENTITY_LINK_ID,
        governedAuthenticatedAt: now,
        governedDutyAssignmentId: TRAINER_DUTY_ID,
        governedDutyAssignmentVersion: 1,
        governedAt: now,
      },
    });
    await tx.competencyEvidenceVersion.create({
      data: {
        id: evidenceVersionId,
        evidenceId,
        versionNumber: 1,
        evidenceType: payload.evidenceType,
        contentHash: canonicalJsonHash(payload),
        contentPayload: canonicalJson(payload),
        validFrom,
        validUntil,
        issuedById: REVIEWER_ID,
        commandReceiptId: receiptId,
        note,
      },
    });
    await tx.competencyEvidence.update({ where: { id: evidenceId }, data: { currentVersionId: evidenceVersionId } });
    await tx.competencyLifecycleEvent.create({
      data: {
        id: `${evidenceId}-event`,
        evidenceId,
        actorId: REVIEWER_ID,
        actorAuthzVersion: reviewer.authzVersion,
        assurance: "synthetic_mfa",
        identityLinkId: REVIEWER_IDENTITY_LINK_ID,
        authenticatedAt: now,
        dutyAssignmentId: TRAINER_DUTY_ID,
        dutyAssignmentVersion: 1,
        commandReceiptId: receiptId,
        eventType: "created",
        evidenceVersion: 1,
        detail: { fixture: "base-demo-compliance" },
        occurredAt: now,
      },
    });
  }

  const allocationReceiptId = "demo-litter-001-allocation-receipt";
  const allocationId = "demo-litter-001-allocation";
  const allocationKey = "litter:litter-001:birth";
  await createReceipt(tx, {
    id: allocationReceiptId,
    actorId: SUBJECT_ID,
    actorAuthzVersion: creator.authzVersion,
    commandType: "breeding.litter.record",
    aggregateType: "litter",
    aggregateId: "litter-001",
  });
  await tx.protocolCountAllocation.create({
    data: {
      id: allocationId,
      ledgerId: LEDGER_ID,
      authorizationVersionId: VERSION_ID,
      allocationKey,
      aggregateType: "litter",
      aggregateId: "litter-001",
      reservedQuantity: 8,
      createdById: SUBJECT_ID,
      createdCommandReceiptId: allocationReceiptId,
    },
  });
  await tx.protocolCountAllocationHistory.create({
    data: {
      id: `${allocationId}-reserve`,
      allocationId,
      ledgerId: LEDGER_ID,
      authorizationVersionId: VERSION_ID,
      commandReceiptId: allocationReceiptId,
      allocationKey,
      allocationType: "reserve",
      quantity: 8,
      allocationReservedBefore: 0,
      allocationReservedAfter: 8,
      allocationConsumedBefore: 0,
      allocationConsumedAfter: 0,
      allocationReleasedBefore: 0,
      allocationReleasedAfter: 0,
      allocationVersionBefore: 0,
      allocationVersionAfter: 1,
      reservedBefore: 0,
      reservedAfter: 8,
      consumedBefore: 0,
      consumedAfter: 0,
      aggregateType: "litter",
      aggregateId: "litter-001",
      commandAggregateType: "litter",
      commandAggregateId: "litter-001",
      actorId: SUBJECT_ID,
      occurredAt: now,
    },
  });
  await Promise.all([
    tx.breedingSetup.update({ where: { id: "breeding-001" }, data: { protocolAuthorizationId: DEMO_PROTOCOL_AUTHORIZATION_ID } }),
    tx.litter.update({ where: { id: "litter-001" }, data: { protocolCountAllocationId: allocationId } }),
    tx.experiment.updateMany({ where: { id: { in: content.experimentIds } }, data: { protocolAuthorizationId: DEMO_PROTOCOL_AUTHORIZATION_ID } }),
  ]);
  await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
}
