import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getActorCapabilities } from "@/lib/capabilities";
import { executeTransitionExperimentCommand } from "@/lib/experiments-write";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";
import { seedDatabase } from "../../prisma/seed-database";
import { DEMO_PROTOCOL_AUTHORIZATION_ID } from "../../prisma/seed-demo-compliance";

const EXPERIMENT_ID = "m13-completion-experiment";
const ASSIGNMENT_ID = "m13-completion-assignment";
const ANIMAL_ID = "m13-completion-animal";
const PROJECT_ALLOCATION_ID = "m13-completion-project-allocation";
const PROTOCOL_ALLOCATION_ID = "m13-completion-protocol-allocation";
const SHARED_ANIMAL_ID = "m13-completion-shared-animal";
const SHARED_ASSIGNMENT_ID = "m13-completion-shared-assignment";
const SHARED_PROJECT_ALLOCATION_ID = "m13-completion-shared-project-allocation";
const SHARED_PROTOCOL_ALLOCATION_ID = "m13-completion-shared-protocol-allocation";
const OTHER_EXPERIMENT_ID = "m13-completion-other-experiment";

const activeMembership = {
  labId: "lab-microglia",
  labCode: "LAB-MICRO",
  labName: "Microglia Imaging Lab",
  role: "owner" as const,
};
const actor: ResolvedActor = {
  id: "user-admin",
  email: "admin@colony.local",
  name: "Colony Admin",
  role: "admin",
  databaseRole: "admin",
  canonicalRole: "lab_user",
  authzVersion: 1,
  activeLabId: activeMembership.labId,
  activeMembership,
  memberships: [activeMembership],
  capabilities: [...getActorCapabilities({ canonicalRole: "lab_user", activeMembership })],
};

