import { randomUUID } from "node:crypto";

import { seedDatabase } from "../../prisma/seed-database";
import { seedRoleQaDatabase } from "../../prisma/seed-role-qa";

type EnvironmentSnapshot = Record<string, string | undefined>;

function restoreEnvironment(snapshot: EnvironmentSnapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

/**
 * Installs an isolated, synthetic-only role fixture for a welfare integration
 * file and returns the cleanup callback. Both the setup and cleanup retain
 * filesystem-backed attachments; only the explicitly guarded disposable test
 * database is reseeded.
 */
export async function installWelfareDatabaseFixture() {
  const environment: EnvironmentSnapshot = {
    ALLOW_DESTRUCTIVE_SEED: process.env.ALLOW_DESTRUCTIVE_SEED,
    MCM_DEPLOYMENT_PROFILE: process.env.MCM_DEPLOYMENT_PROFILE,
    ROLE_QA_PASSWORD: process.env.ROLE_QA_PASSWORD,
  };

  process.env.ALLOW_DESTRUCTIVE_SEED = "true";
  process.env.MCM_DEPLOYMENT_PROFILE = "synthetic";
  process.env.ROLE_QA_PASSWORD = `M14-test-${randomUUID()}-Aa1!`;

  try {
    await seedRoleQaDatabase({ clearAttachments: false });
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
