import { prisma } from "@/lib/prisma";
import { getActorReadLabAccess, type LabActor } from "@/lib/lab-access";
import type { CryostorageInventoryItem, CryostorageRequestItem } from "@/lib/types";

export async function getCryostoragePageOptions(actor: LabActor) {
  const access = await getActorReadLabAccess(actor);
  const [labs, strains, projects] = await prisma.$transaction([
    prisma.lab.findMany({
      where: {
        active: true,
        ...(access.canViewAll ? {} : { id: { in: access.manageableLabIds } }),
      },
      orderBy: [{ name: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    prisma.strain.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.project.findMany({
      where: access.canViewAll ? {} : { labId: { in: access.memberLabIds } },
      orderBy: { projectCode: "asc" },
      select: {
        id: true,
        labId: true,
        projectCode: true,
        title: true,
      },
    }),
  ]);

  return {
    labOptions: labs.map((lab) => ({ id: lab.id, label: `${lab.code} · ${lab.name}` })),
    strainOptions: strains.map((strain) => ({
      id: strain.id,
      label: strain.name,
    })),
    projectOptions: projects.map((project) => ({
      id: project.id,
      labId: project.labId,
      label: `${project.projectCode} · ${project.title}`,
    })),
  };
}

export async function getCryostorageInventoryView(actor: LabActor): Promise<CryostorageInventoryItem[]> {
  const access = await getActorReadLabAccess(actor);
  const records = await prisma.cryostorageRecord.findMany({
    where: access.canViewAll ? {} : { labId: { in: access.memberLabIds } },
    orderBy: [{ storedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      labId: true,
      lab: { select: { code: true, name: true } },
      sampleLabel: true,
      materialType: true,
      status: true,
      storedAt: true,
      storageLocation: true,
      quantityLabel: true,
      recoveryNotes: true,
      notes: true,
      version: true,
      strain: {
        select: {
          id: true,
          name: true,
        },
      },
      project: {
        select: {
          projectCode: true,
          labId: true,
        },
      },
    },
  });

  return records
    .filter((record) => !record.project || record.labId === record.project.labId)
    .map((record) => ({
    id: record.id,
    labId: record.labId,
    labLabel: `${record.lab.code} · ${record.lab.name}`,
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
    version: record.version,
    }));
}

export async function getCryostorageRequestView(actor: LabActor): Promise<CryostorageRequestItem[]> {
  const access = await getActorReadLabAccess(actor);
  const requests = await prisma.cryostorageRequest.findMany({
    where: access.canViewAll ? {} : { labId: { in: access.memberLabIds } },
    orderBy: [{ status: "asc" }, { requestedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      labId: true,
      requestType: true,
      status: true,
      version: true,
      requestedFor: true,
      requestedAt: true,
      requestedById: true,
      targetRecordId: true,
      targetRecordVersion: true,
      sampleLabel: true,
      materialType: true,
      requestedQuantityLabel: true,
      requestedStorageLocation: true,
      notes: true,
      decidedAt: true,
      decisionReason: true,
      lab: { select: { code: true, name: true } },
      requestedBy: { select: { name: true, email: true } },
      decidedBy: { select: { name: true, email: true } },
      strain: { select: { name: true } },
      project: { select: { projectCode: true, labId: true } },
      targetRecord: { select: { sampleLabel: true, status: true, labId: true } },
      operation: {
        select: {
          recordId: true,
          previousStatus: true,
          resultingStatus: true,
          performedAt: true,
          storageLocation: true,
          quantityLabel: true,
          notes: true,
        },
      },
    },
  });

  return requests
    .filter((request) => (
      (!request.project || request.project.labId === request.labId)
      && (!request.targetRecord || request.targetRecord.labId === request.labId)
    ))
    .map((request) => ({
      id: request.id,
      labId: request.labId,
      labLabel: `${request.lab.code} · ${request.lab.name}`,
      requestType: request.requestType,
      status: request.status,
      version: request.version,
      requestedFor: request.requestedFor.toISOString(),
      requestedAt: request.requestedAt.toISOString(),
      requestedById: request.requestedById,
      requestedByLabel: request.requestedBy.name || request.requestedBy.email,
      targetRecordId: request.targetRecordId,
      targetRecordVersion: request.targetRecordVersion,
      targetRecordLabel: request.targetRecord?.sampleLabel ?? null,
      targetRecordStatus: request.targetRecord?.status ?? null,
      strainName: request.strain?.name ?? null,
      projectCode: request.project?.projectCode ?? null,
      sampleLabel: request.sampleLabel,
      materialType: request.materialType,
      requestedQuantityLabel: request.requestedQuantityLabel,
      requestedStorageLocation: request.requestedStorageLocation,
      notes: request.notes,
      decidedAt: request.decidedAt?.toISOString() ?? null,
      decidedByLabel: request.decidedBy ? request.decidedBy.name || request.decidedBy.email : null,
      decisionReason: request.decisionReason,
      operation: request.operation
        ? {
            ...request.operation,
            performedAt: request.operation.performedAt.toISOString(),
          }
        : null,
    }));
}
