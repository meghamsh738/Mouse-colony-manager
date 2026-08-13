import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("high-impact workflow UI", () => {
  it("uses a shared full-page shell for action-only invoice decisions", () => {
    const invoicePage = source("src/app/billing/invoices/[invoiceId]/page.tsx");
    const animalPage = source("src/app/animals/[animalId]/page.tsx");
    const cagePage = source("src/app/cages/[cageId]/page.tsx");
    const scanPage = source("src/app/scan/[barcode]/page.tsx");
    const quarantinePage = source("src/app/quarantine/page.tsx");
    const cryostoragePage = source("src/app/cryostorage/page.tsx");
    const shell = source("src/components/app/high-impact-workflow-shell.tsx");

    expect(invoicePage).toContain("<HighImpactWorkflowShell");
    expect(invoicePage).toContain('requestedAction === "finalize"');
    expect(invoicePage).toContain('requestedAction === "void"');
    expect(shell).toContain('data-testid="high-impact-workflow"');
    expect(shell).toContain('min-h-11');
    expect(shell).toContain("<section");
    expect(shell).not.toContain("<main");
    expect(animalPage).toContain('requestedAction === "lifecycle"');
    expect(animalPage).toContain("<HighImpactWorkflowShell");
    expect(cagePage).toContain('requestedAction === "close"');
    expect(cagePage).toContain("<HighImpactWorkflowShell");
    expect(scanPage).toContain('href: `/cages/${snapshot.cage.id}?action=close`');
    expect(scanPage).not.toContain("<CageExitForm");
    expect(quarantinePage).toContain('query.action === "release"');
    expect(cryostoragePage).toContain('firstQueryValue(rawQuery.action) === "process"');
  });

  it("requires in-page review and record-specific billing decisions", () => {
    const billing = source("src/components/app/billing-forms.tsx");

    expect(billing).not.toContain("window.confirm");
    expect(billing).toContain("Review finalization");
    expect(billing).toContain("Review void");
    expect(billing).toContain("Finalize ${invoiceNumber} for ${totalLabel}");
    expect(billing).toContain("Void ${invoiceNumber}");
  });

  it("uses exact record actions and reviewed irreversible impacts", () => {
    const lifecycle = source("src/components/app/animal-lifecycle-form.tsx");
    const quarantine = source("src/components/app/quarantine-operations.tsx");
    const cryostorage = source("src/components/app/cryostorage-request-workspace.tsx");
    const intake = source("src/components/app/cage-intake-wizard.tsx");

    expect(lifecycle).toContain('euthanized: "Record as euthanized"');
    expect(lifecycle).not.toContain("Confirm lifecycle change");
    expect(quarantine).toContain('disabled={!canReview}');
    expect(quarantine).toContain("overCapacityDestinations.length === 0");
    expect(quarantine).toContain("I reviewed the release date, reason, every destination, and available cage capacity.");
    expect(cryostorage).toContain("I confirm this material is being discarded and cannot return to stored inventory.");
    expect(cryostorage).not.toContain("Complete operation");
    expect(intake).toContain("Record weaning of ${subjects.length} pups");
    expect(intake).toContain("Receive ${subjects.length} mice");
    expect(intake).toContain('aria-label={`Destination cage for ${subject.label}`}');
  });
});
