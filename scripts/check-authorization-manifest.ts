import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const authorizationManifest = {
  // Pages that intentionally do not require an application capability.
  "src/app/access-denied/page.tsx": "public",
  "src/app/activate/page.tsx": "public",
  "src/app/login/page.tsx": "public",

  "src/app/page.tsx": "dashboard:view",
  "src/app/animals/page.tsx": "animals:read",
  "src/app/animals/[animalId]/page.tsx": "animals:read",
  "src/app/administration/users/page.tsx": "users:manage",
  "src/app/administration/labs/page.tsx": "labs:manage",
  "src/app/approvals/page.tsx": "approvals:read",
  "src/app/billing/page.tsx": "billing:read",
  "src/app/billing/invoices/page.tsx": "billing:read",
  "src/app/billing/invoices/[invoiceId]/page.tsx": "billing:read",
  "src/app/billing/rates/page.tsx": "billing:read",
  "src/app/breeding/page.tsx": "breeding:read",
  "src/app/cages/page.tsx": "cages:read",
  "src/app/cages/[cageId]/page.tsx": "cages:read",
  "src/app/cages/intake/page.tsx": "cages:manage",
  "src/app/cages/labels/page.tsx": "cages:read",
  "src/app/cryostorage/page.tsx": "cryostorage:read",
  "src/app/experiments/page.tsx": "experiments:read",
  "src/app/forecast/page.tsx": "forecast:read",
  "src/app/notifications/page.tsx": "notifications:read",
  "src/app/procedures/page.tsx": "procedures:operational",
  "src/app/quarantine/page.tsx": "quarantine:read",
  "src/app/samples/page.tsx": "biosamples:read",
  "src/app/scan/page.tsx": "scan:use",
  "src/app/scan/[barcode]/page.tsx": "scan:use",
  "src/app/sops/page.tsx": "sops:read",
  "src/app/settings/page.tsx": "rules:manage",
  "src/app/strains/page.tsx": "strains:discover",
  "src/app/system/page.tsx": "system:view",
  "src/app/workbook/page.tsx": "workbook:read",

  // Server actions. Modules with multiple mutations declare their primary
  // capability here; each mutation still enforces its exact capability in code.
  "src/app/activate/actions.ts": "public",
  "src/app/administration/users/actions.ts": "users:manage",
  "src/app/administration/labs/actions.ts": "labs:manage",
  "src/app/approvals/actions.ts": "transfers:request",
  "src/app/animals/actions.ts": "animals:manage",
  "src/app/animals/[animalId]/actions.ts": "animals:manage",
  "src/app/billing/actions.ts": "billing:manage",
  "src/app/breeding/actions.ts": "breeding:manage",
  "src/app/cages/[cageId]/actions.ts": "cages:manage",
  "src/app/cages/animal-transfer-actions.ts": "cages:manage",
  "src/app/cages/intake/actions.ts": "cages:manage",
  "src/app/cryostorage/actions.ts": "cryostorage:manage",
  "src/app/experiments/actions.ts": "experiments:manage",
  "src/app/lab-context-actions.ts": "dashboard:view",
  "src/app/login/actions.ts": "public",
  "src/app/notifications/actions.ts": "notifications:read",
  "src/app/profile-actions.ts": "authenticated",
  "src/app/procedures/actions.ts": "procedures:plan",
  "src/app/quarantine/actions.ts": "quarantine:manage",
  "src/app/samples/actions.ts": "biosamples:manage",
  "src/app/scan/[barcode]/actions.ts": "cages:manage",
  "src/app/sops/actions.ts": "sops:manage",
  "src/app/settings/actions.ts": "rules:manage",
  "src/app/strains/actions.ts": "strains:manage",

  // Route handlers. Mixed-method modules declare the read capability here and
  // enforce a stricter mutation capability per handler where appropriate.
  "src/app/api/auth/[...nextauth]/route.ts": "public",
  "src/app/api/exports/[entity]/route.ts": "entity-specific",
  "src/app/api/v1/route.ts": "dashboard:view",
  "src/app/api/v1/animals/route.ts": "animals:read",
  "src/app/api/v1/animals/[animalId]/route.ts": "animals:read",
  "src/app/api/v1/breeding-setups/route.ts": "breeding:manage",
  "src/app/api/v1/cages/route.ts": "cages:read",
  "src/app/api/v1/cages/[cageId]/route.ts": "cages:read",
  "src/app/api/v1/cages/health-notes/route.ts": "cages:manage",
  "src/app/api/v1/cryostorage/route.ts": "cryostorage:read",
  "src/app/api/v1/experiments/route.ts": "experiments:read",
  "src/app/api/v1/experiments/assignments/route.ts": "experiments:manage",
  "src/app/api/v1/experiments/assignments/[assignmentId]/route.ts": "experiments:full",
  "src/app/api/v1/experiments/reservations/route.ts": "experiments:manage",
  "src/app/api/v1/exports/route.ts": "workbook:read",
  "src/app/api/v1/genotypes/route.ts": "animals:manage",
  "src/app/api/v1/genotypes/import/route.ts": "animals:manage",
  "src/app/api/v1/litters/route.ts": "breeding:manage",
  "src/app/api/v1/notifications/delivery/route.ts": "notifications:deliver",
  "src/app/api/v1/projects/route.ts": "experiments:full",
  "src/app/api/v1/procedures/route.ts": "procedures:operational",
  "src/app/api/v1/procedures/[procedureId]/occurrences/route.ts": "procedures:operational",
  "src/app/api/v1/rules/route.ts": "rules:manage",
  "src/app/api/v1/samples/route.ts": "biosamples:read",
  "src/app/api/v1/weanings/route.ts": "breeding:manage",
  "src/app/scan/lookup/route.ts": "scan:use",
} as const satisfies Record<string, string>;

