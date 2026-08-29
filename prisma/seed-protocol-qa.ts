import type {
  Prisma,
  ProtocolAuthorizationStatus,
  ProtocolPersonnelRole,
} from "@prisma/client";

import { canonicalJson, canonicalJsonHash } from "../src/lib/command-foundation";

const POLICY_VERSION = "synthetic-fail-closed-v1";
const DAY = 24 * 60 * 60 * 1_000;

type ProtocolFixture = {
  slug: string;
  code: string;
  title: string;
  labId: string;
  projectIds: string[];
  experimentIds: string[];
  strainIds: string[];
  procedureCodes: string[];
  personnel: Array<{ userId: string; roleLabel: ProtocolPersonnelRole }>;
  status: ProtocolAuthorizationStatus;
  validFrom: Date;
  validUntil: Date;
  approvedAnimalCount: number;
  reservedCount?: number;
};

async function createFixtureReceipt(
  tx: Prisma.TransactionClient,
  input: {
    id: string;
    actorId: string;
    actorAuthzVersion: number;
    labId: string;
    commandType: string;
    aggregateType: string;
    aggregateId: string;
  },
) {
  await tx.commandReceipt.create({
    data: {
      ...input,
      idempotencyKey: input.id,
      requestHash: canonicalJsonHash({ fixture: input.id }),
      requestId: input.id,
      status: "succeeded",
      result: { fixture: true },
      completedAt: new Date(),
    },
  });
}

/**
 * Adds bounded synthetic M13 examples after the ordinary role-QA seed. This is
 * fixture construction, not an authorization path: callers must already have
 * passed the guarded disposable-database check. Triggers are disabled only for
 * this transaction so expired/revoked/read-only examples can be installed with
 * stable historical timestamps.
 */
