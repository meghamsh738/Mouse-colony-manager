import { resolveEffectiveCageCapacity, resolveRecommendedCageOccupancy } from "@/lib/cage-capacity";
import type { CageDraft, Sex } from "@/lib/types";

export type CagePlannerSubject = {
  id: string;
  sex: Sex;
  strainId: string;
};

export type CagePlannerInput = {
  subjects: CagePlannerSubject[];
  labId: string;
  roomId: string;
  rackId: string;
  startDate: string;
  status: CageDraft["status"];
  chargeCategoryId?: string;
  facilityLimit?: number | null;
  existingCageNumbers: string[];
};

export type CagePlannerResult = {
  cages: CageDraft[];
  assignments: Record<string, string>;
  hardLimit: number;
  planningTarget: number;
};

function sexOrder(sex: Sex) {
  return sex === "female" ? 0 : sex === "male" ? 1 : 2;
}

function highestNumericCageNumber(values: string[]) {
  return values.reduce((highest, value) => {
    const number = Number(value.trim());
    return Number.isInteger(number) && number >= 0 ? Math.max(highest, number) : highest;
  }, 0);
}

export function planCageAssignments(input: CagePlannerInput): CagePlannerResult {
  const hardLimit = resolveEffectiveCageCapacity(input.facilityLimit);
  const planningTarget = resolveRecommendedCageOccupancy(hardLimit);
  const orderedSubjects = [...input.subjects].sort(
    (left, right) =>
      sexOrder(left.sex) - sexOrder(right.sex)
      || left.strainId.localeCompare(right.strainId)
      || left.id.localeCompare(right.id),
  );
  const groups = new Map<string, CagePlannerSubject[]>();

  for (const subject of orderedSubjects) {
    const key = `${subject.sex}\u0000${subject.strainId}`;
    groups.set(key, [...(groups.get(key) ?? []), subject]);
  }
  if (!orderedSubjects.length) groups.set("empty", []);

  const cages: CageDraft[] = [];
  const assignments: Record<string, string> = {};
  const firstCageNumber = highestNumericCageNumber(input.existingCageNumbers) + 1;

  for (const group of groups.values()) {
    const chunks = group.length
      ? Array.from({ length: Math.ceil(group.length / planningTarget) }, (_, index) =>
          group.slice(index * planningTarget, (index + 1) * planningTarget),
        )
      : [[]];

    for (const chunk of chunks) {
      const index = cages.length + 1;
      const clientId = `cage-${String(index).padStart(3, "0")}`;
      cages.push({
        clientId,
        labId: input.labId,
        roomId: input.roomId,
        rackId: input.rackId,
        cageNumber: String(firstCageNumber + index - 1).padStart(3, "0"),
        status: input.status,
        chargeCategoryId: input.chargeCategoryId,
        startDate: input.startDate,
      });
      for (const subject of chunk) assignments[subject.id] = `new:${clientId}`;
    }
  }

  return { cages, assignments, hardLimit, planningTarget };
}
