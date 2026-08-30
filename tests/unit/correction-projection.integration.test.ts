import { createHash, randomUUID } from "node:crypto";

import { Prisma, type CorrectionDomain } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getAnimalDetailView } from "@/lib/animals-read";
import { getBreedingOverviewView } from "@/lib/breeding-read";
import { getActorCapabilities } from "@/lib/capabilities";
import { getCageIntakeOptionsView } from "@/lib/cage-intake-read";
import { executeDecideCorrectionRequest, executeSubmitCorrectionRequest } from "@/lib/correction-write";
import { getDashboardOverviewView } from "@/lib/dashboard-read";
import { getSampleApiList } from "@/lib/integration-api";
import { getLabTransferWorkspace } from "@/lib/lab-transfer-read";
import { prisma } from "@/lib/prisma";
import { getProcedureWorkspace } from "@/lib/procedure-read";
import { getSampleInventoryPageView, getSampleInventoryView } from "@/lib/samples-read";
import type { ResolvedActor } from "@/lib/session";
import { formatDate } from "@/lib/utils";
import { getWorkbookSheet } from "@/lib/workbook-read";
import { installCorrectionDatabaseFixture } from "./correction-test-fixture";

let cleanupCorrectionFixture: (() => Promise<void>) | undefined;
beforeAll(async () => {
  cleanupCorrectionFixture = await installCorrectionDatabaseFixture();
}, 120_000);
afterAll(async () => {
  await cleanupCorrectionFixture?.();
  await prisma.$disconnect();
}, 120_000);

function identity(prefix: string) {
  return { idempotencyKey: `${prefix}-${randomUUID()}`, requestId: `request-${randomUUID()}` };
}

async function actor(userId: string, activeLabId: string | null, duties: ResolvedActor["activeDuties"]): Promise<ResolvedActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const identityLink = await prisma.externalIdentityLink.findFirstOrThrow({ where: { userId, active: true } });
  const canonicalRole = user.role === "facility_admin" ? "facility_admin" as const : "lab_user" as const;
  const membership = activeLabId ? await prisma.labMembership.findFirstOrThrow({ where: { userId, labId: activeLabId, active: true }, include: { lab: true } }) : null;
  const activeMembership = membership ? { labId: membership.labId, labName: membership.lab.name, labCode: membership.lab.code, role: membership.role } : null;
  return {
    id: user.id, email: user.email, name: user.name, databaseRole: user.role,
    role: canonicalRole === "facility_admin" ? "admin" : "animal_staff", canonicalRole,
    authzVersion: user.authzVersion, authMethod: "synthetic_mfa", assurance: "synthetic_mfa",
    authenticatedAt: new Date().toISOString(), identityLinkId: identityLink.id, activeDuties: duties,
    activeLabId, activeMembership, memberships: activeMembership ? [activeMembership] : [],
    capabilities: [...getActorCapabilities({ canonicalRole, activeMembership, activeDuties: duties })],
  };
}

async function submitAndApprove(input: {
  requester: ResolvedActor;
  steward: ResolvedActor;
  labId: string;
  domain: CorrectionDomain;
  targetEntityId: string;
  sourceEventAt: Date;
  proposedCorrection: Prisma.InputJsonObject;
}) {
  const submitted = await executeSubmitCorrectionRequest({
    actor: input.requester,
    ...identity(`projection-${input.domain}`),
    command: {
      labId: input.labId,
      domain: input.domain,
      targetEntityId: input.targetEntityId,
      sourceEventAt: input.sourceEventAt,
      reason: `Synthetic operational projection correction for ${input.domain}.`,
      proposedCorrection: input.proposedCorrection,
    },
  });
  expect(submitted.ok).toBe(true);
  if (!submitted.ok || !submitted.result || typeof submitted.result !== "object" || Array.isArray(submitted.result)) throw new Error("Correction request was not created.");
  const correctionId = String((submitted.result as { correctionId: unknown }).correctionId);
  const decided = await executeDecideCorrectionRequest({
    actor: input.steward,
    correctionId,
    expectedVersion: 1,
    decision: "approve",
    decisionReason: "Independent synthetic review confirmed an allowed metadata-only supersession.",
    ...identity(`projection-approve-${input.domain}`),
  });
  expect(decided.ok).toBe(true);
  return correctionId;
}

