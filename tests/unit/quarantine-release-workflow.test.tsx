import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/quarantine/actions", () => ({
  admitQuarantineCaseAction: vi.fn(),
  recordQuarantineObservationAction: vi.fn(),
  requestQuarantineReleaseAction: vi.fn(),
  finalizeQuarantineReleaseAction: vi.fn(),
}));

import { QuarantineReleaseWorkflow } from "@/components/app/quarantine-operations";

describe("QuarantineReleaseWorkflow", () => {
  it("blocks review when proposed assignments exceed aggregate destination capacity", async () => {
    const user = userEvent.setup();
    render(
      <QuarantineReleaseWorkflow
        destinations={[{
          id: "cage-destination",
          labId: "lab-1",
          barcode: "CAGE-1001",
          label: "Room 1 / R1 / 001",
          occupantCount: 5,
          effectiveCapacity: 6,
          remainingCapacity: 1,
          sexes: ["female"],
        }]}
        nonce="quarantine-release-test"
        selectedCase={{
          id: "case-1",
          version: 2,
          status: "release_requested",
          cageLabel: "Room Q / RQ / 001",
          minimumReleaseAt: "2026-07-10T00:00:00.000Z",
          latestObservationResult: "clear",
          openFollowupCount: 0,
          occupants: [
            { id: "animal-1", animalId: "0001", sex: "female", strain: "C57BL/6J" },
            { id: "animal-2", animalId: "0002", sex: "female", strain: "C57BL/6J" },
          ],
        }}
        today="2026-07-17"
      />,
    );

    await user.selectOptions(screen.getByRole("combobox", { name: "Destination for 0001" }), "cage-destination");
    await user.selectOptions(screen.getByRole("combobox", { name: "Destination for 0002" }), "cage-destination");

    expect(screen.getByText("Destination capacity exceeded")).toBeVisible();
    expect(screen.getByRole("button", { name: "Review release" })).toBeDisabled();
  });
});
