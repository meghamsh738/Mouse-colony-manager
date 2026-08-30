import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

function directConnectionUrl() {
  const raw = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("A fresh synthetic M16 test database URL is required.");
  const parsed = new URL(raw);
  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") throw new Error("M16 migration atomicity runs on loopback only.");
  if (!/mcm_test_m16_fix(?:\d+)?_/.test(parsed.pathname)) throw new Error("M16 migration atomicity requires a uniquely named mcm_test_m16_fix{N}_* database.");
  parsed.searchParams.delete("schema");
  parsed.searchParams.delete("pgbouncer");
  return parsed.toString();
}

describe("M16 migration atomicity", () => {
  it("rolls back a forced late failure completely and then replays cleanly", async () => {
    const schema = `mcm_test_m16_fix_atomic_${Date.now()}_${process.pid}`;
    const client = new Client({ connectionString: directConnectionUrl() });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      const root = join(process.cwd(), "prisma", "migrations");
      const migrationNames = (await readdir(root)).filter((name) => /^\d{4}_/.test(name)).sort();
      for (const name of migrationNames.filter((name) => name < "0041_")) {
        await client.query(await readFile(join(root, name, "migration.sql"), "utf8"));
      }
      const migration = await readFile(join(root, "0041_safe_operational_reconciliation", "migration.sql"), "utf8");
      const forcedFailure = migration.replace(/\nCOMMIT;\s*$/, "\nSELECT mcm_m16_forced_late_failure();\nCOMMIT;\n");
      await expect(client.query(forcedFailure)).rejects.toThrow(/mcm_m16_forced_late_failure/i);
      await client.query("ROLLBACK");

      const rolledBack = await client.query<{ manifest: string | null; release_column: string | null; intake_guard: string }>(`
        SELECT
          to_regclass('"ShipmentManifest"')::text AS manifest,
          (SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'QuarantineCase' AND column_name = 'releaseDutyAssignmentId') AS release_column,
          pg_get_functiondef('mcm_m13_guard_compliance_snapshot()'::regprocedure) AS intake_guard
      `);
      expect(rolledBack.rows[0]?.manifest).toBeNull();
      expect(rolledBack.rows[0]?.release_column).toBeNull();
      expect(rolledBack.rows[0]?.intake_guard).not.toContain("m16.shipment.confirm");

      await client.query(migration);
      const replayed = await client.query<{ manifest: string | null; health_decision: string | null }>(`
        SELECT to_regclass('"ShipmentManifest"')::text AS manifest,
               to_regclass('"ShipmentHealthDecision"')::text AS health_decision
      `);
      expect(replayed.rows[0]?.manifest).toBe("\"ShipmentManifest\"");
      expect(replayed.rows[0]?.health_decision).toBe("\"ShipmentHealthDecision\"");
      console.info(`Retained M16 migration atomicity schema: ${schema}`);
    } finally {
      await client.end();
    }
  }, 120_000);
});