async function createProjectionTransferFixture() {
  const id = `m15-projection-transfer-${randomUUID()}`;
  const requestedAt = new Date("2026-08-21T09:00:00.000Z");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.labTransferRequest.create({
      data: {
        id,
        subjectType: "animals",
        sourceLabId: "lab-microglia",
        destinationLabId: "lab-neuroimmune",
        reason: "Original synthetic projection transfer reason.",
        requestedEffectiveAt: new Date("2026-08-22T09:00:00.000Z"),
        requestedById: "user-lab-manager-qa",
        requestedAt,
      },
    });
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
  });
  return { id, sourceLabId: "lab-microglia", destinationLabId: "lab-neuroimmune", finalizedAt: null, requestedAt };
}

async function reviseTransferSourceWithAuthorizedReceipt(input: {
  actor: ResolvedActor;
  requestId: string;
  requestedEffectiveAt?: Date;
  reason?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.labTransferRequest.findUniqueOrThrow({ where: { id: input.requestId } });
    const receiptId = `m15-transfer-revision-receipt-${randomUUID()}`;
    await tx.commandReceipt.create({
      data: {
        id: receiptId,
        actorId: input.actor.id,
        actorAuthzVersion: input.actor.authzVersion,
        labId: current.sourceLabId,
        commandType: "lab_transfer.revise",
        idempotencyKey: `m15-transfer-revision-${randomUUID()}`,
        requestHash: "a".repeat(64),
        requestId: `m15-transfer-revision-request-${randomUUID()}`,
        status: "processing",
        aggregateType: "lab_transfer_request",
        aggregateId: current.id,
        expectedVersion: current.version,
      },
    });
    await tx.$queryRaw(Prisma.sql`
      SELECT
        set_config('mcm.lab_transfer_request_id', ${current.id}, true),
        set_config('mcm.lab_transfer_actor_id', ${input.actor.id}, true),
        set_config('mcm.lab_transfer_command_type', 'lab_transfer.revise', true),
        set_config('mcm.lab_transfer_receipt_id', ${receiptId}, true)
    `);
    return tx.labTransferRequest.update({
      where: { id: current.id },
      data: {
        ...(input.requestedEffectiveAt ? { requestedEffectiveAt: input.requestedEffectiveAt } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        status: "requested",
        packetVersion: { increment: 1 },
        acceptedPacketVersion: null,
        acceptedPacketHash: null,
        destinationDecisionById: null,
        destinationDecisionAt: null,
        version: { increment: 1 },
      },
    });
  });
}

async function createDependencyFreeLitterFixture() {
  const id = `m15-projection-litter-${randomUUID()}`;
  const setup = await prisma.breedingSetup.findFirstOrThrow({
    where: { labId: "lab-microglia", status: "active" },
    select: { id: true },
  });
  const birthDate = new Date("2026-03-20T00:00:00.000Z");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.litter.create({ data: { id, breedingSetupId: setup.id, birthDate, litterSizeBirth: 4, notes: "Synthetic dependency-free litter." } });
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
  });
  return { id, birthDate };
}

async function createProjectionSampleFixture() {
  const id = `m15-projection-sample-${randomUUID()}`;
  const animal = await prisma.animal.findFirstOrThrow({
    where: { owningLabId: "lab-microglia" },
    select: { id: true },
  });
  const collectedAt = new Date("2026-04-01T12:00:00.000Z");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.sampleRecord.create({
      data: {
        id,
        labId: "lab-microglia",
        animalId: animal.id,
        sampleLabel: `M15-MASK-${randomUUID()}`,
        sampleType: "synthetic-mask-test",
        status: "stored",
        collectedAt,
        notes: "Original mask-test sample notes.",
      },
    });
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
  });
  return { id, collectedAt };
}