export async function seedProtocolQaFixture(tx: Prisma.TransactionClient) {
  const [clock, reviewer, trainer] = await Promise.all([
    tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`,
    tx.user.findUniqueOrThrow({ where: { id: "user-facility-admin-qa" }, select: { authzVersion: true } }),
    tx.user.findUniqueOrThrow({ where: { id: "user-facility-admin-approver-qa" }, select: { authzVersion: true } }),
  ]);
  const now = clock[0]?.now ?? new Date(0);
  const reviewerIdentityId = "role-qa-identity-link-1";
  const trainerIdentityId = "role-qa-identity-link-2";
  const reviewerDutyId = "role-qa-duty-assignment-3";
  const trainerDutyId = "role-qa-duty-assignment-5";
  const creatorId = "user-lab-owner-qa";

  const protocols: ProtocolFixture[] = [
    {
      slug: "active-six",
      code: "QA-ACTIVE-6",
      title: "QA active six-animal authorization",
      labId: "lab-microglia",
      projectIds: ["project-micro"],
      experimentIds: ["experiment-001"],
      strainIds: ["strain-creer"],
      procedureCodes: ["breeding", "intake", "tamoxifen_injection", "transfer"],
      personnel: [
        { userId: creatorId, roleLabel: "principal_investigator" },
        { userId: creatorId, roleLabel: "breeding_operator" },
        { userId: creatorId, roleLabel: "intake_operator" },
        { userId: creatorId, roleLabel: "procedure_operator" },
        { userId: creatorId, roleLabel: "transfer_coordinator" },
      ],
      status: "active",
      validFrom: new Date(now.getTime() - 30 * DAY),
      validUntil: new Date(now.getTime() + 180 * DAY),
      approvedAnimalCount: 6,
      reservedCount: 5,
    },
    {
      slug: "wrong-strain",
      code: "QA-WRONG-STRAIN",
      title: "QA wrong-strain boundary",
      labId: "lab-microglia",
      projectIds: ["project-micro"],
      experimentIds: [],
      strainIds: ["strain-cas9"],
      procedureCodes: ["breeding"],
      personnel: [{ userId: creatorId, roleLabel: "breeding_operator" }],
      status: "active",
      validFrom: new Date(now.getTime() - 30 * DAY),
      validUntil: new Date(now.getTime() + 180 * DAY),
      approvedAnimalCount: 6,
    },
    {
      slug: "wrong-procedure",
      code: "QA-WRONG-PROCEDURE",
      title: "QA wrong-procedure boundary",
      labId: "lab-microglia",
      projectIds: ["project-micro"],
      experimentIds: [],
      strainIds: ["strain-creer"],
      procedureCodes: ["transfer"],
      personnel: [{ userId: creatorId, roleLabel: "transfer_coordinator" }],
      status: "active",
      validFrom: new Date(now.getTime() - 30 * DAY),
      validUntil: new Date(now.getTime() + 180 * DAY),
      approvedAnimalCount: 6,
    },
    {
      slug: "cross-lab",
      code: "QA-CROSS-LAB",
      title: "QA destination-lab boundary",
      labId: "lab-neuroimmune",
      projectIds: ["project-neuro"],
      experimentIds: [],
      strainIds: ["strain-wt"],
      procedureCodes: ["transfer"],
      personnel: [{ userId: "user-manager", roleLabel: "transfer_coordinator" }],
      status: "active",
      validFrom: new Date(now.getTime() - 30 * DAY),
      validUntil: new Date(now.getTime() + 180 * DAY),
      approvedAnimalCount: 6,
    },
    {
      slug: "expired",
      code: "QA-EXPIRED",
      title: "QA expired authorization",
      labId: "lab-microglia",
      projectIds: ["project-micro"],
      experimentIds: [],
      strainIds: ["strain-creer"],
      procedureCodes: ["breeding"],
      personnel: [{ userId: creatorId, roleLabel: "breeding_operator" }],
      status: "expired",
      validFrom: new Date(now.getTime() - 60 * DAY),
      validUntil: new Date(now.getTime() - DAY),
      approvedAnimalCount: 6,
    },
    {
      slug: "suspended",
      code: "QA-SUSPENDED",
      title: "QA suspended authorization",
      labId: "lab-microglia",
      projectIds: ["project-micro"],
      experimentIds: [],
      strainIds: ["strain-creer"],
      procedureCodes: ["breeding"],
      personnel: [{ userId: creatorId, roleLabel: "breeding_operator" }],
      status: "suspended",
      validFrom: new Date(now.getTime() - 30 * DAY),
      validUntil: new Date(now.getTime() + 180 * DAY),
      approvedAnimalCount: 6,
    },
  ];

  await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
  for (const protocol of protocols) {
    const authorizationId = `role-qa-protocol-${protocol.slug}`;
    const versionId = `${authorizationId}-v1`;
    const creationReceiptId = `${authorizationId}-draft-receipt`;
    const reviewReceiptId = `${authorizationId}-review-receipt`;
    const content = {
      labId: protocol.labId,
      protocolCode: protocol.code,
      title: protocol.title,
      summary: `${protocol.title} synthetic fixture.`,
      validFrom: protocol.validFrom.toISOString(),
      validUntil: protocol.validUntil.toISOString(),
      approvedAnimalCount: protocol.approvedAnimalCount,
      projectIds: protocol.projectIds,
      experimentIds: protocol.experimentIds,
      strainIds: protocol.strainIds,
      procedureCodes: protocol.procedureCodes,
      personnel: protocol.personnel,
      policyVersion: POLICY_VERSION,
    };
    const creator = await tx.user.findUniqueOrThrow({ where: { id: creatorId }, select: { authzVersion: true } });
    await createFixtureReceipt(tx, {
      id: creationReceiptId,
      actorId: creatorId,
      actorAuthzVersion: creator.authzVersion,
      labId: protocol.labId,
      commandType: "protocol_authorization.draft.create",
      aggregateType: "protocol_authorization",
      aggregateId: authorizationId,
    });
    await createFixtureReceipt(tx, {
      id: reviewReceiptId,
      actorId: "user-facility-admin-qa",
      actorAuthzVersion: reviewer.authzVersion,
      labId: protocol.labId,
      commandType: `protocol_authorization.${protocol.status === "active" ? "activate" : protocol.status}`,
      aggregateType: "protocol_authorization",
      aggregateId: authorizationId,
    });
    await tx.protocolAuthorization.create({
      data: {
        id: authorizationId,
        labId: protocol.labId,
        protocolCode: protocol.code,
        title: protocol.title,
        status: "draft",
        createdById: creatorId,
      },
    });
    await tx.protocolAuthorizationVersion.create({
      data: {
        id: versionId,
        authorizationId,
        versionNumber: 1,
        contentPayload: canonicalJson(content),
        contentHash: canonicalJsonHash(content),
        validFrom: protocol.validFrom,
        validUntil: protocol.validUntil,
        approvedAnimalCount: protocol.approvedAnimalCount,
        summary: content.summary,
        createdById: creatorId,
        creationCommandReceiptId: creationReceiptId,
        scopeSealedAt: now,
      },
    });
    await Promise.all([
      tx.protocolProjectBinding.createMany({ data: protocol.projectIds.map((projectId, index) => ({ id: `${versionId}-project-${index + 1}`, authorizationVersionId: versionId, labId: protocol.labId, projectId })) }),
      tx.protocolExperimentBinding.createMany({ data: protocol.experimentIds.map((experimentId, index) => ({ id: `${versionId}-experiment-${index + 1}`, authorizationVersionId: versionId, labId: protocol.labId, experimentId })) }),
      tx.protocolStrainBinding.createMany({ data: protocol.strainIds.map((strainId, index) => ({ id: `${versionId}-strain-${index + 1}`, authorizationVersionId: versionId, labId: protocol.labId, strainId })) }),
      tx.protocolProcedureBinding.createMany({ data: protocol.procedureCodes.map((procedureCode, index) => ({ id: `${versionId}-procedure-${index + 1}`, authorizationVersionId: versionId, labId: protocol.labId, procedureCode })) }),
      tx.protocolPersonnelBinding.createMany({ data: protocol.personnel.map((person, index) => ({ id: `${versionId}-person-${index + 1}`, authorizationVersionId: versionId, labId: protocol.labId, ...person })) }),
    ]);
    const ledgerId = `${versionId}-ledger`;
    await tx.protocolCountLedger.create({
      data: {
        id: ledgerId,
        authorizationVersionId: versionId,
        approvedCount: protocol.approvedAnimalCount,
        reservedCount: protocol.reservedCount ?? 0,
        version: protocol.reservedCount ? 2 : 1,
      },
    });
    await tx.protocolAuthorization.update({
      where: { id: authorizationId },
      data: {
        currentVersionId: versionId,
        status: protocol.status,
        reviewedById: "user-facility-admin-qa",
        reviewedByAuthzVersion: reviewer.authzVersion,
        reviewedAssurance: "synthetic_mfa",
        reviewedIdentityLinkId: reviewerIdentityId,
        reviewedAuthenticatedAt: now,
        reviewedDutyAssignmentId: reviewerDutyId,
        reviewedDutyAssignmentVersion: 1,
        reviewedAt: now,
        activatedAt: protocol.status === "active" ? now : null,
        suspendedAt: protocol.status === "suspended" ? now : null,
        statusReason: "Synthetic role-QA protocol fixture.",
        version: 2,
      },
    });
    await tx.protocolAuthorizationLifecycleEvent.create({
      data: {
        id: `${authorizationId}-review-event`, authorizationId, fromStatus: "draft", toStatus: protocol.status,
        actorId: "user-facility-admin-qa", actorAuthzVersion: reviewer.authzVersion, assurance: "synthetic_mfa",
        identityLinkId: reviewerIdentityId, authenticatedAt: now, dutyAssignmentId: reviewerDutyId,
        dutyAssignmentVersion: 1, commandReceiptId: reviewReceiptId, reason: "Synthetic role-QA review fixture.", occurredAt: now,
      },
    });
    if (protocol.reservedCount) {
      const allocationId = `${versionId}-allocation-concurrency`;
      const allocationKey = `${authorizationId}:concurrency`;
      const allocationReceiptId = `${authorizationId}-allocation-receipt`;
      await createFixtureReceipt(tx, {
        id: allocationReceiptId, actorId: creatorId, actorAuthzVersion: creator.authzVersion, labId: protocol.labId,
        commandType: "experiment.assignments.promote", aggregateType: "qa_concurrency", aggregateId: authorizationId,
      });
      await tx.protocolCountAllocation.create({
        data: {
          id: allocationId, ledgerId, authorizationVersionId: versionId, allocationKey,
          aggregateType: "qa_concurrency", aggregateId: authorizationId, reservedQuantity: protocol.reservedCount,
          createdById: creatorId, createdCommandReceiptId: allocationReceiptId,
        },
      });
      await tx.protocolCountAllocationHistory.create({
        data: {
          id: `${allocationId}-reserve`, allocationId, ledgerId, authorizationVersionId: versionId,
          commandReceiptId: allocationReceiptId, allocationKey, allocationType: "reserve", quantity: protocol.reservedCount,
          allocationReservedBefore: 0, allocationReservedAfter: protocol.reservedCount,
          allocationConsumedBefore: 0, allocationConsumedAfter: 0, allocationReleasedBefore: 0, allocationReleasedAfter: 0,
          allocationVersionBefore: 0, allocationVersionAfter: 1, reservedBefore: 0, reservedAfter: protocol.reservedCount,
          consumedBefore: 0, consumedAfter: 0, aggregateType: "qa_concurrency", aggregateId: authorizationId,
          commandAggregateType: "qa_concurrency", commandAggregateId: authorizationId, actorId: creatorId,
        },
      });
    }
  }

  await tx.protocolAuthorization.create({
    data: {
      id: "role-qa-protocol-legacy-unverified",
      labId: "lab-microglia",
      protocolCode: "QA-LEGACY",
      title: "QA legacy unverified authorization",
      status: "legacy_unverified",
      createdById: creatorId,
      statusReason: "Read-only legacy example; no authorization evidence was invented.",
    },
  });

  const competencyFixtures = [
    { slug: "breeding-current", userId: creatorId, procedureCode: "breeding", status: "current" as const, validFrom: new Date(now.getTime() - 30 * DAY), validUntil: new Date(now.getTime() + 180 * DAY) },
    { slug: "intake-current", userId: creatorId, procedureCode: "intake", status: "current" as const, validFrom: new Date(now.getTime() - 30 * DAY), validUntil: new Date(now.getTime() + 180 * DAY) },
    { slug: "transfer-current", userId: creatorId, procedureCode: "transfer", status: "current" as const, validFrom: new Date(now.getTime() - 30 * DAY), validUntil: new Date(now.getTime() + 180 * DAY) },
    { slug: "procedure-current", userId: creatorId, procedureCode: "tamoxifen_injection", status: "current" as const, validFrom: new Date(now.getTime() - 30 * DAY), validUntil: new Date(now.getTime() + 180 * DAY) },
    { slug: "breeding-expired", userId: "user-lab-staff-qa", procedureCode: "breeding", status: "expired" as const, validFrom: new Date(now.getTime() - 60 * DAY), validUntil: new Date(now.getTime() - DAY) },
    { slug: "transfer-revoked", userId: "user-lab-manager-qa", procedureCode: "transfer", status: "revoked" as const, validFrom: new Date(now.getTime() - 30 * DAY), validUntil: new Date(now.getTime() + 180 * DAY) },
  ];
  for (const competency of competencyFixtures) {
    const evidenceId = `role-qa-competency-${competency.slug}`;
    const versionId = `${evidenceId}-v1`;
    const receiptId = `${evidenceId}-receipt`;
    const note = "Synthetic role-QA competency fixture.";
    const payload = {
      userId: competency.userId, labId: "lab-microglia", procedureCode: competency.procedureCode,
      evidenceType: "synthetic_training_record", validFrom: competency.validFrom.toISOString(),
      validUntil: competency.validUntil.toISOString(), protocolVersionId: null, note, versionNumber: 1,
    };
    await createFixtureReceipt(tx, {
      id: receiptId, actorId: "user-facility-admin-approver-qa", actorAuthzVersion: trainer.authzVersion,
      labId: "lab-microglia", commandType: "competency_evidence.create", aggregateType: "competency_evidence", aggregateId: evidenceId,
    });
    await tx.competencyEvidence.create({
      data: {
        id: evidenceId, userId: competency.userId, labId: "lab-microglia", procedureCode: competency.procedureCode,
        status: competency.status, revokedAt: competency.status === "revoked" ? now : null,
        governedById: "user-facility-admin-approver-qa", governedByAuthzVersion: trainer.authzVersion,
        governedAssurance: "synthetic_mfa", governedIdentityLinkId: trainerIdentityId, governedAuthenticatedAt: now,
        governedDutyAssignmentId: trainerDutyId, governedDutyAssignmentVersion: 1, governedAt: now,
      },
    });
    await tx.competencyEvidenceVersion.create({
      data: {
        id: versionId, evidenceId, versionNumber: 1, evidenceType: "synthetic_training_record",
        contentPayload: canonicalJson(payload), contentHash: canonicalJsonHash(payload), validFrom: competency.validFrom,
        validUntil: competency.validUntil, issuedById: "user-facility-admin-approver-qa", commandReceiptId: receiptId, note,
      },
    });
    await tx.competencyEvidence.update({ where: { id: evidenceId }, data: { currentVersionId: versionId } });
    await tx.competencyLifecycleEvent.create({
      data: {
        id: `${evidenceId}-event`, evidenceId, actorId: "user-facility-admin-approver-qa",
        actorAuthzVersion: trainer.authzVersion, assurance: "synthetic_mfa", identityLinkId: trainerIdentityId,
        authenticatedAt: now, dutyAssignmentId: trainerDutyId, dutyAssignmentVersion: 1, commandReceiptId: receiptId,
        eventType: competency.status === "revoked" ? "revoked" : competency.status === "expired" ? "expired" : "created",
        evidenceVersion: 1, detail: { fixture: true }, occurredAt: now,
      },
    });
  }
  await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
}
