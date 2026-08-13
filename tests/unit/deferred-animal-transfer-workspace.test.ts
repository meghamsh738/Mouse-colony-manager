import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("deferred animal transfer workspace", () => {
  it("does not load or serialize the workspace in the default cage detail render", () => {
    const cagePage = source("src/app/cages/[cageId]/page.tsx");

    expect(cagePage).toContain("const query = (await searchParams) ?? {};");
    expect(cagePage).toContain('requestedAction === "move-mouse"');
    expect(cagePage).toContain('href: `/cages/${snapshot.cage.id}?action=move-mouse`');
    expect(cagePage).toContain('href={`/cages/${snapshot.cage.id}?action=move-mouse`}');
    expect(cagePage).toContain('defaultActionId={requestedAction === "move-mouse" && transferWorkspace ? "move-mouse" : undefined}');
    expect(cagePage.indexOf("const query = (await searchParams) ?? {};" )).toBeLessThan(
      cagePage.indexOf("await getAnimalTransferWorkspacePageView(cageId, user, query)"),
    );
  });

  it("loads the cage workspace only for an authorized, operational explicit action", () => {
    const cagePage = source("src/app/cages/[cageId]/page.tsx");

    expect(cagePage).toMatch(/const transferWorkspace = canTransferAnimals && isOperational && requestedAction === "move-mouse"/);
    expect(cagePage).toContain("getCageClosureDestinationOptions(cageId, user, query)");
    expect(cagePage).not.toContain('requestedAction === "close"\n    ? await getAnimalTransferWorkspace');
    expect(cagePage).toContain('requestedAction === "move-mouse" && transferWorkspace ? {');
    expect(cagePage).toContain("panel: <AnimalTransferPanel action={moveAnimalTransferAction}");
    expect(cagePage).toContain("workspace={transferWorkspace} />");
    expect(cagePage).toContain("...(canTransferAnimals && isOperational");
  });

  it("does not load or serialize the workspace in the default scan render", () => {
    const scanPage = source("src/app/scan/[barcode]/page.tsx");

    expect(scanPage).toContain("searchParams?: Promise<Record<string, string | string[] | undefined>>");
    expect(scanPage).toContain("const query = (await searchParams) ?? {};");
    expect(scanPage).toContain('href: `/scan/${encodeURIComponent(snapshot.cage.barcode)}?action=move-mouse`');
    expect(scanPage).toContain('defaultActionId={requestedAction === "move-mouse" && transferWorkspace ? "move-mouse" : undefined}');
    expect(scanPage.indexOf("const query = (await searchParams) ?? {};" )).toBeLessThan(
      scanPage.indexOf("await getAnimalTransferWorkspacePageView(snapshot.cage.id, user, query)"),
    );
  });

  it("loads the scan workspace only for an authorized, operational explicit action", () => {
    const scanPage = source("src/app/scan/[barcode]/page.tsx");

    expect(scanPage).toMatch(/const transferWorkspace = canTransferAnimals && isOperational && requestedAction === "move-mouse"/);
    expect(scanPage).toContain('requestedAction === "move-mouse" && transferWorkspace ? {');
    expect(scanPage).toContain("panel: <AnimalTransferPanel action={moveAnimalTransferAction}");
    expect(scanPage).toContain("workspace={transferWorkspace} />");
    expect(scanPage).toContain("...(canTransferAnimals");
  });

  it("retains the explicit action and both server-side search states in navigation", () => {
    const panel = source("src/components/app/animal-transfer-panel.tsx");
    const cagePage = source("src/app/cages/[cageId]/page.tsx");

    expect(panel).toContain('new URLSearchParams({ action: "move-mouse" })');
    expect(panel).toContain('params.set("animalSearch", query.animalSearch)');
    expect(panel).toContain('params.set("destinationSearch", query.destinationSearch)');
    expect(panel).toContain('name="action" type="hidden" value="move-mouse"');
    expect(panel).toContain('name="animalSearch"');
    expect(panel).toContain('name="destinationSearch"');
    expect(cagePage).toContain('name="action" type="hidden" value="close"');
    expect(cagePage).toContain("destinationPage=${closureDestinations.page + 1}");
  });

  it("makes missing-animal cage search and pagination available from animal detail", () => {
    const animalPage = source("src/app/animals/[animalId]/page.tsx");

    expect(animalPage).toContain("getAnimalPresenceCageOptions(snapshot.animal.id, user, query)");
    expect(animalPage).toContain('name="presenceSearch"');
    expect(animalPage).toContain('name="action" type="hidden" value="presence"');
    expect(animalPage).toContain('defaultActionId={requestedAction === "presence" && presenceCages ? "presence" : undefined}');
    expect(animalPage).toContain("?action=presence&presenceSearch=");
    expect(animalPage).toContain("presencePage=${presenceCages.page - 1}");
    expect(animalPage).toContain("presencePage=${presenceCages.page + 1}");
    expect(animalPage).toContain("cages={presenceCages?.items ?? []}");
  });
});
