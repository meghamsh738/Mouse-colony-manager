import { beforeEach, describe, expect, it, vi } from "vitest";

import { SEEDED_DEV_EMAILS } from "@/lib/seed-metadata";
import { prisma } from "@/lib/prisma";
import { seedDatabase } from "../../prisma/seed-database";

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: authMock,
}));

function authenticatedSession() {
  return {
    user: {
      id: "user-admin",
      email: SEEDED_DEV_EMAILS.admin,
      name: "Colony Admin",
      role: "admin" as const,
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
    },
  };
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

  it("updates animal lifecycle state through the external animal route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { PATCH } = await import("@/app/api/v1/animals/route");
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/animals", {
        method: "PATCH",
        body: JSON.stringify({
          animalCode: "CM-26003",
          targetStatus: "euthanized",
          happenedAt: "2026-04-18",
          reason: "External colony system recorded humane endpoint completion.",
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

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("CM-26003 marked euthanized");
    expect(payload.data.animal).toMatchObject({
      animalId: "CM-26003",
      status: "euthanized",
      outcomeStatus: "euthanized",
      deathReason: "External colony system recorded humane endpoint completion.",
    });
    expect(payload.data.cageLabel).toBe("Archived");

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

    const { PATCH } = await import("@/app/api/v1/animals/route");
    const requestBody = {
      animalCode: "CM-26003",
      targetStatus: "euthanized",
      happenedAt: "2026-04-18",
      reason: "External colony system recorded humane endpoint completion.",
    };

    await PATCH(
      new Request("http://localhost:3000/api/v1/animals", {
        method: "PATCH",
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await PATCH(
      new Request("http://localhost:3000/api/v1/animals", {
        method: "PATCH",
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as {
      data: { animal: { status: string } };
      meta: { created: boolean; message: string };
    };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("already marked euthanized");
    expect(payload.data.animal.status).toBe("euthanized");
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
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Your role cannot change terminal lifecycle states.",
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
      methods: ["GET", "PATCH"],
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
    expect(payload.data.resources.find((resource) => resource.name === "cages")).toMatchObject({
      path: "/api/v1/cages",
      methods: ["GET", "PATCH"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "genotypes")).toMatchObject({
      path: "/api/v1/genotypes",
      methods: ["POST"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "experiment-assignments")).toMatchObject({
      path: "/api/v1/experiments/assignments",
      methods: ["POST", "PATCH"],
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
    await expect(response.json()).resolves.toMatchObject({ error: "Your role cannot move cages." });
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
    await expect(response.json()).resolves.toMatchObject({ error: "Your role cannot add cage health notes." });
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

    const updateResponse = await PATCH(
      new Request("http://localhost:3000/api/v1/samples", {
        method: "PATCH",
        body: JSON.stringify({
          sampleLabel: "LIMS-API-LIFECYCLE",
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
    await expect(response.json()).resolves.toMatchObject({ error: "Your role cannot record new sample inventory." });
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
    await expect(response.json()).resolves.toMatchObject({ error: "Your role cannot record cryostorage inventory." });
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
    await expect(response.json()).resolves.toMatchObject({ error: "Your role cannot update sample inventory." });
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
    await expect(response.json()).resolves.toMatchObject({ error: "Your role cannot update cryostorage inventory." });
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
    await expect(response.json()).resolves.toMatchObject({ error: "Your role cannot record genotyping results." });
  });

  it("syncs planned experiment assignments through the external assignment route", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { POST } = await import("@/app/api/v1/experiments/assignments/route");
    const response = await POST(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "POST",
        body: JSON.stringify({
          experimentCode: "EXP-LPS-005",
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

    const { POST } = await import("@/app/api/v1/experiments/assignments/route");
    const requestBody = {
      experimentCode: "EXP-LPS-005",
      startDate: "2026-04-18",
      notes: "Repeated sync payload.",
      assignments: [
        { animalCode: "CM-26005", treatmentGroup: "Arm A" },
        { animalCode: "CM-26012", treatmentGroup: "Arm B" },
      ],
    };

    await POST(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const response = await POST(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "POST",
        body: JSON.stringify(requestBody),
      }),
    );
    const payload = (await response.json()) as { data: Array<unknown>; meta: { created: boolean; message: string } };

    expect(response.status).toBe(200);
    expect(payload.meta.created).toBe(false);
    expect(payload.meta.message).toContain("already has assignments");
    expect(payload.data).toHaveLength(2);
  });

  it("syncs experiment assignment status through external promote and rollback actions", async () => {
    authMock.mockResolvedValue(authenticatedSession());

    const { PATCH, POST } = await import("@/app/api/v1/experiments/assignments/route");
    const plannedResponse = await POST(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "POST",
        body: JSON.stringify({
          experimentCode: "EXP-LPS-005",
          startDate: "2026-04-18",
          notes: "Status sync setup.",
          assignments: [
            { animalCode: "CM-26005", treatmentGroup: "Arm A" },
            { animalCode: "CM-26012", treatmentGroup: "Arm B" },
          ],
        }),
      }),
    );

    expect(plannedResponse.status).toBe(201);

    const promoteResponse = await PATCH(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "PATCH",
        body: JSON.stringify({
          experimentCode: "EXP-LPS-005",
          action: "promote_planned",
        }),
      }),
    );
    const promoted = (await promoteResponse.json()) as {
      data: Array<{ animalCode: string; status: string }>;
      meta: { created: boolean; message: string };
    };

    expect(promoteResponse.status).toBe(200);
    expect(promoted.meta.created).toBe(false);
    expect(promoted.meta.message).toContain("Promoted 2 planned assignments for EXP-LPS-005");
    expect(promoted.data.filter((assignment) => ["CM-26005", "CM-26012"].includes(assignment.animalCode))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ animalCode: "CM-26005", status: "reserved" }),
        expect.objectContaining({ animalCode: "CM-26012", status: "reserved" }),
      ]),
    );

    const rollbackResponse = await PATCH(
      new Request("http://localhost:3000/api/v1/experiments/assignments", {
        method: "PATCH",
        body: JSON.stringify({
          experimentCode: "EXP-LPS-005",
          action: "rollback_reserved",
        }),
      }),
    );
    const rolledBack = (await rollbackResponse.json()) as {
      data: Array<{ animalCode: string; status: string }>;
      meta: { message: string };
    };

    expect(rollbackResponse.status).toBe(200);
    expect(rolledBack.meta.message).toContain("Rolled back 3 reserved assignments for EXP-LPS-005");
    expect(rolledBack.data.filter((assignment) => ["CM-26005", "CM-26012"].includes(assignment.animalCode))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ animalCode: "CM-26005", status: "planned" }),
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
    await expect(response.json()).resolves.toMatchObject({ error: "Your role cannot sync experiment assignments." });
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
      error: "Your role cannot sync experiment assignment status.",
    });
  });
});
