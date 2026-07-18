import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("privileged account state approval migration", () => {
  it("expires legacy pending decisions before requiring requester authority snapshots", () => {
    const sql = fs.readFileSync(path.join(
      process.cwd(),
      "prisma/migrations/0034_privileged_account_state_approval/migration.sql",
    ), "utf8");

    expect(sql).toContain('ADD COLUMN "requestedByAuthzVersion" INTEGER');
    expect(sql).toContain('ADD COLUMN "requestedActive" BOOLEAN');
    expect(sql).toContain('SET "status" = \'expired\'');
    expect(sql.indexOf('SET "status" = \'expired\'')).toBeLessThan(sql.indexOf('SET "requestedByAuthzVersion"'));
    expect(sql).toContain('ALTER COLUMN "requestedByAuthzVersion" SET NOT NULL');
  });
});
