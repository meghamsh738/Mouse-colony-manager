export type BiosampleReplaySnapshotInput = {
  animalId: string;
  labId: string;
  projectRef?: string | null;
  experimentId?: string | null;
  sampleLabel: string;
  sampleType: string;
  status: string;
  collectedAt: string | Date;
  storageLocation?: string | null;
  quantityLabel?: string | null;
  notes?: string | null;
};

function normalizeOptional(value?: string | null) {
  return value?.trim() || null;
}

function normalizeCollectedAt(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value).trim() : date.toISOString();
}

export function buildBiosampleReplaySnapshot(input: BiosampleReplaySnapshotInput) {
  return {
    animalId: input.animalId.trim(),
    labId: input.labId.trim(),
    provenance: input.experimentId
      ? `experiment:${input.experimentId.trim()}`
      : input.projectRef
        ? `project:${input.projectRef.trim()}`
        : null,
    sampleLabel: input.sampleLabel.trim(),
    sampleType: input.sampleType.trim(),
    status: input.status,
    collectedAt: normalizeCollectedAt(input.collectedAt),
    storageLocation: normalizeOptional(input.storageLocation),
    quantityLabel: normalizeOptional(input.quantityLabel),
    notes: normalizeOptional(input.notes),
  };
}

export function biosampleReplayMatches(
  existing: BiosampleReplaySnapshotInput,
  requested: BiosampleReplaySnapshotInput,
) {
  return JSON.stringify(buildBiosampleReplaySnapshot(existing)) === JSON.stringify(buildBiosampleReplaySnapshot(requested));
}
