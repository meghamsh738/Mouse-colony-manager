import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { getAnimalDetailView } from "@/lib/animals-read";
import { getActorCapabilities } from "@/lib/capabilities";
import { allocateFacilityIdentifiers } from "@/lib/command-foundation";
import { SEEDED_DEV_EMAILS } from "@/lib/seed-metadata";
import { prisma } from "@/lib/prisma";
import type { ResolvedActor } from "@/lib/session";
import {
  executeAssignSopVersionCommand,
  executeCreateSopCommand,
  executeDecideSopVersionCommand,
} from "@/lib/sop-write";
import { seedDatabase } from "../../prisma/seed-database";

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: authMock,
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
}));

function authenticatedSession() {
  return {
    user: {
      id: "user-admin",
      email: SEEDED_DEV_EMAILS.admin,
      name: "Colony Admin",
      role: "admin" as const,
      authzVersion: 1,
    },
  };
}

function readOnlySession() {
  return {
    user: {
      id: "user-readonly",
      email: SEEDED_DEV_EMAILS.readonly,
      name: "Readonly User",
      role: "read_only" as const,
      authzVersion: 1,
    },
  };
}

async function createApiWeaningCage() {
  await prisma.$transaction(async (tx) => {
    const [facilityCageId] = await allocateFacilityIdentifiers(tx, "cage", 1);
    await tx.cage.create({
      data: {
        id: "cage-api-weaning-males",
        facilityCageId,
        labId: "lab-microglia",
        roomId: "room-a101",
        rackId: "rack-a101-2",
        cageNumber: "098",
        barcode: "CM-API-WEAN-MALE",
        status: "active",
      },
    });
  });
}

function systemActor(input: {
  id: string;
  role: "facility_admin" | "cmu_staff";
}): ResolvedActor {
  return {
    id: input.id,
    email: input.role === "facility_admin" ? SEEDED_DEV_EMAILS.admin : SEEDED_DEV_EMAILS.manager,
    name: input.role === "facility_admin" ? "Colony Admin" : "Colony Manager",
    role: input.role === "facility_admin" ? "admin" : "colony_manager",
    databaseRole: input.role,
    canonicalRole: input.role,
    authzVersion: 1,
    activeLabId: null,
    activeMembership: null,
    memberships: [],
    capabilities: [...getActorCapabilities({ canonicalRole: input.role, activeMembership: null })],
  };
}

async function createApiEuthanasiaSopAssignment() {
  const cmu = systemActor({ id: "user-manager", role: "cmu_staff" });
  const facility = systemActor({ id: "user-admin", role: "facility_admin" });
  const created = await executeCreateSopCommand({
    actor: cmu,
    command: {
      scope: "facility",
      code: "FAC-EUTH-API-001",
      title: "Humane euthanasia API test",
      category: "Welfare",
      contentMarkdown: "Confirm the approved endpoint, identify the animal, perform the controlled procedure, and record the outcome.",
      changeSummary: "Controlled integration API test version",
    },
    idempotencyKey: "api-euthanasia-sop-create",
    requestId: "api-euthanasia-sop-create-request",
  });
  expect(created.ok, JSON.stringify(created)).toBe(true);
  if (!created.ok) throw new Error(created.message);
  const createdResult = created.result as { documentId: string; versionId: string };
  const pendingDocument = await prisma.sopDocument.findUniqueOrThrow({ where: { id: createdResult.documentId } });
  const decided = await executeDecideSopVersionCommand({
    actor: facility,
    command: {
      sopId: createdResult.documentId,
      versionId: createdResult.versionId,
      decision: "approved",
      note: "Approved for external lifecycle integration verification.",
    },
    expectedVersion: pendingDocument.version,
    idempotencyKey: "api-euthanasia-sop-approve",
    requestId: "api-euthanasia-sop-approve-request",
  });
  expect(decided.ok, JSON.stringify(decided)).toBe(true);
  if (!decided.ok) throw new Error(decided.message);
  const approvedDocument = await prisma.sopDocument.findUniqueOrThrow({ where: { id: createdResult.documentId } });
  const assigned = await executeAssignSopVersionCommand({
    actor: cmu,
    command: {
      sopId: createdResult.documentId,
      versionId: createdResult.versionId,
      labId: "lab-microglia",
      reason: "Required for humane endpoint records created through the integration API.",
    },
    expectedVersion: approvedDocument.version,
    idempotencyKey: "api-euthanasia-sop-assign",
    requestId: "api-euthanasia-sop-assign-request",
  });
  expect(assigned.ok, JSON.stringify(assigned)).toBe(true);
  if (!assigned.ok) throw new Error(assigned.message);
  return (assigned.result as { assignmentId: string }).assignmentId;
}

function commandHeaders(key: string) {
  return {
    "content-type": "application/json",
    "idempotency-key": `${key}-idempotency`,
    "x-request-id": `${key}-request`,
  };
}

async function experimentVersion(experimentCode = "EXP-LPS-005") {
  return (await prisma.experiment.findUniqueOrThrow({
    where: { experimentCode },
    select: { version: true },
  })).version;
}

async function animalVersion(animalCode: string) {
  return (await prisma.animal.findUniqueOrThrow({
    where: { animalId: animalCode },
    select: { version: true },
  })).version;
}

async function exactTimestampAfterSopAssignment(assignmentId: string) {
  await prisma.sopAssignment.findUniqueOrThrow({
    where: { id: assignmentId },
    select: { id: true },
  });
  return new Date().toISOString();
}

