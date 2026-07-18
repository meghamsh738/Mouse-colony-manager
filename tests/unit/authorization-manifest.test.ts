import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  authorizationManifest,
  findAuthorizationManifestErrors,
} from "../../scripts/check-authorization-manifest";

describe("authorization manifest", () => {
  it("covers every current page, route handler, and server-action module", async () => {
    const result = await findAuthorizationManifestErrors(process.cwd());
    expect(result).toEqual({ missing: [], stale: [], unguarded: [] });
  });

  it("reports a newly added protected entry point", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "authorization-manifest-"));
    const pageDirectory = path.join(root, "src/app/new-protected-page");
    await mkdir(pageDirectory, { recursive: true });
    await writeFile(path.join(pageDirectory, "page.tsx"), "export default function Page() { return null; }\n");

    const result = await findAuthorizationManifestErrors(root, {});
    expect(result.missing).toEqual(["src/app/new-protected-page/page.tsx"]);
    expect(result.stale).toEqual([]);
    expect(result.unguarded).toEqual([]);
  });

  it("reports a classified page that omits its declared capability guard", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "authorization-manifest-"));
    const pageDirectory = path.join(root, "src/app/unguarded");
    await mkdir(pageDirectory, { recursive: true });
    await writeFile(path.join(pageDirectory, "page.tsx"), "export default function Page() { return null; }\n");

    const result = await findAuthorizationManifestErrors(root, {
      "src/app/unguarded/page.tsx": "animals:read",
    });
    expect(result.unguarded).toEqual(["src/app/unguarded/page.tsx"]);
  });

  it("rejects a server action guarded by a different capability than its manifest policy", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "authorization-manifest-"));
    const actionDirectory = path.join(root, "src/app/protected-action");
    await mkdir(actionDirectory, { recursive: true });
    await writeFile(
      path.join(actionDirectory, "actions.ts"),
      '\"use server\";\nexport async function mutate() { await requireUser({ capability: "experiments:full" }); }\n',
    );

    const result = await findAuthorizationManifestErrors(root, {
      "src/app/protected-action/actions.ts": "experiments:manage",
    });
    expect(result.unguarded).toEqual(["src/app/protected-action/actions.ts"]);
  });

  it("requires explicit classifications for public surfaces", () => {
    expect(authorizationManifest["src/app/login/page.tsx"]).toBe("public");
    expect(authorizationManifest["src/app/api/auth/[...nextauth]/route.ts"]).toBe("public");
  });
});