async function createProjectionProcedureFixture() {
  const suffix = randomUUID();
  const sopId = `m15-projection-sop-${suffix}`;
  const sopVersionId = `m15-projection-sop-version-${suffix}`;
  const sopAssignmentId = `m15-projection-sop-assignment-${suffix}`;
  const planId = `m15-projection-plan-${suffix}`;
  const occurrenceId = `m15-projection-occurrence-${suffix}`;
  const occurredAt = new Date("2026-08-21T11:00:00.000Z");
  const sopTitle = "Synthetic correction projection SOP";
  const sopCategory = "test-only";
  const sopContent = "Synthetic fixture only.";
  const sopContentHash = createHash("sha256").update(`${sopTitle}\n${sopCategory}\n${sopContent}`, "utf8").digest("hex");
  const assignment = await prisma.experimentAssignment.findFirstOrThrow({
    where: { experiment: { labId: "lab-microglia" } },
    select: {
      id: true,
      experimentId: true,
      animalId: true,
      experiment: { select: { experimentCode: true } },
      animal: { select: { facilityAnimalId: true } },
    },
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.sopDocument.create({
      data: {
        id: sopId,
        scope: "lab",
        labId: "lab-microglia",
        code: `M15-${suffix.slice(0, 8)}`,
        title: sopTitle,
        category: sopCategory,
        createdById: "user-lab-manager-qa",
      },
    });
    await tx.sopVersion.create({
      data: {
        id: sopVersionId,
        sopId,
        versionNumber: 1,
        title: sopTitle,
        category: sopCategory,
        contentMarkdown: sopContent,
        contentHash: sopContentHash,
        changeSummary: "Synthetic fixture.",
        createdById: "user-lab-manager-qa",
      },
    });
    await tx.sopAssignment.create({
      data: {
        id: sopAssignmentId,
        sopId,
        sopVersionId,
        labId: "lab-microglia",
        assignedById: "user-lab-manager-qa",
        reason: "Synthetic projection fixture.",
      },
    });
    await tx.sopDocument.update({ where: { id: sopId }, data: { currentVersionId: sopVersionId } });
    await tx.procedurePlan.create({
      data: {
        id: planId,
        labId: "lab-microglia",
        experimentId: assignment.experimentId,
        assignmentId: assignment.id,
        procedureCode: "m15-projection",
        title: "Synthetic correction projection procedure",
        scheduledAt: occurredAt,
        status: "completed",
        sopId,
        sopVersionId,
        sopVersionNumber: 1,
        sopContentHash,
        sopAssignmentId,
        assignmentContextSnapshot: {},
        experimentContextSnapshot: {},
        createdById: "user-lab-manager-qa",
      },
    });
    await tx.procedureOccurrence.create({
      data: {
        id: occurrenceId,
        planId,
        occurrenceKey: "m15-projection-occurrence",
        labId: "lab-microglia",
        experimentId: assignment.experimentId,
        assignmentId: assignment.id,
        animalId: assignment.animalId,
        experimentCodeSnapshot: assignment.experiment.experimentCode,
        animalFacilityIdSnapshot: assignment.animal.facilityAnimalId,
        procedureCode: "m15-projection",
        title: "Synthetic correction projection procedure",
        plannedAt: occurredAt,
        occurredAt,
        status: "completed",
        outcomeNote: "Original synthetic procedure outcome.",
        planVersion: 1,
        sopId,
        sopVersionId,
        sopVersionNumber: 1,
        sopContentHash,
        sopAssignmentId,
        assignmentContextSnapshot: {},
        experimentContextSnapshot: {},
        executedById: "user-lab-manager-qa",
      },
    });
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
  });
  return { id: occurrenceId, labId: "lab-microglia", occurredAt, planId };
}

