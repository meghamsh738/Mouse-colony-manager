import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  memberships: vi.fn(),
  requests: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    labMembership: { findMany: db.memberships },
    cryostorageRequest: { findMany: db.requests },
  },
}));

import { getCryostorageRequestView } from "@/lib/cryostorage-read";

const baseRequest = {
  id: "request-1",
  labId: "lab-1",
  requestType: "recover" as const,
  status: "submitted" as const,
  version: 1,
  requestedFor: new Date("2026-07-20T00:00:00.000Z"),
  requestedAt: new Date("2026-07-16T12:00:00.000Z"),
  requestedById: "user-1",
  targetRecordId: "record-1",
  targetRecordVersion: 2,
  sampleLabel: null,
  materialType: null,
  requestedQuantityLabel: null,
  requestedStorageLocation: null,
  notes: null,
  decidedAt: null,
  decisionReason: null,
  lab: { code: "L1", name: "Lab One" },
  requestedBy: { name: "User One", email: "one@example.test" },
  decidedBy: null,
  strain: null,
  project: null,
  targetRecord: { sampleLabel: "CRYO-1", status: "stored" as const, labId: "lab-1" },
  operation: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.memberships.mockResolvedValue([{ labId: "lab-1", role: "staff" }]);
  db.requests.mockResolvedValue([baseRequest]);
});

describe("cryostorage request privacy", () => {
  it("scopes lab-user reads to the active lab and projects only same-lab rows", async () => {
    const rows = await getCryostorageRequestView({ id: "user-1", role: "animal_staff", activeLabId: "lab-1" });

    expect(db.requests).toHaveBeenCalledWith(expect.objectContaining({ where: { labId: { in: ["lab-1"] } } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "request-1", labId: "lab-1", targetRecordLabel: "CRYO-1" });
  });

  it("fails closed when a mocked nested target belongs to another lab", async () => {
    db.requests.mockResolvedValue([{ ...baseRequest, targetRecord: { ...baseRequest.targetRecord, labId: "lab-2" } }]);

    const rows = await getCryostorageRequestView({ id: "user-1", role: "animal_staff", activeLabId: "lab-1" });

    expect(rows).toEqual([]);
  });

  it("allows CMU to query the facility queue without manufacturing a lab membership", async () => {
    db.requests.mockResolvedValue([]);

    await getCryostorageRequestView({ id: "cmu-1", role: "colony_manager", activeLabId: null });

    expect(db.memberships).not.toHaveBeenCalled();
    expect(db.requests).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
