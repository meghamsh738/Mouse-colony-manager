import { randomUUID } from "node:crypto";

import { Prisma, type ExperimentStatus } from "@prisma/client";

import { normalizeUserRole } from "@/lib/capabilities";
import { executeIdempotentCommand, staleConflict } from "@/lib/command-foundation";
import { prisma } from "@/lib/prisma";
import {
  releaseProtocolReservation,
  withComplianceWriteScope,
  withM13MutationSavepoint,
} from "@/lib/protocol-compliance";
import type { ResolvedActor } from "@/lib/session";

type CommandIdentity = {
  idempotencyKey: string;
  requestId: string;
};

export type ExperimentDetailsInput = {
  labId?: string | null;
  projectId: string;
  protocolAuthorizationId?: string | null;
  experimentCode: string;
  title: string;
  plannedStartAt?: string | null;
  plannedEndAt?: string | null;
  operationalContact?: string | null;
  procedureSummary?: string | null;
  treatmentSummary?: string | null;
  welfareRisks?: string | null;
  scheduleNotes?: string | null;
  operationalNotes?: string | null;
  notes?: string | null;
  resultSummary?: string | null;
};

type NormalizedExperimentDetails = Omit<ExperimentDetailsInput, "labId"> & {
  labId: string;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  operationalContact: string | null;
  procedureSummary: string | null;
  treatmentSummary: string | null;
  welfareRisks: string | null;
  scheduleNotes: string | null;
  operationalNotes: string | null;
  notes: string | null;
  resultSummary: string | null;
};

const lifecycleTransitions: Record<ExperimentStatus, readonly ExperimentStatus[]> = {
  planned: ["active", "cancelled"],
  active: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionExperimentStatus(from: ExperimentStatus, to: ExperimentStatus) {
  return lifecycleTransitions[from].includes(to);
}

function normalizeOptional(value?: string | null) {
  return value?.trim() || null;
}

function parseOptionalDate(value?: string | null) {
  const normalized = normalizeOptional(value);
  if (!normalized) return { ok: true as const, value: null, serialized: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return { ok: false as const };
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized) {
    return { ok: false as const };
  }
  return { ok: true as const, value: parsed, serialized: normalized };
}

function resolveCommandLab(actor: ResolvedActor, requestedLabId?: string | null) {
  const requested = normalizeOptional(requestedLabId);
  if (actor.canonicalRole === "facility_admin") return requested;
  if (actor.canonicalRole !== "lab_user" || !actor.activeLabId) return null;
  if (requested && requested !== actor.activeLabId) return null;
  return actor.activeLabId;
}

function normalizeDetails(actor: ResolvedActor, input: ExperimentDetailsInput) {
  const labId = resolveCommandLab(actor, input.labId);
  const plannedStartAt = parseOptionalDate(input.plannedStartAt);
  const plannedEndAt = parseOptionalDate(input.plannedEndAt);
  const command: NormalizedExperimentDetails | null = labId && plannedStartAt.ok && plannedEndAt.ok
    ? {
        labId,
        projectId: input.projectId.trim(),
        protocolAuthorizationId: normalizeOptional(input.protocolAuthorizationId),
        experimentCode: input.experimentCode.trim().toUpperCase(),
        title: input.title.trim(),
        plannedStartAt: plannedStartAt.serialized,
        plannedEndAt: plannedEndAt.serialized,
        operationalContact: normalizeOptional(input.operationalContact),
        procedureSummary: normalizeOptional(input.procedureSummary),
        treatmentSummary: normalizeOptional(input.treatmentSummary),
        welfareRisks: normalizeOptional(input.welfareRisks),
        scheduleNotes: normalizeOptional(input.scheduleNotes),
        operationalNotes: normalizeOptional(input.operationalNotes),
        notes: normalizeOptional(input.notes),
        resultSummary: normalizeOptional(input.resultSummary),
      }
    : null;

  const valid = command
    && /^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(command.experimentCode)
    && command.projectId.length > 0
    && command.title.length >= 3
    && command.title.length <= 160
    && (!command.operationalContact || command.operationalContact.length <= 160)
    && (!command.procedureSummary || command.procedureSummary.length <= 2_000)
    && (!command.treatmentSummary || command.treatmentSummary.length <= 2_000)
    && (!command.welfareRisks || command.welfareRisks.length <= 2_000)
    && (!command.scheduleNotes || command.scheduleNotes.length <= 2_000)
    && (!command.operationalNotes || command.operationalNotes.length <= 2_000)
    && (!command.notes || command.notes.length <= 4_000)
    && (!command.resultSummary || command.resultSummary.length <= 4_000)
    && (!plannedEndAt.ok || !plannedEndAt.value || (plannedStartAt.ok && Boolean(plannedStartAt.value)))
    && (!plannedStartAt.ok || !plannedEndAt.ok || !plannedStartAt.value || !plannedEndAt.value
      || plannedEndAt.value >= plannedStartAt.value);

  return valid ? {
    ok: true as const,
    command,
    dates: {
      plannedStartAt: plannedStartAt.ok ? plannedStartAt.value : null,
      plannedEndAt: plannedEndAt.ok ? plannedEndAt.value : null,
    },
  }
    : { ok: false as const };
}

async function canMutateExperiment(
  tx: Prisma.TransactionClient,
  actorId: string,
  labId: string,
) {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: {
      active: true,
      role: true,
      labMemberships: {
        where: { labId, active: true, lab: { active: true } },
        select: { role: true },
      },
    },
  });
  if (!actor?.active) return false;
  const role = normalizeUserRole(actor.role);
  return role === "facility_admin" || (
    role === "lab_user" &&
    actor.labMemberships.some((membership) => ["owner", "manager", "staff"].includes(membership.role))
  );
}

