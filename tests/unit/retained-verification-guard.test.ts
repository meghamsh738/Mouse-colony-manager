import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertSameRetainedVerificationTarget,
  retainedVerificationTargetErrors,
} from "../../scripts/retained-verification-guard";

describe("retained migration verification guard", () => {
  it("allows local non-production databases", () => {
    expect(retainedVerificationTargetErrors({
      nodeEnv: "test",
      rawUrl: "postgres://postgres:postgres@localhost:5432/template1?schema=mcm_test_base",
    })).toEqual([]);
  });

  it("rejects production and remote databases before creating retained schemas", () => {
    expect(retainedVerificationTargetErrors({
      nodeEnv: "production",
      rawUrl: "postgres://user:secret@database.example.org:5432/colony",
    })).toEqual(expect.arrayContaining([
      "NODE_ENV must not be production",
      "database must use a loopback host",
    ]));
  });

  it("rejects loopback databases outside an mcm_test schema", () => {
    expect(retainedVerificationTargetErrors({
      nodeEnv: "test",
      rawUrl: "postgres://postgres@127.0.0.1:51422/postgres?schema=public",
    })).toContain("schema must use the disposable mcm_test_* namespace");
  });

  it("rejects a direct URL that points Prisma tooling at another database or schema", () => {
    expect(() => assertSameRetainedVerificationTarget(
      "postgres://postgres@127.0.0.1:51422/postgres?schema=mcm_test_guarded",
    )).toThrow("DIRECT_DATABASE_URL is required");
    expect(() => assertSameRetainedVerificationTarget(
      "postgres://postgres@127.0.0.1:51422/postgres?schema=mcm_test_guarded",
      "postgres://postgres@localhost:51422/postgres?schema=mcm_test_other",
    )).toThrow("target different databases or schemas");
    expect(() => assertSameRetainedVerificationTarget(
      "postgres://postgres@127.0.0.1:51422/postgres?schema=mcm_test_guarded",
      "postgres://postgres@localhost:51422/other?schema=mcm_test_guarded",
    )).toThrow("target different databases or schemas");
  });

  it("accepts loopback aliases for the same database and schema", () => {
    expect(assertSameRetainedVerificationTarget(
      "postgres://postgres@127.0.0.1:51422/postgres?schema=mcm_test_guarded",
      "postgres://postgres@localhost:51422/postgres?schema=mcm_test_guarded",
    )).toMatchObject({ database: "postgres", schema: "mcm_test_guarded", port: "51422" });
  });

  it("guards the audit verifier before constructing a Prisma client", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "scripts/verify-audit-security.ts"), "utf8");
    const guardCall = source.indexOf("assertRetainedVerificationTarget(databaseUrl)");
    const directRequirement = source.indexOf('if (!directDatabaseUrl) throw new Error("DIRECT_DATABASE_URL is required.")');
    const clientConstruction = source.indexOf("new PrismaClient({ datasourceUrl: databaseUrl })");
    const liveTargetAssertion = source.indexOf("current_database() AS database, current_schema() AS schema");

    expect(guardCall).toBeGreaterThan(-1);
    expect(directRequirement).toBeGreaterThan(-1);
    expect(clientConstruction).toBeGreaterThan(guardCall);
    expect(clientConstruction).toBeGreaterThan(directRequirement);
    expect(liveTargetAssertion).toBeGreaterThan(clientConstruction);
    expect(source.indexOf("await db.user.createMany")).toBeGreaterThan(liveTargetAssertion);
  });
});
