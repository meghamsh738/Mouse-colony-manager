import { describe, expect, it } from "vitest";

import {
  assertOperationalPacket,
  canTransitionCensus,
  canTransitionShipmentStatus,
  capacityExceptionIsCurrent,
  discrepancyTypeForCensus,
  receiptFinalizationResult,
  shipmentObservationNeedsException,
  transferReceiptEventType,
} from "@/lib/reconciliation-state-machine";

describe("M16 fail-closed reconciliation state machines", () => {
  it("keeps shipment completion terminal and classifies partial/exception receipt", () => {
    expect(canTransitionShipmentStatus("expected", "receiving")).toBe(true);
    expect(canTransitionShipmentStatus("received", "receiving")).toBe(false);
    expect(receiptFinalizationResult({ expectedCount: 4, matchedCount: 2, exceptionCount: 1 })).toEqual({
      result: "partial",
      status: "partially_received",
      missingCount: 2,
    });
    expect(receiptFinalizationResult({ expectedCount: 2, matchedCount: 0, exceptionCount: 2 }).result).toBe("exception_only");
    expect(shipmentObservationNeedsException("dead_on_arrival")).toBe(true);
    expect(shipmentObservationNeedsException("matched")).toBe(false);
  });

  it("never treats census discrepancy evidence as an automatic correction", () => {
    expect(discrepancyTypeForCensus("matched")).toBeNull();
    expect(discrepancyTypeForCensus("count_mismatch")).toBe("count");
    expect(canTransitionCensus("in_progress", "signed_off")).toBe(false);
    expect(canTransitionCensus("review", "signed_off")).toBe(true);
  });

  it("expires temporary capacity and preserves partial custody evidence", () => {
    const now = new Date("2026-08-30T12:00:00.000Z");
    expect(capacityExceptionIsCurrent({ status: "active", startsAt: new Date("2026-08-30T11:00:00Z"), expiresAt: new Date("2026-08-30T13:00:00Z") }, now)).toBe(true);
    expect(capacityExceptionIsCurrent({ status: "active", startsAt: new Date("2026-08-30T10:00:00Z"), expiresAt: now }, now)).toBe(false);
    expect(transferReceiptEventType(["received", "missing"])).toBe("partial_failure");
    expect(transferReceiptEventType(["received", "received"])).toBe("destination_received");
  });

  it("rejects source-private or research-note fields from custody packets", () => {
    expect(assertOperationalPacket({ healthStatus: "compatible", quarantineRequired: true })).toBe(true);
    expect(assertOperationalPacket({ healthStatus: { nestedPrivateDetail: "not allowed" } })).toBe(false);
    expect(assertOperationalPacket({ sourcePrivateNote: "secret" })).toBe(false);
    expect(assertOperationalPacket({ projectNote: "private hypothesis" })).toBe(false);
  });
});