function experimentValues(command: NormalizedExperimentDetails, dates: { plannedStartAt: Date | null; plannedEndAt: Date | null }) {
  return {
    projectId: command.projectId,
    protocolAuthorizationId: command.protocolAuthorizationId,
    experimentCode: command.experimentCode,
    title: command.title,
    plannedStartAt: dates.plannedStartAt,
    plannedEndAt: dates.plannedEndAt,
    operationalContact: command.operationalContact,
    procedureSummary: command.procedureSummary,
    treatmentSummary: command.treatmentSummary,
    welfareRisks: command.welfareRisks,
    scheduleNotes: command.scheduleNotes,
    operationalNotes: command.operationalNotes,
    notes: command.notes,
    resultSummary: command.resultSummary,
  };
}

async function writeExperimentAudit(
  tx: Prisma.TransactionClient,
  actorId: string,
  experimentId: string,
  action: string,
  previousValue: Prisma.InputJsonValue | null,
  newValue: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({
    data: {
      id: randomUUID(),
      actorId,
      entityType: "experiment",
      entityId: experimentId,
      action,
      previousValue: previousValue ?? Prisma.JsonNull,
      newValue,
      timestamp: new Date(),
    },
  });
}

function reservationAllocationMarker(assignmentId: string) {
  return `[mcm:auto:experiment-reservation:${assignmentId}]`;
}

function promotionAllocationMarker(assignmentId: string) {
  return `[mcm:auto:experiment-promotion:${assignmentId}]`;
}

