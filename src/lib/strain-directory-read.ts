import { actorHasCapability } from "@/lib/capabilities";
import { getActorLabAccess } from "@/lib/lab-access";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";

const terminalAnimalStatuses = ["euthanized", "dead", "transferred_out", "archived"] as const;
const nonLabDirectoryRoles = ["it_head", "facility_admin", "cmu_staff", "admin", "colony_manager"] as const;

export type DirectoryAvailability = "active_colony" | "cryopreserved" | "active_and_cryopreserved" | "availability_to_confirm";

export type StrainDirectoryItem = {
  id: string;
  strain: { id: string; name: string; background: string | null };
  lab: { id: string; code: string; name: string };
  contactName: string;
  availability: DirectoryAvailability;
};

export type StrainDirectoryListingManagerItem = {
  id: string;
  labId: string;
  labLabel: string;
  strainId: string;
  strainName: string;
  contactUserId: string;
  contactName: string;
  status: "draft" | "shared" | "paused";
  version: number;
};

export type StrainDirectoryRequestItem = {
  id: string;
  listingId: string;
  strainName: string;
  holdingLabLabel: string;
  requesterLabLabel: string;
  requesterName: string;
  requestType: "contact" | "material";
  purpose: string | null;
  status: "submitted" | "accepted" | "declined" | "cancelled";
  decisionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  version: number;
};

function availabilityFor(input: { activeColony: boolean; cryopreserved: boolean }): DirectoryAvailability {
  if (input.activeColony && input.cryopreserved) return "active_and_cryopreserved";
  if (input.activeColony) return "active_colony";
  if (input.cryopreserved) return "cryopreserved";
  return "availability_to_confirm";
}

function directoryPairKey(strainId: string, labId: string) {
  return `${strainId}:${labId}`;
}

async function getAvailabilityByListingPair(listings: Array<{ strainId: string; labId: string }>) {
  if (!listings.length) return new Map<string, DirectoryAvailability>();
  const pairs = listings.map((listing) => ({ strainId: listing.strainId, labId: listing.labId }));
  const [animals, cryostorage] = await Promise.all([
    prisma.animal.findMany({
      where: {
        status: { notIn: [...terminalAnimalStatuses] },
        OR: pairs.map((pair) => ({ strainId: pair.strainId, owningLabId: pair.labId })),
      },
      select: { strainId: true, owningLabId: true },
      distinct: ["strainId", "owningLabId"],
    }),
    prisma.cryostorageRecord.findMany({
      where: {
        status: { in: ["stored", "reserved"] },
        OR: pairs.map((pair) => ({ strainId: pair.strainId, labId: pair.labId })),
      },
      select: { strainId: true, labId: true },
      distinct: ["strainId", "labId"],
    }),
  ]);
  const activePairs = new Set(animals.map((animal) => directoryPairKey(animal.strainId, animal.owningLabId)));
  const cryopreservedPairs = new Set(cryostorage.map((record) => directoryPairKey(record.strainId, record.labId)));
  return new Map(listings.map((listing) => {
    const key = directoryPairKey(listing.strainId, listing.labId);
    return [key, availabilityFor({ activeColony: activePairs.has(key), cryopreserved: cryopreservedPairs.has(key) })];
  }));
}

export async function getStrainDirectoryView(actor: ResolvedActor): Promise<StrainDirectoryItem[]> {
  if (!actorHasCapability(actor, "strains:discover")) return [];
  const listings = await prisma.strainDirectoryListing.findMany({
    where: {
      status: "shared",
      lab: { active: true },
      contact: {
        active: true,
        role: { in: ["owner", "manager"] },
        user: { active: true, role: { notIn: [...nonLabDirectoryRoles] } },
      },
    },
    orderBy: [{ strain: { name: "asc" } }, { lab: { name: "asc" } }],
    select: {
      id: true,
      strainId: true,
      labId: true,
      strain: { select: { id: true, name: true, background: true } },
      lab: { select: { id: true, code: true, name: true } },
      contact: { select: { user: { select: { name: true } } } },
    },
  });
  const availabilityByPair = await getAvailabilityByListingPair(listings);
  return listings.map((listing) => ({
    id: listing.id,
    strain: listing.strain,
    lab: listing.lab,
    contactName: listing.contact.user.name,
    availability: availabilityByPair.get(directoryPairKey(listing.strainId, listing.labId)) ?? "availability_to_confirm",
  }));
}

