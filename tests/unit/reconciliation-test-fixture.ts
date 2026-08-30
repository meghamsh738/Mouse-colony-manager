import { randomUUID } from "node:crypto";

import { seedDatabase } from "../../prisma/seed-database";
import { seedRoleQaDatabase } from "../../prisma/seed-role-qa";
import { prisma } from "@/lib/prisma";

type EnvironmentSnapshot = Record<string, string | undefined>;

function restoreEnvironment(snapshot: EnvironmentSnapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

export async function installReconciliationDatabaseFixture() {
  const environment: EnvironmentSnapshot = {
    ALLOW_DESTRUCTIVE_SEED: process.env.ALLOW_DESTRUCTIVE_SEED,
    MCM_DEPLOYMENT_PROFILE: process.env.MCM_DEPLOYMENT_PROFILE,
    ROLE_QA_PASSWORD: process.env.ROLE_QA_PASSWORD,
  };
  process.env.ALLOW_DESTRUCTIVE_SEED = "true";
  process.env.MCM_DEPLOYMENT_PROFILE = "synthetic";
  process.env.ROLE_QA_PASSWORD = `M16-test-${randomUUID()}-Aa1!`;
  try {
    await seedRoleQaDatabase({ clearAttachments: false });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL mcm.allow_destructive_seed = 'true'");
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const cage = await tx.cage.findFirstOrThrow({ where: { labId: "lab-microglia" }, select: { roomId: true, rackId: true } });
      await tx.cage.create({ data: {
        id: "cage-m16-quarantine",
        facilityCageId: "9998",
        labId: "lab-microglia",
        roomId: cage.roomId,
        rackId: cage.rackId,
        cageNumber: `M16-${randomUUID().slice(0, 6)}`,
        barcode: "M16-QA-QUARANTINE",
        status: "quarantine",
        active: true,
      } });
      await tx.labMembership.create({ data: {
        id: `m16-vet-manager-${randomUUID()}`,
        labId: "lab-microglia",
        userId: "user-veterinarian-qa",
        role: "manager",
      } });
      await tx.labMembership.update({ where: { id: "lab-member-qa-admin1-micro" }, data: { role: "manager" } });
      await tx.cage.create({ data: {
        id: "cage-m16-release",
        facilityCageId: "9997",
        labId: "lab-microglia",
        roomId: cage.roomId,
        rackId: cage.rackId,
        cageNumber: `M16-R-${randomUUID().slice(0, 6)}`,
        barcode: "M16-QA-RELEASE",
        status: "active",
        active: true,
      } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
    });
  } catch (error) {
    restoreEnvironment(environment);
    throw error;
  }
  return async () => {
    try {
      await seedDatabase({ clearAttachments: false });
    } finally {
      restoreEnvironment(environment);
    }
  };
}
