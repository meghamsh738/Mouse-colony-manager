import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(process.cwd(), "prisma/migrations/0020_cage_user_forecast_scope/migration.sql");

describe("cage responsibility migration", () => {
  it("creates durable same-lab responsibility history with one active row per cage and user", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain('CREATE TABLE "CageUserAssignment"');
    expect(sql).toContain('FOREIGN KEY ("labId", "userId") REFERENCES "LabMembership"("labId", "userId")');
    expect(sql).toContain('CREATE UNIQUE INDEX "CageUserAssignment_active_cage_user_key"');
    expect(sql).toContain('WHERE "endedAt" IS NULL');
    expect(sql).toContain('"endedById" IS NOT NULL');
    expect(sql).toContain('char_length(btrim("endReason")) BETWEEN 3 AND 500');
  });

  it("binds writes to in-flight cage, transfer, or closure command receipts", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain('CREATE FUNCTION "cage_assignment_command_context_valid"');
    expect(sql).toContain("receipt.status = 'processing'");
    expect(sql).toContain('receipt."actorAuthzVersion" = actor."authzVersion"');
    expect(sql).toContain('receipt."databasePrincipal" = SESSION_USER');
    expect(sql).toContain("command_type IN ('cage.responsibility.update', 'cage.close')");
    expect(sql).toContain("command_type = 'lab_transfer.finalize'");
    expect(sql).toContain("command_type <> 'cage.responsibility.update'");
    expect(sql).toContain('CREATE TRIGGER "CageUserAssignment_write_guard"');
    expect(sql).toContain('CREATE TRIGGER "CageUserAssignment_truncate_guard"');
  });

  it("prevents cage state changes and principal deactivation while active assignments remain", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain('CREATE TRIGGER "Cage_active_responsibility_lab_guard"');
    expect(sql).toContain('BEFORE UPDATE OF "labId", active, status ON "Cage"');
    expect(sql).toContain('CREATE TRIGGER "User_active_cage_responsibility_guard"');
    expect(sql).toContain('CREATE TRIGGER "Lab_active_cage_responsibility_guard"');
    expect(sql).toContain('CREATE TRIGGER "LabMembership_active_cage_responsibility_guard"');
    expect(sql).toContain("NEW.role NOT IN ('owner', 'manager', 'staff')");
    expect(sql).toContain("Reassign active cages before deactivating this user");
  });

  it("ends assignment history in cage transfer and closure transactions", async () => {
    const [transferSource, closureSource, seedSource] = await Promise.all([
      readFile(path.join(process.cwd(), "src/lib/lab-transfer-write.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src/lib/cage-closure-write.ts"), "utf8"),
      readFile(path.join(process.cwd(), "prisma/seed-database.ts"), "utf8"),
    ]);

    expect(transferSource).toContain("endActiveCageResponsibilities(tx");
    const transferEndIndex = transferSource.indexOf("endActiveCageResponsibilities(tx");
    expect(transferEndIndex).toBeLessThan(
      transferSource.indexOf("labId: request.destinationLabId", transferEndIndex),
    );
    expect(closureSource).toContain("endActiveCageResponsibilities(input.tx");
    const closureEndIndex = closureSource.indexOf("endActiveCageResponsibilities(input.tx");
    expect(closureEndIndex).toBeLessThan(
      closureSource.indexOf('active: false, status: "closed"', closureEndIndex),
    );
    expect(seedSource.indexOf("prisma.cageUserAssignment.deleteMany()")).toBeLessThan(seedSource.indexOf("prisma.cage.deleteMany()"));
  });
});
