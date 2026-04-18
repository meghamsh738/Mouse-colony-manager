import { pathToFileURL } from "node:url";

import { Prisma, PrismaClient } from "@prisma/client";

import { seedColonyData } from "./seed-data";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

const asDate = (value?: string) => (value ? new Date(value) : undefined);

export async function seedDatabase() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.alert.deleteMany(),
    prisma.ruleConfig.deleteMany(),
    prisma.cageMovement.deleteMany(),
    prisma.animalMovement.deleteMany(),
    prisma.animalStatusEvent.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.healthNote.deleteMany(),
    prisma.experimentAssignment.deleteMany(),
    prisma.experiment.deleteMany(),
    prisma.animalProjectAllocation.deleteMany(),
    prisma.project.deleteMany(),
    prisma.litterAnimal.deleteMany(),
    prisma.litter.deleteMany(),
    prisma.breedingAdult.deleteMany(),
    prisma.breedingSetup.deleteMany(),
    prisma.genotypingRecord.deleteMany(),
    prisma.animalAllele.deleteMany(),
    prisma.animal.deleteMany(),
    prisma.allele.deleteMany(),
    prisma.strain.deleteMany(),
    prisma.cage.deleteMany(),
    prisma.rack.deleteMany(),
    prisma.room.deleteMany(),
    prisma.facility.deleteMany(),
    prisma.user.deleteMany(),
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

  await prisma.facility.createMany({ data: seedColonyData.facilities });
  await prisma.room.createMany({ data: seedColonyData.rooms });
  await prisma.rack.createMany({ data: seedColonyData.racks });
  await prisma.cage.createMany({
    data: seedColonyData.cages.map((cage) => ({
      ...cage,
      lastUpdatedAt: new Date(cage.lastUpdatedAt),
    })),
  });
  await prisma.strain.createMany({ data: seedColonyData.strains });
  await prisma.allele.createMany({ data: seedColonyData.alleles });
  await prisma.animal.createMany({
    data: seedColonyData.animals.map((animal) => ({
      ...animal,
      dob: new Date(animal.dob),
      deathDate: asDate(animal.deathDate),
    })),
  });
  await prisma.animalAllele.createMany({ data: seedColonyData.animalAlleles });
  await prisma.genotypingRecord.createMany({
    data: seedColonyData.genotypingRecords.map((record) => ({
      ...record,
      sampleDate: new Date(record.sampleDate),
      resultDate: new Date(record.resultDate),
    })),
  });
  await prisma.breedingSetup.createMany({
    data: seedColonyData.breedingSetups.map((setup) => ({
      ...setup,
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
  await prisma.project.createMany({ data: seedColonyData.projects });
  await prisma.animalProjectAllocation.createMany({
    data: seedColonyData.projectAllocations.map((allocation) => ({
      ...allocation,
      startedAt: new Date(allocation.startedAt),
      endedAt: asDate(allocation.endedAt),
    })),
  });
  await prisma.experiment.createMany({ data: seedColonyData.experiments });
  await prisma.experimentAssignment.createMany({
    data: seedColonyData.experimentAssignments.map((assignment) => ({
      ...assignment,
      startDate: new Date(assignment.startDate),
      endDate: asDate(assignment.endDate),
    })),
  });
  await prisma.healthNote.createMany({
    data: seedColonyData.healthNotes.map((note) => ({
      ...note,
      createdAt: new Date(note.createdAt),
    })),
  });
  await prisma.attachment.createMany({ data: seedColonyData.attachments });
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
  await prisma.ruleConfig.createMany({ data: seedColonyData.ruleConfigs });
  await prisma.alert.createMany({
    data: seedColonyData.manualAlerts.map((alert) => ({
      ...alert,
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
}

async function main() {
  await seedDatabase();
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  main()
    .then(async () => {
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
