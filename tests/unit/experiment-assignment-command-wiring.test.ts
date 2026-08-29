import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({ execute: vi.fn(), staleConflict: vi.fn() }));

vi.mock("@/lib/command-foundation", () => ({
  executeIdempotentCommand: commandMocks.execute,
  staleConflict: commandMocks.staleConflict,
}));

vi.mock("@/lib/protocol-compliance", () => ({
  withComplianceWriteScope: vi.fn(async (_tx, _input, operation) => operation({
    ok: true,
    protocolAuthorizationId: "protocol-1",
    protocolVersionId: "protocol-version-1",
    evidenceSnapshotId: "evidence-1",
    ledgerId: "ledger-1",
    allocationId: "protocol-allocation-1",
    allocations: [],
  })),
  withM13MutationSavepoint: vi.fn(async (_tx, operation) => operation()),
  releaseProtocolReservation: vi.fn(async () => ({ ok: true })),
}));

import {
  executeDeletePlannedExperimentAssignmentCommand,
  executeDemoteExperimentAssignmentsCommand,
  executePlanExperimentAssignmentsCommand,
  executePromoteExperimentAssignmentsCommand,
  executeReserveAnimalForExperimentCommand,
  executeUpdatePlannedExperimentAssignmentCommand,
  experimentPromotionAllocationMarker,
  experimentReservationAllocationMarker,
} from "@/lib/experiment-assignment-write";
import type { ResolvedActor } from "@/lib/session";

const actor = {
  id: "actor-1",
  email: "manager@example.test",
  name: "Manager",
  role: "animal_staff",
  databaseRole: "lab_user",
  canonicalRole: "lab_user",
  authzVersion: 7,
  activeLabId: "lab-1",
  activeMembership: { labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "manager" },
  memberships: [{ labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "manager" }],
  capabilities: ["experiments:manage"],
} as ResolvedActor;

beforeEach(() => {
  commandMocks.execute.mockReset();
  commandMocks.staleConflict.mockReset();
  commandMocks.staleConflict.mockImplementation((aggregateType, aggregateId, expectedVersion, currentVersion) => ({
    ok: false,
    code: "stale_conflict",
    aggregateType,
    aggregateId,
    expectedVersion,
    currentVersion,
    message: "stale",
  }));
  commandMocks.execute.mockResolvedValue({ ok: true, result: { message: "ok" } });
});

async function productionSource() {
  const root = path.join(process.cwd(), "src");
  const files: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (/\.(ts|tsx)$/.test(entry.name) && target !== path.join(root, "lib/colony-write.ts")) files.push(target);
    }
  }
  await visit(root);
  return (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
}

