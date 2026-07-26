import { describe, expect, it } from "vitest";

import {
  compareTableCounts,
  emptyRestoreStateErrors,
  parsePopulatedRehearsalIdentity,
  populatedBackupRehearsalErrors,
  postgresMajor,
  postgresToolEnvironment,
  sourceDatabaseStateErrors,
} from "../../scripts/rehearse-populated-backup";

const sourceUrl =
  "postgresql://postgres:secret@127.0.0.1:51422/mcm_test_m9_source?schema=mcm_test_populated&sslmode=disable";
const restoreUrl =
  "postgresql://postgres:secret@localhost:51422/mcm_test_m9_restore?schema=mcm_test_populated&sslmode=disable";

describe("populated backup rehearsal guard", () => {
  it("accepts distinct loopback disposable databases with an external artifact directory", () => {
    expect(populatedBackupRehearsalErrors({
      confirmation: "LOCAL_SYNTHETIC_DISPOSABLE_ONLY",
      dataClass: "synthetic",
      nodeEnv: "development",
      outputDirectory: "/private/tmp/mcm-m9-evidence",
      runtimeRoot: "/private/tmp",
      restoreUrl,
      sourceUrl,
      workspaceRoot: "/workspace/mouse-colony-manager",
    })).toEqual([]);
  });

  it("refuses remote, production, same-target, mismatched-schema, and in-worktree runs", () => {
    expect(populatedBackupRehearsalErrors({
      confirmation: "yes",
      dataClass: "production",
      nodeEnv: "production",
      outputDirectory: "/workspace/mouse-colony-manager/evidence",
      runtimeRoot: "/workspace/mouse-colony-manager",
      restoreUrl: sourceUrl,
      sourceUrl: sourceUrl.replace("127.0.0.1", "db.example.org"),
      workspaceRoot: "/workspace/mouse-colony-manager",
    })).toEqual(expect.arrayContaining([
      "NODE_ENV must not be production",
      "MCM_POPULATED_REHEARSAL_CONFIRM must equal LOCAL_SYNTHETIC_DISPOSABLE_ONLY",
      "MCM_REHEARSAL_DATA_CLASS must equal synthetic",
      "source database must use a loopback host",
      "backup artifacts must be stored outside the source worktree",
    ]));

    expect(populatedBackupRehearsalErrors({
      confirmation: "LOCAL_SYNTHETIC_DISPOSABLE_ONLY",
      dataClass: "synthetic",
      outputDirectory: "/private/tmp/mcm-m9-evidence",
      runtimeRoot: "/private/tmp",
      restoreUrl: sourceUrl,
      sourceUrl,
    })).toContain("source and restore targets must be different databases");

    expect(populatedBackupRehearsalErrors({
      confirmation: "LOCAL_SYNTHETIC_DISPOSABLE_ONLY",
      dataClass: "synthetic",
      outputDirectory: "/private/tmp/mcm-m9-evidence",
      runtimeRoot: "/private/tmp",
      restoreUrl: restoreUrl.replace("mcm_test_populated", "mcm_test_other"),
      sourceUrl,
    })).toContain("source and restore targets must use the same disposable schema name");
  });

  it("requires both database and schema disposable namespaces", () => {
    expect(() => parsePopulatedRehearsalIdentity(
      sourceUrl.replace("mcm_test_m9_source", "colony"),
    )).toThrow("database must use the disposable mcm_test_* namespace");
    expect(() => parsePopulatedRehearsalIdentity(
      sourceUrl.replace("mcm_test_populated", "public"),
    )).toThrow("schema must use the disposable mcm_test_* namespace");
    expect(() => parsePopulatedRehearsalIdentity(
      `${sourceUrl}&options=-c%20default_transaction_read_only%3Don`,
    )).toThrow("database URL must not set session options");
  });

  it("builds libpq environment without putting the password in command arguments", () => {
    expect(postgresToolEnvironment(sourceUrl, {
      NODE_ENV: "test",
      PATH: "/usr/bin",
      SECRET_TOKEN: "do-not-forward",
    })).toMatchObject({
      PATH: "/usr/bin",
      PGDATABASE: "mcm_test_m9_source",
      PGHOST: "127.0.0.1",
      PGPASSWORD: "secret",
      PGPORT: "51422",
      PGSSLMODE: "disable",
      PGUSER: "postgres",
    });
    expect(postgresToolEnvironment(sourceUrl, {
      NODE_ENV: "test",
      SECRET_TOKEN: "do-not-forward",
    })).not.toHaveProperty("SECRET_TOKEN");
    expect(postgresToolEnvironment(sourceUrl, {
      NODE_ENV: "test",
    })).not.toHaveProperty("NODE_ENV");
  });

  it("extracts PostgreSQL client majors for server compatibility checks", () => {
    expect(postgresMajor("pg_dump (PostgreSQL) 16.14 (Postgres.app)")).toBe(16);
    expect(postgresMajor("pg_restore (PostgreSQL) 17.5")).toBe(17);
    expect(postgresMajor("unknown")).toBeNull();
  });

  it("requires exact sorted row-count parity", () => {
    const counts = [
      { table: "_prisma_migrations", count: "35" },
      { table: "Animal", count: "12" },
    ];
    expect(compareTableCounts(counts, [...counts])).toBe(true);
    expect(compareTableCounts(counts, [
      { table: "_prisma_migrations", count: "35" },
      { table: "Animal", count: "11" },
    ])).toBe(false);
  });

  it("allows only application objects plus the public pgcrypto extension", () => {
    expect(sourceDatabaseStateErrors({
      schemas: ["mcm_test_populated", "public"],
      extensions: ["pgcrypto@public"],
      globalObjects: [],
      objects: [
        { schema: "mcm_test_populated", kind: "relation", identity: "Animal" },
        { schema: "mcm_test_populated", kind: "routine", identity: "guard_animal()" },
      ],
    }, "mcm_test_populated")).toEqual([]);

    expect(sourceDatabaseStateErrors({
      schemas: ["mcm_test_populated", "public"],
      extensions: ["pgcrypto@public", "hstore@public"],
      globalObjects: ["large-object:42"],
      objects: [
        { schema: "public", kind: "relation", identity: "unreviewed_data" },
      ],
    }, "mcm_test_populated")).toEqual(expect.arrayContaining([
      "extensions must contain only pgcrypto@public; found: pgcrypto@public, hstore@public",
      "non-extension-owned objects outside mcm_test_populated: relation:public.unreviewed_data",
      "unsupported database-wide objects: large-object:42",
    ]));
  });

  it("requires the restore database to have only the standard empty public schema", () => {
    expect(emptyRestoreStateErrors({
      schemas: ["public"],
      extensions: [],
      globalObjects: [],
      objects: [],
    }, "mcm_test_populated")).toEqual([]);

    expect(emptyRestoreStateErrors({
      schemas: ["mcm_test_populated", "public"],
      extensions: ["pgcrypto@public"],
      globalObjects: ["publication:leftover"],
      objects: [{ schema: "public", kind: "type", identity: "leftover" }],
    }, "mcm_test_populated")).toHaveLength(4);
  });
});
