import type { CorrectionDomain, Prisma } from "@prisma/client";

import { actorHasCapability } from "@/lib/capabilities";
import { CORRECTION_DOMAIN_CAPABILITIES, CORRECTION_POLICY_MARKER } from "@/lib/correction-state-machine";
import { getActiveFacilityDutiesAtDatabaseTime } from "@/lib/facility-duty-auth";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";

export async function getCorrectionWorkspace(actor: ResolvedActor) {
  if (!actorHasCapability(actor, "corrections:read")) {
    return { access: "none" as const, policyMarker: CORRECTION_POLICY_MARKER, requests: [], labs: [], targetOptions: [] };
  }
  const duties = await getActiveFacilityDutiesAtDatabaseTime(prisma, actor.id);
  const steward = duties.includes("data_steward");
  const requestWhere = steward
    ? {}
    : actor.canonicalRole === "lab_user"
      ? { requestedById: actor.id, labId: actor.activeLabId ?? "__none__" }
      : { requestedById: actor.id };
  const labsWhere = actor.canonicalRole === "lab_user"
    ? { id: actor.activeLabId ?? "__none__", active: true }
    : { active: true };
  const [requests, labs] = await Promise.all([
    prisma.correctionRequest.findMany({
      where: requestWhere,
      orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
      take: 100,
      select: {
        id: true, labId: true, domain: true, targetEntityType: true, targetEntityId: true,
        sourceEventAt: true, reason: true, originalSnapshot: true, proposedCorrection: true,
        status: true, blockCode: true, blockDetail: true, policyMarker: true, requestedAt: true,
        decidedAt: true, decisionReason: true, version: true,
        lab: { select: { code: true, name: true } },
        requestedBy: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
        supersession: { select: { effectiveProjection: true, appliedAt: true } },
        reconciliation: { select: { downstreamRecords: true, result: true, physicalMutationRequired: true, reconciledAt: true } },
        lifecycleEvents: { orderBy: { occurredAt: "asc" }, select: { eventType: true, fromStatus: true, toStatus: true, actorId: true, occurredAt: true } },
      },
    }),
    prisma.lab.findMany({ where: labsWhere, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  const targetOptions = actorHasCapability(actor, "corrections:request")
    ? await getAuthorizedCorrectionTargetOptions(actor, labs.map((lab) => lab.id))
    : [];
  return { access: steward ? "data_steward" as const : "requester" as const, policyMarker: CORRECTION_POLICY_MARKER, requests, labs, targetOptions };
}

export type CorrectionTargetOption = {
  key: string;
  domain: CorrectionDomain;
  labId: string;
  targetEntityId: string;
  targetVersion: number | null;
  sourceEventAt: string;
  label: string;
};

export type AppliedCorrectionProjection = {
  requestId: string;
  appliedAt: Date;
  effectiveProjection: Prisma.JsonObject;
  correctedFields: readonly string[];
};

function correctedFieldsFromProposal(proposal: Prisma.JsonValue) {
  return proposal && typeof proposal === "object" && !Array.isArray(proposal)
    ? Object.keys(proposal)
    : [];
}

export function correctionMasksField(
  correction: AppliedCorrectionProjection | undefined,
  field: string,
) {
  return correction?.correctedFields.includes(field) ?? false;
}

export async function getAppliedCorrectionProjectionMap(
  domain: CorrectionDomain,
  targets: Array<{ id: string; labIds: readonly string[] }>,
) {
  const allowedLabsByTarget = new Map(targets.map((target) => [target.id, new Set(target.labIds)]));
  const targetIds = [...allowedLabsByTarget.keys()];
  const labIds = [...new Set(targets.flatMap((target) => [...target.labIds]))];
  if (!targetIds.length || !labIds.length) return new Map<string, AppliedCorrectionProjection>();
  const rows = await prisma.correctionSupersession.findMany({
    where: {
      domain,
      targetEntityId: { in: targetIds },
      labId: { in: labIds },
      request: { status: "applied" },
    },
    select: {
      requestId: true, targetEntityId: true, labId: true, appliedAt: true, effectiveProjection: true,
      request: { select: { proposedCorrection: true } },
    },
  });
  return new Map(rows
    .filter((row) => allowedLabsByTarget.get(row.targetEntityId)?.has(row.labId))
    .map((row) => [row.targetEntityId, {
      requestId: row.requestId,
      appliedAt: row.appliedAt,
      effectiveProjection: row.effectiveProjection as Prisma.JsonObject,
      correctedFields: correctedFieldsFromProposal(row.request.proposedCorrection),
    }]));
}

export async function getAppliedCorrectionProjectionMapForAuthorizedEventIds(
  domain: "animal_move" | "animal_lifecycle",
  targetEntityIds: string[],
) {
  const ids = [...new Set(targetEntityIds)];
  if (!ids.length) return new Map<string, AppliedCorrectionProjection>();
  // Callers must obtain these immutable event IDs from an already-authorized animal detail read.
  // The correction's event-era lab remains immutable even if animal ownership later changes.
  const rows = await prisma.correctionSupersession.findMany({
    where: { domain, targetEntityId: { in: ids }, request: { status: "applied" } },
    select: {
      requestId: true, targetEntityId: true, appliedAt: true, effectiveProjection: true,
      request: { select: { proposedCorrection: true } },
    },
  });
  return new Map(rows.map((row) => [row.targetEntityId, {
    requestId: row.requestId,
    appliedAt: row.appliedAt,
    effectiveProjection: row.effectiveProjection as Prisma.JsonObject,
    correctedFields: correctedFieldsFromProposal(row.request.proposedCorrection),
  }]));
}

export function correctedString(
  correction: AppliedCorrectionProjection | undefined,
  field: string,
  fallback: string,
) {
  const value = correctionMasksField(correction, field)
    ? correction?.effectiveProjection[field]
    : undefined;
  return typeof value === "string" ? value : fallback;
}

export function correctedNullableString(
  correction: AppliedCorrectionProjection | undefined,
  field: string,
  fallback: string | null,
) {
  const value = correctionMasksField(correction, field)
    ? correction?.effectiveProjection[field]
    : undefined;
  return value === null || typeof value === "string" ? value : fallback;
}

export function correctionMarker(correction: AppliedCorrectionProjection | undefined) {
  return correction ? { requestId: correction.requestId, appliedAt: correction.appliedAt.toISOString() } : null;
}

async function getAuthorizedCorrectionTargetOptions(actor: ResolvedActor, labIds: string[]): Promise<CorrectionTargetOption[]> {
  if (labIds.length === 0) return [];
  const can = (domain: CorrectionDomain) => actorHasCapability(actor, CORRECTION_DOMAIN_CAPABILITIES[domain]);
  const option = (domain: CorrectionDomain, labId: string, id: string, eventAt: Date, version: number | null, label: string): CorrectionTargetOption => ({
    key: `${domain}:${labId}:${id}`,
    domain,
    labId,
    targetEntityId: id,
    targetVersion: version,
    sourceEventAt: eventAt.toISOString(),
    label,
  });
  const [litters, movements, lifecycleEvents, transfers, procedures, samples] = await Promise.all([
    can("litter_birth") || can("litter_weaning") ? prisma.litter.findMany({
      where: { breedingSetup: { labId: { in: labIds } } }, orderBy: { birthDate: "desc" }, take: 60,
      select: { id: true, birthDate: true, version: true, breedingSetup: { select: { labId: true } } },
    }) : [],
    can("animal_move") ? prisma.animalMovement.findMany({
      where: { animal: { owningLabId: { in: labIds } } }, orderBy: { movedAt: "desc" }, take: 60,
      select: { id: true, movedAt: true, animal: { select: { owningLabId: true } } },
    }) : [],
    can("animal_lifecycle") ? prisma.animalStatusEvent.findMany({
      where: { animal: { owningLabId: { in: labIds } } }, orderBy: { happenedAt: "desc" }, take: 60,
      select: { id: true, happenedAt: true, toStatus: true, animal: { select: { owningLabId: true } } },
    }) : [],
    can("cross_lab_transfer") ? prisma.labTransferRequest.findMany({
      where: { OR: [{ sourceLabId: { in: labIds } }, { destinationLabId: { in: labIds } }] }, orderBy: { requestedAt: "desc" }, take: 60,
      select: { id: true, sourceLabId: true, destinationLabId: true, requestedAt: true, finalizedAt: true, status: true, version: true },
    }) : [],
    can("procedure_occurrence") ? prisma.procedureOccurrence.findMany({
      where: { labId: { in: labIds } }, orderBy: { occurredAt: "desc" }, take: 60,
      select: { id: true, labId: true, occurredAt: true, status: true },
    }) : [],
    can("biosample") ? prisma.sampleRecord.findMany({
      where: { labId: { in: labIds } }, orderBy: { collectedAt: "desc" }, take: 60,
      select: { id: true, labId: true, collectedAt: true, sampleLabel: true, version: true },
    }) : [],
  ]);
  const options: CorrectionTargetOption[] = [];
  for (const row of litters) {
    if (can("litter_birth")) options.push(option("litter_birth", row.breedingSetup.labId, row.id, row.birthDate, row.version, `Litter ${row.id} · birth metadata`));
    if (can("litter_weaning")) options.push(option("litter_weaning", row.breedingSetup.labId, row.id, row.birthDate, row.version, `Litter ${row.id} · structural weaning request`));
  }
  for (const row of movements) options.push(option("animal_move", row.animal.owningLabId, row.id, row.movedAt, null, `Movement ${row.id}`));
  for (const row of lifecycleEvents) options.push(option("animal_lifecycle", row.animal.owningLabId, row.id, row.happenedAt, null, `Lifecycle ${row.id} · ${row.toStatus}`));
  for (const row of transfers) {
    const labId = labIds.includes(row.sourceLabId) ? row.sourceLabId : row.destinationLabId;
    options.push(option("cross_lab_transfer", labId, row.id, row.finalizedAt ?? row.requestedAt, row.version, `Transfer ${row.id} · ${row.status}`));
  }
  for (const row of procedures) options.push(option("procedure_occurrence", row.labId, row.id, row.occurredAt, null, `Procedure ${row.id} · ${row.status}`));
  for (const row of samples) options.push(option("biosample", row.labId, row.id, row.collectedAt, row.version, `Biosample ${row.sampleLabel}`));
  return options;
}

export async function getEffectiveCorrectionProjection(input: {
  actor: ResolvedActor;
  domain: CorrectionDomain;
  targetEntityId: string;
  labId: string;
  baseProjection: Prisma.InputJsonObject;
}) {
  if (!actorHasCapability(input.actor, "corrections:read")) return null;
  if (input.actor.canonicalRole === "lab_user" && input.actor.activeLabId !== input.labId) return null;
  const supersession = await prisma.correctionSupersession.findFirst({
    where: { domain: input.domain, targetEntityId: input.targetEntityId, labId: input.labId, request: { status: "applied" } },
    orderBy: { appliedAt: "desc" },
    select: {
      requestId: true, effectiveProjection: true, appliedAt: true,
      request: { select: { version: true, proposedCorrection: true } },
    },
  });
  if (!supersession) {
    return { projection: input.baseProjection, correctionRequestId: null, correctionVersion: null, appliedAt: null };
  }
  const projection: Record<string, unknown> = { ...input.baseProjection };
  const effective = supersession.effectiveProjection as Prisma.JsonObject;
  for (const field of correctedFieldsFromProposal(supersession.request.proposedCorrection)) {
    if (Object.prototype.hasOwnProperty.call(effective, field)) {
      projection[field] = effective[field] as Prisma.InputJsonValue;
    }
  }
  return { projection: projection as Prisma.InputJsonObject, correctionRequestId: supersession.requestId, correctionVersion: supersession.request.version, appliedAt: supersession.appliedAt };
}
