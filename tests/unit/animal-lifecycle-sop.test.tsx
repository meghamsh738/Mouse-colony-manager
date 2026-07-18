import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/animals/[animalId]/actions", () => ({
  updateAnimalLifecycleAction: vi.fn(),
}));

import { AnimalLifecycleForm } from "@/components/app/animal-lifecycle-form";

const baseProps = {
  animalId: "animal-1",
  animalLabel: "0001 · LAB-0001",
  allowedActions: [{ value: "euthanized" as const, label: "Mark euthanized" }],
  commandNonce: "lifecycle-command-0001",
  currentCageLabel: "1000",
  defaultDate: "2026-07-16",
  openBreedingCount: 0,
  openExperimentCount: 0,
  version: 3,
};

describe("animal lifecycle exact SOP review", () => {
  it("blocks euthanasia review until an approved assigned SOP is available and selected", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<AnimalLifecycleForm {...baseProps} sopOptions={[]} />);

    expect(screen.getByText("Assign an approved SOP to this lab before recording euthanasia.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review change" })).toBeDisabled();

    rerender(
      <AnimalLifecycleForm
        {...baseProps}
        sopOptions={[{ id: "sop-assignment-1", label: "SOP-EUTH v3 · Humane euthanasia" }]}
      />,
    );
    await user.type(screen.getByLabelText("Lifecycle date and time"), "2026-07-16T10:30");
    await user.selectOptions(screen.getByRole("combobox", { name: "Approved SOP" }), "sop-assignment-1");
    expect(screen.getByRole("button", { name: "Review change" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Review change" }));
    expect(screen.getByText("SOP-EUTH v3 · Humane euthanasia")).toBeInTheDocument();
  });
});
