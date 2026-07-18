import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  readback: vi.fn(),
  requireApiUser: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("@/lib/api-route", () => ({
  requireApiUser: mocks.requireApiUser,
  buildApiErrorResponse: (error: string, status = 400, details?: unknown) => Response.json(
    { error, ...(details ? { details } : {}) },
    { status },
  ),
  buildMutationResponse: (data: unknown, input: { status: number; message: string; created: boolean }) => Response.json(
    { data, meta: { created: input.created, message: input.message } },
    { status: input.status },
  ),
}));
vi.mock("@/lib/experiment-assignment-write", () => ({
  executeReserveAnimalForExperimentCommand: mocks.command,
}));
vi.mock("@/lib/integration-api", () => ({
  getExperimentAssignmentApiRecordById: mocks.readback,
  resolveExperimentReservationApiInput: mocks.resolve,
}));

import { POST } from "@/app/api/v1/experiments/reservations/route";

const actor = {
  id: "actor-1",
  role: "animal_staff",
  canonicalRole: "lab_user",
  activeLabId: "lab-1",
};
const body = {
  experimentCode: "EXP-1",
  animalCode: "CM-001",
  expectedAnimalVersion: 3,
  expectedExperimentVersion: 5,
  startDate: "2026-07-20",
  treatmentGroup: "Arm A",
};

function request() {
  return new Request("http://localhost/api/v1/experiments/reservations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "reservation-key",
      "x-request-id": "reservation-request",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiUser.mockResolvedValue({ user: actor });
  mocks.resolve.mockResolvedValue({
    ok: true,
    value: {
      animalCode: "CM-001",
      animalId: "animal-1",
      animalVersion: 3,
      experimentCode: "EXP-1",
      experimentId: "experiment-1",
      experimentVersion: 5,
      treatmentGroup: "Arm A",
    },
  });
});

describe("direct experiment reservation route", () => {
  it.each(["stale_conflict", "idempotency_conflict", "command_in_progress", "reservation_conflict"])(
    "returns 409 for %s",
    async (code) => {
      mocks.command.mockResolvedValue({ ok: false, code, message: "Conflict" });

      const response = await POST(request());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: "Conflict" });
      expect(mocks.readback).not.toHaveBeenCalled();
    },
  );

  it("passes both versions and identities to the command and replays through authorized assignment readback", async () => {
    mocks.command.mockResolvedValue({
      ok: true,
      replayed: true,
      result: { assignmentId: "assignment-1", message: "CM-001 reserved for EXP-1." },
    });
    mocks.readback.mockResolvedValue({ id: "assignment-1", status: "reserved" });

    const response = await POST(request());
    const payload = await response.json() as { data: { id: string }; meta: { created: boolean } };

    expect(mocks.command).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      expectedAnimalVersion: 3,
      expectedExperimentVersion: 5,
      idempotencyKey: "reservation-key",
      requestId: "reservation-request",
      command: expect.objectContaining({ animalId: "animal-1", experimentId: "experiment-1" }),
    }));
    expect(mocks.readback).toHaveBeenCalledWith("assignment-1", actor);
    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.data.id).toBe("assignment-1");
  });
});