async function createCompletionFixture(
  status: "active" | "planned" = "active",
  withOtherOpenAssignment = false,
) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    const protocol = await tx.protocolAuthorization.findUniqueOrThrow({
      where: { id: DEMO_PROTOCOL_AUTHORIZATION_ID },
      select: {
        currentVersionId: true,
        currentVersion: { select: { countLedger: { select: { id: true, reservedCount: true, consumedCount: true, version: true } } } },
      },
    });
    const protocolVersionId = protocol.currentVersionId;
    const ledger = protocol.currentVersion?.countLedger;
    if (!protocolVersionId || !ledger) throw new Error("Base demo protocol ledger is missing.");

    await tx.animal.create({
      data: {
        id: ANIMAL_ID,
        facilityAnimalId: "9901",
        animalId: "M13-COMPLETE-1",
        labId: "M13-COMPLETE-LEGACY-1",
        owningLabId: "lab-microglia",
        sex: "female",
        dob: new Date("2026-01-01T00:00:00.000Z"),
        strainId: "strain-creer",
        status: status === "planned" ? "colony_holding" : "in_experiment",
        originType: "m13 completion integration fixture",
        healthStatus: "fit",
        projectSummary: "PRJ-MICRO-24",
        experimentalStatus: status === "planned" ? "Planned" : "Active in M13-COMPLETE",
      },
    });
    if (withOtherOpenAssignment) {
      await tx.animal.create({
        data: {
          id: SHARED_ANIMAL_ID,
          facilityAnimalId: "9902",
          animalId: "M13-COMPLETE-2",
          labId: "M13-COMPLETE-LEGACY-2",
          owningLabId: "lab-microglia",
          sex: "male",
          dob: new Date("2026-01-02T00:00:00.000Z"),
          strainId: "strain-creer",
          status: "in_experiment",
          originType: "m13 completion integration fixture",
          healthStatus: "fit",
          projectSummary: "PRJ-MICRO-24",
          experimentalStatus: "Active in M13-COMPLETE, M13-OTHER",
        },
      });
    }
    await tx.experiment.create({
      data: {
        id: EXPERIMENT_ID,
        labId: "lab-microglia",
        experimentCode: "M13-COMPLETE",
        projectId: "project-micro",
        title: "M13 atomic experiment completion",
        ownerId: "user-admin",
        status: "active",
        protocolAuthorizationId: DEMO_PROTOCOL_AUTHORIZATION_ID,
      },
    });
    if (withOtherOpenAssignment) {
      await tx.experiment.create({
        data: {
          id: OTHER_EXPERIMENT_ID,
          labId: "lab-microglia",
          experimentCode: "M13-OTHER",
          projectId: "project-micro",
          title: "Other open experiment",
          ownerId: "user-admin",
          status: "active",
          protocolAuthorizationId: DEMO_PROTOCOL_AUTHORIZATION_ID,
        },
      });
    }
    if (status === "active") {
      await tx.protocolCountAllocation.createMany({
        data: [{
          id: PROTOCOL_ALLOCATION_ID,
          ledgerId: ledger.id,
          authorizationVersionId: protocolVersionId,
          allocationKey: "m13-completion:assignment:consumed",
          aggregateType: "experiment_assignment",
          aggregateId: ASSIGNMENT_ID,
          reservedQuantity: 1,
          consumedQuantity: 1,
          releasedQuantity: 0,
          status: "consumed",
          version: 2,
          createdById: "user-admin",
          createdCommandReceiptId: "demo-litter-001-allocation-receipt",
        }, ...(withOtherOpenAssignment ? [{
          id: SHARED_PROTOCOL_ALLOCATION_ID,
          ledgerId: ledger.id,
          authorizationVersionId: protocolVersionId,
          allocationKey: "m13-completion:shared-assignment:consumed",
          aggregateType: "experiment_assignment",
          aggregateId: SHARED_ASSIGNMENT_ID,
          reservedQuantity: 1,
          consumedQuantity: 1,
          releasedQuantity: 0,
          status: "consumed" as const,
          version: 2,
          createdById: "user-admin",
          createdCommandReceiptId: "demo-litter-001-allocation-receipt",
        }] : [])],
      });
      await tx.protocolCountLedger.update({
        where: { id: ledger.id },
        data: {
          consumedCount: ledger.consumedCount + (withOtherOpenAssignment ? 2 : 1),
          version: ledger.version + 1,
        },
      });
    }
    await tx.experimentAssignment.create({
      data: {
        id: ASSIGNMENT_ID,
        animalId: ANIMAL_ID,
        experimentId: EXPERIMENT_ID,
        status,
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        treatmentGroup: "Completion arm",
        protocolCountAllocationId: status === "active" ? PROTOCOL_ALLOCATION_ID : null,
      },
    });
    if (withOtherOpenAssignment) {
      await tx.experimentAssignment.createMany({
        data: [
          {
            id: SHARED_ASSIGNMENT_ID,
            animalId: SHARED_ANIMAL_ID,
            experimentId: EXPERIMENT_ID,
            status: "active",
            startDate: new Date("2026-08-01T00:00:00.000Z"),
            treatmentGroup: "Shared completion arm",
            protocolCountAllocationId: SHARED_PROTOCOL_ALLOCATION_ID,
          },
          {
            id: "m13-completion-other-assignment",
            animalId: SHARED_ANIMAL_ID,
            experimentId: OTHER_EXPERIMENT_ID,
            status: "active",
            startDate: new Date("2026-08-02T00:00:00.000Z"),
            treatmentGroup: "Ongoing arm",
          },
        ],
      });
    }
    await tx.animalProjectAllocation.create({
      data: {
        id: PROJECT_ALLOCATION_ID,
        animalId: ANIMAL_ID,
        projectId: "project-micro",
        startedAt: new Date("2026-08-01T00:00:00.000Z"),
        notes: `[mcm:auto:experiment-reservation:${ASSIGNMENT_ID}]`,
      },
    });
    if (withOtherOpenAssignment) {
      await tx.animalProjectAllocation.create({
        data: {
          id: SHARED_PROJECT_ALLOCATION_ID,
          animalId: SHARED_ANIMAL_ID,
          projectId: "project-micro",
          startedAt: new Date("2026-08-01T00:00:00.000Z"),
          notes: `[mcm:auto:experiment-reservation:${SHARED_ASSIGNMENT_ID}]`,
        },
      });
    }
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
  });
}

async function completionState() {
  const [experiment, assignment, animal, allocation, projectAllocation, assignmentAudits] = await Promise.all([
    prisma.experiment.findUniqueOrThrow({ where: { id: EXPERIMENT_ID } }),
    prisma.experimentAssignment.findUniqueOrThrow({ where: { id: ASSIGNMENT_ID } }),
    prisma.animal.findUniqueOrThrow({ where: { id: ANIMAL_ID } }),
    prisma.protocolCountAllocation.findUnique({ where: { id: PROTOCOL_ALLOCATION_ID } }),
    prisma.animalProjectAllocation.findUniqueOrThrow({ where: { id: PROJECT_ALLOCATION_ID } }),
    prisma.auditLog.findMany({ where: { entityType: "experiment_assignment", entityId: ASSIGNMENT_ID } }),
  ]);
  return { experiment, assignment, animal, allocation, projectAllocation, assignmentAudits };
}

beforeEach(async () => {
  await seedDatabase({ clearAttachments: false });
});

afterEach(async () => {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "m13_completion_skip_update" ON "Experiment"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "m13_completion_skip_update"()');
});

