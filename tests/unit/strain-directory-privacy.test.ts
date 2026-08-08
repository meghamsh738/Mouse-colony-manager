import { beforeEach, describe, expect, it, vi } from "vitest";

const readMocks = vi.hoisted(() => ({
  listingFindMany: vi.fn(),
  animalFindMany: vi.fn(),
  cryostorageFindMany: vi.fn(),
  requestFindMany: vi.fn(),
}));

const accessMocks = vi.hoisted(() => ({ getActorLabAccess: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    strainDirectoryListing: { findMany: readMocks.listingFindMany },
    animal: { findMany: readMocks.animalFindMany },
    cryostorageRecord: { findMany: readMocks.cryostorageFindMany },
    strainDirectoryRequest: { findMany: readMocks.requestFindMany },
  },
}));

vi.mock("@/lib/lab-access", () => ({ getActorLabAccess: accessMocks.getActorLabAccess }));

import { getStrainDirectoryRequestViews, getStrainDirectoryView } from "@/lib/strain-directory-read";
import type { ResolvedActor } from "@/lib/session";

const researcher = {
  id: "researcher-1",
  email: "researcher@example.test",
  name: "Researcher",
  role: "researcher",
  databaseRole: "lab_user",
  canonicalRole: "lab_user",
  authzVersion: 1,
  activeLabId: "requester-lab",
  activeMembership: { labId: "requester-lab", labName: "Requester", labCode: "REQ", role: "viewer" },
  memberships: [{ labId: "requester-lab", labName: "Requester", labCode: "REQ", role: "viewer" }],
  capabilities: ["strains:discover", "strains:request"],
} as ResolvedActor;

beforeEach(() => {
  readMocks.listingFindMany.mockReset();
  readMocks.animalFindMany.mockReset();
  readMocks.cryostorageFindMany.mockReset();
  readMocks.requestFindMany.mockReset();
  accessMocks.getActorLabAccess.mockReset();
  readMocks.listingFindMany.mockResolvedValue([{
    id: "listing-1",
    strainId: "strain-1",
    labId: "holding-lab",
    strain: { id: "strain-1", name: "Example strain", background: "C57BL/6J" },
    lab: { id: "holding-lab", code: "HOLD", name: "Holding lab" },
    contact: { user: { name: "Directory manager" } },
  }]);
  readMocks.animalFindMany.mockResolvedValue([{ strainId: "strain-1", owningLabId: "holding-lab" }]);
  readMocks.cryostorageFindMany.mockResolvedValue([{ strainId: "strain-1", labId: "holding-lab" }]);
  readMocks.requestFindMany.mockResolvedValue([]);
  accessMocks.getActorLabAccess.mockResolvedValue({
    canViewAll: false,
    memberLabIds: ["requester-lab"],
    manageableLabIds: [],
    membershipByLabId: new Map([["requester-lab", "viewer"]]),
  });
});

describe("strain directory privacy projection", () => {
  it("returns a minimal shared directory card and only derives non-numeric availability states", async () => {
    const view = await getStrainDirectoryView(researcher);

    expect(view).toEqual([{
      id: "listing-1",
      strain: { id: "strain-1", name: "Example strain", background: "C57BL/6J" },
      lab: { id: "holding-lab", code: "HOLD", name: "Holding lab" },
      contactName: "Directory manager",
      availability: "active_and_cryopreserved",
    }]);
    expect(Object.keys(view[0] ?? {})).toEqual(["id", "strain", "lab", "contactName", "availability"]);
    expect(JSON.stringify(view)).not.toMatch(/animalId|cage|storageLocation|quantity|health|genotype|project|notes|email/i);
  });

  it("limits the internal availability read to strain/lab identifiers, never sensitive inventory fields", async () => {
    await getStrainDirectoryView(researcher);

    expect(readMocks.animalFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: { strainId: true, owningLabId: true },
    }));
    expect(readMocks.cryostorageFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: { strainId: true, labId: true },
    }));
    expect(readMocks.listingFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "shared" }),
      select: expect.objectContaining({
        strain: { select: { id: true, name: true, background: true } },
        lab: { select: { id: true, code: true, name: true } },
      }),
    }));
  });

  it("keeps sent private requests inside the active requester-lab scope", async () => {
    await getStrainDirectoryRequestViews(researcher);

    expect(readMocks.requestFindMany).toHaveBeenCalledTimes(1);
    expect(readMocks.requestFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { requesterUserId: "researcher-1", requesterLabId: { in: ["requester-lab"] } },
    }));
  });

  it("keeps received private requests inside the selected contact lab", async () => {
    const manager = {
      ...researcher,
      activeLabId: "holding-lab-b",
      activeMembership: { labId: "holding-lab-b", labName: "Holding B", labCode: "HB", role: "manager" as const },
      memberships: [{ labId: "holding-lab-b", labName: "Holding B", labCode: "HB", role: "manager" as const }],
    };
    accessMocks.getActorLabAccess.mockResolvedValue({
      canViewAll: false,
      memberLabIds: ["holding-lab-b"],
      manageableLabIds: ["holding-lab-b"],
      membershipByLabId: new Map([["holding-lab-b", "manager"]]),
    });

    await getStrainDirectoryRequestViews(manager);

    expect(readMocks.requestFindMany).toHaveBeenCalledTimes(2);
    expect(readMocks.requestFindMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        listing: expect.objectContaining({ labId: { in: ["holding-lab-b"] }, contactUserId: "researcher-1" }),
      }),
    }));
  });
});
