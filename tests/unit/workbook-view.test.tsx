import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { WorkbookView } from "@/components/app/workbook-view";
import type { WorkbookNavigation, WorkbookSheet, WorkbookState } from "@/lib/workbook-read";

const navigation: WorkbookNavigation = {
  allowedSections: ["biosamples"],
  childSheets: [
    { id: "all", label: "All" },
    { id: "stored", label: "Stored" },
  ],
  canFilterLabs: false,
  labs: [],
};

const state: WorkbookState = {
  section: "biosamples",
  sheet: "all",
  search: "",
  sort: "collectedAt",
  direction: "asc",
  history: false,
};

const sheet: WorkbookSheet = {
  kind: "biosamples",
  rows: [{
    id: "sample-1",
    sampleLabel: "DNA-0001",
    type: "Tail DNA",
    status: "stored",
    animalId: "0001",
    animalRecordId: "animal-1",
    labAnimalId: "LAB-001",
    collectedAt: "17 Jul 2026",
    collectedAtSort: 1,
    project: "PROJECT-1",
    experiment: "EXP-1",
    storage: "Freezer 1",
    quantity: "40 uL",
    notes: "Private specimen note",
  }],
};

describe("WorkbookView mobile inventory disclosure", () => {
  beforeEach(() => push.mockReset());

  it("keeps inventory details collapsed until the record is explicitly expanded", async () => {
    const user = userEvent.setup();
    render(<WorkbookView navigation={navigation} sheet={sheet} state={state} />);

    const disclosure = screen.getByRole("button", { name: "Expand DNA-0001" });
    const mobileRecord = disclosure.closest("article");
    expect(mobileRecord).not.toBeNull();
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(within(mobileRecord!).queryByText("Private specimen note")).not.toBeInTheDocument();

    await user.click(disclosure);

    expect(screen.getByRole("button", { name: "Collapse DNA-0001" })).toHaveAttribute("aria-expanded", "true");
    expect(within(mobileRecord!).getByText("Private specimen note")).toBeInTheDocument();
  });
});