describe("integration API routes", () => {
  beforeEach(async () => {
    authMock.mockReset();
    await seedDatabase();
  }, 120_000);

  it("rejects unauthenticated list requests", async () => {
    authMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/v1/animals/route");
    const response = await GET(new Request("http://localhost:3000/api/v1/animals"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
  });

  it("returns filtered animal summaries from the authenticated list route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { GET } = await import("@/app/api/v1/animals/route");
    const response = await GET(
      new Request("http://localhost:3000/api/v1/animals?sex=male&availableOnly=true&limit=2"),
    );
    const payload = (await response.json()) as {
      data: Array<{ sex: string; availableForExperiment: boolean }>;
      meta: { count: number; total: number; filters: Record<string, string | boolean> };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.count).toBeGreaterThan(0);
    expect(payload.meta.total).toBeGreaterThanOrEqual(payload.meta.count);
    expect(payload.meta.filters).toMatchObject({ sex: "male", availableOnly: true });
    expect(payload.data.every((animal) => animal.sex === "male" && animal.availableForExperiment)).toBe(true);
  });

  it("filters animal lists to the lab user's active lab", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { GET } = await import("@/app/api/v1/animals/route");
    const response = await GET(new Request("http://localhost:3000/api/v1/animals"));
    const payload = (await response.json()) as {
      data: Array<{ animalId: string; owningLabId: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(payload.data.length).toBeGreaterThan(0);
    expect(payload.data.every((animal) => animal.owningLabId === "lab-neuroimmune")).toBe(true);
    expect(payload.data.some((animal) => animal.animalId === "CM-24001")).toBe(false);
  });

  it("returns 404 for a foreign-lab direct animal lookup", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { GET } = await import("@/app/api/v1/animals/[animalId]/route");
    const response = await GET(
      new Request("http://localhost:3000/api/v1/animals/animal-001"),
      { params: Promise.resolve({ animalId: "animal-001" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Animal not found" });
  });

  it("does not resolve a foreign-lab cage through the scan lookup route", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { GET } = await import("@/app/scan/lookup/route");
    const response = await GET(
      new NextRequest("http://localhost:3000/scan/lookup?barcode=CM-A101-003"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Cage not found" });
  });

  it("creates animal records through the external animal route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/animals/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/animals", {
        method: "POST",
        body: JSON.stringify({
          animalCode: "CM-26099",
          labId: "MC-2026-099",
          sex: "female",
          dob: "2026-03-10",
          strainName: "C57BL/6J",
          cageBarcode: "CM-A101-003",
          projectCode: "PRJ-MICRO-24",
          notes: "Created by the authenticated animal intake route test.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: {
        animal: {
          animalId: string;
          labId: string;
          status: string;
          outcomeStatus: string;
        };
        cageLabel: string;
        strainName: string;
        projectCodes: string[];
      };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(201);
    expect(payload.meta.created).toBe(true);
    expect(payload.meta.message).toContain("CM-26099 was added to the active colony");
    expect(payload.data).toMatchObject({
      animal: {
        animalId: "CM-26099",
        labId: "MC-2026-099",
        status: "colony_holding",
        outcomeStatus: "alive",
      },
      cageLabel: "A101 / R2 / 003",
      strainName: "C57BL/6J",
      projectCodes: ["PRJ-MICRO-24"],
    });

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "animal",
          action: "create",
          newValue: {
            path: ["animalId"],
            equals: "CM-26099",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("updates animal lifecycle state through the external animal route", async () => {
    authMock.mockResolvedValue(authenticatedSession());
    const sopAssignmentId = await createApiEuthanasiaSopAssignment();
    const happenedAt = await exactTimestampAfterSopAssignment(sopAssignmentId);

    const { PATCH } = await import("@/app/api/v1/animals/route");
    const version = (await prisma.animal.findFirstOrThrow({
      where: { animalId: "CM-26005" },
      select: { version: true },
    })).version;
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/animals", {
        method: "PATCH",
        body: JSON.stringify({
          animalCode: "CM-26005",
          targetStatus: "euthanized",
          happenedAt,
          reason: "External colony system recorded humane endpoint completion.",
          sopAssignmentId,
          expectedVersion: version,
          confirmed: true,
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: {
        animal: {
          animalId: string;
          status: string;
          outcomeStatus: string;
          deathReason: string | null;
        };
        cageLabel: string | null;
      };
      meta: { created: boolean; message: string };
    };

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("CM-26005 marked euthanized");
    expect(payload.data.animal).toMatchObject({
      animalId: "CM-26005",
      status: "euthanized",
      outcomeStatus: "euthanized",
      deathReason: "External colony system recorded humane endpoint completion.",
    });
    expect(payload.data.cageLabel).toBe("Not in cage");

    const statusEvent = await prisma.animalStatusEvent.findFirstOrThrow({
      where: { animal: { animalId: "CM-26005" }, toStatus: "euthanized" },
      select: {
        id: true,
        sopAssignmentId: true,
        sopId: true,
        sopVersionId: true,
        sopVersionNumber: true,
        sopContentHash: true,
      },
    });
    expect(statusEvent).toMatchObject({
      sopAssignmentId,
      sopVersionNumber: 1,
    });
    expect(statusEvent.sopId).toBeTruthy();
    expect(statusEvent.sopVersionId).toBeTruthy();
    expect(statusEvent.sopContentHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(prisma.animalStatusEvent.update({
      where: { id: statusEvent.id },
      data: { reason: "History mutation must be rejected." },
    })).rejects.toThrow(/append-only history/i);

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "animal",
          action: "lifecycle_update",
          newValue: {
            path: ["status"],
            equals: "euthanized",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("treats repeated terminal lifecycle sync as idempotent", async () => {
    authMock.mockResolvedValue(authenticatedSession());
    const sopAssignmentId = await createApiEuthanasiaSopAssignment();
    const happenedAt = await exactTimestampAfterSopAssignment(sopAssignmentId);

    const { PATCH } = await import("@/app/api/v1/animals/route");
    const lifecycleAnimal = await prisma.animal.findFirstOrThrow({
      where: { animalId: "CM-26005" },
      select: { id: true, version: true },
    });
    const requestBody = {
      animalCode: "CM-26005",
      targetStatus: "euthanized",
      happenedAt,
      reason: "External colony system recorded humane endpoint completion.",
      sopAssignmentId,
      expectedVersion: lifecycleAnimal.version,
      confirmed: true,
    };
    const headers = {
      "content-type": "application/json",
      "idempotency-key": "api-lifecycle-repeat-2026",
      "x-workflow-id": "api-lifecycle-repeat-workflow-2026",
    };

    await PATCH(
      new Request("http://localhost:3000/api/v1/animals", {
        method: "PATCH",
        headers,
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/animals", {
        method: "PATCH",
        headers,
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as {
      data: { animal: { status: string } };
      meta: { created: boolean; message: string };
    };

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("marked euthanized");
    expect(payload.data.animal.status).toBe("euthanized");
    const resultingVersion = (await prisma.animal.findUniqueOrThrow({
      where: { id: lifecycleAnimal.id },
      select: { version: true },
    })).version;
    const conflictResponse = await PATCH(
      new Request("http://localhost:3000/api/v1/animals", {
        method: "PATCH",
        headers: { ...headers, "x-workflow-id": "api-lifecycle-conflicting-workflow-2026" },
        body: JSON.stringify({
          ...requestBody,
          targetStatus: "archived",
          happenedAt: "2026-04-19",
          sopAssignmentId: undefined,
          reason: "Conflicting reuse of the lifecycle idempotency key must fail.",
          expectedVersion: resultingVersion,
        }),
      }),
    );
    expect(conflictResponse.status).toBe(409);
    await expect(prisma.animal.findUniqueOrThrow({
      where: { id: lifecycleAnimal.id },
      select: { status: true },
    })).resolves.toEqual({ status: "euthanized" });
    await expect(prisma.commandReceipt.count({
      where: {
        aggregateType: "animal",
        aggregateId: lifecycleAnimal.id,
        commandType: "animal.lifecycle.update",
      },
    })).resolves.toBe(1);
  });

  it("returns external-transfer provenance through the animal API", async () => {
    authMock.mockResolvedValue(authenticatedSession());
    const animal = await prisma.animal.findFirstOrThrow({
      where: { animalId: "CM-26005" },
      select: { version: true },
    });
    const { PATCH } = await import("@/app/api/v1/animals/route");
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/animals", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          animalCode: "CM-26005",
          targetStatus: "transferred_out",
          happenedAt: "2026-04-18",
          reason: "Transferred to the external partner after review.",
          destination: "External Partner Facility",
          transferReference: "EXT-26003",
          expectedVersion: animal.version,
          confirmed: true,
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: {
        animal: {
          status: string;
          externalTransfer: {
            destination: string;
            reference: string | null;
            happenedAt: string;
            reason: string;
          } | null;
        };
        cageLabel: string;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.data.animal.status).toBe("transferred_out");
    expect(payload.data.animal.externalTransfer).toEqual({
      destination: "External Partner Facility",
      reference: "EXT-26003",
      happenedAt: "2026-04-18",
      reason: "Transferred to the external partner after review.",
    });
    expect(payload.data.cageLabel).toBe("Not in cage");
  });

  it("rejects nonexistent lifecycle calendar dates without changing the animal", async () => {
    authMock.mockResolvedValue(authenticatedSession());
    const before = await prisma.animal.findFirstOrThrow({
      where: { animalId: "CM-26003" },
      select: { id: true, status: true, version: true },
    });
    const { PATCH } = await import("@/app/api/v1/animals/route");
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/animals", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          animalCode: "CM-26003",
          targetStatus: "dead",
          happenedAt: "2026-02-30",
          reason: "This invalid date must not normalize.",
          expectedVersion: before.version,
          confirmed: true,
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(prisma.animal.findUniqueOrThrow({
      where: { id: before.id },
      select: { status: true, version: true },
    })).resolves.toEqual({ status: before.status, version: before.version });
  });

  it("treats repeated animal intake as idempotent", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/animals/route");
    const requestBody = {
      animalCode: "CM-26099",
      labId: "MC-2026-099",
      sex: "female",
      dob: "2026-03-10",
      strainName: "C57BL/6J",
      cageBarcode: "CM-A101-003",
      projectCode: "PRJ-MICRO-24",
      notes: "Repeated by the authenticated animal intake route test.",
    };

    await POST(
      new Request("http://localhost:3000/api/v1/animals", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/v1/animals", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as {
      data: { animal: { animalId: string; status: string } };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("already matches the submitted animal intake record");
    expect(payload.data.animal.animalId).toBe("CM-26099");
    expect(payload.data.animal.status).toBe("colony_holding");
  });

  it("rejects read-only animal lifecycle sync requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { PATCH } = await import("@/app/api/v1/animals/route");
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/animals", {
        method: "PATCH",
        body: JSON.stringify({
          animalCode: "CM-26003",
          targetStatus: "dead",
          happenedAt: "2026-04-18",
          reason: "Readonly user should not perform lifecycle sync.",
          confirmed: true,
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Forbidden",
    });
  });

  it("rejects read-only animal intake requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { POST } = await import("@/app/api/v1/animals/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/animals", {
        method: "POST",
        body: JSON.stringify({
          animalCode: "CM-26099",
          labId: "MC-2026-099",
          sex: "female",
          dob: "2026-03-10",
          strainName: "C57BL/6J",
          cageBarcode: "CM-A101-003",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Forbidden",
    });
  });

  it("returns animal detail records for known ids", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { GET } = await import("@/app/api/v1/animals/[animalId]/route");
    const response = await GET(new Request("http://localhost:3000/api/v1/animals/animal-003"), {
      params: Promise.resolve({ animalId: "animal-003" }),
    });
    const payload = (await response.json()) as {
      data: {
        animal: { animalId: string };
        genotypeSummary: string;
        genotypingRecords: Array<unknown>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.data.animal.animalId).toBe("CM-26003");
    expect(payload.data.genotypeSummary).toContain("CreER");
    expect(payload.data.genotypingRecords.length).toBeGreaterThan(0);
  });

  it("publishes the integration index including write-capable intake routes", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { GET } = await import("@/app/api/v1/route");
    const response = await GET(new Request("http://localhost:3000/api/v1"));
    const payload = (await response.json()) as {
      data: {
        resources: Array<{ name: string; path: string; methods?: string[] }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.data.resources.find((resource) => resource.name === "animals")).toMatchObject({
      path: "/api/v1/animals",
      methods: ["GET", "POST", "PATCH"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "samples")).toMatchObject({
      path: "/api/v1/samples",
      methods: ["GET", "POST", "PATCH"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "cryostorage")).toMatchObject({
      path: "/api/v1/cryostorage",
      methods: ["GET", "POST", "PATCH"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "cage-health-notes")).toMatchObject({
      path: "/api/v1/cages/health-notes",
      methods: ["POST"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "breeding-setups")).toMatchObject({
      path: "/api/v1/breeding-setups",
      methods: ["POST"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "litters")).toMatchObject({
      path: "/api/v1/litters",
      methods: ["POST"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "weanings")).toMatchObject({
      path: "/api/v1/weanings",
      methods: ["POST"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "cages")).toMatchObject({
      path: "/api/v1/cages",
      methods: ["GET", "PATCH"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "genotypes")).toMatchObject({
      path: "/api/v1/genotypes",
      methods: ["POST"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "genotype-import")).toMatchObject({
      path: "/api/v1/genotypes/import",
      methods: ["POST"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "rules")).toMatchObject({
      path: "/api/v1/rules",
      methods: ["GET", "PATCH"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "projects")).toMatchObject({
      path: "/api/v1/projects",
      methods: ["GET", "POST", "PATCH"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "experiment-assignments")).toMatchObject({
      path: "/api/v1/experiments/assignments",
      methods: ["POST", "PATCH", "DELETE"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "experiment-reservations")).toMatchObject({
      path: "/api/v1/experiments/reservations",
      methods: ["POST"],
    });
  });

  it("creates project records through the external project route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/projects/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          projectCode: "PRJ-EXT-88",
          title: "External viral-vector validation",
          ownerEmail: SEEDED_DEV_EMAILS.researcher,
          notes: "Synced from an external protocol registry.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: { projectCode: string; title: string; ownerEmail: string; notes: string | null };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(201);
    expect(payload.meta.created).toBe(true);
    expect(payload.meta.message).toContain("PRJ-EXT-88 was synced into the project catalog");
    expect(payload.data).toMatchObject({
      projectCode: "PRJ-EXT-88",
      title: "External viral-vector validation",
      ownerEmail: SEEDED_DEV_EMAILS.researcher,
      notes: "Synced from an external protocol registry.",
    });

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "project",
          action: "create",
          newValue: {
            path: ["projectCode"],
            equals: "PRJ-EXT-88",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("treats repeated project intake as idempotent", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/projects/route");
    const requestBody = {
      projectCode: "PRJ-EXT-88",
      title: "External viral-vector validation",
      ownerEmail: SEEDED_DEV_EMAILS.researcher,
      notes: "Synced from an external protocol registry.",
    };

    await POST(
      new Request("http://localhost:3000/api/v1/projects", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/v1/projects", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as {
      data: { projectCode: string; title: string };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("already matches the submitted project record");
    expect(payload.data).toMatchObject({
      projectCode: "PRJ-EXT-88",
      title: "External viral-vector validation",
    });
  });

  it("updates project records through the external project route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { PATCH } = await import("@/app/api/v1/projects/route");
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/projects", {
        method: "PATCH",
        body: JSON.stringify({
          projectCode: "PRJ-NEURO-07",
          title: "Neuroimmune response pilot extension",
          ownerEmail: SEEDED_DEV_EMAILS.admin,
          notes: "Updated from the external protocol registry.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: { projectCode: string; title: string; ownerEmail: string; notes: string | null };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("PRJ-NEURO-07 was updated");
    expect(payload.data).toMatchObject({
      projectCode: "PRJ-NEURO-07",
      title: "Neuroimmune response pilot extension",
      ownerEmail: SEEDED_DEV_EMAILS.admin,
      notes: "Updated from the external protocol registry.",
    });

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "project",
          action: "update",
          entityId: "project-neuro",
          newValue: {
            path: ["title"],
            equals: "Neuroimmune response pilot extension",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("rejects invalid project sync payloads", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/projects/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          projectCode: "PX",
          title: "",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid project payload." });
  });

  it("rejects read-only project sync requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { PATCH, POST } = await import("@/app/api/v1/projects/route");
    const createResponse = await POST(
      new Request("http://localhost:3000/api/v1/projects", {
        method: "POST",
        body: JSON.stringify({
          projectCode: "PRJ-EXT-88",
          title: "External viral-vector validation",
        }),
      }),
    );
    const updateResponse = await PATCH(
      new Request("http://localhost:3000/api/v1/projects", {
        method: "PATCH",
        body: JSON.stringify({
          projectCode: "PRJ-NEURO-07",
          title: "Readonly update should fail",
        }),
      }),
    );

    expect(createResponse.status).toBe(403);
    await expect(createResponse.json()).resolves.toMatchObject({
      error: "Forbidden",
    });
    expect(updateResponse.status).toBe(403);
    await expect(updateResponse.json()).resolves.toMatchObject({
      error: "Forbidden",
    });
  });

  it("publishes the export discovery catalog", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { GET } = await import("@/app/api/v1/exports/route");
    const response = await GET(new Request("http://localhost:3000/api/v1/exports"));
    const payload = (await response.json()) as {
      data: Array<{ entity: string; csvUrl: string; supportedFilters: string[] }>;
      meta: { count: number };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.count).toBe(4);
    expect(payload.data.find((entry) => entry.entity === "animals")).toMatchObject({
      csvUrl: "http://localhost:3000/api/exports/animals",
      supportedFilters: ["search", "status", "availableOnly"],
    });
  });

  it("logs external cage welfare events through the cage health-note route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/cages/health-notes/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/cages/health-notes", {
        method: "POST",
        body: JSON.stringify({
          cageBarcode: "CM-A101-003",
          noteType: "routine_welfare",
          severity: "warning",
          note: "External rack sensor reported persistent wet bedding.",
          followupRequired: true,
          actionTaken: "Flagged for cage-change triage.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: {
        cageBarcode: string;
        noteType: string;
        severity: string;
        note: string;
        followupRequired: boolean;
        actionTaken: string;
      };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(201);
    expect(payload.meta.created).toBe(true);
    expect(payload.data).toMatchObject({
      cageBarcode: "CM-A101-003",
      noteType: "routine_welfare",
      severity: "warning",
      note: "External rack sensor reported persistent wet bedding.",
      followupRequired: true,
      actionTaken: "Flagged for cage-change triage.",
    });

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "health_note",
          action: "create",
          newValue: {
            path: ["severity"],
            equals: "warning",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("creates breeding setups through the external breeding route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/breeding-setups/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/breeding-setups", {
        method: "POST",
        body: JSON.stringify({
          sireCode: "CM-24001",
          damCode: "CM-24002",
          startDate: "2026-04-18",
          targetGenotype: "CreER maintenance API",
          targetSex: "female",
          notes: "Created by the authenticated breeding integration route test.",
          allowOverride: true,
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: {
        id: string;
        status: string;
        targetGenotype: string;
        targetSex: string;
        adults: Array<{ role: string; animalCode: string; status: string; cageBarcode: string | null }>;
      };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(201);
    expect(payload.meta.created).toBe(true);
    expect(payload.meta.message).toContain("Breeding setup created for CM-24001 and CM-24002");
    expect(payload.data).toMatchObject({
      status: "active",
      targetGenotype: "CreER maintenance API",
      targetSex: "female",
    });
    expect(payload.data.adults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "sire", animalCode: "CM-24001", status: "breeding", cageBarcode: "CM-A101-001" }),
        expect.objectContaining({ role: "dam", animalCode: "CM-24002", status: "breeding", cageBarcode: "CM-A101-001" }),
      ]),
    );

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "breeding_setup",
          action: "create",
          newValue: {
            path: ["targetGenotype"],
            equals: "CreER maintenance API",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("treats repeated breeding setup intake as idempotent", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/breeding-setups/route");
    const requestBody = {
      sireCode: "CM-24001",
      damCode: "CM-24002",
      startDate: "2026-04-18",
      targetGenotype: "CreER maintenance API",
      targetSex: "female",
      notes: "Repeated by the breeding integration route test.",
      allowOverride: true,
    };

    await POST(
      new Request("http://localhost:3000/api/v1/breeding-setups", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/v1/breeding-setups", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as {
      data: { status: string; adults: Array<{ animalCode: string }> };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("already matches the submitted breeding setup");
    expect(payload.data.status).toBe("active");
    expect(payload.data.adults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ animalCode: "CM-24001" }),
        expect.objectContaining({ animalCode: "CM-24002" }),
      ]),
    );
  });

  it("records litters through the external litter route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/litters/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/litters", {
        method: "POST",
        body: JSON.stringify({
          breedingSetupId: "breeding-001",
          birthDate: "2026-04-12",
          litterSizeBirth: 6,
          notes: "Created by the authenticated litter integration route test.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: {
        breedingSetupId: string;
        birthDate: string;
        litterSizeBirth: number;
        targetGenotype: string;
        adults: Array<{ role: string; animalCode: string }>;
      };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(201);
    expect(payload.meta.created).toBe(true);
    expect(payload.meta.message).toContain("Litter recorded for breeding-001");
    expect(payload.data).toMatchObject({
      breedingSetupId: "breeding-001",
      birthDate: "2026-04-12",
      litterSizeBirth: 6,
      targetGenotype: "Cre+/- ; tdTomato+/-",
    });
    expect(payload.data.adults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "sire", animalCode: "CM-24001" }),
        expect.objectContaining({ role: "dam", animalCode: "CM-24002" }),
      ]),
    );

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "litter",
          action: "create",
          newValue: {
            path: ["litterSizeBirth"],
            equals: 6,
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("treats repeated litter intake as idempotent", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/litters/route");
    const requestBody = {
      breedingSetupId: "breeding-001",
      birthDate: "2026-04-12",
      litterSizeBirth: 6,
      notes: "Repeated by the litter integration route test.",
    };

    await POST(
      new Request("http://localhost:3000/api/v1/litters", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/v1/litters", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as {
      data: { breedingSetupId: string; litterSizeBirth: number };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("already matches the submitted litter record");
    expect(payload.data.breedingSetupId).toBe("breeding-001");
    expect(payload.data.litterSizeBirth).toBe(6);
  });

  it("records litter weaning through the external weaning route", async () => {
    authMock.mockResolvedValue(authenticatedSession());
    await createApiWeaningCage();

    const { POST: createBreedingSetup } = await import("@/app/api/v1/breeding-setups/route");
    const breedingResponse = await createBreedingSetup(
      new Request("http://localhost:3000/api/v1/breeding-setups", {
        method: "POST",
        body: JSON.stringify({
          sireCode: "CM-24001",
          damCode: "CM-24002",
          startDate: "2026-04-18",
          targetGenotype: "Weaning route verification",
          allowOverride: true,
        }),
      }),
    );
    const breedingPayload = (await breedingResponse.json()) as { data: { id: string } };

    const { POST: createLitter } = await import("@/app/api/v1/litters/route");
    const litterResponse = await createLitter(
      new Request("http://localhost:3000/api/v1/litters", {
        method: "POST",
        body: JSON.stringify({
          breedingSetupId: breedingPayload.data.id,
          birthDate: "2026-04-20",
          litterSizeBirth: 5,
          notes: "Created before external weaning sync.",
        }),
      }),
    );
    const litterPayload = (await litterResponse.json()) as { data: { id: string } };

    const { POST } = await import("@/app/api/v1/weanings/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/weanings", {
        method: "POST",
        body: JSON.stringify({
          litterId: litterPayload.data.id,
          weanDate: "2026-05-01",
          femaleCount: 2,
          maleCount: 3,
          femaleCageBarcode: "CM-A101-003",
          maleCageBarcode: "CM-API-WEAN-MALE",
          strainName: "Cx3cr1-CreER x Rosa26-LSL-tdTomato",
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: {
        litterId: string;
        litterSizeWean: number;
        femaleCount: number;
        maleCount: number;
        strainName: string | null;
        femaleCage: { cageBarcode: string } | null;
        maleCage: { cageBarcode: string } | null;
        progeny: Array<{ sex: string; cageBarcode: string | null; strainName: string }>;
      };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(201);
    expect(payload.meta.created).toBe(true);
    expect(payload.meta.message).toContain("5 pups weaned");
    expect(payload.data).toMatchObject({
      litterId: litterPayload.data.id,
      litterSizeWean: 5,
      femaleCount: 2,
      maleCount: 3,
      strainName: "Cx3cr1-CreER x Rosa26-LSL-tdTomato",
      femaleCage: { cageBarcode: "CM-A101-003" },
      maleCage: { cageBarcode: "CM-API-WEAN-MALE" },
    });
    expect(payload.data.progeny).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sex: "female", cageBarcode: "CM-A101-003", strainName: "Cx3cr1-CreER x Rosa26-LSL-tdTomato" }),
        expect.objectContaining({ sex: "male", cageBarcode: "CM-API-WEAN-MALE", strainName: "Cx3cr1-CreER x Rosa26-LSL-tdTomato" }),
      ]),
    );

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "litter",
          action: "wean",
          newValue: {
            path: ["litterSizeWean"],
            equals: 5,
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("treats repeated weaning sync as idempotent", async () => {
    authMock.mockResolvedValue(authenticatedSession());
    await createApiWeaningCage();

    const { POST: createBreedingSetup } = await import("@/app/api/v1/breeding-setups/route");
    const breedingResponse = await createBreedingSetup(
      new Request("http://localhost:3000/api/v1/breeding-setups", {
        method: "POST",
        body: JSON.stringify({
          sireCode: "CM-24001",
          damCode: "CM-24002",
          startDate: "2026-04-18",
          targetGenotype: "Repeated weaning verification",
          allowOverride: true,
        }),
      }),
    );
    const breedingPayload = (await breedingResponse.json()) as { data: { id: string } };

    const { POST: createLitter } = await import("@/app/api/v1/litters/route");
    const litterResponse = await createLitter(
      new Request("http://localhost:3000/api/v1/litters", {
        method: "POST",
        body: JSON.stringify({
          breedingSetupId: breedingPayload.data.id,
          birthDate: "2026-04-20",
          litterSizeBirth: 5,
          notes: "Created before repeated weaning sync.",
        }),
      }),
    );
    const litterPayload = (await litterResponse.json()) as { data: { id: string } };

    const { POST } = await import("@/app/api/v1/weanings/route");
    const requestBody = {
      litterId: litterPayload.data.id,
      weanDate: "2026-05-01",
      femaleCount: 2,
      maleCount: 3,
      femaleCageBarcode: "CM-A101-003",
      maleCageBarcode: "CM-API-WEAN-MALE",
      strainName: "Cx3cr1-CreER x Rosa26-LSL-tdTomato",
    };

    await POST(
      new Request("http://localhost:3000/api/v1/weanings", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/v1/weanings", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as {
      data: { femaleCount: number; maleCount: number; litterSizeWean: number | null };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("already matches the submitted weaning outcome");
    expect(payload.data.femaleCount).toBe(2);
    expect(payload.data.maleCount).toBe(3);
    expect(payload.data.litterSizeWean).toBe(5);
  });

  it("moves cages through the external cage route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { PATCH } = await import("@/app/api/v1/cages/route");
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/cages", {
        method: "PATCH",
        body: JSON.stringify({
          cageBarcode: "CM-A101-003",
          roomNumber: "A102",
          rackNumber: "R1",
          cageNumber: "009",
          movedAt: "2026-04-18",
          reason: "External room-balancing workflow relocated the cage.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: {
        cageBarcode: string;
        roomNumber: string;
        rackNumber: string;
        cageNumber: string;
        cageLabel: string;
      };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("CM-A101-003 moved to A102 / R1 / 009");
    expect(payload.data).toMatchObject({
      cageBarcode: "CM-A101-003",
      roomNumber: "A102",
      rackNumber: "R1",
      cageNumber: "009",
      cageLabel: "A102 / R1 / 009",
    });

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "cage",
          action: "move",
          newValue: {
            path: ["location"],
            equals: "A102 / R1 / 009",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("rejects read-only cage move requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { PATCH } = await import("@/app/api/v1/cages/route");
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/cages", {
        method: "PATCH",
        body: JSON.stringify({
          cageBarcode: "CM-A101-003",
          roomNumber: "A102",
          rackNumber: "R1",
          cageNumber: "009",
          movedAt: "2026-04-18",
          reason: "Readonly user should not move cages.",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden" });
  });

  it("rejects read-only breeding setup intake requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { POST } = await import("@/app/api/v1/breeding-setups/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/breeding-setups", {
        method: "POST",
        body: JSON.stringify({
          sireCode: "CM-22008",
          damCode: "CM-25009",
          startDate: "2026-04-18",
          targetGenotype: "Readonly breeding sync",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden" });
  });

  it("rejects read-only litter intake requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { POST } = await import("@/app/api/v1/litters/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/litters", {
        method: "POST",
        body: JSON.stringify({
          breedingSetupId: "breeding-001",
          birthDate: "2026-04-12",
          litterSizeBirth: 6,
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden" });
  });

  it("rejects read-only weaning sync requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { POST } = await import("@/app/api/v1/weanings/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/weanings", {
        method: "POST",
        body: JSON.stringify({
          litterId: "litter-001",
          weanDate: "2026-05-01",
          femaleCount: 2,
          maleCount: 3,
          femaleCageBarcode: "CM-A101-003",
          maleCageBarcode: "CM-A101-002",
          strainName: "Cx3cr1-CreER x Rosa26-LSL-tdTomato",
          projectCode: "PRJ-MICRO-24",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden" });
  });

  it("treats repeated cage welfare event ingestion as idempotent", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/cages/health-notes/route");
    const requestBody = {
      cageBarcode: "CM-A101-003",
      noteType: "routine_welfare",
      severity: "warning",
      note: "External rack sensor repeated wet bedding alert.",
      followupRequired: true,
      actionTaken: "Flagged for cage-change triage.",
    };

    await POST(
      new Request("http://localhost:3000/api/v1/cages/health-notes", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/v1/cages/health-notes", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as { meta: { created: boolean; message: string } };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("already logged");
  });

  it("accepts cage welfare event attachment handoff through multipart intake", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/cages/health-notes/route");
    const formData = new FormData();
    formData.set("cageBarcode", "CM-A101-003");
    formData.set("noteType", "routine_welfare");
    formData.set("severity", "warning");
    formData.set("note", "External rack camera captured a wet-bedding event.");
    formData.set("followupRequired", "true");
    formData.set("actionTaken", "Escalated for cage-change triage.");
    formData.set("attachmentLabel", "Wet bedding photo");
    formData.set("attachment", new File(["camera frame"], "wet-bedding.txt", { type: "text/plain" }));

    const response = await POST(
      new Request("http://localhost:3000/api/v1/cages/health-notes", {
        method: "POST",
        body: formData,
      }),
    );
    const payload = (await response.json()) as {
      data: {
        note: string;
        attachments: Array<{ label: string; fileName: string; fileType: string; storageUrl: string }>;
      };
    };

    expect(response.status).toBe(201);
    expect(payload.data.note).toContain("wet-bedding event");
    expect(payload.data.attachments).toEqual([
      expect.objectContaining({
        label: "Wet bedding photo",
        fileName: "wet-bedding.txt",
        fileType: "text/plain",
      }),
    ]);

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "attachment",
          action: "create",
          newValue: {
            path: ["label"],
            equals: "Wet bedding photo",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("rejects read-only cage welfare event ingestion requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { POST } = await import("@/app/api/v1/cages/health-notes/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/cages/health-notes", {
        method: "POST",
        body: JSON.stringify({
          cageBarcode: "CM-A101-003",
          noteType: "routine_welfare",
          severity: "warning",
          note: "Readonly users cannot create this welfare event.",
          followupRequired: true,
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden" });
  });

  it("returns filtered sample inventory from the authenticated sample route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { GET } = await import("@/app/api/v1/samples/route");
    const response = await GET(new Request("http://localhost:3000/api/v1/samples?status=stored&limit=5"));
    const payload = (await response.json()) as {
      data: Array<{ status: string; sampleLabel: string; animalCode: string }>;
      meta: { count: number; filters: Record<string, string> };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.filters).toMatchObject({ status: "stored" });
    expect(payload.meta.count).toBeGreaterThan(0);
    expect(payload.data.every((sample) => sample.status === "stored")).toBe(true);
  });

  it("returns filtered cryostorage inventory from the authenticated cryostorage route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { GET } = await import("@/app/api/v1/cryostorage/route");
    const response = await GET(new Request("http://localhost:3000/api/v1/cryostorage?status=stored&limit=5"));
    const payload = (await response.json()) as {
      data: Array<{ status: string; sampleLabel: string; strainName: string }>;
      meta: { count: number; filters: Record<string, string> };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.filters).toMatchObject({ status: "stored" });
    expect(payload.meta.count).toBeGreaterThan(0);
    expect(payload.data.every((record) => record.status === "stored")).toBe(true);
  });

  it("creates cryostorage records through the external cryostorage route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/cryostorage/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/cryostorage", {
        method: "POST",
        body: JSON.stringify({
          strainName: "Cx3cr1-CreER",
          projectCode: "PRJ-NEURO-07",
          sampleLabel: "CRYO-API-001",
          materialType: "Frozen embryos",
          status: "stored",
          storedAt: "2026-04-12",
          storageLocation: "LN2 Tank C / Cane 2 / Goblet 1",
          quantityLabel: "14 embryos",
          recoveryNotes: "Suitable for line recovery if breeders fail.",
          notes: "Imported through the external cryostorage API.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: { sampleLabel: string; strainName: string; projectCode: string; status: string; materialType: string };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(201);
    expect(payload.meta.created).toBe(true);
    expect(payload.meta.message).toContain("CRYO-API-001");
    expect(payload.data).toMatchObject({
      sampleLabel: "CRYO-API-001",
      strainName: "Cx3cr1-CreER",
      projectCode: "PRJ-NEURO-07",
      status: "stored",
      materialType: "Frozen embryos",
    });

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "cryostorage_record",
          action: "create",
          newValue: {
            path: ["sampleLabel"],
            equals: "CRYO-API-001",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("treats repeated cryostorage intake as idempotent", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/cryostorage/route");
    const requestBody = {
      strainName: "Cx3cr1-CreER",
      projectCode: "PRJ-NEURO-07",
      sampleLabel: "CRYO-API-REPEAT",
      materialType: "Frozen sperm",
      status: "stored",
      storedAt: "2026-04-12",
    };

    await POST(
      new Request("http://localhost:3000/api/v1/cryostorage", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/v1/cryostorage", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as { meta: { created: boolean; message: string } };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("already recorded");
  });

  it("updates cryostorage lifecycle fields through the external cryostorage route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { PATCH, POST } = await import("@/app/api/v1/cryostorage/route");
    const createResponse = await POST(
      new Request("http://localhost:3000/api/v1/cryostorage", {
        method: "POST",
        body: JSON.stringify({
          strainName: "Cx3cr1-CreER x Rosa26-LSL-tdTomato",
          projectCode: "PRJ-MICRO-24",
          sampleLabel: "CRYO-API-LIFECYCLE",
          materialType: "Frozen embryos",
          status: "stored",
          storedAt: "2026-04-11",
          storageLocation: "LN2 Tank A / Cane 3",
          quantityLabel: "8 embryos",
        }),
      }),
    );

    expect(createResponse.status).toBe(201);

    const updateResponse = await PATCH(
      new Request("http://localhost:3000/api/v1/cryostorage", {
        method: "PATCH",
        body: JSON.stringify({
          sampleLabel: "CRYO-API-LIFECYCLE",
          status: "reserved",
          storageLocation: "Recovery staging rack",
          quantityLabel: "6 embryos reserved",
          recoveryNotes: "Reserved for August recovery attempt.",
          notes: "Updated by external cryostorage workflow.",
        }),
      }),
    );
    const payload = (await updateResponse.json()) as {
      data: {
        sampleLabel: string;
        status: string;
        storageLocation: string;
        quantityLabel: string;
        recoveryNotes: string;
        notes: string;
      };
      meta: { created: boolean; message: string };
    };

    expect(updateResponse.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("CRYO-API-LIFECYCLE");
    expect(payload.data).toMatchObject({
      sampleLabel: "CRYO-API-LIFECYCLE",
      status: "reserved",
      storageLocation: "Recovery staging rack",
      quantityLabel: "6 embryos reserved",
      recoveryNotes: "Reserved for August recovery attempt.",
      notes: "Updated by external cryostorage workflow.",
    });

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "cryostorage_record",
          action: "update",
          newValue: {
            path: ["status"],
            equals: "reserved",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("creates sample records through the external sample intake route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/samples/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/samples", {
        method: "POST",
        body: JSON.stringify({
          animalCode: "CM-26003",
          projectCode: "PRJ-MICRO-24",
          sampleLabel: "LIMS-API-001",
          sampleType: "Tail DNA",
          status: "stored",
          collectedAt: "2026-04-05",
          storageLocation: "Freezer API / Box 1",
          quantityLabel: "20 uL",
          notes: "Imported through the external sample API.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: { animalCode: string; projectCode: string; sampleLabel: string; status: string };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(201);
    expect(payload.meta.created).toBe(true);
    expect(payload.meta.message).toContain("LIMS-API-001");
    expect(payload.data).toMatchObject({
      animalCode: "CM-26003",
      projectCode: "PRJ-MICRO-24",
      sampleLabel: "LIMS-API-001",
      status: "stored",
    });

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "sample_record",
          action: "create",
          newValue: {
            path: ["sampleLabel"],
            equals: "LIMS-API-001",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("treats repeated sample intake for the same animal as idempotent", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/samples/route");
    const requestBody = {
      animalCode: "CM-26003",
      sampleLabel: "LIMS-API-REPEAT",
      sampleType: "Serum",
      status: "stored",
      collectedAt: "2026-04-05",
      storageLocation: "Freezer API / Box repeat",
    };

    await POST(
      new Request("http://localhost:3000/api/v1/samples", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/v1/samples", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as { meta: { created: boolean; message: string } };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("already recorded");
  });

  it("updates sample lifecycle fields through the external sample route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { PATCH, POST } = await import("@/app/api/v1/samples/route");
    const createResponse = await POST(
      new Request("http://localhost:3000/api/v1/samples", {
        method: "POST",
        body: JSON.stringify({
          animalCode: "CM-26003",
          sampleLabel: "LIMS-API-LIFECYCLE",
          sampleType: "Serum",
          status: "stored",
          collectedAt: "2026-04-05",
          storageLocation: "Freezer API / Box 1",
          quantityLabel: "20 uL",
        }),
      }),
    );

    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as { data: { version: number } };

    const updateResponse = await PATCH(
      new Request("http://localhost:3000/api/v1/samples", {
        method: "PATCH",
        body: JSON.stringify({
          sampleLabel: "LIMS-API-LIFECYCLE",
          expectedVersion: created.data.version,
          status: "allocated",
          storageLocation: "Study allocation rack 4",
          quantityLabel: "10 uL remaining",
          notes: "Allocated by external LIMS workflow.",
        }),
      }),
    );
    const payload = (await updateResponse.json()) as {
      data: {
        sampleLabel: string;
        status: string;
        storageLocation: string;
        quantityLabel: string;
        notes: string;
      };
      meta: { created: boolean; message: string };
    };

    expect(updateResponse.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("LIMS-API-LIFECYCLE");
    expect(payload.data).toMatchObject({
      sampleLabel: "LIMS-API-LIFECYCLE",
      status: "allocated",
      storageLocation: "Study allocation rack 4",
      quantityLabel: "10 uL remaining",
      notes: "Allocated by external LIMS workflow.",
    });

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "sample_record",
          action: "update",
          newValue: {
            path: ["status"],
            equals: "allocated",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("rejects read-only sample intake requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { POST } = await import("@/app/api/v1/samples/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/samples", {
        method: "POST",
        body: JSON.stringify({
          animalCode: "CM-26003",
          sampleLabel: "LIMS-API-READONLY",
          sampleType: "Tail DNA",
          status: "stored",
          collectedAt: "2026-04-05",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden" });
  });

  it("rejects read-only cryostorage intake requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { POST } = await import("@/app/api/v1/cryostorage/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/cryostorage", {
        method: "POST",
        body: JSON.stringify({
          strainName: "Cx3cr1-CreER",
          sampleLabel: "CRYO-API-READONLY",
          materialType: "Frozen embryos",
          status: "stored",
          storedAt: "2026-04-12",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden" });
  });

  it("rejects read-only sample lifecycle update requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { PATCH } = await import("@/app/api/v1/samples/route");
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/samples", {
        method: "PATCH",
        body: JSON.stringify({
          sampleLabel: "LIMS-API-READONLY",
          status: "consumed",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden" });
  });

  it("rejects read-only cryostorage lifecycle update requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { PATCH } = await import("@/app/api/v1/cryostorage/route");
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/cryostorage", {
        method: "PATCH",
        body: JSON.stringify({
          sampleLabel: "CRYO-API-READONLY",
          status: "reserved",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden" });
  });

  it("creates genotype records through the external genotype intake route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/genotypes/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/genotypes", {
        method: "POST",
        body: JSON.stringify({
          animalCode: "CM-25009",
          marker: "CreER",
          zygosity: "+/-",
          status: "confirmed",
          sourceType: "external vendor",
          assayType: "Transnetyx panel",
          sampleDate: "2026-04-09",
          resultDate: "2026-04-09",
          resultText: "External API CreER positive call.",
          provider: "Transnetyx",
          confidence: "high",
          sampleId: "TX-API-001",
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: { animalCode: string; finalCall: string; markerTested: string; sampleId: string; status: string };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(201);
    expect(payload.meta.created).toBe(true);
    expect(payload.meta.message).toContain("CreER genotype recorded");
    expect(payload.data).toMatchObject({
      animalCode: "CM-25009",
      finalCall: "CreER +/-",
      markerTested: "CreER",
      sampleId: "TX-API-001",
      status: "confirmed",
    });

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "genotyping_record",
          action: "create",
          newValue: {
            path: ["sampleId"],
            equals: "TX-API-001",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("treats repeated genotype intake as idempotent", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/genotypes/route");
    const requestBody = {
      animalCode: "CM-25009",
      marker: "CreER",
      zygosity: "+/-",
      status: "confirmed",
      sourceType: "external vendor",
      assayType: "Transnetyx panel",
      sampleDate: "2026-04-09",
      resultDate: "2026-04-09",
      resultText: "External API repeated CreER call.",
      provider: "Transnetyx",
      confidence: "high",
      sampleId: "TX-API-REPEAT",
    };

    await POST(
      new Request("http://localhost:3000/api/v1/genotypes", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/v1/genotypes", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as { meta: { created: boolean; message: string } };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("already recorded");
  });

  it("accepts genotype attachment handoff through multipart intake", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/genotypes/route");
    const formData = new FormData();
    formData.set("animalCode", "CM-25009");
    formData.set("marker", "CreER");
    formData.set("zygosity", "+/-");
    formData.set("status", "confirmed");
    formData.set("sourceType", "external vendor");
    formData.set("assayType", "Transnetyx panel");
    formData.set("sampleDate", "2026-04-10");
    formData.set("resultDate", "2026-04-10");
    formData.set("resultText", "External API attachment-backed CreER call.");
    formData.set("provider", "Transnetyx");
    formData.set("confidence", "high");
    formData.set("sampleId", "TX-API-ATTACH-001");
    formData.set("attachmentLabel", "Vendor PDF");
    formData.set("attachment", new File(["pdf bytes"], "vendor-report.txt", { type: "text/plain" }));

    const response = await POST(
      new Request("http://localhost:3000/api/v1/genotypes", {
        method: "POST",
        body: formData,
      }),
    );
    const payload = (await response.json()) as {
      data: {
        sampleId: string;
        attachments: Array<{ label: string; fileName: string; fileType: string; storageUrl: string }>;
      };
    };

    expect(response.status).toBe(201);
    expect(payload.data.sampleId).toBe("TX-API-ATTACH-001");
    expect(payload.data.attachments).toEqual([
      expect.objectContaining({
        label: "Vendor PDF",
        fileName: "vendor-report.txt",
        fileType: "text/plain",
      }),
    ]);

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "attachment",
          action: "create",
          newValue: {
            path: ["label"],
            equals: "Vendor PDF",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("rejects read-only genotype intake requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { POST } = await import("@/app/api/v1/genotypes/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/genotypes", {
        method: "POST",
        body: JSON.stringify({
          animalCode: "CM-25009",
          marker: "CreER",
          zygosity: "+/-",
          status: "confirmed",
          sourceType: "external vendor",
          assayType: "Transnetyx panel",
          sampleDate: "2026-04-09",
          resultDate: "2026-04-09",
          resultText: "Readonly user should not create this.",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden" });
  });

  it("returns filtered rule summaries and updates rule config through the external rules route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { GET, PATCH } = await import("@/app/api/v1/rules/route");
    const listResponse = await GET(
      new Request("http://localhost:3000/api/v1/rules?category=capacity&criticalOnly=true&limit=10"),
    );
    const listPayload = (await listResponse.json()) as {
      data: Array<{ id: string; key: string; category: string; criticalBlock: boolean }>;
      meta: { count: number; total: number; filters: Record<string, string | boolean | number> };
    };

    expect(listResponse.status).toBe(200);
    expect(listPayload.meta.filters).toMatchObject({ category: "capacity", criticalOnly: true, limit: 10 });
    expect(listPayload.data.length).toBeGreaterThan(0);
    expect(listPayload.data.every((rule) => rule.category === "capacity" && rule.criticalBlock)).toBe(true);

    const updateResponse = await PATCH(
      new Request("http://localhost:3000/api/v1/rules", {
        method: "PATCH",
        body: JSON.stringify({
          ruleId: "rule-006",
          valueInput: "1",
          criticalBlock: true,
        }),
      }),
    );
    const updated = (await updateResponse.json()) as {
      data: { id: string; key: string; displayValue: string; editorValue: string; criticalBlock: boolean };
      meta: { created: boolean; message: string };
    };

    expect(updateResponse.status).toBe(200);
    expect(updated.meta.created).toBe(false);
    expect(updated.meta.message).toContain("Maximum cage occupancy updated");
    expect(updated.data).toMatchObject({
      id: "rule-006",
      key: "cage_max_occupancy",
      displayValue: "1",
      editorValue: "1",
      criticalBlock: true,
    });

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "rule_config",
          entityId: "rule-006",
          action: "update",
          newValue: {
            path: ["value"],
            equals: 1,
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("imports genotype csv batches through the external genotype import route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/genotypes/import/route");
    const csvText = [
      "subject_id,marker,call,status,source,assay,sample_date,result_date,result_text,provider,confidence,sample_id",
      "CM-25009,CreER,+/-,confirmed,manual PCR,gel PCR,2026-04-09,2026-04-09,Imported batch call for CM-25009,,high,PCR-25009-BATCH",
      "MC-2026-011,CreER,negative,confirmed,external vendor,Transnetyx panel,2026-04-09,2026-04-09,Imported vendor negative call,Transnetyx,high,TX-26011",
    ].join("\n");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/genotypes/import", {
        method: "POST",
        body: JSON.stringify({
          csvText,
          fileName: "vendor-genotypes.csv",
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: {
        fileName: string | null;
        parsedRowCount: number;
        preflightErrorCount: number;
        preflightErrors: string[];
      };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("Processed 2 genotype rows from vendor-genotypes.csv. 2 succeeded.");
    expect(payload.data).toMatchObject({
      fileName: "vendor-genotypes.csv",
      parsedRowCount: 2,
      preflightErrorCount: 0,
    });

    const [animal009, animal011] = await Promise.all([
      getAnimalDetailView("animal-009", { id: "user-admin", role: "admin" }),
      getAnimalDetailView("animal-011", { id: "user-admin", role: "admin" }),
    ]);

    expect(animal009?.genotypeSummary).toContain("CreER +/-");
    expect(animal011?.genotypeSummary).toContain("CreER WT/WT");
  });

  it("treats repeated rule config updates as idempotent", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { PATCH } = await import("@/app/api/v1/rules/route");
    const requestBody = {
      ruleKey: "cage_max_occupancy",
      valueInput: "1",
      criticalBlock: true,
    };

    await PATCH(
      new Request("http://localhost:3000/api/v1/rules", {
        method: "PATCH",
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/rules", {
        method: "PATCH",
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as {
      data: { key: string; displayValue: string; criticalBlock: boolean };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("already up to date");
    expect(payload.data).toMatchObject({
      key: "cage_max_occupancy",
      displayValue: "1",
      criticalBlock: true,
    });
  });

  it("syncs planned experiment assignments through the external assignment route", async () => {
    authMock.mockResolvedValue(authenticatedSession());
    const expectedExperimentVersion = await experimentVersion();

    const { POST } = await import("@/app/api/v1/experiments/assignments/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "POST",
        headers: commandHeaders("plan-assignments"),
        body: JSON.stringify({
          experimentCode: "EXP-LPS-005",
          expectedExperimentVersion,
          startDate: "2026-04-18",
          notes: "Synced from an external scheduling system.",
          assignments: [
            { animalCode: "CM-26005", treatmentGroup: "Arm A" },
            { animalCode: "CM-26012", treatmentGroup: "Arm B" },
          ],
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: Array<{ animalCode: string; experimentCode: string; status: string; treatmentGroup: string }>;
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(201);
    expect(payload.meta.created).toBe(true);
    expect(payload.meta.message).toContain("Planned 2 cohort assignments for EXP-LPS-005");
    expect(payload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          animalCode: "CM-26005",
          experimentCode: "EXP-LPS-005",
          status: "planned",
          treatmentGroup: "Arm A",
        }),
        expect.objectContaining({
          animalCode: "CM-26012",
          experimentCode: "EXP-LPS-005",
          status: "planned",
          treatmentGroup: "Arm B",
        }),
      ]),
    );

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "experiment_assignment",
          action: "plan",
          newValue: {
            path: ["experimentId"],
            equals: "experiment-002",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("treats repeated experiment assignment sync as idempotent", async () => {
    authMock.mockResolvedValue(authenticatedSession());
    const expectedExperimentVersion = await experimentVersion();

    const { POST } = await import("@/app/api/v1/experiments/assignments/route");
    const requestBody = {
      experimentCode: "EXP-LPS-005",
      expectedExperimentVersion,
      startDate: "2026-04-18",
      notes: "Repeated sync payload.",
      assignments: [
        { animalCode: "CM-26005", treatmentGroup: "Arm A" },
        { animalCode: "CM-26012", treatmentGroup: "Arm B" },
      ],
    };
    const headers = commandHeaders("repeat-plan-assignments");

    await POST(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as { data: Array<unknown>; meta: { created: boolean; message: string } };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("Planned 2 cohort assignments for EXP-LPS-005");
    expect(payload.data).toHaveLength(2);
  });

  it("syncs experiment assignment status through external promote and rollback actions", async () => {
    authMock.mockResolvedValue(authenticatedSession());
    const expectedExperimentVersion = await experimentVersion();

    const { PATCH, POST } = await import("@/app/api/v1/experiments/assignments/route");
    const plannedResponse = await POST(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "POST",
        headers: commandHeaders("status-sync-plan"),
        body: JSON.stringify({
          experimentCode: "EXP-LPS-005",
          expectedExperimentVersion,
          startDate: "2026-04-18",
          notes: "Status sync setup.",
          assignments: [
            { animalCode: "CM-26004", treatmentGroup: "Arm A" },
            { animalCode: "CM-26012", treatmentGroup: "Arm B" },
          ],
        }),
      }),
    );

    expect(plannedResponse.status).toBe(201);
    const planned = (await plannedResponse.json()) as {
      data: Array<{ id: string; version: number; experimentVersion: number }>;
    };
    const plannedSnapshots = planned.data.map((assignment) => ({
      assignmentId: assignment.id,
      expectedVersion: assignment.version,
    }));

    const promoteResponse = await PATCH(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "PATCH",
        headers: commandHeaders("status-sync-promote"),
        body: JSON.stringify({
          experimentCode: "EXP-LPS-005",
          expectedExperimentVersion: planned.data[0]!.experimentVersion,
          action: "promote_planned",
          assignments: plannedSnapshots,
        }),
      }),
    );
    const promoted = (await promoteResponse.json()) as {
      data: Array<{ id: string; animalCode: string; status: string; version: number; experimentVersion: number }>;
      meta: { created: boolean; message: string };
    };

    expect(promoteResponse.status).toBe(200);
    expect(promoted.meta.created).toBe(false);
    expect(promoted.meta.message).toContain("Promoted 2 planned assignments for EXP-LPS-005");
    expect(promoted.data.filter((assignment) => ["CM-26004", "CM-26012"].includes(assignment.animalCode))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ animalCode: "CM-26004", status: "reserved" }),
        expect.objectContaining({ animalCode: "CM-26012", status: "reserved" }),
      ]),
    );

    const rollbackResponse = await PATCH(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "PATCH",
        headers: commandHeaders("status-sync-rollback"),
        body: JSON.stringify({
          experimentCode: "EXP-LPS-005",
          expectedExperimentVersion: promoted.data[0]!.experimentVersion,
          action: "rollback_reserved",
          assignments: promoted.data.map((assignment) => ({
            assignmentId: assignment.id,
            expectedVersion: assignment.version,
          })),
        }),
      }),
    );
    const rolledBack = (await rollbackResponse.json()) as {
      data: Array<{ animalCode: string; status: string }>;
      meta: { message: string };
    };

    expect(rollbackResponse.status).toBe(200);
    expect(rolledBack.meta.message).toContain("Rolled back 2 reserved assignments for EXP-LPS-005");
    expect(rolledBack.data.filter((assignment) => ["CM-26004", "CM-26012"].includes(assignment.animalCode))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ animalCode: "CM-26004", status: "planned" }),
        expect.objectContaining({ animalCode: "CM-26012", status: "planned" }),
      ]),
    );

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "experiment_assignment",
          action: "demote_reservation",
          newValue: {
            path: ["status"],
            equals: "planned",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("updates and removes planned experiment assignments through the external assignment detail route", async () => {
    authMock.mockResolvedValue(authenticatedSession());
    const expectedExperimentVersion = await experimentVersion();

    const { POST } = await import("@/app/api/v1/experiments/assignments/route");
    const createResponse = await POST(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "POST",
        headers: commandHeaders("detail-plan"),
        body: JSON.stringify({
          experimentCode: "EXP-LPS-005",
          expectedExperimentVersion,
          startDate: "2026-04-18",
          notes: "Assignment detail maintenance setup.",
          assignments: [{ animalCode: "CM-26005", treatmentGroup: "Arm A" }],
        }),
      }),
    );
    const created = (await createResponse.json()) as {
      data: Array<{ id: string; version: number; experimentVersion: number }>;
    };
    const assignmentId = created.data[0]?.id;

    expect(createResponse.status).toBe(201);
    expect(assignmentId).toBeTruthy();

    const { DELETE, GET, PATCH } = await import("@/app/api/v1/experiments/assignments/[assignmentId]/route");

    const getResponse = await GET(new Request(`http://localhost:3000/api/v1/experiments/assignments/${assignmentId}`), {
      params: Promise.resolve({ assignmentId }),
    });
    const existing = (await getResponse.json()) as {
      data: { id: string; animalCode: string; status: string; treatmentGroup: string };
    };

    expect(getResponse.status).toBe(200);
    expect(existing.data).toMatchObject({
      id: assignmentId,
      animalCode: "CM-26005",
      status: "planned",
      treatmentGroup: "Arm A",
    });

    const updateResponse = await PATCH(
      new Request(`http://localhost:3000/api/v1/experiments/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: commandHeaders("detail-update"),
        body: JSON.stringify({
          expectedExperimentVersion: created.data[0]!.experimentVersion,
          expectedAssignmentVersion: created.data[0]!.version,
          startDate: "2026-04-21",
          treatmentGroup: "Arm Z",
          notes: "Adjusted through the external assignment detail route.",
        }),
      }),
      { params: Promise.resolve({ assignmentId }) },
    );
    const updated = (await updateResponse.json()) as {
      data: { id: string; treatmentGroup: string; startDate: string; notes: string | null; version: number; experimentVersion: number };
      meta: { created: boolean; message: string };
    };

    expect(updateResponse.status).toBe(200);
    expect(updated.meta.created).toBe(false);
    expect(updated.meta.message).toContain("Updated planned assignment for CM-26005");
    expect(updated.data).toMatchObject({
      id: assignmentId,
      treatmentGroup: "Arm Z",
      startDate: "2026-04-21T00:00:00.000Z",
      notes: "Adjusted through the external assignment detail route.",
    });

    const deleteResponse = await DELETE(
      new Request(`http://localhost:3000/api/v1/experiments/assignments/${assignmentId}`, {
        method: "DELETE",
        headers: commandHeaders("detail-delete"),
        body: JSON.stringify({
          expectedExperimentVersion: updated.data.experimentVersion,
          expectedAssignmentVersion: updated.data.version,
        }),
      }),
      { params: Promise.resolve({ assignmentId }) },
    );
    const removed = (await deleteResponse.json()) as {
      data: { id: string; treatmentGroup: string; status: string };
      meta: { message: string };
    };

    expect(deleteResponse.status).toBe(200);
    expect(removed.meta.message).toContain("Removed planned assignment for CM-26005");
    expect(removed.data).toMatchObject({
      id: assignmentId,
      treatmentGroup: "Arm Z",
      status: "planned",
    });

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "experiment_assignment",
          action: "delete_plan",
          entityId: assignmentId,
        },
      }),
    ).resolves.toBeTruthy();

    const missingResponse = await GET(new Request(`http://localhost:3000/api/v1/experiments/assignments/${assignmentId}`), {
      params: Promise.resolve({ assignmentId }),
    });

    expect(missingResponse.status).toBe(404);
  });

  it("syncs direct experiment reservations through the external reservation route", async () => {
    authMock.mockResolvedValue(authenticatedSession());
    const [expectedAnimalVersion, expectedExperimentVersion] = await Promise.all([
      animalVersion("CM-26004"),
      experimentVersion(),
    ]);

    const { POST } = await import("@/app/api/v1/experiments/reservations/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/experiments/reservations", {
        method: "POST",
        headers: commandHeaders("direct-reservation"),
        body: JSON.stringify({
          experimentCode: "EXP-LPS-005",
          animalCode: "CM-26004",
          expectedAnimalVersion,
          expectedExperimentVersion,
          startDate: "2026-04-18",
          treatmentGroup: "Arm C",
          notes: "Reserved by an external integration test.",
        }),
      }),
    );
    const payload = (await response.json()) as {
      data: { animalCode: string; experimentCode: string; status: string; treatmentGroup: string };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(201);
    expect(payload.meta.created).toBe(true);
    expect(payload.meta.message).toContain("CM-26004 reserved for EXP-LPS-005");
    expect(payload.data).toMatchObject({
      animalCode: "CM-26004",
      experimentCode: "EXP-LPS-005",
      status: "reserved",
      treatmentGroup: "Arm C",
    });

    await expect(
      prisma.auditLog.findFirst({
        where: {
          entityType: "experiment_assignment",
          action: "reserve",
          newValue: {
            path: ["snapshot", "command", "experimentId"],
            equals: "experiment-002",
          },
        },
      }),
    ).resolves.toBeTruthy();
  });

  it("treats repeated experiment reservation sync as idempotent", async () => {
    authMock.mockResolvedValue(authenticatedSession());
    const [expectedAnimalVersion, expectedExperimentVersion] = await Promise.all([
      animalVersion("CM-26004"),
      experimentVersion(),
    ]);

    const { POST } = await import("@/app/api/v1/experiments/reservations/route");
    const requestBody = {
      experimentCode: "EXP-LPS-005",
      animalCode: "CM-26004",
      expectedAnimalVersion,
      expectedExperimentVersion,
      startDate: "2026-04-18",
      treatmentGroup: "Arm C",
      notes: "Repeated reservation payload.",
    };
    const headers = commandHeaders("repeat-direct-reservation");

    await POST(
      new Request("http://localhost:3000/api/v1/experiments/reservations", {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/v1/experiments/reservations", {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as {
      data: { animalCode: string; experimentCode: string; status: string };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("CM-26004 reserved for EXP-LPS-005");
    expect(payload.data).toMatchObject({
      animalCode: "CM-26004",
      experimentCode: "EXP-LPS-005",
      status: "reserved",
    });
  });

  it("rejects read-only experiment assignment sync requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { POST } = await import("@/app/api/v1/experiments/assignments/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "POST",
        body: JSON.stringify({
          experimentCode: "EXP-LPS-005",
          startDate: "2026-04-18",
          assignments: [{ animalCode: "CM-26005", treatmentGroup: "Arm A" }],
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "Forbidden" });
  });

  it("rejects read-only experiment assignment status sync requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { PATCH } = await import("@/app/api/v1/experiments/assignments/route");
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "PATCH",
        body: JSON.stringify({
          experimentCode: "EXP-LPS-005",
          action: "promote_planned",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Forbidden",
    });
  });

  it("rejects read-only experiment reservation sync requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { POST } = await import("@/app/api/v1/experiments/reservations/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/experiments/reservations", {
        method: "POST",
        body: JSON.stringify({
          experimentCode: "EXP-LPS-005",
          animalCode: "CM-26004",
          startDate: "2026-04-18",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Forbidden",
    });
  });

  it("rejects non-admin rule config update requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { PATCH } = await import("@/app/api/v1/rules/route");
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/rules", {
        method: "PATCH",
        body: JSON.stringify({
          ruleKey: "cage_max_occupancy",
          valueInput: "1",
          criticalBlock: true,
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Forbidden",
    });
  });

  it("rejects read-only genotype import requests", async () => {
    authMock.mockResolvedValue(readOnlySession());

    const { POST } = await import("@/app/api/v1/genotypes/import/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/genotypes/import", {
        method: "POST",
        body: JSON.stringify({
          csvText: "subject_id,marker,call,sample_date,result_date\nCM-25009,CreER,+/-,2026-04-09,2026-04-09",
          fileName: "readonly-import.csv",
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Forbidden",
    });
  });

  it("rejects read-only planned assignment maintenance requests", async () => {
    authMock.mockResolvedValue(authenticatedSession());
    const expectedExperimentVersion = await experimentVersion();

    const { POST } = await import("@/app/api/v1/experiments/assignments/route");
    const createResponse = await POST(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "POST",
        headers: commandHeaders("readonly-maintenance-plan"),
        body: JSON.stringify({
          experimentCode: "EXP-LPS-005",
          expectedExperimentVersion,
          startDate: "2026-04-18",
          assignments: [{ animalCode: "CM-26005", treatmentGroup: "Arm A" }],
        }),
      }),
    );
    const created = (await createResponse.json()) as { data: Array<{ id: string }> };
    const assignmentId = created.data[0]?.id;

    expect(createResponse.status).toBe(201);
    expect(assignmentId).toBeTruthy();

    authMock.mockResolvedValue(readOnlySession());

    const { DELETE, PATCH } = await import("@/app/api/v1/experiments/assignments/[assignmentId]/route");
    const updateResponse = await PATCH(
      new Request(`http://localhost:3000/api/v1/experiments/assignments/${assignmentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          startDate: "2026-04-21",
        }),
      }),
      { params: Promise.resolve({ assignmentId }) },
    );

    expect(updateResponse.status).toBe(403);
    await expect(updateResponse.json()).resolves.toMatchObject({
      error: "Forbidden",
    });

    const deleteResponse = await DELETE(
      new Request(`http://localhost:3000/api/v1/experiments/assignments/${assignmentId}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ assignmentId }) },
    );

    expect(deleteResponse.status).toBe(403);
    await expect(deleteResponse.json()).resolves.toMatchObject({
      error: "Forbidden",
    });
  });
});
