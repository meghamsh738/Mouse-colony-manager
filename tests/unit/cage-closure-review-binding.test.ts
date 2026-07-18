import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { hasOverlappingChargePeriods } from "@/lib/cage-closure-write";

const commandSource = fs.readFileSync(path.resolve(process.cwd(), "src/lib/cage-closure-write.ts"), "utf8");
const actionSource = fs.readFileSync(path.resolve(process.cwd(), "src/app/cages/[cageId]/actions.ts"), "utf8");
const formSource = fs.readFileSync(path.resolve(process.cwd(), "src/components/app/cage-operations-forms.tsx"), "utf8");

const reviewedFinancialFields = [
  "expectedChargePeriodId",
  "expectedChargeCategoryId",
  "expectedChargePeriodStartedAt",
  "expectedDailyRateCents",
  "expectedCurrencyCode",
] as const;

describe("cage closure review binding", () => {
  it("submits every displayed final charge-period field in the reviewed command", () => {
    for (const field of reviewedFinancialFields) {
      expect(formSource).toContain(`name="${field}"`);
      expect(actionSource).toContain(`${field}: formData.get("${field}")`);
      expect(actionSource).toContain(`${field}: parsed.data.${field}`);
      expect(commandSource).toContain(`${field}:`);
    }
  });

  it("resolves and binds the cage lab on the server instead of accepting a form lab", () => {
    expect(formSource).not.toContain('name="labId"');
    expect(actionSource).toContain("const cageScope = await prisma.cage.findUnique");
    expect(actionSource).toContain("labId: cageScope.labId");
    expect(commandSource).toContain("const labId = input.command.labId");
    expect(commandSource).toContain("input.command.labId !== cage.labId");
  });

  it("treats a post-preflight movement failure as a transaction rollback", () => {
    expect(commandSource).toContain("Cage closure move preflight diverged");
    expect(commandSource).not.toContain("if (!move.ok) return");
  });

  it("uses an exact start-of-day cutoff and advances the reviewed cage version once", () => {
    expect(commandSource).toContain("closedAt < latestOperationalAt");
    expect(commandSource).toContain("closedAt < latestDestinationAt");
    expect(commandSource).toContain('where: { id: cage.id, version: input.expectedVersion }');
    expect(commandSource).toContain('version: { increment: 1 }');
    expect(commandSource).toContain("transaction was rolled back");
    expect(commandSource).toContain("candidateCageIds: destinationIds");
    expect(commandSource).toContain("reconcileBreedingCageStatuses");
  });

  it("serializes closure on the cage row and rejects overlapping half-open charge periods", () => {
    expect(commandSource).toContain("const cageIdsToLock");
    expect(commandSource).toContain("Prisma.join(cageIdsToLock)");
    expect(commandSource).toContain("ORDER BY id");
    expect(commandSource).toContain("FOR UPDATE");
    expect(hasOverlappingChargePeriods([
      { id: "period-a", startedAt: new Date("2026-01-01T00:00:00.000Z"), endedAt: new Date("2026-01-10T00:00:00.000Z") },
      { id: "period-b", startedAt: new Date("2026-01-05T00:00:00.000Z"), endedAt: null },
    ])).toBe(true);
    expect(hasOverlappingChargePeriods([
      { id: "period-a", startedAt: new Date("2026-01-01T00:00:00.000Z"), endedAt: new Date("2026-01-10T00:00:00.000Z") },
      { id: "period-b", startedAt: new Date("2026-01-10T00:00:00.000Z"), endedAt: null },
    ])).toBe(false);
  });
});
