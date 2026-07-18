import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cookies: vi.fn(),
  findUnique: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.findUnique } } }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { resolveCurrentActor } from "@/lib/session";

const databaseUser = {
  id: "user-lab",
  email: "lab@example.test",
  name: "Lab User",
  role: "lab_user",
  active: true,
  authzVersion: 4,
  labMemberships: [{
    labId: "lab-1",
    role: "staff",
    lab: { name: "Lab One", code: "L1" },
  }],
};

describe("database-revalidated session actor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "lab-1" })) });
  });

  it("rejects a stale JWT after authorization version changes", async () => {
    mocks.auth.mockResolvedValue({ user: { id: databaseUser.id, authzVersion: 3 } });
    mocks.findUnique.mockResolvedValue(databaseUser);
    await expect(resolveCurrentActor()).resolves.toBeNull();
  });

  it("rejects a deactivated database account even when the JWT is valid", async () => {
    mocks.auth.mockResolvedValue({ user: { id: databaseUser.id, authzVersion: 4 } });
    mocks.findUnique.mockResolvedValue({ ...databaseUser, active: false });
    await expect(resolveCurrentActor()).resolves.toBeNull();
  });

  it("derives lab authority and capabilities from current database membership", async () => {
    mocks.auth.mockResolvedValue({ user: { id: databaseUser.id, authzVersion: 4 } });
    mocks.findUnique.mockResolvedValue(databaseUser);
    await expect(resolveCurrentActor()).resolves.toMatchObject({
      id: databaseUser.id,
      canonicalRole: "lab_user",
      activeLabId: "lab-1",
      activeMembership: { labId: "lab-1", role: "staff" },
      capabilities: expect.arrayContaining(["animals:read", "animals:manage"]),
    });
  });
});