describe("M13 experiment completion", () => {
  it("atomically completes consumed assignments and replays without double mutation", async () => {
    await createCompletionFixture();
    const command = {
      actor,
      command: { experimentId: EXPERIMENT_ID, labId: "lab-microglia", status: "completed" as const },
      expectedVersion: 1,
      idempotencyKey: "m13-completion-success",
      requestId: "m13-completion-success-request",
    };

    const completed = await executeTransitionExperimentCommand(command);
    expect(completed.ok, JSON.stringify(completed)).toBe(true);
    const first = await completionState();
    expect(first.experiment).toMatchObject({ status: "completed", version: 2 });
    expect(first.assignment).toMatchObject({ status: "completed", version: 2 });
    expect(first.assignment.endDate).toBeInstanceOf(Date);
    expect(first.animal).toMatchObject({ status: "experiment_completed", version: 2, projectSummary: null });
    expect(first.projectAllocation.endedAt).toBeInstanceOf(Date);
    expect(first.allocation).toMatchObject({
      status: "consumed",
      reservedQuantity: 1,
      consumedQuantity: 1,
      releasedQuantity: 0,
      version: 2,
    });
    expect(first.assignmentAudits).toHaveLength(1);
    expect(first.assignmentAudits[0]).toMatchObject({ action: "complete_with_experiment" });

    const replayed = await executeTransitionExperimentCommand(command);
    expect(replayed).toMatchObject({ ok: true, replayed: true });
    const second = await completionState();
    expect(second.experiment.version).toBe(first.experiment.version);
    expect(second.assignment.version).toBe(first.assignment.version);
    expect(second.assignment.endDate?.getTime()).toBe(first.assignment.endDate?.getTime());
    expect(second.animal.version).toBe(first.animal.version);
    expect(second.projectAllocation.endedAt?.getTime()).toBe(first.projectAllocation.endedAt?.getTime());
    expect(second.allocation).toEqual(first.allocation);
    expect(second.assignmentAudits).toHaveLength(1);
  });

  it("rolls assignment, animal, project, and audit mutations back when the experiment update loses", async () => {
    await createCompletionFixture();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "m13_completion_skip_update"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.status = 'completed'::"ExperimentStatus" THEN RETURN NULL; END IF;
        RETURN NEW;
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "m13_completion_skip_update"
      BEFORE UPDATE ON "Experiment"
      FOR EACH ROW EXECUTE FUNCTION "m13_completion_skip_update"()
    `);

    const result = await executeTransitionExperimentCommand({
      actor,
      command: { experimentId: EXPERIMENT_ID, labId: "lab-microglia", status: "completed" },
      expectedVersion: 1,
      idempotencyKey: "m13-completion-rollback",
      requestId: "m13-completion-rollback-request",
    });
    expect(result).toMatchObject({ ok: false, code: "stale_conflict" });
    const state = await completionState();
    expect(state.experiment).toMatchObject({ status: "active", version: 1 });
    expect(state.assignment).toMatchObject({ status: "active", version: 1, endDate: null });
    expect(state.animal).toMatchObject({ status: "in_experiment", version: 1, projectSummary: "PRJ-MICRO-24" });
    expect(state.projectAllocation.endedAt).toBeNull();
    expect(state.allocation).toMatchObject({ status: "consumed", consumedQuantity: 1, releasedQuantity: 0, version: 2 });
    expect(state.assignmentAudits).toHaveLength(0);
  });

  it("preserves animal and project state required by another open assignment", async () => {
    await createCompletionFixture("active", true);
    const result = await executeTransitionExperimentCommand({
      actor,
      command: { experimentId: EXPERIMENT_ID, labId: "lab-microglia", status: "completed" },
      expectedVersion: 1,
      idempotencyKey: "m13-completion-other-open",
      requestId: "m13-completion-other-open-request",
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const [assignment, animal, projectAllocation, allocation, otherAssignment] = await Promise.all([
      prisma.experimentAssignment.findUniqueOrThrow({ where: { id: SHARED_ASSIGNMENT_ID } }),
      prisma.animal.findUniqueOrThrow({ where: { id: SHARED_ANIMAL_ID } }),
      prisma.animalProjectAllocation.findUniqueOrThrow({ where: { id: SHARED_PROJECT_ALLOCATION_ID } }),
      prisma.protocolCountAllocation.findUniqueOrThrow({ where: { id: SHARED_PROTOCOL_ALLOCATION_ID } }),
      prisma.experimentAssignment.findUniqueOrThrow({ where: { id: "m13-completion-other-assignment" } }),
    ]);
    expect(assignment).toMatchObject({ status: "completed", version: 2 });
    expect(animal).toMatchObject({ status: "in_experiment", projectSummary: "PRJ-MICRO-24", version: 2 });
    expect(projectAllocation.endedAt).toBeNull();
    expect(allocation).toMatchObject({ status: "consumed", consumedQuantity: 1, releasedQuantity: 0 });
    expect(otherAssignment).toMatchObject({ status: "active", version: 1 });
  });

  it("rejects unresolved planned assignments without mutating completion state", async () => {
    await createCompletionFixture("planned");
    const result = await executeTransitionExperimentCommand({
      actor,
      command: { experimentId: EXPERIMENT_ID, labId: "lab-microglia", status: "completed" },
      expectedVersion: 1,
      idempotencyKey: "m13-completion-planned",
      requestId: "m13-completion-planned-request",
    });
    expect(result).toMatchObject({ ok: false, code: "unresolved_planned_assignments" });
    const state = await completionState();
    expect(state.experiment).toMatchObject({ status: "active", version: 1 });
    expect(state.assignment).toMatchObject({ status: "planned", version: 1, endDate: null });
    expect(state.animal).toMatchObject({ status: "colony_holding", version: 1 });
    expect(state.projectAllocation.endedAt).toBeNull();
    expect(state.allocation).toBeNull();
    expect(state.assignmentAudits).toHaveLength(0);
  });

  it("rejects completion while an assignment still has a planned procedure", async () => {
    await createCompletionFixture();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.procedurePlan.create({
        data: {
          id: "m13-completion-open-procedure",
          labId: "lab-microglia",
          experimentId: EXPERIMENT_ID,
          assignmentId: ASSIGNMENT_ID,
          procedureCode: "animal-use",
          title: "Open procedure must block terminal experiment state",
          scheduledAt: new Date("2026-08-20T00:00:00.000Z"),
          status: "planned",
          sopId: "m13-completion-synthetic-sop",
          sopVersionId: "m13-completion-synthetic-sop-v1",
          sopVersionNumber: 1,
          sopContentHash: "a".repeat(64),
          sopAssignmentId: "m13-completion-synthetic-sop-assignment",
          assignmentContextSnapshot: {},
          experimentContextSnapshot: {},
          createdById: "user-admin",
          protocolAuthorizationId: DEMO_PROTOCOL_AUTHORIZATION_ID,
        },
      });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });

    const result = await executeTransitionExperimentCommand({
      actor,
      command: { experimentId: EXPERIMENT_ID, labId: "lab-microglia", status: "completed" },
      expectedVersion: 1,
      idempotencyKey: "m13-completion-open-procedure",
      requestId: "m13-completion-open-procedure-request",
    });
    expect(result).toMatchObject({ ok: false, code: "active_procedure_plans" });
    const [state, procedurePlan] = await Promise.all([
      completionState(),
      prisma.procedurePlan.findUniqueOrThrow({
        where: { id: "m13-completion-open-procedure" },
      }),
    ]);
    expect(state.experiment).toMatchObject({ status: "active", version: 1 });
    expect(state.assignment).toMatchObject({ status: "active", version: 1, endDate: null });
    expect(state.animal).toMatchObject({ status: "in_experiment", version: 1 });
    expect(state.projectAllocation.endedAt).toBeNull();
    expect(state.assignmentAudits).toHaveLength(0);
    expect(procedurePlan).toMatchObject({ status: "planned", version: 1 });
  });

  it("rejects a fully released allocation even though its remaining count is zero", async () => {
    await createCompletionFixture();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.protocolCountAllocation.update({
        where: { id: PROTOCOL_ALLOCATION_ID },
        data: { status: "released", consumedQuantity: 0, releasedQuantity: 1, version: 3 },
      });
      const allocation = await tx.protocolCountAllocation.findUniqueOrThrow({
        where: { id: PROTOCOL_ALLOCATION_ID },
        select: { ledgerId: true },
      });
      await tx.protocolCountLedger.update({
        where: { id: allocation.ledgerId },
        data: { consumedCount: { decrement: 1 }, version: { increment: 1 } },
      });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });

    const result = await executeTransitionExperimentCommand({
      actor,
      command: { experimentId: EXPERIMENT_ID, labId: "lab-microglia", status: "completed" },
      expectedVersion: 1,
      idempotencyKey: "m13-completion-released",
      requestId: "m13-completion-released-request",
    });
    expect(result).toMatchObject({ ok: false, code: "unsettled_reservations" });
    const state = await completionState();
    expect(state.experiment).toMatchObject({ status: "active", version: 1 });
    expect(state.assignment).toMatchObject({ status: "active", version: 1, endDate: null });
    expect(state.allocation).toMatchObject({
      status: "released",
      reservedQuantity: 1,
      consumedQuantity: 0,
      releasedQuantity: 1,
    });
    expect(state.projectAllocation.endedAt).toBeNull();
    expect(state.assignmentAudits).toHaveLength(0);
  });
});
