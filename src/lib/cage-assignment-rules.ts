import type { AnimalIntakeDisposition, CageStatus, Sex } from "@/lib/types";

export type AssignmentRuleDestination = {
  key: string;
  label: string;
  status: CageStatus;
  occupants: Array<{ id: string; sex: Sex }>;
};

export type AssignmentRuleIncoming = {
  subjectId: string;
  sex: Sex;
  destinationKey: string;
};

export function validateProjectedSexComposition(input: {
  destinations: AssignmentRuleDestination[];
  incoming: AssignmentRuleIncoming[];
  outgoingSubjectIds?: Set<string>;
  mixedSexHoldingAllowed: boolean;
}) {
  if (input.mixedSexHoldingAllowed) return null;
  const destinationByKey = new Map(input.destinations.map((destination) => [destination.key, destination]));
  const projected = new Map<string, Set<Sex>>();

  for (const destination of input.destinations) {
    const sexes = new Set(
      destination.occupants
        .filter((occupant) => !input.outgoingSubjectIds?.has(occupant.id))
        .map((occupant) => occupant.sex),
    );
    projected.set(destination.key, sexes);
  }
  for (const assignment of input.incoming) {
    const sexes = projected.get(assignment.destinationKey) ?? new Set<Sex>();
    sexes.add(assignment.sex);
    projected.set(assignment.destinationKey, sexes);
  }

  for (const [key, sexes] of projected) {
    const destination = destinationByKey.get(key);
    if (destination?.status === "breeding") continue;
    if (sexes.has("male") && sexes.has("female")) {
      return `${destination?.label ?? "Destination cage"} cannot hold both male and female mice.`;
    }
  }
  return null;
}

export function validateQuarantineAssignments(input: {
  workflow: "new" | "wean" | "purchase";
  disposition?: AnimalIntakeDisposition;
  destinations: AssignmentRuleDestination[];
  usedDestinationKeys: Set<string>;
}) {
  for (const destination of input.destinations) {
    if (!input.usedDestinationKeys.has(destination.key)) continue;
    const isQuarantine = destination.status === "quarantine";
    if (input.workflow === "purchase" && input.disposition === "quarantine" && !isQuarantine) {
      return `${destination.label} must be a quarantine cage for this intake.`;
    }
    if ((input.workflow !== "purchase" || input.disposition !== "quarantine") && isQuarantine) {
      return `${destination.label} can only receive animals through a quarantine intake workflow.`;
    }
  }
  return null;
}
