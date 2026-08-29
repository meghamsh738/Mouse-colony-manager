import { describe, expect, it } from "vitest";

import { destructiveSeedTargetErrors, emptyBootstrapTargetErrors, sameDatabaseTarget } from "@/lib/destructive-seed-guard";

describe("destructive seed guard", () => {
  it("allows an explicitly approved loopback test schema", () => {
    expect(destructiveSeedTargetErrors({
      allowed: true,
      nodeEnv: "test",
      rawUrl: "postgresql://postgres:postgres@127.0.0.1:5432/template1?schema=mcm_test_gate",
    })).toEqual([]);
  });

  it("rejects retained local schemas even with the flag", () => {
    expect(destructiveSeedTargetErrors({
      allowed: true,
      nodeEnv: "test",
      rawUrl: "postgresql://postgres:postgres@localhost:5432/colony?schema=public",
    })).toContain("database name or schema must contain a test, e2e, or disposable marker");
  });

  it("rejects production, remote, or unapproved targets", () => {
    const errors = destructiveSeedTargetErrors({
      allowed: false,
      nodeEnv: "production",
      rawUrl: "postgresql://user:secret@db.example.test:5432/colony_test",
    });
    expect(errors).toEqual(expect.arrayContaining([
      "ALLOW_DESTRUCTIVE_SEED must be true",
      "NODE_ENV must not be production",
      "database must use a loopback host",
    ]));
  });

  it("allows a disposable database name when no schema is supplied", () => {
    expect(destructiveSeedTargetErrors({
      allowed: true,
      nodeEnv: "test",
      rawUrl: "postgresql://postgres:postgres@[::1]:5432/colony_test",
    })).toEqual([]);
  });
});

describe("empty bootstrap target guard", () => {
  it("accepts an explicitly marked local empty schema", () => {
    expect(emptyBootstrapTargetErrors({
      allowed: true,
      nodeEnv: "development",
      rawUrl: "postgres://postgres:postgres@localhost:5432/postgres?schema=colony_empty",
    })).toEqual([]);
  });

  it("refuses production, remote, and unmarked targets", () => {
    expect(emptyBootstrapTargetErrors({
      allowed: true,
      nodeEnv: "production",
      rawUrl: "postgres://user:pass@db.example.org/colony?schema=public",
    })).toEqual(expect.arrayContaining([
      "NODE_ENV must not be production",
      "database must use a loopback host",
      "database name or schema must contain an empty, test, e2e, or disposable marker",
    ]));
  });

  it("requires pooled and direct URLs to identify the same database and schema", () => {
    expect(sameDatabaseTarget(
      "postgres://user:pass@localhost:5432/colony?schema=colony_empty&pgbouncer=true",
      "postgres://user:pass@localhost:5432/colony?schema=colony_empty",
    )).toBe(true);
    expect(sameDatabaseTarget(
      "postgres://user:pass@localhost:5432/colony?schema=production",
      "postgres://user:pass@localhost:5432/colony?schema=colony_empty",
    )).toBe(false);
  });

  it("accepts bracketed IPv6 loopback targets", () => {
    expect(emptyBootstrapTargetErrors({
      allowed: true,
      nodeEnv: "development",
      rawUrl: "postgresql://postgres:postgres@[::1]:5432/colony_empty",
    })).toEqual([]);
  });
});