async function readOpenExperimentAssignments(
  tx: Prisma.TransactionClient,
  experimentId: string,
) {
  return tx.experimentAssignment.findMany({
    where: {
      experimentId,
      status: { in: ["planned", "reserved", "active"] },
    },
    orderBy: [{ id: "asc" }],
    select: {
      id: true,
      status: true,
      version: true,
      startDate: true,
      endDate: true,
      protocolCountAllocationId: true,
      protocolCountAllocation: {
        select: {
          status: true,
          aggregateType: true,
          aggregateId: true,
          reservedQuantity: true,
          consumedQuantity: true,
          releasedQuantity: true,
          authorizationVersion: {
            select: { authorizationId: true },
          },
        },
      },
      procedurePlans: {
        where: { status: "planned" },
        select: { id: true },
      },
      animal: {
        select: {
          id: true,
          animalId: true,
          status: true,
          outcomeStatus: true,
          experimentAssignments: {
            where: {
              status: { in: ["reserved", "active"] },
              NOT: { experimentId },
            },
            orderBy: [{ id: "asc" }],
            select: {
              id: true,
              status: true,
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
  });
}

async function settleExperimentCompletion(
  tx: Prisma.TransactionClient,
  input: {
    actor: ResolvedActor;
    receiptId: string;
    experiment: {
      id: string;
      experimentCode: string;
      projectId: string;
      protocolAuthorizationId: string | null;
    };
  },
) {
  const assignments = await readOpenExperimentAssignments(
    tx,
    input.experiment.id,
  );
  if (assignments.some((assignment) => assignment.procedurePlans.length > 0)) {
    return {
      ok: false as const,
      code: "active_procedure_plans",
      message:
        "Cancel every planned procedure before completing the experiment.",
    };
  }
  const planned = assignments.find((assignment) => assignment.status === "planned");
  if (planned) {
    return {
      ok: false as const,
      code: "unresolved_planned_assignments",
      message:
        "Promote or cancel every planned assignment before completing the experiment.",
    };
  }

  const unsettled = assignments.find((assignment) => {
    const allocation = assignment.protocolCountAllocation;
    return !assignment.protocolCountAllocationId ||
      !allocation ||
      allocation.status !== "consumed" ||
      allocation.aggregateType !== "experiment_assignment" ||
      allocation.aggregateId !== assignment.id ||
      allocation.authorizationVersion.authorizationId !==
        input.experiment.protocolAuthorizationId ||
      allocation.reservedQuantity < 1 ||
      allocation.consumedQuantity !== allocation.reservedQuantity ||
      allocation.releasedQuantity !== 0;
  });
  if (unsettled) {
    return {
      ok: false as const,
      code: "unsettled_reservations",
      message:
        "Every reserved or active assignment must have an exact, fully consumed protocol allocation before completion.",
    };
  }

  const timestamp = new Date();
  for (const assignment of assignments) {
    const completed = await tx.experimentAssignment.updateMany({
      where: {
        id: assignment.id,
        experimentId: input.experiment.id,
        status: assignment.status,
        version: assignment.version,
      },
      data: {
        status: "completed",
        endDate:
          assignment.endDate ??
          (assignment.startDate > timestamp ? assignment.startDate : timestamp),
        version: { increment: 1 },
      },
    });
    if (completed.count !== 1) {
      return {
        ok: false as const,
        code: "stale_conflict",
        message:
          "An experiment assignment changed while completion was being settled.",
      };
    }

    const otherOpenAssignments = assignment.animal.experimentAssignments;
    const targetAnimalStatus = otherOpenAssignments.some(
      (linked) => linked.status === "active",
    )
      ? ("in_experiment" as const)
      : otherOpenAssignments.length
        ? ("reserved" as const)
        : ("experiment_completed" as const);
    if (
      assignment.animal.outcomeStatus === "alive" &&
      ["reserved", "in_experiment", "experiment_completed"].includes(
        assignment.animal.status,
      )
    ) {
      await tx.animal.update({
        where: { id: assignment.animal.id },
        data: {
          status: targetAnimalStatus,
          experimentalStatus: otherOpenAssignments.length
            ? `${targetAnimalStatus === "in_experiment" ? "Active in" : "Reserved for"} ${otherOpenAssignments.map((linked) => linked.experiment.experimentCode).join(", ")}`
            : `Completed ${input.experiment.experimentCode}`,
          projectSummary:
            otherOpenAssignments[0]?.experiment.project.projectCode ?? null,
          version: { increment: 1 },
        },
      });
      if (targetAnimalStatus !== assignment.animal.status) {
        await tx.animalStatusEvent.create({
          data: {
            id: randomUUID(),
            animalId: assignment.animal.id,
            fromStatus: assignment.animal.status,
            toStatus: targetAnimalStatus,
            happenedAt: timestamp,
            actorId: input.actor.id,
            reason: `Experiment ${input.experiment.experimentCode} was completed.`,
          },
        });
      }
    }

    const hasOtherOpenProjectNeed = otherOpenAssignments.some(
      (linked) => linked.experiment.projectId === input.experiment.projectId,
    );
    let endedAllocationCount = 0;
    if (!hasOtherOpenProjectNeed) {
      const ended = await tx.animalProjectAllocation.updateMany({
        where: {
          animalId: assignment.animal.id,
          projectId: input.experiment.projectId,
          endedAt: null,
          OR: [
            { notes: { contains: reservationAllocationMarker(assignment.id) } },
            { notes: { contains: promotionAllocationMarker(assignment.id) } },
          ],
        },
        data: { endedAt: timestamp },
      });
      endedAllocationCount = ended.count;
    }
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorId: input.actor.id,
        entityType: "experiment_assignment",
        entityId: assignment.id,
        action: "complete_with_experiment",
        previousValue: {
          status: assignment.status,
          version: assignment.version,
          animalStatus: assignment.animal.status,
        },
        newValue: {
          receiptId: input.receiptId,
          status: "completed",
          version: assignment.version + 1,
          animalStatus: targetAnimalStatus,
          consumedProtocolCount:
            assignment.protocolCountAllocation?.consumedQuantity ?? 0,
          endedAutoProjectAllocationCount: endedAllocationCount,
        },
        timestamp,
      },
    });
  }
  return { ok: true as const };
}

async function settleExperimentCancellation(
  tx: Prisma.TransactionClient,
  input: {
    actor: ResolvedActor;
    receiptId: string;
    experiment: {
      id: string;
      experimentCode: string;
      projectId: string;
      protocolAuthorizationId: string | null;
    };
  },
) {
  const assignments = await readOpenExperimentAssignments(
    tx,
    input.experiment.id,
  );
  if (assignments.some((assignment) => assignment.procedurePlans.length > 0)) {
    return {
      ok: false as const,
      code: "active_procedure_plans",
      message:
        "Cancel each planned procedure before cancelling the experiment.",
    };
  }

  for (const assignment of assignments) {
    const allocation = assignment.protocolCountAllocation;
    if (
      ["reserved", "active"].includes(assignment.status) &&
      (!assignment.protocolCountAllocationId || !allocation)
    ) {
      return {
        ok: false as const,
        code: "compliance_count_conflict",
        message: `${assignment.animal.animalId} has no exact protocol reservation to release.`,
      };
    }
    if (!allocation) continue;
    const remaining =
      allocation.reservedQuantity -
      allocation.consumedQuantity -
      allocation.releasedQuantity;
    if (
      allocation.aggregateType !== "experiment_assignment" ||
      allocation.aggregateId !== assignment.id ||
      allocation.authorizationVersion.authorizationId !==
        input.experiment.protocolAuthorizationId ||
      remaining < 0
    ) {
      return {
        ok: false as const,
        code: "compliance_count_conflict",
        message: `${assignment.animal.animalId} has an inconsistent protocol reservation.`,
      };
    }
  }

  const timestamp = new Date();
  for (const assignment of assignments) {
    const allocation = assignment.protocolCountAllocation;
    const remaining = allocation
      ? allocation.reservedQuantity -
        allocation.consumedQuantity -
        allocation.releasedQuantity
      : 0;
    if (remaining > 0) {
      const released = await releaseProtocolReservation(tx, {
        actor: input.actor,
        receiptId: input.receiptId,
        protocolAuthorizationId: input.experiment.protocolAuthorizationId,
        allocationId: assignment.protocolCountAllocationId!,
        quantity: remaining,
        allocationKey: `experiment:${input.experiment.id}:assignment:${assignment.id}:cancel:release`,
        aggregateType: "experiment",
        aggregateId: input.experiment.id,
      });
      if (!released.ok) return released;
    }

    const cancelled = await tx.experimentAssignment.updateMany({
      where: {
        id: assignment.id,
        experimentId: input.experiment.id,
        status: assignment.status,
        version: assignment.version,
      },
      data: {
        status: "cancelled",
        endDate:
          assignment.endDate ??
          (assignment.startDate > timestamp ? assignment.startDate : timestamp),
        version: { increment: 1 },
      },
    });
    if (cancelled.count !== 1) {
      return {
        ok: false as const,
        code: "stale_conflict",
        message:
          "An experiment assignment changed while cancellation was being settled.",
      };
    }

    const otherOpenAssignments = assignment.animal.experimentAssignments;
    const targetAnimalStatus = otherOpenAssignments.some(
      (linked) => linked.status === "active",
    )
      ? ("in_experiment" as const)
      : otherOpenAssignments.length
        ? ("reserved" as const)
        : ("colony_holding" as const);
    if (
      assignment.animal.outcomeStatus === "alive" &&
      ["reserved", "in_experiment"].includes(assignment.animal.status)
    ) {
      await tx.animal.update({
        where: { id: assignment.animal.id },
        data: {
          status: targetAnimalStatus,
          experimentalStatus: otherOpenAssignments.length
            ? `${targetAnimalStatus === "in_experiment" ? "Active in" : "Reserved for"} ${otherOpenAssignments.map((linked) => linked.experiment.experimentCode).join(", ")}`
            : "Available for experiment planning",
          projectSummary:
            otherOpenAssignments[0]?.experiment.project.projectCode ?? null,
          version: { increment: 1 },
        },
      });
      if (targetAnimalStatus !== assignment.animal.status) {
        await tx.animalStatusEvent.create({
          data: {
            id: randomUUID(),
            animalId: assignment.animal.id,
            fromStatus: assignment.animal.status,
            toStatus: targetAnimalStatus,
            happenedAt: timestamp,
            actorId: input.actor.id,
            reason: `Experiment ${input.experiment.experimentCode} was cancelled.`,
          },
        });
      }
    }

    const hasOtherOpenProjectNeed = otherOpenAssignments.some(
      (linked) => linked.experiment.projectId === input.experiment.projectId,
    );
    let endedAllocationCount = 0;
    if (!hasOtherOpenProjectNeed) {
      const ended = await tx.animalProjectAllocation.updateMany({
        where: {
          animalId: assignment.animal.id,
          projectId: input.experiment.projectId,
          endedAt: null,
          OR: [
            { notes: { contains: reservationAllocationMarker(assignment.id) } },
            { notes: { contains: promotionAllocationMarker(assignment.id) } },
          ],
        },
        data: { endedAt: timestamp },
      });
      endedAllocationCount = ended.count;
    }
    await tx.auditLog.create({
      data: {
        id: randomUUID(),
        actorId: input.actor.id,
        entityType: "experiment_assignment",
        entityId: assignment.id,
        action: "cancel_with_experiment",
        previousValue: {
          status: assignment.status,
          version: assignment.version,
          animalStatus: assignment.animal.status,
        },
        newValue: {
          receiptId: input.receiptId,
          status: "cancelled",
          version: assignment.version + 1,
          animalStatus: targetAnimalStatus,
          releasedProtocolCount: remaining,
          endedAutoProjectAllocationCount: endedAllocationCount,
        },
        timestamp,
      },
    });
  }
  return { ok: true as const };
}

export async function getExperimentRegistryOptions(actor: ResolvedActor) {
  if (!actor.capabilities.includes("experiments:manage")) return { labOptions: [], projectOptions: [], protocolOptions: [] };
  const labWhere = actor.canonicalRole === "facility_admin"
    ? { active: true }
    : { active: true, id: actor.activeLabId ?? "" };
  const [labs, projects, protocols] = await prisma.$transaction([
    prisma.lab.findMany({ where: labWhere, orderBy: [{ code: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true } }),
    prisma.project.findMany({
      where: { lab: labWhere },
      orderBy: [{ projectCode: "asc" }, { title: "asc" }],
      select: { id: true, labId: true, projectCode: true, title: true },
    }),
    prisma.protocolAuthorization.findMany({
      where: { lab: labWhere, status: { in: ["draft", "active", "suspended"] } },
      orderBy: [{ protocolCode: "asc" }],
      select: { id: true, labId: true, protocolCode: true, title: true, status: true },
    }),
  ]);
  return {
    labOptions: labs.map((lab) => ({ id: lab.id, label: `${lab.code} · ${lab.name}` })),
    projectOptions: projects.map((project) => ({ id: project.id, labId: project.labId, label: `${project.projectCode} · ${project.title}` })),
    protocolOptions: protocols.map((protocol) => ({ id: protocol.id, labId: protocol.labId, label: `${protocol.protocolCode} · ${protocol.title} (${protocol.status})` })),
  };
}

export async function executeCreateExperimentCommand(input: {
  actor: ResolvedActor;
  command: ExperimentDetailsInput;
} & CommandIdentity) {
  const normalized = normalizeDetails(input.actor, input.command);
  if (!normalized.ok) {
    return { ok: false as const, code: "validation_error", message: "Enter a valid lab, project, code, title, and planned date range." };
  }
  const { command, dates } = normalized;
  const experimentId = randomUUID();
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "experiment.create",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: command as unknown as Prisma.InputJsonValue,
    requiredCapability: "experiments:manage",
    labId: command.labId,
    handler: async (tx) => {
      if (!await canMutateExperiment(tx, input.actor.id, command.labId)) {
        return { ok: false, code: "forbidden", message: "You cannot create experiments for this lab." };
      }
      const [lab, project, duplicate, protocol] = await Promise.all([
        tx.lab.findFirst({ where: { id: command.labId, active: true }, select: { id: true } }),
        tx.project.findFirst({
          where: { id: command.projectId, labId: command.labId },
          select: { id: true, ownerId: true },
        }),
        tx.experiment.findUnique({ where: { experimentCode: command.experimentCode }, select: { id: true } }),
        command.protocolAuthorizationId
          ? tx.protocolAuthorization.findFirst({ where: { id: command.protocolAuthorizationId, labId: command.labId }, select: { id: true } })
          : Promise.resolve(null),
      ]);
      if (!lab) return { ok: false, code: "not_found", message: "The selected lab is not active." };
      if (!project) return { ok: false, code: "project_lab_mismatch", message: "Choose a project from the selected lab." };
      if (duplicate) return { ok: false, code: "duplicate_code", message: "That experiment code is already in use." };
      if (command.protocolAuthorizationId && !protocol) return { ok: false, code: "compliance_protocol_out_of_scope", message: "Choose a protocol authorization from the selected lab." };
      const values = experimentValues(command, dates);
      await tx.experiment.create({
        data: { id: experimentId, labId: command.labId, ownerId: project.ownerId, status: "planned", version: 1, ...values },
      });
      await writeExperimentAudit(tx, input.actor.id, experimentId, "create", null, {
        ...command,
        ownerId: project.ownerId,
        createdById: input.actor.id,
        status: "planned",
        version: 1,
      });
      return {
        ok: true,
        result: { experimentId, status: "planned", version: 1 },
        aggregateType: "experiment",
        aggregateId: experimentId,
        resultingVersion: 1,
      };
    },
  });
}

export async function executeUpdateExperimentCommand(input: {
  actor: ResolvedActor;
  command: ExperimentDetailsInput & { experimentId: string };
  expectedVersion: number;
} & CommandIdentity) {
  const normalized = normalizeDetails(input.actor, input.command);
  const experimentId = input.command.experimentId.trim();
  if (!normalized.ok || !experimentId || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return { ok: false as const, code: "validation_error", message: "Enter valid experiment details and refresh before trying again." };
  }
  const { command, dates } = normalized;
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "experiment.update",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: command as unknown as Prisma.InputJsonValue,
    requiredCapability: "experiments:manage",
    labId: command.labId,
    aggregateType: "experiment",
    aggregateId: experimentId,
    expectedVersion: input.expectedVersion,
    handler: async (tx) => {
      const experiment = await tx.experiment.findFirst({ where: { id: experimentId, labId: command.labId } });
      if (!experiment) return { ok: false, code: "not_found", message: "Experiment not found." };
      if (!await canMutateExperiment(tx, input.actor.id, experiment.labId)) {
        return { ok: false, code: "forbidden", message: "You cannot update this experiment." };
      }
      if (experiment.status === "completed" || experiment.status === "cancelled") {
        return { ok: false, code: "terminal_locked", message: "Completed and cancelled experiments are locked." };
      }
      const [project, duplicate, protocol] = await Promise.all([
        tx.project.findFirst({ where: { id: command.projectId, labId: experiment.labId }, select: { id: true } }),
        tx.experiment.findFirst({
          where: { experimentCode: command.experimentCode, NOT: { id: experiment.id } },
          select: { id: true },
        }),
        command.protocolAuthorizationId
          ? tx.protocolAuthorization.findFirst({ where: { id: command.protocolAuthorizationId, labId: experiment.labId }, select: { id: true } })
          : Promise.resolve(null),
      ]);
      if (!project) return { ok: false, code: "project_lab_mismatch", message: "Choose a project from the experiment lab." };
      if (duplicate) return { ok: false, code: "duplicate_code", message: "That experiment code is already in use." };
      if (command.protocolAuthorizationId && !protocol) return { ok: false, code: "compliance_protocol_out_of_scope", message: "Choose a protocol authorization from the experiment lab." };
      const values = experimentValues(command, dates);
      const updated = await tx.experiment.updateMany({
        where: { id: experiment.id, version: input.expectedVersion, status: { in: ["planned", "active"] } },
        data: { ...values, version: { increment: 1 } },
      });
      if (!updated.count) {
        const current = await tx.experiment.findUnique({ where: { id: experiment.id }, select: { version: true } });
        return staleConflict("experiment", experiment.id, input.expectedVersion, current?.version ?? null);
      }
      const resultingVersion = input.expectedVersion + 1;
      await writeExperimentAudit(tx, input.actor.id, experiment.id, "update", {
        projectId: experiment.projectId,
        experimentCode: experiment.experimentCode,
        title: experiment.title,
        status: experiment.status,
        version: experiment.version,
      }, { ...command, status: experiment.status, version: resultingVersion });
      return { ok: true, result: { experimentId: experiment.id, status: experiment.status, version: resultingVersion }, resultingVersion };
    },
  });
}

