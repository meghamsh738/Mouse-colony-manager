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
