import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "prisma/migrations/0035_independent_lab_sop_approval/migration.sql"),
  "utf8",
);

describe("independent lab SOP approval migration", () => {
  it("requires every SOP approver to differ from the immutable version creator", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain('CREATE OR REPLACE FUNCTION "sop_actor_can_approve_version"');
    expect(migration).toContain('version."createdById" <> actor.id');
    expect(migration.match(/version\."createdById" <> actor\.id/g)).toHaveLength(1);
  });
});
