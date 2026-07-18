import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/lib/command-foundation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/command-foundation")>()),
  executeIdempotentCommand: commandMocks.execute,
}));

import {
  executeCancelProcedurePlanCommand,
  executeCreateProcedurePlanCommand,
  executeRecordProcedureOccurrenceCommand,
} from "@/lib/procedure-write";
import type { ResolvedActor } from "@/lib/session";

const actor = {
  id: "actor-1",
  email: "manager@example.test",
  name: "Lab manager",
  role: "researcher",
  databaseRole: "lab_user",
  canonicalRole: "lab_user",
  authzVersion: 4,
  activeLabId: "lab-1",
  activeMembership: { labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "manager" },
  memberships: [{ labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "manager" }],
  capabilities: ["procedures:operational", "procedures:plan"],
} as ResolvedActor;

beforeEach(() => {
  commandMocks.execute.mockReset();
  commandMocks.execute.mockResolvedValue({ ok: true, result: { message: "ok" } });
});

describe("procedure command wiring", () => {
  it("binds planning to the exact assignment, experiment, lab, SOP assignment, and command identity", async () => {
    await executeCreateProcedurePlanCommand({
      actor,
      command: {
        planId: "procedure-plan-0001",
        labId: "lab-1",
        assignmentId: "assignment-1",
        sopAssignmentId: "sop-assignment-1",
        procedureCode: " DOSING ",
        title: " Daily dose ",
        scheduledAt: "2026-07-20T09:30:00.000Z",
      },
      expectedAssignmentVersion: 3,
      expectedExperimentVersion: 6,
      idempotencyKey: "plan-key",
      requestId: "plan-request",
    });

    expect(commandMocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      commandType: "procedure.plan.create",
      idempotencyKey: "plan-key",
      requestId: "plan-request",
      requiredCapability: "procedures:plan",
      labId: "lab-1",
      aggregateType: "procedure_plan",
      aggregateId: "procedure-plan-0001",
      request: {
        command: {
          planId: "procedure-plan-0001",
          labId: "lab-1",
          assignmentId: "assignment-1",
          sopAssignmentId: "sop-assignment-1",
          procedureCode: "DOSING",
          title: "Daily dose",
          scheduledAt: "2026-07-20T09:30:00.000Z",
        },
        expectedAssignmentVersion: 3,
        expectedExperimentVersion: 6,
      },
    }));
  });

  it("requires the current plan version for cancellation and execution", async () => {
    await executeCancelProcedurePlanCommand({
      actor,
      command: { planId: "procedure-plan-0001", labId: "lab-1", reason: " Animal reassigned " },
      expectedVersion: 2,
      idempotencyKey: "cancel-key",
      requestId: "cancel-request",
    });
    await executeRecordProcedureOccurrenceCommand({
      actor: { ...actor, canonicalRole: "cmu_staff", role: "colony_manager", capabilities: ["procedures:execute"] },
      command: {
        planId: "procedure-plan-0002",
        labId: "lab-1",
        occurrenceKey: "dose-1",
        occurredAt: "2026-07-15T09:30:00.000Z",
        status: "completed",
      },
      expectedVersion: 4,
      idempotencyKey: "execute-key",
      requestId: "execute-request",
    });

    expect(commandMocks.execute).toHaveBeenNthCalledWith(1, expect.objectContaining({
      commandType: "procedure.plan.cancel",
      requiredCapability: "procedures:plan",
      aggregateType: "procedure_plan",
      aggregateId: "procedure-plan-0001",
      expectedVersion: 2,
    }));
    expect(commandMocks.execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      commandType: "procedure.occurrence.record",
      requiredCapability: "procedures:execute",
      aggregateType: "procedure_plan",
      aggregateId: "procedure-plan-0002",
      expectedVersion: 4,
    }));
  });

  it("rejects an aborted occurrence without an outcome before opening a receipt", async () => {
    const result = await executeRecordProcedureOccurrenceCommand({
      actor,
      command: {
        planId: "procedure-plan-0001",
        labId: "lab-1",
        occurrenceKey: "attempt-1",
        occurredAt: "2026-07-15T09:30:00.000Z",
        status: "aborted",
      },
      expectedVersion: 1,
      idempotencyKey: "invalid-key",
      requestId: "invalid-request",
    });

    expect(result).toMatchObject({ ok: false, code: "validation_error" });
    expect(commandMocks.execute).not.toHaveBeenCalled();
  });

  it("rejects execution when reviewed assignment context changed after planning", async () => {
    await executeRecordProcedureOccurrenceCommand({
      actor: { ...actor, canonicalRole: "cmu_staff", role: "colony_manager", capabilities: ["procedures:execute"] },
      command: {
        planId: "procedure-plan-0003",
        labId: "lab-1",
        occurrenceKey: "dose-1",
        occurredAt: "2026-07-15T09:30:00.000Z",
        status: "completed",
      },
      expectedVersion: 1,
      idempotencyKey: "changed-context-key",
      requestId: "changed-context-request",
    });

    const handler = commandMocks.execute.mock.calls[0][0].handler as (
      tx: Record<string, unknown>,
      context: { receiptId: string },
    ) => Promise<{ ok: boolean; code?: string; message?: string }>;
    const occurrenceCreate = vi.fn();
    const tx = {
      procedurePlan: {
        findFirst: vi.fn().mockResolvedValue({
          id: "procedure-plan-0003",
          labId: "lab-1",
          experimentId: "experiment-1",
          assignmentId: "assignment-1",
          procedureCode: "DOSE",
          title: "Daily dose",
          scheduledAt: new Date("2026-07-15T09:00:00.000Z"),
          createdAt: new Date("2026-07-14T09:00:00.000Z"),
          status: "planned",
          version: 1,
          sopId: "sop-1",
          sopVersionId: "sop-version-1",
          sopVersionNumber: 1,
          sopContentHash: "a".repeat(64),
          sopAssignmentId: "sop-assignment-1",
          assignmentContextSnapshot: {
            animalId: "animal-1",
            startDate: "2026-07-01T00:00:00",
            endDate: null,
            treatmentGroup: "Reviewed control",
          },
          experimentContextSnapshot: { experimentCode: "EXP-1", treatmentSummary: "Reviewed vehicle" },
          experiment: { id: "experiment-1", experimentCode: "EXP-1", version: 2, status: "active" },
          assignment: {
            id: "assignment-1",
            version: 2,
            animalId: "animal-1",
            status: "active",
            startDate: new Date("2026-07-01T00:00:00.000Z"),
            animal: {
              facilityAnimalId: "0001",
              owningLabId: "lab-1",
              outcomeStatus: "alive",
              currentCage: null,
            },
          },
          sop: { active: true, currentVersionId: "sop-version-1" },
          sopVersion: {
            versionNumber: 1,
            contentHash: "a".repeat(64),
            createdAt: new Date("2026-07-01T00:00:00.000Z"),
            approval: { decision: "approved", decidedAt: new Date("2026-07-02T00:00:00.000Z") },
          },
        }),
      },
      sopAssignment: {
        findFirst: vi.fn().mockResolvedValue({ id: "sop-assignment-1", assignedAt: new Date("2026-07-03T00:00:00.000Z") }),
      },
      procedureOccurrence: { create: occurrenceCreate },
      $queryRaw: vi.fn().mockResolvedValue([{
        assignmentContext: {
          animalId: "animal-1",
          startDate: "2026-07-01T00:00:00",
          endDate: null,
          treatmentGroup: "Changed treatment",
        },
        experimentContext: { experimentCode: "EXP-1", treatmentSummary: "Reviewed vehicle" },
      }]),
    };

    const result = await handler(tx, { receiptId: "receipt-1" });

    expect(result).toMatchObject({ ok: false, code: "invalid_snapshot" });
    expect(result.message).toContain("changed after planning");
    expect(occurrenceCreate).not.toHaveBeenCalled();
  });
});
