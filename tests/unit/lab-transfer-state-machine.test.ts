import { describe, expect, it } from "vitest";

import {
  buildDestinationTransferPacket,
  canCancelLabTransfer,
  canDecideLabTransfer,
  canFinalizeLabTransfer,
  canOverrideLabTransferBlocks,
  canRequestLabTransfer,
  canReviseLabTransfer,
  isTransferAcceptanceCurrent,
} from "@/lib/lab-transfer-state-machine";
import type { ResolvedActor } from "@/lib/session";

function actor(input: Partial<ResolvedActor> & Pick<ResolvedActor, "canonicalRole">): ResolvedActor {
  return {
    id: "user-1",
    email: "user@example.test",
    name: "User",
    role: "read_only",
    databaseRole: "lab_user",
    authzVersion: 1,
    activeLabId: null,
    activeMembership: null,
    memberships: [],
    capabilities: [],
    ...input,
  };
}

describe("lab transfer state machine", () => {
  it("limits source requests and destination decisions to the matching lab principals", () => {
    const sourceManager = actor({
      canonicalRole: "lab_user",
      activeLabId: "lab-source",
      activeMembership: { labId: "lab-source", labCode: "SRC", labName: "Source", role: "manager" },
      capabilities: ["transfers:read", "transfers:request", "transfers:approve"],
    });
    const sourceStaff = actor({
      canonicalRole: "lab_user",
      activeLabId: "lab-source",
      activeMembership: { labId: "lab-source", labCode: "SRC", labName: "Source", role: "staff" },
      capabilities: ["transfers:read"],
    });

    expect(canRequestLabTransfer(sourceManager, "lab-source")).toBe(true);
    expect(canRequestLabTransfer(sourceManager, "lab-other")).toBe(false);
    expect(canRequestLabTransfer(sourceStaff, "lab-source")).toBe(false);
    expect(canDecideLabTransfer(sourceManager, "lab-source")).toBe(true);
    expect(canDecideLabTransfer(sourceManager, "lab-destination")).toBe(false);
  });

  it("separates CMU finalization from Facility-only blocker override", () => {
    const cmu = actor({ canonicalRole: "cmu_staff", capabilities: ["transfers:read", "transfers:finalize"] });
    const facility = actor({ canonicalRole: "facility_admin", capabilities: ["transfers:read", "transfers:finalize"] });

    expect(canFinalizeLabTransfer(cmu)).toBe(true);
    expect(canOverrideLabTransferBlocks(cmu)).toBe(false);
    expect(canFinalizeLabTransfer(facility)).toBe(true);
    expect(canOverrideLabTransferBlocks(facility)).toBe(true);
  });

  it("requires the destination acceptance to bind the current packet hash and version", () => {
    expect(isTransferAcceptanceCurrent({
      status: "destination_accepted",
      packetVersion: 2,
      packetHash: "hash-2",
      acceptedPacketVersion: 2,
      acceptedPacketHash: "hash-2",
    })).toBe(true);
    expect(isTransferAcceptanceCurrent({
      status: "destination_accepted",
      packetVersion: 3,
      packetHash: "hash-3",
      acceptedPacketVersion: 2,
      acceptedPacketHash: "hash-2",
    })).toBe(false);
  });

  it("allows revision or cancellation only before finalization", () => {
    expect(canReviseLabTransfer("destination_accepted")).toBe(true);
    expect(canReviseLabTransfer("destination_rejected")).toBe(true);
    expect(canReviseLabTransfer("finalized")).toBe(false);
    expect(canCancelLabTransfer("requested")).toBe(true);
    expect(canCancelLabTransfer("finalized")).toBe(false);
  });

  it("builds a deterministic destination packet from an operational allowlist", () => {
    const result = buildDestinationTransferPacket({
      requestId: "transfer-1",
      subjectType: "animals",
      sourceLab: { id: "lab-source", code: "SRC", name: "Source Lab" },
      destinationLab: { id: "lab-destination", code: "DST", name: "Destination Lab" },
      reason: "Approved strain handover",
      requestedEffectiveAt: "2026-07-20T00:00:00.000Z",
      sourceCage: null,
      destinationCage: null,
      animals: [
        {
          id: "animal-b",
          facilityAnimalId: "0002",
          animalId: "CM-0002",
          sex: "female",
          dob: "2026-03-01T00:00:00.000Z",
          strain: "C57BL/6J",
          healthStatus: "Fit for transfer",
          sourceCageBarcode: "CM-1000",
        },
        {
          id: "animal-a",
          facilityAnimalId: "0001",
          animalId: "CM-0001",
          sex: "male",
          dob: "2026-03-02T00:00:00.000Z",
          strain: "C57BL/6J",
          healthStatus: null,
          sourceCageBarcode: "CM-1001",
        },
      ],
    });

    expect(result.packet.animals.map((animal) => animal.facilityAnimalId)).toEqual(["0001", "0002"]);
    expect(result.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result.packet)).not.toMatch(/genotype|project|experiment|sourcePrivateNote|notes/i);
  });
});

