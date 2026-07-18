import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("technical queue source boundaries", () => {
  it("does not select or render sensitive queue, provider, scientific, or migration failure fields", () => {
    const readSource = fs.readFileSync(path.join(process.cwd(), "src/lib/system-read.ts"), "utf8");
    const pageSource = fs.readFileSync(path.join(process.cwd(), "src/app/system/page.tsx"), "utf8");

    for (const forbiddenSelection of [
      "payload: true",
      "lastError: true",
      "errorMessage: true",
      "providerRequestBody: true",
      "providerIdempotencyKey: true",
      "providerMessageId: true",
      "aggregateId: true",
      "result: true",
    ]) {
      expect(readSource).not.toContain(forbiddenSelection);
    }

    for (const forbiddenRender of [
      ".payload",
      ".lastError",
      ".errorMessage",
      ".providerRequestBody",
      ".providerIdempotencyKey",
      ".providerMessageId",
      ".aggregateId",
    ]) {
      expect(pageSource).not.toContain(forbiddenRender);
    }
  });

  it("retains both capability guards on technical queue reads", () => {
    const readSource = fs.readFileSync(path.join(process.cwd(), "src/lib/system-read.ts"), "utf8");
    const guard = readSource.slice(
      readSource.indexOf("function requireTechnicalConsoleAccess"),
      readSource.indexOf("export async function getSecurityEventHistoryView"),
    );

    expect(guard).toContain('actorHasCapability(actor, "system:view")');
    expect(guard).toContain('actorHasCapability(actor, "audit:security")');
  });

  it("keeps migration history readable without a page-wide mobile table", () => {
    const pageSource = fs.readFileSync(path.join(process.cwd(), "src/app/system/page.tsx"), "utf8");
    const migrationSection = pageSource.slice(pageSource.indexOf('title="Migration activity"'));

    expect(migrationSection).toContain('className="worksheet-table-wrap hidden md:block"');
    expect(migrationSection).toContain('className="worksheet-mobile-list md:hidden"');
    expect(migrationSection).toContain("<MobileWorksheetCard");
  });

  it("preserves security audit context in mobile cards", () => {
    const pageSource = fs.readFileSync(path.join(process.cwd(), "src/app/system/page.tsx"), "utf8");

    expect(pageSource).toContain('mobile-worksheet-label">Actor role');
    expect(pageSource).toContain('mobile-worksheet-label">Reported scope');
    expect(pageSource).toContain('mobile-worksheet-label">Correlation');
  });
});
