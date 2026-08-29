import { randomUUID } from "node:crypto";

import { Prisma, type ProcedureOccurrenceStatus } from "@prisma/client";

import {
  canonicalJsonHash,
  executeIdempotentCommand,
} from "@/lib/command-foundation";
import { canManageLab, getActorLabAccess } from "@/lib/lab-access";
import { withComplianceWriteScope } from "@/lib/protocol-compliance";
import type { ResolvedActor } from "@/lib/session";

type CommandIdentity = {
  idempotencyKey: string;
  requestId: string;
};

function normalizeOptional(value?: string | null) {
  return value?.trim() || null;
}

function parseDateTime(value: string) {
  const normalized = value.trim();
  const date = new Date(normalized);
  return !normalized || Number.isNaN(date.valueOf()) ? null : date;
}

function validationError(message: string) {
  return { ok: false as const, code: "validation_error", message };
}

async function readProcedureContexts(
  tx: Prisma.TransactionClient,
  assignmentId: string,
  experimentId: string,
) {
  const [contexts] = await tx.$queryRaw<
    Array<{
      assignmentContext: Prisma.JsonValue | null;
      experimentContext: Prisma.JsonValue | null;
    }>
  >(Prisma.sql`
    SELECT
      "procedure_assignment_context"(${assignmentId}) AS "assignmentContext",
      "procedure_experiment_context"(${experimentId}) AS "experimentContext"
  `);
  if (!contexts?.assignmentContext || !contexts.experimentContext) return null;
  return contexts as {
    assignmentContext: Prisma.InputJsonValue;
    experimentContext: Prisma.InputJsonValue;
  };
}

