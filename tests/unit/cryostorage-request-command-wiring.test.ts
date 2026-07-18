import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/command-foundation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/command-foundation")>()),
  executeIdempotentCommand: commandMocks.execute,
}));

import {
  executeCancelCryostorageRequestCommand,
  executeCryostorageRequestCommand,
  executeSubmitCryostorageRequestCommand,
} from "@/lib/cryostorage-write";
import type { ResolvedActor } from "@/lib/session";

const actor = {
  id: "lab-staff-1",
  email: "staff@example.test",
  name: "Lab staff",
  role: "animal_staff",
  databaseRole: "lab_user",
  canonicalRole: "lab_user",
  authzVersion: 4,
  activeLabId: "lab-1",
  activeMembership: { labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "staff" },
  memberships: [{ labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "staff" }],
  capabilities: ["cryostorage:read", "cryostorage:request"],
} as ResolvedActor;

beforeEach(() => {
  commandMocks.execute.mockReset();
  commandMocks.execute.mockResolvedValue({ ok: true, result: { message: "ok" } });
});

describe("cryostorage request command wiring", () => {
  it("normalizes a lab request and binds it to request capability and lab", async () => {
    await executeSubmitCryostorageRequestCommand({
      actor,
      command: {
        labId: " lab-1 ",
        requestType: "store",
        strainId: " strain-1 ",
        projectId: " project-1 ",
        sampleLabel: " CRYO-001 ",
        materialType: " Frozen sperm ",
        requestedFor: "2099-01-01",
        notes: " Routine storage ",
      },
      idempotencyKey: "cryostorage-submit-key",
      requestId: "cryostorage-submit-request",
    });

    expect(commandMocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      commandType: "cryostorage.request.submit",
      requiredCapability: "cryostorage:request",
      labId: "lab-1",
      aggregateType: "cryostorage_request",
      request: expect.objectContaining({
        labId: "lab-1",
        strainId: "strain-1",
        projectId: "project-1",
        sampleLabel: "CRYO-001",
        materialType: "Frozen sperm",
        notes: "Routine storage",
      }),
    }));
  });

  it("uses expected request versions for cancellation and CMU execution", async () => {
    await executeCancelCryostorageRequestCommand({
      actor,
      command: { requestId: "cryo-request-1", labId: "lab-1", reason: "No longer required" },
      expectedVersion: 2,
      idempotencyKey: "cryostorage-cancel-key",
      requestId: "cryostorage-cancel-request",
    });
    expect(commandMocks.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      commandType: "cryostorage.request.cancel",
      requiredCapability: "cryostorage:request",
      aggregateId: "cryo-request-1",
      expectedVersion: 2,
    }));

    await executeCryostorageRequestCommand({
      actor,
      command: {
        requestId: "cryo-request-1",
        labId: "lab-1",
        action: "complete",
        performedAt: new Date().toISOString().slice(0, 10),
        resultingStatus: "recovered",
      },
      expectedVersion: 3,
      idempotencyKey: "cryostorage-execute-key",
      requestId: "cryostorage-execute-request",
    });
    expect(commandMocks.execute).toHaveBeenLastCalledWith(expect.objectContaining({
      commandType: "cryostorage.request.execute",
      requiredCapability: "cryostorage:manage",
      aggregateId: "cryo-request-1",
      expectedVersion: 3,
    }));
  });

  it("rejects incomplete request payloads before creating receipts", async () => {
    const result = await executeSubmitCryostorageRequestCommand({
      actor,
      command: { labId: "lab-1", requestType: "store", requestedFor: "2099-01-01" },
      idempotencyKey: "cryostorage-invalid-key",
      requestId: "cryostorage-invalid-request",
    });

    expect(result).toMatchObject({ ok: false, code: "validation_error" });
    expect(commandMocks.execute).not.toHaveBeenCalled();
  });
});
