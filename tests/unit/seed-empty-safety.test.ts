import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const seedSource = fs.readFileSync(path.resolve(process.cwd(), "prisma/seed-empty.ts"), "utf8");
const destructiveSeedSource = fs.readFileSync(path.resolve(process.cwd(), "prisma/seed-database.ts"), "utf8");
const quarantineMigration = fs.readFileSync(
  path.resolve(process.cwd(), "prisma/migrations/0013_quarantine_case_state_machine/migration.sql"),
  "utf8",
);

describe("empty bootstrap retained-state safety", () => {
  it.each([
    "workflowDraft",
    "workflowReviewSnapshot",
    "commandReceipt",
    "outboxMessage",
    "outboxDeliveryAttempt",
    "facilityIdentifierAssignment",
    "legacyIdentifierAlias",
    "migrationRun",
    "ownershipException",
    "quarantineCase",
    "quarantineObservation",
    "cageClosure",
    "sopAcknowledgement",
    "sopAssignment",
    "sopVersionApproval",
    "sopVersion",
    "sopDocument",
    "facilityDutyRequest",
    "facilityDutyAssignment",
    "facilityDutyLifecycleEvent",
    "externalIdentityLink",
    "externalIdentityLifecycleEvent",
  ])("checks %s inside the bootstrap transaction", (delegate) => {
    const transactionBody = seedSource.slice(
      seedSource.indexOf("await prisma.$transaction"),
      seedSource.indexOf("isolationLevel: Prisma.TransactionIsolationLevel.Serializable"),
    );

    expect(transactionBody).toContain(`await tx.${delegate}.count()`);
  });

  it("does not lower an existing facility identity sequence", () => {
    const sequenceUpserts = seedSource.matchAll(/facilityIdentitySequence\.upsert\(\{([\s\S]*?)\n    \}\);/g);
    const upserts = Array.from(sequenceUpserts, (match) => match[1]);

    expect(upserts).toHaveLength(2);
    for (const upsert of upserts) {
      const update = upsert.match(/update: \{([^}]*)\}/)?.[1];
      const create = upsert.match(/create: \{([^}]*)\}/)?.[1];

      expect(update).toBeDefined();
      expect(update).not.toContain("nextValue");
      expect(create).toContain("nextValue");
    }
  });

  it("keeps observation history immutable while allowing guarded disposable reseeding", () => {
    const triggerFunction = quarantineMigration.slice(
      quarantineMigration.indexOf('CREATE FUNCTION "protect_quarantine_observation_history"'),
      quarantineMigration.indexOf('CREATE TRIGGER "QuarantineObservation_append_only"'),
    );

    expect(triggerFunction).toContain("current_setting('mcm.allow_destructive_seed', true) = 'true'");
    expect(triggerFunction).toContain("TG_TABLE_SCHEMA ~* '(^|_)(test|e2e|disposable)($|_)'");
    expect(triggerFunction).not.toContain("current_database() ~*");
    expect(triggerFunction).toContain("RETURN OLD");
    expect(triggerFunction).toContain("Quarantine observations are append-only");
  });

  it("deletes reviewed cage closures before their restricted review snapshots", () => {
    const closureDelete = destructiveSeedSource.indexOf("prisma.cageClosure.deleteMany()");
    const snapshotDelete = destructiveSeedSource.indexOf("prisma.workflowReviewSnapshot.deleteMany()");

    expect(closureDelete).toBeGreaterThan(0);
    expect(snapshotDelete).toBeGreaterThan(closureDelete);
    expect(destructiveSeedSource).toContain("options.clearAttachments !== false");
  });

  it("deletes SOP ledgers in dependency order before labs and users", () => {
    const delegates = [
      "sopAcknowledgement",
      "sopAssignment",
      "sopVersionApproval",
      "sopVersion",
      "sopDocument",
      "lab",
      "user",
    ];
    const positions = delegates.map((delegate) => destructiveSeedSource.indexOf(`prisma.${delegate}.deleteMany()`));

    expect(positions.every((position) => position > 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("clears circular duty and identity ledgers only inside the guarded disposable transaction", () => {
    expect(destructiveSeedSource).toContain("assertDestructiveSeedAllowed()");
    expect(destructiveSeedSource).toContain("SET LOCAL mcm.allow_destructive_seed = 'true'");
    expect(destructiveSeedSource).toContain("SET LOCAL session_replication_role = 'replica'");
    for (const table of [
      "FacilityDutyLifecycleEvent",
      "ExternalIdentityLifecycleEvent",
      "FacilityDutyAssignment",
      "FacilityDutyRequest",
      "ExternalIdentityLink",
    ]) {
      expect(destructiveSeedSource).toContain(`DELETE FROM \"${table}\"`);
    }
  });
});
