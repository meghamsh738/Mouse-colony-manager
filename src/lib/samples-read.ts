import { prisma } from "@/lib/prisma";
import { getActorLabAccess, type LabActor } from "@/lib/lab-access";
import type { SampleInventoryItem } from "@/lib/types";

function formatAnimalOptionLabel(animal: { animalId: string; labId: string; status: string }) {
  return `${animal.animalId} · ${animal.labId} · ${animal.status.replaceAll("_", " ")}`;
}

export async function getSamplePageOptions(actor: LabActor) {
  const access = await getActorLabAccess(actor);
  const labWhere = access.canViewAll ? {} : { labId: { in: access.memberLabIds } };
  const animalWhere = access.canViewAll ? {} : { owningLabId: { in: access.memberLabIds } };
  const [animals, projects, experiments] = await prisma.$transaction([
    prisma.animal.findMany({
      where: animalWhere,
      orderBy: [{ animalId: "asc" }],
      select: {
        id: true,
        animalId: true,
        labId: true,
        status: true,
      },
    }),
    prisma.project.findMany({
      where: labWhere,
      orderBy: { projectCode: "asc" },
      select: {
        id: true,
        projectCode: true,
        title: true,
      },
    }),
    prisma.experiment.findMany({
      where: labWhere,
      orderBy: { experimentCode: "asc" },
      select: {
        id: true,
        experimentCode: true,
        title: true,
        projectId: true,
        status: true,
      },
    }),
  ]);

  return {
    animalOptions: animals.map((animal) => ({
      id: animal.id,
      label: formatAnimalOptionLabel(animal),
    })),
    projectOptions: projects.map((project) => ({
      id: project.id,
      label: `${project.projectCode} · ${project.title}`,
    })),
    experimentOptions: experiments.map((experiment) => ({
      id: experiment.id,
      label: `${experiment.experimentCode} · ${experiment.title}`,
      projectId: experiment.projectId,
      status: experiment.status,
    })),
    activeExperimentOptions: experiments
      .filter((experiment) => experiment.status === "planned" || experiment.status === "active")
      .map((experiment) => ({
        id: experiment.id,
        label: `${experiment.experimentCode} · ${experiment.title}`,
        projectId: experiment.projectId,
        status: experiment.status,
      })),
  };
}

export async function getSampleInventoryView(actor: LabActor): Promise<SampleInventoryItem[]> {
  const access = await getActorLabAccess(actor);
  const records = await prisma.sampleRecord.findMany({
    where: access.canViewAll ? {} : { labId: { in: access.memberLabIds } },
    orderBy: [{ collectedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      labId: true,
      sampleLabel: true,
      sampleType: true,
      status: true,
      collectedAt: true,
      storageLocation: true,
      quantityLabel: true,
      notes: true,
      version: true,
      animal: {
        select: {
          id: true,
          animalId: true,
          labId: true,
        },
      },
      project: {
        select: {
          projectCode: true,
          labId: true,
        },
      },
      experiment: {
        select: {
          id: true,
          experimentCode: true,
          labId: true,
        },
      },
    },
  });

  return records
    .filter(
      (record) =>
        (!record.project || record.labId === record.project.labId) &&
        (!record.experiment || record.labId === record.experiment.labId),
    )
    .map((record) => ({
    id: record.id,
    sampleLabel: record.sampleLabel,
    sampleType: record.sampleType,
    status: record.status,
    collectedAt: record.collectedAt.toISOString(),
    animalId: record.animal.id,
    animalCode: record.animal.animalId,
    animalLabCode: record.animal.labId,
    labId: record.labId,
    projectCode: record.project?.projectCode ?? null,
    experimentId: record.experiment?.id ?? null,
    experimentCode: record.experiment?.experimentCode ?? null,
    storageLocation: record.storageLocation ?? null,
    quantityLabel: record.quantityLabel ?? null,
    notes: record.notes ?? null,
    version: record.version,
    }));
}
