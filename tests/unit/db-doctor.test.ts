import { describe, expect, it } from "vitest";

import { buildDatabaseTargets, formatDoctorReport, parseDotEnv, type DoctorReport } from "../../scripts/db-doctor";

describe("db doctor helpers", () => {
  it("parses quoted database URLs from dotenv content", () => {
    const env = parseDotEnv(`
DATABASE_URL="postgresql://postgres:postgres@localhost:51214/colony_maintenance?schema=public&pgbouncer=true"
DIRECT_DATABASE_URL='postgresql://postgres:postgres@localhost:51214/colony_maintenance?schema=public'
# ignored comment
`);

    expect(env.DATABASE_URL).toBe(
      "postgresql://postgres:postgres@localhost:51214/colony_maintenance?schema=public&pgbouncer=true",
    );
    expect(env.DIRECT_DATABASE_URL).toBe(
      "postgresql://postgres:postgres@localhost:51214/colony_maintenance?schema=public",
    );
  });

  it("extracts and redacts configured database targets", () => {
    const { issues, targets } = buildDatabaseTargets({
      DATABASE_URL: "postgresql://postgres:secret@localhost:51214/colony_maintenance?schema=public&pgbouncer=true",
      DIRECT_DATABASE_URL: "postgresql://postgres:secret@localhost:51214/colony_maintenance?schema=public",
    });

    expect(issues).toEqual([]);
    expect(targets).toHaveLength(2);
    expect(targets[0]).toMatchObject({
      database: "colony_maintenance",
      envKey: "DATABASE_URL",
      host: "localhost",
      port: 51214,
    });
    expect(targets[0].redactedUrl).toContain("USER:PASSWORD@localhost:51214");
    expect(targets[0].redactedUrl).not.toContain("secret");
  });

  it("reports missing or invalid database URL configuration", () => {
    const { issues, targets } = buildDatabaseTargets({
      DATABASE_URL: "file:./dev.db",
    });

    expect(targets).toEqual([]);
    expect(issues).toEqual([
      { envKey: "DATABASE_URL", message: "DATABASE_URL must use a postgres:// or postgresql:// URL." },
      { envKey: "DIRECT_DATABASE_URL", message: "DIRECT_DATABASE_URL is not set." },
    ]);
  });

  it("formats unreachable endpoint guidance without leaking credentials", () => {
    const { targets } = buildDatabaseTargets({
      DATABASE_URL: "postgresql://postgres:secret@localhost:51214/colony_maintenance?schema=public&pgbouncer=true",
      DIRECT_DATABASE_URL: "postgresql://postgres:secret@localhost:51214/colony_maintenance?schema=public",
    });
    const report: DoctorReport = {
      checks: targets.map((target) => ({
        ok: false,
        postgres: { error: "Skipped because TCP is unreachable.", ok: false },
        target,
        tcp: { error: "ECONNREFUSED: connection refused", ok: false },
      })),
      envFilePath: "/repo/.env",
      issues: [],
      targets,
    };
    const output = formatDoctorReport(report);

    expect(output).toContain("Prisma dev DB doctor");
    expect(output).toContain("tcp: unreachable (ECONNREFUSED: connection refused)");
    expect(output).toContain("postgres: unreachable (Skipped because TCP is unreachable.)");
    expect(output).toContain("npx prisma dev -d -n colony-maintenance");
    expect(output).toContain("npm run db:prepare:local");
    expect(output).not.toContain("secret");
  });
});
