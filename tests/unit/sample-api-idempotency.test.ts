import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  resolveSampleApiInput: vi.fn(),
  getSampleApiRecordByLabel: vi.fn(),
  createSampleRecord: vi.fn(),
}));

vi.mock("@/lib/api-route", () => ({
  requireApiUser: mocks.requireApiUser,
  buildApiErrorResponse: (error: string, status = 400) => Response.json({ error }, { status }),
  buildCollectionResponse: (data: unknown[]) => Response.json({ data }),
  buildMutationResponse: (data: unknown, input: { status: number; created: boolean; message: string }) =>
    Response.json({ data, meta: { created: input.created, message: input.message } }, { status: input.status }),
  compactApiMeta: (input: Record<string, unknown>) => input,
}));

vi.mock("@/lib/colony-write", () => ({
  createSampleRecord: mocks.createSampleRecord,
  updateSampleRecord: vi.fn(),
}));

vi.mock("@/lib/integration-api", () => ({
  getSampleApiList: vi.fn(),
  getSampleApiRecordById: vi.fn(),
  getSampleApiRecordByLabel: mocks.getSampleApiRecordByLabel,
  parseSampleApiFilters: vi.fn(),
  resolveExperimentApiReference: vi.fn(),
  resolveSampleApiRecordReference: vi.fn(),
  resolveSampleApiInput: mocks.resolveSampleApiInput,
}));

import { POST } from "@/app/api/v1/samples/route";

const actor = {
  id: "manager-a",
  role: "animal_staff",
  activeLabId: "lab-a",
  capabilities: ["biosamples:manage"],
};

const requestBody = {
  animalCode: "0001",
  projectCode: "PROJECT-A",
  sampleLabel: "DNA-0001",
  sampleType: "Tail DNA",
  status: "stored",
  collectedAt: "2026-07-01",
  storageLocation: "Freezer A / Box 1 / A01",
  quantityLabel: "40 uL",
  notes: "Retained aliquot",
};

const existing = {
  id: "sample-1",
  animalId: "animal-1",
  animalCode: "0001",
  labId: "lab-a",
  projectCode: "PROJECT-A",
  experimentId: null,
  sampleLabel: "DNA-0001",
  sampleType: "Tail DNA",
  status: "stored",
  collectedAt: "2026-07-01T00:00:00.000Z",
  storageLocation: "Freezer A / Box 1 / A01",
  quantityLabel: "40 uL",
  notes: "Retained aliquot",
};

describe("sample API replay equivalence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiUser.mockResolvedValue({ user: actor });
    mocks.resolveSampleApiInput.mockResolvedValue({
      ok: true,
      value: {
        animalId: "animal-1",
        animalCode: "0001",
        labId: "lab-a",
        projectId: "project-a",
        projectCode: "PROJECT-A",
        experimentId: undefined,
        experimentCode: null,
      },
    });
  });

  it("returns the existing record only for an equivalent request", async () => {
    mocks.getSampleApiRecordByLabel.mockResolvedValue(existing);
    const response = await POST(new Request("http://localhost/api/v1/samples", {
      method: "POST",
      body: JSON.stringify(requestBody),
    }));

    expect(response.status).toBe(200);
    expect(mocks.createSampleRecord).not.toHaveBeenCalled();
  });

  it("returns conflict when the same label changes scientific metadata", async () => {
    mocks.getSampleApiRecordByLabel.mockResolvedValue(existing);
    const response = await POST(new Request("http://localhost/api/v1/samples", {
      method: "POST",
      body: JSON.stringify({ ...requestBody, sampleType: "Serum" }),
    }));
    const payload = await response.json() as { error: string };

    expect(response.status).toBe(409);
    expect(payload.error).toContain("different inventory or provenance data");
    expect(mocks.createSampleRecord).not.toHaveBeenCalled();
  });
});
