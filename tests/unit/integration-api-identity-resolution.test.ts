import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  animalFindFirst: vi.fn(),
  cageFindFirst: vi.fn(),
  aliasFindUnique: vi.fn(),
}));

vi.mock("@/lib/lab-access", () => ({
  getActorLabAccess: vi.fn(async () => ({ mode: "selected", labIds: ["lab-a"], activeLabId: "lab-a" })),
  labScopedWhere: vi.fn((_access, field = "labId") => ({ [field]: "lab-a" })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    animal: { findFirst: mocks.animalFindFirst },
    cage: { findFirst: mocks.cageFindFirst },
    legacyIdentifierAlias: { findUnique: mocks.aliasFindUnique },
  },
}));

import { resolveAnimalByApiReference, resolveCageByApiReference } from "@/lib/integration-api";

const actor = { id: "lab-user", role: "animal_staff" as const, activeLabId: "lab-a" };
const animal = {
  id: "animal-1",
  facilityAnimalId: "0001",
  animalId: "COLONY-1",
  labId: "LAB-1",
  owningLabId: "lab-a",
};
const cage = { id: "cage-1", facilityCageId: "1000", barcode: "OLD-CAGE-1", labId: "lab-a" };

describe("integration API identity resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.animalFindFirst.mockResolvedValue(null);
    mocks.cageFindFirst.mockResolvedValue(null);
    mocks.aliasFindUnique.mockResolvedValue(null);
  });

  it("prefers an animal internal ID, then its canonical facility ID", async () => {
    mocks.animalFindFirst.mockImplementation(async ({ where }) => where.facilityAnimalId === "0001" ? animal : null);

    const result = await resolveAnimalByApiReference({ animalId: "0001" }, actor);

    expect(result).toMatchObject({ ok: true, value: { animalId: "animal-1" } });
    expect(mocks.animalFindFirst).toHaveBeenCalledTimes(2);
    expect(mocks.animalFindFirst.mock.calls[0][0].where).toMatchObject({ id: "0001", owningLabId: "lab-a" });
    expect(mocks.animalFindFirst.mock.calls[1][0].where).toMatchObject({ facilityAnimalId: "0001", owningLabId: "lab-a" });
    expect(mocks.aliasFindUnique).not.toHaveBeenCalled();
  });

  it("resolves animal codes in canonical, colony, then lab-ID order", async () => {
    mocks.animalFindFirst.mockImplementation(async ({ where }) => where.labId === "LAB-1" ? animal : null);

    const result = await resolveAnimalByApiReference({ animalCode: "LAB-1" }, actor);

    expect(result).toMatchObject({ ok: true, value: { animalId: "animal-1", labId: "LAB-1" } });
    expect(mocks.animalFindFirst.mock.calls.map(([input]) => Object.keys(input.where).find((key) => key !== "owningLabId"))).toEqual([
      "facilityAnimalId",
      "animalId",
      "labId",
    ]);
  });

  it("uses a retained alias only after direct authorized identifiers miss", async () => {
    mocks.aliasFindUnique.mockResolvedValue({ entityId: "animal-1" });
    mocks.animalFindFirst.mockImplementation(async ({ where }) => where.id === "animal-1" ? animal : null);

    const result = await resolveAnimalByApiReference({ animalId: "RETIRED-ID" }, actor);

    expect(result).toMatchObject({ ok: true, value: { animalId: "animal-1" } });
    expect(mocks.aliasFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { entityType_alias: { entityType: "animal", alias: "RETIRED-ID" } },
    }));
    expect(mocks.animalFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: "animal-1", owningLabId: "lab-a" },
    }));
  });

  it("applies the same canonical-first rule to cage references", async () => {
    mocks.cageFindFirst.mockImplementation(async ({ where }) => where.facilityCageId === "1000" ? cage : null);

    const result = await resolveCageByApiReference({ cageId: "1000" }, actor);

    expect(result).toMatchObject({ ok: true, value: { cageId: "cage-1", cageBarcode: "OLD-CAGE-1" } });
    expect(mocks.cageFindFirst).toHaveBeenCalledTimes(2);
    expect(mocks.cageFindFirst.mock.calls[0][0].where).toMatchObject({ id: "1000", labId: "lab-a" });
    expect(mocks.cageFindFirst.mock.calls[1][0].where).toMatchObject({ facilityCageId: "1000", labId: "lab-a" });
  });
});
