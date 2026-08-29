import { randomUUID } from "node:crypto";

import {
  Prisma,
  type FacilityDuty,
  type ProtocolCountAllocationType,
  type ProtocolPersonnelRole,
} from "@prisma/client";

import { canonicalJson, canonicalJsonHash } from "@/lib/command-foundation";
import type { ResolvedActor } from "@/lib/session";

export const COMPLIANCE_POLICY_VERSION = "synthetic-fail-closed-v1" as const;
export const GENERAL_ANIMAL_USE_COMPETENCY = "animal-use" as const;

export const COMPLIANCE_ERROR = {
  protocolRequired: "compliance_protocol_required",
  protocolInactive: "compliance_protocol_inactive",
  protocolOutOfScope: "compliance_protocol_out_of_scope",
  personnelNotNamed: "compliance_personnel_not_named",
  competencyRequired: "compliance_competency_required",
  assuranceRequired: "compliance_assurance_required",
  dutyRequired: "compliance_duty_required",
  countExceeded: "compliance_count_exceeded",
  countConflict: "compliance_count_conflict",
} as const;

export type ComplianceCountOperation = ProtocolCountAllocationType | "none";

export type ComplianceGateInput = {
  actor: ResolvedActor;
  receiptId: string;
  commandType: string;
  labId: string;
  aggregateType: string;
  aggregateId: string;
  commandAggregateType?: string;
  commandAggregateId?: string;
  protocolAuthorizationId: string | null | undefined;
  projectId?: string | null;
  experimentId?: string | null;
  strainIds?: readonly string[];
  procedureCode?: string | null;
  requiredPersonnelRoles: readonly ProtocolPersonnelRole[];
  requiredDuty?: FacilityDuty | null;
  countOperation?: ComplianceCountOperation;
  quantity?: number;
  allocationKey?: string;
  sourceAllocationId?: string | null;
  evidenceKey?: string;
  allocationUnits?: ReadonlyArray<{
    allocationKey: string;
    aggregateType: string;
    aggregateId: string;
    quantity: number;
  }>;
};

type ComplianceFailure = {
  ok: false;
  code: (typeof COMPLIANCE_ERROR)[keyof typeof COMPLIANCE_ERROR];
  message: string;
};

type ComplianceSuccess = {
  ok: true;
  evidenceSnapshotId: string;
  protocolAuthorizationId: string;
  protocolVersionId: string;
  reservedBefore: number;
  reservedAfter: number;
  consumedBefore: number;
  consumedAfter: number;
  allocationId: string | null;
  allocations: ReadonlyArray<{
    id: string;
    allocationKey: string;
    aggregateId: string;
    quantity: number;
    evidenceSnapshotId: string;
  }>;
};

function fail(
  code: ComplianceFailure["code"],
  message: string,
): ComplianceFailure {
  return { ok: false, code, message };
}

function uniqueSorted(values: readonly string[] | undefined) {
  return [
    ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  ].sort();
}

/**
 * Evaluates the bounded synthetic M13 policy and freezes the result inside the
 * caller's idempotent command transaction. A `none` count operation records
 * before=after ledger values; it never invents a reservation or consumption.
 */
