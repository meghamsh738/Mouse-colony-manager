import { randomUUID } from "node:crypto";

import { Prisma, type ExperimentStatus } from "@prisma/client";

import { normalizeUserRole } from "@/lib/capabilities";
import { executeIdempotentCommand, staleConflict } from "@/lib/command-foundation";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";

type CommandIdentity = {
  idempotencyKey: string;
  requestId: string;
};

export type ExperimentDetailsInput = {
  labId?: string | null;
  projectId: string;
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

export async function getExperimentRegistryOptions(actor: ResolvedActor) {
  if (!actor.capabilities.includes("experiments:manage")) return { labOptions: [], projectOptions: [] };
  const labWhere = actor.canonicalRole === "facility_admin"
    ? { active: true }
    : { active: true, id: actor.activeLabId ?? "" };
  const [labs, projects] = await prisma.$transaction([
    prisma.lab.findMany({ where: labWhere, orderBy: [{ code: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true } }),
    prisma.project.findMany({
      where: { lab: labWhere },
      orderBy: [{ projectCode: "asc" }, { title: "asc" }],
      select: { id: true, labId: true, projectCode: true, title: true },
    }),
  ]);
  return {
    labOptions: labs.map((lab) => ({ id: lab.id, label: `${lab.code} · ${lab.name}` })),
    projectOptions: projects.map((project) => ({ id: project.id, labId: project.labId, label: `${project.projectCode} · ${project.title}` })),
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
      const [lab, project, duplicate] = await Promise.all([
        tx.lab.findFirst({ where: { id: command.labId, active: true }, select: { id: true } }),
        tx.project.findFirst({
          where: { id: command.projectId, labId: command.labId },
          select: { id: true, ownerId: true },
        }),
        tx.experiment.findUnique({ where: { experimentCode: command.experimentCode }, select: { id: true } }),
      ]);
      if (!lab) return { ok: false, code: "not_found", message: "The selected lab is not active." };
      if (!project) return { ok: false, code: "project_lab_mismatch", message: "Choose a project from the selected lab." };
      if (duplicate) return { ok: false, code: "duplicate_code", message: "That experiment code is already in use." };
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
      const [project, duplicate] = await Promise.all([
        tx.project.findFirst({ where: { id: command.projectId, labId: experiment.labId }, select: { id: true } }),
        tx.experiment.findFirst({
          where: { experimentCode: command.experimentCode, NOT: { id: experiment.id } },
          select: { id: true },
        }),
      ]);
      if (!project) return { ok: false, code: "project_lab_mismatch", message: "Choose a project from the experiment lab." };
      if (duplicate) return { ok: false, code: "duplicate_code", message: "That experiment code is already in use." };
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
    handler: async (tx) => {
      const experiment = await tx.experiment.findFirst({ where: { id: experimentId, labId } });
      if (!experiment) return { ok: false, code: "not_found", message: "Experiment not found." };
      if (!await canMutateExperiment(tx, input.actor.id, experiment.labId)) {
        return { ok: false, code: "forbidden", message: "You cannot change this experiment lifecycle." };
      }
      if (!canTransitionExperimentStatus(experiment.status, command.status)) {
        return { ok: false, code: "invalid_transition", message: `Experiments cannot move from ${experiment.status} to ${command.status}.` };
      }
      const updated = await tx.experiment.updateMany({
        where: { id: experiment.id, version: input.expectedVersion, status: experiment.status },
        data: { status: command.status, version: { increment: 1 } },
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
      return { ok: true, result: { experimentId: experiment.id, status: command.status, version: resultingVersion }, resultingVersion };
    },
  });
}
