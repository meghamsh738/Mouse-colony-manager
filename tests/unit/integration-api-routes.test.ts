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
    expect(payload.data.resources.find((resource) => resource.name === "samples")).toMatchObject({
      path: "/api/v1/samples",
      methods: ["GET", "POST"],
    });
    expect(payload.data.resources.find((resource) => resource.name === "genotypes")).toMatchObject({
      path: "/api/v1/genotypes",
      methods: ["POST"],
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
});