export async function evaluateAndWriteComplianceEvidence(
  tx: Prisma.TransactionClient,
  input: ComplianceGateInput,
) {
  const protocolId = input.protocolAuthorizationId?.trim();
  if (!protocolId) {
    return fail(
      COMPLIANCE_ERROR.protocolRequired,
      "Select a verified protocol authorization before continuing.",
    );
  }
  const procedureCode =
    input.procedureCode?.trim() || GENERAL_ANIMAL_USE_COMPETENCY;
  const evidenceKey = input.evidenceKey?.trim() || "primary";
  const strainIds = uniqueSorted(input.strainIds);
  const countOperation = input.countOperation ?? "none";
  const quantity = input.quantity ?? 0;
  if (
    (countOperation === "none" && quantity !== 0) ||
    (countOperation !== "none" && (!Number.isInteger(quantity) || quantity < 1))
  ) {
    return fail(
      COMPLIANCE_ERROR.countConflict,
      "The protocol count operation is invalid.",
    );
  }
  if (
    (countOperation === "release" || countOperation === "consume") &&
    !input.sourceAllocationId
  ) {
    return fail(
      COMPLIANCE_ERROR.countConflict,
      "A specific reserved allocation is required for settlement.",
    );
  }

  const protocol = await tx.protocolAuthorization.findFirst({
    where: { id: protocolId, labId: input.labId },
    select: {
      id: true,
      status: true,
      currentVersionId: true,
      currentVersion: {
        select: {
          id: true,
          contentHash: true,
          policyVersion: true,
          validFrom: true,
          validUntil: true,
          projectBindings: { select: { projectId: true, labId: true } },
          experimentBindings: { select: { experimentId: true, labId: true } },
          strainBindings: { select: { strainId: true, labId: true } },
          procedureBindings: { select: { procedureCode: true, labId: true } },
          personnelBindings: {
            where: {
              userId: input.actor.id,
              roleLabel: { in: [...input.requiredPersonnelRoles] },
            },
            orderBy: [{ roleLabel: "asc" }, { id: "asc" }],
            select: { id: true, userId: true, labId: true, roleLabel: true },
            take: 1,
          },
          countLedger: { select: { id: true } },
        },
      },
    },
  });
  const nowRows = await tx.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT CURRENT_TIMESTAMP AS now`,
  );
  const evaluatedAt = nowRows[0]?.now;
  if (
    !protocol ||
    !protocol.currentVersion ||
    !evaluatedAt ||
    protocol.status !== "active" ||
    protocol.currentVersionId !== protocol.currentVersion.id ||
    protocol.currentVersion.policyVersion !== COMPLIANCE_POLICY_VERSION ||
    protocol.currentVersion.validFrom > evaluatedAt ||
    protocol.currentVersion.validUntil <= evaluatedAt
  ) {
    return fail(
      COMPLIANCE_ERROR.protocolInactive,
      "The selected protocol is not an active current authorization.",
    );
  }
  const version = protocol.currentVersion;
  const projectMatches =
    !input.projectId ||
    version.projectBindings.some(
      (binding) =>
        binding.projectId === input.projectId && binding.labId === input.labId,
    );
  const experimentMatches =
    !input.experimentId ||
    version.experimentBindings.some(
      (binding) =>
        binding.experimentId === input.experimentId &&
        binding.labId === input.labId,
    );
  const strainsMatch =
    strainIds.length === 0 ||
    strainIds.every((strainId) =>
      version.strainBindings.some(
        (binding) =>
          binding.strainId === strainId && binding.labId === input.labId,
      ),
    );
  const procedureMatches = version.procedureBindings.some(
    (binding) =>
      binding.procedureCode === procedureCode && binding.labId === input.labId,
  );
  if (
    !projectMatches ||
    !experimentMatches ||
    !strainsMatch ||
    !procedureMatches
  ) {
    return fail(
      COMPLIANCE_ERROR.protocolOutOfScope,
      "The selected protocol does not cover this lab, project, experiment, strain, or procedure.",
    );
  }
  const personnel = version.personnelBindings[0];
  if (!personnel || personnel.labId !== input.labId) {
    return fail(
      COMPLIANCE_ERROR.personnelNotNamed,
      "The current user is not named personnel on this protocol version.",
    );
  }

  const competency = await tx.competencyEvidence.findFirst({
    where: {
      userId: input.actor.id,
      labId: input.labId,
      procedureCode,
      status: "current",
      currentVersion: {
        validFrom: { lte: evaluatedAt },
        validUntil: { gt: evaluatedAt },
      },
    },
    select: {
      id: true,
      currentVersionId: true,
      currentVersion: { select: { contentHash: true } },
    },
  });
  if (!competency?.currentVersionId || !competency.currentVersion) {
    return fail(
      COMPLIANCE_ERROR.competencyRequired,
      "Current competency evidence is required for this procedure.",
    );
  }
  const competencyVersionId = competency.currentVersionId;
  const competencyContentHash = competency.currentVersion.contentHash;

  const assurance = input.actor.assurance;
  const identityLinkId = input.actor.identityLinkId;
  const authenticatedAt = input.actor.authenticatedAt
    ? new Date(input.actor.authenticatedAt)
    : null;
  if (
    !assurance ||
    !identityLinkId ||
    !authenticatedAt ||
    Number.isNaN(authenticatedAt.valueOf())
  ) {
    return fail(
      COMPLIANCE_ERROR.assuranceRequired,
      "Fresh MFA-level identity assurance is required for verified animal-use commands.",
    );
  }
  const identityRows = await tx.$queryRaw<
    Array<{ current: boolean }>
  >(Prisma.sql`
    SELECT "mcm_identity_assurance_snapshot_is_current"(
      ${input.actor.id}, ${identityLinkId}, ${assurance}::"IdentityAssuranceLevel", ${authenticatedAt}, CURRENT_TIMESTAMP
    ) AS current
  `);
  if (identityRows[0]?.current !== true) {
    return fail(
      COMPLIANCE_ERROR.assuranceRequired,
      "Identity assurance is unavailable, stale, or no longer active.",
    );
  }

  const duty = input.requiredDuty
    ? await tx.facilityDutyAssignment.findFirst({
        where: {
          userId: input.actor.id,
          duty: input.requiredDuty,
          revokedAt: null,
          validFrom: { lte: evaluatedAt },
          validUntil: { gt: evaluatedAt },
        },
        orderBy: [{ validFrom: "desc" }, { id: "asc" }],
        select: { id: true, version: true },
      })
    : null;
  if (input.requiredDuty && !duty) {
    return fail(
      COMPLIANCE_ERROR.dutyRequired,
      `A current ${input.requiredDuty} duty assignment is required.`,
    );
  }
  if (!version.countLedger) {
    return fail(
      COMPLIANCE_ERROR.countConflict,
      "The current protocol version has no count ledger.",
    );
  }

  await tx.$queryRaw(Prisma.sql`
    SELECT set_config('mcm.compliance_receipt_id', ${input.receiptId}, true)
  `);
  const ledgerRows = await tx.$queryRaw<
    Array<{
      id: string;
      authorizationVersionId: string;
      approvedCount: number;
      reservedCount: number;
      consumedCount: number;
      version: number;
    }>
  >(Prisma.sql`
    SELECT id, "authorizationVersionId", "approvedCount", "reservedCount", "consumedCount", version
    FROM "ProtocolCountLedger"
    WHERE id = ${version.countLedger.id}
    FOR UPDATE
  `);
  const ledger = ledgerRows[0];
  if (!ledger || ledger.authorizationVersionId !== version.id) {
    return fail(
      COMPLIANCE_ERROR.countConflict,
      "The protocol count ledger changed. Refresh and try again.",
    );
  }
  const reservedBefore = ledger.reservedCount;
  const consumedBefore = ledger.consumedCount;
  let reservedAfter = reservedBefore;
  let consumedAfter = consumedBefore;
  if (countOperation === "reserve") reservedAfter += quantity;
  if (countOperation === "release") reservedAfter -= quantity;
  if (countOperation === "consume") {
    reservedAfter -= quantity;
    consumedAfter += quantity;
  }
  if (
    reservedAfter < 0 ||
    consumedAfter < 0 ||
    reservedAfter + consumedAfter > ledger.approvedCount
  ) {
    return fail(
      COMPLIANCE_ERROR.countExceeded,
      "The protocol does not have enough approved animal count remaining.",
    );
  }
  const scopeSnapshot = {
    labId: input.labId,
    projectId: input.projectId ?? null,
    experimentId: input.experimentId ?? null,
    strainIds,
    procedureCode,
    requiredPersonnelRoles: [...input.requiredPersonnelRoles].sort(),
  };
  const writeSnapshot = async (snapshotInput: {
    evidenceKey: string;
    aggregateType: string;
    aggregateId: string;
    reservedBefore: number;
    reservedAfter: number;
    consumedBefore: number;
    consumedAfter: number;
    countQuantity: number;
    allocations: ReadonlyArray<{
      id: string;
      allocationKey: string;
      aggregateId: string;
      quantity: number;
    }>;
  }) => {
    const evidence = {
      policyVersion: COMPLIANCE_POLICY_VERSION,
      protocolAuthorizationId: protocol.id,
      protocolVersionId: version.id,
      protocolContentHash: version.contentHash,
      procedureCode,
      scopeHash: canonicalJsonHash(scopeSnapshot),
      scopePayload: canonicalJson(scopeSnapshot),
      scopeSnapshot,
      requiredPersonnelRole: personnel.roleLabel,
      personnelBindingId: personnel.id,
      competencyEvidenceId: competency.id,
      competencyVersionId,
      competencyContentHash,
      assurance,
      identityLinkId,
      authenticatedAt: authenticatedAt.toISOString(),
      dutyAssignmentId: duty?.id ?? null,
      dutyAssignmentVersion: duty?.version ?? null,
      ledgerId: ledger.id,
      reservedBefore: snapshotInput.reservedBefore,
      reservedAfter: snapshotInput.reservedAfter,
      consumedBefore: snapshotInput.consumedBefore,
      consumedAfter: snapshotInput.consumedAfter,
      countOperation,
      countQuantity: snapshotInput.countQuantity,
      countAllocationSnapshot: snapshotInput.allocations,
      actorId: input.actor.id,
      actorAuthzVersion: input.actor.authzVersion,
      labId: input.labId,
      commandReceiptId: input.receiptId,
      evidenceKey: snapshotInput.evidenceKey,
      commandType: input.commandType,
      aggregateType: snapshotInput.aggregateType,
      aggregateId: snapshotInput.aggregateId,
      evaluatedAt: evaluatedAt.toISOString(),
    };
    return tx.complianceEvidenceSnapshot.create({
      data: {
        id: randomUUID(),
        ...evidence,
        authenticatedAt,
        evaluatedAt,
        evidenceHash: canonicalJsonHash(evidence),
        evidencePayload: canonicalJson(evidence),
      },
      select: { id: true },
    });
  };
  const allocations: Array<{
    id: string;
    allocationKey: string;
    aggregateId: string;
    quantity: number;
    evidenceSnapshotId: string;
  }> = [];
  let primaryEvidenceSnapshotId: string | null = null;
  let ledgerVersion = ledger.version;
  let runningReserved = reservedBefore;
  const runningConsumed = consumedBefore;
  if (countOperation === "reserve") {
    const units = input.allocationUnits?.length
      ? input.allocationUnits
      : [
          {
            allocationKey:
              input.allocationKey?.trim() ||
              `${input.aggregateType}:${input.aggregateId}:reserve`,
            aggregateType: input.aggregateType,
            aggregateId: input.aggregateId,
            quantity,
          },
        ];
    if (
      units.some(
        (unit) =>
          !unit.allocationKey.trim() ||
          !unit.aggregateId ||
          !Number.isInteger(unit.quantity) ||
          unit.quantity < 1,
      ) ||
      units.reduce((sum, unit) => sum + unit.quantity, 0) !== quantity
    ) {
      return fail(
        COMPLIANCE_ERROR.countConflict,
        "Protocol allocation units do not match the requested reservation.",
      );
    }
    for (const unit of [...units].sort((left, right) =>
      left.allocationKey.localeCompare(right.allocationKey),
    )) {
      const allocationId = randomUUID();
      const nextReserved = runningReserved + unit.quantity;
      await tx.protocolCountAllocation.create({
        data: {
          id: allocationId,
          ledgerId: ledger.id,
          authorizationVersionId: version.id,
          allocationKey: unit.allocationKey,
          aggregateType: unit.aggregateType,
          aggregateId: unit.aggregateId,
          reservedQuantity: unit.quantity,
          createdById: input.actor.id,
          createdCommandReceiptId: input.receiptId,
        },
      });
      const updated = await tx.protocolCountLedger.updateMany({
        where: { id: ledger.id, version: ledgerVersion },
        data: { reservedCount: nextReserved, version: { increment: 1 } },
      });
      if (updated.count !== 1)
        return fail(
          COMPLIANCE_ERROR.countConflict,
          "The protocol count ledger changed concurrently.",
        );
      await tx.protocolCountAllocationHistory.create({
        data: {
          id: randomUUID(),
          allocationId,
          ledgerId: ledger.id,
          authorizationVersionId: version.id,
          commandReceiptId: input.receiptId,
          allocationKey: unit.allocationKey,
          allocationType: "reserve",
          quantity: unit.quantity,
          allocationReservedBefore: unit.quantity,
          allocationReservedAfter: unit.quantity,
          allocationConsumedBefore: 0,
          allocationConsumedAfter: 0,
          allocationReleasedBefore: 0,
          allocationReleasedAfter: 0,
          allocationVersionBefore: 0,
          allocationVersionAfter: 1,
          reservedBefore: runningReserved,
          reservedAfter: nextReserved,
          consumedBefore: runningConsumed,
          consumedAfter: runningConsumed,
          aggregateType: unit.aggregateType,
          aggregateId: unit.aggregateId,
          actorId: input.actor.id,
          commandAggregateType:
            input.commandAggregateType ?? input.aggregateType,
          commandAggregateId: input.commandAggregateId ?? input.aggregateId,
        },
      });
      const allocationSnapshot = [
        {
          id: allocationId,
          allocationKey: unit.allocationKey,
          aggregateId: unit.aggregateId,
          quantity: unit.quantity,
        },
      ];
      const snapshot = await writeSnapshot({
        evidenceKey: input.allocationUnits?.length
          ? unit.allocationKey
          : evidenceKey,
        aggregateType: unit.aggregateType,
        aggregateId: unit.aggregateId,
        reservedBefore: runningReserved,
        reservedAfter: nextReserved,
        consumedBefore: runningConsumed,
        consumedAfter: runningConsumed,
        countQuantity: unit.quantity,
        allocations: allocationSnapshot,
      });
      primaryEvidenceSnapshotId ??= snapshot.id;
      allocations.push({
        ...allocationSnapshot[0],
        evidenceSnapshotId: snapshot.id,
      });
      runningReserved = nextReserved;
      ledgerVersion += 1;
    }
  } else if (countOperation === "consume" || countOperation === "release") {
    const allocation = await tx.protocolCountAllocation.findUnique({
      where: { id: input.sourceAllocationId! },
    });
    if (
      !allocation ||
      allocation.authorizationVersionId !== version.id ||
      allocation.ledgerId !== ledger.id ||
      allocation.consumedQuantity + allocation.releasedQuantity + quantity >
        allocation.reservedQuantity
    ) {
      return fail(
        COMPLIANCE_ERROR.countConflict,
        "The exact protocol allocation is unavailable or already settled.",
      );
    }
    const nextConsumed =
      allocation.consumedQuantity +
      (countOperation === "consume" ? quantity : 0);
    const nextReleased =
      allocation.releasedQuantity +
      (countOperation === "release" ? quantity : 0);
    const settled = nextConsumed + nextReleased;
    const status =
      settled < allocation.reservedQuantity
        ? "partially_settled"
        : nextConsumed === allocation.reservedQuantity
          ? "consumed"
          : nextReleased === allocation.reservedQuantity
            ? "released"
            : "mixed";
    await tx.protocolCountAllocation.update({
      where: { id: allocation.id },
      data: {
        consumedQuantity: nextConsumed,
        releasedQuantity: nextReleased,
        status,
        version: { increment: 1 },
      },
    });
    await tx.protocolCountLedger.update({
      where: { id: ledger.id },
      data: {
        reservedCount: reservedAfter,
        consumedCount: consumedAfter,
        version: { increment: 1 },
      },
    });
    await tx.protocolCountAllocationHistory.create({
      data: {
        id: randomUUID(),
        allocationId: allocation.id,
        ledgerId: ledger.id,
        authorizationVersionId: version.id,
        commandReceiptId: input.receiptId,
        allocationKey:
          input.allocationKey?.trim() ||
          `${allocation.allocationKey}:${countOperation}`,
        allocationType: countOperation,
        quantity,
        allocationReservedBefore: allocation.reservedQuantity,
        allocationReservedAfter: allocation.reservedQuantity,
        allocationConsumedBefore: allocation.consumedQuantity,
        allocationConsumedAfter: nextConsumed,
        allocationReleasedBefore: allocation.releasedQuantity,
        allocationReleasedAfter: nextReleased,
        allocationVersionBefore: allocation.version,
        allocationVersionAfter: allocation.version + 1,
        reservedBefore,
        reservedAfter,
        consumedBefore,
        consumedAfter,
        aggregateType: allocation.aggregateType,
        aggregateId: allocation.aggregateId,
        commandAggregateType: input.commandAggregateType ?? input.aggregateType,
        commandAggregateId: input.commandAggregateId ?? input.aggregateId,
        actorId: input.actor.id,
      },
    });
    const allocationSnapshot = [
      {
        id: allocation.id,
        allocationKey: allocation.allocationKey,
        aggregateId: allocation.aggregateId,
        quantity,
      },
    ];
    const snapshot = await writeSnapshot({
      evidenceKey,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      reservedBefore,
      reservedAfter,
      consumedBefore,
      consumedAfter,
      countQuantity: quantity,
      allocations: allocationSnapshot,
    });
    primaryEvidenceSnapshotId = snapshot.id;
    allocations.push({
      ...allocationSnapshot[0],
      evidenceSnapshotId: snapshot.id,
    });
  }
  const allocationId = allocations[0]?.id ?? null;
  if (countOperation === "none") {
    const snapshot = await writeSnapshot({
      evidenceKey,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      reservedBefore,
      reservedAfter,
      consumedBefore,
      consumedAfter,
      countQuantity: 0,
      allocations: [],
    });
    primaryEvidenceSnapshotId = snapshot.id;
  }
  if (!primaryEvidenceSnapshotId) {
    return fail(
      COMPLIANCE_ERROR.countConflict,
      "Compliance evidence could not be frozen.",
    );
  }
  return {
    ok: true as const,
    evidenceSnapshotId: primaryEvidenceSnapshotId,
    protocolAuthorizationId: protocol.id,
    protocolVersionId: version.id,
    reservedBefore,
    reservedAfter,
    consumedBefore,
    consumedAfter,
    allocationId,
    allocations,
  };
}

/**
 * Keeps M13 evidence/count mutations atomic with the downstream domain write.
 * Command handlers intentionally return expected failures (so their receipt can
 * commit); the savepoint prevents those failures from retaining a reservation
 * or immutable snapshot created earlier in the same handler.
 */
export async function withComplianceWriteScope<T extends { ok: boolean }>(
  tx: Prisma.TransactionClient,
  input: ComplianceGateInput,
  operation: (evidence: ComplianceSuccess) => Promise<T>,
): Promise<T | ComplianceFailure> {
  return withM13MutationSavepoint(tx, async () => {
    const evidence = await evaluateAndWriteComplianceEvidence(tx, input);
    if (!evidence.ok) return evidence;
    return operation(evidence);
  });
}

export async function withM13MutationSavepoint<T extends { ok: boolean }>(
  tx: Prisma.TransactionClient,
  operation: () => Promise<T>,
): Promise<T> {
  await tx.$executeRawUnsafe("SAVEPOINT mcm_m13_compliance_write");
  try {
    const result = await operation();
    if (!result.ok)
      await tx.$executeRawUnsafe(
        "ROLLBACK TO SAVEPOINT mcm_m13_compliance_write",
      );
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT mcm_m13_compliance_write");
    return result;
  } catch (error) {
    await tx.$executeRawUnsafe(
      "ROLLBACK TO SAVEPOINT mcm_m13_compliance_write",
    );
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT mcm_m13_compliance_write");
    throw error;
  }
}

export async function revalidateTransferComplianceApprovals(
  tx: Prisma.TransactionClient,
  input: {
    requestId: string;
    sourceLabId: string;
    destinationLabId: string;
    sourceProtocolAuthorizationId: string | null;
    sourceEvidenceSnapshotId: string | null;
    destinationProtocolAuthorizationId: string | null;
    destinationEvidenceSnapshotId: string | null;
    destinationAllocationId: string | null;
    itemCount: number;
    strainIds: readonly string[];
    finalizer: ResolvedActor;
  },
) {
  if (
    !input.sourceProtocolAuthorizationId ||
    !input.sourceEvidenceSnapshotId ||
    !input.destinationProtocolAuthorizationId ||
    !input.destinationEvidenceSnapshotId ||
    !input.destinationAllocationId
  ) {
    return fail(
      COMPLIANCE_ERROR.protocolRequired,
      "Both source and destination protocol approvals are required before finalization.",
    );
  }
  const nowRows = await tx.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT CURRENT_TIMESTAMP AS now`,
  );
  const now = nowRows[0]?.now;
  if (
    !now ||
    !input.finalizer.assurance ||
    !input.finalizer.identityLinkId ||
    !input.finalizer.authenticatedAt
  ) {
    return fail(
      COMPLIANCE_ERROR.assuranceRequired,
      "Fresh finalizer identity assurance is required.",
    );
  }
  const finalizerAuthenticatedAt = new Date(input.finalizer.authenticatedAt);
  const finalizerCurrent = await tx.$queryRaw<
    Array<{ current: boolean }>
  >(Prisma.sql`
    SELECT "mcm_identity_assurance_snapshot_is_current"(
      ${input.finalizer.id}, ${input.finalizer.identityLinkId}, ${input.finalizer.assurance}::"IdentityAssuranceLevel",
      ${finalizerAuthenticatedAt}, ${now}
    ) AS current
  `);
  if (finalizerCurrent[0]?.current !== true) {
    return fail(
      COMPLIANCE_ERROR.assuranceRequired,
      "Finalizer identity assurance is unavailable, stale, or revoked.",
    );
  }
  const strains = uniqueSorted(input.strainIds);
  const approvals = [
    {
      side: "source",
      labId: input.sourceLabId,
      protocolId: input.sourceProtocolAuthorizationId,
      snapshotId: input.sourceEvidenceSnapshotId,
      commandTypes: ["lab_transfer.request", "lab_transfer.revise"],
    },
    {
      side: "destination",
      labId: input.destinationLabId,
      protocolId: input.destinationProtocolAuthorizationId,
      snapshotId: input.destinationEvidenceSnapshotId,
      commandTypes: ["lab_transfer.destination_accept"],
    },
  ] as const;
  for (const approval of approvals) {
    const snapshot = await tx.complianceEvidenceSnapshot.findUnique({
      where: { id: approval.snapshotId },
      select: {
        aggregateId: true,
        commandType: true,
        labId: true,
        actorId: true,
        actorAuthzVersion: true,
        protocolAuthorizationId: true,
        protocolVersionId: true,
        protocolContentHash: true,
        procedureCode: true,
        scopeHash: true,
        scopeSnapshot: true,
        countOperation: true,
        countQuantity: true,
        countAllocationSnapshot: true,
        requiredPersonnelRole: true,
        personnelBindingId: true,
        competencyEvidenceId: true,
        competencyVersionId: true,
        competencyContentHash: true,
        identityLink: {
          select: { userId: true, active: true, revokedAt: true },
        },
        actor: { select: { active: true, authzVersion: true, role: true } },
        personnelBinding: {
          select: {
            authorizationVersionId: true,
            labId: true,
            userId: true,
            roleLabel: true,
          },
        },
        competencyEvidence: {
          select: {
            status: true,
            currentVersionId: true,
            userId: true,
            labId: true,
          },
        },
        competencyVersion: {
          select: { contentHash: true, validFrom: true, validUntil: true },
        },
        protocolAuthorization: {
          select: {
            status: true,
            labId: true,
            currentVersionId: true,
            currentVersion: {
              select: {
                contentHash: true,
                validFrom: true,
                validUntil: true,
                strainBindings: { select: { strainId: true, labId: true } },
                procedureBindings: {
                  where: { procedureCode: "transfer" },
                  select: { labId: true },
                },
              },
            },
          },
        },
      },
    });
    const protocolVersion = snapshot?.protocolAuthorization.currentVersion;
    const rawScopeStrains =
      snapshot &&
      typeof snapshot.scopeSnapshot === "object" &&
      snapshot.scopeSnapshot &&
      !Array.isArray(snapshot.scopeSnapshot)
        ? (snapshot.scopeSnapshot as Record<string, unknown>).strainIds
        : undefined;
    const scopeStrains = Array.isArray(rawScopeStrains)
      ? uniqueSorted(rawScopeStrains.filter((value): value is string => typeof value === "string"))
      : [];
    if (
      !snapshot ||
      snapshot.aggregateId !== input.requestId ||
      !approval.commandTypes.includes(snapshot.commandType as never) ||
      snapshot.labId !== approval.labId ||
      snapshot.protocolAuthorizationId !== approval.protocolId ||
      snapshot.protocolAuthorization.status !== "active" ||
      snapshot.protocolAuthorization.labId !== approval.labId ||
      snapshot.protocolAuthorization.currentVersionId !==
        snapshot.protocolVersionId ||
      !protocolVersion ||
      protocolVersion.contentHash !== snapshot.protocolContentHash ||
      protocolVersion.validFrom > now ||
      protocolVersion.validUntil <= now ||
      !protocolVersion.procedureBindings.some(
        (binding) => binding.labId === approval.labId,
      ) ||
      !strains.every((strainId) =>
        protocolVersion.strainBindings.some(
          (binding) =>
            binding.strainId === strainId && binding.labId === approval.labId,
        ),
      ) ||
      snapshot.procedureCode !== "transfer" ||
      JSON.stringify(scopeStrains) !== JSON.stringify(strains) ||
      snapshot.requiredPersonnelRole !== "transfer_coordinator" ||
      snapshot.personnelBindingId.length === 0 ||
      snapshot.personnelBinding.authorizationVersionId !==
        snapshot.protocolVersionId ||
      snapshot.personnelBinding.labId !== approval.labId ||
      snapshot.personnelBinding.userId !== snapshot.actorId ||
      snapshot.personnelBinding.roleLabel !== "transfer_coordinator" ||
      !snapshot.actor.active ||
      snapshot.actor.role === "it_head" ||
      snapshot.actor.authzVersion !== snapshot.actorAuthzVersion ||
      snapshot.identityLink.userId !== snapshot.actorId ||
      !snapshot.identityLink.active ||
      snapshot.identityLink.revokedAt !== null ||
      snapshot.competencyEvidence.status !== "current" ||
      snapshot.competencyEvidence.currentVersionId !==
        snapshot.competencyVersionId ||
      snapshot.competencyEvidence.userId !== snapshot.actorId ||
      snapshot.competencyEvidence.labId !== approval.labId ||
      snapshot.competencyVersion.contentHash !==
        snapshot.competencyContentHash ||
      snapshot.competencyVersion.validFrom > now ||
      snapshot.competencyVersion.validUntil <= now
    ) {
      return fail(
        COMPLIANCE_ERROR.protocolInactive,
        `${approval.side === "source" ? "Source" : "Destination"} protocol approval is stale or no longer in scope.`,
      );
    }
    if (approval.side === "destination") {
      const allocationItems = Array.isArray(snapshot.countAllocationSnapshot)
        ? (snapshot.countAllocationSnapshot as Array<Record<string, unknown>>)
        : [];
      if (
        snapshot.countOperation !== "reserve" ||
        snapshot.countQuantity !== input.itemCount ||
        allocationItems.length !== 1 ||
        allocationItems[0]?.id !== input.destinationAllocationId ||
        allocationItems[0]?.quantity !== input.itemCount
      ) {
        return fail(
          COMPLIANCE_ERROR.countConflict,
          "Destination protocol count approval is stale or mismatched.",
        );
      }
    }
  }
  const destinationAllocation = await tx.protocolCountAllocation.findFirst({
    where: {
      id: input.destinationAllocationId,
      aggregateType: "lab_transfer_request",
      aggregateId: input.requestId,
      reservedQuantity: input.itemCount,
      consumedQuantity: 0,
      releasedQuantity: 0,
      status: "open",
    },
    select: { id: true },
  });
  if (!destinationAllocation)
    return fail(
      COMPLIANCE_ERROR.countConflict,
      "Destination protocol reservation is unavailable or settled.",
    );
  return { ok: true as const };
}

