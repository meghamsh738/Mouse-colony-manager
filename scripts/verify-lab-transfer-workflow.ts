import { spawn } from "node:child_process";

import { Prisma } from "@prisma/client";

import { assertRetainedVerificationTarget } from "./retained-verification-guard";

function databaseUrlForSchema(rawUrl: string, schema: string, pooled: boolean) {
  const url = new URL(rawUrl);
  url.searchParams.set("schema", schema);
  if (pooled) url.searchParams.set("pgbouncer", "true");
  else url.searchParams.delete("pgbouncer");
  return url.toString();
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${[command, ...args].join(" ")} failed with ${signal ?? `exit code ${code}`}.`));
    });
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SOURCE_PROTOCOL_ID = "transfer-source-protocol";
const DESTINATION_PROTOCOL_ID = "transfer-destination-protocol";
const POLICY_VERSION = "synthetic-fail-closed-v1";

async function seedTransferComplianceFixture(
  tx: Prisma.TransactionClient,
  input: {
    canonicalJson: (value: unknown) => string;
    canonicalJsonHash: (value: unknown) => string;
    now: Date;
  },
) {
  const validFrom = new Date(input.now.getTime() - 24 * 60 * 60 * 1_000);
  const validUntil = new Date(input.now.getTime() + 365 * 24 * 60 * 60 * 1_000);
  const managers = [
    { id: "transfer-source-manager", labId: "transfer-lab-source", identityId: "transfer-source-manager-identity", subject: "admin@colony.local" },
    { id: "transfer-destination-manager", labId: "transfer-lab-destination", identityId: "transfer-destination-manager-identity", subject: "manager@colony.local" },
  ] as const;
  const identities = [
    ...managers,
    { id: "transfer-cmu", labId: null, identityId: "transfer-cmu-identity", subject: "staff@colony.local" },
    { id: "transfer-facility", labId: null, identityId: "transfer-facility-identity", subject: "researcher@colony.local" },
    { id: "transfer-facility-approver", labId: null, identityId: "transfer-facility-approver-identity", subject: "readonly@colony.local" },
  ] as const;

  const createReceipt = async (receipt: {
    id: string;
    actorId: string;
    labId: string;
    commandType: string;
    aggregateType: string;
    aggregateId: string;
  }) => {
    await tx.commandReceipt.create({
      data: {
        ...receipt,
        actorAuthzVersion: 1,
        idempotencyKey: receipt.id,
        requestHash: input.canonicalJsonHash({ fixture: receipt.id }),
        requestId: receipt.id,
        status: "succeeded",
        result: { fixture: "lab-transfer-verification" },
        completedAt: input.now,
      },
    });
  };

  await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
  for (const identity of identities) {
    await tx.externalIdentityLink.create({
      data: {
        id: identity.identityId,
        userId: identity.id,
        provider: "synthetic",
        providerSubject: identity.subject,
        assurance: "synthetic_mfa",
        linkedById: "transfer-facility",
        createdAt: input.now,
      },
    });
    await tx.externalIdentityLifecycleEvent.create({
      data: {
        id: `${identity.identityId}-linked`,
        identityLinkId: identity.identityId,
        actorId: "transfer-facility",
        eventType: "linked",
        assurance: "synthetic_mfa",
        detail: { fixture: "lab-transfer-verification" },
        occurredAt: input.now,
      },
    });
  }

  const dutyByUser = new Map<string, { protocolReviewer: string; trainingAdministrator: string }>();
  for (const [managerIndex, manager] of managers.entries()) {
    const assignments = {
      protocolReviewer: `transfer-duty-${managerIndex + 1}-protocol-reviewer`,
      trainingAdministrator: `transfer-duty-${managerIndex + 1}-training-administrator`,
    };
    dutyByUser.set(manager.id, assignments);
    for (const [dutyIndex, duty] of (["protocol_reviewer", "training_administrator"] as const).entries()) {
      const requestId = `${assignments[duty === "protocol_reviewer" ? "protocolReviewer" : "trainingAdministrator"]}-request`;
      const assignmentId = duty === "protocol_reviewer" ? assignments.protocolReviewer : assignments.trainingAdministrator;
      await tx.facilityDutyRequest.create({
        data: {
          id: requestId,
          requestType: "grant",
          duty,
          targetUserId: manager.id,
          targetAuthzVersion: 1,
          requestedValidFrom: validFrom,
          requestedValidUntil: validUntil,
          status: "approved",
          reason: `Synthetic transfer verification ${dutyIndex + 1}.`,
          requestedById: "transfer-facility",
          requestedByAuthzVersion: 1,
          requestedAssurance: "synthetic_mfa",
          requestedIdentityLinkId: "transfer-facility-identity",
          requestedAuthenticatedAt: input.now,
          decidedById: "transfer-facility-approver",
          decidedByAuthzVersion: 1,
          decidedAssurance: "synthetic_mfa",
          decidedIdentityLinkId: "transfer-facility-approver-identity",
          decidedAuthenticatedAt: input.now,
          decisionReason: "Approved for the guarded transfer verifier.",
          expiresAt: new Date(input.now.getTime() + 23 * 60 * 60 * 1_000),
          decidedAt: input.now,
          createdAt: input.now,
          version: 2,
        },
      });
      await tx.facilityDutyAssignment.create({
        data: {
          id: assignmentId,
          userId: manager.id,
          duty,
          validFrom,
          validUntil,
          grantRequestId: requestId,
          createdAt: input.now,
        },
      });
    }
  }

  const protocols = [
    {
      id: SOURCE_PROTOCOL_ID,
      labId: "transfer-lab-source",
      code: "TRANSFER-SOURCE",
      title: "Synthetic source transfer authorization",
      creatorId: "transfer-source-manager",
      reviewerId: "transfer-destination-manager",
      reviewerIdentityId: "transfer-destination-manager-identity",
    },
    {
      id: DESTINATION_PROTOCOL_ID,
      labId: "transfer-lab-destination",
      code: "TRANSFER-DESTINATION",
      title: "Synthetic destination transfer authorization",
      creatorId: "transfer-destination-manager",
      reviewerId: "transfer-source-manager",
      reviewerIdentityId: "transfer-source-manager-identity",
    },
  ] as const;
  for (const protocol of protocols) {
    const versionId = `${protocol.id}-v1`;
    const creationReceiptId = `${protocol.id}-draft-receipt`;
    const activationReceiptId = `${protocol.id}-activation-receipt`;
    const reviewerDuty = dutyByUser.get(protocol.reviewerId)?.protocolReviewer;
    assert(reviewerDuty, "Transfer protocol reviewer duty fixture is missing.");
    await createReceipt({
      id: creationReceiptId,
      actorId: protocol.creatorId,
      labId: protocol.labId,
      commandType: "protocol_authorization.draft.create",
      aggregateType: "protocol_authorization",
      aggregateId: protocol.id,
    });
    await createReceipt({
      id: activationReceiptId,
      actorId: protocol.reviewerId,
      labId: protocol.labId,
      commandType: "protocol_authorization.activate",
      aggregateType: "protocol_authorization",
      aggregateId: protocol.id,
    });
    const summary = `${protocol.title} retained verifier fixture.`;
    const content = {
      labId: protocol.labId,
      protocolCode: protocol.code,
      title: protocol.title,
      summary,
      validFrom: validFrom.toISOString(),
      validUntil: validUntil.toISOString(),
      approvedAnimalCount: 100,
      projectIds: [],
      experimentIds: [],
      strainIds: ["transfer-strain"],
      procedureCodes: ["transfer"],
      personnel: [{ userId: protocol.creatorId, roleLabel: "transfer_coordinator" }],
      policyVersion: POLICY_VERSION,
    };
    await tx.protocolAuthorization.create({
      data: {
        id: protocol.id,
        labId: protocol.labId,
        protocolCode: protocol.code,
        title: protocol.title,
        status: "draft",
        createdById: protocol.creatorId,
      },
    });
    await tx.protocolAuthorizationVersion.create({
      data: {
        id: versionId,
        authorizationId: protocol.id,
        versionNumber: 1,
        contentHash: input.canonicalJsonHash(content),
        contentPayload: input.canonicalJson(content),
        policyVersion: POLICY_VERSION,
        validFrom,
        validUntil,
        approvedAnimalCount: 100,
        summary,
        createdById: protocol.creatorId,
        creationCommandReceiptId: creationReceiptId,
        scopeSealedAt: input.now,
      },
    });
    await tx.protocolStrainBinding.create({ data: { id: `${versionId}-strain`, authorizationVersionId: versionId, labId: protocol.labId, strainId: "transfer-strain" } });
    await tx.protocolProcedureBinding.create({ data: { id: `${versionId}-procedure`, authorizationVersionId: versionId, labId: protocol.labId, procedureCode: "transfer" } });
    await tx.protocolPersonnelBinding.create({ data: { id: `${versionId}-personnel`, authorizationVersionId: versionId, labId: protocol.labId, userId: protocol.creatorId, roleLabel: "transfer_coordinator" } });
    await tx.protocolCountLedger.create({ data: { id: `${versionId}-ledger`, authorizationVersionId: versionId, approvedCount: 100 } });
    await tx.protocolAuthorization.update({
      where: { id: protocol.id },
      data: {
        currentVersionId: versionId,
        status: "active",
        reviewedById: protocol.reviewerId,
        reviewedByAuthzVersion: 1,
        reviewedAssurance: "synthetic_mfa",
        reviewedIdentityLinkId: protocol.reviewerIdentityId,
        reviewedAuthenticatedAt: input.now,
        reviewedDutyAssignmentId: reviewerDuty,
        reviewedDutyAssignmentVersion: 1,
        reviewedAt: input.now,
        activatedAt: input.now,
        statusReason: "Activated for guarded transfer verification.",
        version: 2,
      },
    });
    await tx.protocolAuthorizationLifecycleEvent.create({
      data: {
        id: `${protocol.id}-activation-event`,
        authorizationId: protocol.id,
        fromStatus: "draft",
        toStatus: "active",
        actorId: protocol.reviewerId,
        actorAuthzVersion: 1,
        assurance: "synthetic_mfa",
        identityLinkId: protocol.reviewerIdentityId,
        authenticatedAt: input.now,
        dutyAssignmentId: reviewerDuty,
        dutyAssignmentVersion: 1,
        commandReceiptId: activationReceiptId,
        reason: "Activated for guarded transfer verification.",
        occurredAt: input.now,
      },
    });
  }

  for (const manager of managers) {
    const issuer = managers.find((candidate) => candidate.id !== manager.id)!;
    const trainingDuty = dutyByUser.get(issuer.id)?.trainingAdministrator;
    assert(trainingDuty, "Transfer competency training duty fixture is missing.");
    const evidenceId = `${manager.id}-transfer-competency`;
    const versionId = `${evidenceId}-v1`;
    const receiptId = `${evidenceId}-receipt`;
    const note = "Current synthetic transfer competency for retained verification.";
    const payload = {
      userId: manager.id,
      labId: manager.labId,
      procedureCode: "transfer",
      evidenceType: "synthetic_training_record",
      validFrom: validFrom.toISOString(),
      validUntil: validUntil.toISOString(),
      protocolVersionId: null,
      note,
      versionNumber: 1,
    };
    await createReceipt({ id: receiptId, actorId: issuer.id, labId: manager.labId, commandType: "competency_evidence.create", aggregateType: "competency_evidence", aggregateId: evidenceId });
    await tx.competencyEvidence.create({
      data: {
        id: evidenceId,
        userId: manager.id,
        labId: manager.labId,
        procedureCode: "transfer",
        status: "current",
        governedById: issuer.id,
        governedByAuthzVersion: 1,
        governedAssurance: "synthetic_mfa",
        governedIdentityLinkId: issuer.identityId,
        governedAuthenticatedAt: input.now,
        governedDutyAssignmentId: trainingDuty,
        governedDutyAssignmentVersion: 1,
        governedAt: input.now,
      },
    });
    await tx.competencyEvidenceVersion.create({
      data: {
        id: versionId,
        evidenceId,
        versionNumber: 1,
        evidenceType: "synthetic_training_record",
        contentHash: input.canonicalJsonHash(payload),
        contentPayload: input.canonicalJson(payload),
        validFrom,
        validUntil,
        issuedById: issuer.id,
        commandReceiptId: receiptId,
        note,
      },
    });
    await tx.competencyEvidence.update({ where: { id: evidenceId }, data: { currentVersionId: versionId } });
    await tx.competencyLifecycleEvent.create({
      data: {
        id: `${evidenceId}-created-event`,
        evidenceId,
        actorId: issuer.id,
        actorAuthzVersion: 1,
        assurance: "synthetic_mfa",
        identityLinkId: issuer.identityId,
        authenticatedAt: input.now,
        dutyAssignmentId: trainingDuty,
        dutyAssignmentVersion: 1,
        commandReceiptId: receiptId,
        eventType: "created",
        evidenceVersion: 1,
        detail: { fixture: "lab-transfer-verification" },
        occurredAt: input.now,
      },
    });
  }
  await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
}

async function expectRejected(operation: () => Promise<unknown>, message: string) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(message);
}

async function main() {
  const baseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!baseUrl) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");
  assertRetainedVerificationTarget(baseUrl);

  const schema = `mcm_test_lab_transfer_${Date.now()}_${process.pid}`;
  const directUrl = databaseUrlForSchema(baseUrl, schema, false);
  const runtimeUrl = databaseUrlForSchema(baseUrl, schema, true);
  const env = { ...process.env, DATABASE_URL: runtimeUrl, DIRECT_DATABASE_URL: directUrl, MCM_DEPLOYMENT_PROFILE: "synthetic" };
  await run("npx", ["prisma", "migrate", "deploy"], env);

  process.env.DATABASE_URL = runtimeUrl;
  process.env.DIRECT_DATABASE_URL = directUrl;
  process.env.MCM_DEPLOYMENT_PROFILE = "synthetic";
  const commandFoundation = await import("../src/lib/command-foundation");
  const capabilities = await import("../src/lib/capabilities");
  const transfer = await import("../src/lib/lab-transfer-write");
  const colony = await import("../src/lib/colony-write");
  const { prisma: db } = await import("../src/lib/prisma");

  const today = new Date().toISOString().slice(0, 10);
  const actor = (input: {
    id: string;
    email: string;
    role: "lab_user" | "cmu_staff" | "facility_admin";
    labId?: string;
    labCode?: string;
    labName?: string;
    membershipRole?: "owner" | "manager" | "staff" | "viewer";
    identityLinkId?: string;
  }) => {
    const activeMembership = input.role === "lab_user" && input.labId
      ? {
          labId: input.labId,
          labCode: input.labCode ?? input.labId,
          labName: input.labName ?? input.labId,
          role: input.membershipRole ?? "manager",
        }
      : null;
    return {
      id: input.id,
      email: input.email,
      name: input.id,
      role: input.role === "lab_user" ? "animal_staff" as const : input.role === "cmu_staff" ? "colony_manager" as const : "admin" as const,
      databaseRole: input.role,
      canonicalRole: input.role,
      authzVersion: 1,
      ...(input.identityLinkId ? {
        authMethod: "synthetic_mfa" as const,
        assurance: "synthetic_mfa" as const,
        authenticatedAt: new Date().toISOString(),
        identityLinkId: input.identityLinkId,
      } : {}),
      activeLabId: activeMembership?.labId ?? null,
      activeMembership,
      memberships: activeMembership ? [activeMembership] : [],
      capabilities: [...capabilities.getActorCapabilities({ canonicalRole: input.role, activeMembership })],
    };
  };

  const sourceManager = actor({ id: "transfer-source-manager", email: "admin@colony.local", role: "lab_user", labId: "transfer-lab-source", labCode: "SRC", labName: "Source Lab", membershipRole: "manager", identityLinkId: "transfer-source-manager-identity" });
  const sourceStaff = actor({ id: "transfer-source-staff", email: "source-staff@example.test", role: "lab_user", labId: "transfer-lab-source", labCode: "SRC", labName: "Source Lab", membershipRole: "staff" });
  const destinationManager = actor({ id: "transfer-destination-manager", email: "manager@colony.local", role: "lab_user", labId: "transfer-lab-destination", labCode: "DST", labName: "Destination Lab", membershipRole: "manager", identityLinkId: "transfer-destination-manager-identity" });
  const cmu = actor({ id: "transfer-cmu", email: "staff@colony.local", role: "cmu_staff", identityLinkId: "transfer-cmu-identity" });
  const facility = actor({ id: "transfer-facility", email: "researcher@colony.local", role: "facility_admin", identityLinkId: "transfer-facility-identity" });
  const facilityApprover = actor({ id: "transfer-facility-approver", email: "readonly@colony.local", role: "facility_admin", identityLinkId: "transfer-facility-approver-identity" });

  try {
    await db.user.createMany({
      data: [sourceManager, sourceStaff, destinationManager, cmu, facility, facilityApprover].map((entry) => ({
        id: entry.id,
        name: entry.name,
        email: entry.email,
        passwordHash: "not-a-login-hash",
        role: entry.databaseRole,
      })),
    });
    await db.lab.createMany({
      data: [
        { id: "transfer-lab-source", name: "Source Lab", code: "SRC" },
        { id: "transfer-lab-destination", name: "Destination Lab", code: "DST" },
      ],
    });
    await db.labMembership.createMany({
      data: [
        { id: "membership-source-manager", labId: "transfer-lab-source", userId: sourceManager.id, role: "manager" },
        { id: "membership-source-staff", labId: "transfer-lab-source", userId: sourceStaff.id, role: "staff" },
        { id: "membership-destination-manager", labId: "transfer-lab-destination", userId: destinationManager.id, role: "manager" },
      ],
    });
    await db.facility.create({ data: { id: "transfer-facility-record", name: "Transfer Facility", cageBarcodePrefix: "TR", maxCageOccupancy: 6 } });
    await db.room.create({ data: { id: "transfer-room", facilityId: "transfer-facility-record", roomNumber: "T1" } });
    await db.rack.create({ data: { id: "transfer-rack", roomId: "transfer-room", rackNumber: "A" } });
    await db.strain.create({ data: { id: "transfer-strain", name: "Transfer strain" } });
    await db.$transaction((tx) => seedTransferComplianceFixture(tx, {
      canonicalJson: commandFoundation.canonicalJson,
      canonicalJsonHash: commandFoundation.canonicalJsonHash,
      now: new Date(),
    }));
    await db.cageChargeCategory.create({ data: { id: "transfer-standard", name: "Standard", code: "STANDARD", dailyRateCents: 125 } });

    const cageIds = await db.$transaction((tx) => commandFoundation.allocateFacilityIdentifiers(tx, "cage", 4), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await db.cage.createMany({
      data: [
        { id: "transfer-cage-source-a", facilityCageId: cageIds[0], labId: "transfer-lab-source", roomId: "transfer-room", rackId: "transfer-rack", cageNumber: "001", barcode: "TR-T1-A-001", status: "breeding" },
        { id: "transfer-cage-source-b", facilityCageId: cageIds[1], labId: "transfer-lab-source", roomId: "transfer-room", rackId: "transfer-rack", cageNumber: "002", barcode: "TR-T1-A-002", status: "breeding" },
        { id: "transfer-cage-destination", facilityCageId: cageIds[2], labId: "transfer-lab-destination", roomId: "transfer-room", rackId: "transfer-rack", cageNumber: "003", barcode: "TR-T1-A-003", status: "active" },
        { id: "transfer-cage-quarantine", facilityCageId: cageIds[3], labId: "transfer-lab-destination", roomId: "transfer-room", rackId: "transfer-rack", cageNumber: "004", barcode: "TR-T1-A-004", status: "quarantine" },
      ],
    });
    await db.cageChargePeriod.createMany({
      data: [
        { id: "transfer-charge-source-a", cageId: "transfer-cage-source-a", labId: "transfer-lab-source", categoryId: "transfer-standard", dailyRateCents: 125, startedAt: new Date("2026-01-01T00:00:00.000Z") },
        { id: "transfer-charge-source-b", cageId: "transfer-cage-source-b", labId: "transfer-lab-source", categoryId: "transfer-standard", dailyRateCents: 125, startedAt: new Date("2026-01-01T00:00:00.000Z") },
        { id: "transfer-charge-destination", cageId: "transfer-cage-destination", labId: "transfer-lab-destination", categoryId: "transfer-standard", dailyRateCents: 125, startedAt: new Date("2026-01-01T00:00:00.000Z") },
        { id: "transfer-charge-quarantine", cageId: "transfer-cage-quarantine", labId: "transfer-lab-destination", categoryId: "transfer-standard", dailyRateCents: 125, startedAt: new Date("2026-01-01T00:00:00.000Z") },
      ],
    });
    const animalIds = await db.$transaction((tx) => commandFoundation.allocateFacilityIdentifiers(tx, "animal", 5), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await db.animal.createMany({
      data: [
        { id: "transfer-animal-cage-1", facilityAnimalId: animalIds[0], animalId: "TR-A-1", labId: "TR-LAB-1", owningLabId: "transfer-lab-source", sex: "female", dob: new Date("2026-01-01T00:00:00.000Z"), strainId: "transfer-strain", currentCageId: "transfer-cage-source-a", status: "breeding", originType: "verification", healthStatus: "fit" },
        { id: "transfer-animal-cage-2", facilityAnimalId: animalIds[1], animalId: "TR-A-2", labId: "TR-LAB-2", owningLabId: "transfer-lab-source", sex: "male", dob: new Date("2026-01-02T00:00:00.000Z"), strainId: "transfer-strain", currentCageId: "transfer-cage-source-a", status: "colony_holding", originType: "verification", healthStatus: "fit" },
        { id: "transfer-animal-single", facilityAnimalId: animalIds[2], animalId: "TR-A-3", labId: "TR-LAB-3", owningLabId: "transfer-lab-source", sex: "male", dob: new Date("2026-01-03T00:00:00.000Z"), strainId: "transfer-strain", currentCageId: "transfer-cage-source-b", status: "colony_holding", originType: "verification", healthStatus: "fit" },
        { id: "transfer-animal-resident", facilityAnimalId: animalIds[3], animalId: "TR-A-4", labId: "TR-LAB-4", owningLabId: "transfer-lab-destination", sex: "female", dob: new Date("2026-01-04T00:00:00.000Z"), strainId: "transfer-strain", currentCageId: "transfer-cage-destination", status: "colony_holding", originType: "verification", healthStatus: "fit" },
        { id: "transfer-animal-partner", facilityAnimalId: animalIds[4], animalId: "TR-A-5", labId: "TR-LAB-5", owningLabId: "transfer-lab-source", sex: "male", dob: new Date("2026-01-05T00:00:00.000Z"), strainId: "transfer-strain", currentCageId: "transfer-cage-source-b", status: "breeding", originType: "verification", healthStatus: "fit" },
      ],
    });
    await db.project.create({ data: { id: "transfer-project", labId: "transfer-lab-source", projectCode: "TR-PROJ", title: "Transfer project", ownerId: sourceManager.id } });
    await db.animalProjectAllocation.create({ data: { id: "transfer-allocation", animalId: "transfer-animal-cage-1", projectId: "transfer-project", startedAt: new Date("2026-01-10T00:00:00.000Z") } });
    await db.experiment.create({ data: { id: "transfer-experiment", labId: "transfer-lab-source", experimentCode: "TR-EXP", projectId: "transfer-project", title: "Transfer experiment", ownerId: sourceManager.id, status: "active", protocolAuthorizationId: SOURCE_PROTOCOL_ID } });
    await db.experimentAssignment.create({ data: { id: "transfer-assignment", animalId: "transfer-animal-cage-1", experimentId: "transfer-experiment", status: "active", startDate: new Date("2026-01-11T00:00:00.000Z") } });
    await db.$transaction(async (tx) => {
      const receiptId = "transfer-source-assignment-reservation-receipt";
      const versionId = `${SOURCE_PROTOCOL_ID}-v1`;
      const ledgerId = `${versionId}-ledger`;
      const allocationId = "transfer-source-assignment-allocation";
      const allocationKey = "assignment:transfer-assignment:reservation";
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.commandReceipt.create({
        data: {
          id: receiptId,
          actorId: sourceManager.id,
          actorAuthzVersion: 1,
          labId: "transfer-lab-source",
          commandType: "experiment.assignment.reserve_direct",
          idempotencyKey: receiptId,
          requestHash: commandFoundation.canonicalJsonHash({ fixture: receiptId }),
          requestId: receiptId,
          status: "succeeded",
          aggregateType: "animal",
          aggregateId: "transfer-animal-cage-1",
          result: { fixture: "source-assignment-reservation" },
          completedAt: new Date(),
        },
      });
      await tx.protocolCountAllocation.create({
        data: {
          id: allocationId,
          ledgerId,
          authorizationVersionId: versionId,
          allocationKey,
          aggregateType: "experiment_assignment",
          aggregateId: "transfer-assignment",
          reservedQuantity: 1,
          createdById: sourceManager.id,
          createdCommandReceiptId: receiptId,
        },
      });
      await tx.protocolCountAllocationHistory.create({
        data: {
          id: `${allocationId}-reserve`,
          allocationId,
          ledgerId,
          authorizationVersionId: versionId,
          commandReceiptId: receiptId,
          allocationKey,
          allocationType: "reserve",
          quantity: 1,
          allocationReservedBefore: 0,
          allocationReservedAfter: 1,
          allocationConsumedBefore: 0,
          allocationConsumedAfter: 0,
          allocationReleasedBefore: 0,
          allocationReleasedAfter: 0,
          allocationVersionBefore: 0,
          allocationVersionAfter: 1,
          reservedBefore: 0,
          reservedAfter: 1,
          consumedBefore: 0,
          consumedAfter: 0,
          aggregateType: "experiment_assignment",
          aggregateId: "transfer-assignment",
          commandAggregateType: "animal",
          commandAggregateId: "transfer-animal-cage-1",
          actorId: sourceManager.id,
        },
      });
      await tx.protocolCountLedger.update({
        where: { id: ledgerId },
        data: { reservedCount: 1, version: { increment: 1 } },
      });
      await tx.experimentAssignment.update({
        where: { id: "transfer-assignment" },
        data: { protocolCountAllocationId: allocationId },
      });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });
    await db.breedingSetup.create({ data: { id: "transfer-breeding", labId: "transfer-lab-source", startDate: new Date("2026-01-12T00:00:00.000Z"), status: "active", targetGenotype: "verification" } });
    await db.breedingAdult.createMany({
      data: [
        { id: "transfer-breeding-adult", breedingSetupId: "transfer-breeding", animalId: "transfer-animal-cage-1", role: "dam" },
        { id: "transfer-breeding-partner", breedingSetupId: "transfer-breeding", animalId: "transfer-animal-partner", role: "sire" },
      ],
    });
    await db.quarantineCase.createMany({
      data: [
        {
          id: "transfer-historical-release",
          labId: "transfer-lab-source",
          cageId: "transfer-cage-source-a",
          status: "released",
          admittedAt: new Date("2025-10-01T00:00:00.000Z"),
          minimumReleaseAt: new Date("2025-10-08T00:00:00.000Z"),
          admissionReason: "Historical intake",
          admittedById: cmu.id,
          releasedAt: new Date("2025-10-09T00:00:00.000Z"),
          releasedById: cmu.id,
          releaseReason: "Historical clearance",
        },
        {
          id: "transfer-historical-cancelled",
          labId: "transfer-lab-source",
          cageId: "transfer-cage-source-a",
          status: "cancelled",
          admittedAt: new Date("2025-11-01T00:00:00.000Z"),
          minimumReleaseAt: new Date("2025-11-08T00:00:00.000Z"),
          admissionReason: "Historical duplicate",
          admittedById: cmu.id,
          cancelledAt: new Date("2025-11-02T00:00:00.000Z"),
        },
      ],
    });

    await expectRejected(
      () => db.$executeRawUnsafe(`UPDATE "${schema}"."Cage" SET "labId" = 'transfer-lab-destination' WHERE id = 'transfer-cage-source-a'`),
      "A raw cage ownership update bypassed the transfer workflow.",
    );
    await expectRejected(
      () => db.$executeRawUnsafe(`
        INSERT INTO "${schema}"."CageLabTransfer"
          (id, "requestId", "cageId", "fromLabId", "toLabId", "movedAt")
        VALUES
          ('transfer-null-request-history', NULL, 'transfer-cage-source-a', 'transfer-lab-source', 'transfer-lab-destination', CURRENT_TIMESTAMP)
      `),
      "Transfer history accepted a null approval request.",
    );

    const unauthorized = await transfer.executeRequestLabTransferCommand({
      actor: sourceStaff,
      command: { subjectType: "cage", sourceCageId: "transfer-cage-source-a", destinationLabId: "transfer-lab-destination", requestedEffectiveAt: today, reason: "Unauthorized request", sourceProtocolAuthorizationId: SOURCE_PROTOCOL_ID },
      idempotencyKey: "transfer-unauthorized-request",
      requestId: "transfer-unauthorized-request",
    });
    assert(!unauthorized.ok && unauthorized.code === "forbidden", "Source staff unexpectedly created a transfer request.");

    const cageRequest = await transfer.executeRequestLabTransferCommand({
      actor: sourceManager,
      command: { subjectType: "cage", sourceCageId: "transfer-cage-source-a", destinationLabId: "transfer-lab-destination", requestedEffectiveAt: today, reason: "Transfer breeding cage", sourcePrivateNote: "SOURCE PRIVATE NOTE", sourceProtocolAuthorizationId: SOURCE_PROTOCOL_ID },
      idempotencyKey: "transfer-cage-request-0001",
      requestId: "transfer-cage-request-0001",
    });
    assert(cageRequest.ok, `Cage transfer request failed: ${JSON.stringify(cageRequest)}.`);
    const cageRequestId = (cageRequest.result as { requestId: string }).requestId;
    const cageBeforeDecision = await db.cage.findUniqueOrThrow({ where: { id: "transfer-cage-source-a" }, include: { chargePeriods: true } });
    assert(cageBeforeDecision.labId === "transfer-lab-source", "Request changed cage ownership before finalization.");
    assert(cageBeforeDecision.chargePeriods.every((period) => period.labId === "transfer-lab-source"), "Request changed billing before finalization.");
    const destinationPacket = await db.labTransferPacket.findFirstOrThrow({ where: { requestId: cageRequestId }, orderBy: { version: "desc" } });
    assert(!JSON.stringify(destinationPacket.destinationPayload).includes("SOURCE PRIVATE NOTE"), "Source-private note leaked into destination packet.");

    await expectRejected(async () => {
      await db.$transaction(async (tx) => {
        const receiptId = "transfer-forged-acceptance-receipt";
        await tx.commandReceipt.create({
          data: {
            id: receiptId,
            actorId: destinationManager.id,
            labId: "transfer-lab-destination",
            commandType: "lab_transfer.destination_accept",
            idempotencyKey: receiptId,
            requestHash: "forged",
            requestId: receiptId,
            aggregateType: "lab_transfer_request",
            aggregateId: cageRequestId,
          },
        });
        await tx.$queryRaw(Prisma.sql`
          SELECT
            set_config('mcm.lab_transfer_request_id', ${cageRequestId}, true),
            set_config('mcm.lab_transfer_actor_id', ${destinationManager.id}, true),
            set_config('mcm.lab_transfer_command_type', 'lab_transfer.destination_accept', true),
            set_config('mcm.lab_transfer_receipt_id', ${receiptId}, true)
        `);
        await tx.$executeRaw(Prisma.sql`
          UPDATE "LabTransferRequest"
          SET
            status = 'destination_accepted',
            "acceptedPacketVersion" = "packetVersion",
            "acceptedPacketHash" = ${"0".repeat(64)},
            "destinationDecisionById" = ${destinationManager.id},
            "destinationDecisionAt" = CURRENT_TIMESTAMP,
            version = version + 1
          WHERE id = ${cageRequestId}
        `);
      });
    }, "The database accepted an approval hash that did not match the immutable packet.");

    await expectRejected(
      () => db.$executeRawUnsafe(`
        UPDATE "${schema}"."LabTransferRequest"
        SET status = 'finalized', "finalizedById" = 'transfer-facility', "finalizedAt" = CURRENT_TIMESTAMP, version = version + 1
        WHERE id = '${cageRequestId}'
      `),
      "A raw request update skipped destination acceptance.",
    );

    const cageRequestVersion = (await db.labTransferRequest.findUniqueOrThrow({ where: { id: cageRequestId } })).version;
    const wrongLabDecision = await transfer.executeDecideLabTransferCommand({
      actor: sourceManager,
      command: { requestId: cageRequestId, decision: "accept", destinationProtocolAuthorizationId: DESTINATION_PROTOCOL_ID },
      expectedVersion: cageRequestVersion,
      idempotencyKey: "transfer-wrong-lab-decision",
      requestId: "transfer-wrong-lab-decision",
    });
    assert(!wrongLabDecision.ok, "Source lab unexpectedly accepted its own transfer request.");
    const cageAccepted = await transfer.executeDecideLabTransferCommand({
      actor: destinationManager,
      command: { requestId: cageRequestId, decision: "accept", note: "Destination accepts the cage", destinationProtocolAuthorizationId: DESTINATION_PROTOCOL_ID },
      expectedVersion: cageRequestVersion,
      idempotencyKey: "transfer-cage-accept-0001",
      requestId: "transfer-cage-accept-0001",
    });
    assert(cageAccepted.ok, `Destination cage acceptance failed: ${JSON.stringify(cageAccepted)}.`);
    const acceptedCageRequest = await db.labTransferRequest.findUniqueOrThrow({ where: { id: cageRequestId } });
    assert((await db.cage.findUniqueOrThrow({ where: { id: "transfer-cage-source-a" } })).labId === "transfer-lab-source", "Acceptance changed ownership before CMU finalization.");

    const cmuBlocked = await transfer.executeFinalizeLabTransferCommand({
      actor: cmu,
      command: { requestId: cageRequestId },
      expectedVersion: acceptedCageRequest.version,
      idempotencyKey: "transfer-cage-cmu-blocked",
      requestId: "transfer-cage-cmu-blocked",
    });
    assert(!cmuBlocked.ok && cmuBlocked.code === "active_relationships", "CMU finalization did not expose active relationship blockers.");
    const cmuOverride = await transfer.executeFinalizeLabTransferCommand({
      actor: cmu,
      command: { requestId: cageRequestId, overrideReason: "CMU must not have override authority" },
      expectedVersion: acceptedCageRequest.version,
      idempotencyKey: "transfer-cage-cmu-override",
      requestId: "transfer-cage-cmu-override",
    });
    assert(!cmuOverride.ok && cmuOverride.code === "override_forbidden", "CMU unexpectedly applied a Facility override.");
    const reservationBeforeOverride = await db.protocolCountAllocation.findUniqueOrThrow({
      where: { id: "transfer-source-assignment-allocation" },
    });
    const destinationBeforeOverride = await db.protocolCountAllocation.findUniqueOrThrow({
      where: { id: acceptedCageRequest.destinationProtocolCountAllocationId! },
    });
    assert(
      reservationBeforeOverride.status === "open" &&
        reservationBeforeOverride.releasedQuantity === 0,
      "A rejected override changed the source assignment reservation.",
    );
    assert(
      destinationBeforeOverride.status === "open" &&
        destinationBeforeOverride.consumedQuantity === 0,
      "A rejected override consumed the destination reservation.",
    );

    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.experimentAssignment.update({
        where: { id: "transfer-assignment" },
        data: { protocolCountAllocationId: null },
      });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });
    const inconsistentOverride = await transfer.executeFinalizeLabTransferCommand({
      actor: facility,
      command: {
        requestId: cageRequestId,
        overrideReason:
          "Facility attempted settlement with intentionally inconsistent synthetic evidence.",
      },
      expectedVersion: acceptedCageRequest.version,
      idempotencyKey: "transfer-cage-facility-inconsistent",
      requestId: "transfer-cage-facility-inconsistent",
    });
    assert(
      !inconsistentOverride.ok &&
        inconsistentOverride.code === "compliance_count_conflict",
      "Facility override did not fail closed on a missing source allocation link.",
    );
    assert(
      (await db.labTransferRequest.findUniqueOrThrow({ where: { id: cageRequestId } })).status ===
        "destination_accepted",
      "A failed source-settlement override changed the transfer lifecycle.",
    );
    assert(
      (await db.protocolCountAllocation.findUniqueOrThrow({
        where: { id: acceptedCageRequest.destinationProtocolCountAllocationId! },
      })).status === "open",
      "A failed source-settlement override did not roll back destination consumption.",
    );
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.experimentAssignment.update({
        where: { id: "transfer-assignment" },
        data: {
          protocolCountAllocationId: "transfer-source-assignment-allocation",
        },
      });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });
    const facilityFinalized = await transfer.executeFinalizeLabTransferCommand({
      actor: facility,
      command: { requestId: cageRequestId, overrideReason: "Facility approved closure of active research relationships." },
      expectedVersion: acceptedCageRequest.version,
      idempotencyKey: "transfer-cage-facility-finalize",
      requestId: "transfer-cage-facility-finalize",
    });
    assert(facilityFinalized.ok, `Facility cage finalization failed: ${JSON.stringify(facilityFinalized)}.`);
    const finalizedCage = await db.cage.findUniqueOrThrow({ where: { id: "transfer-cage-source-a" }, include: { chargePeriods: { orderBy: { startedAt: "desc" } }, labTransfers: true } });
    assert(finalizedCage.labId === "transfer-lab-destination", "Cage ownership did not change at finalization.");
    assert(finalizedCage.chargePeriods[0]?.labId === "transfer-lab-destination", "Destination billing period was not opened.");
    assert(finalizedCage.chargePeriods.some((period) => period.labId === "transfer-lab-source" && period.endedAt), "Source billing period was not closed.");
    assert(finalizedCage.labTransfers[0]?.requestId === cageRequestId, "Cage transfer history is not linked to the request.");
    assert((await db.experimentAssignment.findUniqueOrThrow({ where: { id: "transfer-assignment" } })).status === "cancelled", "Override did not cancel active experiment assignment.");
    const settledSourceAllocation = await db.protocolCountAllocation.findUniqueOrThrow({
      where: { id: "transfer-source-assignment-allocation" },
    });
    const settledDestinationAllocation = await db.protocolCountAllocation.findUniqueOrThrow({
      where: { id: acceptedCageRequest.destinationProtocolCountAllocationId! },
    });
    assert(
      settledSourceAllocation.status === "released" &&
        settledSourceAllocation.releasedQuantity === 1,
      "Override did not release the exact source experiment reservation.",
    );
    assert(
      settledDestinationAllocation.status === "consumed" &&
        settledDestinationAllocation.consumedQuantity ===
          settledDestinationAllocation.reservedQuantity,
      "Finalization did not consume the exact destination reservation.",
    );
    assert((await db.animalProjectAllocation.findUniqueOrThrow({ where: { id: "transfer-allocation" } })).endedAt, "Override did not end project allocation.");
    assert((await db.breedingSetup.findUniqueOrThrow({ where: { id: "transfer-breeding" } })).status === "retired", "Override did not retire breeding setup.");
    const breedingPartner = await db.animal.findUniqueOrThrow({ where: { id: "transfer-animal-partner" } });
    assert(breedingPartner.status === "colony_holding", "Override left the non-transferred breeding partner in breeding status.");
    assert(
      await db.animalStatusEvent.count({
        where: { animalId: breedingPartner.id, fromStatus: "breeding", toStatus: "colony_holding" },
      }) === 1,
      "Override did not record the non-transferred partner status transition.",
    );
    assert((await db.cage.findUniqueOrThrow({ where: { id: "transfer-cage-source-b" } })).status === "active", "Override left the partner cage in breeding status.");
    assert(
      await db.quarantineCase.count({ where: { cageId: "transfer-cage-source-a", labId: "transfer-lab-source", status: { in: ["released", "cancelled"] } } }) === 2,
      "Historical quarantine cases were not preserved across cage ownership transfer.",
    );
    const overrideEvents = await db.labTransferEvent.findMany({ where: { requestId: cageRequestId, eventType: "override_applied" } });
    assert(overrideEvents.length === 1, "Facility override event was not recorded exactly once.");

    const animalRequest = await transfer.executeRequestLabTransferCommand({
      actor: sourceManager,
      command: { subjectType: "animals", animalIds: ["transfer-animal-single"], destinationLabId: "transfer-lab-destination", requestedEffectiveAt: today, reason: "Transfer one holding animal", sourcePrivateNote: "ANOTHER PRIVATE NOTE", sourceProtocolAuthorizationId: SOURCE_PROTOCOL_ID },
      idempotencyKey: "transfer-animal-request-0001",
      requestId: "transfer-animal-request-0001",
    });
    assert(animalRequest.ok, `Animal transfer request failed: ${JSON.stringify(animalRequest)}.`);
    const animalRequestId = (animalRequest.result as { requestId: string }).requestId;
    const animalRequestVersion = (await db.labTransferRequest.findUniqueOrThrow({ where: { id: animalRequestId } })).version;
    const quarantinePlacement = await transfer.executeDecideLabTransferCommand({
      actor: destinationManager,
      command: { requestId: animalRequestId, decision: "accept", destinationCageId: "transfer-cage-quarantine", note: "Invalid quarantine placement", destinationProtocolAuthorizationId: DESTINATION_PROTOCOL_ID },
      expectedVersion: animalRequestVersion,
      idempotencyKey: "transfer-animal-quarantine-placement",
      requestId: "transfer-animal-quarantine-placement",
    });
    assert(!quarantinePlacement.ok && quarantinePlacement.code === "validation_error", "A routine cross-lab transfer entered a quarantine-status cage.");
    const mixedSexPlacement = await transfer.executeDecideLabTransferCommand({
      actor: destinationManager,
      command: { requestId: animalRequestId, decision: "accept", destinationCageId: "transfer-cage-destination", note: "Invalid mixed-sex placement", destinationProtocolAuthorizationId: DESTINATION_PROTOCOL_ID },
      expectedVersion: animalRequestVersion,
      idempotencyKey: "transfer-animal-mixed-sex-placement",
      requestId: "transfer-animal-mixed-sex-placement",
    });
    assert(!mixedSexPlacement.ok && mixedSexPlacement.code === "validation_error", "Destination approval allowed prohibited mixed-sex housing.");
    await db.animal.update({ where: { id: "transfer-animal-single" }, data: { sex: "female" } });
    const placementRevision = await transfer.executeReviseLabTransferCommand({
      actor: sourceManager,
      command: { requestId: animalRequestId, destinationLabId: "transfer-lab-destination", requestedEffectiveAt: today, reason: "Transfer one holding animal", sourcePrivateNote: "ANOTHER PRIVATE NOTE", sourceProtocolAuthorizationId: SOURCE_PROTOCOL_ID },
      expectedVersion: animalRequestVersion,
      idempotencyKey: "transfer-animal-placement-revision",
      requestId: "transfer-animal-placement-revision",
    });
    assert(placementRevision.ok, `Placement packet revision failed: ${JSON.stringify(placementRevision)}.`);
    const placementRevisedRequest = await db.labTransferRequest.findUniqueOrThrow({ where: { id: animalRequestId } });
    const animalAccepted = await transfer.executeDecideLabTransferCommand({
      actor: destinationManager,
      command: { requestId: animalRequestId, decision: "accept", destinationCageId: "transfer-cage-destination", note: "Space confirmed", destinationProtocolAuthorizationId: DESTINATION_PROTOCOL_ID },
      expectedVersion: placementRevisedRequest.version,
      idempotencyKey: "transfer-animal-accept-0001",
      requestId: "transfer-animal-accept-0001",
    });
    assert(animalAccepted.ok, `Animal transfer acceptance failed: ${JSON.stringify(animalAccepted)}.`);
    await db.animal.update({ where: { id: "transfer-animal-single" }, data: { healthStatus: "Updated after approval" } });
    await db.cage.update({ where: { id: "transfer-cage-destination" }, data: { status: "experiment" } });
    const acceptedAnimalRequest = await db.labTransferRequest.findUniqueOrThrow({ where: { id: animalRequestId } });
    const staleFinalization = await transfer.executeFinalizeLabTransferCommand({
      actor: cmu,
      command: { requestId: animalRequestId },
      expectedVersion: acceptedAnimalRequest.version,
      idempotencyKey: "transfer-animal-stale-finalize",
      requestId: "transfer-animal-stale-finalize",
    });
    assert(!staleFinalization.ok && staleFinalization.code === "packet_stale", "Changed animal or destination-cage details did not invalidate destination acceptance.");
    await db.cage.update({ where: { id: "transfer-cage-destination" }, data: { status: "active" } });
    const revised = await transfer.executeReviseLabTransferCommand({
      actor: sourceManager,
      command: { requestId: animalRequestId, destinationLabId: "transfer-lab-destination", requestedEffectiveAt: today, reason: "Transfer one holding animal", sourcePrivateNote: "ANOTHER PRIVATE NOTE", sourceProtocolAuthorizationId: SOURCE_PROTOCOL_ID },
      expectedVersion: acceptedAnimalRequest.version,
      idempotencyKey: "transfer-animal-revise-0001",
      requestId: "transfer-animal-revise-0001",
    });
    assert(revised.ok, `Packet revision failed: ${JSON.stringify(revised)}.`);
    const revisedRequest = await db.labTransferRequest.findUniqueOrThrow({ where: { id: animalRequestId } });
    assert(revisedRequest.status === "requested" && revisedRequest.acceptedPacketVersion === null, "Revision did not clear prior acceptance.");
    const reaccepted = await transfer.executeDecideLabTransferCommand({
      actor: destinationManager,
      command: { requestId: animalRequestId, decision: "accept", destinationCageId: "transfer-cage-destination", note: "Updated packet accepted", destinationProtocolAuthorizationId: DESTINATION_PROTOCOL_ID },
      expectedVersion: revisedRequest.version,
      idempotencyKey: "transfer-animal-reaccept-0001",
      requestId: "transfer-animal-reaccept-0001",
    });
    assert(reaccepted.ok, `Updated packet acceptance failed: ${JSON.stringify(reaccepted)}.`);
    const reacceptedRequest = await db.labTransferRequest.findUniqueOrThrow({ where: { id: animalRequestId } });
    const animalFinalized = await transfer.executeFinalizeLabTransferCommand({
      actor: cmu,
      command: { requestId: animalRequestId },
      expectedVersion: reacceptedRequest.version,
      idempotencyKey: "transfer-animal-finalize-0001",
      requestId: "transfer-animal-finalize-0001",
    });
    assert(animalFinalized.ok, `Animal finalization failed: ${JSON.stringify(animalFinalized)}.`);
    const movedAnimal = await db.animal.findUniqueOrThrow({ where: { id: "transfer-animal-single" } });
    assert(movedAnimal.owningLabId === "transfer-lab-destination" && movedAnimal.currentCageId === "transfer-cage-destination", "Animal ownership/location did not change atomically.");
    assert(await db.animalMovement.count({ where: { requestId: animalRequestId, animalId: movedAnimal.id, toCageId: "transfer-cage-destination" } }) === 1, "Animal movement history is not linked to the request.");
    assert(await db.animalLabTransfer.count({ where: { requestId: animalRequestId, animalId: movedAnimal.id } }) === 1, "Animal transfer history is not linked to the request.");
    const finalRequest = await db.labTransferRequest.findUniqueOrThrow({ where: { id: animalRequestId } });
    assert(finalRequest.status === "finalized" && finalRequest.acceptedPacketVersion === finalRequest.packetVersion, "Final request did not preserve current packet acceptance.");

    const succeededReceipt = await db.commandReceipt.findFirstOrThrow({
      where: {
        aggregateType: "lab_transfer_request",
        aggregateId: animalRequestId,
        commandType: "lab_transfer.finalize",
        status: "succeeded",
      },
      orderBy: { startedAt: "desc" },
    });
    await expectRejected(async () => {
      await db.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT
            set_config('mcm.lab_transfer_request_id', ${animalRequestId}, true),
            set_config('mcm.lab_transfer_actor_id', ${cmu.id}, true),
            set_config('mcm.lab_transfer_command_type', 'lab_transfer.finalize', true),
            set_config('mcm.lab_transfer_receipt_id', ${succeededReceipt.id}, true)
        `);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "LabTransferEvent"
            (id, "requestId", "eventType", "actorId", "actorRole", "packetVersion", reason)
          VALUES
            ('transfer-forged-reused-receipt-event', ${animalRequestId}, 'finalized', ${cmu.id}, 'cmu_staff', ${finalRequest.packetVersion}, 'Forged after receipt completion')
        `);
      });
    }, "A succeeded command receipt could be reused to append a forged transfer event.");

    await expectRejected(
      () => db.$executeRawUnsafe(`TRUNCATE TABLE "${schema}"."LabTransferEvent"`),
      "The append-only transfer event ledger allowed TRUNCATE.",
    );

    const legacyDirect = await colony.transferCageToLab({ cageId: "transfer-cage-source-b", toLabId: "transfer-lab-destination", movedAt: today, reason: "Bypass attempt" }, { id: facility.id, role: "admin" });
    assert(!legacyDirect.ok, "Legacy direct transfer bypass remains enabled.");

    let packetMutationRejected = false;
    try {
      await db.labTransferPacket.update({ where: { id: destinationPacket.id }, data: { payloadHash: "mutated" } });
    } catch {
      packetMutationRejected = true;
    }
    assert(packetMutationRejected, "Append-only transfer packet was mutable.");

    process.env.ALLOW_DESTRUCTIVE_SEED = "true";
    const { seedDatabase } = await import("../prisma/seed-database");
    await seedDatabase({ clearAttachments: false });
    assert(await db.labTransferRequest.count() === 0, "Disposable reseeding left transfer requests behind.");
    assert(await db.labTransferPacket.count() === 0, "Disposable reseeding left immutable transfer packets behind.");
    assert(await db.labTransferEvent.count() === 0, "Disposable reseeding left immutable transfer events behind.");
    assert(await db.animal.count() > 0 && await db.cage.count() > 0, "Disposable reseeding did not restore the demo fixture.");

    console.log(`Lab transfer verification passed in retained schema ${schema}.`);
  } finally {
    await db.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
