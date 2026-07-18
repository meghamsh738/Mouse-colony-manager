import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/command-foundation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/command-foundation")>()),
  executeIdempotentCommand: commandMocks.execute,
}));

import { executeSetCageResponsibilityCommand } from "@/lib/cage-responsibility-write";
import type { ResolvedActor } from "@/lib/session";

const actor = {
  id: "manager-1",
  email: "manager@example.test",
  name: "Lab manager",
  role: "researcher",
  databaseRole: "lab_user",
  canonicalRole: "lab_user",
  authzVersion: 7,
  activeLabId: "lab-1",
  activeMembership: { labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "manager" },
  memberships: [{ labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "manager" }],
  capabilities: ["cages:read", "cages:manage"],
} as ResolvedActor;

beforeEach(() => {
  commandMocks.execute.mockReset();
  commandMocks.execute.mockResolvedValue({ ok: true, result: { message: "ok" } });
});

describe("cage responsibility command wiring", () => {
  it("normalizes users and binds the change to a versioned cage receipt", async () => {
    await executeSetCageResponsibilityCommand({
      actor,
      command: {
        cageId: " cage-1 ",
        labId: " lab-1 ",
        responsibleUserIds: ["user-b", " user-a ", "user-b", ""],
        reason: " Routine rota update ",
      },
      expectedVersion: 4,
      idempotencyKey: "responsibility-key",
      requestId: "responsibility-request",
    });

    expect(commandMocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      commandType: "cage.responsibility.update",
      requiredCapability: "cages:manage",
      labId: "lab-1",
      aggregateType: "cage",
      aggregateId: "cage-1",
      expectedVersion: 4,
      request: {
        command: {
          cageId: "cage-1",
          labId: "lab-1",
          responsibleUserIds: ["user-a", "user-b"],
          reason: "Routine rota update",
        },
        expectedVersion: 4,
      },
    }));
  });

  it("rejects an invalid reason before creating a command receipt", async () => {
    const result = await executeSetCageResponsibilityCommand({
      actor,
      command: { cageId: "cage-1", labId: "lab-1", responsibleUserIds: [], reason: "x" },
      expectedVersion: 1,
      idempotencyKey: "invalid-key",
      requestId: "invalid-request",
    });

    expect(result).toMatchObject({ ok: false, code: "validation_error" });
    expect(commandMocks.execute).not.toHaveBeenCalled();
  });
});