describe("experiment assignment command wiring", () => {
  it("binds direct reservation to the animal aggregate and the exact two-version snapshot", async () => {
    await executeReserveAnimalForExperimentCommand({
      actor,
      command: {
        animalId: "animal-1",
        experimentId: "experiment-1",
        startDate: "2026-07-20",
        treatmentGroup: " Arm A ",
        notes: " Exact snapshot ",
      },
      expectedAnimalVersion: 3,
      expectedExperimentVersion: 5,
      idempotencyKey: "reservation-key",
      requestId: "reservation-request",
    });

    expect(commandMocks.execute).toHaveBeenCalledOnce();
    expect(commandMocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      commandType: "experiment.assignment.reserve_direct",
      idempotencyKey: "reservation-key",
      requestId: "reservation-request",
      requiredCapability: "experiments:manage",
      labId: "lab-1",
      aggregateType: "animal",
      aggregateId: "animal-1",
      expectedVersion: 3,
      request: {
        command: {
          animalId: "animal-1",
          experimentId: "experiment-1",
          startDate: "2026-07-20",
          treatmentGroup: "Arm A",
          notes: "Exact snapshot",
        },
        expectedAnimalVersion: 3,
        expectedExperimentVersion: 5,
      },
    }));
  });

  it("fails closed when a second cross-experiment reservation loses the conditional animal update", async () => {
    await executeReserveAnimalForExperimentCommand({
      actor,
      command: { animalId: "animal-1", experimentId: "experiment-a", startDate: "2026-07-20" },
      expectedAnimalVersion: 3,
      expectedExperimentVersion: 5,
      idempotencyKey: "reservation-a",
      requestId: "request-a",
    });
    await executeReserveAnimalForExperimentCommand({
      actor,
      command: { animalId: "animal-1", experimentId: "experiment-b", startDate: "2026-07-20" },
      expectedAnimalVersion: 3,
      expectedExperimentVersion: 5,
      idempotencyKey: "reservation-b",
      requestId: "request-b",
    });
    const firstHandler = commandMocks.execute.mock.calls[0][0].handler;
    const secondHandler = commandMocks.execute.mock.calls[1][0].handler;
    const experiment = (id: string) => ({
      id,
      labId: "lab-1",
      experimentCode: id === "experiment-a" ? "EXP-A" : "EXP-B",
      projectId: "project-1",
      status: "planned",
      version: 5,
      plannedStartAt: new Date("2026-07-01T00:00:00.000Z"),
      plannedEndAt: new Date("2026-07-31T00:00:00.000Z"),
      project: { labId: "lab-1", projectCode: "PRJ-1" },
    });
    const animal = {
      id: "animal-1",
      animalId: "CM-001",
      owningLabId: "lab-1",
      outcomeStatus: "alive",
      status: "colony_holding",
      version: 3,
      alleles: [{ callStatus: "confirmed" }],
      experimentAssignments: [],
      projectAllocations: [{ id: "allocation-1" }],
    };
    const firstTx = {
      experiment: { findFirst: vi.fn().mockResolvedValue(experiment("experiment-a")), findUnique: vi.fn() },
      animal: { findUnique: vi.fn().mockResolvedValue(animal) },
      $queryRaw: vi.fn().mockResolvedValue([{
        assignmentId: "assignment-a",
        assignmentVersion: 1,
        animalVersion: 4,
        experimentVersion: 6,
      }]),
      animalProjectAllocation: { create: vi.fn() },
      animalStatusEvent: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const secondTx = {
      experiment: {
        findFirst: vi.fn().mockResolvedValueOnce(experiment("experiment-b")),
        findUnique: vi.fn()
          .mockResolvedValueOnce({ version: 5 }),
      },
      animal: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(animal)
          .mockResolvedValueOnce({ version: 4 }),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      animalProjectAllocation: { create: vi.fn() },
      animalStatusEvent: { create: vi.fn() },
      auditLog: { create: vi.fn() },
    };

    await expect(firstHandler(firstTx, { receiptId: "receipt-a" })).resolves.toMatchObject({ ok: true });
    await expect(secondHandler(secondTx, { receiptId: "receipt-b" })).resolves.toMatchObject({
      ok: false,
      code: "stale_conflict",
      aggregateType: "animal",
      aggregateId: "animal-1",
      expectedVersion: 3,
      currentVersion: 4,
    });
    expect(secondTx.animalStatusEvent.create).not.toHaveBeenCalled();
    expect(secondTx.auditLog.create).not.toHaveBeenCalled();
  });

  it("scopes the reservation experiment lookup to the active lab and hides foreign IDs as not found", async () => {
    await executeReserveAnimalForExperimentCommand({
      actor,
      command: { animalId: "animal-1", experimentId: "foreign-experiment", startDate: "2026-07-20" },
      expectedAnimalVersion: 3,
      expectedExperimentVersion: 5,
      idempotencyKey: "foreign-reservation-key",
      requestId: "foreign-reservation-request",
    });
    const handler = commandMocks.execute.mock.calls[0][0].handler;
    const findFirst = vi.fn().mockResolvedValue(null);

    await expect(handler({ experiment: { findFirst } }, { receiptId: "receipt-foreign" })).resolves.toMatchObject({
      ok: false,
      code: "not_found",
    });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "foreign-experiment", labId: "lab-1" },
    }));
  });

  it("binds the exact plan snapshot, experiment version, identities, lab, and command type", async () => {
    const assignments = [
      { animalId: "CM-001", treatmentGroup: "Group A" },
      { animalId: "CM-002", treatmentGroup: "Group B" },
    ];
    await executePlanExperimentAssignmentsCommand({
      actor,
      command: { experimentId: "experiment-1", startDate: "2026-07-20", notes: "Rendered", assignments },
      expectedExperimentVersion: 4,
      idempotencyKey: "plan-key",
      requestId: "plan-request",
    });

    expect(commandMocks.execute).toHaveBeenCalledOnce();
    expect(commandMocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      commandType: "experiment.assignments.plan",
      idempotencyKey: "plan-key",
      requestId: "plan-request",
      requiredCapability: "experiments:manage",
      labId: "lab-1",
      aggregateType: "experiment",
      aggregateId: "experiment-1",
      expectedVersion: 4,
      request: { experimentId: "experiment-1", startDate: "2026-07-20", notes: "Rendered", assignments },
    }));
  });

  it("wires promote and demote with exact assignment IDs and expected versions", async () => {
    const assignments = [
      { assignmentId: "assignment-1", expectedVersion: 2 },
      { assignmentId: "assignment-2", expectedVersion: 5 },
    ];
    const common = {
      actor,
      command: { experimentId: "experiment-1", assignments },
      expectedExperimentVersion: 8,
      idempotencyKey: "batch-key",
      requestId: "batch-request",
    };

    await executePromoteExperimentAssignmentsCommand(common);
    await executeDemoteExperimentAssignmentsCommand({ ...common, idempotencyKey: "demote-key" });

    expect(commandMocks.execute).toHaveBeenNthCalledWith(1, expect.objectContaining({
      commandType: "experiment.assignments.promote",
      expectedVersion: 8,
      request: { experimentId: "experiment-1", assignments },
    }));
    expect(commandMocks.execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      commandType: "experiment.assignments.demote",
      expectedVersion: 8,
      request: { experimentId: "experiment-1", assignments },
    }));
  });

  it("wires planned edit and delete with both concurrency versions", async () => {
    await executeUpdatePlannedExperimentAssignmentCommand({
      actor,
      command: {
        experimentId: "experiment-1",
        assignmentId: "assignment-1",
        startDate: "2026-07-21",
        treatmentGroup: "Group C",
        notes: "Updated",
      },
      expectedExperimentVersion: 9,
      expectedAssignmentVersion: 3,
      idempotencyKey: "update-key",
      requestId: "update-request",
    });
    await executeDeletePlannedExperimentAssignmentCommand({
      actor,
      command: { experimentId: "experiment-1", assignmentId: "assignment-1" },
      expectedExperimentVersion: 10,
      expectedAssignmentVersion: 4,
      idempotencyKey: "delete-key",
      requestId: "delete-request",
    });

    expect(commandMocks.execute).toHaveBeenNthCalledWith(1, expect.objectContaining({
      commandType: "experiment.assignment.update_planned",
      expectedVersion: 9,
      request: expect.objectContaining({ expectedAssignmentVersion: 3 }),
    }));
    expect(commandMocks.execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      commandType: "experiment.assignment.delete_planned",
      expectedVersion: 10,
      request: expect.objectContaining({ expectedAssignmentVersion: 4 }),
    }));
  });

  it("rejects non-calendar dates before opening a command and exposes a durable allocation marker", async () => {
    const result = await executePlanExperimentAssignmentsCommand({
      actor,
      command: {
        experimentId: "experiment-1",
        startDate: "2026-02-30",
        assignments: [{ animalId: "CM-001", treatmentGroup: "Group A" }],
      },
      expectedExperimentVersion: 1,
      idempotencyKey: "bad-date-key",
      requestId: "bad-date-request",
    });

    expect(result.ok).toBe(false);
    expect(commandMocks.execute).not.toHaveBeenCalled();
    expect(experimentPromotionAllocationMarker("assignment-1")).toBe("[mcm:auto:experiment-promotion:assignment-1]");
    expect(experimentReservationAllocationMarker("assignment-1")).toBe("[mcm:auto:experiment-reservation:assignment-1]");
  });

  it("has no production caller for the five legacy assignment mutations", async () => {
    const files = [
      "src/app/experiments/actions.ts",
      "src/app/api/v1/experiments/assignments/route.ts",
      "src/app/api/v1/experiments/assignments/[assignmentId]/route.ts",
      "src/components/app/experiment-plan-save-form.tsx",
      "src/components/app/experiments-worksheet.tsx",
    ];
    const source = (await Promise.all(files.map((file) => readFile(path.join(process.cwd(), file), "utf8")))).join("\n");
    for (const legacyName of [
      "planExperimentCohortAssignments",
      "promotePlannedExperimentAssignments",
      "demoteReservedExperimentAssignments",
      "updatePlannedExperimentAssignment",
      "deletePlannedExperimentAssignment",
    ]) {
      expect(source).not.toContain(legacyName);
    }
  });

  it("requires command identities and versions in API and form callers", async () => {
    const [collectionRoute, detailRoute, form] = await Promise.all([
      readFile(path.join(process.cwd(), "src/app/api/v1/experiments/assignments/route.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src/app/api/v1/experiments/assignments/[assignmentId]/route.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src/components/app/experiment-plan-save-form.tsx"), "utf8"),
    ]);

    for (const route of [collectionRoute, detailRoute]) {
      expect(route).toContain('request.headers.get("idempotency-key")');
      expect(route).toContain('request.headers.get("x-request-id")');
      expect(route).toContain("expectedExperimentVersion");
    }
    expect(collectionRoute).toContain("expectedVersion: z.number().int().positive()");
    expect(detailRoute).toContain("expectedAssignmentVersion");
    expect(form).toContain('name="expectedExperimentVersion"');
    expect(form).toContain('name="expectedAssignmentVersion"');
    expect(form).toContain('name="idempotencyKey"');
    expect(form).toContain('name="requestId"');
  });

  it("has no production caller of the legacy direct reservation and uses receipt replay in both entry points", async () => {
    const [source, action, route, form] = await Promise.all([
      productionSource(),
      readFile(path.join(process.cwd(), "src/app/animals/[animalId]/actions.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src/app/api/v1/experiments/reservations/route.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src/components/app/experiment-reservation-form.tsx"), "utf8"),
    ]);

    expect(source).not.toContain("reserveAnimalForExperiment");
    for (const caller of [action, route]) {
      expect(caller).toContain("executeReserveAnimalForExperimentCommand");
      expect(caller).toContain("expectedAnimalVersion");
      expect(caller).toContain("expectedExperimentVersion");
      expect(caller).toContain("idempotencyKey");
      expect(caller).toContain("requestId");
    }
    expect(route).not.toContain("getExistingExperimentReservationApiRecord");
    expect(route).toContain('request.headers.get("idempotency-key")');
    expect(route).toContain('request.headers.get("x-request-id")');
    expect(route).toContain("getExperimentAssignmentApiRecordById");
    for (const field of ["expectedAnimalVersion", "expectedExperimentVersion", "idempotencyKey", "requestId"]) {
      expect(form).toContain(`name="${field}"`);
    }
  });

  it("renders reservation actions from the exact capability instead of legacy roles", async () => {
    const page = await readFile(path.join(process.cwd(), "src/app/animals/[animalId]/page.tsx"), "utf8");

    expect(page).toContain('user.capabilities.includes("experiments:manage")');
    expect(page).not.toContain('user.role === "admin" || user.role === "colony_manager" || user.role === "researcher"');
  });
});
