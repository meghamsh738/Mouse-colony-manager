import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("cryostorage capability UI", () => {
  it("derives request and inventory controls from capabilities rather than legacy role names", async () => {
    const [page, table] = await Promise.all([
      readFile(path.join(process.cwd(), "src/app/cryostorage/page.tsx"), "utf8"),
      readFile(path.join(process.cwd(), "src/components/app/cryostorage-table.tsx"), "utf8"),
    ]);

    expect(page).toContain('actorHasCapability(user, "cryostorage:request")');
    expect(page).toContain('actorHasCapability(user, "cryostorage:manage")');
    expect(page).not.toContain('user.role !== "read_only"');
    expect(table).toContain("canManage ? (");
    expect(table).toContain("<CryostorageInlineEditForm");
  });
});
