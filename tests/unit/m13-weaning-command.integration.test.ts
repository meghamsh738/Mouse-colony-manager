import { beforeEach, describe, expect, it, vi } from "vitest";

import { getActorCapabilities } from "@/lib/capabilities";
import { allocateFacilityIdentifiers } from "@/lib/command-foundation";
import { prisma } from "@/lib/prisma";
import { SEEDED_DEV_EMAILS } from "@/lib/seed-metadata";
import type { ResolvedActor } from "@/lib/session";
import { seedDatabase } from "../../prisma/seed-database";
import {
  DEMO_ADMIN_IDENTITY_LINK_ID,
  DEMO_PROTOCOL_AUTHORIZATION_ID,
} from "../../prisma/seed-demo-compliance";

const mocks = vi.hoisted(() => ({
  resolveCurrentActor: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  resolveCurrentActor: mocks.resolveCurrentActor,
}));

function isDisposableDatabase() {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
      && /^mcm_test_[a-z0-9_-]+$/i.test(url.pathname.replace(/^\//, ""))
      && process.env.ALLOW_DESTRUCTIVE_SEED === "true";
  } catch {
    return false;
  }
}

async function compliantAdminActor(): Promise<ResolvedActor> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: "user-admin" },
    select: { authzVersion: true },
  });
  return {
    id: "user-admin",
    email: SEEDED_DEV_EMAILS.admin,
    name: "Colony Admin",
    role: "admin",
    databaseRole: "facility_admin",
    canonicalRole: "facility_admin",
    authzVersion: user.authzVersion,
    authMethod: "synthetic_mfa",
    assurance: "synthetic_mfa",
    authenticatedAt: new Date().toISOString(),
    identityLinkId: DEMO_ADMIN_IDENTITY_LINK_ID,
    activeDuties: [],
    activeLabId: null,
    activeMembership: null,
    memberships: [],
    capabilities: [...getActorCapabilities({
      canonicalRole: "facility_admin",
      activeMembership: null,
    })],
  };
}

function commandHeaders(key: string) {
  return {
    "content-type": "application/json",
    "idempotency-key": `${key}-idempotency`,
    "x-request-id": `${key}-request`,
  };
}

async function createDestinationCage(capacityOverride?: number) {
  await prisma.$transaction(async (tx) => {
    const [facilityCageId] = await allocateFacilityIdentifiers(tx, "cage", 1);
    await tx.cage.create({
      data: {
        id: "cage-m13-weaning-destination",
        facilityCageId,
        labId: "lab-microglia",
        roomId: "room-a101",
        rackId: "rack-a101-2",
        cageNumber: "098",
        barcode: "CM-M13-WEAN",
        status: "active",
        capacityOverride,
      },
    });
  });
}

async function createGovernedLitter(litterSizeBirth: number) {
  const { POST: createBreedingSetup } = await import("@/app/api/v1/breeding-setups/route");
  const breedingResponse = await createBreedingSetup(
    new Request("http://localhost:3000/api/v1/breeding-setups", {
      method: "POST",
      body: JSON.stringify({
        sireCode: "CM-24001",
        damCode: "CM-24002",
        startDate: "2026-04-18",
        targetGenotype: "M13 legacy weaning verification",
        protocolAuthorizationId: DEMO_PROTOCOL_AUTHORIZATION_ID,
        allowOverride: true,
      }),
    }),
  );
  const breedingPayload = await breedingResponse.json() as { data?: { id: string }; error?: string };
  expect(breedingResponse.status, JSON.stringify(breedingPayload)).toBe(201);
  const { POST: createLitter } = await import("@/app/api/v1/litters/route");
  const litterResponse = await createLitter(
    new Request("http://localhost:3000/api/v1/litters", {
      method: "POST",
      headers: commandHeaders("m13-weaning-litter"),
      body: JSON.stringify({
        breedingSetupId: breedingPayload.data!.id,
        birthDate: "2026-04-20",
        litterSizeBirth,
      }),
    }),
  );
  const litterPayload = await litterResponse.json() as { data?: { id: string }; error?: string };
  expect(litterResponse.status, JSON.stringify(litterPayload)).toBe(201);
  return litterPayload.data!.id;
}

const describeDisposable = describe.runIf(isDisposableDatabase());

