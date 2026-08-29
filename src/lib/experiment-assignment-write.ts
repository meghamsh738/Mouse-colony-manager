import { randomUUID } from "node:crypto";

import { Prisma, type ExperimentStatus } from "@prisma/client";

import {
  executeIdempotentCommand,
  staleConflict,
} from "@/lib/command-foundation";
import {
  releaseProtocolReservation,
  withComplianceWriteScope,
  withM13MutationSavepoint,
} from "@/lib/protocol-compliance";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";

type CommandIdentity = {
  idempotencyKey: string;
  requestId: string;
};

export type PlannedAnimalSnapshot = {
  animalId: string;
  treatmentGroup: string;
};

export type ExperimentAssignmentVersionSnapshot = {
  assignmentId: string;
  expectedVersion: number;
};

type AssignmentCommandResult = {
  experimentId: string;
  experimentVersion: number;
  assignmentIds: string[];
  message: string;
};

type ReservationCommandResult = {
  assignmentId: string;
  assignmentVersion: number;
  animalId: string;
  animalVersion: number;
  experimentId: string;
  experimentVersion: number;
  message: string;
};

const mutableExperimentStatuses: ExperimentStatus[] = ["planned", "active"];
const planningAnimalStatuses = [
  "colony_holding",
  "reserved",
  "experiment_completed",
] as const;

export function experimentPromotionAllocationMarker(assignmentId: string) {
  return `[mcm:auto:experiment-promotion:${assignmentId}]`;
}

export function experimentReservationAllocationMarker(assignmentId: string) {
  return `[mcm:auto:experiment-reservation:${assignmentId}]`;
}

function validationError(message: string) {
  return { ok: false as const, code: "validation_error", message };
}

function normalizeOptional(value?: string | null) {
  return value?.trim() || null;
}

function parseStrictDate(value: string) {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== normalized
    ? null
    : { date, serialized: normalized };
}

function isPositiveVersion(value: number) {
  return Number.isInteger(value) && value >= 1;
}

function hasValidIdentity(input: CommandIdentity) {
  return (
    input.idempotencyKey.trim().length > 0 && input.requestId.trim().length > 0
  );
}

function hasUniqueValues(values: string[]) {
  return new Set(values).size === values.length;
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dateFallsWithinExperiment(
  date: Date,
  experiment: { plannedStartAt: Date | null; plannedEndAt: Date | null },
) {
  const value = dateKey(date);
  return (
    (!experiment.plannedStartAt ||
      value >= dateKey(experiment.plannedStartAt)) &&
    (!experiment.plannedEndAt || value <= dateKey(experiment.plannedEndAt))
  );
}

function assignmentDatesAreValid(assignment: {
  startDate: Date;
  endDate: Date | null;
}) {
  return (
    !Number.isNaN(assignment.startDate.valueOf()) &&
    (!assignment.endDate ||
      (!Number.isNaN(assignment.endDate.valueOf()) &&
        assignment.endDate >= assignment.startDate))
  );
}

function assignmentStaleConflict(
  assignmentId: string,
  expectedVersion: number,
  currentVersion: number | null,
) {
  return {
    ok: false as const,
    code: "stale_conflict",
    message:
      "An experiment assignment changed after you opened it. Refresh and review the cohort before trying again.",
    result: {
      aggregateType: "experiment_assignment",
      aggregateId: assignmentId,
      expectedVersion,
      currentVersion,
    },
  };
}

function invalidSnapshot(message: string) {
  return { ok: false as const, code: "invalid_snapshot", message };
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    entityType: "experiment" | "experiment_assignment";
    entityId: string;
    action: string;
    previousValue?: Prisma.InputJsonValue | null;
    newValue?: Prisma.InputJsonValue | null;
  },
) {
  await tx.auditLog.create({
    data: {
      id: randomUUID(),
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      previousValue: input.previousValue ?? Prisma.JsonNull,
      newValue: input.newValue ?? Prisma.JsonNull,
      timestamp: new Date(),
    },
  });
}

async function bumpExperimentVersion(
  tx: Prisma.TransactionClient,
  experimentId: string,
  expectedVersion: number,
) {
  const updated = await tx.experiment.updateMany({
    where: {
      id: experimentId,
      version: expectedVersion,
      status: { in: mutableExperimentStatuses },
    },
    data: { version: { increment: 1 } },
  });
  return updated.count === 1;
}

async function commandLabId(actor: ResolvedActor, experimentId: string) {
  if (actor.canonicalRole === "lab_user") return actor.activeLabId;
  const experiment = await prisma.experiment.findUnique({
    where: { id: experimentId },
    select: { labId: true },
  });
  return experiment?.labId ?? null;
}

