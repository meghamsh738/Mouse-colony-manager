import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("offline production typography", () => {
  it("does not require a remote font download during the build", async () => {
    const layoutSource = await readFile(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
    const globalStyles = await readFile(path.join(process.cwd(), "src/app/globals.css"), "utf8");

    expect(layoutSource).not.toContain("next/font/google");
    expect(globalStyles).toContain("--font-ibm-plex-sans:");
    expect(globalStyles).toContain("--font-ibm-plex-mono:");
  });

  it("uses the documented listener-free webpack production build", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.build).toBe("next build --webpack");
  });
});
