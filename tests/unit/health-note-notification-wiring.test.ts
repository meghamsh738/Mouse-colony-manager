import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(process.cwd(), "src/lib/colony-write.ts"),
  "utf8",
);

describe("health-note notification wiring", () => {
  it("materializes only actionable welfare notes in the health-note transaction", () => {
    const start = source.indexOf("export async function addCageHealthNote");
    const end = source.indexOf("\nexport async function", start + 1);
    const implementation = source.slice(start, end === -1 ? undefined : end);

    expect(start).toBeGreaterThan(-1);
    expect(implementation).toMatch(/await prisma\.\$transaction\(\s*async \(tx\) =>/);
    expect(implementation).toMatch(
      /if \(\s*input\.followupRequired \|\|\s*input\.severity === "warning" \|\|\s*input\.severity === "critical"\s*\)/,
    );
    expect(implementation).toMatch(/await materializeNotificationAlertInTransaction\(\s*tx,/);
    expect(implementation).toContain('alertType: "welfare_note"');
    expect(implementation).toContain("labId: cage.labId!");
  });
});
