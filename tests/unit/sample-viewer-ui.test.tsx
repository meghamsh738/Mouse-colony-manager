import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/samples/actions", () => ({
  updateSampleInventoryAction: vi.fn(),
}));

import { SampleTable } from "@/components/app/sample-table";
import type { SampleInventoryItem } from "@/lib/types";

const sample: SampleInventoryItem = {
  id: "sample-1",
  sampleLabel: "DNA-0001",
  sampleType: "Tail DNA",
  status: "stored",
  collectedAt: "2026-07-01T00:00:00.000Z",
  animalId: "animal-1",
  animalCode: "0001",
  labId: "lab-a",
  projectCode: "PROJECT-A",
  experimentId: "experiment-complete",
  experimentCode: "EXP-COMPLETE",
  storageLocation: "Freezer 1 / Box A / A01",
  quantityLabel: "40 uL",
  notes: "Retained material",
  version: 3,
};

describe("biosample viewer controls", () => {
  it("renders inventory without mutation controls for viewers", () => {
    render(
      <SampleTable
        canManage={false}
        data={[sample]}
        experimentOptions={[{ id: "experiment-complete", label: "EXP-COMPLETE · Complete study", status: "completed" }]}
      />,
    );

    expect(screen.getAllByText("View only").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("sample-inline-edit-sample-1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("offers active experiments plus only the row's own terminal experiment when editing", () => {
    render(
      <SampleTable
        canManage
        data={[sample]}
        experimentOptions={[
          { id: "experiment-active", label: "EXP-ACTIVE · Active study", status: "active" },
          { id: "experiment-complete", label: "EXP-COMPLETE · Complete study", status: "completed" },
          { id: "experiment-other-complete", label: "EXP-OTHER · Other completed study", status: "completed" },
        ]}
      />,
    );

    for (const editor of screen.getAllByTestId("sample-inline-edit-sample-1")) {
      expect(within(editor).getByRole("option", { name: "EXP-ACTIVE · Active study" })).toBeInTheDocument();
      expect(within(editor).getByRole("option", { name: "EXP-COMPLETE · Complete study" })).toBeInTheDocument();
      expect(within(editor).queryByRole("option", { name: "EXP-OTHER · Other completed study" })).not.toBeInTheDocument();
    }
  });
});
