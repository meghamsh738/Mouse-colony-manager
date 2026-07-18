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
  const env = { ...process.env, DATABASE_URL: runtimeUrl, DIRECT_DATABASE_URL: directUrl };
  await run("npx", ["prisma", "migrate", "deploy"], env);

  process.env.DATABASE_URL = runtimeUrl;
  process.env.DIRECT_DATABASE_URL = directUrl;
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
      activeLabId: activeMembership?.labId ?? null,
      activeMembership,
      memberships: activeMembership ? [activeMembership] : [],
      capabilities: [...capabilities.getActorCapabilities({ canonicalRole: input.role, activeMembership })],
    };
  };

  const sourceManager = actor({ id: "transfer-source-manager", email: "source-manager@example.test", role: "lab_user", labId: "transfer-lab-source", labCode: "SRC", labName: "Source Lab", membershipRole: "manager" });
  const sourceStaff = actor({ id: "transfer-source-staff", email: "source-staff@example.test", role: "lab_user", labId: "transfer-lab-source", labCode: "SRC", labName: "Source Lab", membershipRole: "staff" });
  const destinationManager = actor({ id: "transfer-destination-manager", email: "destination-manager@example.test", role: "lab_user", labId: "transfer-lab-destination", labCode: "DST", labName: "Destination Lab", membershipRole: "manager" });
  const cmu = actor({ id: "transfer-cmu", email: "cmu@example.test", role: "cmu_staff" });
  const facility = actor({ id: "transfer-facility", email: "facility@example.test", role: "facility_admin" });

  try {
    await db.user.createMany({
      data: [sourceManager, sourceStaff, destinationManager, cmu, facility].map((entry) => ({
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
    await db.experiment.create({ data: { id: "transfer-experiment", labId: "transfer-lab-source", experimentCode: "TR-EXP", projectId: "transfer-project", title: "Transfer experiment", ownerId: sourceManager.id, status: "active" } });
    await db.experimentAssignment.create({ data: { id: "transfer-assignment", animalId: "transfer-animal-cage-1", experimentId: "transfer-experiment", status: "active", startDate: new Date("2026-01-11T00:00:00.000Z") } });
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
      command: { subjectType: "cage", sourceCageId: "transfer-cage-source-a", destinationLabId: "transfer-lab-destination", requestedEffectiveAt: today, reason: "Unauthorized request" },
      idempotencyKey: "transfer-unauthorized-request",
      requestId: "transfer-unauthorized-request",
    });
    assert(!unauthorized.ok && unauthorized.code === "forbidden", "Source staff unexpectedly created a transfer request.");

    const cageRequest = await transfer.executeRequestLabTransferCommand({
      actor: sourceManager,
      command: { subjectType: "cage", sourceCageId: "transfer-cage-source-a", destinationLabId: "transfer-lab-destination", requestedEffectiveAt: today, reason: "Transfer breeding cage", sourcePrivateNote: "SOURCE PRIVATE NOTE" },
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
      command: { requestId: cageRequestId, decision: "accept" },
      expectedVersion: cageRequestVersion,
      idempotencyKey: "transfer-wrong-lab-decision",
      requestId: "transfer-wrong-lab-decision",
    });
    assert(!wrongLabDecision.ok, "Source lab unexpectedly accepted its own transfer request.");
    const cageAccepted = await transfer.executeDecideLabTransferCommand({
      actor: destinationManager,
      command: { requestId: cageRequestId, decision: "accept", note: "Destination accepts the cage" },
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
      command: { subjectType: "animals", animalIds: ["transfer-animal-single"], destinationLabId: "transfer-lab-destination", requestedEffectiveAt: today, reason: "Transfer one holding animal", sourcePrivateNote: "ANOTHER PRIVATE NOTE" },
      idempotencyKey: "transfer-animal-request-0001",
      requestId: "transfer-animal-request-0001",
    });
    assert(animalRequest.ok, `Animal transfer request failed: ${JSON.stringify(animalRequest)}.`);
    const animalRequestId = (animalRequest.result as { requestId: string }).requestId;
    const animalRequestVersion = (await db.labTransferRequest.findUniqueOrThrow({ where: { id: animalRequestId } })).version;
    const quarantinePlacement = await transfer.executeDecideLabTransferCommand({
      actor: destinationManager,
      command: { requestId: animalRequestId, decision: "accept", destinationCageId: "transfer-cage-quarantine", note: "Invalid quarantine placement" },
      expectedVersion: animalRequestVersion,
      idempotencyKey: "transfer-animal-quarantine-placement",
      requestId: "transfer-animal-quarantine-placement",
    });
    assert(!quarantinePlacement.ok && quarantinePlacement.code === "validation_error", "A routine cross-lab transfer entered a quarantine-status cage.");
    const mixedSexPlacement = await transfer.executeDecideLabTransferCommand({
      actor: destinationManager,
      command: { requestId: animalRequestId, decision: "accept", destinationCageId: "transfer-cage-destination", note: "Invalid mixed-sex placement" },
      expectedVersion: animalRequestVersion,
      idempotencyKey: "transfer-animal-mixed-sex-placement",
      requestId: "transfer-animal-mixed-sex-placement",
    });
    assert(!mixedSexPlacement.ok && mixedSexPlacement.code === "validation_error", "Destination approval allowed prohibited mixed-sex housing.");
    await db.animal.update({ where: { id: "transfer-animal-single" }, data: { sex: "female" } });
    const placementRevision = await transfer.executeReviseLabTransferCommand({
      actor: sourceManager,
      command: { requestId: animalRequestId, destinationLabId: "transfer-lab-destination", requestedEffectiveAt: today, reason: "Transfer one holding animal", sourcePrivateNote: "ANOTHER PRIVATE NOTE" },
      expectedVersion: animalRequestVersion,
      idempotencyKey: "transfer-animal-placement-revision",
      requestId: "transfer-animal-placement-revision",
    });
    assert(placementRevision.ok, `Placement packet revision failed: ${JSON.stringify(placementRevision)}.`);
    const placementRevisedRequest = await db.labTransferRequest.findUniqueOrThrow({ where: { id: animalRequestId } });
    const animalAccepted = await transfer.executeDecideLabTransferCommand({
      actor: destinationManager,
      command: { requestId: animalRequestId, decision: "accept", destinationCageId: "transfer-cage-destination", note: "Space confirmed" },
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
      command: { requestId: animalRequestId, destinationLabId: "transfer-lab-destination", requestedEffectiveAt: today, reason: "Transfer one holding animal", sourcePrivateNote: "ANOTHER PRIVATE NOTE" },
      expectedVersion: acceptedAnimalRequest.version,
      idempotencyKey: "transfer-animal-revise-0001",
      requestId: "transfer-animal-revise-0001",
    });
    assert(revised.ok, `Packet revision failed: ${JSON.stringify(revised)}.`);
    const revisedRequest = await db.labTransferRequest.findUniqueOrThrow({ where: { id: animalRequestId } });
    assert(revisedRequest.status === "requested" && revisedRequest.acceptedPacketVersion === null, "Revision did not clear prior acceptance.");
    const reaccepted = await transfer.executeDecideLabTransferCommand({
      actor: destinationManager,
      command: { requestId: animalRequestId, decision: "accept", destinationCageId: "transfer-cage-destination", note: "Updated packet accepted" },
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
