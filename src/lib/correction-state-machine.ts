import type { CorrectionDomain } from "@prisma/client";

import type { Capability } from "@/lib/capabilities";

export const CORRECTION_POLICY_MARKER = "synthetic-controlled-metadata-supersession-v1";

export const CORRECTION_DOMAIN_LABELS: Record<CorrectionDomain, string> = {
  litter_birth: "Litter birth record",
  litter_weaning: "Litter weaning record",
  animal_move: "Animal movement event",
  animal_lifecycle: "Animal lifecycle event",
  cross_lab_transfer: "Cross-lab transfer",
  procedure_occurrence: "Procedure occurrence",
  biosample: "Biosample record",
};

export const CORRECTION_DOMAIN_CAPABILITIES: Record<CorrectionDomain, Capability> = {
  litter_birth: "breeding:manage",
  litter_weaning: "breeding:manage",
  animal_move: "animals:manage",
  animal_lifecycle: "animals:manage",
  cross_lab_transfer: "transfers:request",
  procedure_occurrence: "procedures:execute",
  biosample: "biosamples:manage",
};

export const CORRECTION_PROPOSAL_EXAMPLES: Record<CorrectionDomain, string> = {
  litter_birth: '{"birthDate":"2026-08-30T09:00:00.000Z","notes":"Corrected source entry"}',
  litter_weaning: '{"litterSizeWean":5,"notes":"Requested structural correction"}',
  animal_move: '{"movedAt":"2026-08-30T10:00:00.000Z","reason":"Corrected movement reason"}',
  animal_lifecycle: '{"happenedAt":"2026-08-30T11:00:00.000Z","reason":"Corrected lifecycle reason"}',
  cross_lab_transfer: '{"requestedEffectiveAt":"2026-08-30T12:00:00.000Z","reason":"Corrected transfer reason"}',
  procedure_occurrence: '{"occurredAt":"2026-08-30T13:00:00.000Z","outcomeNote":"Corrected outcome note"}',
  biosample: '{"collectedAt":"2026-08-30T14:00:00.000Z","notes":"Corrected collection note"}',
};

export function canTransitionCorrection(
  from: "pending" | "blocked",
  to: "applied" | "rejected",
) {
  return (from === "pending" && (to === "applied" || to === "rejected"))
    || (from === "blocked" && to === "rejected");
}
