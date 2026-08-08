import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(process.cwd(), "prisma/migrations/0036_strain_directory/migration.sql");

describe("strain directory migration safeguards", () => {
  it("requires active owner/manager contacts, command-bound transitions, and immutable request history", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "StrainDirectoryListing"');
    expect(migration).toContain('CREATE TABLE "StrainDirectoryRequest"');
    expect(migration).toContain('CREATE TABLE "StrainDirectoryRequestEvent"');
    expect(migration).toContain("membership.role IN ('owner', 'manager')");
    expect(migration).toContain("Directory requests require a shared listing");
    expect(migration).toContain("Directory requests must be cross-lab");
    expect(migration).toContain("StrainDirectoryRequestEvent_append_only");
    expect(migration).toContain("strain_directory_command_context_valid");
    expect(migration).toContain("StrainDirectoryListing_command_guard");
    expect(migration).toContain("StrainDirectoryRequest_command_guard");
    expect(migration).toContain("StrainDirectoryRequestEvent_insert_guard");
  });
});
