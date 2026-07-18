import { randomUUID } from "node:crypto";

import { Prisma, type CageStatus, type Sex } from "@prisma/client";

import { validateProjectedSexComposition, validateQuarantineAssignments } from "@/lib/cage-assignment-rules";
import { getCageCapacityState } from "@/lib/cage-capacity";
import { endActiveCageResponsibilities } from "@/lib/cage-responsibility-write";
import { canonicalJsonHash, executeIdempotentCommand } from "@/lib/command-foundation";
import {
  getDefaultChargeCategoryId,
  startReplacementChargePeriod,
  transitionBreedingSetup,
} from "@/lib/colony-write";
import {
  buildDestinationTransferPacket,
  canCancelLabTransfer,
  canDecideLabTransfer,
  canFinalizeLabTransfer,
  canOverrideLabTransferBlocks,
  canRequestLabTransfer,
  canReviseLabTransfer,
  isTransferAcceptanceCurrent,
} from "@/lib/lab-transfer-state-machine";
import { resolveNotificationsForOwnershipChangeInTransaction } from "@/lib/notification-materialization";
import type { ResolvedActor } from "@/lib/session";

const OPEN_QUARANTINE_STATUSES = [
  "admitted",
  "under_observation",
  "exception_open",
  "release_requested",
] as const;

const TERMINAL_ANIMAL_STATUSES = [
  "euthanized",
  "dead",
  "transferred_out",
  "archived",
] as const;

function parseCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function locationLabel(input: { room: { roomNumber: string }; rack: { rackNumber: string }; cageNumber: string }) {
  return `${input.room.roomNumber} / ${input.rack.rackNumber} / ${input.cageNumber}`;
}

function commandLabId(actor: ResolvedActor) {
  return actor.canonicalRole === "lab_user" ? actor.activeLabId : null;
}

function actorEventLabId(actor: ResolvedActor) {
  return actor.canonicalRole === "lab_user" ? actor.activeLabId : null;
}

function transferValidationError(message: string) {
  return { ok: false as const, code: "validation_error", message };
}

async function setTransferCommandContext(tx: Prisma.TransactionClient, input: {
  requestId: string;
  actorId: string;
  commandType: string;
  receiptId: string;
}) {
  await tx.$queryRaw(Prisma.sql`
    SELECT
      set_config('mcm.lab_transfer_request_id', ${input.requestId}, true),
      set_config('mcm.lab_transfer_actor_id', ${input.actorId}, true),
      set_config('mcm.lab_transfer_command_type', ${input.commandType}, true),
      set_config('mcm.lab_transfer_receipt_id', ${input.receiptId}, true)
  `);
}

