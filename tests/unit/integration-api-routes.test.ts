import { beforeEach, describe, expect, it, vi } from "vitest";

import { SEEDED_DEV_EMAILS } from "@/lib/seed-metadata";
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
});
