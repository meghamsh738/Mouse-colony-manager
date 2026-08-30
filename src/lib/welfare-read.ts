import { actorHasCapability } from "@/lib/capabilities";
import { getActiveFacilityDutiesAtDatabaseTime } from "@/lib/facility-duty-auth";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";
import { WELFARE_POLICY_MARKER } from "@/lib/welfare-state-machine";

export async function getWelfareWorkspace(actor: ResolvedActor) {
  if (!actorHasCapability(actor, "welfare:read")) {
    return { access: "none" as const, policyMarker: WELFARE_POLICY_MARKER, cases: [], animalOptions: [], cageOptions: [] };
  }
  const activeDuties = await getActiveFacilityDutiesAtDatabaseTime(prisma, actor.id);
  const isVeterinarian = activeDuties.includes("designated_veterinarian");
  const isWelfareOfficer = activeDuties.includes("welfare_officer");
  if (!isVeterinarian && !isWelfareOfficer) {
    return { access: "none" as const, policyMarker: WELFARE_POLICY_MARKER, cases: [], animalOptions: [], cageOptions: [] };
  }

  const subjectQueries = Promise.all([
    prisma.animal.findMany({
      where: { outcomeStatus: "alive", owningLab: { active: true } },
      orderBy: [{ owningLab: { name: "asc" } }, { facilityAnimalId: "asc" }],
      select: { id: true, facilityAnimalId: true, version: true, owningLab: { select: { id: true, name: true, code: true } } },
    }),
    prisma.cage.findMany({
      where: { active: true, lab: { active: true } },
      orderBy: [{ lab: { name: "asc" } }, { barcode: "asc" }],
      select: { id: true, barcode: true, version: true, lab: { select: { id: true, name: true, code: true } } },
    }),
  ]);

  if (!isVeterinarian) {
    const [cases, [animalOptions, cageOptions]] = await Promise.all([
      prisma.welfareCase.findMany({
        orderBy: [{ status: "asc" }, { severity: "desc" }, { openedAt: "desc" }],
        select: {
          id: true, labId: true, subjectType: true, status: true, severity: true, operationalSummary: true,
          policyMarker: true, openedAt: true, version: true,
          lab: { select: { name: true, code: true } },
          animal: { select: { facilityAnimalId: true } },
          cage: { select: { barcode: true } },
          observations: { orderBy: { observedAt: "desc" }, select: { id: true, observedAt: true, severity: true, operationalCode: true } },
          escalations: { orderBy: { openedAt: "desc" }, select: { id: true, severity: true, status: true, operationalCode: true, openedAt: true, version: true } },
        },
      }),
      subjectQueries,
    ]);
    return { access: "welfare_officer" as const, policyMarker: WELFARE_POLICY_MARKER, cases, animalOptions, cageOptions };
  }

  const [cases, [animalOptions, cageOptions]] = await Promise.all([
    prisma.welfareCase.findMany({
      orderBy: [{ status: "asc" }, { severity: "desc" }, { openedAt: "desc" }],
      include: {
        lab: { select: { name: true, code: true } },
        animal: { select: { facilityAnimalId: true } },
        cage: { select: { barcode: true } },
        observations: { orderBy: { observedAt: "desc" } },
        treatmentOrders: { orderBy: { proposedAt: "desc" }, include: { administrationAttempts: { orderBy: { administeredAt: "desc" } } } },
        escalations: { orderBy: { openedAt: "desc" } },
        lifecycleEvents: { orderBy: { occurredAt: "desc" }, take: 50, select: { id: true, eventType: true, fromStatus: true, toStatus: true, occurredAt: true } },
      },
    }),
    subjectQueries,
  ]);
  return { access: "designated_veterinarian" as const, policyMarker: WELFARE_POLICY_MARKER, cases, animalOptions, cageOptions };
}
