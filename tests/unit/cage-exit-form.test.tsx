import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CageExitForm } from "@/components/app/cage-operations-forms";
import type { FormActionState } from "@/lib/form-state";

const noopAction = async (): Promise<FormActionState> => ({ status: "idle" });

describe("CageExitForm", () => {
  it("requires explicit impact acknowledgement before permanent closure", async () => {
    const user = userEvent.setup();

    render(
      <CageExitForm
        action={noopAction}
        activeChargePeriod={{
          id: "period-1",
          categoryId: "category-1",
          categoryName: "Standard cage",
          currencyCode: "USD",
          dailyRateCents: 250,
          startedAt: "2026-07-01T00:00:00.000Z",
        }}
        barcode="MC-ROOM-1-R1-001"
        cageId="cage-1"
        commandNonce="closure-review-1"
        defaultDate="2026-07-15"
        destinationOptions={[]}
        occupants={[]}
        version={2}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Review closure" }));

    const acknowledgement = screen.getByRole("checkbox", {
      name: "I reviewed all destinations and understand the closure and billing cutoff are permanent.",
    });
    const confirmation = screen.getByRole("button", { name: "Permanently close MC-ROOM-1-R1-001" });

    expect(acknowledgement).not.toBeChecked();
    expect(confirmation).toBeDisabled();

    await user.click(acknowledgement);

    expect(acknowledgement).toBeChecked();
    expect(confirmation).toBeEnabled();
  });
});
