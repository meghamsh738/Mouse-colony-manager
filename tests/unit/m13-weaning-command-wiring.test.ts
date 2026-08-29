import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("M13 legacy weaning command wiring", () => {
  it("routes both authenticated surfaces through the receipt-bound command", () => {
    const web = read("src/app/breeding/actions.ts");
    const api = read("src/app/api/v1/weanings/route.ts");
    expect(web).toContain("executeWeanLitterCommand");
    expect(web).toContain('commandType: "breeding.wean_litter"');
    expect(api).toContain("executeWeanLitterCommand");
    expect(api).toContain('request.headers.get("idempotency-key")');
    expect(api).toContain("result.replayed ? 200 : 201");
  });

  it("settles the litter's exact birth allocation atomically", () => {
    const writer = read("src/lib/colony-write.ts");
    expect(writer).toContain("export async function executeWeanLitterCommand");
    expect(writer).toContain("withM13MutationSavepoint");
    expect(writer).toContain('allocation.aggregateType !== "litter"');
    expect(writer).toContain("allocation.reservedQuantity !== litter.litterSizeBirth");
    expect(writer).toContain('countOperation: "consume"');
    expect(writer).toContain("const mortality = allocation.reservedQuantity - totalWeaned");
    expect(writer).toContain("releaseProtocolReservation");
    expect(writer).toContain('procedureCode: "breeding"');
    expect(writer).toContain('requiredPersonnelRoles: ["breeding_operator"]');
  });
});
