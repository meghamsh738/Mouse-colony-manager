import type { QuarantineCaseStatus, QuarantineObservationResult } from "@prisma/client";

export const QUARANTINE_HEALTH_NOTE_ACTION_PREFIX = "Quarantine observation:";

export function isReservedQuarantineHealthAction(value: string | null | undefined) {
  return value?.trim().startsWith(QUARANTINE_HEALTH_NOTE_ACTION_PREFIX) ?? false;
}

const terminalStatuses = new Set<QuarantineCaseStatus>(["released", "cancelled"]);

export function isTerminalQuarantineStatus(status: QuarantineCaseStatus) {
  return terminalStatuses.has(status);
}

export function nextQuarantineStatusForObservation(
  status: QuarantineCaseStatus,
  result: QuarantineObservationResult,
): QuarantineCaseStatus | null {
  if (terminalStatuses.has(status) || status === "release_requested") return null;
  if (result === "exception") return "exception_open";
  if (result === "exception_resolved") return status === "exception_open" ? "under_observation" : null;
  if (status === "exception_open") return null;
  return "under_observation";
}

export function canRequestQuarantineRelease(input: {
  status: QuarantineCaseStatus;
  minimumReleaseAt: Date;
  requestedAt: Date;
  latestObservationResult: QuarantineObservationResult | null;
  openFollowupCount: number;
}) {
  if (input.status !== "under_observation") return false;
  if (input.requestedAt.getTime() < input.minimumReleaseAt.getTime()) return false;
  if (input.openFollowupCount > 0) return false;
  return input.latestObservationResult === "clear" || input.latestObservationResult === "exception_resolved";
}
