import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = path.join(
  process.cwd(),
  "prisma/migrations/0015_cross_lab_transfer_state_machine/migration.sql",
);

describe("cross-lab transfer migration", () => {
  it("creates the request, packet, item, and append-only event ledger", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain('CREATE TABLE "LabTransferRequest"');
    expect(sql).toContain('CREATE TABLE "LabTransferPacket"');
    expect(sql).toContain('CREATE TABLE "LabTransferItem"');
    expect(sql).toContain('CREATE TABLE "LabTransferEvent"');
    expect(sql).toContain('CREATE TRIGGER "LabTransferPacket_append_only"');
    expect(sql).toContain('CREATE TRIGGER "LabTransferEvent_append_only"');
    expect(sql).toContain('CREATE TRIGGER "LabTransferRequest_truncate_guard"');
    expect(sql).toContain('CREATE TRIGGER "LabTransferItem_truncate_guard"');
    expect(sql).toContain('CREATE TRIGGER "LabTransferPacket_truncate_guard"');
    expect(sql).toContain('CREATE TRIGGER "LabTransferEvent_truncate_guard"');
    expect(sql).toContain('CREATE TRIGGER "CageLabTransfer_truncate_guard"');
    expect(sql).toContain('CREATE TRIGGER "AnimalLabTransfer_truncate_guard"');
    expect(sql).toContain('CREATE TRIGGER "AnimalMovement_truncate_guard"');
    expect(sql.match(/BEFORE TRUNCATE ON/g)).toHaveLength(7);
  });

  it("binds acceptance to the current packet and finalization to an actor", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain('"acceptedPacketVersion" = "packetVersion"');
    expect(sql).toContain('"acceptedPacketHash" IS NOT NULL');
    expect(sql).toContain('"finalizedById" IS NOT NULL AND "finalizedAt" IS NOT NULL');
    expect(sql).toContain('LENGTH(BTRIM("overrideReason")) >= 10');
  });

  it("prevents concurrent active requests for the same cage or animal", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain('CREATE UNIQUE INDEX "LabTransferRequest_open_source_cage_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "LabTransferItem_active_animal_key"');
    expect(sql).toContain('WHERE "sourceCageId" IS NOT NULL');
    expect(sql).toContain('WHERE active');
  });

  it("links final movement and billing history back to the approved request", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain('ALTER TABLE "CageLabTransfer" ADD COLUMN "requestId" TEXT');
    expect(sql).toContain('ALTER TABLE "AnimalLabTransfer" ADD COLUMN "requestId" TEXT');
    expect(sql).toContain('CONSTRAINT "CageLabTransfer_requestId_fkey"');
    expect(sql).toContain('CONSTRAINT "AnimalLabTransfer_requestId_fkey"');
  });

  it("limits every destructive seed bypass to retained test schemas", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const bypassChecks = sql.match(/current_setting\('mcm\.allow_destructive_seed'/g) ?? [];
    const schemaChecks = sql.match(/TG_TABLE_SCHEMA ~\* '\(\^\|_\)\(test\|e2e\|disposable\)\(\$\|_\)'/g) ?? [];

    expect(bypassChecks.length).toBeGreaterThan(0);
    expect(schemaChecks).toHaveLength(bypassChecks.length);
    expect(sql).not.toContain("current_schema()");
  });

  it("requires an in-flight receipt for every trigger-authorized command mutation", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("receipt.status = 'processing'");
    expect(sql).not.toContain("receipt.status IN ('processing', 'succeeded')");
  });
});
