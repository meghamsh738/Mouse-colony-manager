import type { Prisma } from "@prisma/client";

import { actorHasCapability } from "@/lib/capabilities";
import {
  canCancelLabTransfer,
  canDecideLabTransfer,
  canFinalizeLabTransfer,
  canOverrideLabTransferBlocks,
  canRequestLabTransfer,
  canReviseLabTransfer,
  type DestinationTransferPacket,
} from "@/lib/lab-transfer-state-machine";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";

function isDestinationTransferPacket(value: Prisma.JsonValue): value is DestinationTransferPacket {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof value.requestId === "string"
    && Array.isArray(value.animals),
  );
}

function requestVisibilityWhere(actor: ResolvedActor): Prisma.LabTransferRequestWhereInput {
  if (actor.canonicalRole === "facility_admin" || actor.canonicalRole === "cmu_staff") return {};
  if (actor.canonicalRole === "lab_user" && actor.activeLabId) {
    return { OR: [{ sourceLabId: actor.activeLabId }, { destinationLabId: actor.activeLabId }] };
  }
  return { id: "__none__" };
}

function mayReadSourcePrivateNote(actor: ResolvedActor, sourceLabId: string) {
  return actor.canonicalRole === "facility_admin"
    || (actor.canonicalRole === "lab_user" && actor.activeLabId === sourceLabId);
}

function mayReadDestinationOperationalDetails(actor: ResolvedActor, destinationLabId: string) {
  return actor.canonicalRole === "facility_admin"
    || actor.canonicalRole === "cmu_staff"
    || (actor.canonicalRole === "lab_user" && actor.activeLabId === destinationLabId);
}

export async function getLabTransferRequestOptions(actor: ResolvedActor) {
  const sourceLabId = actor.activeLabId;
  if (!sourceLabId || !canRequestLabTransfer(actor, sourceLabId)) {
    return { canRequest: false as const, sourceLab: null, destinationLabs: [] };
  }
  const [sourceLab, destinationLabs] = await Promise.all([
    prisma.lab.findUnique({ where: { id: sourceLabId }, select: { id: true, name: true, code: true, active: true } }),
    prisma.lab.findMany({
      where: { active: true, id: { not: sourceLabId } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, code: true },
    }),
  ]);
  if (!sourceLab?.active) return { canRequest: false as const, sourceLab: null, destinationLabs: [] };
  return { canRequest: true as const, sourceLab, destinationLabs };
}