describeDisposable.sequential("M13 legacy weaning API command", () => {
  beforeEach(async () => {
    await seedDatabase();
    mocks.resolveCurrentActor.mockReset();
    mocks.resolveCurrentActor.mockResolvedValue(await compliantAdminActor());
  }, 120_000);

  it("consumes surviving pups and releases mortality from the exact litter allocation", async () => {
    await createDestinationCage();
    const litterId = await createGovernedLitter(6);
    const { POST } = await import("@/app/api/v1/weanings/route");
    const response = await POST(new Request("http://localhost:3000/api/v1/weanings", {
      method: "POST",
      headers: commandHeaders("m13-weaning-positive"),
      body: JSON.stringify({
        litterId,
        weanDate: "2026-05-01",
        femaleCount: 5,
        maleCount: 0,
        femaleCageBarcode: "CM-M13-WEAN",
        strainName: "Cx3cr1-CreER x Rosa26-LSL-tdTomato",
      }),
    }));
    expect(response.status, await response.clone().text()).toBe(201);
    const allocation = await prisma.protocolCountAllocation.findFirstOrThrow({
      where: { aggregateType: "litter", aggregateId: litterId },
      include: { history: true },
    });
    expect(allocation).toMatchObject({
      reservedQuantity: 6,
      consumedQuantity: 5,
      releasedQuantity: 1,
      status: "mixed",
    });
    expect(allocation.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ allocationType: "consume", quantity: 5 }),
      expect.objectContaining({ allocationType: "release", quantity: 1 }),
    ]));
  });

  it("rolls back compliance settlement and progeny creation when cage validation fails", async () => {
    await createDestinationCage(1);
    const litterId = await createGovernedLitter(5);
    const allocationBefore = await prisma.protocolCountAllocation.findFirstOrThrow({
      where: { aggregateType: "litter", aggregateId: litterId },
    });
    const { POST } = await import("@/app/api/v1/weanings/route");
    const response = await POST(new Request("http://localhost:3000/api/v1/weanings", {
      method: "POST",
      headers: commandHeaders("m13-weaning-rollback"),
      body: JSON.stringify({
        litterId,
        weanDate: "2026-05-01",
        femaleCount: 5,
        maleCount: 0,
        femaleCageBarcode: "CM-M13-WEAN",
        strainName: "Cx3cr1-CreER x Rosa26-LSL-tdTomato",
      }),
    }));
    expect(response.status).toBe(400);
    await expect(prisma.protocolCountAllocation.findUnique({
      where: { id: allocationBefore.id },
    })).resolves.toMatchObject({
      consumedQuantity: 0,
      releasedQuantity: 0,
      status: "open",
    });
    await expect(prisma.litter.findUnique({
      where: { id: litterId },
      select: { litterSizeWean: true, _count: { select: { litterAnimals: true } } },
    })).resolves.toMatchObject({ litterSizeWean: null, _count: { litterAnimals: 0 } });
    await expect(prisma.complianceEvidenceSnapshot.count({
      where: { commandType: "breeding.wean_litter", aggregateId: litterId },
    })).resolves.toBe(0);
  });

  it("prevents the litter's exact birth allocation link from being removed", async () => {
    const litterId = await createGovernedLitter(5);
    await expect(prisma.litter.update({
      where: { id: litterId },
      data: { protocolCountAllocationId: null },
    })).rejects.toThrow(/compliance evidence links are immutable/i);
  });

  it("replays one successful receipt without settling the allocation twice", async () => {
    await createDestinationCage();
    const litterId = await createGovernedLitter(5);
    const { POST } = await import("@/app/api/v1/weanings/route");
    const body = JSON.stringify({
      litterId,
      weanDate: "2026-05-01",
      femaleCount: 5,
      maleCount: 0,
      femaleCageBarcode: "CM-M13-WEAN",
      strainName: "Cx3cr1-CreER x Rosa26-LSL-tdTomato",
    });
    const first = await POST(new Request("http://localhost:3000/api/v1/weanings", {
      method: "POST", headers: commandHeaders("m13-weaning-replay"), body,
    }));
    const replay = await POST(new Request("http://localhost:3000/api/v1/weanings", {
      method: "POST", headers: commandHeaders("m13-weaning-replay"), body,
    }));
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ meta: { created: false } });
    const allocation = await prisma.protocolCountAllocation.findFirstOrThrow({
      where: { aggregateType: "litter", aggregateId: litterId },
      include: { history: true },
    });
    expect(allocation.history.filter((entry) => entry.allocationType === "consume")).toHaveLength(1);
    await expect(prisma.commandReceipt.count({
      where: { actorId: "user-admin", commandType: "breeding.wean_litter", status: "succeeded" },
    })).resolves.toBe(1);
  });
});
