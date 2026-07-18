import { describe, expect, it } from "vitest";

import {
  buildDirectDatabaseEnv,
  LOCAL_DB_PREPARE_STEPS,
  normalizeDirectDatabaseUrl,
} from "../../scripts/db-prepare-local";
import { findUnsafeDbWorkflowReferences } from "../../scripts/check-db-workflows";
import { disposableTargetErrors } from "../../scripts/assert-disposable-db";
import { databaseUrlForSchema } from "../../scripts/verify-migration-chain";
import { populatedBaselineConfirmationErrors } from "../../scripts/adopt-populated-baseline";

describe("local DB prepare helpers", () => {
  it("removes pgbouncer from pooled database URLs", () => {
    expect(
      normalizeDirectDatabaseUrl(
        "postgresql://postgres:postgres@localhost:51214/colony_maintenance?schema=public&pgbouncer=true",
      ),
    ).toBe("postgresql://postgres:postgres@localhost:51214/colony_maintenance?schema=public");
  });

  it("prefers DIRECT_DATABASE_URL and exports it for Prisma CLI commands", () => {
    const env = buildDirectDatabaseEnv({
      DATABASE_URL: "postgresql://postgres:postgres@localhost:51214/colony_maintenance?schema=public&pgbouncer=true",
      DIRECT_DATABASE_URL: "postgresql://postgres:postgres@localhost:51214/colony_maintenance?schema=public",
    }, {});

    expect(env).toEqual({
      DATABASE_URL: "postgresql://postgres:postgres@localhost:51214/colony_maintenance?schema=public",
      DIRECT_DATABASE_URL: "postgresql://postgres:postgres@localhost:51214/colony_maintenance?schema=public",
    });
  });

  it("throws when no database URL is configured", () => {
    expect(() => buildDirectDatabaseEnv({}, {})).toThrow("DATABASE_URL or DIRECT_DATABASE_URL");
  });

  it("uses migrations without reseeding retained local data", () => {
    expect(LOCAL_DB_PREPARE_STEPS).toEqual([
      ["npm", ["run", "db:migrate"]],
    ]);
  });

  it("rejects db push from retained-data setup paths", () => {
    expect(findUnsafeDbWorkflowReferences({
      "db:prepare": "npm run db:migrate",
      "db:prepare:empty": "npm run db:migrate && npm run db:seed:empty",
      "db:prepare:ci": "npm run db:migrate",
      "db:push:disposable": "node scripts/assert-disposable-db.ts && prisma db push",
    }, "await run(\"npm\", [\"run\", \"db:migrate\"]);")).toEqual([]);

    expect(findUnsafeDbWorkflowReferences({
      "db:prepare": "npm run db:push && npm run db:seed",
      "db:prepare:empty": "npm run db:migrate",
      "db:prepare:ci": "npm run db:migrate",
      "db:push": "prisma db push",
      "db:push:disposable": "prisma db push",
    }, "")).toEqual([
      "package.json#db:push",
      "package.json#db:prepare",
      "package.json#db:prepare destructive seed",
      "package.json#db:push:disposable guard",
    ]);
  });

  it("requires an empty, explicit, local disposable database", () => {
    expect(disposableTargetErrors({
      allowed: true,
      nodeEnv: "development",
      rawUrl: "postgresql://postgres:postgres@127.0.0.1:5432/scratch",
      populatedTables: [],
    })).toEqual([]);

    expect(disposableTargetErrors({
      allowed: true,
      nodeEnv: "development",
      rawUrl: "postgresql://postgres:postgres@127.0.0.1:5432/retained",
      populatedTables: ["Animal", "User"],
    })).toContain("database contains retained rows in: Animal, User");
  });

  it("builds isolated pooled and direct migration verification URLs", () => {
    const base = "postgresql://postgres:postgres@127.0.0.1:5432/colony?schema=public&pgbouncer=true";

    expect(databaseUrlForSchema(base, "mcm_verify_1", false)).toBe(
      "postgresql://postgres:postgres@127.0.0.1:5432/colony?schema=mcm_verify_1",
    );
    expect(databaseUrlForSchema(base, "mcm_verify_1", true)).toBe(
      "postgresql://postgres:postgres@127.0.0.1:5432/colony?schema=mcm_verify_1&pgbouncer=true",
    );
  });

  it("requires zero-diff and backup evidence before populated baseline adoption", () => {
    expect(populatedBaselineConfirmationErrors({ apply: false })).toEqual([]);
    expect(populatedBaselineConfirmationErrors({ apply: true })).toEqual([
      "POPULATED_BASELINE_CONFIRM must equal ZERO_DIFF_BACKUP_VERIFIED",
      "POPULATED_BACKUP_ID is required",
    ]);
    expect(populatedBaselineConfirmationErrors({
      apply: true,
      confirmation: "ZERO_DIFF_BACKUP_VERIFIED",
      backupId: "restore-rehearsal-20260712",
    })).toEqual([]);
  });
});
