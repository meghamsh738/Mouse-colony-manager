import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/settings/actions", () => ({
  updateRuleConfigAction: vi.fn(async () => ({ status: "error", message: "Review the value." })),
}));

import { RuleConfigEditor } from "@/components/app/rule-config-editor";

const rules = [
  {
    id: "rule-1",
    key: "maximum_occupancy",
    label: "Maximum occupancy",
    description: "Maximum mice per cage.",
    category: "capacity",
    valueType: "number",
    displayValue: "6",
    editorValue: "6",
    criticalBlock: true,
  },
  {
    id: "rule-2",
    key: "mixed_sex",
    label: "Mixed-sex holding",
    description: "Allow mixed-sex holding cages.",
    category: "capacity",
    valueType: "boolean",
    displayValue: "false",
    editorValue: "false",
    criticalBlock: true,
  },
];

describe("rule configuration editor", () => {
  it("keeps one editor open and lets staff dismiss it after server feedback", async () => {
    const user = userEvent.setup();
    render(<RuleConfigEditor rules={rules} />);

    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(screen.getByTestId("rule-form-maximum_occupancy")).toBeInTheDocument();

    await user.click(screen.getByTestId("rule-edit-mixed_sex"));
    expect(screen.queryByTestId("rule-form-maximum_occupancy")).not.toBeInTheDocument();
    expect(screen.getByTestId("rule-form-mixed_sex")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save rule" }));
    expect(await screen.findByText("Review the value.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("rule-form-mixed_sex")).not.toBeInTheDocument();
  });
});
