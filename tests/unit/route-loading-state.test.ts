import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const loadingStatePath = fileURLToPath(new URL("../../src/components/app/route-loading-state.tsx", import.meta.url));

describe("route loading state", () => {
  it("is an immediate, synchronous fallback instead of waiting for the app shell or session", async () => {
    const source = await readFile(loadingStatePath, "utf8");

    expect(source).toContain("export function RouteLoadingState");
    expect(source).not.toContain("export async function RouteLoadingState");
    expect(source).not.toContain("resolveCurrentActor");
    expect(source).not.toContain("AppShell");
  });
});