async function lockTransferRows(tx: Prisma.TransactionClient, input: {
  requestId: string;
  cageIds?: string[];
  animalIds?: string[];
}) {
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM "LabTransferRequest" WHERE id = ${input.requestId} FOR UPDATE
  `);
  const cageIds = [...new Set((input.cageIds ?? []).filter(Boolean))].sort();
  if (cageIds.length) {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "Cage" WHERE id IN (${Prisma.join(cageIds)}) ORDER BY id FOR UPDATE
    `);
  }
  const animalIds = [...new Set((input.animalIds ?? []).filter(Boolean))].sort();
  if (animalIds.length) {
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM "Animal" WHERE id IN (${Prisma.join(animalIds)}) ORDER BY id FOR UPDATE
    `);
  }
}

async function getCurrentTransferPacket(tx: Prisma.TransactionClient, requestId: string) {
  const [request, mixedSexRule] = await Promise.all([tx.labTransferRequest.findUnique({
    where: { id: requestId },
    include: {
      sourceLab: { select: { id: true, code: true, name: true, active: true } },
      destinationLab: { select: { id: true, code: true, name: true, active: true } },
      sourceCage: {
        select: {
          id: true,
          barcode: true,
          cageNumber: true,
          status: true,
          active: true,
          room: { select: { roomNumber: true } },
          rack: { select: { rackNumber: true } },
        },
      },
      destinationCage: {
        select: {
          id: true,
          barcode: true,
          cageNumber: true,
          status: true,
          active: true,
          capacityOverride: true,
          room: {
            select: {
              roomNumber: true,
              facility: { select: { maxCageOccupancy: true } },
            },
          },
          rack: { select: { rackNumber: true } },
          animals: { where: { outcomeStatus: "alive" }, select: { id: true, sex: true } },
        },
      },
      items: {
        where: { active: true },
        orderBy: [{ animal: { facilityAnimalId: "asc" } }, { animalId: "asc" }],
        include: {
          animal: {
            select: {
              id: true,
              facilityAnimalId: true,
              animalId: true,
              sex: true,
              dob: true,
              healthStatus: true,
              outcomeStatus: true,
              status: true,
              owningLabId: true,
              strain: { select: { name: true } },
              currentCage: { select: { id: true, barcode: true, labId: true } },
            },
          },
        },
      },
    },
  }), tx.ruleConfig.findUnique({
    where: { key: "mixed_sex_holding_allowed" },
    select: { value: true },
  })]);
  if (!request) return null;

  const destinationCapacity = request.destinationCage
    ? getCageCapacityState({
        facilityLimit: request.destinationCage.room.facility.maxCageOccupancy,
        cageOverride: request.destinationCage.capacityOverride,
        occupantCount: request.destinationCage.animals.length,
      })
    : null;
  const built = buildDestinationTransferPacket({
    requestId: request.id,
    subjectType: request.subjectType,
    sourceLab: request.sourceLab,
    destinationLab: request.destinationLab,
    reason: request.reason,
    requestedEffectiveAt: request.requestedEffectiveAt.toISOString(),
    sourceCage: request.sourceCage
      ? {
          id: request.sourceCage.id,
          barcode: request.sourceCage.barcode,
          location: locationLabel(request.sourceCage),
          status: request.sourceCage.status,
        }
      : null,
    destinationCage: request.destinationCage && destinationCapacity
      ? (() => {
          const occupantSexCounts = request.destinationCage.animals.reduce(
            (counts, animal) => ({ ...counts, [animal.sex]: counts[animal.sex] + 1 }),
            { male: 0, female: 0, unknown: 0 },
          );
          return {
          id: request.destinationCage.id,
          barcode: request.destinationCage.barcode,
          location: locationLabel(request.destinationCage),
          status: request.destinationCage.status,
          occupancy: request.destinationCage.animals.length,
          capacity: destinationCapacity.effectiveLimit,
          occupantSexCounts,
          occupancyFingerprint: canonicalJsonHash({
            status: request.destinationCage.status,
            occupants: [...request.destinationCage.animals]
              .sort((left, right) => left.id.localeCompare(right.id))
              .map(({ id, sex }) => ({ id, sex })),
          }),
          mixedSexHoldingAllowed: mixedSexRule?.value === true,
        };
        })()
      : null,
    animals: request.items.map(({ animal }) => ({
      id: animal.id,
      facilityAnimalId: animal.facilityAnimalId,
      animalId: animal.animalId,
      sex: animal.sex,
      dob: animal.dob.toISOString(),
      strain: animal.strain.name,
      healthStatus: animal.healthStatus,
      sourceCageBarcode: animal.currentCage?.barcode ?? null,
    })),
  });

  return { request, ...built };
}

async function createTransferEvent(tx: Prisma.TransactionClient, input: {
  requestId: string;
  eventType: "requested" | "packet_revised" | "destination_accepted" | "destination_rejected" | "cancelled" | "override_applied" | "finalized";
  actor: ResolvedActor;
  packetVersion: number;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  return tx.labTransferEvent.create({
    data: {
      id: randomUUID(),
      requestId: input.requestId,
      eventType: input.eventType,
      actorId: input.actor.id,
      actorRole: input.actor.databaseRole,
      actorLabId: actorEventLabId(input.actor),
      packetVersion: input.packetVersion,
      reason: input.reason?.trim() || null,
      metadata: input.metadata,
    },
  });
}

async function auditTransfer(tx: Prisma.TransactionClient, input: {
  requestId: string;
  actor: ResolvedActor;
  action: string;
  previousValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
}) {
  return tx.auditLog.create({
    data: {
      id: randomUUID(),
      actorId: input.actor.id,
      entityType: "lab_transfer_request",
      entityId: input.requestId,
      action: input.action,
      previousValue: input.previousValue ?? Prisma.JsonNull,
      newValue: input.newValue ?? Prisma.JsonNull,
      timestamp: new Date(),
    },
  });
}

export type RequestLabTransferCommand = {
  subjectType: "cage" | "animals";
  sourceCageId?: string | null;
  animalIds?: string[];
  destinationLabId: string;
  requestedEffectiveAt: string;
  reason: string;
  sourcePrivateNote?: string | null;
};

export async function executeRequestLabTransferCommand(input: {
  actor: ResolvedActor;
  command: RequestLabTransferCommand;
  idempotencyKey: string;
  requestId: string;
}) {
  const sourceLabId = input.actor.activeLabId;
  const transferRequestId = `lab-transfer-${canonicalJsonHash({
    actorId: input.actor.id,
    commandType: "lab_transfer.request",
    idempotencyKey: input.idempotencyKey.trim(),
  }).slice(0, 32)}`;
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "lab_transfer.request",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: input.command as unknown as Prisma.InputJsonValue,
    requiredCapability: "transfers:request",
    labId: sourceLabId,
    aggregateType: "lab_transfer_request",
    aggregateId: transferRequestId,
    handler: async (tx, { receiptId }) => {
      if (!sourceLabId || !canRequestLabTransfer(input.actor, sourceLabId)) {
        return { ok: false as const, code: "forbidden", message: "A source-lab owner or manager must request this transfer." };
      }
      const reason = input.command.reason.trim();
      const sourcePrivateNote = input.command.sourcePrivateNote?.trim() || null;
      const requestedEffectiveAt = parseCalendarDate(input.command.requestedEffectiveAt);
      if (!requestedEffectiveAt || dateKey(requestedEffectiveAt) < dateKey(new Date()) || reason.length < 3) {
        return transferValidationError("Choose today or a future transfer date and enter a clear reason.");
      }
      if (!input.command.destinationLabId || input.command.destinationLabId === sourceLabId) {
        return transferValidationError("Choose a different destination lab.");
      }
      const [sourceLab, destinationLab] = await Promise.all([
        tx.lab.findUnique({ where: { id: sourceLabId }, select: { active: true } }),
        tx.lab.findUnique({ where: { id: input.command.destinationLabId }, select: { active: true } }),
      ]);
      if (!sourceLab?.active || !destinationLab?.active) {
        return transferValidationError("Both source and destination labs must be active.");
      }

      let sourceCageId: string | null = null;
      let animalRows: Array<{ id: string; currentCageId: string | null }> = [];
      if (input.command.subjectType === "cage") {
        sourceCageId = input.command.sourceCageId?.trim() || null;
        if (!sourceCageId) return transferValidationError("Choose a source cage.");
        const cage = await tx.cage.findFirst({
          where: { id: sourceCageId, labId: sourceLabId },
          select: {
            id: true,
            active: true,
            status: true,
            closure: { select: { id: true } },
            quarantineCases: {
              where: { status: { in: [...OPEN_QUARANTINE_STATUSES] } },
              take: 1,
              select: { id: true },
            },
            animals: {
              where: { outcomeStatus: "alive", status: { notIn: [...TERMINAL_ANIMAL_STATUSES] } },
              select: { id: true, currentCageId: true },
            },
          },
        });
        if (!cage || !cage.active || cage.status === "closed" || cage.closure) {
          return { ok: false as const, code: "not_found", message: "Active source cage not found." };
        }
        if (cage.quarantineCases.length) {
          return transferValidationError("Release or cancel the open quarantine case before requesting a lab transfer.");
        }
        const existingCageRequest = await tx.labTransferRequest.findFirst({
          where: { sourceCageId: cage.id, status: { in: ["requested", "destination_accepted", "destination_rejected"] } },
          select: { id: true },
        });
        if (existingCageRequest) return transferValidationError("This cage already has an open lab-transfer request.");
        animalRows = cage.animals;
      } else {
        const animalIds = [...new Set((input.command.animalIds ?? []).map((id) => id.trim()).filter(Boolean))];
        if (!animalIds.length || animalIds.length > 50) {
          return transferValidationError("Choose between 1 and 50 animals for this transfer.");
        }
        const animals = await tx.animal.findMany({
          where: {
            id: { in: animalIds },
            owningLabId: sourceLabId,
            outcomeStatus: "alive",
            status: { notIn: [...TERMINAL_ANIMAL_STATUSES] },
          },
          select: {
            id: true,
            currentCageId: true,
            currentCage: {
              select: {
                quarantineCases: {
                  where: { status: { in: [...OPEN_QUARANTINE_STATUSES] } },
                  take: 1,
                  select: { id: true },
                },
              },
            },
          },
        });
        if (animals.length !== animalIds.length) {
          return { ok: false as const, code: "not_found", message: "One or more source-lab animals were not found or are no longer transferable." };
        }
        if (animals.some((animal) => animal.currentCage?.quarantineCases.length)) {
          return transferValidationError("Release or cancel open quarantine cases before requesting a lab transfer.");
        }
        animalRows = animals.map(({ id, currentCageId }) => ({ id, currentCageId }));
      }

      if (animalRows.length) {
        const existingItem = await tx.labTransferItem.findFirst({
          where: { animalId: { in: animalRows.map((animal) => animal.id) }, active: true },
          select: { animalId: true },
        });
        if (existingItem) return transferValidationError("One or more animals already belong to an open lab-transfer request.");
      }

      const requestId = transferRequestId;
      await setTransferCommandContext(tx, {
        requestId,
        actorId: input.actor.id,
        commandType: "lab_transfer.request",
        receiptId,
      });
      await tx.labTransferRequest.create({
        data: {
          id: requestId,
          subjectType: input.command.subjectType,
          sourceLabId,
          destinationLabId: input.command.destinationLabId,
          sourceCageId,
          reason,
          sourcePrivateNote,
          requestedEffectiveAt,
          requestedById: input.actor.id,
        },
      });
      if (animalRows.length) {
        await tx.labTransferItem.createMany({
          data: animalRows.map((animal) => ({
            id: randomUUID(),
            requestId,
            animalId: animal.id,
            sourceCageId: animal.currentCageId,
          })),
        });
      }
      const current = await getCurrentTransferPacket(tx, requestId);
      if (!current) throw new Error("Transfer packet could not be built.");
      await tx.labTransferPacket.create({
        data: {
          id: randomUUID(),
          requestId,
          version: 1,
          destinationPayload: current.packet as unknown as Prisma.InputJsonValue,
          payloadHash: current.payloadHash,
          createdById: input.actor.id,
        },
      });
      await createTransferEvent(tx, {
        requestId,
        eventType: "requested",
        actor: input.actor,
        packetVersion: 1,
        reason,
        metadata: { subjectType: input.command.subjectType, animalCount: animalRows.length },
      });
      await auditTransfer(tx, {
        requestId,
        actor: input.actor,
        action: "request",
        newValue: {
          sourceLabId,
          destinationLabId: input.command.destinationLabId,
          subjectType: input.command.subjectType,
          sourceCageId,
          animalIds: animalRows.map((animal) => animal.id),
          requestedEffectiveAt: input.command.requestedEffectiveAt,
          packetVersion: 1,
          packetHash: current.payloadHash,
        },
      });
      return {
        ok: true as const,
        result: { requestId, message: "Transfer request sent to the destination lab." },
        aggregateType: "lab_transfer_request",
        aggregateId: requestId,
        resultingVersion: 1,
      };
    },
  });
}

export type DecideLabTransferCommand = {
  requestId: string;
  decision: "accept" | "reject";
  destinationCageId?: string | null;
  note?: string | null;
};

export async function executeDecideLabTransferCommand(input: {
  actor: ResolvedActor;
  command: DecideLabTransferCommand;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
}) {
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: `lab_transfer.destination_${input.command.decision}`,
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { command: input.command, expectedVersion: input.expectedVersion } as unknown as Prisma.InputJsonValue,
    requiredCapability: "transfers:approve",
    labId: commandLabId(input.actor),
    aggregateType: "lab_transfer_request",
    aggregateId: input.command.requestId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, { receiptId }) => {
      const request = await tx.labTransferRequest.findUnique({
        where: { id: input.command.requestId },
        include: {
          packets: { orderBy: { version: "desc" }, take: 1 },
          items: {
            where: { active: true },
            select: { animalId: true, animal: { select: { id: true, sex: true } } },
          },
        },
      });
      if (!request || !canDecideLabTransfer(input.actor, request.destinationLabId)) {
        return { ok: false as const, code: "not_found", message: "Transfer request not found." };
      }
      if (request.status !== "requested") {
        return { ok: false as const, code: "invalid_transition", message: "This request is not waiting for a destination decision." };
      }
      const commandType = `lab_transfer.destination_${input.command.decision}`;
      await setTransferCommandContext(tx, {
        requestId: request.id,
        actorId: input.actor.id,
        commandType,
        receiptId,
      });
      const latestPacket = request.packets[0];
      const current = await getCurrentTransferPacket(tx, request.id);
      if (!latestPacket || !current || latestPacket.version !== request.packetVersion || latestPacket.payloadHash !== current.payloadHash) {
        return { ok: false as const, code: "packet_stale", message: "The transfer details changed. Ask the source lab to refresh the packet before deciding." };
      }
      const note = input.command.note?.trim() || null;
      if (input.command.decision === "reject") {
        if (!note || note.length < 3) return transferValidationError("Enter a reason for rejecting this transfer.");
        const updated = await tx.labTransferRequest.update({
          where: { id: request.id },
          data: {
            status: "destination_rejected",
            acceptedPacketVersion: null,
            acceptedPacketHash: null,
            destinationDecisionById: input.actor.id,
            destinationDecisionAt: new Date(),
            destinationDecisionNote: note,
            version: { increment: 1 },
          },
          select: { version: true },
        });
        await createTransferEvent(tx, {
          requestId: request.id,
          eventType: "destination_rejected",
          actor: input.actor,
          packetVersion: request.packetVersion,
          reason: note,
        });
        await auditTransfer(tx, {
          requestId: request.id,
          actor: input.actor,
          action: "destination_reject",
          previousValue: { status: request.status, version: request.version },
          newValue: { status: "destination_rejected", version: updated.version, packetVersion: request.packetVersion },
        });
        return {
          ok: true as const,
          result: { requestId: request.id, message: "Transfer request rejected." },
          aggregateType: "lab_transfer_request",
          aggregateId: request.id,
          resultingVersion: updated.version,
        };
      }

      let packetVersion = request.packetVersion;
      let packetHash = latestPacket.payloadHash;
      let destinationCageId: string | null = null;
      if (request.subjectType === "animals") {
        destinationCageId = input.command.destinationCageId?.trim() || null;
        if (!destinationCageId) return transferValidationError("Choose an active destination cage.");
        const [cage, mixedSexRule] = await Promise.all([tx.cage.findFirst({
          where: { id: destinationCageId, labId: request.destinationLabId },
          select: {
            id: true,
            active: true,
            status: true,
            capacityOverride: true,
            closure: { select: { id: true } },
            room: { select: { facility: { select: { maxCageOccupancy: true } } } },
            animals: { where: { outcomeStatus: "alive" }, select: { id: true, sex: true } },
            quarantineCases: {
              where: { status: { in: [...OPEN_QUARANTINE_STATUSES] } },
              take: 1,
              select: { id: true },
            },
          },
        }), tx.ruleConfig.findUnique({
          where: { key: "mixed_sex_holding_allowed" },
          select: { value: true },
        })]);
        if (!cage || !cage.active || ["closed", "retired"].includes(cage.status) || cage.closure || cage.quarantineCases.length) {
          return transferValidationError("Choose an active destination cage without an open quarantine case.");
        }
        const destinationKey = `existing:${cage.id}`;
        const destination = {
          key: destinationKey,
          label: cage.id,
          status: cage.status,
          occupants: cage.animals,
        };
        const quarantineError = validateQuarantineAssignments({
          workflow: "new",
          destinations: [destination],
          usedDestinationKeys: new Set([destinationKey]),
        });
        if (quarantineError) return transferValidationError(quarantineError);
        const sexError = validateProjectedSexComposition({
          destinations: [destination],
          incoming: request.items.map((item) => ({
            subjectId: item.animal.id,
            sex: item.animal.sex,
            destinationKey,
          })),
          mixedSexHoldingAllowed: mixedSexRule?.value === true,
        });
        if (sexError) return transferValidationError(sexError);
        const capacity = getCageCapacityState({
          facilityLimit: cage.room.facility.maxCageOccupancy,
          cageOverride: cage.capacityOverride,
          occupantCount: cage.animals.length,
        });
        if (request.items.length > capacity.remainingCapacity) {
          return transferValidationError(`That cage has ${capacity.remainingCapacity} spaces for ${request.items.length} animals.`);
        }
        packetVersion += 1;
        await tx.labTransferRequest.update({
          where: { id: request.id },
          data: { destinationCageId, packetVersion },
        });
        const withDestination = await getCurrentTransferPacket(tx, request.id);
        if (!withDestination) throw new Error("Destination transfer packet could not be built.");
        packetHash = withDestination.payloadHash;
        await tx.labTransferPacket.create({
          data: {
            id: randomUUID(),
            requestId: request.id,
            version: packetVersion,
            destinationPayload: withDestination.packet as unknown as Prisma.InputJsonValue,
            payloadHash: packetHash,
            createdById: input.actor.id,
          },
        });
        await createTransferEvent(tx, {
          requestId: request.id,
          eventType: "packet_revised",
          actor: input.actor,
          packetVersion,
          reason: "Destination cage selected.",
          metadata: { destinationCageId },
        });
      }

      const decidedAt = new Date();
      const updated = await tx.labTransferRequest.update({
        where: { id: request.id },
        data: {
          status: "destination_accepted",
          destinationCageId,
          acceptedPacketVersion: packetVersion,
          acceptedPacketHash: packetHash,
          destinationDecisionById: input.actor.id,
          destinationDecisionAt: decidedAt,
          destinationDecisionNote: note,
          version: { increment: 1 },
        },
        select: { version: true },
      });
      await createTransferEvent(tx, {
        requestId: request.id,
        eventType: "destination_accepted",
        actor: input.actor,
        packetVersion,
        reason: note,
        metadata: { destinationCageId },
      });
      await auditTransfer(tx, {
        requestId: request.id,
        actor: input.actor,
        action: "destination_accept",
        previousValue: { status: request.status, version: request.version, packetVersion: request.packetVersion },
        newValue: { status: "destination_accepted", version: updated.version, packetVersion, packetHash, destinationCageId },
      });
      return {
        ok: true as const,
        result: { requestId: request.id, message: "Transfer accepted. CMU finalization is now required." },
        aggregateType: "lab_transfer_request",
        aggregateId: request.id,
        resultingVersion: updated.version,
      };
    },
  });
}

export type ReviseLabTransferCommand = {
  requestId: string;
  destinationLabId: string;
  requestedEffectiveAt: string;
  reason: string;
  sourcePrivateNote?: string | null;
};

export async function executeReviseLabTransferCommand(input: {
  actor: ResolvedActor;
  command: ReviseLabTransferCommand;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
}) {
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "lab_transfer.revise",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { command: input.command, expectedVersion: input.expectedVersion } as unknown as Prisma.InputJsonValue,
    requiredCapability: "transfers:request",
    labId: commandLabId(input.actor),
    aggregateType: "lab_transfer_request",
    aggregateId: input.command.requestId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, { receiptId }) => {
      const request = await tx.labTransferRequest.findUnique({
        where: { id: input.command.requestId },
        include: { items: { where: { active: true }, select: { animalId: true, sourceCageId: true } } },
      });
      if (!request || !canRequestLabTransfer(input.actor, request.sourceLabId)) {
        return { ok: false as const, code: "not_found", message: "Transfer request not found." };
      }
      if (!canReviseLabTransfer(request.status)) {
        return { ok: false as const, code: "invalid_transition", message: "This transfer can no longer be revised." };
      }
      await setTransferCommandContext(tx, {
        requestId: request.id,
        actorId: input.actor.id,
        commandType: "lab_transfer.revise",
        receiptId,
      });
      const reason = input.command.reason.trim();
      const sourcePrivateNote = input.command.sourcePrivateNote?.trim() || null;
      const requestedEffectiveAt = parseCalendarDate(input.command.requestedEffectiveAt);
      if (!requestedEffectiveAt || dateKey(requestedEffectiveAt) < dateKey(new Date()) || reason.length < 3) {
        return transferValidationError("Choose today or a future transfer date and enter a clear reason.");
      }
      if (!input.command.destinationLabId || input.command.destinationLabId === request.sourceLabId) {
        return transferValidationError("Choose a different destination lab.");
      }
      const destinationLab = await tx.lab.findUnique({
        where: { id: input.command.destinationLabId },
        select: { active: true },
      });
      if (!destinationLab?.active) return transferValidationError("Choose an active destination lab.");

      await lockTransferRows(tx, {
        requestId: request.id,
        cageIds: [request.sourceCageId ?? "", ...request.items.map((item) => item.sourceCageId ?? "")],
        animalIds: request.items.map((item) => item.animalId),
      });

      let animalRows = request.items.map((item) => ({ id: item.animalId, currentCageId: item.sourceCageId }));
      if (request.subjectType === "cage") {
        const cage = await tx.cage.findFirst({
          where: { id: request.sourceCageId ?? "", labId: request.sourceLabId },
          select: {
            active: true,
            status: true,
            closure: { select: { id: true } },
            quarantineCases: {
              where: { status: { in: [...OPEN_QUARANTINE_STATUSES] } },
              take: 1,
              select: { id: true },
            },
            animals: {
              where: { outcomeStatus: "alive", status: { notIn: [...TERMINAL_ANIMAL_STATUSES] } },
              select: { id: true, currentCageId: true },
            },
          },
        });
        if (!cage || !cage.active || cage.status === "closed" || cage.closure || cage.quarantineCases.length) {
          return transferValidationError("The source cage is no longer transferable.");
        }
        animalRows = cage.animals;
      } else {
        const animals = await tx.animal.findMany({
          where: {
            id: { in: request.items.map((item) => item.animalId) },
            owningLabId: request.sourceLabId,
            outcomeStatus: "alive",
            status: { notIn: [...TERMINAL_ANIMAL_STATUSES] },
          },
          select: {
            id: true,
            currentCageId: true,
            currentCage: {
              select: {
                quarantineCases: {
                  where: { status: { in: [...OPEN_QUARANTINE_STATUSES] } },
                  take: 1,
                  select: { id: true },
                },
              },
            },
          },
        });
        if (animals.length !== request.items.length || animals.some((animal) => animal.currentCage?.quarantineCases.length)) {
          return transferValidationError("One or more animals are no longer transferable.");
        }
        animalRows = animals.map(({ id, currentCageId }) => ({ id, currentCageId }));
      }

      if (animalRows.length) {
        const conflict = await tx.labTransferItem.findFirst({
          where: {
            requestId: { not: request.id },
            animalId: { in: animalRows.map((animal) => animal.id) },
            active: true,
          },
          select: { animalId: true },
        });
        if (conflict) return transferValidationError("One or more animals now belong to another open transfer request.");
      }

      await tx.labTransferItem.deleteMany({ where: { requestId: request.id } });
      if (animalRows.length) {
        await tx.labTransferItem.createMany({
          data: animalRows.map((animal) => ({
            id: randomUUID(),
            requestId: request.id,
            animalId: animal.id,
            sourceCageId: animal.currentCageId,
          })),
        });
      }
      const packetVersion = request.packetVersion + 1;
      const updated = await tx.labTransferRequest.update({
        where: { id: request.id },
        data: {
          destinationLabId: input.command.destinationLabId,
          destinationCageId: null,
          reason,
          sourcePrivateNote,
          requestedEffectiveAt,
          status: "requested",
          packetVersion,
          acceptedPacketVersion: null,
          acceptedPacketHash: null,
          destinationDecisionById: null,
          destinationDecisionAt: null,
          destinationDecisionNote: null,
          version: { increment: 1 },
        },
        select: { version: true },
      });
      const current = await getCurrentTransferPacket(tx, request.id);
      if (!current) throw new Error("Revised transfer packet could not be built.");
      await tx.labTransferPacket.create({
        data: {
          id: randomUUID(),
          requestId: request.id,
          version: packetVersion,
          destinationPayload: current.packet as unknown as Prisma.InputJsonValue,
          payloadHash: current.payloadHash,
          createdById: input.actor.id,
        },
      });
      await createTransferEvent(tx, {
        requestId: request.id,
        eventType: "packet_revised",
        actor: input.actor,
        packetVersion,
        reason,
        metadata: { destinationLabId: input.command.destinationLabId, animalCount: animalRows.length },
      });
      await auditTransfer(tx, {
        requestId: request.id,
        actor: input.actor,
        action: "revise_packet",
        previousValue: {
          status: request.status,
          version: request.version,
          packetVersion: request.packetVersion,
          destinationLabId: request.destinationLabId,
        },
        newValue: {
          status: "requested",
          version: updated.version,
          packetVersion,
          packetHash: current.payloadHash,
          destinationLabId: input.command.destinationLabId,
          animalCount: animalRows.length,
        },
      });
      return {
        ok: true as const,
        result: { requestId: request.id, message: "Transfer packet revised. Destination approval is required again." },
        aggregateType: "lab_transfer_request",
        aggregateId: request.id,
        resultingVersion: updated.version,
      };
    },
  });
}

export async function executeCancelLabTransferCommand(input: {
  actor: ResolvedActor;
  command: { requestId: string; reason: string };
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
}) {
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "lab_transfer.cancel",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { command: input.command, expectedVersion: input.expectedVersion } as unknown as Prisma.InputJsonValue,
    requiredCapability: "transfers:request",
    labId: commandLabId(input.actor),
    aggregateType: "lab_transfer_request",
    aggregateId: input.command.requestId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, { receiptId }) => {
      const request = await tx.labTransferRequest.findUnique({ where: { id: input.command.requestId } });
      if (!request || !canRequestLabTransfer(input.actor, request.sourceLabId)) {
        return { ok: false as const, code: "not_found", message: "Transfer request not found." };
      }
      if (!canCancelLabTransfer(request.status)) {
        return { ok: false as const, code: "invalid_transition", message: "This transfer can no longer be cancelled." };
      }
      await setTransferCommandContext(tx, {
        requestId: request.id,
        actorId: input.actor.id,
        commandType: "lab_transfer.cancel",
        receiptId,
      });
      const reason = input.command.reason.trim();
      if (reason.length < 3) return transferValidationError("Enter a reason for cancelling this transfer.");
      const updated = await tx.labTransferRequest.update({
        where: { id: request.id },
        data: {
          status: "cancelled",
          acceptedPacketVersion: null,
          acceptedPacketHash: null,
          version: { increment: 1 },
        },
        select: { version: true },
      });
      await tx.labTransferItem.updateMany({ where: { requestId: request.id, active: true }, data: { active: false } });
      await createTransferEvent(tx, {
        requestId: request.id,
        eventType: "cancelled",
        actor: input.actor,
        packetVersion: request.packetVersion,
        reason,
      });
      await auditTransfer(tx, {
        requestId: request.id,
        actor: input.actor,
        action: "cancel",
        previousValue: { status: request.status, version: request.version },
        newValue: { status: "cancelled", version: updated.version, reason },
      });
      return {
        ok: true as const,
        result: { requestId: request.id, message: "Transfer request cancelled." },
        aggregateType: "lab_transfer_request",
        aggregateId: request.id,
        resultingVersion: updated.version,
      };
    },
  });
}

type TransferBlocker = {
  kind: "experiment_assignment" | "project_allocation" | "breeding_setup" | "procedure_plan";
  recordId: string;
  animalId: string;
  label: string;
};

async function getTransferBlockers(tx: Prisma.TransactionClient, animalIds: string[]) {
  if (!animalIds.length) {
    return {
      blockers: [] as TransferBlocker[],
      experimentAssignments: [],
      projectAllocations: [],
      breedingAdults: [],
      procedurePlans: [],
    };
  }
  const [experimentAssignments, projectAllocations, breedingAdults, procedurePlans] = await Promise.all([
    tx.experimentAssignment.findMany({
      where: { animalId: { in: animalIds }, status: { notIn: ["completed", "cancelled"] } },
      select: {
        id: true,
        animalId: true,
        status: true,
        startDate: true,
        endDate: true,
        version: true,
        experiment: { select: { id: true, experimentCode: true, version: true } },
      },
    }),
    tx.animalProjectAllocation.findMany({
      where: { animalId: { in: animalIds }, endedAt: null },
      select: {
        id: true,
        animalId: true,
        startedAt: true,
        project: { select: { projectCode: true } },
      },
    }),
    tx.breedingAdult.findMany({
      where: {
        animalId: { in: animalIds },
        breedingSetup: { status: { in: ["planned", "active", "paused"] } },
      },
      select: {
        id: true,
        animalId: true,
        breedingSetup: { select: { id: true, status: true, startDate: true } },
      },
    }),
    tx.procedurePlan.findMany({
      where: {
        status: "planned",
        assignment: { animalId: { in: animalIds } },
      },
      select: {
        id: true,
        procedureCode: true,
        title: true,
        assignment: { select: { animalId: true } },
      },
    }),
  ]);
  const blockers: TransferBlocker[] = [
    ...experimentAssignments.map((assignment) => ({
      kind: "experiment_assignment" as const,
      recordId: assignment.id,
      animalId: assignment.animalId,
      label: assignment.experiment.experimentCode,
    })),
    ...projectAllocations.map((allocation) => ({
      kind: "project_allocation" as const,
      recordId: allocation.id,
      animalId: allocation.animalId,
      label: allocation.project.projectCode,
    })),
    ...breedingAdults.map((adult) => ({
      kind: "breeding_setup" as const,
      recordId: adult.breedingSetup.id,
      animalId: adult.animalId,
      label: adult.breedingSetup.id,
    })),
    ...procedurePlans.map((plan) => ({
      kind: "procedure_plan" as const,
      recordId: plan.id,
      animalId: plan.assignment.animalId,
      label: `${plan.procedureCode}: ${plan.title}`,
    })),
  ];
  return { blockers, experimentAssignments, projectAllocations, breedingAdults, procedurePlans };
}

async function applyTransferOverride(tx: Prisma.TransactionClient, input: {
  actor: ResolvedActor;
  requestId: string;
  movedAt: Date;
  reason: string;
  blockers: Awaited<ReturnType<typeof getTransferBlockers>>;
  packetVersion: number;
}) {
  const experiments = new Map<string, { version: number; assignmentIds: string[] }>();
  for (const assignment of input.blockers.experimentAssignments) {
    const experiment = experiments.get(assignment.experiment.id);
    if (experiment) {
      experiment.assignmentIds.push(assignment.id);
    } else {
      experiments.set(assignment.experiment.id, {
        version: assignment.experiment.version,
        assignmentIds: [assignment.id],
      });
    }
  }
  for (const [experimentId, experiment] of experiments) {
    const updated = await tx.experiment.updateMany({
      where: { id: experimentId, version: experiment.version },
      data: { version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new Error("An experiment changed while applying the transfer override. Refresh and review the request.");
    }
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorId: input.actor.id,
        entityType: "experiment",
        entityId: experimentId,
        action: "facility_override_for_lab_transfer",
        previousValue: { version: experiment.version },
        newValue: {
          version: experiment.version + 1,
          cancelledAssignmentIds: experiment.assignmentIds,
          requestId: input.requestId,
          reason: input.reason,
        },
        timestamp: new Date(),
      },
    });
  }
  for (const assignment of input.blockers.experimentAssignments) {
    const endDate = assignment.startDate > input.movedAt ? assignment.startDate : input.movedAt;
    const updated = await tx.experimentAssignment.updateMany({
      where: { id: assignment.id, version: assignment.version, status: assignment.status },
      data: {
        status: "cancelled",
        endDate,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new Error("An experiment assignment changed while applying the transfer override. Refresh and review the request.");
    }
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorId: input.actor.id,
        entityType: "experiment_assignment",
        entityId: assignment.id,
        action: "facility_override_for_lab_transfer",
        previousValue: { status: assignment.status, endDate: assignment.endDate?.toISOString() ?? null, version: assignment.version },
        newValue: {
          status: "cancelled",
          version: assignment.version + 1,
          endDate: endDate.toISOString(),
          requestId: input.requestId,
          reason: input.reason,
          effectiveAt: input.movedAt.toISOString(),
        },
        timestamp: new Date(),
      },
    });
  }
  for (const allocation of input.blockers.projectAllocations) {
    await tx.animalProjectAllocation.update({
      where: { id: allocation.id },
      data: { endedAt: allocation.startedAt > input.movedAt ? allocation.startedAt : input.movedAt },
    });
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorId: input.actor.id,
        entityType: "animal_project_allocation",
        entityId: allocation.id,
        action: "facility_override_for_lab_transfer",
        previousValue: { endedAt: null },
        newValue: {
          endedAt: (allocation.startedAt > input.movedAt ? allocation.startedAt : input.movedAt).toISOString(),
          requestId: input.requestId,
          reason: input.reason,
        },
        timestamp: new Date(),
      },
    });
  }
  const setupById = new Map(
    input.blockers.breedingAdults.map((adult) => [adult.breedingSetup.id, adult.breedingSetup]),
  );
  for (const setup of setupById.values()) {
    const transitioned = await transitionBreedingSetup({
      breedingSetupId: setup.id,
      targetStatus: "retired",
      happenedAt: (setup.startDate > input.movedAt ? setup.startDate : input.movedAt).toISOString(),
      reason: `Facility override for lab transfer ${input.requestId}: ${input.reason}`,
    }, {
      id: input.actor.id,
      role: input.actor.databaseRole,
      activeLabId: null,
    }, tx);
    if (!transitioned.ok) {
      throw new Error(`Breeding setup ${setup.id} could not be retired: ${transitioned.message}`);
    }
  }
  await createTransferEvent(tx, {
    requestId: input.requestId,
    eventType: "override_applied",
    actor: input.actor,
    packetVersion: input.packetVersion,
    reason: input.reason,
    metadata: {
      experimentAssignmentIds: input.blockers.experimentAssignments.map((assignment) => assignment.id),
      projectAllocationIds: input.blockers.projectAllocations.map((allocation) => allocation.id),
      breedingSetupIds: [...setupById.keys()],
    },
  });
  await auditTransfer(tx, {
    requestId: input.requestId,
    actor: input.actor,
    action: "override_active_relationships",
    previousValue: {
      blockers: input.blockers.blockers.map((blocker) => ({
        kind: blocker.kind,
        recordId: blocker.recordId,
        animalId: blocker.animalId,
      })),
    },
    newValue: { reason: input.reason, settledAt: input.movedAt.toISOString() },
  });
}

export type FinalizeLabTransferCommand = {
  requestId: string;
  overrideReason?: string | null;
};

export async function executeFinalizeLabTransferCommand(input: {
  actor: ResolvedActor;
  command: FinalizeLabTransferCommand;
  expectedVersion: number;
  idempotencyKey: string;
  requestId: string;
}) {
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "lab_transfer.finalize",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { command: input.command, expectedVersion: input.expectedVersion } as unknown as Prisma.InputJsonValue,
    requiredCapability: "transfers:finalize",
    labId: null,
    aggregateType: "lab_transfer_request",
    aggregateId: input.command.requestId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, { receiptId }) => {
      if (!canFinalizeLabTransfer(input.actor)) {
        return { ok: false as const, code: "forbidden", message: "CMU or Facility finalization authority is required." };
      }
      const initial = await tx.labTransferRequest.findUnique({
        where: { id: input.command.requestId },
        include: {
          items: { where: { active: true }, select: { animalId: true, sourceCageId: true } },
          packets: { orderBy: { version: "desc" }, take: 1 },
        },
      });
      if (!initial) return { ok: false as const, code: "not_found", message: "Transfer request not found." };
      await lockTransferRows(tx, {
        requestId: initial.id,
        cageIds: [initial.sourceCageId ?? "", initial.destinationCageId ?? "", ...initial.items.map((item) => item.sourceCageId ?? "")],
        animalIds: initial.items.map((item) => item.animalId),
      });

      const current = await getCurrentTransferPacket(tx, initial.id);
      const latestPacket = await tx.labTransferPacket.findFirst({
        where: { requestId: initial.id },
        orderBy: { version: "desc" },
      });
      if (!current || !latestPacket) return { ok: false as const, code: "not_found", message: "Transfer request not found." };
      const request = current.request;
      if (!isTransferAcceptanceCurrent({
        status: request.status,
        packetVersion: request.packetVersion,
        packetHash: latestPacket.payloadHash,
        acceptedPacketVersion: request.acceptedPacketVersion,
        acceptedPacketHash: request.acceptedPacketHash,
      })) {
        return { ok: false as const, code: "approval_required", message: "The destination lab must accept the current packet before finalization." };
      }
      if (latestPacket.version !== request.packetVersion || current.payloadHash !== latestPacket.payloadHash) {
        return { ok: false as const, code: "packet_stale", message: "Operational details changed after approval. Refresh the packet and obtain destination approval again." };
      }
      if (dateKey(request.requestedEffectiveAt) > dateKey(new Date())) {
        return transferValidationError(`This transfer is scheduled for ${dateKey(request.requestedEffectiveAt)}.`);
      }
      if (!request.sourceLab.active || !request.destinationLab.active) {
        return transferValidationError("Both source and destination labs must remain active.");
      }
      await setTransferCommandContext(tx, {
        requestId: request.id,
        actorId: input.actor.id,
        commandType: "lab_transfer.finalize",
        receiptId,
      });

      const animalIds = request.items.map((item) => item.animal.id);
      const movedAt = request.requestedEffectiveAt;
      let sourceCage: {
        id: string;
        barcode: string;
        labId: string;
        active: boolean;
        status: CageStatus;
        chargePeriods: Array<{ categoryId: string; dailyRateCents: number; startedAt: Date }>;
        animals: Array<{ id: string; owningLabId: string }>;
        quarantineCases: Array<{ id: string }>;
        closure: { id: string } | null;
      } | null = null;
      let destinationCage: {
        id: string;
        barcode: string;
        labId: string;
        active: boolean;
        status: CageStatus;
        capacityOverride: number | null;
        animals: Array<{ id: string; sex: Sex }>;
        quarantineCases: Array<{ id: string }>;
        closure: { id: string } | null;
        room: { facility: { maxCageOccupancy: number } };
      } | null = null;

      if (request.subjectType === "cage") {
        sourceCage = await tx.cage.findUnique({
          where: { id: request.sourceCageId ?? "" },
          select: {
            id: true,
            barcode: true,
            labId: true,
            active: true,
            status: true,
            closure: { select: { id: true } },
            quarantineCases: {
              where: { status: { in: [...OPEN_QUARANTINE_STATUSES] } },
              select: { id: true },
            },
            chargePeriods: {
              where: { endedAt: null },
              orderBy: { startedAt: "desc" },
              take: 1,
              select: { categoryId: true, dailyRateCents: true, startedAt: true },
            },
            animals: {
              where: { outcomeStatus: "alive", status: { notIn: [...TERMINAL_ANIMAL_STATUSES] } },
              select: { id: true, owningLabId: true },
            },
          },
        });
        if (!sourceCage || sourceCage.labId !== request.sourceLabId || !sourceCage.active || sourceCage.status === "closed" || sourceCage.closure) {
          return transferValidationError("The source cage is no longer transferable.");
        }
        if (sourceCage.quarantineCases.length) {
          return transferValidationError("Release or cancel the open quarantine case before finalization.");
        }
        const currentIds = sourceCage.animals.map((animal) => animal.id).sort();
        const approvedIds = [...animalIds].sort();
        if (JSON.stringify(currentIds) !== JSON.stringify(approvedIds) || sourceCage.animals.some((animal) => animal.owningLabId !== request.sourceLabId)) {
          return { ok: false as const, code: "packet_stale", message: "The cage occupants changed. Refresh the packet and obtain destination approval again." };
        }
      } else {
        if (!request.destinationCageId) return transferValidationError("The accepted packet has no destination cage.");
        const [approvedDestination, mixedSexRule] = await Promise.all([tx.cage.findUnique({
          where: { id: request.destinationCageId },
          select: {
            id: true,
            barcode: true,
            labId: true,
            active: true,
            status: true,
            capacityOverride: true,
            closure: { select: { id: true } },
            room: { select: { facility: { select: { maxCageOccupancy: true } } } },
            animals: { where: { outcomeStatus: "alive" }, select: { id: true, sex: true } },
            quarantineCases: {
              where: { status: { in: [...OPEN_QUARANTINE_STATUSES] } },
              select: { id: true },
            },
          },
        }), tx.ruleConfig.findUnique({
          where: { key: "mixed_sex_holding_allowed" },
          select: { value: true },
        })]);
        destinationCage = approvedDestination;
        if (!destinationCage || destinationCage.labId !== request.destinationLabId || !destinationCage.active || ["closed", "retired"].includes(destinationCage.status) || destinationCage.closure || destinationCage.quarantineCases.length) {
          return transferValidationError("The approved destination cage is no longer available.");
        }
        const destinationKey = `existing:${destinationCage.id}`;
        const destination = {
          key: destinationKey,
          label: destinationCage.barcode,
          status: destinationCage.status,
          occupants: destinationCage.animals,
        };
        const quarantineError = validateQuarantineAssignments({
          workflow: "new",
          destinations: [destination],
          usedDestinationKeys: new Set([destinationKey]),
        });
        if (quarantineError) return transferValidationError(quarantineError);
        const sexError = validateProjectedSexComposition({
          destinations: [destination],
          incoming: request.items.map((item) => ({
            subjectId: item.animal.id,
            sex: item.animal.sex,
            destinationKey,
          })),
          mixedSexHoldingAllowed: mixedSexRule?.value === true,
        });
        if (sexError) return transferValidationError(sexError);
        const capacity = getCageCapacityState({
          facilityLimit: destinationCage.room.facility.maxCageOccupancy,
          cageOverride: destinationCage.capacityOverride,
          occupantCount: destinationCage.animals.length,
        });
        if (animalIds.length > capacity.remainingCapacity) {
          return transferValidationError(`The approved destination cage now has only ${capacity.remainingCapacity} spaces.`);
        }
        const animals = await tx.animal.findMany({
          where: { id: { in: animalIds } },
          select: {
            id: true,
            animalId: true,
            owningLabId: true,
            currentCageId: true,
            outcomeStatus: true,
            status: true,
            currentCage: {
              select: {
                quarantineCases: {
                  where: { status: { in: [...OPEN_QUARANTINE_STATUSES] } },
                  take: 1,
                  select: { id: true },
                },
              },
            },
          },
        });
        if (
          animals.length !== animalIds.length
          || animals.some((animal) => (
            animal.owningLabId !== request.sourceLabId
            || animal.outcomeStatus !== "alive"
            || TERMINAL_ANIMAL_STATUSES.includes(animal.status as (typeof TERMINAL_ANIMAL_STATUSES)[number])
            || animal.currentCage?.quarantineCases.length
          ))
        ) {
          return transferValidationError("One or more approved animals are no longer transferable.");
        }
      }

      const blockers = await getTransferBlockers(tx, animalIds);
      const overrideReason = input.command.overrideReason?.trim() || null;
      const plannedProcedureBlockers = blockers.blockers.filter((blocker) => blocker.kind === "procedure_plan");
      if (plannedProcedureBlockers.length) {
        return {
          ok: false as const,
          code: "active_relationships",
          message: "Cancel each planned procedure before transferring the animal to another lab.",
          result: { blockers: plannedProcedureBlockers } as unknown as Prisma.InputJsonValue,
        };
      }
      if (blockers.blockers.length && !overrideReason) {
        return {
          ok: false as const,
          code: "active_relationships",
          message: "Active experiment, project, or breeding relationships block this transfer.",
          result: { blockers: blockers.blockers } as unknown as Prisma.InputJsonValue,
        };
      }
      if (blockers.blockers.length) {
        if (!canOverrideLabTransferBlocks(input.actor)) {
          return { ok: false as const, code: "override_forbidden", message: "Only the Facility Admin can override active research relationships." };
        }
        if (!overrideReason || overrideReason.length < 10) {
          return transferValidationError("Enter a detailed Facility override reason of at least 10 characters.");
        }
        await applyTransferOverride(tx, {
          actor: input.actor,
          requestId: request.id,
          movedAt,
          reason: overrideReason,
          blockers,
          packetVersion: request.packetVersion,
        });
      } else if (overrideReason) {
        return transferValidationError("No active relationship override is required for this transfer.");
      }

      if (request.subjectType === "cage" && sourceCage) {
        const categoryId = sourceCage.chargePeriods[0]?.categoryId ?? await getDefaultChargeCategoryId(tx);
        if (!categoryId) return transferValidationError("Create an active cage charge category before finalization.");
        if (sourceCage.chargePeriods[0]?.startedAt && sourceCage.chargePeriods[0].startedAt > movedAt) {
          return transferValidationError("The active cage charge period starts after the transfer time.");
        }
        await endActiveCageResponsibilities(tx, {
          cageId: sourceCage.id,
          labId: request.sourceLabId,
          receiptId,
          actorId: input.actor.id,
          commandType: "lab_transfer.finalize",
          endedAt: movedAt,
          reason: `Cage transfer finalized under request ${request.id}.`,
        });
        await tx.cage.update({
          where: { id: sourceCage.id },
          data: { labId: request.destinationLabId, lastUpdatedAt: movedAt, version: { increment: 1 } },
        });
        if (animalIds.length) {
          const updatedAnimals = await tx.animal.updateMany({
            where: { id: { in: animalIds }, owningLabId: request.sourceLabId, outcomeStatus: "alive" },
            data: { owningLabId: request.destinationLabId, version: { increment: 1 } },
          });
          if (updatedAnimals.count !== animalIds.length) throw new Error("Transfer subjects changed during finalization.");
          await tx.animalLabTransfer.createMany({
            data: animalIds.map((animalId) => ({
              id: randomUUID(),
              requestId: request.id,
              animalId,
              fromLabId: request.sourceLabId,
              toLabId: request.destinationLabId,
              movedById: input.actor.id,
              movedAt,
              reason: `Cage ${sourceCage!.barcode} transferred: ${request.reason}`,
            })),
          });
        }
        await tx.cageLabTransfer.create({
          data: {
            id: randomUUID(),
            requestId: request.id,
            cageId: sourceCage.id,
            fromLabId: request.sourceLabId,
            toLabId: request.destinationLabId,
            movedById: input.actor.id,
            movedAt,
            reason: request.reason,
          },
        });
        await startReplacementChargePeriod(tx, {
          cageId: sourceCage.id,
          labId: request.destinationLabId,
          categoryId,
          dailyRateCents: sourceCage.chargePeriods[0]?.dailyRateCents,
          timestamp: movedAt,
          notes: `Lab transfer request ${request.id}.`,
        });
      } else if (request.subjectType === "animals" && destinationCage) {
        const animals = await tx.animal.findMany({
          where: { id: { in: animalIds } },
          select: { id: true, currentCageId: true },
        });
        for (const animal of animals) {
          await tx.animal.update({
            where: { id: animal.id },
            data: {
              owningLabId: request.destinationLabId,
              currentCageId: destinationCage.id,
              version: { increment: 1 },
            },
          });
          await tx.animalMovement.create({
            data: {
              id: randomUUID(),
              requestId: request.id,
              animalId: animal.id,
              fromCageId: animal.currentCageId,
              toCageId: destinationCage.id,
              movedById: input.actor.id,
              movedAt,
              reason: `Cross-lab transfer ${request.id}: ${request.reason}`,
            },
          });
          await tx.animalLabTransfer.create({
            data: {
              id: randomUUID(),
              requestId: request.id,
              animalId: animal.id,
              fromLabId: request.sourceLabId,
              toLabId: request.destinationLabId,
              movedById: input.actor.id,
              movedAt,
              reason: request.reason,
            },
          });
        }
        const touchedCages = [...new Set([destinationCage.id, ...animals.map((animal) => animal.currentCageId).filter((id): id is string => Boolean(id))])];
        await tx.cage.updateMany({
          where: { id: { in: touchedCages } },
          data: { lastUpdatedAt: movedAt, version: { increment: 1 } },
        });
      }

      await resolveNotificationsForOwnershipChangeInTransaction(tx, {
        sourceLabId: request.sourceLabId,
        cageIds: request.subjectType === "cage" && sourceCage ? [sourceCage.id] : [],
        animalIds,
        resolvedAt: movedAt,
      });

      const finalized = await tx.labTransferRequest.update({
        where: { id: request.id },
        data: {
          status: "finalized",
          finalizedById: input.actor.id,
          finalizedAt: movedAt,
          overrideApprovedById: blockers.blockers.length ? input.actor.id : null,
          overrideApprovedAt: blockers.blockers.length ? movedAt : null,
          overrideReason: blockers.blockers.length ? overrideReason : null,
          version: { increment: 1 },
        },
        select: { version: true },
      });
      await tx.labTransferItem.updateMany({ where: { requestId: request.id, active: true }, data: { active: false } });
      await createTransferEvent(tx, {
        requestId: request.id,
        eventType: "finalized",
        actor: input.actor,
        packetVersion: request.packetVersion,
        reason: request.reason,
        metadata: {
          subjectType: request.subjectType,
          animalCount: animalIds.length,
          sourceCageId: request.sourceCageId,
          destinationCageId: request.destinationCageId,
          overrideApplied: blockers.blockers.length > 0,
        },
      });
      await auditTransfer(tx, {
        requestId: request.id,
        actor: input.actor,
        action: "finalize",
        previousValue: { status: request.status, version: request.version, sourceLabId: request.sourceLabId },
        newValue: {
          status: "finalized",
          version: finalized.version,
          destinationLabId: request.destinationLabId,
          finalizedAt: movedAt.toISOString(),
          overrideApplied: blockers.blockers.length > 0,
        },
      });
      return {
        ok: true as const,
        result: { requestId: request.id, message: "Transfer finalized. Ownership and billing are now updated." },
        aggregateType: "lab_transfer_request",
        aggregateId: request.id,
        resultingVersion: finalized.version,
      };
    },
  });
}
