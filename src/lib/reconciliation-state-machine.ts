export const M16_POLICY_MARKER = "synthetic-fail-closed-m16" as const;

export const SHIPMENT_OBSERVATION_OUTCOMES = [
  "matched",
  "duplicate",
  "unknown",
  "mismatched",
  "damaged",
  "dead_on_arrival",
  "rejected",
] as const;

export type ShipmentObservationOutcome = (typeof SHIPMENT_OBSERVATION_OUTCOMES)[number];

export const CENSUS_OUTCOMES = [
  "matched",
  "count_mismatch",
  "unknown",
  "wrong_location",
  "damaged_label",
  "empty",
] as const;

export type CensusOutcome = (typeof CENSUS_OUTCOMES)[number];

export const TRANSFER_CUSTODY_OUTCOMES = [
  "received",
  "missing",
  "mismatched",
  "damaged",
  "dead_on_arrival",
] as const;

export type TransferCustodyOutcome = (typeof TRANSFER_CUSTODY_OUTCOMES)[number];

export function canTransitionShipmentStatus(from: string, to: string) {
  const allowed: Record<string, readonly string[]> = {
    expected: ["receiving", "cancelled"],
    receiving: ["partially_received", "received", "exception", "cancelled"],
    partially_received: ["receiving", "received", "exception", "cancelled"],
    exception: ["receiving", "partially_received", "received", "cancelled"],
    received: [],
    cancelled: [],
  };
  return allowed[from]?.includes(to) ?? false;
}

export function shipmentObservationNeedsException(outcome: ShipmentObservationOutcome) {
  return outcome !== "matched";
}

export function receiptFinalizationResult(input: {
  expectedCount: number;
  matchedCount: number;
  exceptionCount: number;
}) {
  const missingCount = Math.max(0, input.expectedCount - input.matchedCount);
  if (input.matchedCount === 0) {
    return { result: "exception_only" as const, status: "exception" as const, missingCount };
  }
  if (missingCount > 0 || input.exceptionCount > 0) {
    return { result: "partial" as const, status: "partially_received" as const, missingCount };
  }
  return { result: "received" as const, status: "received" as const, missingCount: 0 };
}

export function discrepancyTypeForCensus(outcome: CensusOutcome) {
  const map: Record<Exclude<CensusOutcome, "matched">, string> = {
    count_mismatch: "count",
    unknown: "unknown",
    wrong_location: "wrong_location",
    damaged_label: "damaged_label",
    empty: "empty",
  };
  return outcome === "matched" ? null : map[outcome];
}

export function canTransitionCensus(from: string, to: string) {
  const allowed: Record<string, readonly string[]> = {
    in_progress: ["review", "cancelled"],
    review: ["in_progress", "signed_off", "cancelled"],
    signed_off: [],
    cancelled: [],
  };
  return allowed[from]?.includes(to) ?? false;
}

export function capacityExceptionIsCurrent(input: {
  status: string;
  startsAt: Date;
  expiresAt: Date;
}, now = new Date()) {
  return input.status === "active" && input.startsAt <= now && input.expiresAt > now;
}

export function transferReceiptEventType(outcomes: readonly TransferCustodyOutcome[]) {
  return outcomes.length > 0 && outcomes.every((outcome) => outcome === "received")
    ? "destination_received" as const
    : "partial_failure" as const;
}

export function assertOperationalPacket(value: unknown): value is Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const allowed = new Set([
    "policyMarker", "quarantineRequired", "packetFields", "reason",
    "healthStatus", "quarantineStatus", "treatmentStatus", "licenceStatus", "safetyStatus",
  ]);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > allowed.size || entries.some(([key]) => !allowed.has(key))) return false;
  return entries.every(([, item]) => (
    item === null
    || typeof item === "string"
    || typeof item === "boolean"
    || (Array.isArray(item) && item.length <= 20 && item.every((part) => typeof part === "string"))
  ));
}