/** Releases an existing reservation without requiring an active authorization.
 * This is intentionally safety-reducing: it can only decrease reserved count,
 * remains receipt-bound/idempotent, and cannot increase approved or consumed use.
 */
export async function releaseProtocolReservation(
  tx: Prisma.TransactionClient,
  input: {
    actor: ResolvedActor;
    receiptId: string;
    protocolAuthorizationId: string | null | undefined;
    allocationId: string;
    quantity: number;
    allocationKey: string;
    aggregateType: string;
    aggregateId: string;
  },
) {
  if (
    !input.protocolAuthorizationId ||
    !Number.isInteger(input.quantity) ||
    input.quantity < 1
  ) {
    return fail(
      COMPLIANCE_ERROR.countConflict,
      "The protocol reservation cannot be released safely.",
    );
  }
  await tx.$queryRaw(
    Prisma.sql`SELECT set_config('mcm.compliance_receipt_id', ${input.receiptId}, true)`,
  );
  const rows = await tx.$queryRaw<
    Array<{
      allocationId: string;
      allocationVersion: number;
      allocationKey: string;
      aggregateType: string;
      aggregateId: string;
      reservedQuantity: number;
      consumedQuantity: number;
      releasedQuantity: number;
      id: string;
      authorizationVersionId: string;
      approvedCount: number;
      reservedCount: number;
      consumedCount: number;
      version: number;
    }>
  >(Prisma.sql`
    SELECT allocation.id AS "allocationId", allocation.version AS "allocationVersion", allocation."allocationKey",
      allocation."aggregateType", allocation."aggregateId", allocation."reservedQuantity", allocation."consumedQuantity", allocation."releasedQuantity",
      ledger.id, ledger."authorizationVersionId", ledger."approvedCount", ledger."reservedCount", ledger."consumedCount", ledger.version
    FROM "ProtocolCountAllocation" allocation
    JOIN "ProtocolCountLedger" ledger ON ledger.id = allocation."ledgerId"
    JOIN "ProtocolAuthorizationVersion" version_record ON version_record.id = allocation."authorizationVersionId"
    JOIN "ProtocolAuthorization" protocol_auth ON protocol_auth.id = version_record."authorizationId"
    WHERE allocation.id = ${input.allocationId} AND protocol_auth.id = ${input.protocolAuthorizationId}
    FOR UPDATE OF allocation, ledger
  `);
  const ledger = rows[0];
  if (
    !ledger ||
    ledger.reservedCount < input.quantity ||
    ledger.consumedQuantity + ledger.releasedQuantity + input.quantity >
      ledger.reservedQuantity
  ) {
    return fail(
      COMPLIANCE_ERROR.countConflict,
      "The reserved protocol count is missing or already released.",
    );
  }
  const reservedAfter = ledger.reservedCount - input.quantity;
  const releasedAfter = ledger.releasedQuantity + input.quantity;
  const settledAfter = ledger.consumedQuantity + releasedAfter;
  const allocationStatus =
    settledAfter < ledger.reservedQuantity
      ? ("partially_settled" as const)
      : ledger.consumedQuantity > 0
        ? ("mixed" as const)
        : ("released" as const);
  await tx.protocolCountAllocation.update({
    where: { id: ledger.allocationId },
    data: {
      releasedQuantity: releasedAfter,
      status: allocationStatus,
      version: { increment: 1 },
    },
  });
  const updated = await tx.protocolCountLedger.updateMany({
    where: { id: ledger.id, version: ledger.version },
    data: { reservedCount: reservedAfter, version: { increment: 1 } },
  });
  if (updated.count !== 1)
    return fail(
      COMPLIANCE_ERROR.countConflict,
      "The protocol count ledger changed concurrently.",
    );
  await tx.protocolCountAllocationHistory.create({
    data: {
      id: randomUUID(),
      allocationId: ledger.allocationId,
      ledgerId: ledger.id,
      authorizationVersionId: ledger.authorizationVersionId,
      commandReceiptId: input.receiptId,
      allocationKey: input.allocationKey,
      allocationType: "release",
      quantity: input.quantity,
      allocationReservedBefore: ledger.reservedQuantity,
      allocationReservedAfter: ledger.reservedQuantity,
      allocationConsumedBefore: ledger.consumedQuantity,
      allocationConsumedAfter: ledger.consumedQuantity,
      allocationReleasedBefore: ledger.releasedQuantity,
      allocationReleasedAfter: releasedAfter,
      allocationVersionBefore: ledger.allocationVersion,
      allocationVersionAfter: ledger.allocationVersion + 1,
      reservedBefore: ledger.reservedCount,
      reservedAfter,
      consumedBefore: ledger.consumedCount,
      consumedAfter: ledger.consumedCount,
      aggregateType: ledger.aggregateType,
      aggregateId: ledger.aggregateId,
      commandAggregateType: input.aggregateType,
      commandAggregateId: input.aggregateId,
      actorId: input.actor.id,
    },
  });
  return {
    ok: true as const,
    reservedBefore: ledger.reservedCount,
    reservedAfter,
  };
}

