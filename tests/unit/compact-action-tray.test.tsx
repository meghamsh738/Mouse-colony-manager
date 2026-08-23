import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompactActionTray } from "@/components/app/compact-action-tray";

describe("CompactActionTray", () => {
  it("uses the close route when the active panel is URL-backed", () => {
    render(
      <CompactActionTray
        actions={[
          {
            id: "add-mouse",
            label: "Add mouse",
            description: "New animal",
            panel: <div>Animal form</div>,
          },
        ]}
        closeHref="/animals?status=breeding"
        defaultActionId="add-mouse"
      />,
    );

    expect(screen.getByRole("link", { name: "Add mouse: New animal" })).toHaveAttribute(
      "href",
      "/animals?status=breeding",
    );
    expect(screen.getByText("Animal form")).toBeVisible();
  });
});
