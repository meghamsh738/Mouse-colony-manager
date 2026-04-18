import { prisma } from "@/lib/prisma";
import type { CryostorageInventoryItem } from "@/lib/types";

export async function getCryostoragePageOptions() {
  const [strains, projects] = await prisma.$transaction([
    prisma.strain.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
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
    strainOptions: strains.map((strain) => ({
      id: strain.id,
      label: strain.name,
    })),
    projectOptions: projects.map((project) => ({
      id: project.id,
      label: `${project.projectCode} · ${project.title}`,
    })),
  };
}

export async function getCryostorageInventoryView(): Promise<CryostorageInventoryItem[]> {
  const records = await prisma.cryostorageRecord.findMany({
    orderBy: [{ storedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      sampleLabel: true,
      materialType: true,
      status: true,
      storedAt: true,
      storageLocation: true,
      quantityLabel: true,
      recoveryNotes: true,
      notes: true,
      strain: {
        select: {
          id: true,
          name: true,
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
    materialType: record.materialType,
    status: record.status,
    storedAt: record.storedAt.toISOString(),
    strainId: record.strain.id,
    strainName: record.strain.name,
    projectCode: record.project?.projectCode ?? null,
    storageLocation: record.storageLocation ?? null,
    quantityLabel: record.quantityLabel ?? null,
    recoveryNotes: record.recoveryNotes ?? null,
    notes: record.notes ?? null,
  }));
}