export async function consumeProtocolReservation(
  tx: Prisma.TransactionClient,
  input: {
    actor: ResolvedActor;
    receiptId: string;
    protocolAuthorizationId: string | null | undefined;
    allocationId: string;
    allocationKey: string;
    aggregateType: string;
    aggregateId: string;
  },
) {
  if (!input.protocolAuthorizationId) {
    return fail(
      COMPLIANCE_ERROR.countConflict,
      "The protocol reservation cannot be consumed safely.",
    );
  }
  await tx.$queryRaw(
    Prisma.sql`SELECT set_config('mcm.compliance_receipt_id', ${input.receiptId}, true)`,
  );
  const rows = await tx.$queryRaw<
    Array<{
      allocationId: string;
      allocationVersion: number;
      allocationKey: string;
      aggregateType: string;
      aggregateId: string;
      reservedQuantity: number;
      consumedQuantity: number;
      releasedQuantity: number;
      id: string;
      authorizationVersionId: string;
      reservedCount: number;
      consumedCount: number;
      version: number;
    }>
  >(Prisma.sql`
    SELECT allocation.id AS "allocationId", allocation.version AS "allocationVersion", allocation."allocationKey",
      allocation."aggregateType", allocation."aggregateId", allocation."reservedQuantity", allocation."consumedQuantity", allocation."releasedQuantity",
      ledger.id, ledger."authorizationVersionId", ledger."reservedCount", ledger."consumedCount", ledger.version
    FROM "ProtocolCountAllocation" allocation
    JOIN "ProtocolCountLedger" ledger ON ledger.id = allocation."ledgerId"
    JOIN "ProtocolAuthorizationVersion" version_record ON version_record.id = allocation."authorizationVersionId"
    JOIN "ProtocolAuthorization" protocol_auth ON protocol_auth.id = version_record."authorizationId"
    WHERE allocation.id = ${input.allocationId} AND protocol_auth.id = ${input.protocolAuthorizationId}
    FOR UPDATE OF allocation, ledger
  `);
  const ledger = rows[0];
  if (!ledger)
    return fail(
      COMPLIANCE_ERROR.countConflict,
      "The destination protocol reservation is missing.",
    );
  const quantity =
    ledger.reservedQuantity - ledger.consumedQuantity - ledger.releasedQuantity;
  if (quantity <= 0 || ledger.reservedCount < quantity) {
    return fail(
      COMPLIANCE_ERROR.countConflict,
      "The destination protocol reservation is already settled.",
    );
  }
  const reservedAfter = ledger.reservedCount - quantity;
  const consumedAfter = ledger.consumedCount + quantity;
  const allocationConsumedAfter = ledger.consumedQuantity + quantity;
  const allocationStatus =
    ledger.releasedQuantity > 0 ? ("mixed" as const) : ("consumed" as const);
  await tx.protocolCountAllocation.update({
    where: { id: ledger.allocationId },
    data: {
      consumedQuantity: allocationConsumedAfter,
      status: allocationStatus,
      version: { increment: 1 },
    },
  });
  const updated = await tx.protocolCountLedger.updateMany({
    where: { id: ledger.id, version: ledger.version },
    data: {
      reservedCount: reservedAfter,
      consumedCount: consumedAfter,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1)
    return fail(
      COMPLIANCE_ERROR.countConflict,
      "The protocol count ledger changed concurrently.",
    );
  await tx.protocolCountAllocationHistory.create({
    data: {
      id: randomUUID(),
      allocationId: ledger.allocationId,
      ledgerId: ledger.id,
      authorizationVersionId: ledger.authorizationVersionId,
      commandReceiptId: input.receiptId,
      allocationKey: input.allocationKey,
      allocationType: "consume",
      quantity,
      allocationReservedBefore: ledger.reservedQuantity,
      allocationReservedAfter: ledger.reservedQuantity,
      allocationConsumedBefore: ledger.consumedQuantity,
      allocationConsumedAfter,
      allocationReleasedBefore: ledger.releasedQuantity,
      allocationReleasedAfter: ledger.releasedQuantity,
      allocationVersionBefore: ledger.allocationVersion,
      allocationVersionAfter: ledger.allocationVersion + 1,
      reservedBefore: ledger.reservedCount,
      reservedAfter,
      consumedBefore: ledger.consumedCount,
      consumedAfter,
      aggregateType: ledger.aggregateType,
      aggregateId: ledger.aggregateId,
      commandAggregateType: input.aggregateType,
      commandAggregateId: input.aggregateId,
      actorId: input.actor.id,
    },
  });
  return {
    ok: true as const,
    quantity,
    reservedBefore: ledger.reservedCount,
    reservedAfter,
    consumedBefore: ledger.consumedCount,
    consumedAfter,
  };
}
