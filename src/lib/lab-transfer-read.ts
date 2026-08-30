import type { Prisma } from "@prisma/client";

import { actorHasCapability } from "@/lib/capabilities";
import { correctedString, correctionMarker, getAppliedCorrectionProjectionMap } from "@/lib/correction-read";
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

function activeTransferProtocolWhere(actor: ResolvedActor, labIds: string[]): Prisma.ProtocolAuthorizationWhereInput {
  const now = new Date();
  return {
    labId: { in: labIds },
    status: "active",
    currentVersion: {
      validFrom: { lte: now },
      validUntil: { gt: now },
      procedureBindings: { some: { procedureCode: "transfer" } },
      personnelBindings: {
        some: { userId: actor.id, roleLabel: "transfer_coordinator" },
      },
    },
  };
}

const transferProtocolSelect = {
  id: true,
  labId: true,
  protocolCode: true,
  title: true,
  currentVersion: {
    select: {
      validUntil: true,
      strainBindings: { select: { strainId: true } },
    },
  },
} satisfies Prisma.ProtocolAuthorizationSelect;

function protocolOption(protocol: {
  id: string;
  labId: string;
  protocolCode: string;
  title: string;
  currentVersion: { validUntil: Date; strainBindings: Array<{ strainId: string }> } | null;
}) {
  return {
    id: protocol.id,
    labId: protocol.labId,
    label: `${protocol.protocolCode} — ${protocol.title}`,
    validUntil: protocol.currentVersion!.validUntil.toISOString(),
    strainIds: protocol.currentVersion!.strainBindings.map((binding) => binding.strainId),
  };
}

export async function getLabTransferRequestOptions(actor: ResolvedActor) {
  const sourceLabId = actor.activeLabId;
  if (!sourceLabId || !canRequestLabTransfer(actor, sourceLabId)) {
    return { canRequest: false as const, sourceLab: null, destinationLabs: [], sourceProtocols: [] };
  }
  const [sourceLab, destinationLabs, sourceProtocols] = await Promise.all([
    prisma.lab.findUnique({ where: { id: sourceLabId }, select: { id: true, name: true, code: true, active: true } }),
    prisma.lab.findMany({
      where: { active: true, id: { not: sourceLabId } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, code: true },
    }),
    prisma.protocolAuthorization.findMany({
      where: activeTransferProtocolWhere(actor, [sourceLabId]),
      orderBy: { protocolCode: "asc" },
      select: transferProtocolSelect,
      take: 100,
    }),
  ]);
  if (!sourceLab?.active) return { canRequest: false as const, sourceLab: null, destinationLabs: [], sourceProtocols: [] };
  return { canRequest: true as const, sourceLab, destinationLabs, sourceProtocols: sourceProtocols.map(protocolOption) };
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
      items: { select: { animalId: true, animal: { select: { strainId: true } } } },
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
  const transferCorrections = await getAppliedCorrectionProjectionMap(
    "cross_lab_transfer",
    requests.map((request) => ({ id: request.id, labIds: [request.sourceLabId, request.destinationLabId] })),
  );

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

  const destinationLabIdsNeedingDecision = [...new Set(
    requests
      .filter((request) => (
        request.status === "requested"
        && canDecideLabTransfer(actor, request.destinationLabId)
      ))
      .map((request) => request.destinationLabId),
  )];
  const destinationLabIdsNeedingCages = [...new Set(
    requests
      .filter((request) => request.subjectType === "animals" && destinationLabIdsNeedingDecision.includes(request.destinationLabId))
      .map((request) => request.destinationLabId),
  )];
  const destinationCageRows = destinationLabIdsNeedingCages.length
    ? await prisma.cage.findMany({
      where: {
        labId: { in: destinationLabIdsNeedingCages },
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
        labId: true,
        room: { select: { roomNumber: true, facility: { select: { maxCageOccupancy: true } } } },
        rack: { select: { rackNumber: true } },
        cageNumber: true,
        _count: { select: { animals: { where: { outcomeStatus: "alive" } } } },
      },
    })
    : [];
  const destinationProtocolRows = destinationLabIdsNeedingDecision.length
    ? await prisma.protocolAuthorization.findMany({
        where: activeTransferProtocolWhere(actor, destinationLabIdsNeedingDecision),
        orderBy: [{ labId: "asc" }, { protocolCode: "asc" }],
        select: transferProtocolSelect,
        take: 500,
      })
    : [];
  const destinationCagesByLabId = new Map<string, typeof destinationCageRows>();
  for (const cage of destinationCageRows) {
    const cages = destinationCagesByLabId.get(cage.labId) ?? [];
    cages.push(cage);
    destinationCagesByLabId.set(cage.labId, cages);
  }

  const projected = requests.map((request) => {
    const correction = transferCorrections.get(request.id);
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
      ? destinationCagesByLabId.get(request.destinationLabId) ?? []
      : [];
    const requestAnimalIds = request.items.map((item) => item.animalId);
    const requestStrainIds = [...new Set(request.items.map((item) => item.animal.strainId))];
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
      reason: correctedString(correction, "reason", request.reason),
      sourcePrivateNote: mayReadSourcePrivateNote(actor, request.sourceLabId) ? request.sourcePrivateNote : null,
      requestedEffectiveAt: new Date(correctedString(correction, "requestedEffectiveAt", request.requestedEffectiveAt.toISOString())),
      requestedAt: request.requestedAt,
      requestedBy: request.requestedBy.name,
      destinationDecisionAt: request.destinationDecisionAt,
      destinationDecisionBy: request.destinationDecisionBy?.name ?? null,
      destinationDecisionNote: request.destinationDecisionNote,
      finalizedAt: request.finalizedAt,
      finalizedBy: request.finalizedBy?.name ?? null,
      overrideReason: request.overrideReason,
      correction: correctionMarker(correction),
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
      destinationProtocols: destinationProtocolRows
        .filter((protocol) => protocol.labId === request.destinationLabId)
        .map(protocolOption)
        .filter((protocol) => requestStrainIds.every((strainId) => protocol.strainIds.includes(strainId)))
        .map(({ id, labId, label, validUntil }) => ({ id, labId, label, validUntil })),
      actions: {
        canDecide,
        canRevise: canRequestLabTransfer(actor, request.sourceLabId) && canReviseLabTransfer(request.status),
        canCancel: canRequestLabTransfer(actor, request.sourceLabId) && canCancelLabTransfer(request.status),
        canFinalize: canFinalizeLabTransfer(actor) && request.status === "destination_accepted",
        canOverride: canOverrideLabTransferBlocks(actor),
      },
    };
  });

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
