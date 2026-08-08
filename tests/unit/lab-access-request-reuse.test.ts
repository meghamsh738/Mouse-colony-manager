import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { labMembership: { findMany: mocks.findMany } },
}));

import { getActorLabAccess, getActorReadLabAccess } from "@/lib/lab-access";

const actor = {
  id: "lab-user-1",
  role: "animal_staff" as const,
  activeLabId: "lab-1",
  memberships: [{ labId: "lab-1", role: "manager" as const }],
};

describe("ordinary-read lab access reuse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses request memberships only in the explicit read-model helper", async () => {
    await expect(getActorReadLabAccess(actor)).resolves.toMatchObject({
      canViewAll: false,
      memberLabIds: ["lab-1"],
      manageableLabIds: ["lab-1"],
    });

    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("rechecks database membership for command authorization even when the actor has memberships", async () => {
    mocks.findMany.mockResolvedValue([{ labId: "lab-1", role: "staff" }]);

    await expect(getActorLabAccess(actor)).resolves.toMatchObject({
      memberLabIds: ["lab-1"],
      manageableLabIds: ["lab-1"],
    });

    expect(mocks.findMany).toHaveBeenCalledOnce();
  });

  it("keeps the database membership read when a transaction client is provided", async () => {
    const transactionFindMany = vi.fn().mockResolvedValue([{ labId: "lab-1", role: "staff" }]);
    const transaction = { labMembership: { findMany: transactionFindMany } } as unknown as Parameters<typeof getActorLabAccess>[1];

    await expect(getActorLabAccess(actor, transaction)).resolves.toMatchObject({
      memberLabIds: ["lab-1"],
      manageableLabIds: ["lab-1"],
    });

    expect(transactionFindMany).toHaveBeenCalledOnce();
  });

  it("keeps cage-detail mutation authorization inside its write transaction", async () => {
    const colonyWritePath = fileURLToPath(new URL("../../src/lib/colony-write.ts", import.meta.url));
    const source = await readFile(colonyWritePath, "utf8");

    expect(source).toContain("const currentAccess = await getActorLabAccess(actor, tx);");
    expect(source).toContain('throw new Error("You can only edit cages from labs you manage.");');
  });
});
