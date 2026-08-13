import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AnimalTransferPanel } from "@/components/app/animal-transfer-panel";
import type { FormActionState } from "@/lib/form-state";
import type { AnimalTransferWorkspaceView } from "@/lib/types";

const noopAction = async (): Promise<FormActionState> => ({ status: "idle" });

const workspace: AnimalTransferWorkspaceView = {
  commandNonce: "transfer-nonce",
  defaultDestinationCageId: "cage-a",
  defaultDate: "2026-08-13",
  rules: { cageMaxOccupancy: 6, mixedSexHoldingAllowed: false },
  animalOptions: [],
  cageOptions: [],
  animalResults: { totalCount: 60, page: 2, pageCount: 3, pageSize: 20 },
  destinationResults: { totalCount: 40, page: 1, pageCount: 2, pageSize: 20 },
  query: {
    animalSearch: "CM-26",
    animalPage: 2,
    destinationSearch: "A101",
    destinationPage: 1,
    pageSize: 20,
  },
};

describe("AnimalTransferPanel server pagination", () => {
  it("retains the action and both search states in page links", () => {
    render(<AnimalTransferPanel action={noopAction} basePath="/scan/CM-A101-001" workspace={workspace} />);

    const previous = screen.getByRole("link", { name: "Previous" });
    const nextLinks = screen.getAllByRole("link", { name: "Next" });
    expect(previous).toHaveAttribute(
      "href",
      "/scan/CM-A101-001?action=move-mouse&animalSearch=CM-26&destinationSearch=A101",
    );
    expect(nextLinks[0]).toHaveAttribute(
      "href",
      "/scan/CM-A101-001?action=move-mouse&animalSearch=CM-26&animalPage=3&destinationSearch=A101",
    );
    expect(nextLinks[1]).toHaveAttribute(
      "href",
      "/scan/CM-A101-001?action=move-mouse&animalSearch=CM-26&animalPage=2&destinationSearch=A101&destinationPage=2",
    );
    expect(screen.getByTestId("animal-transfer-search")).toHaveValue("CM-26");
    expect(screen.getByTestId("animal-transfer-destination-search")).toHaveValue("A101");
  });

  it("adds the pinned destination without replacing a paginated result row", () => {
    const pageOptions = Array.from({ length: 20 }, (_, index) => ({
      id: `cage-${index}`,
      labId: "lab-a",
      barcode: `CAGE-${index}`,
      label: `A / R / ${index}`,
      status: "active" as const,
      occupantCount: 0,
      capacity: 6,
      remainingCapacity: 6,
      maleCount: 0,
      femaleCount: 0,
      sexComposition: "Empty",
      strainSummary: "No active occupants",
      warningCount: 0,
    }));
    render(<AnimalTransferPanel
      action={noopAction}
      basePath="/cages/cage-pinned"
      workspace={{
        ...workspace,
        cageOptions: pageOptions,
        defaultDestinationCageId: "cage-pinned",
        pinnedDestination: { ...pageOptions[0], id: "cage-pinned", barcode: "PINNED" },
      }}
    />);

    expect(screen.getByTestId("animal-transfer-destination").querySelectorAll("option")).toHaveLength(21);
    expect(screen.getByRole("option", { name: /PINNED/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /CAGE-19/ })).toBeInTheDocument();
  });
});
