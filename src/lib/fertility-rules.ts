export type StrainFertilityProfile = {
  strainId: string;
  label?: string;
  litterSizeMultiplier: number;
  probabilityMultiplier: number;
  surplusPenaltyMultiplier: number;
  note?: string;
};

export type LineFertilityAdjustment = {
  litterSizeMultiplier: number;
  probabilityMultiplier: number;
  surplusPenaltyMultiplier: number;
  summary: string;
  notes: string[];
};

function clampMultiplier(value: unknown, fallback: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Number(Math.min(2, Math.max(0.2, parsed)).toFixed(2));
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function parseStrainFertilityProfiles(value: unknown) {
  const profiles = new Map<string, StrainFertilityProfile>();

  if (!Array.isArray(value)) {
    return profiles;
  }

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || !("strainId" in entry)) {
      continue;
    }

    const raw = entry as Record<string, unknown>;
    const strainId = String(raw.strainId ?? "").trim();

    if (!strainId) {
      continue;
    }

    profiles.set(strainId, {
      strainId,
      label: typeof raw.label === "string" ? raw.label : undefined,
      litterSizeMultiplier: clampMultiplier(raw.litterSizeMultiplier, 1),
      probabilityMultiplier: clampMultiplier(raw.probabilityMultiplier, 1),
      surplusPenaltyMultiplier: clampMultiplier(raw.surplusPenaltyMultiplier, 1),
      note: typeof raw.note === "string" ? raw.note : undefined,
    });
  }

  return profiles;
}

export function buildLineFertilityAdjustment(
  sire: { strainId: string; strain: { name: string } },
  dam: { strainId: string; strain: { name: string } },
  profiles: Map<string, StrainFertilityProfile>,
): LineFertilityAdjustment {
  const matchedProfiles = [
    { profile: profiles.get(sire.strainId), strainName: sire.strain.name },
    { profile: profiles.get(dam.strainId), strainName: dam.strain.name },
  ].filter((item): item is { profile: StrainFertilityProfile; strainName: string } => Boolean(item.profile));

  if (!matchedProfiles.length) {
    return {
      litterSizeMultiplier: 1,
      probabilityMultiplier: 1,
      surplusPenaltyMultiplier: 1,
      summary: "No line-specific fertility adjustment",
      notes: [],
    };
  }

  const litterSizeMultiplier = Number(average(matchedProfiles.map((item) => item.profile.litterSizeMultiplier)).toFixed(2));
  const probabilityMultiplier = Number(average(matchedProfiles.map((item) => item.profile.probabilityMultiplier)).toFixed(2));
  const surplusPenaltyMultiplier = Math.max(...matchedProfiles.map((item) => item.profile.surplusPenaltyMultiplier));
  const labels = matchedProfiles.map((item) => item.profile.label ?? item.strainName);
  const notes = [...new Set(matchedProfiles.map((item) => item.profile.note).filter((note): note is string => Boolean(note)))];

  return {
    litterSizeMultiplier,
    probabilityMultiplier,
    surplusPenaltyMultiplier,
    summary: `Line fertility model: ${labels.join(" + ")}; litter x${litterSizeMultiplier}, genotype x${probabilityMultiplier}, surplus penalty x${surplusPenaltyMultiplier}`,
    notes,
  };
}
