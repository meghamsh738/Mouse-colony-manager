import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const RETAINED_DATA_SCRIPTS = [
  "db:prepare",
  "db:prepare:empty",
  "db:prepare:ci",
] as const;

export function findUnsafeDbWorkflowReferences(
  packageScripts: Record<string, string>,
  localPrepareSource: string,
) {
  const violations: string[] = [];

  if ("db:push" in packageScripts) {
    violations.push("package.json#db:push");
  }

  for (const scriptName of RETAINED_DATA_SCRIPTS) {
    const script = packageScripts[scriptName] ?? "";

    if (/db:push|prisma\s+db\s+push/.test(script)) {
      violations.push(`package.json#${scriptName}`);
    }

    if (/db:seed(?!:empty)/.test(script)) {
      violations.push(`package.json#${scriptName} destructive seed`);
    }
  }

  if (/\["run",\s*"db:push/.test(localPrepareSource) || /prisma\s+db\s+push/.test(localPrepareSource)) {
    violations.push("scripts/db-prepare-local.ts");
  }

  if (/\["run",\s*"db:seed"/.test(localPrepareSource)) {
    violations.push("scripts/db-prepare-local.ts destructive seed");
  }

  const disposableScript = packageScripts["db:push:disposable"] ?? "";

  if (!disposableScript.includes("assert-disposable-db")) {
    violations.push("package.json#db:push:disposable guard");
  }

  return violations;
}

async function main() {
  const cwd = process.cwd();
  const packageJson = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const localPrepareSource = await readFile(resolve(cwd, "scripts/db-prepare-local.ts"), "utf8");
  const violations = findUnsafeDbWorkflowReferences(packageJson.scripts ?? {}, localPrepareSource);

  if (violations.length > 0) {
    throw new Error(
      `Retained-data database workflows must use migrations without destructive resets: ${violations.join(", ")}.`,
    );
  }

  console.log("Retained-data database workflows use Prisma migrations.");
}

if (process.argv[1]?.endsWith("check-db-workflows.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