export async function getLabTransferWorkspace(actor: ResolvedActor) {
  if (!actorHasCapability(actor, "transfers:read")) {
    return { requests: [], counts: { waitingOnDestination: 0, waitingOnCmu: 0, blocked: 0 } };
  }
  const requests = await prisma.labTransferRequest.findMany({
    where: requestVisibilityWhere(actor),
    orderBy: [{ status: "asc" }, { requestedAt: "desc" }, { id: "asc" }],
    include: {
      sourceLab: { select: { id: true, name: true, code: true } },
      destinationLab: { select: { id: true, name: true, code: true } },
      requestedBy: { select: { name: true } },
      destinationDecisionBy: { select: { name: true } },
      finalizedBy: { select: { name: true } },
      sourceCage: { select: { id: true, barcode: true } },
      destinationCage: { select: { id: true, barcode: true } },
      packets: { orderBy: { version: "desc" }, take: 1, select: { version: true, payloadHash: true, destinationPayload: true } },
      items: { select: { animalId: true } },
      events: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 12,
        select: {
          id: true,
          eventType: true,
          packetVersion: true,
          reason: true,
          createdAt: true,
          actor: { select: { name: true } },
        },
      },
    },
  });

  const animalIds = [...new Set(requests.flatMap((request) => request.items.map((item) => item.animalId)))];
  const [assignmentRows, allocationRows, breedingRows] = animalIds.length
    ? await Promise.all([
        prisma.experimentAssignment.findMany({
          where: { animalId: { in: animalIds }, status: { notIn: ["completed", "cancelled"] } },
          select: { animalId: true },
        }),
        prisma.animalProjectAllocation.findMany({
          where: { animalId: { in: animalIds }, endedAt: null },
          select: { animalId: true },
        }),
        prisma.breedingAdult.findMany({
          where: {
            animalId: { in: animalIds },
            breedingSetup: { status: { in: ["planned", "active", "paused"] } },
          },
          select: { animalId: true },
        }),
      ])
    : [[], [], []];
  const blockerCount = (requestAnimalIds: string[], rows: Array<{ animalId: string }>) => {
    const subjects = new Set(requestAnimalIds);
    return rows.filter((row) => subjects.has(row.animalId)).length;
  };

  const projected = await Promise.all(requests.map(async (request) => {
    const packetRow = request.packets[0];
    const rawPacket = packetRow && isDestinationTransferPacket(packetRow.destinationPayload)
      ? packetRow.destinationPayload
      : null;
    const canReadDestinationDetails = mayReadDestinationOperationalDetails(actor, request.destinationLabId);
    const packet = rawPacket
      ? {
          ...rawPacket,
          destinationCage: canReadDestinationDetails ? rawPacket.destinationCage : null,
        }
      : null;
    const canDecide = canDecideLabTransfer(actor, request.destinationLabId) && request.status === "requested";
    const destinationCages = canDecide && request.subjectType === "animals"
      ? await prisma.cage.findMany({
          where: {
            labId: request.destinationLabId,
            active: true,
            status: { not: "closed" },
            closure: null,
            quarantineCases: {
              none: { status: { in: ["admitted", "under_observation", "exception_open", "release_requested"] } },
            },
          },
          orderBy: [{ room: { roomNumber: "asc" } }, { rack: { rackNumber: "asc" } }, { cageNumber: "asc" }],
          select: {
            id: true,
            barcode: true,
            capacityOverride: true,
            room: { select: { roomNumber: true, facility: { select: { maxCageOccupancy: true } } } },
            rack: { select: { rackNumber: true } },
            cageNumber: true,
            _count: { select: { animals: { where: { outcomeStatus: "alive" } } } },
          },
        })
      : [];
    const requestAnimalIds = request.items.map((item) => item.animalId);
    const blockers = {
      experiments: blockerCount(requestAnimalIds, assignmentRows),
      projects: blockerCount(requestAnimalIds, allocationRows),
      breeding: blockerCount(requestAnimalIds, breedingRows),
    };
    return {
      id: request.id,
      subjectType: request.subjectType,
      status: request.status,
      version: request.version,
      packetVersion: request.packetVersion,
      acceptedPacketVersion: request.acceptedPacketVersion,
      packetHash: packetRow?.payloadHash ?? null,
      sourceLab: request.sourceLab,
      destinationLab: request.destinationLab,
      sourceCage: request.sourceCage,
      destinationCage: canReadDestinationDetails ? request.destinationCage : null,
      reason: request.reason,
      sourcePrivateNote: mayReadSourcePrivateNote(actor, request.sourceLabId) ? request.sourcePrivateNote : null,
      requestedEffectiveAt: request.requestedEffectiveAt,
      requestedAt: request.requestedAt,
      requestedBy: request.requestedBy.name,
      destinationDecisionAt: request.destinationDecisionAt,
      destinationDecisionBy: request.destinationDecisionBy?.name ?? null,
      destinationDecisionNote: request.destinationDecisionNote,
      finalizedAt: request.finalizedAt,
      finalizedBy: request.finalizedBy?.name ?? null,
      overrideReason: request.overrideReason,
      packet,
      animalCount: request.items.length,
      blockers,
      events: request.events,
      destinationCages: destinationCages.map((cage) => ({
        id: cage.id,
        barcode: cage.barcode,
        location: `${cage.room.roomNumber} / ${cage.rack.rackNumber} / ${cage.cageNumber}`,
        occupancy: cage._count.animals,
        capacity: Math.min(cage.room.facility.maxCageOccupancy, cage.capacityOverride ?? cage.room.facility.maxCageOccupancy, 6),
      })),
      actions: {
        canDecide,
        canRevise: canRequestLabTransfer(actor, request.sourceLabId) && canReviseLabTransfer(request.status),
        canCancel: canRequestLabTransfer(actor, request.sourceLabId) && canCancelLabTransfer(request.status),
        canFinalize: canFinalizeLabTransfer(actor) && request.status === "destination_accepted",
        canOverride: canOverrideLabTransferBlocks(actor),
      },
    };
  }));

  return {
    requests: projected,
    counts: {
      waitingOnDestination: projected.filter((request) => request.status === "requested").length,
      waitingOnCmu: projected.filter((request) => request.status === "destination_accepted").length,
      blocked: projected.filter((request) => (
        request.status === "destination_accepted"
        && request.blockers.experiments + request.blockers.projects + request.blockers.breeding > 0
      )).length,
    },
  };
}
