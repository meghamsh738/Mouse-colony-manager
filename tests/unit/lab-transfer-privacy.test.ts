import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestFindMany: vi.fn(),
  labFindUnique: vi.fn(),
  labFindMany: vi.fn(),
  assignmentFindMany: vi.fn(),
  allocationFindMany: vi.fn(),
  breedingFindMany: vi.fn(),
  cageFindMany: vi.fn(),
  protocolFindMany: vi.fn(),
  correctionFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    labTransferRequest: { findMany: mocks.requestFindMany },
    lab: { findUnique: mocks.labFindUnique, findMany: mocks.labFindMany },
    experimentAssignment: { findMany: mocks.assignmentFindMany },
    animalProjectAllocation: { findMany: mocks.allocationFindMany },
    breedingAdult: { findMany: mocks.breedingFindMany },
    cage: { findMany: mocks.cageFindMany },
    protocolAuthorization: { findMany: mocks.protocolFindMany },
    correctionSupersession: { findMany: mocks.correctionFindMany },
  },
}));

import { getLabTransferWorkspace } from "@/lib/lab-transfer-read";
import type { ResolvedActor } from "@/lib/session";

const packet = {
  requestId: "transfer-1",
  subjectType: "animals" as const,
  sourceLab: { id: "lab-a", code: "LAB-A", name: "Lab A" },
  destinationLab: { id: "lab-b", code: "LAB-B", name: "Lab B" },
  reason: "Operational handover",
  requestedEffectiveAt: "2026-07-20T00:00:00.000Z",
  sourceCage: null,
  destinationCage: {
    id: "destination-cage-private",
    barcode: "DST-PRIVATE-9000",
    location: "PRIVATE ROOM / PRIVATE RACK / 9000",
    status: "active",
    occupancy: 4,
    capacity: 6,
    maleCount: 0,
    femaleCount: 4,
    unknownSexCount: 0,
    stateFingerprint: "private-destination-fingerprint",
    mixedSexPolicy: "prohibited" as const,
  },
  animals: [{
    id: "animal-1",
    facilityAnimalId: "0001",
    animalId: "CM-0001",
    sex: "female" as const,
    dob: "2026-03-01T00:00:00.000Z",
    strain: "C57BL/6J",
    healthStatus: "Fit for transfer",
    sourceCageBarcode: "CM-1000",
  }],
};

const requestRow = {
  id: "transfer-1",
  subjectType: "animals" as const,
  sourceLabId: "lab-a",
  destinationLabId: "lab-b",
  sourceCageId: null,
  destinationCageId: null,
  reason: "Operational handover",
  sourcePrivateNote: "SOURCE PRIVATE RESEARCH NOTE",
  requestedEffectiveAt: new Date("2026-07-20T00:00:00.000Z"),
  status: "requested" as const,
  packetVersion: 1,
  acceptedPacketVersion: null,
  requestedAt: new Date("2026-07-15T00:00:00.000Z"),
  destinationDecisionAt: null,
  destinationDecisionNote: null,
  finalizedAt: null,
  overrideReason: null,
  version: 1,
  sourceLab: packet.sourceLab,
  destinationLab: packet.destinationLab,
  requestedBy: { name: "Source Manager" },
  destinationDecisionBy: null,
  finalizedBy: null,
  sourceCage: null,
  destinationCage: { id: "destination-cage-private", barcode: "DST-PRIVATE-9000" },
  packets: [{ version: 1, payloadHash: "hash-1", destinationPayload: packet }],
  items: [{ animalId: "animal-1", animal: { strainId: "strain-1" } }],
  events: [],
};

