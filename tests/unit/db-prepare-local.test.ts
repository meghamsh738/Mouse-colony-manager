import { describe, expect, it } from "vitest";

import { buildDirectDatabaseEnv, normalizeDirectDatabaseUrl } from "../../scripts/db-prepare-local";

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
});
