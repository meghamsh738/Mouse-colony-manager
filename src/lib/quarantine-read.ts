import { differenceInDays } from "date-fns";

import { prisma } from "@/lib/prisma";
import { getActorLabAccess, labScopedWhere, type LabActor } from "@/lib/lab-access";
import { getCageCapacityState } from "@/lib/cage-capacity";
import { QUARANTINE_HEALTH_NOTE_ACTION_PREFIX } from "@/lib/quarantine-state-machine";

type QuarantineRuleContext = {
  sentinelCheckIntervalDays: number;
  quarantineReviewDays: number;
  today: string;
};

function getReferenceDate() {
  return process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString();
}

function buildCageLabel(cage: {
  cageNumber: string;
  room: { roomNumber: string };
  rack: { rackNumber: string };
}) {
  return `${cage.room.roomNumber} / ${cage.rack.rackNumber} / ${cage.cageNumber}`;
}

async function getQuarantineRuleContext(): Promise<QuarantineRuleContext> {
  const rules = await prisma.ruleConfig.findMany({
    where: {
      key: { in: ["sentinel_check_interval_days", "quarantine_review_days"] },
    },
    select: {
      key: true,
      value: true,
    },
  });
  const values = new Map(rules.map((rule) => [rule.key, rule.value]));

  return {
    sentinelCheckIntervalDays: Number(values.get("sentinel_check_interval_days") ?? 7),
    quarantineReviewDays: Number(values.get("quarantine_review_days") ?? 14),
    today: getReferenceDate(),
  };
}

type QuarantineActor = LabActor & { activeDuties?: readonly string[] };

function isUnitVeterinarian(actor: QuarantineActor) {
  return actor.activeDuties?.includes("designated_veterinarian") ?? false;
}

export async function getQuarantineSentinelView(actor: QuarantineActor) {
  const access = await getActorLabAccess(actor);
  const unitScoped = isUnitVeterinarian(actor);
  const scope = unitScoped ? {} : labScopedWhere(access);
  const rules = await getQuarantineRuleContext();
  const cages = await prisma.cage.findMany({
    where: {
      status: "quarantine",
      ...scope,
    },
    orderBy: [{ room: { roomNumber: "asc" } }, { rack: { rackNumber: "asc" } }, { cageNumber: "asc" }],
    include: {
      lab: { select: { name: true, code: true } },
      room: { select: { roomNumber: true } },
      rack: { select: { rackNumber: true } },
      animals: {
        where: {
          outcomeStatus: "alive",
          ...(unitScoped ? {} : labScopedWhere(access, "owningLabId")),
        },
        orderBy: { animalId: "asc" },
        include: {
          strain: { select: { name: true } },
        },
      },
      healthNotes: {
        where: scope,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          noteType: true,
          severity: true,
          note: true,
          actionTaken: true,
          followupRequired: true,
          resolved: true,
          createdAt: true,
        },
      },
      cageMovements: {
        orderBy: { movedAt: "desc" },
        take: 1,
        select: {
          movedAt: true,
          reason: true,
        },
      },
      quarantineCases: {
        where: { status: { in: ["admitted", "under_observation", "exception_open", "release_requested"] } },
        orderBy: [{ admittedAt: "desc" }, { id: "desc" }],
        take: 1,
        include: {
          observations: {
            orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
            take: 5,
            select: {
              id: true,
              observedAt: true,
              result: true,
              severity: true,
              note: true,
              followupRequired: true,
            },
          },
        },
      },
    },
  });
  const releaseCages = await prisma.cage.findMany({
    where: { active: true, status: "active", ...scope },
    orderBy: [{ room: { roomNumber: "asc" } }, { rack: { rackNumber: "asc" } }, { cageNumber: "asc" }],
    select: {
      id: true,
      labId: true,
      barcode: true,
      cageNumber: true,
      capacityOverride: true,
      room: { select: { roomNumber: true, facility: { select: { maxCageOccupancy: true } } } },
      rack: { select: { rackNumber: true } },
      animals: { where: { outcomeStatus: "alive" }, select: { sex: true } },
    },
  });
  const today = new Date(rules.today);

  const quarantineCages = cages.map((cage) => {
    const latestNote = cage.healthNotes[0] ?? null;
    const activeCase = cage.quarantineCases[0] ?? null;
    const unresolvedNotes = cage.healthNotes.filter(
      (note) => !note.resolved && (note.followupRequired || note.severity === "warning" || note.severity === "critical"),
    );
    const caseUnresolvedNotes = activeCase
      ? unresolvedNotes.filter(
          (note) => note.createdAt.getTime() >= activeCase.admittedAt.getTime() && note.actionTaken?.startsWith(QUARANTINE_HEALTH_NOTE_ACTION_PREFIX),
        )
      : [];
    const criticalNotes = unresolvedNotes.filter((note) => note.severity === "critical");
    const daysSinceLastCheck = latestNote ? differenceInDays(today, latestNote.createdAt) : null;
    const sentinelDue = daysSinceLastCheck === null || daysSinceLastCheck >= rules.sentinelCheckIntervalDays;
    const daysInQuarantine = differenceInDays(today, activeCase?.admittedAt ?? cage.lastUpdatedAt);
    const reviewDue = daysInQuarantine >= rules.quarantineReviewDays;
    const welfareFlags = Array.isArray(cage.welfareFlags) ? cage.welfareFlags.map((flag) => String(flag)) : [];

    return {
      id: cage.id,
      barcode: cage.barcode,
      labId: cage.labId,
      labName: cage.lab.name,
      label: buildCageLabel(cage),
      version: cage.version,
      notes: cage.notes ?? "",
      welfareFlags,
      occupantCount: cage.animals.length,
      occupants: cage.animals.map((animal) => ({
        id: animal.id,
        animalId: animal.animalId,
        sex: animal.sex,
        strain: animal.strain.name,
      })),
      latestNote: latestNote
        ? {
            id: latestNote.id,
            noteType: latestNote.noteType,
            severity: latestNote.severity,
            note: latestNote.note,
            createdAt: latestNote.createdAt.toISOString(),
          }
        : null,
      unresolvedNoteCount: unresolvedNotes.length,
      criticalNoteCount: criticalNotes.length,
      daysSinceLastCheck,
      daysInQuarantine,
      sentinelDue,
      reviewDue,
      quarantineCase: activeCase
        ? {
            id: activeCase.id,
            version: activeCase.version,
            status: activeCase.status,
            admittedAt: activeCase.admittedAt.toISOString(),
            minimumReleaseAt: activeCase.minimumReleaseAt.toISOString(),
            admissionReason: activeCase.admissionReason,
            releaseRequestedAt: activeCase.releaseRequestedAt?.toISOString() ?? null,
            releaseRequestReason: activeCase.releaseRequestReason ?? null,
            openFollowupCount: caseUnresolvedNotes.length,
            latestObservation: activeCase.observations[0]
              ? {
                  ...activeCase.observations[0],
                  observedAt: activeCase.observations[0].observedAt.toISOString(),
                }
              : null,
            observations: activeCase.observations.map((observation) => ({
              ...observation,
              observedAt: observation.observedAt.toISOString(),
            })),
          }
        : null,
      lastMovement: cage.cageMovements[0]
        ? {
            movedAt: cage.cageMovements[0].movedAt.toISOString(),
            reason: cage.cageMovements[0].reason ?? "",
          }
        : null,
    };
  });

  return {
    rules,
    cages: quarantineCages,
    releaseDestinations: releaseCages.map((cage) => {
      const capacity = getCageCapacityState({ facilityLimit: cage.room.facility.maxCageOccupancy, cageOverride: cage.capacityOverride, occupantCount: cage.animals.length });
      return {
        id: cage.id,
        labId: cage.labId,
        barcode: cage.barcode,
        label: buildCageLabel(cage),
        occupantCount: cage.animals.length,
        effectiveCapacity: capacity.effectiveLimit,
        remainingCapacity: capacity.remainingCapacity,
        sexes: [...new Set(cage.animals.map((animal) => animal.sex))],
      };
    }),
    summary: {
      quarantineCages: quarantineCages.length,
      quarantineAnimals: quarantineCages.reduce((sum, cage) => sum + cage.occupantCount, 0),
      sentinelDue: quarantineCages.filter((cage) => cage.sentinelDue).length,
      reviewDue: quarantineCages.filter((cage) => cage.reviewDue).length,
      openFollowups: quarantineCages.reduce((sum, cage) => sum + cage.unresolvedNoteCount, 0),
      criticalConcerns: quarantineCages.reduce((sum, cage) => sum + cage.criticalNoteCount, 0),
    },
  };
}

