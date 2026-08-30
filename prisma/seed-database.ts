import { Prisma } from "@prisma/client";

import { clearStoredAttachments } from "../src/lib/attachment-storage";
import { assertDestructiveSeedAllowed } from "../src/lib/destructive-seed-guard";
import { seedColonyData } from "./seed-data";
import { seedDemoComplianceFixture } from "./seed-demo-compliance";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";

const asDate = (value?: string) => (value ? new Date(value) : undefined);

export function requireExplicitSeedLabId(
  value: string | null | undefined,
  entityType: string,
  entityId: string,
  knownLabIds: ReadonlySet<string>,
) {
  if (!value) {
    throw new Error(`Seed ${entityType} ${entityId} is missing explicit lab ownership.`);
  }
  if (!knownLabIds.has(value)) {
    throw new Error(`Seed ${entityType} ${entityId} references unknown lab ${value}.`);
  }
  return value;
}

function requireSeedReference<T>(value: T | undefined, description: string): T {
  if (value === undefined) {
    throw new Error(`Seed ownership cannot be resolved: ${description}.`);
  }
  return value;
}

export async function seedDatabase(options: { clearAttachments?: boolean } = {}) {
  assertDestructiveSeedAllowed();

  const knownLabIds = new Set(seedColonyData.labs.map((lab) => lab.id));
  const animalLabById = new Map(seedColonyData.animals.map((animal) => [
    animal.id,
    requireExplicitSeedLabId(animal.owningLabId, "animal", animal.id, knownLabIds),
  ]));
  const cageLabById = new Map(seedColonyData.cages.map((cage) => [
    cage.id,
    requireExplicitSeedLabId(cage.labId, "cage", cage.id, knownLabIds),
  ]));
  const projectLabById = new Map([
    ["project-micro", "lab-microglia"],
    ["project-neuro", "lab-neuroimmune"],
  ]);
  const experimentLabById = new Map(
    seedColonyData.experiments.map((experiment) => [
      experiment.id,
      requireSeedReference(projectLabById.get(experiment.projectId), `experiment ${experiment.id} has no owned project`),
    ]),
  );
  const breedingLabById = new Map(seedColonyData.breedingSetups.map((setup) => {
    const adult = seedColonyData.breedingAdults.find((candidate) => candidate.breedingSetupId === setup.id);
    const animalId = requireSeedReference(adult?.animalId, `breeding setup ${setup.id} has no adult`);
    return [setup.id, requireSeedReference(animalLabById.get(animalId), `breeding setup ${setup.id} adult ${animalId} has no owner`)];
  }));
  const litterLabById = new Map(
    seedColonyData.litters.map((litter) => [litter.id, breedingLabById.get(litter.breedingSetupId)!]),
  );
  const genotypeLabById = new Map(
    seedColonyData.genotypingRecords.map((record) => [record.id, animalLabById.get(record.animalId)!]),
  );
  const healthNoteLabById = new Map(seedColonyData.healthNotes.map((note) => [
    note.id,
    (note.animalId ? animalLabById.get(note.animalId) : note.cageId ? cageLabById.get(note.cageId) : null)!,
  ]));

  for (const animal of seedColonyData.animals) {
    if (animal.currentCageId && animalLabById.get(animal.id) !== cageLabById.get(animal.currentCageId)) {
      throw new Error(`Seed animal ${animal.id} and current cage ${animal.currentCageId} belong to different labs.`);
    }
    if (animal.intakeBatchId) {
      const batch = requireSeedReference(
        seedColonyData.animalIntakeBatches.find((candidate) => candidate.id === animal.intakeBatchId),
        `animal ${animal.id} references an unknown intake batch`,
      );
      if (batch.labId !== animalLabById.get(animal.id)) {
        throw new Error(`Seed animal ${animal.id} and intake batch ${batch.id} belong to different labs.`);
      }
    }
  }

  for (const adult of seedColonyData.breedingAdults) {
    if (breedingLabById.get(adult.breedingSetupId) !== animalLabById.get(adult.animalId)) {
      throw new Error(`Seed breeding adult ${adult.id} crosses lab ownership.`);
    }
  }

  for (const allocation of seedColonyData.projectAllocations) {
    if (animalLabById.get(allocation.animalId) !== projectLabById.get(allocation.projectId)) {
      throw new Error(`Seed project allocation ${allocation.id} crosses lab ownership.`);
    }
  }

  for (const assignment of seedColonyData.experimentAssignments) {
    if (animalLabById.get(assignment.animalId) !== experimentLabById.get(assignment.experimentId)) {
      throw new Error(`Seed experiment assignment ${assignment.id} crosses lab ownership.`);
    }
  }

  for (const record of seedColonyData.sampleRecords) {
    const recordLabId = animalLabById.get(record.animalId);
    if (!recordLabId || (record.projectId && projectLabById.get(record.projectId) !== recordLabId)) {
      throw new Error(`Seed sample record ${record.id} crosses lab ownership.`);
    }
  }

  for (const record of seedColonyData.cryostorageRecords) {
    if (!record.projectId || !projectLabById.has(record.projectId)) {
      throw new Error(`Seed cryostorage record ${record.id} has no owned project.`);
    }
  }

  for (const note of seedColonyData.healthNotes) {
    const noteLabId = healthNoteLabById.get(note.id);
    if (
      !noteLabId ||
      (note.animalId && animalLabById.get(note.animalId) !== noteLabId) ||
      (note.cageId && cageLabById.get(note.cageId) !== noteLabId)
    ) {
      throw new Error(`Seed health note ${note.id} crosses lab ownership.`);
    }
  }

  for (const link of seedColonyData.litterAnimals) {
    if (litterLabById.get(link.litterId) !== animalLabById.get(link.animalId)) {
      throw new Error(`Seed litter animal ${link.id} crosses lab ownership.`);
    }
  }

  for (const attachment of seedColonyData.attachments) {
    const linkedLabIds = [
      attachment.animalId ? animalLabById.get(attachment.animalId) : undefined,
      attachment.cageId ? cageLabById.get(attachment.cageId) : undefined,
      attachment.healthNoteId ? healthNoteLabById.get(attachment.healthNoteId) : undefined,
      attachment.genotypingRecordId ? genotypeLabById.get(attachment.genotypingRecordId) : undefined,
    ].filter((labId): labId is string => Boolean(labId));
    if (linkedLabIds.length === 0 || new Set(linkedLabIds).size !== 1) {
      throw new Error(`Seed attachment ${attachment.id} crosses lab ownership or has no owned parent.`);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
    await tx.sopDocument.updateMany({ data: { currentVersionId: null } });
    await tx.$executeRawUnsafe('DELETE FROM "ComplianceEvidenceSnapshot"');
    await tx.$executeRawUnsafe('DELETE FROM "ProtocolCountAllocationHistory"');
    await tx.$executeRawUnsafe('DELETE FROM "ProtocolCountAllocation"');
    await tx.$executeRawUnsafe('DELETE FROM "ProtocolCountLedger"');
    await tx.$executeRawUnsafe('DELETE FROM "CompetencyLifecycleEvent"');
    await tx.$executeRawUnsafe('DELETE FROM "CompetencyEvidenceVersion"');
    await tx.$executeRawUnsafe('DELETE FROM "CompetencyEvidence"');
    await tx.$executeRawUnsafe('DELETE FROM "ProtocolAuthorizationLifecycleEvent"');
    await tx.$executeRawUnsafe('DELETE FROM "ProtocolPersonnelBinding"');
    await tx.$executeRawUnsafe('DELETE FROM "ProtocolProcedureBinding"');
    await tx.$executeRawUnsafe('DELETE FROM "ProtocolStrainBinding"');
    await tx.$executeRawUnsafe('DELETE FROM "ProtocolExperimentBinding"');
    await tx.$executeRawUnsafe('DELETE FROM "ProtocolProjectBinding"');
    await tx.$executeRawUnsafe('DELETE FROM "ProtocolAuthorizationVersion"');
    await tx.$executeRawUnsafe('DELETE FROM "ProtocolAuthorization"');
    await tx.$executeRawUnsafe('DELETE FROM "TransferCustodyReconciliation"');
    await tx.$executeRawUnsafe('DELETE FROM "TransferCustodyItemEvidence"');
    await tx.$executeRawUnsafe('DELETE FROM "TransferCustodyExpectedItem"');
    await tx.$executeRawUnsafe('DELETE FROM "TransferCustodyEvent"');
    await tx.$executeRawUnsafe('DELETE FROM "CageCapacityException"');
    await tx.$executeRawUnsafe('DELETE FROM "CensusDiscrepancy"');
    await tx.$executeRawUnsafe('DELETE FROM "CensusObservation"');
    await tx.$executeRawUnsafe('DELETE FROM "CensusSession"');
    await tx.$executeRawUnsafe('DELETE FROM "ShipmentReconciliationSummary"');
    await tx.$executeRawUnsafe('DELETE FROM "ShipmentHealthEvidence"');
    await tx.$executeRawUnsafe('DELETE FROM "ShipmentReceiptObservation"');
    await tx.$executeRawUnsafe('DELETE FROM "ShipmentReceiptSession"');
    await tx.$executeRawUnsafe('DELETE FROM "ShipmentManifestItem"');
    await tx.$executeRawUnsafe('DELETE FROM "OperationalReconciliationEvent"');
    await tx.$executeRawUnsafe('DELETE FROM "ShipmentManifest"');
    await tx.$executeRawUnsafe('DELETE FROM "CorrectionLifecycleEvent"');
    await tx.$executeRawUnsafe('DELETE FROM "CorrectionReconciliation"');
    await tx.$executeRawUnsafe('DELETE FROM "CorrectionSupersession"');
    await tx.$executeRawUnsafe('DELETE FROM "CorrectionRequest"');
    // Duty requests and assignments intentionally bind each other in both
    // directions. Clear the guarded disposable fixture atomically while FK
    // triggers are disabled, after assertDestructiveSeedAllowed has passed.
    await tx.$executeRawUnsafe('DELETE FROM "FacilityDutyLifecycleEvent"');
    await tx.$executeRawUnsafe('DELETE FROM "ExternalIdentityLifecycleEvent"');
    await tx.$executeRawUnsafe('DELETE FROM "FacilityDutyAssignment"');
    await tx.$executeRawUnsafe('DELETE FROM "FacilityDutyRequest"');
    await tx.$executeRawUnsafe('DELETE FROM "ExternalIdentityLink"');
    await tx.$executeRawUnsafe('DELETE FROM "AnimalStatusEvent"');
    await tx.$executeRawUnsafe('DELETE FROM "AuditLog"');
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
  });

  await prisma.$transaction([
    prisma.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'"),
    prisma.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'"),
    prisma.strainDirectoryRequestEvent.deleteMany(),
    prisma.strainDirectoryRequest.deleteMany(),
    prisma.strainDirectoryListing.deleteMany(),
    prisma.notificationDelivery.deleteMany(),
    prisma.outboxDeliveryAttempt.deleteMany(),
    prisma.outboxMessage.deleteMany(),
    prisma.procedureOccurrence.deleteMany(),
    prisma.procedurePlan.deleteMany(),
    prisma.cryostorageOperation.deleteMany(),
    prisma.cryostorageRequestEvent.deleteMany(),
    prisma.cryostorageRequest.deleteMany(),
    prisma.welfareCaseLifecycleEvent.deleteMany(),
    prisma.welfareAdministrationAttempt.deleteMany(),
    prisma.welfareEscalation.deleteMany(),
    prisma.welfareTreatmentOrder.deleteMany(),
    prisma.welfareObservation.deleteMany(),
    prisma.welfareCase.deleteMany(),
    prisma.correctionLifecycleEvent.deleteMany(),
    prisma.correctionReconciliation.deleteMany(),
    prisma.correctionSupersession.deleteMany(),
    prisma.correctionRequest.deleteMany(),
    prisma.commandReceipt.deleteMany(),
    prisma.sopAcknowledgement.deleteMany(),
    prisma.sopAssignment.deleteMany(),
    prisma.sopVersionApproval.deleteMany(),
    prisma.sopVersion.deleteMany(),
    prisma.sopDocument.deleteMany(),
    prisma.labTransferEvent.deleteMany(),
    prisma.labTransferPacket.deleteMany(),
    prisma.labTransferItem.deleteMany(),
    prisma.cageUserAssignment.deleteMany(),
    prisma.animalMovement.deleteMany(),
    prisma.animalLabTransfer.deleteMany(),
    prisma.cageLabTransfer.deleteMany(),
    prisma.labTransferRequest.deleteMany(),
    prisma.cageClosure.deleteMany(),
    prisma.workflowReviewSnapshot.deleteMany(),
    prisma.workflowDraft.deleteMany(),
    prisma.quarantineObservation.deleteMany(),
    prisma.quarantineCase.deleteMany(),
    prisma.ownershipException.deleteMany(),
    prisma.migrationRun.deleteMany(),
    prisma.privilegedRoleChangeRequest.deleteMany(),
    prisma.userInvitation.deleteMany(),
    prisma.notificationPreference.deleteMany(),
    prisma.notificationRecipient.deleteMany(),
    prisma.notificationAudience.deleteMany(),
    prisma.notificationEvent.deleteMany(),
    prisma.securityEvent.deleteMany(),
    prisma.alert.deleteMany(),
    prisma.ruleConfig.deleteMany(),
    prisma.invoiceAdjustment.deleteMany(),
    prisma.invoiceLineItem.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.cageChargePeriod.deleteMany(),
    prisma.cageChargeCategory.deleteMany(),
    prisma.cageMovement.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.healthNote.deleteMany(),
    prisma.experimentAssignment.deleteMany(),
    prisma.experiment.deleteMany(),
    prisma.animalProjectAllocation.deleteMany(),
    prisma.sampleRecord.deleteMany(),
    prisma.cryostorageRecord.deleteMany(),
    prisma.project.deleteMany(),
    prisma.litterAnimal.deleteMany(),
    prisma.litter.deleteMany(),
    prisma.breedingAdult.deleteMany(),
    prisma.breedingSetup.deleteMany(),
    prisma.genotypingRecord.deleteMany(),
    prisma.animalAllele.deleteMany(),
    prisma.animal.deleteMany(),
    prisma.legacyIdentifierAlias.deleteMany(),
    prisma.facilityIdentifierAssignment.deleteMany(),
    prisma.facilityIdentitySequence.deleteMany(),
    prisma.animalIntakeBatch.deleteMany(),
    prisma.allele.deleteMany(),
    prisma.strain.deleteMany(),
    prisma.cage.deleteMany(),
    prisma.labMembership.deleteMany(),
    prisma.lab.deleteMany(),
    prisma.rack.deleteMany(),
    prisma.room.deleteMany(),
    prisma.facility.deleteMany(),
    prisma.user.deleteMany(),
    prisma.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'"),
  ]);

  await prisma.user.createMany({
    data: seedColonyData.users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      passwordHash: hashPassword(user.password),
      role: user.role,
      active: user.active,
    })),
  });

  await prisma.lab.createMany({ data: seedColonyData.labs });
  await prisma.labMembership.createMany({ data: seedColonyData.labMemberships });
  await prisma.facility.createMany({ data: seedColonyData.facilities });
  await prisma.facilityIdentitySequence.createMany({
    data: [
      {
        entityType: "animal",
        nextValue: seedColonyData.animals.length + 1,
        minimumValue: 1,
        maximumValue: 9999,
        width: 4,
      },
      {
        entityType: "cage",
        nextValue: 1000 + seedColonyData.cages.length,
        minimumValue: 1000,
        maximumValue: 9999,
        width: 4,
      },
    ],
  });
  await prisma.room.createMany({ data: seedColonyData.rooms });
  await prisma.rack.createMany({ data: seedColonyData.racks });
  await prisma.cage.createMany({
    data: seedColonyData.cages.map((cage, index) => ({
      ...cage,
      facilityCageId: String(1000 + index).padStart(4, "0"),
      labId: requireExplicitSeedLabId(cage.labId, "cage", cage.id, knownLabIds),
      lastUpdatedAt: new Date(cage.lastUpdatedAt),
    })),
  });
  await prisma.strain.createMany({ data: seedColonyData.strains });
  await prisma.allele.createMany({ data: seedColonyData.alleles });
  if (seedColonyData.animalIntakeBatches.length > 0) {
    await prisma.animalIntakeBatch.createMany({
      data: seedColonyData.animalIntakeBatches.map((batch) => ({
        ...batch,
        arrivalDate: new Date(batch.arrivalDate),
        createdAt: asDate(batch.createdAt),
      })),
    });
  }
  await prisma.animal.createMany({
    data: seedColonyData.animals.map((animal, index) => ({
      ...animal,
      facilityAnimalId: String(index + 1).padStart(4, "0"),
      owningLabId: requireExplicitSeedLabId(animal.owningLabId, "animal", animal.id, knownLabIds),
      dob: new Date(animal.dob),
      deathDate: asDate(animal.deathDate),
    })),
  });
  await prisma.animalAllele.createMany({ data: seedColonyData.animalAlleles });
  await prisma.genotypingRecord.createMany({
    data: seedColonyData.genotypingRecords.map((record) => ({
      ...record,
      labId: genotypeLabById.get(record.id)!,
      sampleDate: new Date(record.sampleDate),
      resultDate: new Date(record.resultDate),
    })),
  });
  await prisma.breedingSetup.createMany({
    data: seedColonyData.breedingSetups.map((setup) => ({
      ...setup,
      labId: breedingLabById.get(setup.id)!,
      startDate: new Date(setup.startDate),
      endDate: asDate(setup.endDate),
    })),
  });
  await prisma.breedingAdult.createMany({ data: seedColonyData.breedingAdults });
  await prisma.litter.createMany({
    data: seedColonyData.litters.map((litter) => ({
      ...litter,
      birthDate: new Date(litter.birthDate),
    })),
  });
  await prisma.litterAnimal.createMany({ data: seedColonyData.litterAnimals });
  await prisma.project.createMany({
    data: seedColonyData.projects.map((project) => ({ ...project, labId: projectLabById.get(project.id)! })),
  });
  await prisma.animalProjectAllocation.createMany({
    data: seedColonyData.projectAllocations.map((allocation) => ({
      ...allocation,
      startedAt: new Date(allocation.startedAt),
      endedAt: asDate(allocation.endedAt),
    })),
  });
  await prisma.experiment.createMany({
    data: seedColonyData.experiments.map((experiment) => ({ ...experiment, labId: experimentLabById.get(experiment.id)! })),
  });
  await prisma.experimentAssignment.createMany({
    data: seedColonyData.experimentAssignments.map((assignment) => ({
      ...assignment,
      startDate: new Date(assignment.startDate),
      endDate: asDate(assignment.endDate),
    })),
  });
  await prisma.sampleRecord.createMany({
    data: seedColonyData.sampleRecords.map((record) => ({
      ...record,
      labId: animalLabById.get(record.animalId)!,
      collectedAt: new Date(record.collectedAt),
      createdAt: asDate(record.createdAt),
    })),
  });
  await prisma.cryostorageRecord.createMany({
    data: seedColonyData.cryostorageRecords.map((record) => ({
      ...record,
      labId: requireSeedReference(
        record.projectId ? projectLabById.get(record.projectId) : undefined,
        `cryostorage record ${record.id} has no owned project`,
      ),
      storedAt: new Date(record.storedAt),
      createdAt: asDate(record.createdAt),
    })),
  });
  await prisma.healthNote.createMany({
    data: seedColonyData.healthNotes.map((note) => ({
      ...note,
      labId: healthNoteLabById.get(note.id)!,
      createdAt: new Date(note.createdAt),
    })),
  });
  await prisma.attachment.createMany({
    data: seedColonyData.attachments.map((attachment) => ({
      ...attachment,
      labId: attachment.animalId
        ? animalLabById.get(attachment.animalId)!
        : attachment.cageId
          ? cageLabById.get(attachment.cageId)!
          : attachment.healthNoteId
            ? healthNoteLabById.get(attachment.healthNoteId)!
            : genotypeLabById.get(attachment.genotypingRecordId!)!,
    })),
  });
  await prisma.animalStatusEvent.createMany({
    data: seedColonyData.animalStatusEvents.map((event) => ({
      ...event,
      happenedAt: new Date(event.happenedAt),
    })),
  });
  await prisma.animalMovement.createMany({
    data: seedColonyData.animalMovements.map((movement) => ({
      ...movement,
      movedAt: new Date(movement.movedAt),
    })),
  });
  await prisma.cageMovement.createMany({
    data: seedColonyData.cageMovements.map((movement) => ({
      ...movement,
      movedAt: new Date(movement.movedAt),
    })),
  });
  await prisma.cageChargeCategory.createMany({ data: seedColonyData.cageChargeCategories });
  await prisma.cageChargePeriod.createMany({
    data: seedColonyData.cageChargePeriods.map((period) => ({
      ...period,
      startedAt: new Date(period.startedAt),
      endedAt: asDate(period.endedAt),
    })),
  });
  await prisma.$transaction(async (tx) => {
    await tx.invoice.createMany({
      data: seedColonyData.invoices.map((invoice) => ({
        ...invoice,
        periodStart: new Date(invoice.periodStart),
        periodEnd: new Date(invoice.periodEnd),
        finalizedAt: asDate(invoice.finalizedAt),
        voidedAt: asDate(invoice.voidedAt),
      })),
    });
    await tx.invoiceLineItem.createMany({
      data: seedColonyData.invoiceLineItems.map((lineItem) => ({
        ...lineItem,
        serviceStart: new Date(lineItem.serviceStart),
        serviceEnd: new Date(lineItem.serviceEnd),
      })),
    });
  });
  await prisma.ruleConfig.createMany({ data: seedColonyData.ruleConfigs });
  await prisma.alert.createMany({
    data: seedColonyData.manualAlerts.map((alert) => ({
      ...alert,
      labId: alert.entityType === "project"
        ? projectLabById.get(alert.entityId)
        : alert.entityType === "experiment"
          ? experimentLabById.get(alert.entityId)
          : alert.entityType === "litter"
            ? litterLabById.get(alert.entityId)
            : null,
      generatedAt: new Date(alert.generatedAt),
      resolvedAt: asDate(alert.resolvedAt),
    })),
  });
  await prisma.auditLog.createMany({
    data: seedColonyData.auditLogs.map((log) => ({
      ...log,
      previousValue: log.previousValue as Prisma.InputJsonValue | undefined,
      newValue: log.newValue as Prisma.InputJsonValue | undefined,
      timestamp: new Date(log.timestamp),
    })),
  });
  await prisma.$transaction(seedDemoComplianceFixture);
  if (options.clearAttachments !== false) {
    await clearStoredAttachments();
  }
}

export async function disconnectSeedDatabase() {
  await prisma.$disconnect();
}
