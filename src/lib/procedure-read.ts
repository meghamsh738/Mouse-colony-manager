import type { Prisma } from "@prisma/client";

import { actorHasCapability } from "@/lib/capabilities";
import { getActorLabAccess, labScopedWhere } from "@/lib/lab-access";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";

const procedurePlanSelect = {
  id: true,
  labId: true,
  experimentId: true,
  assignmentId: true,
  procedureCode: true,
  title: true,
  scheduledAt: true,
  status: true,
  sopId: true,
  sopVersionId: true,
  sopVersionNumber: true,
  sopContentHash: true,
  sopAssignmentId: true,
  assignmentContextSnapshot: true,
  experimentContextSnapshot: true,
  createdAt: true,
  version: true,
  lab: { select: { code: true, name: true } },
  experiment: {
    select: {
      experimentCode: true,
      title: true,
      status: true,
      plannedStartAt: true,
      plannedEndAt: true,
      operationalContact: true,
      project: { select: { projectCode: true } },
    },
  },
  assignment: {
    select: {
      status: true,
      startDate: true,
      endDate: true,
      treatmentGroup: true,
      animal: {
        select: {
          id: true,
          facilityAnimalId: true,
          sex: true,
          strain: { select: { name: true } },
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
  sop: { select: { code: true, title: true, category: true } },
  createdBy: { select: { name: true } },
  occurrences: {
    orderBy: [{ occurredAt: "desc" as const }, { id: "desc" as const }],
    select: {
      id: true,
      occurrenceKey: true,
      occurredAt: true,
      status: true,
      outcomeNote: true,
      experimentCodeSnapshot: true,
      animalFacilityIdSnapshot: true,
      cageBarcodeSnapshot: true,
      roomNumberSnapshot: true,
      rackNumberSnapshot: true,
      cageNumberSnapshot: true,
      sopId: true,
      sopVersionId: true,
      sopVersionNumber: true,
      sopContentHash: true,
      sopAssignmentId: true,
      assignmentContextSnapshot: true,
      experimentContextSnapshot: true,
      recordedAt: true,
      executedBy: { select: { name: true } },
    },
  },
} satisfies Prisma.ProcedurePlanSelect;

function jsonObject(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Prisma.JsonObject
    : {};
}

function snapshotString(snapshot: Prisma.JsonObject, key: string, fallback: string): string;
function snapshotString(snapshot: Prisma.JsonObject, key: string, fallback: string | null): string | null;
function snapshotString(snapshot: Prisma.JsonObject, key: string, fallback: string | null) {
  const value = snapshot[key];
  return typeof value === "string" ? value : fallback;
}

function serializePlan(plan: Prisma.ProcedurePlanGetPayload<{ select: typeof procedurePlanSelect }>) {
  const assignmentContext = jsonObject(plan.assignmentContextSnapshot);
  const experimentContext = jsonObject(plan.experimentContextSnapshot);
  return {
    id: plan.id,
    labId: plan.labId,
    labCode: plan.lab.code,
    labName: plan.lab.name,
    experimentId: plan.experimentId,
    experimentCode: snapshotString(experimentContext, "experimentCode", plan.experiment.experimentCode),
    experimentTitle: snapshotString(experimentContext, "title", plan.experiment.title),
    projectCode: snapshotString(experimentContext, "projectCode", plan.experiment.project.projectCode),
    experimentStatus: plan.experiment.status,
    plannedStartAt: snapshotString(experimentContext, "plannedStartAt", plan.experiment.plannedStartAt?.toISOString() ?? null),
    plannedEndAt: snapshotString(experimentContext, "plannedEndAt", plan.experiment.plannedEndAt?.toISOString() ?? null),
    operationalContact: snapshotString(experimentContext, "operationalContact", plan.experiment.operationalContact),
    assignmentId: plan.assignmentId,
    assignmentStatus: plan.assignment.status,
    assignmentStartDate: snapshotString(assignmentContext, "startDate", plan.assignment.startDate.toISOString()),
    assignmentEndDate: snapshotString(assignmentContext, "endDate", plan.assignment.endDate?.toISOString() ?? null),
    treatmentGroup: snapshotString(assignmentContext, "treatmentGroup", plan.assignment.treatmentGroup),
    animalId: plan.assignment.animal.id,
    animalFacilityId: plan.assignment.animal.facilityAnimalId,
    animalSex: plan.assignment.animal.sex,
    strain: plan.assignment.animal.strain.name,
    cageBarcode: plan.assignment.animal.currentCage?.barcode ?? null,
    roomNumber: plan.assignment.animal.currentCage?.room.roomNumber ?? null,
    rackNumber: plan.assignment.animal.currentCage?.rack.rackNumber ?? null,
    cageNumber: plan.assignment.animal.currentCage?.cageNumber ?? null,
    procedureCode: plan.procedureCode,
    title: plan.title,
    scheduledAt: plan.scheduledAt.toISOString(),
    status: plan.status,
    version: plan.version,
    sopId: plan.sopId,
    sopCode: plan.sop.code,
    sopTitle: plan.sop.title,
    sopCategory: plan.sop.category,
    sopVersionId: plan.sopVersionId,
    sopVersionNumber: plan.sopVersionNumber,
    sopContentHash: plan.sopContentHash,
    sopAssignmentId: plan.sopAssignmentId,
    assignmentContextSnapshot: plan.assignmentContextSnapshot,
    experimentContextSnapshot: plan.experimentContextSnapshot,
    createdBy: plan.createdBy.name,
    createdAt: plan.createdAt.toISOString(),
    occurrences: plan.occurrences.map((occurrence) => ({
      id: occurrence.id,
      occurrenceKey: occurrence.occurrenceKey,
      occurredAt: occurrence.occurredAt.toISOString(),
      status: occurrence.status,
      outcomeNote: occurrence.outcomeNote,
      experimentCode: occurrence.experimentCodeSnapshot,
      animalFacilityId: occurrence.animalFacilityIdSnapshot,
      cageBarcode: occurrence.cageBarcodeSnapshot,
      roomNumber: occurrence.roomNumberSnapshot,
      rackNumber: occurrence.rackNumberSnapshot,
      cageNumber: occurrence.cageNumberSnapshot,
      sopId: occurrence.sopId,
      sopVersionId: occurrence.sopVersionId,
      sopVersionNumber: occurrence.sopVersionNumber,
      sopContentHash: occurrence.sopContentHash,
      sopAssignmentId: occurrence.sopAssignmentId,
      assignmentContextSnapshot: occurrence.assignmentContextSnapshot,
      experimentContextSnapshot: occurrence.experimentContextSnapshot,
      executedBy: occurrence.executedBy.name,
      recordedAt: occurrence.recordedAt.toISOString(),
    })),
  };
}

export async function getProcedureWorkspace(actor: ResolvedActor, input?: { search?: string; status?: string }) {
  const access = await getActorLabAccess(actor);
  const search = input?.search?.trim() ?? "";
  const status = input?.status && ["planned", "completed", "cancelled"].includes(input.status)
    ? input.status
    : "all";
  const planWhere: Prisma.ProcedurePlanWhereInput = {
    ...labScopedWhere(access),
    ...(status && status !== "all" ? { status: status as Prisma.EnumProcedurePlanStatusFilter } : {}),
    ...(search
      ? {
          OR: [
            { procedureCode: { contains: search, mode: "insensitive" } },
            { title: { contains: search, mode: "insensitive" } },
            { experiment: { experimentCode: { contains: search, mode: "insensitive" } } },
            { assignment: { animal: { facilityAnimalId: { contains: search, mode: "insensitive" } } } },
            { assignment: { animal: { currentCage: { barcode: { contains: search, mode: "insensitive" } } } } },
          ],
        }
      : {}),
  };
  const canPlan = actorHasCapability(actor, "procedures:plan");
  const canExecute = actorHasCapability(actor, "procedures:execute");
  const [plans, assignments, sopAssignments] = await Promise.all([
    prisma.procedurePlan.findMany({
      where: planWhere,
      orderBy: [{ status: "asc" }, { scheduledAt: "asc" }, { id: "asc" }],
      select: procedurePlanSelect,
    }),
    canPlan
      ? prisma.experimentAssignment.findMany({
          where: {
            status: { in: ["planned", "reserved", "active"] },
            experiment: {
              status: { in: ["planned", "active"] },
              ...labScopedWhere(access),
            },
            animal: { outcomeStatus: "alive" },
          },
          orderBy: [{ experiment: { experimentCode: "asc" } }, { animal: { facilityAnimalId: "asc" } }],
          select: {
            id: true,
            version: true,
            startDate: true,
            treatmentGroup: true,
            experiment: {
              select: {
                id: true,
                labId: true,
                version: true,
                experimentCode: true,
                title: true,
                plannedStartAt: true,
                plannedEndAt: true,
              },
            },
            animal: { select: { owningLabId: true, facilityAnimalId: true } },
          },
        })
      : Promise.resolve([]),
    canPlan
      ? prisma.sopAssignment.findMany({
          where: {
            revokedAt: null,
            ...labScopedWhere(access),
            sop: { active: true },
            sopVersion: { approval: { decision: "approved" } },
          },
          orderBy: [{ lab: { code: "asc" } }, { sop: { code: "asc" } }],
          select: {
            id: true,
            labId: true,
            sopId: true,
            sopVersionId: true,
            lab: { select: { code: true } },
            sop: { select: { code: true, title: true, currentVersionId: true } },
            sopVersion: { select: { versionNumber: true, contentHash: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const assignmentOptions = assignments
    .filter((assignment) => assignment.animal.owningLabId === assignment.experiment.labId)
    .map((assignment) => ({
      id: assignment.id,
      version: assignment.version,
      experimentId: assignment.experiment.id,
      experimentVersion: assignment.experiment.version,
      labId: assignment.experiment.labId,
      label: `${assignment.experiment.experimentCode} · ${assignment.animal.facilityAnimalId}${assignment.treatmentGroup ? ` · ${assignment.treatmentGroup}` : ""}`,
      scheduledMin: [assignment.startDate, assignment.experiment.plannedStartAt]
        .filter((date): date is Date => Boolean(date))
        .sort((left, right) => right.getTime() - left.getTime())[0]?.toISOString() ?? assignment.startDate.toISOString(),
      scheduledMax: assignment.experiment.plannedEndAt?.toISOString() ?? null,
    }));
  const assignmentLabs = new Set(assignmentOptions.map((assignment) => assignment.labId));
  const sopOptions = sopAssignments
    .filter((assignment) => assignmentLabs.has(assignment.labId) && assignment.sop.currentVersionId === assignment.sopVersionId)
    .map((assignment) => ({
      id: assignment.id,
      labId: assignment.labId,
      label: `${assignment.lab.code} · ${assignment.sop.code} v${assignment.sopVersion.versionNumber} · ${assignment.sop.title}`,
      sopId: assignment.sopId,
      sopVersionId: assignment.sopVersionId,
      sopVersionNumber: assignment.sopVersion.versionNumber,
      sopContentHash: assignment.sopVersion.contentHash,
    }));
  const rows = plans.map(serializePlan);
  return {
    rows,
    assignmentOptions,
    sopOptions,
    summary: {
      planned: rows.filter((row) => row.status === "planned").length,
      due: rows.filter((row) => row.status === "planned" && new Date(row.scheduledAt) <= new Date()).length,
      completed: rows.filter((row) => row.status === "completed").length,
      cancelled: rows.filter((row) => row.status === "cancelled").length,
    },
    permissions: { canPlan, canExecute },
  };
}

export async function getProcedurePlanById(actor: ResolvedActor, planId: string) {
  const access = await getActorLabAccess(actor);
  const plan = await prisma.procedurePlan.findFirst({
    where: { id: planId, ...labScopedWhere(access) },
    select: procedurePlanSelect,
  });
  return plan ? serializePlan(plan) : null;
}
