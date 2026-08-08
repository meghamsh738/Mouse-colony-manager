import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getActorLabAccess: vi.fn(),
}));

vi.mock("@/lib/command-foundation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/command-foundation")>()),
  executeIdempotentCommand: mocks.execute,
}));

vi.mock("@/lib/lab-access", () => ({
  canManageLab: () => true,
  getActorLabAccess: mocks.getActorLabAccess,
}));

import { executeUpdateStrainDirectoryListingCommand } from "@/lib/strain-directory-write";
import type { ResolvedActor } from "@/lib/session";

const manager = {
  id: "manager-2",
  email: "manager-2@example.test",
  name: "Replacement manager",
  role: "animal_staff",
  databaseRole: "lab_user",
  canonicalRole: "lab_user",
  authzVersion: 2,
  activeLabId: "lab-1",
  activeMembership: { labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "manager" },
  memberships: [{ labId: "lab-1", labName: "Lab 1", labCode: "L1", role: "manager" }],
  capabilities: ["strains:discover", "strains:request", "strains:manage"],
} as ResolvedActor;

describe("strain directory inactive-contact reassignment", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.getActorLabAccess.mockReset();
    mocks.getActorLabAccess.mockResolvedValue({
      canViewAll: false,
      memberLabIds: ["lab-1"],
      manageableLabIds: ["lab-1"],
      membershipByLabId: new Map([["lab-1", "manager"]]),
    });
  });

  it("lets a manager reassign ineligible contacts repeatedly, auditing each handoff and privately notifying each replacement", async () => {
    const originalListing = {
      id: "listing-1",
      labId: "lab-1",
      strainId: "strain-1",
      contactUserId: "former-owner",
      status: "shared",
      version: 2,
    };
    const savedListing = {
      ...originalListing,
      contactUserId: "manager-2",
      status: "draft",
      sharedAt: null,
      version: 3,
    };
    const twiceReassignedListing = {
      ...savedListing,
      contactUserId: "manager-3",
      version: 4,
    };
    const tx = {
      strainDirectoryListing: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(originalListing)
          .mockResolvedValueOnce(savedListing),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn()
          .mockResolvedValueOnce(savedListing)
          .mockResolvedValueOnce(twiceReassignedListing),
      },
      strainDirectoryRequest: {
        findMany: vi.fn().mockResolvedValue([{ id: "request-1" }]),
      },
      labMembership: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ labId: "lab-1", userId: "manager-2", role: "manager" })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ role: "manager", user: { id: "manager-2", authzVersion: 2, role: "lab_user" } })
          .mockResolvedValueOnce({ labId: "lab-1", userId: "manager-3", role: "manager" })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ role: "manager", user: { id: "manager-3", authzVersion: 3, role: "lab_user" } }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      notificationEvent: { create: vi.fn().mockResolvedValue({}) },
      notificationAudience: { create: vi.fn().mockResolvedValue({}) },
      notificationRecipient: { create: vi.fn().mockResolvedValue({}) },
    };
    mocks.execute.mockImplementation(({ handler }) => handler(tx));

    const firstResult = await executeUpdateStrainDirectoryListingCommand({
      actor: manager,
      command: { listingId: "listing-1", contactUserId: "manager-2", status: "draft" },
      expectedVersion: 2,
      idempotencyKey: "reassign-ineligible-contact-key",
      requestId: "reassign-ineligible-contact-request",
    });
    const secondResult = await executeUpdateStrainDirectoryListingCommand({
      actor: manager,
      command: { listingId: "listing-1", contactUserId: "manager-3", status: "draft" },
      expectedVersion: 3,
      idempotencyKey: "reassign-second-ineligible-contact-key",
      requestId: "reassign-second-ineligible-contact-request",
    });

    expect(firstResult).toMatchObject({ ok: true, result: { status: "draft", version: 3 } });
    expect(secondResult).toMatchObject({ ok: true, result: { status: "draft", version: 4 } });
    expect(tx.strainDirectoryListing.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "listing-1", version: 2 },
      data: expect.objectContaining({ contactUserId: "manager-2", status: "draft", version: { increment: 1 } }),
    }));
    expect(tx.strainDirectoryListing.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: "listing-1", version: 3 },
      data: expect.objectContaining({ contactUserId: "manager-3", status: "draft", version: { increment: 1 } }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: "reassign_inactive_contact_save_draft",
    }) }));
    expect(tx.notificationEvent.create.mock.calls.map(([input]) => input.data.sourceKey)).toEqual([
      "strain-directory-request:request-1:contact-reassigned:3",
      "strain-directory-request:request-1:contact-reassigned:4",
    ]);
    expect(tx.notificationRecipient.create.mock.calls.map(([input]) => input.data.userId)).toEqual(["manager-2", "manager-3"]);
  });
});