export async function getQuarantineCaseActionView(actor: QuarantineActor, caseId: string) {
  const access = await getActorLabAccess(actor);
  const unitScoped = isUnitVeterinarian(actor);
  const scope = unitScoped ? {} : labScopedWhere(access);
  const quarantineCase = await prisma.quarantineCase.findFirst({
    where: { id: caseId, ...scope },
    include: {
      cage: {
        select: {
          labId: true,
          cageNumber: true,
          room: { select: { roomNumber: true } },
          rack: { select: { rackNumber: true } },
          animals: {
            where: { outcomeStatus: "alive", ...(unitScoped ? {} : labScopedWhere(access, "owningLabId")) },
            orderBy: { animalId: "asc" },
            select: { id: true, animalId: true, sex: true, strain: { select: { name: true } } },
          },
          healthNotes: {
            where: { resolved: false, ...scope },
            select: { createdAt: true, severity: true, followupRequired: true, actionTaken: true },
          },
        },
      },
      observations: {
        orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { result: true },
      },
    },
  });

  if (!quarantineCase) return null;
  const openFollowupCount = quarantineCase.cage.healthNotes.filter((note) =>
    note.createdAt.getTime() >= quarantineCase.admittedAt.getTime()
    && note.actionTaken?.startsWith(QUARANTINE_HEALTH_NOTE_ACTION_PREFIX)
    && (note.followupRequired || note.severity === "warning" || note.severity === "critical")
  ).length;

  return {
    id: quarantineCase.id,
    labId: quarantineCase.labId,
    version: quarantineCase.version,
    status: quarantineCase.status,
    cageLabel: buildCageLabel(quarantineCase.cage),
    minimumReleaseAt: quarantineCase.minimumReleaseAt.toISOString(),
    latestObservationResult: quarantineCase.observations[0]?.result ?? null,
    openFollowupCount,
    occupants: quarantineCase.cage.animals.map((animal) => ({
      id: animal.id,
      animalId: animal.animalId,
      sex: animal.sex,
      strain: animal.strain.name,
    })),
  };
}