export async function executeTransitionExperimentCommand(input: {
  actor: ResolvedActor;
  command: { experimentId: string; labId?: string | null; status: ExperimentStatus };
  expectedVersion: number;
} & CommandIdentity) {
  const experimentId = input.command.experimentId.trim();
  const labId = resolveCommandLab(input.actor, input.command.labId);
  if (!experimentId || !labId || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    return { ok: false as const, code: "validation_error", message: "Refresh the experiment before changing its status." };
  }
  const command = { experimentId, labId, status: input.command.status };
  return executeIdempotentCommand({
    actor: input.actor,
    commandType: "experiment.status.transition",
    idempotencyKey: input.idempotencyKey,
    requestId: input.requestId,
    request: command,
    requiredCapability: "experiments:manage",
    labId,
    aggregateType: "experiment",
    aggregateId: experimentId,
    expectedVersion: input.expectedVersion,
    handler: async (tx, context) => {
      const experiment = await tx.experiment.findFirst({ where: { id: experimentId, labId } });
      if (!experiment) return { ok: false, code: "not_found", message: "Experiment not found." };
      if (!await canMutateExperiment(tx, input.actor.id, experiment.labId)) {
        return { ok: false, code: "forbidden", message: "You cannot change this experiment lifecycle." };
      }
      if (!canTransitionExperimentStatus(experiment.status, command.status)) {
        return { ok: false, code: "invalid_transition", message: `Experiments cannot move from ${experiment.status} to ${command.status}.` };
      }
      const applyTransition = async (compliance: { ok: true; protocolAuthorizationId: string; evidenceSnapshotId: string } | null) => {
        const updated = await tx.experiment.updateMany({
          where: { id: experiment.id, version: input.expectedVersion, status: experiment.status },
          data: {
            status: command.status,
            ...(compliance ? {
              protocolAuthorizationId: compliance.protocolAuthorizationId,
              complianceEvidenceSnapshotId: compliance.evidenceSnapshotId,
            } : {}),
            version: { increment: 1 },
          },
        });
        if (!updated.count) {
          const current = await tx.experiment.findUnique({ where: { id: experiment.id }, select: { version: true } });
          return staleConflict("experiment", experiment.id, input.expectedVersion, current?.version ?? null);
        }
        const resultingVersion = input.expectedVersion + 1;
        await writeExperimentAudit(tx, input.actor.id, experiment.id, "status_transition", {
          status: experiment.status,
          version: experiment.version,
        }, { status: command.status, version: resultingVersion });
        return { ok: true as const, result: { experimentId: experiment.id, status: command.status, version: resultingVersion }, resultingVersion };
      };
      if (command.status === "active") {
        return withComplianceWriteScope(tx, {
            actor: input.actor,
            receiptId: context.receiptId,
            commandType: "experiment.status.transition",
            labId: experiment.labId,
            aggregateType: "experiment",
            aggregateId: experiment.id,
            protocolAuthorizationId: experiment.protocolAuthorizationId,
            projectId: experiment.projectId,
            experimentId: experiment.id,
            requiredPersonnelRoles: ["principal_investigator", "named_researcher"],
            countOperation: "none",
          }, applyTransition);
      }
      if (command.status === "completed") {
        return withM13MutationSavepoint(tx, async () => {
          const settled = await settleExperimentCompletion(tx, {
            actor: input.actor,
            receiptId: context.receiptId,
            experiment,
          });
          if (!settled.ok) return settled;
          return applyTransition(null);
        });
      }
      if (command.status === "cancelled") {
        return withM13MutationSavepoint(tx, async () => {
          const settled = await settleExperimentCancellation(tx, {
            actor: input.actor,
            receiptId: context.receiptId,
            experiment,
          });
          if (!settled.ok) return settled;
          return applyTransition(null);
        });
      }
      return applyTransition(null);
    },
  });
}