function actor(input: {
  role: "lab_user" | "cmu_staff" | "facility_admin";
  labId?: string;
}): ResolvedActor {
  const labUser = input.role === "lab_user";
  const membership = labUser && input.labId
    ? { labId: input.labId, labName: "Lab B", labCode: "LAB-B", role: "manager" as const }
    : null;
  return {
    id: `${input.role}-user`,
    email: `${input.role}@example.test`,
    name: input.role,
    role: labUser ? "animal_staff" : input.role === "cmu_staff" ? "colony_manager" : "admin",
    databaseRole: input.role,
    canonicalRole: input.role,
    authzVersion: 1,
    activeLabId: input.labId ?? null,
    activeMembership: membership,
    memberships: membership ? [membership] : [],
    capabilities: labUser
      ? ["transfers:read", "transfers:request", "transfers:approve", "approvals:read"]
      : ["transfers:read", "transfers:finalize", "approvals:read"],
  };
}

describe("lab transfer packet privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestFindMany.mockResolvedValue([requestRow]);
    mocks.assignmentFindMany.mockResolvedValue([]);
    mocks.allocationFindMany.mockResolvedValue([]);
    mocks.breedingFindMany.mockResolvedValue([]);
    mocks.cageFindMany.mockResolvedValue([]);
    mocks.protocolFindMany.mockResolvedValue([]);
    mocks.correctionFindMany.mockResolvedValue([]);
  });

  it("shows the allowlisted operational packet but hides the source-private note from the destination lab", async () => {
    const workspace = await getLabTransferWorkspace(actor({ role: "lab_user", labId: "lab-b" }));

    expect(mocks.requestFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ sourceLabId: "lab-b" }, { destinationLabId: "lab-b" }] },
    }));
    expect(workspace.requests[0]?.sourcePrivateNote).toBeNull();
    expect(workspace.requests[0]?.packet).toEqual(packet);
    expect(JSON.stringify(workspace.requests[0]?.packet)).not.toContain("SOURCE PRIVATE RESEARCH NOTE");
  });

  it("redacts destination-cage operations from a source-lab-only response", async () => {
    const workspace = await getLabTransferWorkspace(actor({ role: "lab_user", labId: "lab-a" }));
    const serialized = JSON.stringify(workspace.requests[0]);

    expect(workspace.requests[0]?.destinationCage).toBeNull();
    expect(workspace.requests[0]?.packet?.destinationCage).toBeNull();
    expect(serialized).not.toContain("DST-PRIVATE-9000");
    expect(serialized).not.toContain("PRIVATE ROOM");
    expect(serialized).not.toContain("private-destination-fingerprint");
  });

  it("hides source-private notes from CMU but exposes them to Facility Admin oversight", async () => {
    const cmu = await getLabTransferWorkspace(actor({ role: "cmu_staff" }));
    const facility = await getLabTransferWorkspace(actor({ role: "facility_admin" }));

    expect(cmu.requests[0]?.sourcePrivateNote).toBeNull();
    expect(facility.requests[0]?.sourcePrivateNote).toBe("SOURCE PRIVATE RESEARCH NOTE");
    expect(cmu.requests[0]?.packet?.destinationCage).toEqual(packet.destinationCage);
    expect(facility.requests[0]?.destinationCage).toEqual(requestRow.destinationCage);
  });

  it("loads destination cages once for multiple approval requests to the same lab", async () => {
    mocks.requestFindMany.mockResolvedValue([
      requestRow,
      { ...requestRow, id: "transfer-2", packets: [{ ...requestRow.packets[0], destinationPayload: { ...packet, requestId: "transfer-2" } }] },
    ]);
    mocks.cageFindMany.mockResolvedValue([{
      id: "destination-cage-1",
      barcode: "DST-1000",
      labId: "lab-b",
      capacityOverride: null,
      room: { roomNumber: "R1", facility: { maxCageOccupancy: 6 } },
      rack: { rackNumber: "A" },
      cageNumber: "1000",
      _count: { animals: 2 },
    }]);

    const workspace = await getLabTransferWorkspace(actor({ role: "lab_user", labId: "lab-b" }));

    expect(mocks.cageFindMany).toHaveBeenCalledOnce();
    expect(mocks.cageFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ labId: { in: ["lab-b"] } }),
    }));
    expect(workspace.requests.map((request) => request.destinationCages)).toEqual([
      [expect.objectContaining({ id: "destination-cage-1" })],
      [expect.objectContaining({ id: "destination-cage-1" })],
    ]);
  });
});
