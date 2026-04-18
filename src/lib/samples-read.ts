import { prisma } from "@/lib/prisma";
import type { SampleInventoryItem } from "@/lib/types";

function formatAnimalOptionLabel(animal: { animalId: string; labId: string; status: string }) {
  return `${animal.animalId} · ${animal.labId} · ${animal.status.replaceAll("_", " ")}`;
}

export async function getSamplePageOptions() {
  const [animals, projects] = await prisma.$transaction([
    prisma.animal.findMany({
      orderBy: [{ animalId: "asc" }],
      select: {
        id: true,
        animalId: true,
        labId: true,
        status: true,
      },
    }),
    prisma.project.findMany({
      orderBy: { projectCode: "asc" },
      select: {
        id: true,
        projectCode: true,
        title: true,
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
  };
}

export async function getSampleInventoryView(): Promise<SampleInventoryItem[]> {
  const records = await prisma.sampleRecord.findMany({
    orderBy: [{ collectedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      sampleLabel: true,
      sampleType: true,
      status: true,
      collectedAt: true,
      storageLocation: true,
      quantityLabel: true,
      notes: true,
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
        },
      },
    },
  });

  return records.map((record) => ({
    id: record.id,
    sampleLabel: record.sampleLabel,
    sampleType: record.sampleType,
    status: record.status,
    collectedAt: record.collectedAt.toISOString(),
    animalId: record.animal.id,
    animalCode: record.animal.animalId,
    labId: record.animal.labId,
    projectCode: record.project?.projectCode ?? null,
    storageLocation: record.storageLocation ?? null,
    quantityLabel: record.quantityLabel ?? null,
    notes: record.notes ?? null,
  }));
}