export async function getStrainDirectoryManagementView(actor: ResolvedActor) {
  if (!actorHasCapability(actor, "strains:manage")) {
    return { labs: [], strains: [], contacts: [], listings: [] as StrainDirectoryListingManagerItem[] };
  }
  const access = await getActorLabAccess(actor);
  const labIds = access.canViewAll ? undefined : access.manageableLabIds;
  const [labs, strains, contactRows, listings] = await Promise.all([
    prisma.lab.findMany({
      where: { active: true, ...(labIds ? { id: { in: labIds } } : {}) },
      orderBy: [{ name: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    prisma.strain.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.labMembership.findMany({
      where: {
        active: true,
        role: { in: ["owner", "manager"] },
        lab: { active: true, ...(labIds ? { id: { in: labIds } } : {}) },
        user: { active: true, role: { notIn: [...nonLabDirectoryRoles] } },
      },
      orderBy: [{ lab: { name: "asc" } }, { user: { name: "asc" } }],
      select: { labId: true, userId: true, role: true, user: { select: { name: true } } },
    }),
    prisma.strainDirectoryListing.findMany({
      where: labIds ? { labId: { in: labIds } } : {},
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: {
        id: true,
        labId: true,
        strainId: true,
        contactUserId: true,
        status: true,
        version: true,
        lab: { select: { code: true, name: true } },
        strain: { select: { name: true } },
        contact: { select: { user: { select: { name: true } } } },
      },
    }),
  ]);
  return {
    labs: labs.map((lab) => ({ id: lab.id, label: `${lab.code} · ${lab.name}` })),
    strains,
    contacts: contactRows.map((contact) => ({
      labId: contact.labId,
      userId: contact.userId,
      label: `${contact.user.name} · ${contact.role}`,
    })),
    listings: listings.map((listing) => ({
      id: listing.id,
      labId: listing.labId,
      labLabel: `${listing.lab.code} · ${listing.lab.name}`,
      strainId: listing.strainId,
      strainName: listing.strain.name,
      contactUserId: listing.contactUserId,
      contactName: listing.contact.user.name,
      status: listing.status,
      version: listing.version,
    })),
  };
}

function mapRequest(request: {
  id: string;
  listingId: string;
  requestType: "contact" | "material";
  purpose: string | null;
  status: "submitted" | "accepted" | "declined" | "cancelled";
  decisionReason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  version: number;
  requester: { name: string };
  requesterLab: { code: string; name: string };
  listing: { strain: { name: string }; lab: { code: string; name: string } };
}): StrainDirectoryRequestItem {
  return {
    id: request.id,
    listingId: request.listingId,
    strainName: request.listing.strain.name,
    holdingLabLabel: `${request.listing.lab.code} · ${request.listing.lab.name}`,
    requesterLabLabel: `${request.requesterLab.code} · ${request.requesterLab.name}`,
    requesterName: request.requester.name,
    requestType: request.requestType,
    purpose: request.purpose,
    status: request.status,
    decisionReason: request.decisionReason,
    createdAt: request.createdAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString() ?? null,
    version: request.version,
  };
}

export async function getStrainDirectoryRequestViews(actor: ResolvedActor) {
  const access = await getActorLabAccess(actor);
  const activeLabIds = access.memberLabIds;
  if (!activeLabIds.length) return { sent: [], received: [] };
  const commonSelect = {
    id: true,
    listingId: true,
    requestType: true,
    purpose: true,
    status: true,
    decisionReason: true,
    createdAt: true,
    decidedAt: true,
    version: true,
    requester: { select: { name: true } },
    requesterLab: { select: { code: true, name: true } },
    listing: { select: { strain: { select: { name: true } }, lab: { select: { code: true, name: true } } } },
  } as const;
  const [sent, received] = await Promise.all([
    prisma.strainDirectoryRequest.findMany({
      where: { requesterUserId: actor.id, requesterLabId: { in: activeLabIds } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: commonSelect,
    }),
    actorHasCapability(actor, "strains:manage")
      ? prisma.strainDirectoryRequest.findMany({
          where: {
            listing: {
              contactUserId: actor.id,
              labId: { in: activeLabIds },
              contact: {
                active: true,
                role: { in: ["owner", "manager"] },
                user: { active: true, role: { notIn: [...nonLabDirectoryRoles] } },
              },
            },
          },
          orderBy: [{ status: "asc" }, { createdAt: "desc" }, { id: "asc" }],
          select: commonSelect,
        })
      : Promise.resolve([]),
  ]);
  return { sent: sent.map(mapRequest), received: received.map(mapRequest) };
}