export async function executeReserveAnimalForExperimentCommand(
  input: {
    actor: ResolvedActor;
    command: {
      animalId: string;
      experimentId: string;
      startDate: string;
      treatmentGroup?: string | null;
      notes?: string | null;
    };
    expectedAnimalVersion: number;
    expectedExperimentVersion: number;
  } & CommandIdentity,
) {
  const parsedStartDate = parseStrictDate(input.command.startDate);
  const command = {
    animalId: input.command.animalId.trim(),
    experimentId: input.command.experimentId.trim(),
    treatmentGroup: normalizeOptional(input.command.treatmentGroup),
    notes: normalizeOptional(input.command.notes),
  };
  if (
    !hasValidIdentity(input) ||
    !command.animalId ||
    !command.experimentId ||
    !parsedStartDate ||
    !isPositiveVersion(input.expectedAnimalVersion) ||
    !isPositiveVersion(input.expectedExperimentVersion) ||
    (command.treatmentGroup?.length ?? 0) > 80 ||
    (command.notes?.length ?? 0) > 400
  ) {
    return validationError(
      "Submit the exact animal and experiment snapshot with valid versions and a calendar date.",
    );
  }
  const startDate = parsedStartDate;

  const request = {
    command: {
      animalId: command.animalId,
      experimentId: command.experimentId,
      startDate: startDate.serialized,
      treatmentGroup: command.treatmentGroup,
      notes: command.notes,
    },
    expectedAnimalVersion: input.expectedAnimalVersion,
    expectedExperimentVersion: input.expectedExperimentVersion,
  };

  return executeIdempotentCommand<ReservationCommandResult>({
    actor: input.actor,
    commandType: "experiment.assignment.reserve_direct",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request,
    requiredCapability: "experiments:manage",
    labId: await commandLabId(input.actor, command.experimentId),
    aggregateType: "animal",
    aggregateId: command.animalId,
    expectedVersion: input.expectedAnimalVersion,
    handler: async (tx, context) => {
      const experiment = await tx.experiment.findFirst({
        where: {
          id: command.experimentId,
          ...(input.actor.canonicalRole === "lab_user"
            ? { labId: input.actor.activeLabId ?? "__none__" }
            : {}),
        },
        select: {
          id: true,
          labId: true,
          experimentCode: true,
          projectId: true,
          status: true,
          version: true,
          protocolAuthorizationId: true,
          plannedStartAt: true,
          plannedEndAt: true,
          project: { select: { labId: true, projectCode: true } },
        },
      });
      if (
        !experiment ||
        !mutableExperimentStatuses.includes(experiment.status)
      ) {
        return {
          ok: false,
          code: "not_found",
          message:
            "The experiment was not found or no longer accepts reservations.",
        };
      }
      if (experiment.version !== input.expectedExperimentVersion) {
        return staleConflict(
          "experiment",
          experiment.id,
          input.expectedExperimentVersion,
          experiment.version,
        );
      }
      if (experiment.project.labId !== experiment.labId) {
        return invalidSnapshot(
          "The experiment project is no longer valid for the experiment lab.",
        );
      }
      if (!dateFallsWithinExperiment(startDate.date, experiment)) {
        return invalidSnapshot(
          "The reservation date is outside the experiment's current planned date range.",
        );
      }

      const animal = await tx.animal.findUnique({
        where: { id: command.animalId },
        select: {
          id: true,
          animalId: true,
          owningLabId: true,
          outcomeStatus: true,
          status: true,
          version: true,
          strainId: true,
          alleles: { select: { callStatus: true } },
          experimentAssignments: {
            where: {
              OR: [
                { experimentId: experiment.id },
                { status: { in: ["reserved", "active"] } },
              ],
            },
            select: { id: true, experimentId: true, status: true },
          },
          projectAllocations: {
            where: { projectId: experiment.projectId, endedAt: null },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (!animal) {
        return {
          ok: false,
          code: "not_found",
          message: "The animal was not found.",
        };
      }
      if (animal.version !== input.expectedAnimalVersion) {
        return staleConflict(
          "animal",
          animal.id,
          input.expectedAnimalVersion,
          animal.version,
        );
      }
      if (animal.owningLabId !== experiment.labId) {
        return invalidSnapshot(
          "The animal and experiment must belong to the same lab.",
        );
      }
      if (
        animal.outcomeStatus !== "alive" ||
        animal.status !== "colony_holding"
      ) {
        return invalidSnapshot(
          `${animal.animalId} is no longer live and available in colony holding.`,
        );
      }
      if (
        !animal.alleles.length ||
        animal.alleles.some((allele) => allele.callStatus !== "confirmed")
      ) {
        return invalidSnapshot(
          `${animal.animalId} requires confirmed genotype calls before reservation.`,
        );
      }
      if (
        animal.experimentAssignments.some(
          (assignment) => assignment.experimentId === experiment.id,
        )
      ) {
        return {
          ok: false,
          code: "duplicate_assignment",
          message: `${animal.animalId} is already linked to this experiment.`,
        };
      }
      if (
        animal.experimentAssignments.some(
          (assignment) =>
            assignment.status === "reserved" || assignment.status === "active",
        )
      ) {
        return {
          ok: false,
          code: "reservation_conflict",
          message: `${animal.animalId} already has an active or reserved experiment assignment.`,
        };
      }

      const assignmentId = randomUUID();
      return withComplianceWriteScope(
        tx,
        {
          actor: input.actor,
          receiptId: context.receiptId,
          commandType: "experiment.assignment.reserve_direct",
          labId: experiment.labId,
          aggregateType: "experiment_assignment",
          aggregateId: assignmentId,
          commandAggregateType: "animal",
          commandAggregateId: command.animalId,
          protocolAuthorizationId: experiment.protocolAuthorizationId,
          projectId: experiment.projectId,
          experimentId: experiment.id,
          requiredPersonnelRoles: [
            "principal_investigator",
            "named_researcher",
          ],
          strainIds: [animal.strainId],
          countOperation: "reserve",
          quantity: 1,
          allocationKey: `assignment:${assignmentId}:reservation`,
        },
        async (compliance) => {
          const timestamp = new Date();
          const mutation = await tx.$queryRaw<
            Array<{
              assignmentId: string;
              assignmentVersion: number;
              animalVersion: number;
              experimentVersion: number;
            }>
          >(Prisma.sql`
        WITH eligible_experiment AS MATERIALIZED (
          SELECT id
          FROM "Experiment"
          WHERE id = ${experiment.id}
            AND "labId" = ${experiment.labId}
            AND version = ${input.expectedExperimentVersion}
            AND status IN ('planned'::"ExperimentStatus", 'active'::"ExperimentStatus")
          FOR UPDATE
        ), updated_animal AS (
          UPDATE "Animal" AS animal
          SET status = 'reserved'::"AnimalStatus",
              "experimentalStatus" = ${`Reserved for ${experiment.experimentCode}`},
              "projectSummary" = ${experiment.project.projectCode},
              version = animal.version + 1
          FROM eligible_experiment
          WHERE animal.id = ${animal.id}
            AND animal."owningLabId" = ${experiment.labId}
            AND animal.version = ${input.expectedAnimalVersion}
            AND animal.status = 'colony_holding'::"AnimalStatus"
            AND animal."outcomeStatus" = 'alive'::"OutcomeStatus"
          RETURNING animal.version AS "animalVersion"
        ), updated_experiment AS (
          UPDATE "Experiment" AS target
          SET version = target.version + 1
          FROM eligible_experiment
          WHERE target.id = eligible_experiment.id
            AND target.version = ${input.expectedExperimentVersion}
            AND EXISTS (SELECT 1 FROM updated_animal)
          RETURNING target.version AS "experimentVersion"
        ), inserted_assignment AS (
          INSERT INTO "ExperimentAssignment" (
            id, "animalId", "experimentId", status, "startDate", "treatmentGroup", notes, "isPrimary", version,
            "complianceEvidenceSnapshotId", "protocolCountAllocationId"
          )
          SELECT
            ${assignmentId}, ${animal.id}, ${experiment.id}, 'reserved'::"AssignmentStatus", ${startDate.date},
            ${command.treatmentGroup}, ${command.notes}, TRUE, 1, ${compliance.evidenceSnapshotId}, ${compliance.allocationId}
          FROM updated_animal, updated_experiment
          RETURNING id AS "assignmentId", version AS "assignmentVersion"
        )
        SELECT
          inserted_assignment."assignmentId",
          inserted_assignment."assignmentVersion",
          updated_animal."animalVersion",
          updated_experiment."experimentVersion"
        FROM inserted_assignment, updated_animal, updated_experiment
      `);
          const committed = mutation[0];
          if (!committed) {
            const [currentAnimal, currentExperiment] = await Promise.all([
              tx.animal.findUnique({
                where: { id: animal.id },
                select: { version: true },
              }),
              tx.experiment.findUnique({
                where: { id: experiment.id },
                select: { version: true },
              }),
            ]);
            if (currentAnimal?.version !== input.expectedAnimalVersion) {
              return staleConflict(
                "animal",
                animal.id,
                input.expectedAnimalVersion,
                currentAnimal?.version ?? null,
              );
            }
            if (
              currentExperiment?.version !== input.expectedExperimentVersion
            ) {
              return staleConflict(
                "experiment",
                experiment.id,
                input.expectedExperimentVersion,
                currentExperiment?.version ?? null,
              );
            }
            return {
              ok: false,
              code: "reservation_conflict",
              message:
                "The animal or experiment changed while the reservation was being committed. Refresh before trying again.",
            };
          }

          let createdAllocationId: string | null = null;
          if (!animal.projectAllocations.length) {
            createdAllocationId = randomUUID();
            await tx.animalProjectAllocation.create({
              data: {
                id: createdAllocationId,
                animalId: animal.id,
                projectId: experiment.projectId,
                startedAt: timestamp,
                chargeable: true,
                notes: `${experimentReservationAllocationMarker(assignmentId)} Added automatically during reservation for ${experiment.experimentCode}.`,
              },
            });
          }
          await tx.animalStatusEvent.create({
            data: {
              id: randomUUID(),
              animalId: animal.id,
              fromStatus: "colony_holding",
              toStatus: "reserved",
              happenedAt: timestamp,
              actorId: input.actor.id,
              reason: `Reserved for ${experiment.experimentCode}.`,
            },
          });
          await writeAudit(tx, {
            actorId: input.actor.id,
            entityType: "experiment_assignment",
            entityId: assignmentId,
            action: "reserve",
            previousValue: {
              animalStatus: "colony_holding",
              animalVersion: input.expectedAnimalVersion,
              experimentVersion: input.expectedExperimentVersion,
            },
            newValue: {
              receiptId: context.receiptId,
              assignmentVersion: committed.assignmentVersion,
              animalVersion: committed.animalVersion,
              experimentVersion: committed.experimentVersion,
              snapshot: request,
              autoAllocationId: createdAllocationId,
              autoAllocationMarker: createdAllocationId
                ? experimentReservationAllocationMarker(assignmentId)
                : null,
            },
          });
          await writeAudit(tx, {
            actorId: input.actor.id,
            entityType: "experiment",
            entityId: experiment.id,
            action: "assignment_reserve",
            previousValue: { version: input.expectedExperimentVersion },
            newValue: {
              receiptId: context.receiptId,
              version: committed.experimentVersion,
              assignmentId,
              animalId: animal.id,
            },
          });

          const message = `${animal.animalId} reserved for ${experiment.experimentCode}.`;
          return {
            ok: true,
            result: {
              assignmentId,
              assignmentVersion: committed.assignmentVersion,
              animalId: animal.id,
              animalVersion: committed.animalVersion,
              experimentId: experiment.id,
              experimentVersion: committed.experimentVersion,
              message,
            },
            resultingVersion: committed.animalVersion,
          };
        },
      );
    },
  });
}

export async function executePlanExperimentAssignmentsCommand(
  input: {
    actor: ResolvedActor;
    command: {
      experimentId: string;
      startDate: string;
      notes?: string | null;
      assignments: PlannedAnimalSnapshot[];
    };
    expectedExperimentVersion: number;
  } & CommandIdentity,
) {
  const experimentId = input.command.experimentId.trim();
  const startDate = parseStrictDate(input.command.startDate);
  const notes = normalizeOptional(input.command.notes);
  const assignments = input.command.assignments.map((assignment) => ({
    animalId: assignment.animalId.trim(),
    treatmentGroup: assignment.treatmentGroup.trim(),
  }));
  if (
    !hasValidIdentity(input) ||
    !experimentId ||
    !startDate ||
    !isPositiveVersion(input.expectedExperimentVersion) ||
    assignments.length < 1 ||
    assignments.length > 100 ||
    assignments.some(
      (assignment) =>
        !assignment.animalId ||
        !assignment.treatmentGroup ||
        assignment.treatmentGroup.length > 80,
    ) ||
    !hasUniqueValues(assignments.map((assignment) => assignment.animalId)) ||
    (notes?.length ?? 0) > 400
  ) {
    return validationError(
      "Submit a valid, duplicate-free rendered cohort snapshot and refresh the experiment version.",
    );
  }

  const request = {
    experimentId,
    startDate: startDate.serialized,
    notes,
    assignments,
  };
  return executeIdempotentCommand<AssignmentCommandResult>({
    actor: input.actor,
    commandType: "experiment.assignments.plan",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request,
    requiredCapability: "experiments:manage",
    labId: await commandLabId(input.actor, experimentId),
    aggregateType: "experiment",
    aggregateId: experimentId,
    expectedVersion: input.expectedExperimentVersion,
    handler: async (tx, context) => {
      const experiment = await tx.experiment.findUnique({
        where: { id: experimentId },
        select: {
          id: true,
          labId: true,
          experimentCode: true,
          status: true,
          version: true,
          plannedStartAt: true,
          plannedEndAt: true,
          protocolAuthorizationId: true,
        },
      });
      if (
        !experiment ||
        !mutableExperimentStatuses.includes(experiment.status)
      ) {
        return {
          ok: false,
          code: "not_found",
          message:
            "The experiment was not found or no longer accepts cohort planning.",
        };
      }
      if (
        input.actor.canonicalRole === "lab_user" &&
        experiment.labId !== input.actor.activeLabId
      ) {
        return {
          ok: false,
          code: "forbidden",
          message: "The experiment is outside your active lab.",
        };
      }
      if (experiment.version !== input.expectedExperimentVersion) {
        return staleConflict(
          "experiment",
          experiment.id,
          input.expectedExperimentVersion,
          experiment.version,
        );
      }
      if (!dateFallsWithinExperiment(startDate.date, experiment)) {
        return invalidSnapshot(
          "The planned assignment date is outside the experiment's current planned date range.",
        );
      }

      const animals = await tx.animal.findMany({
        where: {
          animalId: {
            in: assignments.map((assignment) => assignment.animalId),
          },
        },
        select: {
          id: true,
          animalId: true,
          owningLabId: true,
          outcomeStatus: true,
          status: true,
          experimentAssignments: {
            where: { experimentId },
            select: { id: true },
          },
        },
      });
      if (animals.length !== assignments.length) {
        return invalidSnapshot(
          "One or more animals in the rendered cohort no longer exist.",
        );
      }
      const animalsByCode = new Map(
        animals.map((animal) => [animal.animalId, animal]),
      );
      for (const snapshot of assignments) {
        const animal = animalsByCode.get(snapshot.animalId);
        if (!animal || animal.owningLabId !== experiment.labId) {
          return invalidSnapshot(
            "Every cohort animal must still belong to the experiment lab.",
          );
        }
        if (
          animal.outcomeStatus !== "alive" ||
          !planningAnimalStatuses.includes(
            animal.status as (typeof planningAnimalStatuses)[number],
          )
        ) {
          return invalidSnapshot(
            `${animal.animalId} is no longer live and eligible for experiment planning.`,
          );
        }
        if (animal.experimentAssignments.length > 0) {
          return invalidSnapshot(
            `${animal.animalId} is already linked to this experiment.`,
          );
        }
      }

      const assignmentRows = assignments.map((snapshot) => ({
        id: randomUUID(),
        animalId: animalsByCode.get(snapshot.animalId)!.id,
        experimentId,
        status: "planned" as const,
        startDate: startDate.date,
        treatmentGroup: snapshot.treatmentGroup,
        notes,
        isPrimary: false,
        version: 1,
      }));
      const created = await tx.experimentAssignment.createMany({
        data: assignmentRows,
        skipDuplicates: true,
      });
      if (created.count !== assignmentRows.length) {
        await tx.experimentAssignment.deleteMany({
          where: { id: { in: assignmentRows.map((row) => row.id) } },
        });
        return {
          ok: false,
          code: "duplicate_assignment",
          message:
            "At least one animal is already linked to this experiment. Refresh the assignment worksheet.",
        };
      }
      if (
        !(await bumpExperimentVersion(
          tx,
          experiment.id,
          input.expectedExperimentVersion,
        ))
      ) {
        await tx.experimentAssignment.deleteMany({
          where: { id: { in: assignmentRows.map((row) => row.id) } },
        });
        const current = await tx.experiment.findUnique({
          where: { id: experiment.id },
          select: { version: true },
        });
        return staleConflict(
          "experiment",
          experiment.id,
          input.expectedExperimentVersion,
          current?.version ?? null,
        );
      }

      const timestamp = new Date();
      for (const row of assignmentRows) {
        const snapshot = assignments.find(
          (assignment) =>
            animalsByCode.get(assignment.animalId)?.id === row.animalId,
        )!;
        await writeAudit(tx, {
          actorId: input.actor.id,
          entityType: "experiment_assignment",
          entityId: row.id,
          action: "plan",
          newValue: {
            receiptId: context.receiptId,
            experimentId,
            animalId: row.animalId,
            animalCode: snapshot.animalId,
            startDate: startDate.serialized,
            treatmentGroup: row.treatmentGroup,
            notes,
            status: "planned",
            version: 1,
            timestamp: timestamp.toISOString(),
          },
        });
      }
      const experimentVersion = input.expectedExperimentVersion + 1;
      await writeAudit(tx, {
        actorId: input.actor.id,
        entityType: "experiment",
        entityId: experiment.id,
        action: "assignment_plan",
        previousValue: { version: input.expectedExperimentVersion },
        newValue: {
          receiptId: context.receiptId,
          version: experimentVersion,
          assignmentIds: assignmentRows.map((row) => row.id),
          snapshot: request,
        },
      });
      const message = `Planned ${assignmentRows.length} cohort assignment${assignmentRows.length === 1 ? "" : "s"} for ${experiment.experimentCode}.`;
      return {
        ok: true,
        result: {
          experimentId,
          experimentVersion,
          assignmentIds: assignmentRows.map((row) => row.id),
          message,
        },
        resultingVersion: experimentVersion,
      };
    },
  });
}

function normalizeAssignmentSnapshot(
  assignments: ExperimentAssignmentVersionSnapshot[],
) {
  return assignments.map((assignment) => ({
    assignmentId: assignment.assignmentId.trim(),
    expectedVersion: assignment.expectedVersion,
  }));
}

function validateAssignmentSnapshot(
  assignments: ExperimentAssignmentVersionSnapshot[],
) {
  return (
    assignments.length >= 1 &&
    assignments.length <= 100 &&
    assignments.every(
      (assignment) =>
        assignment.assignmentId &&
        isPositiveVersion(assignment.expectedVersion),
    ) &&
    hasUniqueValues(assignments.map((assignment) => assignment.assignmentId))
  );
}

export async function executePromoteExperimentAssignmentsCommand(
  input: {
    actor: ResolvedActor;
    command: {
      experimentId: string;
      assignments: ExperimentAssignmentVersionSnapshot[];
    };
    expectedExperimentVersion: number;
  } & CommandIdentity,
) {
  const experimentId = input.command.experimentId.trim();
  const assignments = normalizeAssignmentSnapshot(input.command.assignments);
  if (
    !hasValidIdentity(input) ||
    !experimentId ||
    !isPositiveVersion(input.expectedExperimentVersion) ||
    !validateAssignmentSnapshot(assignments)
  ) {
    return validationError(
      "Submit the exact planned assignment snapshot and refresh all versions before promotion.",
    );
  }
  const request = { experimentId, assignments };
  return executeIdempotentCommand<AssignmentCommandResult>({
    actor: input.actor,
    commandType: "experiment.assignments.promote",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request,
    requiredCapability: "experiments:manage",
    labId: await commandLabId(input.actor, experimentId),
    aggregateType: "experiment",
    aggregateId: experimentId,
    expectedVersion: input.expectedExperimentVersion,
    handler: async (tx, context) => {
      const experiment = await tx.experiment.findUnique({
        where: { id: experimentId },
        select: {
          id: true,
          labId: true,
          experimentCode: true,
          projectId: true,
          status: true,
          version: true,
          protocolAuthorizationId: true,
          plannedStartAt: true,
          plannedEndAt: true,
          project: { select: { projectCode: true } },
        },
      });
      if (
        !experiment ||
        !mutableExperimentStatuses.includes(experiment.status)
      ) {
        return {
          ok: false,
          code: "not_found",
          message:
            "The experiment was not found or no longer accepts cohort promotion.",
        };
      }
      if (
        input.actor.canonicalRole === "lab_user" &&
        experiment.labId !== input.actor.activeLabId
      ) {
        return {
          ok: false,
          code: "forbidden",
          message: "The experiment is outside your active lab.",
        };
      }
      if (experiment.version !== input.expectedExperimentVersion) {
        return staleConflict(
          "experiment",
          experiment.id,
          input.expectedExperimentVersion,
          experiment.version,
        );
      }

      const records = await tx.experimentAssignment.findMany({
        where: {
          id: { in: assignments.map((assignment) => assignment.assignmentId) },
        },
        select: {
          id: true,
          experimentId: true,
          status: true,
          version: true,
          startDate: true,
          endDate: true,
          treatmentGroup: true,
          animal: {
            select: {
              id: true,
              animalId: true,
              owningLabId: true,
              outcomeStatus: true,
              status: true,
              strainId: true,
              alleles: { select: { callStatus: true } },
              experimentAssignments: {
                where: { status: { in: ["reserved", "active"] } },
                select: { id: true },
              },
            },
          },
        },
      });
      if (records.length !== assignments.length) {
        return invalidSnapshot(
          "One or more planned assignments no longer exist.",
        );
      }
      const expectedById = new Map(
        assignments.map((assignment) => [
          assignment.assignmentId,
          assignment.expectedVersion,
        ]),
      );
      for (const assignment of records) {
        const expectedVersion = expectedById.get(assignment.id)!;
        if (assignment.version !== expectedVersion)
          return assignmentStaleConflict(
            assignment.id,
            expectedVersion,
            assignment.version,
          );
        if (
          assignment.experimentId !== experiment.id ||
          assignment.status !== "planned"
        ) {
          return invalidSnapshot(
            "Every submitted assignment must still be planned for the selected experiment.",
          );
        }
        if (
          !assignmentDatesAreValid(assignment) ||
          !dateFallsWithinExperiment(assignment.startDate, experiment)
        ) {
          return invalidSnapshot(
            "An assignment date is invalid or outside the experiment's current planned range.",
          );
        }
        if (
          assignment.animal.owningLabId !== experiment.labId ||
          assignment.animal.outcomeStatus !== "alive" ||
          assignment.animal.status !== "colony_holding" ||
          assignment.animal.experimentAssignments.length > 0
        ) {
          return invalidSnapshot(
            `${assignment.animal.animalId} is no longer available for reservation.`,
          );
        }
        if (
          !assignment.animal.alleles.length ||
          assignment.animal.alleles.some(
            (allele) => allele.callStatus !== "confirmed",
          )
        ) {
          return invalidSnapshot(
            `${assignment.animal.animalId} requires confirmed genotype calls before promotion.`,
          );
        }
      }

      return withComplianceWriteScope(
        tx,
        {
          actor: input.actor,
          receiptId: context.receiptId,
          commandType: "experiment.assignments.promote",
          labId: experiment.labId,
          aggregateType: "experiment",
          aggregateId: experiment.id,
          protocolAuthorizationId: experiment.protocolAuthorizationId,
          projectId: experiment.projectId,
          experimentId: experiment.id,
          requiredPersonnelRoles: [
            "principal_investigator",
            "named_researcher",
          ],
          strainIds: records.map((assignment) => assignment.animal.strainId),
          countOperation: "reserve",
          quantity: records.length,
          allocationKey: `experiment:${experiment.id}:cohort-promotion`,
          allocationUnits: records.map((assignment) => ({
            allocationKey: `assignment:${assignment.id}:reservation`,
            aggregateType: "experiment_assignment",
            aggregateId: assignment.id,
            quantity: 1,
          })),
        },
        async (compliance) => {
          if (
            !(await bumpExperimentVersion(
              tx,
              experiment.id,
              input.expectedExperimentVersion,
            ))
          ) {
            const current = await tx.experiment.findUnique({
              where: { id: experiment.id },
              select: { version: true },
            });
            return staleConflict(
              "experiment",
              experiment.id,
              input.expectedExperimentVersion,
              current?.version ?? null,
            );
          }
          const timestamp = new Date();
          for (const assignment of records) {
            const allocation = compliance.allocations.find(
              (item) =>
                item.allocationKey ===
                `assignment:${assignment.id}:reservation`,
            );
            if (!allocation)
              return invalidSnapshot(
                "The assignment protocol allocation could not be frozen.",
              );
            const previousAnimalStatus = assignment.animal.status;
            await tx.experimentAssignment.update({
              where: { id: assignment.id },
              data: {
                status: "reserved",
                complianceEvidenceSnapshotId: allocation.evidenceSnapshotId,
                protocolCountAllocationId: allocation.id,
                version: { increment: 1 },
              },
            });
            await tx.animal.update({
              where: { id: assignment.animal.id },
              data: {
                status: "reserved",
                experimentalStatus: `Reserved for ${experiment.experimentCode}`,
                projectSummary: experiment.project.projectCode,
                version: { increment: 1 },
              },
            });

            const openAllocation = await tx.animalProjectAllocation.findFirst({
              where: {
                animalId: assignment.animal.id,
                projectId: experiment.projectId,
                endedAt: null,
              },
              select: { id: true },
            });
            let createdAllocationId: string | null = null;
            if (!openAllocation) {
              createdAllocationId = randomUUID();
              await tx.animalProjectAllocation.create({
                data: {
                  id: createdAllocationId,
                  animalId: assignment.animal.id,
                  projectId: experiment.projectId,
                  startedAt: timestamp,
                  chargeable: true,
                  notes: `${experimentPromotionAllocationMarker(assignment.id)} Added automatically during cohort promotion for ${experiment.experimentCode}.`,
                },
              });
            }
            await tx.animalStatusEvent.create({
              data: {
                id: randomUUID(),
                animalId: assignment.animal.id,
                fromStatus: previousAnimalStatus,
                toStatus: "reserved",
                happenedAt: timestamp,
                actorId: input.actor.id,
                reason: `Promoted planned cohort assignment for ${experiment.experimentCode}.`,
              },
            });
            await writeAudit(tx, {
              actorId: input.actor.id,
              entityType: "experiment_assignment",
              entityId: assignment.id,
              action: "promote_plan",
              previousValue: {
                status: "planned",
                version: assignment.version,
                animalStatus: previousAnimalStatus,
              },
              newValue: {
                receiptId: context.receiptId,
                status: "reserved",
                version: assignment.version + 1,
                animalStatus: "reserved",
                startDate: dateKey(assignment.startDate),
                treatmentGroup: assignment.treatmentGroup,
                autoAllocationId: createdAllocationId,
                autoAllocationMarker: createdAllocationId
                  ? experimentPromotionAllocationMarker(assignment.id)
                  : null,
              },
            });
          }
          const experimentVersion = input.expectedExperimentVersion + 1;
          await writeAudit(tx, {
            actorId: input.actor.id,
            entityType: "experiment",
            entityId: experiment.id,
            action: "assignment_promote",
            previousValue: { version: input.expectedExperimentVersion },
            newValue: {
              receiptId: context.receiptId,
              version: experimentVersion,
              assignments,
            },
          });
          const message = `Promoted ${records.length} planned assignment${records.length === 1 ? "" : "s"} for ${experiment.experimentCode}.`;
          return {
            ok: true,
            result: {
              experimentId,
              experimentVersion,
              assignmentIds: assignments.map(
                (assignment) => assignment.assignmentId,
              ),
              message,
            },
            resultingVersion: experimentVersion,
          };
        },
      );
    },
  });
}

export async function executeDemoteExperimentAssignmentsCommand(
  input: {
    actor: ResolvedActor;
    command: {
      experimentId: string;
      assignments: ExperimentAssignmentVersionSnapshot[];
    };
    expectedExperimentVersion: number;
  } & CommandIdentity,
) {
  const experimentId = input.command.experimentId.trim();
  const assignments = normalizeAssignmentSnapshot(input.command.assignments);
  if (
    !hasValidIdentity(input) ||
    !experimentId ||
    !isPositiveVersion(input.expectedExperimentVersion) ||
    !validateAssignmentSnapshot(assignments)
  ) {
    return validationError(
      "Submit the exact reserved assignment snapshot and refresh all versions before rollback.",
    );
  }
  const request = { experimentId, assignments };
  return executeIdempotentCommand<AssignmentCommandResult>({
    actor: input.actor,
    commandType: "experiment.assignments.demote",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request,
    requiredCapability: "experiments:manage",
    labId: await commandLabId(input.actor, experimentId),
    aggregateType: "experiment",
    aggregateId: experimentId,
    expectedVersion: input.expectedExperimentVersion,
    handler: async (tx, context) => {
      const experiment = await tx.experiment.findUnique({
        where: { id: experimentId },
        select: {
          id: true,
          labId: true,
          experimentCode: true,
          projectId: true,
          status: true,
          version: true,
          protocolAuthorizationId: true,
        },
      });
      if (
        !experiment ||
        !mutableExperimentStatuses.includes(experiment.status)
      ) {
        return {
          ok: false,
          code: "not_found",
          message:
            "The experiment was not found or no longer accepts cohort rollback.",
        };
      }
      if (
        input.actor.canonicalRole === "lab_user" &&
        experiment.labId !== input.actor.activeLabId
      ) {
        return {
          ok: false,
          code: "forbidden",
          message: "The experiment is outside your active lab.",
        };
      }
      if (experiment.version !== input.expectedExperimentVersion) {
        return staleConflict(
          "experiment",
          experiment.id,
          input.expectedExperimentVersion,
          experiment.version,
        );
      }

      const assignmentIds = assignments.map(
        (assignment) => assignment.assignmentId,
      );
      const [records, promotionAudits] = await Promise.all([
        tx.experimentAssignment.findMany({
          where: { id: { in: assignmentIds } },
          select: {
            id: true,
            experimentId: true,
            status: true,
            version: true,
            startDate: true,
            endDate: true,
            treatmentGroup: true,
            protocolCountAllocationId: true,
            animal: {
              select: {
                id: true,
                animalId: true,
                owningLabId: true,
                outcomeStatus: true,
                status: true,
                experimentAssignments: {
                  where: { status: { in: ["reserved", "active"] } },
                  select: {
                    id: true,
                    experiment: {
                      select: {
                        experimentCode: true,
                        projectId: true,
                        project: { select: { projectCode: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        tx.auditLog.findMany({
          where: {
            entityType: "experiment_assignment",
            entityId: { in: assignmentIds },
            action: "promote_plan",
          },
          select: { entityId: true },
        }),
      ]);
      if (records.length !== assignments.length)
        return invalidSnapshot(
          "One or more reserved assignments no longer exist.",
        );
      const promotedIds = new Set(
        promotionAudits.map((audit) => audit.entityId),
      );
      const expectedById = new Map(
        assignments.map((assignment) => [
          assignment.assignmentId,
          assignment.expectedVersion,
        ]),
      );
      for (const assignment of records) {
        const expectedVersion = expectedById.get(assignment.id)!;
        if (assignment.version !== expectedVersion)
          return assignmentStaleConflict(
            assignment.id,
            expectedVersion,
            assignment.version,
          );
        if (
          assignment.experimentId !== experiment.id ||
          assignment.status !== "reserved" ||
          !promotedIds.has(assignment.id)
        ) {
          return invalidSnapshot(
            "Every submitted assignment must still be a reservation created by cohort promotion.",
          );
        }
        if (!assignmentDatesAreValid(assignment))
          return invalidSnapshot(
            "An assignment contains an invalid date range.",
          );
        if (
          assignment.animal.owningLabId !== experiment.labId ||
          assignment.animal.outcomeStatus !== "alive" ||
          assignment.animal.status !== "reserved"
        ) {
          return invalidSnapshot(
            `${assignment.animal.animalId} no longer has rollback-compatible reservation state.`,
          );
        }
      }

      const allocationIds = records.map(
        (record) => record.protocolCountAllocationId,
      );
      if (
        allocationIds.some((value) => !value) ||
        new Set(allocationIds).size !== records.length
      ) {
        return invalidSnapshot(
          "Each reservation must retain its own exact protocol count allocation.",
        );
      }
      return withM13MutationSavepoint(tx, async () => {
        for (const assignment of records) {
          const released = await releaseProtocolReservation(tx, {
            actor: input.actor,
            receiptId: context.receiptId,
            protocolAuthorizationId: experiment.protocolAuthorizationId,
            allocationId: assignment.protocolCountAllocationId!,
            quantity: 1,
            allocationKey: `assignment:${assignment.id}:demotion`,
            aggregateType: "experiment",
            aggregateId: experiment.id,
          });
          if (!released.ok) return released;
        }

        if (
          !(await bumpExperimentVersion(
            tx,
            experiment.id,
            input.expectedExperimentVersion,
          ))
        ) {
          const current = await tx.experiment.findUnique({
            where: { id: experiment.id },
            select: { version: true },
          });
          return staleConflict(
            "experiment",
            experiment.id,
            input.expectedExperimentVersion,
            current?.version ?? null,
          );
        }
        const snapshotIdSet = new Set(assignmentIds);
        const timestamp = new Date();
        for (const assignment of records) {
          const remainingReservations =
            assignment.animal.experimentAssignments.filter(
              (linked) => !snapshotIdSet.has(linked.id),
            );
          const targetAnimalStatus = remainingReservations.length
            ? ("reserved" as const)
            : ("colony_holding" as const);
          await tx.experimentAssignment.update({
            where: { id: assignment.id },
            data: { status: "planned", version: { increment: 1 } },
          });
          await tx.animal.update({
            where: { id: assignment.animal.id },
            data: {
              status: targetAnimalStatus,
              experimentalStatus: remainingReservations.length
                ? `Reserved for ${remainingReservations.map((linked) => linked.experiment.experimentCode).join(", ")}`
                : "Available for experiment planning",
              projectSummary:
                remainingReservations[0]?.experiment.project.projectCode ??
                null,
              version: { increment: 1 },
            },
          });

          const hasOtherOpenProjectNeed = remainingReservations.some(
            (linked) => linked.experiment.projectId === experiment.projectId,
          );
          let endedAllocationCount = 0;
          if (!hasOtherOpenProjectNeed) {
            const ended = await tx.animalProjectAllocation.updateMany({
              where: {
                animalId: assignment.animal.id,
                projectId: experiment.projectId,
                endedAt: null,
                notes: {
                  contains: experimentPromotionAllocationMarker(assignment.id),
                },
              },
              data: { endedAt: timestamp },
            });
            endedAllocationCount = ended.count;
          }
          if (targetAnimalStatus !== assignment.animal.status) {
            await tx.animalStatusEvent.create({
              data: {
                id: randomUUID(),
                animalId: assignment.animal.id,
                fromStatus: assignment.animal.status,
                toStatus: targetAnimalStatus,
                happenedAt: timestamp,
                actorId: input.actor.id,
                reason: `Rolled back cohort reservation for ${experiment.experimentCode}.`,
              },
            });
          }
          await writeAudit(tx, {
            actorId: input.actor.id,
            entityType: "experiment_assignment",
            entityId: assignment.id,
            action: "demote_reservation",
            previousValue: {
              status: "reserved",
              version: assignment.version,
              animalStatus: assignment.animal.status,
              startDate: dateKey(assignment.startDate),
              treatmentGroup: assignment.treatmentGroup,
            },
            newValue: {
              receiptId: context.receiptId,
              status: "planned",
              version: assignment.version + 1,
              animalStatus: targetAnimalStatus,
              endedPromotionAllocationCount: endedAllocationCount,
              preservedForOtherOpenNeed: hasOtherOpenProjectNeed,
            },
          });
        }
        const experimentVersion = input.expectedExperimentVersion + 1;
        await writeAudit(tx, {
          actorId: input.actor.id,
          entityType: "experiment",
          entityId: experiment.id,
          action: "assignment_demote",
          previousValue: { version: input.expectedExperimentVersion },
          newValue: {
            receiptId: context.receiptId,
            version: experimentVersion,
            assignments,
          },
        });
        const message = `Rolled back ${records.length} reserved assignment${records.length === 1 ? "" : "s"} for ${experiment.experimentCode}.`;
        return {
          ok: true,
          result: { experimentId, experimentVersion, assignmentIds, message },
          resultingVersion: experimentVersion,
        };
      });
    },
  });
}

export async function executeUpdatePlannedExperimentAssignmentCommand(
  input: {
    actor: ResolvedActor;
    command: {
      experimentId: string;
      assignmentId: string;
      startDate: string;
      treatmentGroup?: string | null;
      notes?: string | null;
    };
    expectedExperimentVersion: number;
    expectedAssignmentVersion: number;
  } & CommandIdentity,
) {
  const experimentId = input.command.experimentId.trim();
  const assignmentId = input.command.assignmentId.trim();
  const startDate = parseStrictDate(input.command.startDate);
  const treatmentGroup = normalizeOptional(input.command.treatmentGroup);
  const notes = normalizeOptional(input.command.notes);
  if (
    !hasValidIdentity(input) ||
    !experimentId ||
    !assignmentId ||
    !startDate ||
    !isPositiveVersion(input.expectedExperimentVersion) ||
    !isPositiveVersion(input.expectedAssignmentVersion) ||
    (treatmentGroup?.length ?? 0) > 80 ||
    (notes?.length ?? 0) > 400
  ) {
    return validationError(
      "Submit valid planned-assignment values and refresh both record versions.",
    );
  }
  const request = {
    experimentId,
    assignmentId,
    startDate: startDate.serialized,
    treatmentGroup,
    notes,
    expectedAssignmentVersion: input.expectedAssignmentVersion,
  };
  return executeIdempotentCommand<AssignmentCommandResult>({
    actor: input.actor,
    commandType: "experiment.assignment.update_planned",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request,
    requiredCapability: "experiments:manage",
    labId: await commandLabId(input.actor, experimentId),
    aggregateType: "experiment",
    aggregateId: experimentId,
    expectedVersion: input.expectedExperimentVersion,
    handler: async (tx, context) => {
      const assignment = await tx.experimentAssignment.findUnique({
        where: { id: assignmentId },
        select: {
          id: true,
          experimentId: true,
          status: true,
          version: true,
          startDate: true,
          treatmentGroup: true,
          notes: true,
          animal: { select: { animalId: true, owningLabId: true } },
          experiment: {
            select: {
              id: true,
              labId: true,
              experimentCode: true,
              status: true,
              version: true,
              plannedStartAt: true,
              plannedEndAt: true,
            },
          },
        },
      });
      if (
        !assignment ||
        assignment.experimentId !== experimentId ||
        assignment.status !== "planned"
      ) {
        return {
          ok: false,
          code: "not_found",
          message: "The planned assignment was not found.",
        };
      }
      if (
        input.actor.canonicalRole === "lab_user" &&
        assignment.experiment.labId !== input.actor.activeLabId
      ) {
        return {
          ok: false,
          code: "forbidden",
          message: "The assignment is outside your active lab.",
        };
      }
      if (
        assignment.animal.owningLabId !== assignment.experiment.labId ||
        !mutableExperimentStatuses.includes(assignment.experiment.status)
      ) {
        return invalidSnapshot(
          "The assignment is no longer editable in its experiment lab.",
        );
      }
      if (assignment.experiment.version !== input.expectedExperimentVersion) {
        return staleConflict(
          "experiment",
          experimentId,
          input.expectedExperimentVersion,
          assignment.experiment.version,
        );
      }
      if (assignment.version !== input.expectedAssignmentVersion) {
        return assignmentStaleConflict(
          assignment.id,
          input.expectedAssignmentVersion,
          assignment.version,
        );
      }
      if (!dateFallsWithinExperiment(startDate.date, assignment.experiment)) {
        return invalidSnapshot(
          "The assignment date is outside the experiment's current planned range.",
        );
      }
      if (
        !(await bumpExperimentVersion(
          tx,
          experimentId,
          input.expectedExperimentVersion,
        ))
      ) {
        const current = await tx.experiment.findUnique({
          where: { id: experimentId },
          select: { version: true },
        });
        return staleConflict(
          "experiment",
          experimentId,
          input.expectedExperimentVersion,
          current?.version ?? null,
        );
      }
      await tx.experimentAssignment.update({
        where: { id: assignment.id },
        data: {
          startDate: startDate.date,
          treatmentGroup,
          notes,
          version: { increment: 1 },
        },
      });
      await writeAudit(tx, {
        actorId: input.actor.id,
        entityType: "experiment_assignment",
        entityId: assignment.id,
        action: "update_plan",
        previousValue: {
          startDate: dateKey(assignment.startDate),
          treatmentGroup: assignment.treatmentGroup,
          notes: assignment.notes,
          version: assignment.version,
        },
        newValue: {
          receiptId: context.receiptId,
          startDate: startDate.serialized,
          treatmentGroup,
          notes,
          version: assignment.version + 1,
        },
      });
      const experimentVersion = input.expectedExperimentVersion + 1;
      await writeAudit(tx, {
        actorId: input.actor.id,
        entityType: "experiment",
        entityId: experimentId,
        action: "assignment_update",
        previousValue: { version: input.expectedExperimentVersion },
        newValue: {
          receiptId: context.receiptId,
          version: experimentVersion,
          assignmentId,
          assignmentVersion: assignment.version + 1,
        },
      });
      const message = `Updated planned assignment for ${assignment.animal.animalId} in ${assignment.experiment.experimentCode}.`;
      return {
        ok: true,
        result: {
          experimentId,
          experimentVersion,
          assignmentIds: [assignmentId],
          message,
        },
        resultingVersion: experimentVersion,
      };
    },
  });
}

export async function executeDeletePlannedExperimentAssignmentCommand(
  input: {
    actor: ResolvedActor;
    command: { experimentId: string; assignmentId: string };
    expectedExperimentVersion: number;
    expectedAssignmentVersion: number;
  } & CommandIdentity,
) {
  const experimentId = input.command.experimentId.trim();
  const assignmentId = input.command.assignmentId.trim();
  if (
    !hasValidIdentity(input) ||
    !experimentId ||
    !assignmentId ||
    !isPositiveVersion(input.expectedExperimentVersion) ||
    !isPositiveVersion(input.expectedAssignmentVersion)
  ) {
    return validationError(
      "Refresh both record versions before removing this planned assignment.",
    );
  }
  const request = {
    experimentId,
    assignmentId,
    expectedAssignmentVersion: input.expectedAssignmentVersion,
  };
  return executeIdempotentCommand<AssignmentCommandResult>({
    actor: input.actor,
    commandType: "experiment.assignment.delete_planned",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request,
    requiredCapability: "experiments:manage",
    labId: await commandLabId(input.actor, experimentId),
    aggregateType: "experiment",
    aggregateId: experimentId,
    expectedVersion: input.expectedExperimentVersion,
    handler: async (tx, context) => {
      const assignment = await tx.experimentAssignment.findUnique({
        where: { id: assignmentId },
        select: {
          id: true,
          experimentId: true,
          status: true,
          version: true,
          startDate: true,
          treatmentGroup: true,
          notes: true,
          animal: { select: { animalId: true, owningLabId: true } },
          experiment: {
            select: {
              id: true,
              labId: true,
              experimentCode: true,
              status: true,
              version: true,
            },
          },
        },
      });
      if (
        !assignment ||
        assignment.experimentId !== experimentId ||
        assignment.status !== "planned"
      ) {
        return {
          ok: false,
          code: "not_found",
          message: "The planned assignment was not found.",
        };
      }
      if (
        input.actor.canonicalRole === "lab_user" &&
        assignment.experiment.labId !== input.actor.activeLabId
      ) {
        return {
          ok: false,
          code: "forbidden",
          message: "The assignment is outside your active lab.",
        };
      }
      if (
        assignment.animal.owningLabId !== assignment.experiment.labId ||
        !mutableExperimentStatuses.includes(assignment.experiment.status)
      ) {
        return invalidSnapshot(
          "The assignment is no longer removable in its experiment lab.",
        );
      }
      if (assignment.experiment.version !== input.expectedExperimentVersion) {
        return staleConflict(
          "experiment",
          experimentId,
          input.expectedExperimentVersion,
          assignment.experiment.version,
        );
      }
      if (assignment.version !== input.expectedAssignmentVersion) {
        return assignmentStaleConflict(
          assignment.id,
          input.expectedAssignmentVersion,
          assignment.version,
        );
      }
      if (
        !(await bumpExperimentVersion(
          tx,
          experimentId,
          input.expectedExperimentVersion,
        ))
      ) {
        const current = await tx.experiment.findUnique({
          where: { id: experimentId },
          select: { version: true },
        });
        return staleConflict(
          "experiment",
          experimentId,
          input.expectedExperimentVersion,
          current?.version ?? null,
        );
      }
      await tx.experimentAssignment.delete({ where: { id: assignment.id } });
      await writeAudit(tx, {
        actorId: input.actor.id,
        entityType: "experiment_assignment",
        entityId: assignment.id,
        action: "delete_plan",
        previousValue: {
          experimentId,
          animalId: assignment.animal.animalId,
          startDate: dateKey(assignment.startDate),
          treatmentGroup: assignment.treatmentGroup,
          notes: assignment.notes,
          version: assignment.version,
        },
        newValue: { receiptId: context.receiptId, deleted: true },
      });
      const experimentVersion = input.expectedExperimentVersion + 1;
      await writeAudit(tx, {
        actorId: input.actor.id,
        entityType: "experiment",
        entityId: experimentId,
        action: "assignment_delete",
        previousValue: { version: input.expectedExperimentVersion },
        newValue: {
          receiptId: context.receiptId,
          version: experimentVersion,
          assignmentId,
          deletedAssignmentVersion: assignment.version,
        },
      });
      const message = `Removed planned assignment for ${assignment.animal.animalId} from ${assignment.experiment.experimentCode}.`;
      return {
        ok: true,
        result: {
          experimentId,
          experimentVersion,
          assignmentIds: [assignmentId],
          message,
        },
        resultingVersion: experimentVersion,
      };
    },
  });
}
