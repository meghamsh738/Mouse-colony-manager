import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getActorCapabilities } from "@/lib/capabilities";
import { prisma } from "@/lib/prisma";
import { getReconciliationWorkspace } from "@/lib/reconciliation-read";
import {
  appendLifecycleEvent,
  executeAdvanceCensusSessionCommand,
  executeCancelTransferDispatchCommand,
  executeDispatchTransferCustodyCommand,
  executeGrantCapacityExceptionCommand,
  executeReceiveTransferCustodyCommand,
  executeRecordCensusObservationCommand,
  executeResolveCensusDiscrepancyCommand,
  executeResolveTransferCustodyReconciliationCommand,
  executeStartCensusSessionCommand,
  setM16Context,
} from "@/lib/reconciliation-write";
import type { ResolvedActor } from "@/lib/session";
import { installReconciliationDatabaseFixture } from "./reconciliation-test-fixture";

let cleanup: (() => Promise<void>) | undefined;
beforeAll(async () => { cleanup = await installReconciliationDatabaseFixture(); }, 120_000);
afterAll(async () => { await cleanup?.(); await prisma.$disconnect(); }, 120_000);

function identity(prefix: string) {
  return { idempotencyKey: `${prefix}-${randomUUID()}`, requestId: `request-${randomUUID()}` };
}

async function labActor(userId: string, labId: string): Promise<ResolvedActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const membership = await prisma.labMembership.findFirstOrThrow({ where: { userId, labId, active: true }, include: { lab: true } });
  const identityLink = await prisma.externalIdentityLink.findFirstOrThrow({ where: { userId, active: true } });
  const activeMembership = { labId, labName: membership.lab.name, labCode: membership.lab.code, role: membership.role };
  return {
    id: user.id, email: user.email, name: user.name, databaseRole: user.role, role: "animal_staff", canonicalRole: "lab_user",
    authzVersion: user.authzVersion, authMethod: "synthetic_mfa", assurance: "synthetic_mfa", authenticatedAt: new Date().toISOString(), identityLinkId: identityLink.id,
    activeDuties: [], activeLabId: labId, activeMembership, memberships: [activeMembership],
    capabilities: [...getActorCapabilities({ canonicalRole: "lab_user", activeMembership, activeDuties: [] })],
  };
}

async function systemActor(userId: "user-facility-admin-qa" | "user-facility-admin-approver-qa" | "user-cmu-staff-qa"): Promise<ResolvedActor> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const identityLink = await prisma.externalIdentityLink.findFirstOrThrow({ where: { userId, active: true } });
  const canonicalRole = user.role === "facility_admin" ? "facility_admin" as const : "cmu_staff" as const;
  return {
    id: user.id, email: user.email, name: user.name, databaseRole: user.role, role: canonicalRole, canonicalRole,
    authzVersion: user.authzVersion, authMethod: "synthetic_mfa", assurance: "synthetic_mfa", authenticatedAt: new Date().toISOString(), identityLinkId: identityLink.id,
    activeDuties: [], activeLabId: null, activeMembership: null, memberships: [],
    capabilities: [...getActorCapabilities({ canonicalRole, activeMembership: null, activeDuties: [] })],
  };
}

function resultValue<T>(result: { ok: boolean; result?: unknown }, key: string) {
  if (!result.ok || !result.result || typeof result.result !== "object" || Array.isArray(result.result)) throw new Error(`Missing ${key}`);
  return (result.result as Record<string, unknown>)[key] as T;
}

const usedAnimals = new Set<string>();
async function seedAcceptedTransferFixture(itemCount = 1) {
  const animals = await prisma.animal.findMany({ where: { owningLabId: "lab-microglia", outcomeStatus: "alive", id: { notIn: [...usedAnimals] } }, orderBy: { id: "asc" }, take: itemCount });
  if (animals.length !== itemCount) throw new Error(`Expected ${itemCount} unused synthetic transfer animals, found ${animals.length}.`);
  const animal = animals[0]!;
  const destinationCage = await prisma.cage.findFirstOrThrow({ where: { labId: "lab-neuroimmune", active: true }, orderBy: { id: "asc" } });
  for (const selected of animals) usedAnimals.add(selected.id);
  const requestId = `m16-transfer-${randomUUID()}`;
  const packetHash = createHash("sha256").update(requestId).digest("hex");
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.labTransferRequest.create({ data: {
      id: requestId, subjectType: "animals", sourceLabId: "lab-microglia", destinationLabId: "lab-neuroimmune",
      destinationCageId: destinationCage.id,
      reason: "Synthetic controlled custody transfer.", requestedEffectiveAt: new Date(), status: "destination_accepted",
      packetVersion: 1, acceptedPacketVersion: 1, acceptedPacketHash: packetHash, requestedById: "user-lab-manager-qa",
      destinationDecisionById: "user-facility-admin-qa", destinationDecisionAt: new Date(),
    } });
    await tx.labTransferItem.createMany({ data: animals.map((selected) => ({ id: `m16-transfer-item-${randomUUID()}`, requestId, animalId: selected.id, sourceCageId: selected.currentCageId })) });
    await tx.labTransferPacket.create({ data: { id: `m16-transfer-packet-${randomUUID()}`, requestId, version: 1, destinationPayload: { healthStatus: "synthetic-compatible", quarantineRequired: true }, payloadHash: packetHash, createdById: "user-lab-manager-qa" } });
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
  });
  return { requestId, animal, animals };
}

async function markTransferFinalized(requestId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.labTransferRequest.update({ where: { id: requestId }, data: { status: "finalized", finalizedById: "user-facility-admin-qa", finalizedAt: new Date(), version: { increment: 1 } } });
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
  });
}

