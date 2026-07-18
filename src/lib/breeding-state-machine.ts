import type { BreedingStatus } from "@/lib/types";

const TRANSITIONS: Record<BreedingStatus, readonly BreedingStatus[]> = {
  planned: ["active", "failed", "retired"],
  active: ["paused", "failed", "retired"],
  paused: ["active", "failed", "retired"],
  retired: [],
  failed: [],
};

export function getAllowedBreedingTransitions(status: BreedingStatus) {
  return TRANSITIONS[status];
}

export function isTerminalBreedingStatus(status: BreedingStatus) {
  return status === "retired" || status === "failed";
}

export function validateBreedingTransition(input: {
  fromStatus: BreedingStatus;
  toStatus: BreedingStatus;
  startDate: Date;
  happenedAt: Date;
  reason: string;
  latestEffectiveDate?: Date | null;
  latestLitterDate?: Date | null;
  now?: Date;
}) {
  if (!getAllowedBreedingTransitions(input.fromStatus).includes(input.toStatus)) {
    return `Breeding setup cannot move from ${input.fromStatus} to ${input.toStatus}.`;
  }
  if (Number.isNaN(input.happenedAt.getTime())) return "Choose a valid transition date.";
  if (input.happenedAt.getTime() < input.startDate.getTime()) {
    return "Transition date cannot be earlier than the breeding start date.";
  }
  if (input.happenedAt.getTime() > (input.now ?? new Date()).getTime()) {
    return "Transition date cannot be in the future.";
  }
  if (input.latestEffectiveDate && input.happenedAt.getTime() < input.latestEffectiveDate.getTime()) {
    return "Transition date cannot be earlier than the latest breeding status change.";
  }
  if (input.latestLitterDate && input.happenedAt.getTime() < input.latestLitterDate.getTime()) {
    return "Transition date cannot be earlier than the latest recorded litter.";
  }
  if (input.reason.trim().length < 3) return "Enter a clear reason for the breeding change.";
  return null;
}
