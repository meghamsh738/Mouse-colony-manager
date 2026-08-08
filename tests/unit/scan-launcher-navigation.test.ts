import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const scanLauncherPath = fileURLToPath(new URL("../../src/components/app/scan-launcher.tsx", import.meta.url));

describe("barcode scan navigation", () => {
  it("uses App Router navigation instead of a full document reload", async () => {
    const source = await readFile(scanLauncherPath, "utf8");

    expect(source).toContain('import { useRouter } from "next/navigation";');
    expect(source).toContain("router.push(`/scan/${encodeURIComponent(results[0].rawValue)}`);");
    expect(source).not.toContain("window.location.assign(");
  });
});
