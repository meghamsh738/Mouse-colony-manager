import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { getActorCapabilities } from "../src/lib/capabilities";
import { updateCryostorageRecord } from "../src/lib/colony-write";
import {
  executeCancelCryostorageRequestCommand,
  executeCryostorageRequestCommand,
  executeSubmitCryostorageRequestCommand,
} from "../src/lib/cryostorage-write";
import { prisma } from "../src/lib/prisma";
import type { ResolvedActor } from "../src/lib/session";
import { assertRetainedVerificationTarget } from "./retained-verification-guard";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function resultPayload(result: { result?: unknown }) {
  return result.result && typeof result.result === "object"
    ? result.result as { requestId?: string; recordId?: string; version?: number }
    : {};
}

async function expectRejected(operation: () => Promise<unknown>, messagePart: string) {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof Error && error.message.includes(messagePart), `Expected rejection containing ${messagePart}.`);
    return;
  }
  throw new Error(`Expected operation to be rejected with ${messagePart}.`);
}

async function main() {
  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");
  assertRetainedVerificationTarget(databaseUrl);

  const suffix = `${Date.now()}-${process.pid}`;
  const ids = {
    lab: `cryo-lab-${suffix}`,
    secondLab: `cryo-lab-b-${suffix}`,
    staff: `cryo-staff-${suffix}`,
    cmu: `cryo-cmu-${suffix}`,
    strain: `cryo-strain-${suffix}`,
    project: `cryo-project-${suffix}`,
    label: `CRYO-${suffix}`,
  };

  await prisma.user.createMany({
    data: [
      {
        id: ids.staff,
        name: "Cryostorage Lab Staff",
        email: `${ids.staff}@example.test`,
        passwordHash: "not-a-login-hash",
        role: "lab_user",
      },
      {
        id: ids.cmu,
        name: "Cryostorage CMU Staff",
        email: `${ids.cmu}@example.test`,
        passwordHash: "not-a-login-hash",
        role: "cmu_staff",
      },
    ],
  });
  await prisma.lab.createMany({
    data: [
      { id: ids.lab, name: `Cryostorage Lab ${suffix}`, code: `CR${suffix.slice(-8)}` },
      { id: ids.secondLab, name: `Cryostorage Lab B ${suffix}`, code: `CB${suffix.slice(-8)}` },
    ],
  });
  await prisma.labMembership.create({
    data: { id: randomUUID(), labId: ids.lab, userId: ids.staff, role: "staff" },
  });
  await prisma.strain.create({ data: { id: ids.strain, name: `Cryostorage strain ${suffix}` } });
  await prisma.project.create({
    data: {
      id: ids.project,
      labId: ids.lab,
      projectCode: `CRYO-P-${suffix}`,
      title: "Cryostorage verification",
      ownerId: ids.staff,
    },
  });

  const staffActor = {
    id: ids.staff,
    email: `${ids.staff}@example.test`,
    name: "Cryostorage Lab Staff",
    role: "animal_staff",
    databaseRole: "lab_user",
    canonicalRole: "lab_user",
    authzVersion: 1,
    activeLabId: ids.lab,
    activeMembership: { labId: ids.lab, labName: "Cryostorage Lab", labCode: "CR", role: "staff" },
    memberships: [{ labId: ids.lab, labName: "Cryostorage Lab", labCode: "CR", role: "staff" }],
    capabilities: [...getActorCapabilities({
      canonicalRole: "lab_user",
      activeMembership: { labId: ids.lab, labName: "Cryostorage Lab", labCode: "CR", role: "staff" },
    })],
  } satisfies ResolvedActor;
  const cmuActor = {
    id: ids.cmu,
    email: `${ids.cmu}@example.test`,
    name: "Cryostorage CMU Staff",
    role: "colony_manager",
    databaseRole: "cmu_staff",
    canonicalRole: "cmu_staff",
    authzVersion: 1,
    activeLabId: null,
    activeMembership: null,
    memberships: [],
    capabilities: [...getActorCapabilities({ canonicalRole: "cmu_staff", activeMembership: null })],
  } satisfies ResolvedActor;

  const today = new Date().toISOString().slice(0, 10);
  const submit = await executeSubmitCryostorageRequestCommand({
    actor: staffActor,
    command: {
      labId: ids.lab,
      requestType: "store",
      strainId: ids.strain,
      projectId: ids.project,
      sampleLabel: ids.label,
      materialType: "Frozen sperm",
      requestedQuantityLabel: "6 straws",
      requestedStorageLocation: "LN2 / Cane 1 / A",
      requestedFor: today,
      notes: "Retained verification request",
    },
    idempotencyKey: `cryo-submit-${suffix}`,
    requestId: `cryo-submit-request-${suffix}`,
  });
  assert(submit.ok, `Storage request submission failed: ${submit.message ?? "unknown"}`);
  const submitted = resultPayload(submit);
  assert(submitted.requestId && submitted.version === 1, "Storage request did not return version one.");

  await expectRejected(
    () => prisma.$executeRawUnsafe(`
      INSERT INTO "CryostorageRequest" (
        id, "labId", "requestType", status, "strainId", "sampleLabel", "materialType",
        "requestedFor", "requestedById", version, "createdAt", "updatedAt"
      ) VALUES (
        '${randomUUID()}', '${ids.lab}', 'store', 'submitted', '${ids.strain}', 'RAW-${suffix}',
        'Embryos', CURRENT_TIMESTAMP, '${ids.staff}', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `),
    "authorized submit command",
  );

  const incompleteRequestId = `cryo-incomplete-${suffix}`;
  await expectRejected(
    () => prisma.$transaction(async (tx) => {
      const receipt = await tx.commandReceipt.create({
        data: {
          id: randomUUID(),
          actorId: ids.staff,
          labId: ids.lab,
          commandType: "cryostorage.request.submit",
          idempotencyKey: `cryo-incomplete-${suffix}`,
          requestHash: "retained-verification-incomplete-event-history",
          requestId: `cryo-incomplete-request-${suffix}`,
          aggregateType: "cryostorage_request",
          aggregateId: incompleteRequestId,
        },
      });
      await tx.$queryRaw(Prisma.sql`
        SELECT
          set_config('mcm.cryostorage_receipt_id', ${receipt.id}, true),
          set_config('mcm.cryostorage_actor_id', ${ids.staff}, true),
          set_config('mcm.cryostorage_command_type', 'cryostorage.request.submit', true)
      `);
      await tx.cryostorageRequest.create({
        data: {
          id: incompleteRequestId,
          labId: ids.lab,
          requestType: "store",
          strainId: ids.strain,
          sampleLabel: `INCOMPLETE-${suffix}`,
          materialType: "Embryos",
          requestedFor: new Date(`${today}T00:00:00.000Z`),
          requestedById: ids.staff,
        },
      });
    }),
    "event history is incomplete or inconsistent",
  );

  const executeStore = await executeCryostorageRequestCommand({
    actor: cmuActor,
    command: {
      requestId: submitted.requestId,
      labId: ids.lab,
      action: "complete",
      performedAt: today,
      storageLocation: "LN2 / Cane 1 / A",
      quantityLabel: "6 straws",
      operationNotes: "Stored under verification",
    },
    expectedVersion: 1,
    idempotencyKey: `cryo-execute-store-${suffix}`,
    requestId: `cryo-execute-store-request-${suffix}`,
  });
  assert(executeStore.ok, `Storage request execution failed: ${executeStore.message ?? "unknown"}`);
  const stored = resultPayload(executeStore);
  assert(stored.recordId && stored.version === 2, "Storage execution did not create a record or advance the request.");

  const storageEvidence = await prisma.cryostorageRequest.findUniqueOrThrow({
    where: { id: submitted.requestId },
    include: { operation: true, events: true },
  });
  assert(storageEvidence.status === "completed", "Storage request was not completed.");
  assert(storageEvidence.operation?.recordId === stored.recordId, "Storage operation does not point to the created inventory record.");
  assert(storageEvidence.events.map((event) => event.eventType).sort().join(",") === "completed,submitted", "Storage request event history is incomplete.");

  const recoverySubmit = await executeSubmitCryostorageRequestCommand({
    actor: staffActor,
    command: { labId: ids.lab, requestType: "recover", targetRecordId: stored.recordId, requestedFor: today },
    idempotencyKey: `cryo-submit-recovery-${suffix}`,
    requestId: `cryo-submit-recovery-request-${suffix}`,
  });
  assert(recoverySubmit.ok, `Recovery request submission failed: ${recoverySubmit.message ?? "unknown"}`);
  const recovery = resultPayload(recoverySubmit);
  assert(recovery.requestId, "Recovery request ID is missing.");

  const metadataUpdate = await updateCryostorageRecord(
    { recordId: stored.recordId, expectedVersion: 1, storageLocation: "LN2 / Cane 1 / B" },
    { id: ids.cmu, role: "colony_manager", activeLabId: null },
  );
  assert(metadataUpdate.ok && metadataUpdate.resultingVersion === 2, "Concurrent inventory metadata update failed.");

  const staleExecution = await executeCryostorageRequestCommand({
    actor: cmuActor,
    command: {
      requestId: recovery.requestId,
      labId: ids.lab,
      action: "complete",
      performedAt: today,
      resultingStatus: "recovered",
    },
    expectedVersion: 1,
    idempotencyKey: `cryo-execute-stale-${suffix}`,
    requestId: `cryo-execute-stale-request-${suffix}`,
  });
  assert(!staleExecution.ok && staleExecution.code === "stale_conflict", "Stale recovery execution was not rejected.");
  assert(await prisma.cryostorageOperation.count({ where: { requestId: recovery.requestId } }) === 0, "Stale execution wrote an operation.");

  const rejectStale = await executeCryostorageRequestCommand({
    actor: cmuActor,
    command: {
      requestId: recovery.requestId,
      labId: ids.lab,
      action: "reject",
      reason: "Inventory changed after the request was submitted.",
    },
    expectedVersion: 1,
    idempotencyKey: `cryo-reject-stale-${suffix}`,
    requestId: `cryo-reject-stale-request-${suffix}`,
  });
  assert(rejectStale.ok, `Stale request rejection failed: ${rejectStale.message ?? "unknown"}`);

  const discardSubmit = await executeSubmitCryostorageRequestCommand({
    actor: staffActor,
    command: { labId: ids.lab, requestType: "discard", targetRecordId: stored.recordId, requestedFor: today },
    idempotencyKey: `cryo-submit-discard-${suffix}`,
    requestId: `cryo-submit-discard-request-${suffix}`,
  });
  assert(discardSubmit.ok, `Discard request submission failed: ${discardSubmit.message ?? "unknown"}`);
  const discard = resultPayload(discardSubmit);
  assert(discard.requestId, "Discard request ID is missing.");
  const cancelled = await executeCancelCryostorageRequestCommand({
    actor: staffActor,
    command: { requestId: discard.requestId, labId: ids.lab, reason: "Material is still required." },
    expectedVersion: 1,
    idempotencyKey: `cryo-cancel-${suffix}`,
    requestId: `cryo-cancel-request-${suffix}`,
  });
  assert(cancelled.ok, `Discard cancellation failed: ${cancelled.message ?? "unknown"}`);

  const finalCounts = await Promise.all([
    prisma.cryostorageRequest.count({ where: { labId: ids.lab } }),
    prisma.cryostorageRequestEvent.count({ where: { request: { labId: ids.lab } } }),
    prisma.cryostorageOperation.count({ where: { labId: ids.lab } }),
    prisma.auditLog.count({ where: { entityType: "cryostorage_request", entityId: { startsWith: "cryo-request-" } } }),
  ]);
  assert(finalCounts[0] === 3, `Expected three requests, found ${finalCounts[0]}.`);
  assert(finalCounts[1] === 6, `Expected six request events, found ${finalCounts[1]}.`);
  assert(finalCounts[2] === 1, `Expected one completed operation, found ${finalCounts[2]}.`);
  assert(finalCounts[3] >= 6, "Cryostorage request audits are incomplete.");

  console.log("Cryostorage request verification passed.", {
    schema: new URL(databaseUrl).searchParams.get("schema"),
    requestCount: finalCounts[0],
    eventCount: finalCounts[1],
    operationCount: finalCounts[2],
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
