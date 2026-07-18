export const DEFAULT_CAGE_CAPACITY = 6;
export const MAX_CAGE_CAPACITY = 6;
export const RECOMMENDED_CAGE_OCCUPANCY = 5;

export type CageCapacitySnapshot = {
  facilityLimit: number;
  cageOverride?: number | null;
  occupantCount: number;
};

export function resolveEffectiveCageCapacity(
  facilityLimit: number | null | undefined,
  cageOverride?: number | null,
) {
  const normalizedFacilityLimit =
    Number.isInteger(facilityLimit) && Number(facilityLimit) > 0
      ? Math.min(Number(facilityLimit), MAX_CAGE_CAPACITY)
      : DEFAULT_CAGE_CAPACITY;

  if (!Number.isInteger(cageOverride) || Number(cageOverride) <= 0) {
    return normalizedFacilityLimit;
  }

  return Math.min(normalizedFacilityLimit, Number(cageOverride));
}

export function resolveRecommendedCageOccupancy(effectiveLimit: number) {
  return Math.min(resolveEffectiveCageCapacity(effectiveLimit), RECOMMENDED_CAGE_OCCUPANCY);
}

export function validateFacilityCageCapacity(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_CAGE_CAPACITY
    ? null
    : `Maximum cage occupancy must be a whole number from 1 to ${MAX_CAGE_CAPACITY}.`;
}

export function getCageCapacityState(snapshot: CageCapacitySnapshot) {
  const effectiveLimit = resolveEffectiveCageCapacity(snapshot.facilityLimit, snapshot.cageOverride);
  const remainingCapacity = Math.max(0, effectiveLimit - snapshot.occupantCount);

  return {
    effectiveLimit,
    remainingCapacity,
    isFull: snapshot.occupantCount >= effectiveLimit,
    isOverCapacity: snapshot.occupantCount > effectiveLimit,
  };
}

export function validateCapacityOverride(
  facilityLimit: number,
  capacityOverride: number | null | undefined,
  occupantCount = 0,
) {
  if (capacityOverride === null || capacityOverride === undefined) {
    return null;
  }

  if (!Number.isInteger(capacityOverride) || capacityOverride < 1) {
    return "Cage capacity must be a whole number of at least 1.";
  }

  const effectiveFacilityLimit = Math.min(facilityLimit, MAX_CAGE_CAPACITY);
  if (capacityOverride > effectiveFacilityLimit) {
    return `Cage capacity cannot exceed the facility limit of ${effectiveFacilityLimit}.`;
  }

  if (capacityOverride < occupantCount) {
    return `Cage capacity cannot be lower than its ${occupantCount} current live occupants.`;
  }

  return null;
}

export function formatCapacityLabel(occupantCount: number, effectiveLimit: number) {
  const remaining = Math.max(0, effectiveLimit - occupantCount);
  const spaceLabel = remaining === 1 ? "1 space" : `${remaining} spaces`;

  return `${occupantCount} / ${effectiveLimit} · ${spaceLabel}`;
}