describe.sequential("M15 corrected operational projections", () => {
  it("uses applied metadata in ordinary authorized views and marks the correction source", async () => {
    const manager = await actor("user-lab-manager-qa", "lab-microglia", []);
    const admin = await actor("user-facility-admin-qa", null, ["protocol_reviewer", "billing_administrator"]);
    const steward = await actor("user-facility-admin-approver-qa", null, ["training_administrator", "data_steward"]);
    const [transfer, occurrence] = await Promise.all([
      createProjectionTransferFixture(),
      createProjectionProcedureFixture(),
    ]);
    const [litter, lifecycle, sample, seededMovement] = await Promise.all([
      prisma.litter.findFirstOrThrow({ where: { breedingSetup: { labId: "lab-microglia" } }, select: { id: true, birthDate: true } }),
      prisma.animalStatusEvent.findFirstOrThrow({ where: { animal: { owningLabId: "lab-microglia" } }, select: { id: true, animalId: true, happenedAt: true } }),
      prisma.sampleRecord.findFirstOrThrow({ where: { labId: "lab-microglia", id: { not: "sample-002" } }, select: { id: true, labId: true, collectedAt: true } }),
      prisma.animalMovement.findUniqueOrThrow({ where: { id: "move-001" }, select: { id: true, animalId: true } }),
    ]);

    const litterId = await submitAndApprove({ requester: manager, steward, labId: "lab-microglia", domain: "litter_birth", targetEntityId: litter.id, sourceEventAt: litter.birthDate, proposedCorrection: { notes: "Corrected litter metadata shown operationally." } });
    const lifecycleId = await submitAndApprove({ requester: manager, steward, labId: "lab-microglia", domain: "animal_lifecycle", targetEntityId: lifecycle.id, sourceEventAt: lifecycle.happenedAt, proposedCorrection: { reason: "Corrected lifecycle reason shown operationally." } });
    const transferLabId = transfer.sourceLabId === "lab-microglia" ? transfer.sourceLabId : transfer.destinationLabId;
    const transferId = await submitAndApprove({ requester: manager, steward, labId: transferLabId, domain: "cross_lab_transfer", targetEntityId: transfer.id, sourceEventAt: transfer.finalizedAt ?? transfer.requestedAt, proposedCorrection: { reason: "Corrected transfer reason shown operationally." } });
    const procedureId = await submitAndApprove({ requester: admin, steward, labId: occurrence.labId, domain: "procedure_occurrence", targetEntityId: occurrence.id, sourceEventAt: occurrence.occurredAt, proposedCorrection: { outcomeNote: "Corrected procedure outcome shown operationally." } });
    const notesOnlySample = await prisma.sampleRecord.findFirstOrThrow({
      where: { labId: sample.labId, id: { not: sample.id } },
      select: { id: true, collectedAt: true },
    });
    const correctedSampleTime = "2026-09-30T12:00:00.000Z";
    const sampleId = await submitAndApprove({ requester: manager, steward, labId: sample.labId, domain: "biosample", targetEntityId: sample.id, sourceEventAt: sample.collectedAt, proposedCorrection: { collectedAt: correctedSampleTime, notes: "Corrected biosample page-boundary token." } });
    await submitAndApprove({ requester: manager, steward, labId: sample.labId, domain: "biosample", targetEntityId: notesOnlySample.id, sourceEventAt: notesOnlySample.collectedAt, proposedCorrection: { notes: "Notes-only correction preserves source collection ordering." } });

    const [breedingView, lifecycleView, movementView, transferView, procedureView, sampleView] = await Promise.all([
      getBreedingOverviewView(manager),
      getAnimalDetailView(lifecycle.animalId, manager),
      getAnimalDetailView(seededMovement.animalId, manager),
      getLabTransferWorkspace(manager),
      getProcedureWorkspace(admin),
      getSampleInventoryView(manager),
    ]);
    const correctedLitter = breedingView.flatMap((row) => row.litters).find((row) => row.id === litter.id);
    expect(correctedLitter).toMatchObject({ notes: "Corrected litter metadata shown operationally.", correction: { requestId: litterId } });
    expect(lifecycleView?.timeline.find((event) => event.id === lifecycle.id)).toMatchObject({ description: expect.stringContaining("Corrected lifecycle reason"), correction: { requestId: lifecycleId } });
    expect(movementView?.timeline.find((event) => event.id === `movement-${seededMovement.id}`)).toMatchObject({ description: "Synthetic corrected movement reason.", correction: { requestId: expect.any(String) } });
    expect(transferView.requests.find((row) => row.id === transfer.id)).toMatchObject({ reason: "Corrected transfer reason shown operationally.", correction: { requestId: transferId } });
    expect(procedureView.rows.flatMap((row) => row.occurrences).find((row) => row.id === occurrence.id)).toMatchObject({ outcomeNote: "Corrected procedure outcome shown operationally.", correction: { requestId: procedureId } });
    expect(sampleView.find((row) => row.id === sample.id)).toMatchObject({ collectedAt: correctedSampleTime, notes: "Corrected biosample page-boundary token.", correction: { requestId: sampleId } });

    const [searchedPage, firstPage, sampleApi, workbook] = await Promise.all([
      getSampleInventoryPageView(manager, { search: "page-boundary token", pageSize: "1" }),
      getSampleInventoryPageView(manager, { pageSize: "1" }),
      getSampleApiList({ search: "page-boundary token", status: "all", animalCode: "", projectCode: "", experimentCode: "", limit: 10 }, manager),
      getWorkbookSheet(manager, { section: "biosamples", sheet: "all", search: "page-boundary token", sort: "collectedAt", direction: "desc", history: true }),
    ]);
    expect(searchedPage).toMatchObject({ totalCount: 1, items: [{ id: sample.id, notes: "Corrected biosample page-boundary token.", correction: { requestId: sampleId } }] });
    expect(firstPage.items[0]).toMatchObject({ id: sample.id, collectedAt: correctedSampleTime, correction: { requestId: sampleId } });
    expect(sampleApi.data[0]).toMatchObject({ id: sample.id, collectedAt: correctedSampleTime, notes: "Corrected biosample page-boundary token.", correction: { requestId: sampleId } });
    expect(workbook.kind).toBe("biosamples");
    if (workbook.kind !== "biosamples") throw new Error("Expected biosample workbook.");
    expect(workbook.rows[0]).toMatchObject({ id: sample.id, notes: "Corrected biosample page-boundary token.", correction: { requestId: sampleId } });
  }, 120_000);

  it("uses one applied dependency-free litter birth date in breeding, dashboard, and intake timing", async () => {
    const manager = await actor("user-lab-manager-qa", "lab-microglia", []);
    const steward = await actor("user-facility-admin-approver-qa", null, ["training_administrator", "data_steward"]);
    const litter = await createDependencyFreeLitterFixture();
    const correctedBirthDate = "2026-03-10T00:00:00.000Z";
    const correctionId = await submitAndApprove({
      requester: manager, steward, labId: "lab-microglia", domain: "litter_birth",
      targetEntityId: litter.id, sourceEventAt: litter.birthDate, proposedCorrection: { birthDate: correctedBirthDate },
    });
    const [breeding, dashboard, intake] = await Promise.all([
      getBreedingOverviewView(manager),
      getDashboardOverviewView(manager),
      getCageIntakeOptionsView(manager, litter.id),
    ]);
    const breedingLitter = breeding.flatMap((row) => row.litters).find((row) => row.id === litter.id);
    const dashboardLitter = dashboard.highlights.upcomingWean.find((row) => row.litterId === litter.id);
    expect(breedingLitter).toMatchObject({ birthDate: correctedBirthDate, correction: { requestId: correctionId } });
    expect(dashboardLitter).toMatchObject({ dueDate: formatDate(new Date("2026-03-31T00:00:00.000Z")), correction: { requestId: correctionId } });
    expect(intake.litter).toMatchObject({ birthDate: correctedBirthDate, suggestedWeanDate: "2026-03-31", correction: { requestId: correctionId } });
  }, 120_000);

  it("masks only proposed fields and locks only those mutable source fields", async () => {
    const manager = await actor("user-lab-manager-qa", "lab-microglia", []);
    const steward = await actor("user-facility-admin-approver-qa", null, ["training_administrator", "data_steward"]);
    const [sample, transfer, litter] = await Promise.all([
      createProjectionSampleFixture(),
      createProjectionTransferFixture(),
      createDependencyFreeLitterFixture(),
    ]);

    const correctedSampleDate = "2026-04-02T12:00:00.000Z";
    const sampleCorrectionId = await submitAndApprove({
      requester: manager, steward, labId: "lab-microglia", domain: "biosample",
      targetEntityId: sample.id, sourceEventAt: sample.collectedAt,
      proposedCorrection: { collectedAt: correctedSampleDate },
    });
    await prisma.sampleRecord.update({
      where: { id: sample.id },
      data: { notes: "Authorized notes update remains visible after date correction." },
    });
    const [sampleView, sampleSearch] = await Promise.all([
      getSampleInventoryView(manager),
      getSampleInventoryPageView(manager, { search: "Authorized notes update remains visible", pageSize: "1" }),
    ]);
    expect(sampleView.find((row) => row.id === sample.id)).toMatchObject({
      collectedAt: correctedSampleDate,
      notes: "Authorized notes update remains visible after date correction.",
      correction: { requestId: sampleCorrectionId },
    });
    expect(sampleSearch).toMatchObject({
      totalCount: 1,
      items: [{ id: sample.id, collectedAt: correctedSampleDate, notes: "Authorized notes update remains visible after date correction." }],
    });
    await expect(prisma.sampleRecord.update({
      where: { id: sample.id },
      data: { collectedAt: new Date("2026-04-03T12:00:00.000Z") },
    })).rejects.toThrow(/collectedAt is locked by an applied biosample correction/i);
    expect(await prisma.sampleRecord.findUniqueOrThrow({ where: { id: sample.id }, select: { collectedAt: true, notes: true } })).toEqual({
      collectedAt: sample.collectedAt,
      notes: "Authorized notes update remains visible after date correction.",
    });

    const transferCorrectionId = await submitAndApprove({
      requester: manager, steward, labId: transfer.sourceLabId, domain: "cross_lab_transfer",
      targetEntityId: transfer.id, sourceEventAt: transfer.requestedAt,
      proposedCorrection: { reason: "Corrected reason remains authoritative across later date revision." },
    });
    const revisedTransferDate = new Date("2026-09-15T09:00:00.000Z");
    await reviseTransferSourceWithAuthorizedReceipt({
      actor: manager,
      requestId: transfer.id,
      requestedEffectiveAt: revisedTransferDate,
    });
    const transferView = await getLabTransferWorkspace(manager);
    expect(transferView.requests.find((row) => row.id === transfer.id)).toMatchObject({
      reason: "Corrected reason remains authoritative across later date revision.",
      requestedEffectiveAt: revisedTransferDate,
      correction: { requestId: transferCorrectionId },
    });
    await expect(reviseTransferSourceWithAuthorizedReceipt({
      actor: manager,
      requestId: transfer.id,
      reason: "Attempted overwrite of corrected transfer reason.",
    })).rejects.toThrow(/reason is locked by an applied transfer correction/i);
    expect(await prisma.labTransferRequest.findUniqueOrThrow({
      where: { id: transfer.id },
      select: { reason: true, requestedEffectiveAt: true },
    })).toEqual({
      reason: "Original synthetic projection transfer reason.",
      requestedEffectiveAt: revisedTransferDate,
    });

    const correctedLitterDate = "2026-03-21T00:00:00.000Z";
    const litterCorrectionId = await submitAndApprove({
      requester: manager, steward, labId: "lab-microglia", domain: "litter_birth",
      targetEntityId: litter.id, sourceEventAt: litter.birthDate,
      proposedCorrection: { birthDate: correctedLitterDate },
    });
    await prisma.litter.update({
      where: { id: litter.id },
      data: { notes: "Authorized litter note entered after date correction." },
    });
    const litterView = (await getBreedingOverviewView(manager)).flatMap((row) => row.litters).find((row) => row.id === litter.id);
    expect(litterView).toMatchObject({
      birthDate: correctedLitterDate,
      notes: "Authorized litter note entered after date correction.",
      correction: { requestId: litterCorrectionId },
    });
    await expect(prisma.litter.update({
      where: { id: litter.id },
      data: { birthDate: new Date("2026-03-22T00:00:00.000Z") },
    })).rejects.toThrow(/birthDate is locked by an applied litter correction/i);
    expect(await prisma.litter.findUniqueOrThrow({ where: { id: litter.id }, select: { birthDate: true, notes: true } })).toEqual({
      birthDate: litter.birthDate,
      notes: "Authorized litter note entered after date correction.",
    });
  }, 120_000);

  it("does not let a blocked structural request change breeding, dashboard, or intake timing", async () => {
    const manager = await actor("user-lab-manager-qa", "lab-microglia", []);
    const litter = await createDependencyFreeLitterFixture();
    const [beforeBreedingView, beforeDashboardView, beforeIntake] = await Promise.all([
      getBreedingOverviewView(manager), getDashboardOverviewView(manager), getCageIntakeOptionsView(manager, litter.id),
    ]);
    const before = beforeBreedingView.flatMap((row) => row.litters).find((row) => row.id === litter.id);
    const beforeDashboard = beforeDashboardView.highlights.upcomingWean.find((row) => row.litterId === litter.id);
    const submitted = await executeSubmitCorrectionRequest({ actor: manager, ...identity("blocked-projection"), command: {
      labId: "lab-microglia", domain: "litter_birth", targetEntityId: litter.id, sourceEventAt: litter.birthDate,
      reason: "Synthetic structural request must not alter ordinary views.", proposedCorrection: { litterSizeBirth: 5 },
    } });
    expect(submitted.ok).toBe(true);
    const [afterBreedingView, afterDashboardView, afterIntake] = await Promise.all([
      getBreedingOverviewView(manager), getDashboardOverviewView(manager), getCageIntakeOptionsView(manager, litter.id),
    ]);
    const after = afterBreedingView.flatMap((row) => row.litters).find((row) => row.id === litter.id);
    const afterDashboard = afterDashboardView.highlights.upcomingWean.find((row) => row.litterId === litter.id);
    expect(after).toEqual(before);
    expect(afterDashboard).toEqual(beforeDashboard);
    expect(afterIntake.litter).toEqual(beforeIntake.litter);
  }, 120_000);

  it("retains event-era movement and lifecycle corrections after ownership transfer while denying unrelated access", async () => {
    const sourceManager = await actor("user-lab-manager-qa", "lab-microglia", []);
    const destinationManager = await actor("user-manager", "lab-neuroimmune", []);
    const steward = await actor("user-facility-admin-approver-qa", null, ["training_administrator", "data_steward"]);
    const statusEventId = `m15-transfer-status-${randomUUID()}`;
    const happenedAt = new Date("2026-08-24T09:00:00.000Z");
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.animalStatusEvent.create({ data: { id: statusEventId, animalId: "animal-003", fromStatus: "colony_holding", toStatus: "colony_holding", happenedAt, actorId: "user-lab-manager-qa", reason: "Original event-era lifecycle reason." } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });
    const lifecycleCorrectionId = await submitAndApprove({
      requester: sourceManager, steward, labId: "lab-microglia", domain: "animal_lifecycle",
      targetEntityId: statusEventId, sourceEventAt: happenedAt, proposedCorrection: { reason: "Corrected event-era lifecycle reason." },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.animal.update({ where: { id: "animal-003" }, data: { owningLabId: "lab-neuroimmune", currentCageId: null } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });
    const destinationView = await getAnimalDetailView("animal-003", destinationManager);
    expect(destinationView?.timeline.find((event) => event.id === "movement-move-001")).toMatchObject({ description: "Synthetic corrected movement reason.", correction: { requestId: expect.any(String) } });
    expect(destinationView?.timeline.find((event) => event.id === statusEventId)).toMatchObject({ description: "Corrected event-era lifecycle reason.", correction: { requestId: lifecycleCorrectionId } });
    const unrelatedActor = { ...sourceManager, id: "unrelated-reader", activeLabId: "lab-unrelated", memberships: [{ labId: "lab-unrelated", role: "viewer" as const }] };
    await expect(getAnimalDetailView("animal-003", unrelatedActor)).resolves.toBeNull();
  }, 120_000);
});
