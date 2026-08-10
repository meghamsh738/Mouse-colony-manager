import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateSampleRecord: vi.fn(),
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/server", () => ({ after: (callback: () => void) => callback() }));
vi.mock("@/lib/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/colony-write", () => ({
  createSampleRecord: vi.fn(),
  updateSampleRecord: mocks.updateSampleRecord,
}));

import { updateSampleInventoryAction } from "@/app/samples/actions";
import { initialFormActionState } from "@/lib/form-state";

function validForm() {
  const formData = new FormData();
  formData.set("sampleId", "sample-1");
  formData.set("expectedVersion", "3");
  formData.set("status", "stored");
  return formData;
}

describe("biosample experiment linkage action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "manager-1", role: "animal_staff", activeLabId: "lab-a" });
    mocks.updateSampleRecord.mockResolvedValue({ ok: true, message: "Saved." });
  });

  it("preserves the current experiment when the edit control is absent", async () => {
    await updateSampleInventoryAction(initialFormActionState, validForm());

    expect(mocks.updateSampleRecord).toHaveBeenCalledWith(
      expect.objectContaining({ sampleId: "sample-1", expectedVersion: 3, experimentId: undefined }),
      expect.objectContaining({ id: "manager-1" }),
    );
  });

  it("unlinks only when the form explicitly submits the blank option", async () => {
    const formData = validForm();
    formData.set("experimentId", "");

    await updateSampleInventoryAction(initialFormActionState, formData);

    expect(mocks.updateSampleRecord).toHaveBeenCalledWith(
      expect.objectContaining({ experimentId: null }),
      expect.anything(),
    );
  });
});
