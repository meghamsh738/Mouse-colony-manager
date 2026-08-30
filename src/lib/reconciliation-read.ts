import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";

function unitScoped(actor: ResolvedActor) {
  return actor.canonicalRole === "facility_admin" || actor.canonicalRole === "cmu_staff" || Boolean(actor.activeDuties?.includes("designated_veterinarian"));
}

function labWhere(actor: ResolvedActor) {
  return unitScoped(actor) ? {} : { labId: actor.activeLabId ?? "__no_lab__" };
}

export async function getReconciliationWorkspace(actor: ResolvedActor) {
  const scope = labWhere(actor);
  const transferScope = unitScoped(actor)
    ? {}
    : { OR: [{ sourceLabId: actor.activeLabId ?? "__no_lab__" }, { destinationLabId: actor.activeLabId ?? "__no_lab__" }] };
  const [manifests, censusSessions, discrepancies, capacityExceptions, custodyEvents, custodyReconciliations] = await Promise.all([
    prisma.shipmentManifest.findMany({ where: scope, orderBy: [{ expectedAt: "desc" }, { id: "desc" }], take: 50 }),
    prisma.censusSession.findMany({ where: scope, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 50 }),
    prisma.censusDiscrepancy.findMany({ where: scope, orderBy: [{ status: "asc" }, { id: "desc" }], take: 100 }),
    prisma.cageCapacityException.findMany({ where: scope, orderBy: [{ expiresAt: "asc" }, { id: "desc" }], take: 100 }),
    prisma.transferCustodyEvent.findMany({ where: transferScope, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100 }),
    prisma.transferCustodyReconciliation.findMany({ where: scope, orderBy: [{ status: "asc" }, { id: "desc" }], take: 100 }),
  ]);
  const manifestIds = manifests.map((manifest) => manifest.id);
  const sessionIds = censusSessions.map((session) => session.id);
  const [items, receiptSessions, receiptObservations, healthEvidence, healthDecisions, summaries, censusObservations] = await Promise.all([
    prisma.shipmentManifestItem.findMany({ where: { manifestId: { in: manifestIds } }, orderBy: [{ manifestId: "asc" }, { expectedIdentifier: "asc" }] }),
    prisma.shipmentReceiptSession.findMany({ where: { manifestId: { in: manifestIds } }, orderBy: [{ startedAt: "desc" }, { id: "desc" }] }),
    prisma.shipmentReceiptObservation.findMany({ where: { manifestId: { in: manifestIds } }, orderBy: [{ observedAt: "desc" }, { id: "desc" }] }),
    prisma.shipmentHealthEvidence.findMany({ where: { manifestId: { in: manifestIds } }, orderBy: [{ issuedAt: "desc" }, { id: "desc" }] }),
    prisma.shipmentHealthDecision.findMany({ where: { manifestId: { in: manifestIds } }, orderBy: [{ decidedAt: "desc" }, { id: "desc" }] }),
    prisma.shipmentReconciliationSummary.findMany({ where: { manifestId: { in: manifestIds } } }),
    prisma.censusObservation.findMany({ where: { sessionId: { in: sessionIds } }, orderBy: [{ observedAt: "desc" }, { id: "desc" }] }),
  ]);
  const labIds = [...new Set([
    ...manifests.map((item) => item.labId), ...censusSessions.map((item) => item.labId), ...capacityExceptions.map((item) => item.labId),
    ...custodyEvents.flatMap((item) => [item.sourceLabId, item.destinationLabId]),
  ])];
  const labs = await prisma.lab.findMany({ where: { id: { in: labIds } }, select: { id: true, name: true, code: true } });
  const labMap = new Map(labs.map((lab) => [lab.id, lab]));
  const summaryMap = new Map(summaries.map((summary) => [summary.manifestId, summary]));

  const canManage = actor.capabilities.includes("reconciliation:manage");
  const canApprove = actor.capabilities.includes("reconciliation:approve");
  const optionLabIds = unitScoped(actor) ? undefined : [actor.activeLabId ?? "__no_lab__"];
  const [optionLabs, strains, protocols, cages, rooms, owners, transfers] = canManage ? await Promise.all([
    prisma.lab.findMany({ where: { active: true, ...(optionLabIds ? { id: { in: optionLabIds } } : {}) }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
    prisma.strain.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.protocolAuthorization.findMany({ where: { status: "active", ...(optionLabIds ? { labId: { in: optionLabIds } } : {}) }, orderBy: { protocolCode: "asc" }, select: { id: true, labId: true, protocolCode: true, title: true } }),
    prisma.cage.findMany({ where: { active: true, ...(optionLabIds ? { labId: { in: optionLabIds } } : {}) }, orderBy: { barcode: "asc" }, select: { id: true, labId: true, barcode: true, status: true, animals: { where: { outcomeStatus: "alive" }, select: { id: true } }, quarantineCases: { where: { status: { in: ["admitted", "under_observation", "exception_open", "release_requested"] } }, select: { id: true } } } }),
    prisma.room.findMany({ orderBy: { roomNumber: "asc" }, select: { id: true, facilityId: true, roomNumber: true } }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.labTransferRequest.findMany({ where: { ...(optionLabIds ? { OR: [{ sourceLabId: { in: optionLabIds } }, { destinationLabId: { in: optionLabIds } }] } : {}), status: { in: ["destination_accepted", "finalized"] } }, orderBy: { requestedAt: "desc" }, take: 50, select: { id: true, sourceLabId: true, destinationLabId: true, status: true, version: true, reason: true, items: { where: { active: true }, orderBy: { id: "asc" }, select: { animalId: true, animal: { select: { facilityAnimalId: true } } } } } }),
  ]) : [[], [], [], [], [], [], []];

  return {
    policyMarker: "synthetic-fail-closed-m16",
    permissions: { canManage, canApprove, canRelease: actor.capabilities.includes("quarantine:release") },
    manifests: manifests.map((manifest) => ({
      ...manifest,
      expectedAt: manifest.expectedAt.toISOString(),
      createdAt: manifest.createdAt.toISOString(),
      updatedAt: manifest.updatedAt.toISOString(),
      lab: labMap.get(manifest.labId) ?? null,
      items: items.filter((item) => item.manifestId === manifest.id).map((item) => ({ ...item, expectedDob: item.expectedDob.toISOString().slice(0, 10), createdAt: item.createdAt.toISOString() })),
      sessions: receiptSessions.filter((session) => session.manifestId === manifest.id).map((session) => ({ ...session, startedAt: session.startedAt.toISOString(), finalizedAt: session.finalizedAt?.toISOString() ?? null })),
      observations: receiptObservations.filter((row) => row.manifestId === manifest.id).map((row) => ({ ...row, observedDob: row.observedDob?.toISOString().slice(0, 10) ?? null, observedAt: row.observedAt.toISOString() })),
      healthEvidence: healthEvidence.filter((row) => row.manifestId === manifest.id).map((row) => ({ ...row, collectedAt: row.collectedAt.toISOString().slice(0, 10), issuedAt: row.issuedAt.toISOString(), recordedAt: row.recordedAt.toISOString() })),
      healthDecisions: healthDecisions.filter((row) => row.manifestId === manifest.id).map((row) => ({ ...row, evidenceLatestAt: row.evidenceLatestAt.toISOString(), authenticatedAt: row.authenticatedAt.toISOString(), decidedAt: row.decidedAt.toISOString() })),
      reconciliation: summaryMap.get(manifest.id) ? { ...summaryMap.get(manifest.id)!, finalizedAt: summaryMap.get(manifest.id)!.finalizedAt.toISOString() } : null,
    })),
    censusSessions: censusSessions.map((session) => ({ ...session, startedAt: session.startedAt.toISOString(), signedOffAt: session.signedOffAt?.toISOString() ?? null, lab: labMap.get(session.labId) ?? null, observations: censusObservations.filter((row) => row.sessionId === session.id).map((row) => ({ ...row, observedAt: row.observedAt.toISOString() })) })),
    discrepancies: discrepancies.map((row) => ({ ...row, resolvedAt: row.resolvedAt?.toISOString() ?? null, signedOffAt: row.signedOffAt?.toISOString() ?? null })),
    capacityExceptions: capacityExceptions.map((row) => ({ ...row, startsAt: row.startsAt.toISOString(), expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), current: row.status === "active" && row.startsAt <= new Date() && row.expiresAt > new Date() })),
    custodyEvents: custodyEvents.map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString(), sourceLab: labMap.get(row.sourceLabId) ?? null, destinationLab: labMap.get(row.destinationLabId) ?? null })),
    custodyReconciliations: custodyReconciliations.map((row) => ({ ...row, resolvedAt: row.resolvedAt?.toISOString() ?? null, signedOffAt: row.signedOffAt?.toISOString() ?? null })),
    options: { activeLabId: actor.activeLabId, unitScoped: unitScoped(actor), labs: optionLabs, strains, protocols, cages, quarantineCages: cages.filter((cage) => cage.status === "quarantine" && cage.animals.length === 0 && cage.quarantineCases.length === 0), rooms, owners, transfers },
  };
}
