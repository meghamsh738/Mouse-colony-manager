import fs from "node:fs";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createSyntheticRehearsalFixture } from "../../prisma/seed-rehearsal";

const rehearsalSeed = fs.readFileSync(
  path.resolve(process.cwd(), "prisma/seed-rehearsal.ts"),
  "utf8",
);

describe("populated rehearsal seed", () => {
  it("is additive-only, requires an empty disposable target, and preserves files", () => {
    expect(rehearsalSeed).toContain("assertSameRetainedVerificationTarget");
    expect(rehearsalSeed).toContain("application rows already exist");
    expect(rehearsalSeed).toContain("exact migration baseline");
    expect(rehearsalSeed).toContain("another client is connected");
    expect(rehearsalSeed).toContain("IN ACCESS EXCLUSIVE MODE");
    expect(rehearsalSeed).toContain("nextValue: 1000");
    expect(rehearsalSeed).toContain("tx.user.create");
    expect(rehearsalSeed).not.toContain("deleteMany");
    expect(rehearsalSeed).not.toContain("updateMany");
    expect(rehearsalSeed).not.toContain("upsert");
    expect(rehearsalSeed).not.toContain("clearStoredAttachments");
  });

  it("locks and checks the baseline inside one transaction before inserting", async () => {
    const calls: string[] = [];
    const tables = [
      "_prisma_migrations",
      "FacilityIdentitySequence",
      "User",
      "Lab",
      "LabMembership",
      "Facility",
      "Room",
      "Rack",
      "Strain",
    ].map((tablename) => ({ schemaname: "mcm_test_populated", tablename }));
    const create = (name: string) => vi.fn(async () => {
      calls.push(`create:${name}`);
      return {};
    });
    const tx = {
      $executeRawUnsafe: vi.fn(async (sql: string) => {
        calls.push("lock");
        expect(sql).toContain("LOCK TABLE");
        expect(sql).toContain('"mcm_test_populated"."User"');
        return 0;
      }),
      $queryRawUnsafe: vi.fn(async (sql: string) => {
        if (sql.includes("pg_stat_activity")) {
          calls.push("sessions");
          return [{ sessionCount: 0 }];
        }
        if (sql.includes("FROM pg_catalog.pg_tables")) {
          calls.push("tables");
          return tables;
        }
        if (sql.includes('FROM "FacilityIdentitySequence"')) {
          calls.push("baseline");
          return [
            { entityType: "animal", nextValue: 1, minimumValue: 1, maximumValue: 9999, width: 4 },
            { entityType: "cage", nextValue: 1000, minimumValue: 1000, maximumValue: 9999, width: 4 },
          ];
        }
        calls.push("empty");
        return [{ present: false }];
      }),
      facility: { create: create("facility") },
      lab: { create: create("lab") },
      labMembership: { create: create("membership") },
      rack: { create: create("rack") },
      room: { create: create("room") },
      strain: { create: create("strain") },
      user: { create: create("user") },
    };
    const client = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<void>, options: unknown) => {
        calls.push("transaction");
        expect(options).toMatchObject({ isolationLevel: "ReadCommitted" });
        await callback(tx);
      }),
    } as unknown as PrismaClient;

    await createSyntheticRehearsalFixture(client, "synthetic-password-hash");

    expect(calls.slice(0, 4)).toEqual(["transaction", "sessions", "tables", "lock"]);
    expect(calls.indexOf("baseline")).toBeGreaterThan(calls.indexOf("lock"));
    expect(calls.indexOf("create:user")).toBeGreaterThan(calls.indexOf("baseline"));
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
