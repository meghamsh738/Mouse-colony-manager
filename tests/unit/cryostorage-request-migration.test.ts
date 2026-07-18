import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(process.cwd(), "prisma/migrations/0021_cryostorage_requests/migration.sql");
const eventIntegrityMigrationPath = path.join(
  process.cwd(),
  "prisma/migrations/0022_cryostorage_event_integrity/migration.sql",
);

describe("cryostorage request migration", () => {
  it("adds same-lab versioned requests, immutable events, and one execution record", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain('CREATE TABLE "CryostorageRequest"');
    expect(sql).toContain('CREATE TABLE "CryostorageRequestEvent"');
    expect(sql).toContain('CREATE TABLE "CryostorageOperation"');
    expect(sql).toContain('CONSTRAINT "CryostorageOperation_requestId_key" UNIQUE ("requestId")');
    expect(sql).toContain('FOREIGN KEY ("targetRecordId", "labId") REFERENCES "CryostorageRecord"(id, "labId")');
    expect(sql).toContain('FOREIGN KEY ("projectId", "labId") REFERENCES "Project"(id, "labId")');
    expect(sql).toContain('"targetRecordVersion" >= 1');
  });

  it("binds every request transition and history insert to a current command receipt", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain('CREATE FUNCTION "cryostorage_request_command_context_valid"');
    expect(sql).toContain("receipt.status = 'processing'");
    expect(sql).toContain('receipt."actorAuthzVersion" = actor."authzVersion"');
    expect(sql).toContain('receipt."databasePrincipal" = SESSION_USER');
    expect(sql).toContain("command_type = 'cryostorage.request.submit'");
    expect(sql).toContain("command_type = 'cryostorage.request.cancel'");
    expect(sql).toContain("command_type = 'cryostorage.request.execute'");
    expect(sql).toContain('CREATE TRIGGER "CryostorageRequest_write_guard"');
    expect(sql).toContain('CREATE TRIGGER "CryostorageRequestEvent_write_guard"');
    expect(sql).toContain('CREATE TRIGGER "CryostorageOperation_write_guard"');
  });

  it("keeps history append-only and checks completed request/operation parity at commit", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("Cryostorage request history cannot be deleted or truncated");
    expect(sql).toContain("Cryostorage request events are append-only");
    expect(sql).toContain("Cryostorage operations are append-only");
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER "CryostorageRequest_completion_guard"');
    expect(sql).toContain('CREATE CONSTRAINT TRIGGER "CryostorageOperation_completion_guard"');
    expect(sql).toContain("Completed cryostorage requests require exactly one matching operation");
  });

  it("requires exactly one submitted event and one matching terminal event", async () => {
    const sql = await readFile(eventIntegrityMigrationPath, "utf8");

    expect(sql.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain('CREATE UNIQUE INDEX "CryostorageRequestEvent_requestId_eventType_key"');
    expect(sql).toContain("submitted_event_count <> 1");
    expect(sql).toContain("event_count <> 2 OR terminal_event_count <> 1");
    expect(sql).toContain("Cryostorage request event history is incomplete or inconsistent");
  });

  it("deletes request history before retained inventory during guarded demo seeding", async () => {
    const seed = await readFile(path.join(process.cwd(), "prisma/seed-database.ts"), "utf8");

    expect(seed.indexOf("prisma.cryostorageOperation.deleteMany()"))
      .toBeLessThan(seed.indexOf("prisma.cryostorageRequest.deleteMany()"));
    expect(seed.indexOf("prisma.cryostorageRequest.deleteMany()"))
      .toBeLessThan(seed.indexOf("prisma.cryostorageRecord.deleteMany()"));
  });
});
