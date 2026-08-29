import { addDays, differenceInDays } from "date-fns";
import type { Prisma } from "@prisma/client";

import { getCageCapacityState } from "@/lib/cage-capacity";
import { parseCageIntakeDraftPayload } from "@/lib/cage-intake-draft";
import { getWorkflowDraftForActor } from "@/lib/command-foundation";
import { getActorLabAccess, type LabActor } from "@/lib/lab-access";
import { prisma } from "@/lib/prisma";
import type { CageIntakeOptionsView } from "@/lib/types";
import type { ResolvedActor } from "@/lib/session";

function getReferenceDate() {
  return new Date(process.env.COLONY_REFERENCE_DATE ?? new Date().toISOString());
}

export async function getCageIntakeDraftView(actor: ResolvedActor, draftId: string) {
  const result = await getWorkflowDraftForActor({
    actor,
    draftId,
    workflowTypePrefix: "cage_intake.",
    requiredCapability: "cages:manage",
  });
  if (!result.ok) return null;
  const payload = parseCageIntakeDraftPayload(result.draft.payload);
  if (!payload.success || result.draft.workflowType !== `cage_intake.${payload.data.mode}`) return null;
  return { id: result.draft.id, version: result.draft.version, payload: payload.data };
}

export async function getCageIntakeOptionsView(
  actor: LabActor,
  litterId?: string,
): Promise<CageIntakeOptionsView> {
  const access = await getActorLabAccess(actor);
  const labWhere = access.canViewAll
    ? { active: true }
    : { active: true, id: { in: access.manageableLabIds } };
  const cageWhere: Prisma.CageWhereInput = {
    active: true,
    status: { notIn: ["closed", "retired"] },
    ...(access.canViewAll ? {} : { labId: { in: access.manageableLabIds } }),
  };
  const litterWhere: Prisma.LitterWhereInput = {
    id: litterId ?? "__no_litter__",
    ...(access.canViewAll
      ? {}
      : {
          breedingSetup: {
            labId: { in: access.manageableLabIds },
          },
        }),
  };

  const [labs, facilities, rooms, racks, strains, chargeCategories, cages, animals, protocols] =
    await prisma.$transaction([
      prisma.lab.findMany({
        where: labWhere,
        orderBy: { name: "asc" },
        select: { id: true, name: true, code: true },
      }),
      prisma.facility.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, cageBarcodePrefix: true, maxCageOccupancy: true },
      }),
      prisma.room.findMany({
        orderBy: [{ facility: { name: "asc" } }, { roomNumber: "asc" }],
        select: { id: true, facilityId: true, roomNumber: true },
      }),
      prisma.rack.findMany({
        orderBy: [{ room: { roomNumber: "asc" } }, { rackNumber: "asc" }],
        select: { id: true, roomId: true, rackNumber: true },
      }),
      prisma.strain.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.cageChargeCategory.findMany({
        where: { active: true },
        orderBy: [{ code: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          code: true,
          dailyRateCents: true,
          currencyCode: true,
          active: true,
        },
      }),
      prisma.cage.findMany({
        where: cageWhere,
        orderBy: [{ room: { roomNumber: "asc" } }, { rack: { rackNumber: "asc" } }, { cageNumber: "asc" }],
        select: {
          id: true,
          barcode: true,
          labId: true,
          status: true,
          capacityOverride: true,
          cageNumber: true,
          room: {
            select: {
              roomNumber: true,
              facility: { select: { maxCageOccupancy: true } },
            },
          },
          rack: { select: { rackNumber: true } },
          animals: {
            where: { outcomeStatus: "alive" },
            select: { sex: true, strain: { select: { name: true } } },
          },
        },
      }),
      prisma.animal.findMany({
        where: {
          outcomeStatus: "alive",
          currentCageId: { not: null },
          ...(access.canViewAll ? {} : { owningLabId: { in: access.manageableLabIds } }),
        },
        orderBy: { animalId: "asc" },
        select: {
          id: true,
          animalId: true,
          labId: true,
          owningLabId: true,
          sex: true,
          strain: { select: { name: true } },
          currentCage: { select: { id: true, barcode: true, labId: true } },
        },
      }),
      prisma.protocolAuthorization.findMany({
        where: {
          status: "active",
          ...(access.canViewAll ? {} : { labId: { in: access.manageableLabIds } }),
          currentVersion: {
            validFrom: { lte: new Date() },
            validUntil: { gt: new Date() },
            procedureBindings: { some: { procedureCode: "intake" } },
            personnelBindings: { some: { userId: actor.id, roleLabel: "intake_operator" } },
          },
        },
        orderBy: [{ labId: "asc" }, { protocolCode: "asc" }],
        select: {
          id: true,
          labId: true,
          protocolCode: true,
          title: true,
          currentVersion: {
            select: {
              validUntil: true,
              strainBindings: { select: { strainId: true } },
            },
          },
        },
        take: 500,
      }),
    ]);
  const [litter, weaningRule] = await prisma.$transaction([
      prisma.litter.findFirst({
        where: litterWhere,
        select: {
          id: true,
          version: true,
          birthDate: true,
          litterSizeBirth: true,
          litterSizeWean: true,
          _count: { select: { litterAnimals: true } },
        },
      }),
      prisma.ruleConfig.findUnique({
        where: { key: "weaning_due_days" },
        select: { value: true },
      }),
    ]);

  const referenceDate = getReferenceDate();
  const weaningDueDays = Number(weaningRule?.value ?? 21) || 21;

  return {
    labs,
    protocols: protocols.map((protocol) => ({
      id: protocol.id,
      labId: protocol.labId,
      label: `${protocol.protocolCode} — ${protocol.title}`,
      validUntil: protocol.currentVersion!.validUntil.toISOString(),
      strainIds: protocol.currentVersion!.strainBindings.map((binding) => binding.strainId),
    })),
    facilities: facilities.map((facility) => ({
      id: facility.id,
      name: facility.name,
      barcodePrefix: facility.cageBarcodePrefix,
      maxCageOccupancy: facility.maxCageOccupancy,
    })),
    rooms,
    racks,
    strains,
    chargeCategories,
    existingCages: cages.flatMap((cage) => {
      if (!cage.labId) {
        return [];
      }

      const capacity = getCageCapacityState({
        facilityLimit: cage.room.facility.maxCageOccupancy,
        cageOverride: cage.capacityOverride,
        occupantCount: cage.animals.length,
      });
      const sexCounts = cage.animals.reduce<Record<string, number>>((counts, animal) => {
        counts[animal.sex] = (counts[animal.sex] ?? 0) + 1;
        return counts;
      }, {});

      return [
        {
          id: cage.id,
          barcode: cage.barcode,
          label: `${cage.room.roomNumber} / ${cage.rack.rackNumber} / ${cage.cageNumber}`,
          labId: cage.labId,
          status: cage.status,
          occupantCount: cage.animals.length,
          capacity: capacity.effectiveLimit,
          remainingCapacity: capacity.remainingCapacity,
          sexComposition: cage.animals.length
            ? Object.entries(sexCounts)
                .map(([sex, count]) => `${count}${sex === "male" ? "M" : sex === "female" ? "F" : "U"}`)
                .join(" / ")
            : "Empty",
          strainSummary: Array.from(new Set(cage.animals.map((animal) => animal.strain.name))).join(", ") || "Empty",
        },
      ];
    }),
    movableAnimals: animals.flatMap((animal) =>
      animal.currentCage && animal.currentCage.labId === animal.owningLabId
        ? [
            {
              id: animal.id,
              animalId: animal.animalId,
              labId: animal.labId,
              owningLabId: animal.owningLabId,
              sex: animal.sex,
              strain: animal.strain.name,
              currentCageId: animal.currentCage.id,
              currentCageBarcode: animal.currentCage.barcode,
            },
          ]
        : [],
    ),
    litter: litter
      ? {
          id: litter.id,
          version: litter.version,
          birthDate: litter.birthDate.toISOString(),
          litterSizeBirth: litter.litterSizeBirth,
          daysOld: differenceInDays(referenceDate, litter.birthDate),
          weaningDueDays,
          suggestedWeanDate: addDays(litter.birthDate, weaningDueDays).toISOString().slice(0, 10),
          alreadyWeaned: litter.litterSizeWean !== null || litter._count.litterAnimals > 0,
        }
      : null,
  };
}