async function bindProcedureCommandContext(
  tx: Prisma.TransactionClient,
  input: { receiptId: string; actorId: string; commandType: string },
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT
      set_config('mcm.procedure_receipt_id', ${input.receiptId}, true),
      set_config('mcm.procedure_actor_id', ${input.actorId}, true),
      set_config('mcm.procedure_command_type', ${input.commandType}, true)
  `);
}

async function writeProcedureAudit(
  tx: Prisma.TransactionClient,
  input: {
    actorId: string;
    entityType:
      | "procedure_plan"
      | "procedure_occurrence"
      | "experiment"
      | "experiment_assignment";
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

export type CreateProcedurePlanCommand = {
  planId: string;
  labId: string;
  assignmentId: string;
  sopAssignmentId: string;
  procedureCode: string;
  title: string;
  scheduledAt: string;
};

export async function executeCreateProcedurePlanCommand(
  input: {
    actor: ResolvedActor;
    command: CreateProcedurePlanCommand;
    expectedAssignmentVersion: number;
    expectedExperimentVersion: number;
  } & CommandIdentity,
) {
  const scheduledAt = parseDateTime(input.command.scheduledAt);
  const command = {
    planId: input.command.planId.trim(),
    labId: input.command.labId.trim(),
    assignmentId: input.command.assignmentId.trim(),
    sopAssignmentId: input.command.sopAssignmentId.trim(),
    procedureCode: input.command.procedureCode.trim(),
    title: input.command.title.trim(),
    scheduledAt: scheduledAt?.toISOString() ?? "",
  };
  if (
    !command.planId ||
    !command.labId ||
    !command.assignmentId ||
    !command.sopAssignmentId ||
    !scheduledAt ||
    command.procedureCode.length < 2 ||
    command.procedureCode.length > 80 ||
    command.title.length < 2 ||
    command.title.length > 160 ||
    !Number.isInteger(input.expectedAssignmentVersion) ||
    input.expectedAssignmentVersion < 1 ||
    !Number.isInteger(input.expectedExperimentVersion) ||
    input.expectedExperimentVersion < 1
  ) {
    return validationError(
      "Choose an assignment, exact assigned SOP, schedule, procedure code, and title.",
    );
  }
  if (scheduledAt.getTime() <= Date.now()) {
    return validationError("Choose a future procedure schedule.");
  }

  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "procedure.plan.create",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: {
      command,
      expectedAssignmentVersion: input.expectedAssignmentVersion,
      expectedExperimentVersion: input.expectedExperimentVersion,
    },
    requiredCapability: "procedures:plan",
    labId: command.labId,
    aggregateType: "procedure_plan",
    aggregateId: command.planId,
    handler: async (tx, context) => {
      const [assignment, sopAssignment, access] = await Promise.all([
        tx.experimentAssignment.findUnique({
          where: { id: command.assignmentId },
          select: {
            id: true,
            version: true,
            status: true,
            experimentId: true,
            animalId: true,
            protocolCountAllocationId: true,
            startDate: true,
            animal: {
              select: {
                owningLabId: true,
                outcomeStatus: true,
                strainId: true,
              },
            },
            experiment: {
              select: {
                id: true,
                labId: true,
                version: true,
                status: true,
                plannedStartAt: true,
                plannedEndAt: true,
                experimentCode: true,
                projectId: true,
                protocolAuthorizationId: true,
              },
            },
          },
        }),
        tx.sopAssignment.findUnique({
          where: { id: command.sopAssignmentId },
          select: {
            id: true,
            labId: true,
            sopId: true,
            sopVersionId: true,
            revokedAt: true,
            assignedAt: true,
            sop: {
              select: {
                active: true,
                currentVersionId: true,
                scope: true,
                labId: true,
              },
            },
            sopVersion: {
              select: {
                versionNumber: true,
                contentHash: true,
                createdAt: true,
                approval: { select: { decision: true, decidedAt: true } },
              },
            },
          },
        }),
        getActorLabAccess(input.actor, tx),
      ]);
      if (
        !assignment ||
        assignment.experiment.labId !== command.labId ||
        !canManageLab(access, command.labId)
      ) {
        return {
          ok: false as const,
          code: "not_found",
          message: "Experiment assignment not found.",
        };
      }
      if (
        assignment.version !== input.expectedAssignmentVersion ||
        assignment.experiment.version !== input.expectedExperimentVersion
      ) {
        return {
          ok: false as const,
          code: "stale_conflict",
          message:
            "The assignment or experiment changed. Refresh before planning the procedure.",
        };
      }
      if (
        !["reserved", "active"].includes(assignment.status) ||
        !["planned", "active"].includes(assignment.experiment.status) ||
        assignment.animal.owningLabId !== command.labId ||
        assignment.animal.outcomeStatus !== "alive"
      ) {
        return validationError(
          "The selected live assignment no longer accepts procedure planning.",
        );
      }
      if (
        scheduledAt < assignment.startDate ||
        (assignment.experiment.plannedStartAt &&
          scheduledAt < assignment.experiment.plannedStartAt) ||
        (assignment.experiment.plannedEndAt &&
          scheduledAt > assignment.experiment.plannedEndAt)
      ) {
        return validationError(
          "The procedure schedule must fall within the assignment and experiment dates.",
        );
      }
      if (
        !sopAssignment ||
        sopAssignment.labId !== command.labId ||
        sopAssignment.revokedAt ||
        !sopAssignment.sop.active ||
        sopAssignment.sop.currentVersionId !== sopAssignment.sopVersionId ||
        (sopAssignment.sop.scope === "lab" &&
          sopAssignment.sop.labId !== command.labId) ||
        sopAssignment.sopVersion.approval?.decision !== "approved"
      ) {
        return {
          ok: false as const,
          code: "invalid_snapshot",
          message: "Choose a current approved SOP assigned to this lab.",
        };
      }
      if (
        scheduledAt < sopAssignment.assignedAt ||
        scheduledAt < sopAssignment.sopVersion.createdAt ||
        !sopAssignment.sopVersion.approval?.decidedAt ||
        scheduledAt < sopAssignment.sopVersion.approval.decidedAt
      ) {
        return {
          ok: false as const,
          code: "invalid_snapshot",
          message:
            "The procedure cannot be scheduled before the SOP was created, approved, and assigned.",
        };
      }

      const contexts = await readProcedureContexts(
        tx,
        assignment.id,
        assignment.experiment.id,
      );
      if (!contexts) {
        return {
          ok: false as const,
          code: "invalid_snapshot",
          message:
            "The procedure assignment context could not be frozen for review.",
        };
      }

      return withComplianceWriteScope(
        tx,
        {
          actor: input.actor,
          receiptId: context.receiptId,
          commandType: "procedure.plan.create",
          labId: command.labId,
          aggregateType: "procedure_plan",
          aggregateId: command.planId,
          protocolAuthorizationId:
            assignment.experiment.protocolAuthorizationId,
          projectId: assignment.experiment.projectId,
          experimentId: assignment.experiment.id,
          strainIds: [assignment.animal.strainId],
          procedureCode: command.procedureCode,
          requiredPersonnelRoles: ["procedure_operator"],
          countOperation: "none",
        },
        async (compliance) => {
          await bindProcedureCommandContext(tx, {
            receiptId: context.receiptId,
            actorId: input.actor.id,
            commandType: "procedure.plan.create",
          });
          const assignmentUpdate = await tx.experimentAssignment.updateMany({
            where: {
              id: assignment.id,
              version: input.expectedAssignmentVersion,
              status: assignment.status,
            },
            data: { version: { increment: 1 } },
          });
          const experimentUpdate = await tx.experiment.updateMany({
            where: {
              id: assignment.experiment.id,
              version: input.expectedExperimentVersion,
              status: assignment.experiment.status,
            },
            data: { version: { increment: 1 } },
          });
          if (assignmentUpdate.count !== 1 || experimentUpdate.count !== 1) {
            return {
              ok: false as const,
              code: "stale_conflict",
              message:
                "The assignment or experiment changed while the plan was being saved.",
            };
          }
          const plan = await tx.procedurePlan.create({
            data: {
              id: command.planId,
              labId: command.labId,
              experimentId: assignment.experiment.id,
              assignmentId: assignment.id,
              procedureCode: command.procedureCode,
              title: command.title,
              scheduledAt,
              sopId: sopAssignment.sopId,
              sopVersionId: sopAssignment.sopVersionId,
              sopVersionNumber: sopAssignment.sopVersion.versionNumber,
              sopContentHash: sopAssignment.sopVersion.contentHash,
              sopAssignmentId: sopAssignment.id,
              assignmentContextSnapshot: contexts.assignmentContext,
              experimentContextSnapshot: contexts.experimentContext,
              createdById: input.actor.id,
              protocolAuthorizationId: compliance.protocolAuthorizationId,
              complianceEvidenceSnapshotId: compliance.evidenceSnapshotId,
            },
          });
          await Promise.all([
            writeProcedureAudit(tx, {
              actorId: input.actor.id,
              entityType: "procedure_plan",
              entityId: plan.id,
              action: "create",
              newValue: {
                receiptId: context.receiptId,
                labId: plan.labId,
                experimentId: plan.experimentId,
                assignmentId: plan.assignmentId,
                procedureCode: plan.procedureCode,
                title: plan.title,
                scheduledAt: plan.scheduledAt.toISOString(),
                sopId: plan.sopId,
                sopVersionId: plan.sopVersionId,
                sopVersionNumber: plan.sopVersionNumber,
                sopContentHash: plan.sopContentHash,
                sopAssignmentId: plan.sopAssignmentId,
                assignmentContextSnapshot: plan.assignmentContextSnapshot,
                experimentContextSnapshot: plan.experimentContextSnapshot,
                version: plan.version,
              },
            }),
            writeProcedureAudit(tx, {
              actorId: input.actor.id,
              entityType: "experiment_assignment",
              entityId: assignment.id,
              action: "procedure_plan_added",
              previousValue: { version: assignment.version },
              newValue: {
                version: assignment.version + 1,
                procedurePlanId: plan.id,
              },
            }),
            writeProcedureAudit(tx, {
              actorId: input.actor.id,
              entityType: "experiment",
              entityId: assignment.experiment.id,
              action: "procedure_plan_added",
              previousValue: { version: assignment.experiment.version },
              newValue: {
                version: assignment.experiment.version + 1,
                procedurePlanId: plan.id,
              },
            }),
          ]);
          return {
            ok: true as const,
            result: {
              planId: plan.id,
              planVersion: plan.version,
              assignmentVersion: assignment.version + 1,
              experimentVersion: assignment.experiment.version + 1,
              message: `${plan.procedureCode} scheduled for ${assignment.experiment.experimentCode}.`,
            },
            aggregateType: "procedure_plan",
            aggregateId: plan.id,
            resultingVersion: plan.version,
          };
        },
      );
    },
  });
}

export async function executeCancelProcedurePlanCommand(
  input: {
    actor: ResolvedActor;
    command: { planId: string; labId: string; reason: string };
    expectedVersion: number;
  } & CommandIdentity,
) {
  const command = {
    planId: input.command.planId.trim(),
    labId: input.command.labId.trim(),
    reason: input.command.reason.trim(),
  };
  if (
    !command.planId ||
    !command.labId ||
    command.reason.length < 3 ||
    command.reason.length > 400
  ) {
    return validationError("Enter a clear cancellation reason.");
  }
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "procedure.plan.cancel",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { command, expectedVersion: input.expectedVersion },
    requiredCapability: "procedures:plan",
    labId: command.labId,
    aggregateType: "procedure_plan",
    aggregateId: command.planId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      const plan = await tx.procedurePlan.findFirst({
        where: { id: command.planId, labId: command.labId },
        include: {
          assignment: { select: { id: true, version: true } },
          experiment: { select: { id: true, version: true } },
        },
      });
      if (
        !plan ||
        !canManageLab(await getActorLabAccess(input.actor, tx), plan.labId)
      ) {
        return {
          ok: false as const,
          code: "not_found",
          message: "Procedure plan not found.",
        };
      }
      if (plan.status !== "planned")
        return validationError("Only a planned procedure can be cancelled.");
      await bindProcedureCommandContext(tx, {
        receiptId: context.receiptId,
        actorId: input.actor.id,
        commandType: "procedure.plan.cancel",
      });
      const updated = await tx.procedurePlan.update({
        where: { id: plan.id },
        data: { status: "cancelled", version: { increment: 1 } },
      });
      await Promise.all([
        tx.experimentAssignment.update({
          where: { id: plan.assignment.id },
          data: { version: { increment: 1 } },
        }),
        tx.experiment.update({
          where: { id: plan.experiment.id },
          data: { version: { increment: 1 } },
        }),
        writeProcedureAudit(tx, {
          actorId: input.actor.id,
          entityType: "procedure_plan",
          entityId: plan.id,
          action: "cancel",
          previousValue: { status: plan.status, version: plan.version },
          newValue: {
            status: updated.status,
            version: updated.version,
            reason: command.reason,
            receiptId: context.receiptId,
          },
        }),
      ]);
      return {
        ok: true as const,
        result: {
          planId: plan.id,
          planVersion: updated.version,
          message: `${plan.procedureCode} cancelled.`,
        },
        aggregateType: "procedure_plan",
        aggregateId: plan.id,
        resultingVersion: updated.version,
      };
    },
  });
}

export type RecordProcedureOccurrenceCommand = {
  planId: string;
  labId: string;
  occurrenceKey: string;
  occurredAt: string;
  status: ProcedureOccurrenceStatus;
  outcomeNote?: string | null;
};

export async function executeRecordProcedureOccurrenceCommand(
  input: {
    actor: ResolvedActor;
    command: RecordProcedureOccurrenceCommand;
    expectedVersion: number;
  } & CommandIdentity,
) {
  const occurredAt = parseDateTime(input.command.occurredAt);
  const command = {
    planId: input.command.planId.trim(),
    labId: input.command.labId.trim(),
    occurrenceKey: input.command.occurrenceKey.trim(),
    occurredAt: occurredAt?.toISOString() ?? "",
    status: input.command.status,
    outcomeNote: normalizeOptional(input.command.outcomeNote),
  };
  if (
    !command.planId ||
    !command.labId ||
    !command.occurrenceKey ||
    command.occurrenceKey.length > 120 ||
    !occurredAt ||
    (command.status !== "completed" &&
      (command.outcomeNote?.length ?? 0) < 3) ||
    (command.outcomeNote?.length ?? 0) > 500
  ) {
    return validationError(
      "Choose a valid occurrence time and describe any aborted or unperformed procedure.",
    );
  }
  if (occurredAt.getTime() > Date.now() + 5 * 60_000) {
    return validationError(
      "Procedure occurrence time cannot be in the future.",
    );
  }

  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "procedure.occurrence.record",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: { command, expectedVersion: input.expectedVersion },
    requiredCapability: "procedures:execute",
    labId: command.labId,
    aggregateType: "procedure_plan",
    aggregateId: command.planId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      const plan = await tx.procedurePlan.findFirst({
        where: { id: command.planId, labId: command.labId },
        include: {
          experiment: {
            select: {
              id: true,
              experimentCode: true,
              projectId: true,
              version: true,
              status: true,
            },
          },
          assignment: {
            select: {
              id: true,
              version: true,
              animalId: true,
              status: true,
              protocolCountAllocationId: true,
              protocolCountAllocation: {
                select: {
                  reservedQuantity: true,
                  consumedQuantity: true,
                  releasedQuantity: true,
                },
              },
              startDate: true,
              animal: {
                select: {
                  facilityAnimalId: true,
                  owningLabId: true,
                  outcomeStatus: true,
                  strainId: true,
                  currentCage: {
                    select: {
                      barcode: true,
                      cageNumber: true,
                      room: { select: { roomNumber: true } },
                      rack: { select: { rackNumber: true } },
                    },
                  },
                },
              },
            },
          },
          sop: { select: { active: true, currentVersionId: true } },
          sopVersion: {
            select: {
              versionNumber: true,
              contentHash: true,
              createdAt: true,
              approval: { select: { decision: true, decidedAt: true } },
            },
          },
        },
      });
      if (!plan)
        return {
          ok: false as const,
          code: "not_found",
          message: "Procedure plan not found.",
        };
      if (
        plan.status !== "planned" ||
        !["planned", "active"].includes(plan.experiment.status) ||
        !["planned", "reserved", "active"].includes(plan.assignment.status) ||
        plan.assignment.animal.owningLabId !== plan.labId ||
        plan.assignment.animal.outcomeStatus !== "alive"
      ) {
        return validationError(
          "The planned procedure is no longer executable for this animal assignment.",
        );
      }
      if (
        !plan.sop.active ||
        plan.sop.currentVersionId !== plan.sopVersionId ||
        plan.sopVersion.approval?.decision !== "approved" ||
        plan.sopVersion.versionNumber !== plan.sopVersionNumber ||
        plan.sopVersion.contentHash !== plan.sopContentHash
      ) {
        return {
          ok: false as const,
          code: "invalid_snapshot",
          message:
            "The exact planned SOP is no longer current and approved for execution.",
        };
      }
      const activeSopAssignment = await tx.sopAssignment.findFirst({
        where: {
          id: plan.sopAssignmentId,
          labId: plan.labId,
          sopId: plan.sopId,
          sopVersionId: plan.sopVersionId,
          revokedAt: null,
        },
        select: { id: true, assignedAt: true },
      });
      if (!activeSopAssignment) {
        return {
          ok: false as const,
          code: "invalid_snapshot",
          message: "The planned SOP is no longer assigned to this lab.",
        };
      }
      if (
        occurredAt < plan.createdAt ||
        occurredAt < plan.assignment.startDate ||
        occurredAt < activeSopAssignment.assignedAt ||
        occurredAt < plan.sopVersion.createdAt ||
        !plan.sopVersion.approval?.decidedAt ||
        occurredAt < plan.sopVersion.approval.decidedAt
      ) {
        return validationError(
          "The occurrence cannot predate its plan, assignment, or exact SOP approval and assignment.",
        );
      }
      const currentContexts = await readProcedureContexts(
        tx,
        plan.assignmentId,
        plan.experimentId,
      );
      if (
        !currentContexts ||
        canonicalJsonHash(currentContexts.assignmentContext) !==
          canonicalJsonHash(plan.assignmentContextSnapshot) ||
        canonicalJsonHash(currentContexts.experimentContext) !==
          canonicalJsonHash(plan.experimentContextSnapshot)
      ) {
        return {
          ok: false as const,
          code: "invalid_snapshot",
          message:
            "The assignment or operational experiment context changed after planning. Cancel and create a reviewed plan.",
        };
      }

      const allocationRemaining = plan.assignment.protocolCountAllocation
        ? plan.assignment.protocolCountAllocation.reservedQuantity -
          plan.assignment.protocolCountAllocation.consumedQuantity -
          plan.assignment.protocolCountAllocation.releasedQuantity
        : 0;
      const usesAnimal =
        command.status === "completed" || command.status === "aborted";
      const settlesReservation = usesAnimal && allocationRemaining > 0;
      if (usesAnimal && !plan.assignment.protocolCountAllocationId) {
        return {
          ok: false as const,
          code: "compliance_count_conflict",
          message:
            "The assignment has no exact protocol reservation to consume.",
        };
      }
      const occurrenceId = randomUUID();
      return withComplianceWriteScope(
        tx,
        {
          actor: input.actor,
          receiptId: context.receiptId,
          commandType: "procedure.occurrence.record",
          labId: plan.labId,
          aggregateType: "procedure_occurrence",
          aggregateId: occurrenceId,
          commandAggregateType: "procedure_plan",
          commandAggregateId: plan.id,
          protocolAuthorizationId: plan.protocolAuthorizationId,
          projectId: plan.experiment.projectId,
          experimentId: plan.experiment.id,
          strainIds: [plan.assignment.animal.strainId],
          procedureCode: plan.procedureCode,
          requiredPersonnelRoles: ["procedure_operator"],
          countOperation: settlesReservation ? "consume" : "none",
          quantity: settlesReservation ? 1 : 0,
          sourceAllocationId: settlesReservation
            ? plan.assignment.protocolCountAllocationId
            : null,
          allocationKey: settlesReservation
            ? `procedure:${occurrenceId}:consume`
            : undefined,
        },
        async (compliance) => {
          await bindProcedureCommandContext(tx, {
            receiptId: context.receiptId,
            actorId: input.actor.id,
            commandType: "procedure.occurrence.record",
          });
          const cage = plan.assignment.animal.currentCage;
          const occurrence = await tx.procedureOccurrence.create({
            data: {
              id: occurrenceId,
              planId: plan.id,
              occurrenceKey: command.occurrenceKey,
              labId: plan.labId,
              experimentId: plan.experimentId,
              assignmentId: plan.assignmentId,
              animalId: plan.assignment.animalId,
              experimentCodeSnapshot: plan.experiment.experimentCode,
              animalFacilityIdSnapshot: plan.assignment.animal.facilityAnimalId,
              cageBarcodeSnapshot: cage?.barcode ?? null,
              roomNumberSnapshot: cage?.room.roomNumber ?? null,
              rackNumberSnapshot: cage?.rack.rackNumber ?? null,
              cageNumberSnapshot: cage?.cageNumber ?? null,
              procedureCode: plan.procedureCode,
              title: plan.title,
              plannedAt: plan.scheduledAt,
              occurredAt,
              status: command.status,
              outcomeNote: command.outcomeNote,
              planVersion: plan.version,
              sopId: plan.sopId,
              sopVersionId: plan.sopVersionId,
              sopVersionNumber: plan.sopVersionNumber,
              sopContentHash: plan.sopContentHash,
              sopAssignmentId: plan.sopAssignmentId,
              assignmentContextSnapshot:
                plan.assignmentContextSnapshot as Prisma.InputJsonValue,
              experimentContextSnapshot:
                plan.experimentContextSnapshot as Prisma.InputJsonValue,
              executedById: input.actor.id,
              protocolAuthorizationId: compliance.protocolAuthorizationId,
              complianceEvidenceSnapshotId: compliance.evidenceSnapshotId,
              protocolCountAllocationId: settlesReservation
                ? compliance.allocationId
                : null,
            },
          });
          const updatedPlan = await tx.procedurePlan.update({
            where: { id: plan.id },
            data: { status: "completed", version: { increment: 1 } },
          });
          await Promise.all([
            tx.experimentAssignment.update({
              where: { id: plan.assignment.id },
              data: { version: { increment: 1 } },
            }),
            tx.experiment.update({
              where: { id: plan.experiment.id },
              data: { version: { increment: 1 } },
            }),
            writeProcedureAudit(tx, {
              actorId: input.actor.id,
              entityType: "procedure_occurrence",
              entityId: occurrence.id,
              action: "record",
              newValue: {
                receiptId: context.receiptId,
                planId: plan.id,
                labId: plan.labId,
                experimentId: plan.experimentId,
                assignmentId: plan.assignmentId,
                animalId: plan.assignment.animalId,
                occurredAt: occurrence.occurredAt.toISOString(),
                status: occurrence.status,
                outcomeNote: occurrence.outcomeNote,
                sopId: occurrence.sopId,
                sopVersionId: occurrence.sopVersionId,
                sopVersionNumber: occurrence.sopVersionNumber,
                sopContentHash: occurrence.sopContentHash,
                sopAssignmentId: occurrence.sopAssignmentId,
                assignmentContextSnapshot: occurrence.assignmentContextSnapshot,
                experimentContextSnapshot: occurrence.experimentContextSnapshot,
              },
            }),
            writeProcedureAudit(tx, {
              actorId: input.actor.id,
              entityType: "procedure_plan",
              entityId: plan.id,
              action: "complete",
              previousValue: { status: plan.status, version: plan.version },
              newValue: {
                status: updatedPlan.status,
                version: updatedPlan.version,
                occurrenceId: occurrence.id,
              },
            }),
          ]);
          return {
            ok: true as const,
            result: {
              planId: plan.id,
              planVersion: updatedPlan.version,
              occurrenceId: occurrence.id,
              message: `${plan.procedureCode} outcome recorded for ${plan.assignment.animal.facilityAnimalId}.`,
            },
            aggregateType: "procedure_plan",
            aggregateId: plan.id,
            resultingVersion: updatedPlan.version,
          };
        },
      );
    },
  });
}