export type AuthorizationManifest = Record<string, string>;

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  }));
  return nested.flat();
}

export async function discoverAuthorizationEntryPoints(rootDirectory: string) {
  const appDirectory = path.join(rootDirectory, "src/app");
  const files = await walk(appDirectory);
  const entryPoints: string[] = [];

  for (const absolutePath of files) {
    const relativePath = path.relative(rootDirectory, absolutePath).split(path.sep).join("/");
    if (relativePath.endsWith("/page.tsx") || relativePath.endsWith("/route.ts")) {
      entryPoints.push(relativePath);
      continue;
    }

    if (/\.tsx?$/.test(relativePath)) {
      const source = await readFile(absolutePath, "utf8");
      if (/^\s*["']use server["'];?/m.test(source)) entryPoints.push(relativePath);
    }
  }

  return entryPoints.sort();
}

export async function findAuthorizationManifestErrors(
  rootDirectory: string,
  manifest: AuthorizationManifest = authorizationManifest,
) {
  const discovered = await discoverAuthorizationEntryPoints(rootDirectory);
  const discoveredSet = new Set(discovered);
  const missing = discovered.filter((entryPoint) => !manifest[entryPoint]);
  const stale = Object.keys(manifest).filter((entryPoint) => !discoveredSet.has(entryPoint)).sort();
  const unguarded: string[] = [];

  for (const entryPoint of discovered) {
    const policy = manifest[entryPoint];
    if (!policy || policy === "public" || policy === "authenticated" || policy === "entity-specific") continue;

    const source = await readFile(path.join(rootDirectory, entryPoint), "utf8");
    if (entryPoint.endsWith("/page.tsx")) {
      const declaredGuard = `requireUser({ capability: "${policy}" })`;
      if (!source.includes(declaredGuard)) unguarded.push(entryPoint);
      continue;
    }

    if (entryPoint.endsWith("/route.ts")) {
      const declaredGuard = `requireApiUser("${policy}")`;
      if (!source.includes(declaredGuard)) unguarded.push(entryPoint);
      continue;
    }

    const declaredGuard = `requireUser({ capability: "${policy}" })`;
    if (!source.includes(declaredGuard)) {
      unguarded.push(entryPoint);
    }
  }

  return { missing, stale, unguarded: unguarded.sort() };
}

async function main() {
  const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { missing, stale, unguarded } = await findAuthorizationManifestErrors(rootDirectory);
  if (missing.length || stale.length || unguarded.length) {
    if (missing.length) console.error(`Missing authorization manifest entries:\n${missing.join("\n")}`);
    if (stale.length) console.error(`Stale authorization manifest entries:\n${stale.join("\n")}`);
    if (unguarded.length) console.error(`Manifest entries without their declared source guard:\n${unguarded.join("\n")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${Object.keys(authorizationManifest).length} authorization entry points covered.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
