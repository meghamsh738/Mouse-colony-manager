import { differenceInDays } from "date-fns";

import { prisma } from "@/lib/prisma";

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

export async function getQuarantineSentinelView() {
  const rules = await getQuarantineRuleContext();
  const cages = await prisma.cage.findMany({
    where: {
      status: "quarantine",
    },
    orderBy: [{ room: { roomNumber: "asc" } }, { rack: { rackNumber: "asc" } }, { cageNumber: "asc" }],
    include: {
      room: { select: { roomNumber: true } },
      rack: { select: { rackNumber: true } },
      animals: {
        where: { outcomeStatus: "alive" },
        orderBy: { animalId: "asc" },
        include: {
          strain: { select: { name: true } },
        },
      },
      healthNotes: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          noteType: true,
          severity: true,
          note: true,
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
    },
  });
  const today = new Date(rules.today);

  const quarantineCages = cages.map((cage) => {
    const latestNote = cage.healthNotes[0] ?? null;
    const unresolvedNotes = cage.healthNotes.filter((note) => !note.resolved || note.followupRequired);
    const criticalNotes = unresolvedNotes.filter((note) => note.severity === "critical");
    const daysSinceLastCheck = latestNote ? differenceInDays(today, latestNote.createdAt) : null;
    const sentinelDue = daysSinceLastCheck === null || daysSinceLastCheck >= rules.sentinelCheckIntervalDays;
    const daysInQuarantine = differenceInDays(today, cage.lastUpdatedAt);
    const reviewDue = daysInQuarantine >= rules.quarantineReviewDays;
    const welfareFlags = Array.isArray(cage.welfareFlags) ? cage.welfareFlags.map((flag) => String(flag)) : [];

    return {
      id: cage.id,
      barcode: cage.barcode,
      label: buildCageLabel(cage),
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
