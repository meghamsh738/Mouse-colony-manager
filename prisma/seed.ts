import { pathToFileURL } from "node:url";

import { Prisma, PrismaClient } from "@prisma/client";

import { demoColonyData } from "../src/data/demo-colony";
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
    data: demoColonyData.users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      passwordHash: hashPassword(user.password),
      role: user.role,
      active: user.active,
    })),
  });

  await prisma.facility.createMany({ data: demoColonyData.facilities });
  await prisma.room.createMany({ data: demoColonyData.rooms });
  await prisma.rack.createMany({ data: demoColonyData.racks });
  await prisma.cage.createMany({
    data: demoColonyData.cages.map((cage) => ({
      ...cage,
      lastUpdatedAt: new Date(cage.lastUpdatedAt),
    })),
  });
  await prisma.strain.createMany({ data: demoColonyData.strains });
  await prisma.allele.createMany({ data: demoColonyData.alleles });
  await prisma.animal.createMany({
    data: demoColonyData.animals.map((animal) => ({
      ...animal,
      dob: new Date(animal.dob),
      deathDate: asDate(animal.deathDate),
    })),
  });
  await prisma.animalAllele.createMany({ data: demoColonyData.animalAlleles });
  await prisma.genotypingRecord.createMany({
    data: demoColonyData.genotypingRecords.map((record) => ({
      ...record,
      sampleDate: new Date(record.sampleDate),
      resultDate: new Date(record.resultDate),
    })),
  });
  await prisma.breedingSetup.createMany({
    data: demoColonyData.breedingSetups.map((setup) => ({
      ...setup,
      startDate: new Date(setup.startDate),
      endDate: asDate(setup.endDate),
    })),
  });
  await prisma.breedingAdult.createMany({ data: demoColonyData.breedingAdults });
  await prisma.litter.createMany({
    data: demoColonyData.litters.map((litter) => ({
      ...litter,
      birthDate: new Date(litter.birthDate),
    })),
  });
  await prisma.litterAnimal.createMany({ data: demoColonyData.litterAnimals });
  await prisma.project.createMany({ data: demoColonyData.projects });
  await prisma.animalProjectAllocation.createMany({
    data: demoColonyData.projectAllocations.map((allocation) => ({
      ...allocation,
      startedAt: new Date(allocation.startedAt),
      endedAt: asDate(allocation.endedAt),
    })),
  });
  await prisma.experiment.createMany({ data: demoColonyData.experiments });
  await prisma.experimentAssignment.createMany({
    data: demoColonyData.experimentAssignments.map((assignment) => ({
      ...assignment,
      startDate: new Date(assignment.startDate),
      endDate: asDate(assignment.endDate),
    })),
  });
  await prisma.healthNote.createMany({
    data: demoColonyData.healthNotes.map((note) => ({
      ...note,
      createdAt: new Date(note.createdAt),
    })),
  });
  await prisma.attachment.createMany({ data: demoColonyData.attachments });
  await prisma.animalStatusEvent.createMany({
    data: demoColonyData.animalStatusEvents.map((event) => ({
      ...event,
      happenedAt: new Date(event.happenedAt),
    })),
  });
  await prisma.animalMovement.createMany({
    data: demoColonyData.animalMovements.map((movement) => ({
      ...movement,
      movedAt: new Date(movement.movedAt),
    })),
  });
  await prisma.cageMovement.createMany({
    data: demoColonyData.cageMovements.map((movement) => ({
      ...movement,
      movedAt: new Date(movement.movedAt),
    })),
  });
  await prisma.ruleConfig.createMany({ data: demoColonyData.ruleConfigs });
  await prisma.alert.createMany({
    data: demoColonyData.manualAlerts.map((alert) => ({
      ...alert,
      generatedAt: new Date(alert.generatedAt),
      resolvedAt: asDate(alert.resolvedAt),
    })),
  });
  await prisma.auditLog.createMany({
    data: demoColonyData.auditLogs.map((log) => ({
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
