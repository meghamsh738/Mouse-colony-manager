import { describe, expect, it } from "vitest";

import {
  categorizeLoadError,
  categorizePrismaPoolError,
  isM10LoopbackServerAddress,
  M10_TARGETS,
  m10ArtifactDirectoryErrors,
  m10RunGuardErrors,
  m10SeedGuardErrors,
  percentile,
} from "../../scripts/m10-load-common";
import { changedTableCounts, loadGateErrors, loadProfiles, M10_ROUTES, recordApplicationDatabaseFailureLine } from "../../scripts/run-m10-load";
import { assertExactCounts, freshM10TargetErrors, m10SyntheticMembershipRole } from "../../scripts/seed-m10-load";

const target = "postgresql://postgres:postgres@127.0.0.1:5432/colony?schema=mcm_test_m10_load_01";

describe("M10 load seed guard", () => {
  it("requires every destructive opt-in and an exact dedicated loopback target", () => {
    expect(m10SeedGuardErrors({
      nodeEnv: "test",
      loadSeed: "true",
      allowDestructiveSeed: "true",
      databaseUrl: `${target}&pgbouncer=true`,
      directDatabaseUrl: target,
    })).toEqual([]);
  });

  it("rejects production, remote, mismatched, and incompletely approved targets", () => {
    const errors = m10SeedGuardErrors({
      nodeEnv: "production",
      loadSeed: "false",
      allowDestructiveSeed: "false",
      databaseUrl: "postgresql://user:secret@db.example.test/colony?schema=mcm_test_m10_load_01",
      directDatabaseUrl: "postgresql://user:secret@localhost/other?schema=mcm_test_m10_load_02",
    });
    expect(errors).toEqual(expect.arrayContaining([
      "NODE_ENV must not be production",
      "M10_LOAD_SEED must be true",
      "ALLOW_DESTRUCTIVE_SEED must be true",
      "DATABASE_URL must use a loopback host",
      "DATABASE_URL and DIRECT_DATABASE_URL must target the same database and schema",
    ]));
  });

  it("preserves the four-digit animal ceiling as the explicit target", () => {
    expect(M10_TARGETS).toEqual({ animals: 9_999, cages: 2_000, syntheticUsers: 50 });
    expect(isM10LoopbackServerAddress("127.0.0.1/32")).toBe(true);
    expect(isM10LoopbackServerAddress("::1/128")).toBe(true);
    expect(isM10LoopbackServerAddress("10.0.0.4/32")).toBe(false);
  });
});

