import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  workspace: vi.fn(),
  readPlan: vi.fn(),
  createPlan: vi.fn(),
  recordOccurrence: vi.fn(),
}));

vi.mock("@/lib/api-route", () => ({
  requireApiUser: mocks.requireApiUser,
  buildApiErrorResponse: (error: string, status = 400, details?: unknown) => Response.json(
    { error, ...(details ? { details } : {}) },
    { status },
  ),
  buildCollectionResponse: (data: unknown[], input: { total: number }) => Response.json({ data, meta: { total: input.total } }),
  buildMutationResponse: (data: unknown, input: { status: number; message: string; created: boolean }) => Response.json(
    { data, meta: { created: input.created, message: input.message } },
    { status: input.status },
  ),
}));
vi.mock("@/lib/procedure-read", () => ({
  getProcedureWorkspace: mocks.workspace,
  getProcedurePlanById: mocks.readPlan,
}));
vi.mock("@/lib/procedure-write", () => ({
  executeCreateProcedurePlanCommand: mocks.createPlan,
  executeRecordProcedureOccurrenceCommand: mocks.recordOccurrence,
}));

import { GET as getProcedures, POST as createProcedure } from "@/app/api/v1/procedures/route";
import {
  GET as getOccurrences,
  POST as recordOccurrence,
} from "@/app/api/v1/procedures/[procedureId]/occurrences/route";

const actor = { id: "actor-1", activeLabId: "lab-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireApiUser.mockResolvedValue({ user: actor });
  mocks.workspace.mockResolvedValue({ rows: [{ id: "plan-1" }] });
  mocks.readPlan.mockResolvedValue({
    id: "plan-1",
    occurrences: [{ id: "occurrence-1" }],
  });
});

describe("procedure API routes", () => {
  it("uses operational capability for collection and direct occurrence reads", async () => {
    const list = await getProcedures(new Request("http://localhost/api/v1/procedures?status=planned"));
    const history = await getOccurrences(
      new Request("http://localhost/api/v1/procedures/plan-1/occurrences"),
      { params: Promise.resolve({ procedureId: "plan-1" }) },
    );

    expect(list.status).toBe(200);
    expect(history.status).toBe(200);
    expect(mocks.requireApiUser).toHaveBeenNthCalledWith(1, "procedures:operational");
    expect(mocks.requireApiUser).toHaveBeenNthCalledWith(2, "procedures:operational");
    expect(mocks.readPlan).toHaveBeenCalledWith(actor, "plan-1");
  });

  it("rejects an unknown collection status before querying procedure data", async () => {
    const response = await getProcedures(new Request("http://localhost/api/v1/procedures?status=not-a-status"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid procedure status filter." });
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("passes idempotency and both upstream versions to procedure planning", async () => {
    mocks.createPlan.mockResolvedValue({
      ok: true,
      replayed: false,
      result: { planId: "procedure-plan-0001", message: "Planned" },
    });
    mocks.readPlan.mockResolvedValue({ id: "procedure-plan-0001", occurrences: [] });
    const request = new Request("http://localhost/api/v1/procedures", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "plan-key",
        "x-request-id": "plan-request",
      },
      body: JSON.stringify({
        planId: "procedure-plan-0001",
        labId: "lab-1",
        assignmentId: "assignment-1",
        sopAssignmentId: "sop-assignment-1",
        procedureCode: "DOSE",
        title: "Daily dose",
        scheduledAt: "2026-07-20T09:00:00.000Z",
        expectedAssignmentVersion: 3,
        expectedExperimentVersion: 6,
      }),
    });

    const response = await createProcedure(request);
    expect(response.status).toBe(201);
    expect(mocks.requireApiUser).toHaveBeenCalledWith("procedures:plan");
    expect(mocks.createPlan).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      expectedAssignmentVersion: 3,
      expectedExperimentVersion: 6,
      idempotencyKey: "plan-key",
      requestId: "plan-request",
    }));
  });

  it("requires execution capability and the current plan version for an outcome", async () => {
    mocks.recordOccurrence.mockResolvedValue({
      ok: true,
      replayed: true,
      result: { occurrenceId: "occurrence-1", message: "Recorded" },
    });
    const request = new Request("http://localhost/api/v1/procedures/plan-1/occurrences", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "execute-key",
        "x-request-id": "execute-request",
      },
      body: JSON.stringify({
        labId: "lab-1",
        occurrenceKey: "attempt-1",
        occurredAt: "2026-07-15T09:00:00.000Z",
        status: "completed",
        expectedVersion: 4,
      }),
    });

    const response = await recordOccurrence(request, { params: Promise.resolve({ procedureId: "plan-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.requireApiUser).toHaveBeenCalledWith("procedures:execute");
    expect(mocks.recordOccurrence).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      expectedVersion: 4,
      idempotencyKey: "execute-key",
      requestId: "execute-request",
      command: expect.objectContaining({ planId: "plan-1", occurrenceKey: "attempt-1" }),
    }));
  });
});