describe.sequential("M16 census and custody adversarial contracts", () => {
  it("keeps census findings append-only, owner-resolved, independently signed off, and leaves expired capacity evidence inactive", async () => {
    const manager = await labActor("user-lab-manager-qa", "lab-microglia");
    const owner = await labActor("user-lab-owner-qa", "lab-microglia");
    const approver = await systemActor("user-facility-admin-approver-qa");
    const room = await prisma.room.findFirstOrThrow();
    const started = await executeStartCensusSessionCommand({ actor: manager, ...identity("census-start"), command: { labId: "lab-microglia", roomId: room.id, ownerId: manager.id } });
    expect(started.ok).toBe(true);
    const censusId = resultValue<string>(started, "censusId");
    const observed = await executeRecordCensusObservationCommand({ actor: manager, sessionId: censusId, expectedVersion: 1, ...identity("census-observe"), observation: { observedIdentifier: `UNKNOWN-${randomUUID()}`, outcome: "unknown", discrepancyCodes: ["unknown"], operationalCondition: "Synthetic unknown cage identifier." } });
    expect(observed.ok).toBe(true);
    const discrepancy = await prisma.censusDiscrepancy.findFirstOrThrow({ where: { sessionId: censusId } });
    expect(discrepancy.ownerId).toBe(manager.id);
    expect(await executeResolveCensusDiscrepancyCommand({ actor: owner, discrepancyId: discrepancy.id, expectedVersion: 1, action: "resolve", reason: "Wrong person attempted resolution.", ...identity("wrong-owner") })).toMatchObject({ ok: false, code: "owner_required" });
    expect((await executeResolveCensusDiscrepancyCommand({ actor: manager, discrepancyId: discrepancy.id, expectedVersion: 1, action: "resolve", reason: "Assigned owner investigated synthetic identifier.", ...identity("owner-resolve") })).ok).toBe(true);
    expect(await executeResolveCensusDiscrepancyCommand({ actor: manager, discrepancyId: discrepancy.id, expectedVersion: 2, action: "sign_off", reason: "Self sign-off must fail.", ...identity("self-sign") })).toMatchObject({ ok: false });
    expect((await executeResolveCensusDiscrepancyCommand({ actor: approver, discrepancyId: discrepancy.id, expectedVersion: 2, action: "sign_off", reason: "Independent synthetic review completed.", ...identity("independent-sign") })).ok).toBe(true);
    expect((await executeAdvanceCensusSessionCommand({ actor: manager, sessionId: censusId, expectedVersion: 2, action: "submit_review", ...identity("census-review") })).ok).toBe(true);
    expect((await executeAdvanceCensusSessionCommand({ actor: approver, sessionId: censusId, expectedVersion: 3, action: "sign_off", ...identity("census-signoff") })).ok).toBe(true);
    expect(await prisma.censusObservation.count({ where: { sessionId: censusId } })).toBe(1);

    const cage = await prisma.cage.findFirstOrThrow({ where: { labId: "lab-microglia", active: true } });
    const expired = await executeGrantCapacityExceptionCommand({ actor: approver, ...identity("expired-capacity"), command: { cageId: cage.id, additionalCapacity: 1, startsAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), expiresAt: new Date(Date.now() - 3_600_000).toISOString(), reason: "Synthetic elapsed exception window." } });
    expect(expired.ok).toBe(true);
    const workspace = await getReconciliationWorkspace(approver);
    expect(workspace.capacityExceptions.find((row) => row.id === resultValue<string>(expired, "exceptionId"))?.current).toBe(false);
  }, 120_000);

  it("requires census signer independence from starter, owner, observers, and discrepancy resolvers", async () => {
    const manager = await labActor("user-lab-manager-qa", "lab-microglia");
    const admin1 = await systemActor("user-facility-admin-qa");
    const admin2 = await systemActor("user-facility-admin-approver-qa");
    const cage = await prisma.cage.findFirstOrThrow({ where: { labId: "lab-microglia", active: true }, include: { animals: { where: { outcomeStatus: "alive" }, select: { sex: true } } } });
    const roomId = cage.roomId;
    const review = async (sessionId: string, version: number) => {
      const result = await executeAdvanceCensusSessionCommand({ actor: manager, sessionId, expectedVersion: version, action: "submit_review", ...identity("independence-review") });
      expect(result.ok).toBe(true);
      return version + 1;
    };

    const startedByAdmin = await executeStartCensusSessionCommand({ actor: admin1, ...identity("starter-overlap"), command: { labId: "lab-microglia", roomId, ownerId: manager.id } });
    const starterSession = resultValue<string>(startedByAdmin, "censusId");
    const starterVersion = await review(starterSession, 1);
    await expect(prisma.$transaction(async (tx) => {
      const receiptId = `census-db-independence-${randomUUID()}`;
      await tx.commandReceipt.create({ data: { id: receiptId, actorId: admin1.id, actorAuthzVersion: admin1.authzVersion, labId: "lab-microglia", commandType: "m16.census.sign_off", idempotencyKey: `db-independence-${randomUUID()}`, requestHash: `db-independence-hash-${randomUUID()}`, requestId: `db-independence-request-${randomUUID()}`, status: "processing", aggregateType: "census_session", aggregateId: starterSession } });
      await tx.$queryRaw(Prisma.sql`SELECT set_config('mcm.reconciliation_receipt_id', ${receiptId}, true), set_config('mcm.reconciliation_actor_id', ${admin1.id}, true), set_config('mcm.reconciliation_command_type', 'm16.census.sign_off', true)`);
      await tx.censusSession.update({ where: { id: starterSession }, data: { status: "signed_off", signedOffById: admin1.id, signedOffAt: new Date(), version: { increment: 1 } } });
    })).rejects.toThrow(/Census signer must be independent/i);
    expect(await prisma.censusSession.findUniqueOrThrow({ where: { id: starterSession } })).toMatchObject({ status: "review", version: starterVersion });
    expect(await executeAdvanceCensusSessionCommand({ actor: admin1, sessionId: starterSession, expectedVersion: starterVersion, action: "sign_off", ...identity("starter-denied") })).toMatchObject({ ok: false, code: "independence_required" });
    expect((await executeAdvanceCensusSessionCommand({ actor: admin2, sessionId: starterSession, expectedVersion: starterVersion, action: "sign_off", ...identity("starter-independent") })).ok).toBe(true);

    const ownedByAdmin = await executeStartCensusSessionCommand({ actor: manager, ...identity("owner-overlap"), command: { labId: "lab-microglia", roomId, ownerId: admin1.id } });
    const ownerSession = resultValue<string>(ownedByAdmin, "censusId");
    const ownerVersion = await review(ownerSession, 1);
    expect(await executeAdvanceCensusSessionCommand({ actor: admin1, sessionId: ownerSession, expectedVersion: ownerVersion, action: "sign_off", ...identity("owner-denied") })).toMatchObject({ ok: false, code: "independence_required" });
    expect((await executeAdvanceCensusSessionCommand({ actor: admin2, sessionId: ownerSession, expectedVersion: ownerVersion, action: "sign_off", ...identity("owner-independent") })).ok).toBe(true);

    const observedByAdmin = await executeStartCensusSessionCommand({ actor: manager, ...identity("observer-overlap"), command: { labId: "lab-microglia", roomId, ownerId: manager.id } });
    const observerSession = resultValue<string>(observedByAdmin, "censusId");
    const male = cage.animals.filter((animal) => animal.sex === "male").length;
    const female = cage.animals.filter((animal) => animal.sex === "female").length;
    expect((await executeRecordCensusObservationCommand({ actor: admin1, sessionId: observerSession, expectedVersion: 1, ...identity("observer-record"), observation: { cageId: cage.id, observedIdentifier: cage.barcode, observedLiveCount: cage.animals.length, observedMaleCount: male, observedFemaleCount: female, outcome: "matched" } })).ok).toBe(true);
    const observerVersion = await review(observerSession, 2);
    expect(await executeAdvanceCensusSessionCommand({ actor: admin1, sessionId: observerSession, expectedVersion: observerVersion, action: "sign_off", ...identity("observer-denied") })).toMatchObject({ ok: false, code: "independence_required" });
    expect((await executeAdvanceCensusSessionCommand({ actor: admin2, sessionId: observerSession, expectedVersion: observerVersion, action: "sign_off", ...identity("observer-independent") })).ok).toBe(true);

    const resolvedByAdmin = await executeStartCensusSessionCommand({ actor: manager, ...identity("resolver-overlap"), command: { labId: "lab-microglia", roomId, ownerId: admin1.id } });
    const resolverSession = resultValue<string>(resolvedByAdmin, "censusId");
    expect((await executeRecordCensusObservationCommand({ actor: manager, sessionId: resolverSession, expectedVersion: 1, ...identity("resolver-observe"), observation: { observedIdentifier: `UNKNOWN-${randomUUID()}`, outcome: "unknown", discrepancyCodes: ["unknown"], operationalCondition: "Synthetic resolver-overlap discrepancy." } })).ok).toBe(true);
    const discrepancy = await prisma.censusDiscrepancy.findFirstOrThrow({ where: { sessionId: resolverSession } });
    expect((await executeResolveCensusDiscrepancyCommand({ actor: admin1, discrepancyId: discrepancy.id, expectedVersion: 1, action: "resolve", reason: "Synthetic resolver investigated evidence.", ...identity("resolver-resolve") })).ok).toBe(true);
    expect((await executeResolveCensusDiscrepancyCommand({ actor: admin2, discrepancyId: discrepancy.id, expectedVersion: 2, action: "sign_off", reason: "Independent discrepancy sign-off.", ...identity("resolver-discrepancy-sign") })).ok).toBe(true);
    const resolverVersion = await review(resolverSession, 2);
    expect(await executeAdvanceCensusSessionCommand({ actor: admin1, sessionId: resolverSession, expectedVersion: resolverVersion, action: "sign_off", ...identity("resolver-denied") })).toMatchObject({ ok: false, code: "independence_required" });
    expect((await executeAdvanceCensusSessionCommand({ actor: admin2, sessionId: resolverSession, expectedVersion: resolverVersion, action: "sign_off", ...identity("resolver-independent") })).ok).toBe(true);
  }, 120_000);

  it("enforces the census room/outcome matrix at application and database boundaries", async () => {
    const manager = await labActor("user-lab-manager-qa", "lab-microglia");
    const rooms = await prisma.room.findMany({ orderBy: { id: "asc" }, take: 2 });
    expect(rooms).toHaveLength(2);
    const referenceCage = await prisma.cage.findFirstOrThrow({ where: { labId: "lab-microglia" } });
    const sameRoomCageId = `m16-census-same-${randomUUID()}`;
    const otherRoomCageId = `m16-census-other-${randomUUID()}`;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.cage.createMany({ data: [
        { id: sameRoomCageId, facilityCageId: "9995", labId: "lab-microglia", roomId: rooms[0]!.id, rackId: referenceCage.rackId, cageNumber: `M16-S-${randomUUID().slice(0, 6)}`, barcode: `M16-SAME-${randomUUID()}`, status: "active", active: true },
        { id: otherRoomCageId, facilityCageId: "9994", labId: "lab-microglia", roomId: rooms[1]!.id, rackId: referenceCage.rackId, cageNumber: `M16-O-${randomUUID().slice(0, 6)}`, barcode: `M16-OTHER-${randomUUID()}`, status: "active", active: true },
      ] });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });
    const [sameRoomCage, otherRoomCage] = await Promise.all([
      prisma.cage.findUniqueOrThrow({ where: { id: sameRoomCageId } }),
      prisma.cage.findUniqueOrThrow({ where: { id: otherRoomCageId } }),
    ]);
    const started = await executeStartCensusSessionCommand({ actor: manager, ...identity("location-session"), command: { labId: "lab-microglia", roomId: rooms[0]!.id, ownerId: manager.id } });
    const sessionId = resultValue<string>(started, "censusId");
    const countBefore = await prisma.censusObservation.count({ where: { sessionId } });

    expect(await executeRecordCensusObservationCommand({ actor: manager, sessionId, expectedVersion: 1, ...identity("wrong-room-count"), observation: {
      observedIdentifier: otherRoomCage.barcode, cageId: otherRoomCage.id, outcome: "count_mismatch", observedLiveCount: 0, discrepancyCodes: ["count"], operationalCondition: "Synthetic count mismatch in another room.",
    } })).toMatchObject({ ok: false, code: "location_outcome_mismatch" });
    expect(await executeRecordCensusObservationCommand({ actor: manager, sessionId, expectedVersion: 1, ...identity("same-room-location"), observation: {
      observedIdentifier: sameRoomCage.barcode, cageId: sameRoomCage.id, outcome: "wrong_location", discrepancyCodes: ["wrong_location"], operationalCondition: "Synthetic same-room wrong-location claim.",
    } })).toMatchObject({ ok: false, code: "location_outcome_mismatch" });
    expect(await prisma.censusObservation.count({ where: { sessionId } })).toBe(countBefore);
    expect(await prisma.censusSession.findUniqueOrThrow({ where: { id: sessionId } })).toMatchObject({ version: 1 });

    expect((await executeRecordCensusObservationCommand({ actor: manager, sessionId, expectedVersion: 1, ...identity("correct-wrong-location"), observation: {
      observedIdentifier: otherRoomCage.barcode, cageId: otherRoomCage.id, outcome: "wrong_location", discrepancyCodes: ["wrong_location"], operationalCondition: "Synthetic authorized cage observed outside the session room.",
    } })).ok).toBe(true);
    expect((await executeRecordCensusObservationCommand({ actor: manager, sessionId, expectedVersion: 2, ...identity("correct-empty"), observation: {
      observedIdentifier: sameRoomCage.barcode, cageId: sameRoomCage.id, outcome: "empty", observedLiveCount: 0, discrepancyCodes: ["empty"], operationalCondition: "Synthetic empty cage in the session room.",
    } })).ok).toBe(true);

    const rawCases = [
      { name: "wrong-room count_mismatch", cage: otherRoomCage, outcome: "count_mismatch" },
      { name: "same-room wrong_location", cage: sameRoomCage, outcome: "wrong_location" },
    ] as const;
    for (const rawCase of rawCases) {
      const receiptId = `census-location-${randomUUID()}`;
      await expect(prisma.$transaction(async (tx) => {
        await tx.commandReceipt.create({ data: { id: receiptId, actorId: manager.id, actorAuthzVersion: manager.authzVersion, labId: "lab-microglia", commandType: "m16.census.observe", idempotencyKey: `location-${randomUUID()}`, requestHash: `location-hash-${randomUUID()}`, requestId: `location-request-${randomUUID()}`, status: "processing", aggregateType: "census_session", aggregateId: sessionId } });
        await tx.$queryRaw(Prisma.sql`SELECT set_config('mcm.reconciliation_receipt_id', ${receiptId}, true), set_config('mcm.reconciliation_actor_id', ${manager.id}, true), set_config('mcm.reconciliation_command_type', 'm16.census.observe', true)`);
        await tx.censusObservation.create({ data: { id: `raw-location-${randomUUID()}`, sessionId, labId: "lab-microglia", cageId: rawCase.cage.id, observedIdentifier: rawCase.cage.barcode, outcome: rawCase.outcome, discrepancyCodes: [rawCase.outcome], operationalCondition: `Rejected ${rawCase.name}.`, observedById: manager.id, commandReceiptId: receiptId } });
      })).rejects.toThrow(/exact session room|outside the session room/i);
      expect(await prisma.commandReceipt.findUnique({ where: { id: receiptId } })).toBeNull();
    }
  }, 120_000);

  it("records idempotent dispatch and cancellation without changing transfer or colony truth", async () => {
    const facility = await systemActor("user-facility-admin-qa");
    const fixture = await seedAcceptedTransferFixture();
    const before = await prisma.animal.findUniqueOrThrow({ where: { id: fixture.animal.id }, select: { owningLabId: true, currentCageId: true } });
    const commandIdentity = identity("custody-dispatch-replay");
    const dispatched = await executeDispatchTransferCustodyCommand({ actor: facility, transferRequestId: fixture.requestId, expectedVersion: 1, ...commandIdentity });
    expect(dispatched.ok).toBe(true);
    expect((await executeDispatchTransferCustodyCommand({ actor: facility, transferRequestId: fixture.requestId, expectedVersion: 1, ...commandIdentity })).ok).toBe(true);
    expect(await prisma.transferCustodyEvent.count({ where: { requestId: fixture.requestId, eventType: "dispatched" } })).toBe(1);
    expect(await executeDispatchTransferCustodyCommand({ actor: facility, transferRequestId: fixture.requestId, expectedVersion: 2, ...identity("stale-dispatch") })).toMatchObject({ ok: false, code: "stale_conflict" });
    expect((await executeCancelTransferDispatchCommand({ actor: facility, transferRequestId: fixture.requestId, expectedVersion: 1, reason: "Synthetic dispatch cancelled before movement.", ...identity("cancel-dispatch") })).ok).toBe(true);
    expect(await prisma.animal.findUniqueOrThrow({ where: { id: fixture.animal.id }, select: { owningLabId: true, currentCageId: true } })).toEqual(before);
  }, 120_000);

  it("rolls back zero-item and partial-item forged dispatches against the exact two-animal active set", async () => {
    const facility = await systemActor("user-facility-admin-qa");
    const fixture = await seedAcceptedTransferFixture(2);
    const request = await prisma.labTransferRequest.findUniqueOrThrow({
      where: { id: fixture.requestId },
      include: { items: { where: { active: true }, include: { animal: true } }, packets: { orderBy: { version: "desc" }, take: 1 } },
    });
    expect(request.items).toHaveLength(2);
    const packet = request.packets[0]!;
    const receiptIds: string[] = [];

    for (const forgedCount of [0, 1]) {
      const receiptId = `forged-dispatch-receipt-${randomUUID()}`;
      const custodyEventId = `forged-dispatch-${randomUUID()}`;
      const requestHash = `forged-dispatch-hash-${randomUUID()}`;
      receiptIds.push(receiptId);
      await expect(prisma.$transaction(async (tx) => {
        await tx.commandReceipt.create({ data: {
          id: receiptId, actorId: facility.id, actorAuthzVersion: facility.authzVersion, labId: request.sourceLabId,
          commandType: "m16.transfer.dispatch", idempotencyKey: `forged-dispatch-${randomUUID()}`,
          requestHash, requestId: `forged-dispatch-request-${randomUUID()}`,
          status: "processing", aggregateType: "lab_transfer_request", aggregateId: request.id,
        } });
        await setM16Context(tx, { receiptId, actorId: facility.id, commandType: "m16.transfer.dispatch" });
        await tx.$queryRaw(Prisma.sql`SELECT
          set_config('mcm.audit_receipt_id', ${receiptId}, true),
          set_config('mcm.audit_actor_id', ${facility.id}, true),
          set_config('mcm.audit_command_type', 'm16.transfer.dispatch', true),
          set_config('mcm.audit_request_hash', ${requestHash}, true)
        `);
        await tx.transferCustodyEvent.create({ data: {
          id: custodyEventId, requestId: request.id, sourceLabId: request.sourceLabId, destinationLabId: request.destinationLabId,
          packetVersion: packet.version, packetHash: packet.payloadHash, eventType: "dispatched",
          expectedItemCount: forgedCount, observedItemCount: forgedCount,
          operationalFacts: { policyMarker: "synthetic-fail-closed-m16", quarantineRequired: true },
          actorId: facility.id, actorLabId: request.sourceLabId, commandReceiptId: receiptId,
        } });
        if (forgedCount === 1) {
          const item = request.items[0]!;
          await tx.transferCustodyExpectedItem.create({ data: {
            id: `forged-expected-${randomUUID()}`, custodyEventId, requestId: request.id,
            transferItemId: item.id, animalId: item.animalId, frozenIdentifier: item.animal.facilityAnimalId,
          } });
        }
        await appendLifecycleEvent(tx, {
          actor: facility, receiptId, domain: "transfer_custody", aggregateType: "lab_transfer_request", aggregateId: request.id,
          labId: request.sourceLabId, eventType: "dispatched", previousStatus: request.status, resultingStatus: request.status,
          evidence: { custodyEventId, packetVersion: packet.version, packetHash: packet.payloadHash, expectedItemCount: forgedCount, policyMarker: "synthetic-fail-closed-m16" },
        });
        await tx.commandReceipt.update({ where: { id: receiptId }, data: {
          status: "succeeded", completedAt: new Date(), resultingVersion: request.version, result: { custodyEventId, forgedCount },
        } });
        await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      })).rejects.toThrow(/expected-item set must exactly match the active transfer item count/i);

      expect(await prisma.commandReceipt.findUnique({ where: { id: receiptId } })).toBeNull();
      expect(await prisma.operationalReconciliationEvent.count({ where: { commandReceiptId: receiptId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { commandReceiptId: receiptId } })).toBe(0);
      expect(await prisma.transferCustodyEvent.count({ where: { id: custodyEventId } })).toBe(0);
      expect(await prisma.transferCustodyExpectedItem.count({ where: { custodyEventId } })).toBe(0);
      expect(await prisma.transferCustodyItemEvidence.count({ where: { custodyEventId } })).toBe(0);
    }
    expect(await prisma.transferCustodyEvent.count({ where: { requestId: request.id } })).toBe(0);
    expect(await prisma.transferCustodyExpectedItem.count({ where: { requestId: request.id } })).toBe(0);
    expect(await prisma.transferCustodyItemEvidence.count({ where: { requestId: request.id } })).toBe(0);
    expect(receiptIds).toHaveLength(2);
  }, 120_000);

  it("rejects the custody item matrix: null animal, wrong item/request/animal/frozen identifier, and omitted evidence", async () => {
    const facility = await systemActor("user-facility-admin-qa");
    const fixture = await seedAcceptedTransferFixture();
    const otherFixture = await seedAcceptedTransferFixture();
    expect((await executeDispatchTransferCustodyCommand({ actor: facility, transferRequestId: fixture.requestId, expectedVersion: 1, ...identity("matrix-dispatch-a") })).ok).toBe(true);
    expect((await executeDispatchTransferCustodyCommand({ actor: facility, transferRequestId: otherFixture.requestId, expectedVersion: 1, ...identity("matrix-dispatch-b") })).ok).toBe(true);
    await markTransferFinalized(fixture.requestId);
    const [request, dispatch, otherDispatch] = await Promise.all([
      prisma.labTransferRequest.findUniqueOrThrow({ where: { id: fixture.requestId } }),
      prisma.transferCustodyEvent.findFirstOrThrow({ where: { requestId: fixture.requestId, eventType: "dispatched" }, include: { expectedItems: true } }),
      prisma.transferCustodyEvent.findFirstOrThrow({ where: { requestId: otherFixture.requestId, eventType: "dispatched" }, include: { expectedItems: true } }),
    ]);
    expect(dispatch.expectedItems).toHaveLength(1);
    expect(otherDispatch.expectedItems).toHaveLength(1);
    const expected = dispatch.expectedItems[0]!;
    const otherExpected = otherDispatch.expectedItems[0]!;
    const before = await Promise.all([
      prisma.transferCustodyEvent.count({ where: { requestId: fixture.requestId } }),
      prisma.transferCustodyItemEvidence.count({ where: { requestId: fixture.requestId } }),
    ]);

    const createTerminalEvent = async (tx: Prisma.TransactionClient, receiptId: string) => {
      await tx.commandReceipt.create({ data: {
        id: receiptId, actorId: facility.id, actorAuthzVersion: facility.authzVersion, labId: request.destinationLabId,
        commandType: "m16.transfer.receive", idempotencyKey: `custody-matrix-${randomUUID()}`, requestHash: `custody-matrix-hash-${randomUUID()}`,
        requestId: `custody-matrix-request-${randomUUID()}`, status: "processing", aggregateType: "lab_transfer_request", aggregateId: request.id,
      } });
      await tx.$queryRaw(Prisma.sql`SELECT set_config('mcm.reconciliation_receipt_id', ${receiptId}, true), set_config('mcm.reconciliation_actor_id', ${facility.id}, true), set_config('mcm.reconciliation_command_type', 'm16.transfer.receive', true)`);
      return tx.transferCustodyEvent.create({ data: {
        id: `custody-matrix-event-${randomUUID()}`, requestId: request.id, sourceLabId: request.sourceLabId, destinationLabId: request.destinationLabId,
        packetVersion: dispatch.packetVersion, packetHash: dispatch.packetHash, eventType: "partial_failure", expectedItemCount: 1, observedItemCount: 0,
        operationalFacts: { policyMarker: "synthetic-fail-closed-m16", healthStatus: "Synthetic matrix evidence" }, actorId: facility.id,
        actorLabId: request.destinationLabId, commandReceiptId: receiptId,
      } });
    };

    const variants = [
      { name: "null animal", expectedItemId: expected.id, requestId: request.id, animalId: null, identifier: expected.frozenIdentifier, pattern: /exact frozen dispatched transfer item|null value in column "animalId"|not-null/i },
      { name: "wrong expected item", expectedItemId: otherExpected.id, requestId: request.id, animalId: otherExpected.animalId, identifier: otherExpected.frozenIdentifier, pattern: /exact frozen dispatched transfer item/i },
      { name: "wrong request", expectedItemId: otherExpected.id, requestId: otherFixture.requestId, animalId: otherExpected.animalId, identifier: otherExpected.frozenIdentifier, pattern: /exact frozen dispatched transfer item/i },
      { name: "wrong animal", expectedItemId: expected.id, requestId: request.id, animalId: otherExpected.animalId, identifier: expected.frozenIdentifier, pattern: /exact frozen dispatched transfer item/i },
      { name: "wrong frozen identifier", expectedItemId: expected.id, requestId: request.id, animalId: expected.animalId, identifier: `${expected.frozenIdentifier}-forged`, pattern: /exact frozen dispatched transfer item/i },
    ] as const;
    for (const variant of variants) {
      const receiptId = `custody-matrix-${randomUUID()}`;
      await expect(prisma.$transaction(async (tx) => {
        const event = await createTerminalEvent(tx, receiptId);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "TransferCustodyItemEvidence" (id, "custodyEventId", "requestId", "expectedItemId", "animalId", "expectedIdentifier", outcome, "operationalCondition")
          VALUES (${`custody-matrix-item-${randomUUID()}`}, ${event.id}, ${variant.requestId}, ${variant.expectedItemId}, ${variant.animalId}, ${variant.identifier}, 'missing', ${`Rejected ${variant.name}.`})
        `);
      })).rejects.toThrow(variant.pattern);
      expect(await prisma.commandReceipt.findUnique({ where: { id: receiptId } })).toBeNull();
    }

    const omissionReceiptId = `custody-matrix-omission-${randomUUID()}`;
    await expect(prisma.$transaction(async (tx) => {
      await createTerminalEvent(tx, omissionReceiptId);
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    })).rejects.toThrow(/Destination custody item evidence must exactly match event counts/i);
    expect(await prisma.commandReceipt.findUnique({ where: { id: omissionReceiptId } })).toBeNull();
    expect(await Promise.all([
      prisma.transferCustodyEvent.count({ where: { requestId: fixture.requestId } }),
      prisma.transferCustodyItemEvidence.count({ where: { requestId: fixture.requestId } }),
    ])).toEqual(before);
  }, 120_000);

  it("records partial destination failure, rejects identifier/private-packet attacks, and requires independent reconciliation sign-off", async () => {
    const facility = await systemActor("user-facility-admin-qa");
    const approver = await systemActor("user-facility-admin-approver-qa");
    const fixture = await seedAcceptedTransferFixture();
    expect((await executeDispatchTransferCustodyCommand({ actor: facility, transferRequestId: fixture.requestId, expectedVersion: 1, ...identity("partial-dispatch") })).ok).toBe(true);
    await markTransferFinalized(fixture.requestId);
    const facts = { healthStatus: "Synthetic compatible", quarantineStatus: "Destination quarantine required", licenceStatus: "Synthetic authorization checked", safetyStatus: "Synthetic safety reviewed" };
    expect(await executeReceiveTransferCustodyCommand({ actor: facility, transferRequestId: fixture.requestId, expectedVersion: 2, operationalFacts: { ...facts, sourcePrivateNote: "must not travel" }, items: [{ animalId: fixture.animal.id, expectedIdentifier: fixture.animal.facilityAnimalId, outcome: "missing", operationalCondition: "Synthetic item missing at destination." }], ...identity("private-packet") })).toMatchObject({ ok: false, code: "private_data_block" });
    expect(await executeReceiveTransferCustodyCommand({ actor: facility, transferRequestId: fixture.requestId, expectedVersion: 2, operationalFacts: facts, items: [{ animalId: fixture.animal.id, expectedIdentifier: `${fixture.animal.facilityAnimalId}-wrong`, outcome: "missing", operationalCondition: "Synthetic identifier mismatch." }], ...identity("identifier-mismatch") })).toMatchObject({ ok: false, code: "identifier_mismatch" });
    const before = await prisma.animal.findUniqueOrThrow({ where: { id: fixture.animal.id }, select: { owningLabId: true, currentCageId: true } });
    const received = await executeReceiveTransferCustodyCommand({ actor: facility, transferRequestId: fixture.requestId, expectedVersion: 2, operationalFacts: facts, items: [{ animalId: fixture.animal.id, expectedIdentifier: fixture.animal.facilityAnimalId, outcome: "missing", operationalCondition: "Synthetic item missing at destination." }], ...identity("partial-receipt") });
    expect(received.ok).toBe(true);
    expect(resultValue(received, "eventType")).toBe("partial_failure");
    expect(await prisma.animal.findUniqueOrThrow({ where: { id: fixture.animal.id }, select: { owningLabId: true, currentCageId: true } })).toEqual(before);
    const reconciliation = await prisma.transferCustodyReconciliation.findFirstOrThrow({ where: { requestId: fixture.requestId } });
    expect((await executeResolveTransferCustodyReconciliationCommand({ actor: facility, reconciliationId: reconciliation.id, expectedVersion: 1, action: "resolve", reason: "Assigned custody owner investigated the missing item.", ...identity("custody-resolve") })).ok).toBe(true);
    expect(await executeResolveTransferCustodyReconciliationCommand({ actor: facility, reconciliationId: reconciliation.id, expectedVersion: 2, action: "sign_off", reason: "Self sign-off denied.", ...identity("custody-self") })).toMatchObject({ ok: false, code: "independence_required" });
    expect((await executeResolveTransferCustodyReconciliationCommand({ actor: approver, reconciliationId: reconciliation.id, expectedVersion: 2, action: "sign_off", reason: "Independent custody evidence review complete.", ...identity("custody-signoff") })).ok).toBe(true);
  }, 120_000);

  it("confirms a complete destination packet once and keeps unrelated labs blind", async () => {
    const facility = await systemActor("user-facility-admin-qa");
    const fixture = await seedAcceptedTransferFixture();
    await executeDispatchTransferCustodyCommand({ actor: facility, transferRequestId: fixture.requestId, expectedVersion: 1, ...identity("complete-dispatch") });
    await markTransferFinalized(fixture.requestId);
    const receivedIdentity = identity("complete-receipt");
    const receiptInput = { actor: facility, transferRequestId: fixture.requestId, expectedVersion: 2, operationalFacts: { healthStatus: "Synthetic compatible", quarantineStatus: "Destination quarantine required", licenceStatus: "Synthetic authorization checked", safetyStatus: "Synthetic safety reviewed" }, items: [{ animalId: fixture.animal.id, expectedIdentifier: fixture.animal.facilityAnimalId, observedIdentifier: fixture.animal.facilityAnimalId, outcome: "received" as const }], ...receivedIdentity };
    expect((await executeReceiveTransferCustodyCommand(receiptInput)).ok).toBe(true);
    expect((await executeReceiveTransferCustodyCommand(receiptInput)).ok).toBe(true);
    expect(await prisma.transferCustodyEvent.count({ where: { requestId: fixture.requestId, eventType: "destination_received" } })).toBe(1);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.lab.create({ data: { id: "lab-m16-unrelated", code: "M16U", name: "M16 unrelated synthetic lab" } });
      await tx.labMembership.create({ data: { id: `m16-unrelated-membership-${randomUUID()}`, labId: "lab-m16-unrelated", userId: "user-lab-staff-qa", role: "manager" } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });
    const unrelated = await labActor("user-lab-staff-qa", "lab-m16-unrelated");
    expect((await getReconciliationWorkspace(unrelated)).custodyEvents.some((event) => event.requestId === fixture.requestId)).toBe(false);
    expect(await executeDispatchTransferCustodyCommand({ actor: unrelated, transferRequestId: fixture.requestId, expectedVersion: 2, ...identity("unrelated-direct") })).toMatchObject({ ok: false, code: "not_found" });
  }, 120_000);

  it("rejects same-receipt wrong-parent and cross-lab M16 associations atomically", async () => {
    const manager = await labActor("user-lab-manager-qa", "lab-microglia");
    const facility = await systemActor("user-facility-admin-qa");
    const receipts: string[] = [];
    const createReceipt = async (tx: Prisma.TransactionClient, input: { actor: ResolvedActor; labId: string; commandType: string; aggregateType: string; aggregateId: string }) => {
      const id = `association-receipt-${randomUUID()}`;
      receipts.push(id);
      await tx.commandReceipt.create({ data: {
        id, actorId: input.actor.id, actorAuthzVersion: input.actor.authzVersion, labId: input.labId,
        commandType: input.commandType, idempotencyKey: `association-${randomUUID()}`, requestHash: `association-hash-${randomUUID()}`,
        requestId: `association-request-${randomUUID()}`, status: "processing", aggregateType: input.aggregateType, aggregateId: input.aggregateId,
      } });
      await tx.$queryRaw(Prisma.sql`SELECT set_config('mcm.reconciliation_receipt_id', ${id}, true), set_config('mcm.reconciliation_actor_id', ${input.actor.id}, true), set_config('mcm.reconciliation_command_type', ${input.commandType}, true)`);
      return id;
    };

    // Association matrix: manifest↔protocol lab, census room↔facility and cage↔lab,
    // discrepancy↔observation/session, capacity↔cage/lab, custody event↔transfer labs,
    // and reconciliation↔terminal event/request/destination lab.
    const foreignProtocol = await prisma.protocolAuthorization.findFirstOrThrow({ where: { labId: "lab-neuroimmune" } });
    const manifestId = `wrong-protocol-manifest-${randomUUID()}`;
    await expect(prisma.$transaction(async (tx) => {
      await createReceipt(tx, { actor: manager, labId: "lab-microglia", commandType: "m16.shipment.create", aggregateType: "shipment_manifest", aggregateId: manifestId });
      await tx.shipmentManifest.create({ data: {
        id: manifestId, labId: "lab-microglia", sourceType: "vendor", sourceName: "Synthetic matrix vendor", externalReference: `MATRIX-${randomUUID()}`,
        expectedAt: new Date(), protocolAuthorizationId: foreignProtocol.id, createdById: manager.id,
      } });
    })).rejects.toThrow(/protocol must belong to the exact receiving lab/i);

    const room = await prisma.room.findFirstOrThrow();
    const censusId = `wrong-room-facility-${randomUUID()}`;
    await expect(prisma.$transaction(async (tx) => {
      await createReceipt(tx, { actor: manager, labId: "lab-microglia", commandType: "m16.census.start", aggregateType: "census_session", aggregateId: censusId });
      await tx.censusSession.create({ data: { id: censusId, labId: "lab-microglia", facilityId: "facility-wrong-parent", roomId: room.id, ownerId: manager.id, startedById: manager.id } });
    })).rejects.toThrow(/room must belong to the exact facility/i);

    const observations = await prisma.censusObservation.findMany({ orderBy: { observedAt: "asc" } });
    const firstObservation = observations.find((row) => observations.some((candidate) => candidate.sessionId !== row.sessionId));
    const wrongSessionObservation = firstObservation && observations.find((row) => row.sessionId !== firstObservation.sessionId);
    expect(firstObservation).toBeTruthy();
    expect(wrongSessionObservation).toBeTruthy();
    const discrepancyCount = await prisma.censusDiscrepancy.count();
    await expect(prisma.$transaction(async (tx) => {
      const receiptId = await createReceipt(tx, { actor: manager, labId: "lab-microglia", commandType: "m16.census.observe", aggregateType: "census_session", aggregateId: wrongSessionObservation!.sessionId });
      await tx.censusDiscrepancy.create({ data: {
        id: `wrong-census-parent-${randomUUID()}`, sessionId: wrongSessionObservation!.sessionId, observationId: firstObservation!.id,
        labId: "lab-microglia", discrepancyType: "unknown", ownerId: manager.id,
      } });
      return receiptId;
    })).rejects.toThrow(/session, observation, and lab must be the exact same evidence/i);
    expect(await prisma.censusDiscrepancy.count()).toBe(discrepancyCount);

    const foreignCage = await prisma.cage.findFirstOrThrow({ where: { labId: "lab-neuroimmune" } });
    await expect(prisma.$transaction(async (tx) => {
      const receiptId = await createReceipt(tx, { actor: manager, labId: "lab-microglia", commandType: "m16.census.observe", aggregateType: "census_session", aggregateId: firstObservation!.sessionId });
      await tx.censusObservation.create({ data: {
        id: `wrong-census-cage-${randomUUID()}`, sessionId: firstObservation!.sessionId, labId: "lab-microglia", cageId: foreignCage.id,
        observedIdentifier: foreignCage.barcode, outcome: "empty", discrepancyCodes: ["empty"], operationalCondition: "Synthetic cross-lab census cage.",
        observedById: manager.id, commandReceiptId: receiptId,
      } });
    })).rejects.toThrow(/Census cage must belong to the exact census lab/i);
    const capacityCount = await prisma.cageCapacityException.count();
    await expect(prisma.$transaction(async (tx) => {
      const exceptionId = `wrong-capacity-lab-${randomUUID()}`;
      await createReceipt(tx, { actor: manager, labId: "lab-microglia", commandType: "m16.capacity.grant", aggregateType: "capacity_exception", aggregateId: exceptionId });
      await tx.cageCapacityException.create({ data: {
        id: exceptionId, cageId: foreignCage.id, labId: "lab-microglia", additionalCapacity: 1,
        reason: "Synthetic cross-lab capacity association must fail.", startsAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), approvedById: manager.id,
      } });
    })).rejects.toThrow(/Capacity exception cage must belong to the exact lab/i);
    expect(await prisma.cageCapacityException.count()).toBe(capacityCount);

    const terminalEvents = await prisma.transferCustodyEvent.findMany({
      where: { eventType: { in: ["destination_received", "partial_failure"] } }, orderBy: { occurredAt: "asc" },
    });
    const requestEvent = terminalEvents.find((row) => terminalEvents.some((candidate) => candidate.requestId !== row.requestId));
    const wrongCustodyEvent = requestEvent && terminalEvents.find((row) => row.requestId !== requestEvent.requestId);
    expect(requestEvent).toBeTruthy();
    expect(wrongCustodyEvent).toBeTruthy();
    const transferRequest = await prisma.labTransferRequest.findUniqueOrThrow({ where: { id: requestEvent!.requestId } });
    await expect(prisma.$transaction(async (tx) => {
      const receiptId = await createReceipt(tx, { actor: facility, labId: transferRequest.sourceLabId, commandType: "m16.transfer.dispatch", aggregateType: "lab_transfer_request", aggregateId: transferRequest.id });
      await tx.transferCustodyEvent.create({ data: {
        id: `wrong-custody-labs-${randomUUID()}`, requestId: transferRequest.id, sourceLabId: transferRequest.destinationLabId,
        destinationLabId: transferRequest.sourceLabId, packetVersion: wrongCustodyEvent!.packetVersion, packetHash: wrongCustodyEvent!.packetHash,
        eventType: "dispatched", expectedItemCount: 0, observedItemCount: 0, operationalFacts: { policyMarker: "synthetic-fail-closed-m16" },
        actorId: facility.id, actorLabId: transferRequest.sourceLabId, commandReceiptId: receiptId,
      } });
    })).rejects.toThrow(/must match the exact transfer source and destination labs/i);
    const reconciliationCount = await prisma.transferCustodyReconciliation.count();
    await expect(prisma.$transaction(async (tx) => {
      await createReceipt(tx, { actor: facility, labId: transferRequest.destinationLabId, commandType: "m16.transfer.receive", aggregateType: "lab_transfer_request", aggregateId: transferRequest.id });
      await tx.transferCustodyReconciliation.create({ data: {
        id: `wrong-transfer-parent-${randomUUID()}`, requestId: transferRequest.id, custodyEventId: wrongCustodyEvent!.id,
        labId: transferRequest.destinationLabId, ownerId: facility.id,
      } });
    })).rejects.toThrow(/event, request, and destination lab must be the exact same transfer/i);
    expect(await prisma.transferCustodyReconciliation.count()).toBe(reconciliationCount);

    for (const receiptId of receipts) {
      expect(await prisma.commandReceipt.findUnique({ where: { id: receiptId } })).toBeNull();
      expect(await prisma.operationalReconciliationEvent.count({ where: { commandReceiptId: receiptId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { commandReceiptId: receiptId } })).toBe(0);
    }
  }, 120_000);

  it("rejects wrong-command, wrong-aggregate, orphan-state, and late-omission direct SQL atomically", async () => {
    const manager = await labActor("user-lab-manager-qa", "lab-microglia");
    const room = await prisma.room.findFirstOrThrow();
    const started = await executeStartCensusSessionCommand({ actor: manager, ...identity("matrix-session"), command: { labId: "lab-microglia", roomId: room.id, ownerId: manager.id } });
    const censusId = resultValue<string>(started, "censusId");
    const receipt = async (tx: Prisma.TransactionClient, commandType: string, aggregateType: string, aggregateId: string) => {
      const id = `matrix-receipt-${randomUUID()}`;
      await tx.commandReceipt.create({ data: { id, actorId: manager.id, actorAuthzVersion: manager.authzVersion, labId: "lab-microglia", commandType, idempotencyKey: `matrix-${randomUUID()}`, requestHash: `matrix-hash-${randomUUID()}`, requestId: `matrix-request-${randomUUID()}`, status: "processing", aggregateType, aggregateId } });
      await tx.$queryRaw(Prisma.sql`SELECT set_config('mcm.reconciliation_receipt_id', ${id}, true), set_config('mcm.reconciliation_actor_id', ${manager.id}, true), set_config('mcm.reconciliation_command_type', ${commandType}, true)`);
      return id;
    };

    await expect(prisma.$transaction(async (tx) => {
      await receipt(tx, "m16.capacity.grant", "capacity_exception", `wrong-${randomUUID()}`);
      await tx.censusSession.update({ where: { id: censusId }, data: { version: { increment: 1 } } });
    })).rejects.toThrow(/cannot mutate CensusSession|exact/i);

    const wrongAggregateId = `wrong-census-${randomUUID()}`;
    await expect(prisma.$transaction(async (tx) => {
      await receipt(tx, "m16.census.submit_review", "census_session", wrongAggregateId);
      await tx.censusSession.update({ where: { id: censusId }, data: { status: "review", version: { increment: 1 } } });
    })).rejects.toThrow(/exact transition|aggregate/i);
    expect(await prisma.censusSession.findUniqueOrThrow({ where: { id: censusId } })).toMatchObject({ status: "in_progress", version: 1 });

    const orphanCensusId = `orphan-state-${randomUUID()}`;
    const orphanReceiptId = `orphan-receipt-${randomUUID()}`;
    await expect(prisma.$transaction(async (tx) => {
      await tx.commandReceipt.create({ data: { id: orphanReceiptId, actorId: manager.id, actorAuthzVersion: manager.authzVersion, labId: "lab-microglia", commandType: "m16.census.start", idempotencyKey: `orphan-${randomUUID()}`, requestHash: `orphan-hash-${randomUUID()}`, requestId: `orphan-request-${randomUUID()}`, status: "processing", aggregateType: "census_session", aggregateId: orphanCensusId } });
      await tx.$queryRaw(Prisma.sql`SELECT set_config('mcm.reconciliation_receipt_id', ${orphanReceiptId}, true), set_config('mcm.reconciliation_actor_id', ${manager.id}, true), set_config('mcm.reconciliation_command_type', 'm16.census.start', true)`);
      await tx.censusSession.create({ data: { id: orphanCensusId, labId: "lab-microglia", facilityId: room.facilityId, roomId: room.id, ownerId: manager.id, startedById: manager.id } });
      await tx.commandReceipt.update({ where: { id: orphanReceiptId }, data: { status: "succeeded", completedAt: new Date(), resultingVersion: 1, result: { forged: true } } });
    })).rejects.toThrow(/requires exactly one same-receipt lifecycle event|exact guarded state|state\/evidence requires exact deferred/i);
    expect(await prisma.censusSession.findUnique({ where: { id: orphanCensusId } })).toBeNull();
    expect(await prisma.commandReceipt.findUnique({ where: { id: orphanReceiptId } })).toBeNull();

    const lateCensusId = `late-omission-${randomUUID()}`;
    const lateReceiptId = `late-receipt-${randomUUID()}`;
    await expect(prisma.$transaction(async (tx) => {
      await tx.commandReceipt.create({ data: { id: lateReceiptId, actorId: manager.id, actorAuthzVersion: manager.authzVersion, labId: "lab-microglia", commandType: "m16.census.start", idempotencyKey: `late-${randomUUID()}`, requestHash: `late-hash-${randomUUID()}`, requestId: `late-request-${randomUUID()}`, status: "processing", aggregateType: "census_session", aggregateId: lateCensusId } });
      await tx.$queryRaw(Prisma.sql`SELECT set_config('mcm.reconciliation_receipt_id', ${lateReceiptId}, true), set_config('mcm.reconciliation_actor_id', ${manager.id}, true), set_config('mcm.reconciliation_command_type', 'm16.census.start', true)`);
      await tx.censusSession.create({ data: { id: lateCensusId, labId: "lab-microglia", facilityId: room.facilityId, roomId: room.id, ownerId: manager.id, startedById: manager.id } });
      await tx.operationalReconciliationEvent.create({ data: { id: `late-event-${randomUUID()}`, domain: "census", aggregateType: "census_session", aggregateId: lateCensusId, labId: "lab-microglia", eventType: "started", resultingStatus: "in_progress", actorId: manager.id, actorAuthzVersion: manager.authzVersion, actorRoleSnapshot: manager.canonicalRole, evidence: {}, commandReceiptId: lateReceiptId } });
      await tx.commandReceipt.update({ where: { id: lateReceiptId }, data: { status: "succeeded", completedAt: new Date(), resultingVersion: 1, result: { forged: true } } });
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    })).rejects.toThrow(/audit|pairing/i);
    expect(await prisma.censusSession.findUnique({ where: { id: lateCensusId } })).toBeNull();
    expect(await prisma.operationalReconciliationEvent.findFirst({ where: { commandReceiptId: lateReceiptId } })).toBeNull();
    expect(await prisma.commandReceipt.findUnique({ where: { id: lateReceiptId } })).toBeNull();
  }, 120_000);

  it("database-guards direct writes, retained evidence mutation, truncation, and exact lifecycle parity", async () => {
    const event = await prisma.operationalReconciliationEvent.findFirstOrThrow();
    const censusObservation = await prisma.censusObservation.findFirstOrThrow();
    const custodyEvent = await prisma.transferCustodyEvent.findFirstOrThrow();
    const custodyExpectedItem = await prisma.transferCustodyExpectedItem.findFirstOrThrow();
    const custodyItem = await prisma.transferCustodyItemEvidence.findFirstOrThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "CensusObservation" SET "observedIdentifier" = "observedIdentifier" || '-forged' WHERE id = '${censusObservation.id}'`)).rejects.toThrow(/append-only/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "TransferCustodyEvent" WHERE id = '${custodyEvent.id}'`)).rejects.toThrow(/append-only/i);
    await expect(prisma.$executeRawUnsafe(`UPDATE "TransferCustodyExpectedItem" SET "frozenIdentifier" = "frozenIdentifier" WHERE id = '${custodyExpectedItem.id}'`)).rejects.toThrow(/append-only/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "TransferCustodyExpectedItem" WHERE id = '${custodyExpectedItem.id}'`)).rejects.toThrow(/append-only/i);
    await expect(prisma.$executeRawUnsafe(`UPDATE "TransferCustodyItemEvidence" SET outcome = 'received' WHERE id = '${custodyItem.id}'`)).rejects.toThrow(/append-only/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "OperationalReconciliationEvent" WHERE id = '${event.id}'`)).rejects.toThrow(/append-only/i);
    await expect(prisma.$executeRawUnsafe("TRUNCATE TABLE \"CensusObservation\"")).rejects.toThrow(/cannot truncate|cannot be truncated/i);
    await expect(prisma.$executeRawUnsafe("TRUNCATE TABLE \"TransferCustodyExpectedItem\" CASCADE")).rejects.toThrow(/cannot truncate|cannot be truncated/i);
    await expect(prisma.$executeRawUnsafe("TRUNCATE TABLE \"TransferCustodyEvent\" CASCADE")).rejects.toThrow(/cannot truncate|cannot be truncated/i);
    await expect(prisma.operationalReconciliationEvent.create({ data: { id: `forged-${randomUUID()}`, domain: "census", aggregateType: "census_session", aggregateId: "forged", labId: "lab-microglia", eventType: "forged", resultingStatus: "forged", actorId: "user-lab-manager-qa", actorAuthzVersion: 1, actorRoleSnapshot: "lab_user", evidence: {}, commandReceiptId: event.commandReceiptId } })).rejects.toThrow(/exact processing command receipt|unique/i);
    const orphanReceiptId = `m16-orphan-receipt-${randomUUID()}`;
    await expect(prisma.$transaction(async (tx) => {
      await tx.commandReceipt.create({ data: { id: orphanReceiptId, actorId: "user-facility-admin-qa", actorAuthzVersion: 1, labId: "lab-microglia", commandType: "m16.census.start", idempotencyKey: `orphan-${randomUUID()}`, requestHash: `orphan-hash-${randomUUID()}`, requestId: `orphan-request-${randomUUID()}`, status: "processing", aggregateType: "census_session", aggregateId: `orphan-census-${randomUUID()}` } });
      await tx.commandReceipt.update({ where: { id: orphanReceiptId }, data: { status: "succeeded", completedAt: new Date(), resultingVersion: 1, result: { forged: true } } });
    })).rejects.toThrow(/requires exactly one same-receipt lifecycle event/i);
    expect(await prisma.commandReceipt.findUnique({ where: { id: orphanReceiptId } })).toBeNull();
    const successful = await prisma.commandReceipt.findMany({ where: { commandType: { startsWith: "m16." }, status: "succeeded" }, select: { id: true } });
    for (const receipt of successful) {
      expect(await prisma.operationalReconciliationEvent.count({ where: { commandReceiptId: receipt.id } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { commandReceiptId: receipt.id } })).toBe(1);
    }
  }, 120_000);
});