describe("M10 load runner guard and metrics", () => {
  it("only permits an explicit private artifact path outside the worktree", () => {
    const worktree = "/project/.runtime-data/worktrees/load";
    expect(m10ArtifactDirectoryErrors({
      configuredPath: "/project/.runtime-data/m10-load/results",
      worktreePath: worktree,
    })).toEqual([]);
    expect(m10ArtifactDirectoryErrors({ configuredPath: `${worktree}/artifacts`, worktreePath: worktree }))
      .toEqual(expect.arrayContaining(["artifact directory must be under .runtime-data/m10-load", "artifact directory must be outside the worktree"]));
  });

  it("requires a loopback production-server URL and the same dedicated DB target", () => {
    expect(m10RunGuardErrors({
      databaseUrl: target,
      directDatabaseUrl: target,
      baseUrl: "http://127.0.0.1:3310",
      artifactDirectory: "/project/.runtime-data/m10-load/results",
      worktreePath: "/project/.runtime-data/worktrees/load",
    })).toEqual([]);
    expect(m10RunGuardErrors({
      databaseUrl: target,
      directDatabaseUrl: target,
      baseUrl: "https://load.example.test",
      artifactDirectory: "/project/results",
      worktreePath: "/project/worktree",
    })).toEqual(expect.arrayContaining(["M10_LOAD_BASE_URL must be loopback HTTP", "artifact directory must be under .runtime-data/m10-load"]));
  });

  it("provides a bounded quick profile and deterministic percentile/error helpers", () => {
    const profiles = loadProfiles({ M10_LOAD_PROFILE: "quick" });
    expect(profiles.steady).toEqual({ durationSeconds: 10, concurrency: 20, requestsPerSecond: 40 });
    expect(() => loadProfiles({ M10_LOAD_STEADY_CONCURRENCY: "101" })).toThrow("between 1 and 100");
    expect(percentile([1, 2, 3, 100], 0.95)).toBe(100);
    expect(categorizeLoadError({ status: 503 })).toBe("http_5xx");
    expect(categorizeLoadError({ error: new Error("request timeout") })).toBe("timeout");
    expect(categorizePrismaPoolError({ code: "P2024", message: "Timed out fetching a connection" })).toBe("pool_timeout");
    expect(changedTableCounts({ Animal: 9_999, User: 55 }, { Animal: 9_999, User: 56 }))
      .toEqual([{ table: "User", before: 55, after: 56 }]);
  });

  it("covers the production read paths without putting concrete identifiers in metric labels", () => {
    expect(M10_ROUTES.map((route) => route.label)).toEqual(expect.arrayContaining([
      "/", "/animals", "/animals?search", "/animals/:animalId", "/cages", "/cages?search",
      "/cages/:cageId", "/cages/:cageId?action=move-mouse", "/samples", "/cryostorage", "/approvals",
      "/scan/:barcode", "/scan/:barcode?action=move-mouse", "/workbook",
    ]));
    expect(M10_ROUTES.every((route) => !route.label.includes("M10-"))).toBe(true);
  });

  it("fails acceptance for request errors, missing routes, or absent resource samples", () => {
    expect(loadGateErrors([{ route: "/", category: undefined }], ["/"], { databaseConnections: 1, rss: 1 })).toEqual([]);
    expect(loadGateErrors([{ route: "/", category: "invalid_rsc" }], ["/", "/animals"], { databaseConnections: 0, rss: 0 }))
      .toEqual(expect.arrayContaining([
        "1 requests had unexpected auth, HTTP, transport, or RSC errors",
        "route /animals had no samples",
        "application RSS had no samples",
        "database connections had no samples",
      ]));
  });

  it("counts only bounded application database failure signals without retaining log text", () => {
    const counts = { P2024: 0, P1001: 0, P1002: 0, P1017: 0, poolTimeoutSignals: 0, connectionLimitSignals: 0 };
    recordApplicationDatabaseFailureLine("Prisma P2024: timed out fetching a new connection from the pool", counts);
    recordApplicationDatabaseFailureLine("database reports too many connections", counts);
    expect(counts).toEqual({ P2024: 1, P1001: 0, P1002: 0, P1017: 0, poolTimeoutSignals: 1, connectionLimitSignals: 1 });
    expect(Object.keys(counts)).not.toContain("message");
  });
});

describe("M10 seed count validation", () => {
  const pristineSequences = [
    { entityType: "animal", nextValue: 1, minimumValue: 1, maximumValue: 9_999, width: 4 },
    { entityType: "cage", nextValue: 1_000, minimumValue: 1_000, maximumValue: 9_999, width: 4 },
  ];

  it("refuses a reused schema before the reset-style base seed can run", () => {
    expect(freshM10TargetErrors([], pristineSequences)).toEqual([]);
    expect(freshM10TargetErrors(["Animal", "User"], pristineSequences))
      .toContain("application tables already contain rows: Animal, User");
    expect(freshM10TargetErrors([], [{ ...pristineSequences[0], nextValue: 15 }, pristineSequences[1]]))
      .toContain("identity sequence animal is not pristine");
  });

  it("requires exact base and after counts, including identity parity", () => {
    const counts = { animals: 9_999, animalAssignments: 9_999, cages: 2_000, cageAssignments: 2_000, users: 55 };
    expect(() => assertExactCounts(counts, counts, "after")).not.toThrow();
    expect(() => assertExactCounts({ ...counts, animalAssignments: 9_998 }, counts, "after"))
      .toThrow("after animalAssignments count was 9998, expected 9999");
  });

  it("seeds a deterministic authorized manager subset while retaining 50 distinct users", () => {
    expect(Array.from({ length: 50 }, (_, index) => m10SyntheticMembershipRole(index)).filter((role) => role === "manager")).toHaveLength(10);
    expect(m10SyntheticMembershipRole(10)).toBe("viewer");
  });
});
