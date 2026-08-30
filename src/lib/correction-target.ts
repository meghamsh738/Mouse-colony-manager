import { Prisma, type CorrectionDomain } from "@prisma/client";

type QueryClient = Prisma.TransactionClient;

type TargetSnapshot = {
  labId: string;
  targetVersion: number | null;
  sourceEventAt: Date;
  originalSnapshot: Prisma.InputJsonObject;
  downstreamRecords: Prisma.InputJsonArray;
};

type ProposalResult = {
  safe: boolean;
  blockCode: string | null;
  blockDetail: Prisma.InputJsonObject | null;
  effectiveProjection: Prisma.InputJsonObject;
};

const object = (value: Prisma.JsonValue | Prisma.InputJsonValue) => value as Prisma.InputJsonObject;

function date(value: unknown, field: string) {
  if (typeof value !== "string") throw new Error(`${field} must be an ISO date-time string.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be an ISO date-time string.`);
  return parsed.toISOString();
}

function text(value: unknown, field: string, max = 1000) {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${field} must be text or null.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${field} is too long.`);
  return normalized || null;
}

function keysOnly(proposal: Prisma.InputJsonObject, allowed: readonly string[]) {
  const unexpected = Object.keys(proposal).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`Unsupported correction fields: ${unexpected.join(", ")}.`);
  if (!Object.keys(proposal).length) throw new Error("Provide at least one proposed corrected value.");
}

export async function loadCorrectionTarget(
  tx: QueryClient,
  domain: CorrectionDomain,
  targetEntityId: string,
  authorizedLabId: string,
): Promise<TargetSnapshot | null> {
  if (domain === "litter_birth" || domain === "litter_weaning") {
    const row = await tx.litter.findFirst({
      where: { id: targetEntityId, breedingSetup: { labId: authorizedLabId } },
      select: {
        id: true, birthDate: true, litterSizeBirth: true, litterSizeWean: true, notes: true, version: true,
        breedingSetup: { select: { labId: true } },
        litterAnimals: { select: { animalId: true }, orderBy: { animalId: "asc" } },
      },
    });
    if (!row) return null;
    return {
      labId: row.breedingSetup.labId,
      targetVersion: row.version,
      sourceEventAt: row.birthDate,
      originalSnapshot: object({ id: row.id, birthDate: row.birthDate.toISOString(), litterSizeBirth: row.litterSizeBirth, litterSizeWean: row.litterSizeWean, notes: row.notes, version: row.version }),
      downstreamRecords: row.litterAnimals.map((item) => ({ entityType: "Animal", entityId: item.animalId })),
    };
  }
  if (domain === "animal_move") {
    const row = await tx.animalMovement.findFirst({
      where: { id: targetEntityId, animal: { owningLabId: authorizedLabId } },
      select: { id: true, animalId: true, fromCageId: true, toCageId: true, movedAt: true, reason: true, requestId: true },
    });
    if (!row) return null;
    return { labId: authorizedLabId, targetVersion: null, sourceEventAt: row.movedAt,
      originalSnapshot: object({ ...row, movedAt: row.movedAt.toISOString() }),
      downstreamRecords: [{ entityType: "Animal", entityId: row.animalId }, ...(row.requestId ? [{ entityType: "LabTransferRequest", entityId: row.requestId }] : [])] };
  }
  if (domain === "animal_lifecycle") {
    const row = await tx.animalStatusEvent.findFirst({
      where: { id: targetEntityId, animal: { owningLabId: authorizedLabId } },
      select: { id: true, animalId: true, fromStatus: true, toStatus: true, happenedAt: true, reason: true },
    });
    if (!row) return null;
    return { labId: authorizedLabId, targetVersion: null, sourceEventAt: row.happenedAt,
      originalSnapshot: object({ ...row, happenedAt: row.happenedAt.toISOString() }),
      downstreamRecords: [{ entityType: "Animal", entityId: row.animalId }] };
  }
  if (domain === "cross_lab_transfer") {
    const row = await tx.labTransferRequest.findFirst({
      where: { id: targetEntityId, OR: [{ sourceLabId: authorizedLabId }, { destinationLabId: authorizedLabId }] },
      select: { id: true, subjectType: true, sourceLabId: true, destinationLabId: true, reason: true, requestedEffectiveAt: true, requestedAt: true, finalizedAt: true, status: true, version: true, items: { select: { animalId: true }, orderBy: { animalId: "asc" } } },
    });
    if (!row) return null;
    return { labId: authorizedLabId, targetVersion: row.version, sourceEventAt: row.finalizedAt ?? row.requestedAt,
      originalSnapshot: object({ ...row, requestedEffectiveAt: row.requestedEffectiveAt.toISOString(), requestedAt: row.requestedAt.toISOString(), finalizedAt: row.finalizedAt?.toISOString() ?? null }),
      downstreamRecords: row.items.map((item) => ({ entityType: "Animal", entityId: item.animalId })) };
  }
  if (domain === "procedure_occurrence") {
    const row = await tx.procedureOccurrence.findFirst({
      where: { id: targetEntityId, labId: authorizedLabId },
      select: { id: true, labId: true, planId: true, animalId: true, occurredAt: true, status: true, outcomeNote: true, recordedAt: true },
    });
    if (!row) return null;
    return { labId: row.labId, targetVersion: null, sourceEventAt: row.occurredAt,
      originalSnapshot: object({ ...row, occurredAt: row.occurredAt.toISOString(), recordedAt: row.recordedAt.toISOString() }),
      downstreamRecords: [{ entityType: "Animal", entityId: row.animalId }, { entityType: "ProcedurePlan", entityId: row.planId }] };
  }
  const row = await tx.sampleRecord.findFirst({
    where: { id: targetEntityId, labId: authorizedLabId },
    select: { id: true, labId: true, animalId: true, sampleLabel: true, sampleType: true, status: true, collectedAt: true, storageLocation: true, quantityLabel: true, notes: true, version: true },
  });
  if (!row) return null;
  return { labId: row.labId, targetVersion: row.version, sourceEventAt: row.collectedAt,
    originalSnapshot: object({ ...row, collectedAt: row.collectedAt.toISOString() }),
    downstreamRecords: [{ entityType: "Animal", entityId: row.animalId }] };
}

export function evaluateCorrectionProposal(
  domain: CorrectionDomain,
  original: Prisma.InputJsonObject,
  proposal: Prisma.InputJsonObject,
  downstreamRecords: Prisma.InputJsonArray,
): ProposalResult {
  const effective: Record<string, unknown> = { ...original };
  let blockCode: string | null = null;
  let blockDetail: Prisma.InputJsonObject | null = null;

  if (domain === "litter_birth") {
    keysOnly(proposal, ["birthDate", "litterSizeBirth", "notes"]);
    const birthDateChanged = proposal.birthDate !== undefined
      && date(proposal.birthDate, "birthDate") !== original.birthDate;
    if (proposal.birthDate !== undefined) effective.birthDate = date(proposal.birthDate, "birthDate");
    if (proposal.litterSizeBirth !== undefined) {
      if (!Number.isInteger(proposal.litterSizeBirth) || Number(proposal.litterSizeBirth) < 0 || Number(proposal.litterSizeBirth) > 99) throw new Error("litterSizeBirth must be a whole number from 0 to 99.");
      effective.litterSizeBirth = Number(proposal.litterSizeBirth);
    }
    if (proposal.notes !== undefined) effective.notes = text(proposal.notes, "notes", 2000);
    if (effective.litterSizeBirth !== original.litterSizeBirth) {
      blockCode = "birth_count_change_requires_policy";
      blockDetail = { dependentRecordCount: downstreamRecords.length, hasWeaningRecord: original.litterSizeWean !== null };
    } else if (birthDateChanged && (downstreamRecords.length || original.litterSizeWean !== null)) {
      blockCode = "dependent_birth_records_require_policy";
      blockDetail = { dependentRecordCount: downstreamRecords.length, hasWeaningRecord: original.litterSizeWean !== null };
    }
  } else if (domain === "litter_weaning") {
    keysOnly(proposal, ["litterSizeWean", "notes"]);
    if (!Number.isInteger(proposal.litterSizeWean) || Number(proposal.litterSizeWean) < 0 || Number(proposal.litterSizeWean) > 99) throw new Error("litterSizeWean must be a whole number from 0 to 99.");
    effective.litterSizeWean = Number(proposal.litterSizeWean);
    if (proposal.notes !== undefined) effective.notes = text(proposal.notes, "notes", 2000);
    blockCode = "generated_weaning_state_requires_policy";
    blockDetail = { dependentRecordCount: downstreamRecords.length };
  } else if (domain === "animal_move") {
    keysOnly(proposal, ["movedAt", "reason", "fromCageId", "toCageId"]);
    if (proposal.movedAt !== undefined) effective.movedAt = date(proposal.movedAt, "movedAt");
    if (proposal.reason !== undefined) effective.reason = text(proposal.reason, "reason");
    if (proposal.fromCageId !== undefined) effective.fromCageId = proposal.fromCageId as Prisma.InputJsonValue;
    if (proposal.toCageId !== undefined) effective.toCageId = proposal.toCageId as Prisma.InputJsonValue;
    if (effective.fromCageId !== original.fromCageId || effective.toCageId !== original.toCageId) blockCode = "physical_move_change_not_supported";
  } else if (domain === "animal_lifecycle") {
    keysOnly(proposal, ["happenedAt", "reason", "toStatus"]);
    if (proposal.happenedAt !== undefined) effective.happenedAt = date(proposal.happenedAt, "happenedAt");
    if (proposal.reason !== undefined) effective.reason = text(proposal.reason, "reason");
    if (proposal.toStatus !== undefined) effective.toStatus = proposal.toStatus as Prisma.InputJsonValue;
    if (effective.toStatus !== original.toStatus) blockCode = "terminal_lifecycle_change_not_supported";
  } else if (domain === "cross_lab_transfer") {
    keysOnly(proposal, ["requestedEffectiveAt", "reason", "sourceLabId", "destinationLabId"]);
    if (proposal.requestedEffectiveAt !== undefined) effective.requestedEffectiveAt = date(proposal.requestedEffectiveAt, "requestedEffectiveAt");
    if (proposal.reason !== undefined) effective.reason = text(proposal.reason, "reason");
    if (proposal.sourceLabId !== undefined) effective.sourceLabId = proposal.sourceLabId as Prisma.InputJsonValue;
    if (proposal.destinationLabId !== undefined) effective.destinationLabId = proposal.destinationLabId as Prisma.InputJsonValue;
    if (effective.sourceLabId !== original.sourceLabId || effective.destinationLabId !== original.destinationLabId) blockCode = "custody_transfer_change_not_supported";
  } else if (domain === "procedure_occurrence") {
    keysOnly(proposal, ["occurredAt", "outcomeNote", "status"]);
    if (proposal.occurredAt !== undefined) effective.occurredAt = date(proposal.occurredAt, "occurredAt");
    if (proposal.outcomeNote !== undefined) effective.outcomeNote = text(proposal.outcomeNote, "outcomeNote", 2000);
    if (proposal.status !== undefined) effective.status = proposal.status as Prisma.InputJsonValue;
    if (effective.status !== original.status) blockCode = "procedure_status_change_not_supported";
  } else {
    keysOnly(proposal, ["collectedAt", "notes", "status", "storageLocation", "quantityLabel", "animalId"]);
    if (proposal.collectedAt !== undefined) effective.collectedAt = date(proposal.collectedAt, "collectedAt");
    if (proposal.notes !== undefined) effective.notes = text(proposal.notes, "notes", 2000);
    for (const key of ["status", "storageLocation", "quantityLabel", "animalId"] as const) {
      if (proposal[key] !== undefined) effective[key] = proposal[key] as Prisma.InputJsonValue;
      if (effective[key] !== original[key]) blockCode = "biosample_custody_change_not_supported";
    }
  }

  if (JSON.stringify(effective) === JSON.stringify(original)) throw new Error("The proposal does not change an effective value.");
  return { safe: !blockCode, blockCode, blockDetail, effectiveProjection: effective as Prisma.InputJsonObject };
}
