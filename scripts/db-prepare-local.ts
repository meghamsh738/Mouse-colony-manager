import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseDotEnv } from "./db-doctor";

type DirectDatabaseEnv = {
  DATABASE_URL: string;
  DIRECT_DATABASE_URL: string;
};

export function buildDirectDatabaseEnv(
  fileEnv: Record<string, string>,
  runtimeEnv: Record<string, string | undefined> = process.env,
): DirectDatabaseEnv {
  const directUrl = runtimeEnv.DIRECT_DATABASE_URL ?? fileEnv.DIRECT_DATABASE_URL;
  const databaseUrl = runtimeEnv.DATABASE_URL ?? fileEnv.DATABASE_URL;
  const normalizedUrl = normalizeDirectDatabaseUrl(directUrl ?? databaseUrl ?? "");

  if (!normalizedUrl) {
    throw new Error("DATABASE_URL or DIRECT_DATABASE_URL must be configured before running local DB prep.");
  }

  return {
    DATABASE_URL: normalizedUrl,
    DIRECT_DATABASE_URL: normalizedUrl,
  };
}

export function normalizeDirectDatabaseUrl(rawUrl: string) {
  if (!rawUrl) {
    return "";
  }

  const url = new URL(rawUrl);

  url.searchParams.delete("pgbouncer");

  return url.toString();
}

export async function runLocalDbPrepare(cwd = process.cwd(), runtimeEnv: NodeJS.ProcessEnv = process.env) {
  const envFilePath = resolve(cwd, ".env");
  const fileEnv = await readDotEnv(envFilePath);
  const directDatabaseEnv = buildDirectDatabaseEnv(fileEnv, runtimeEnv);
  const childEnv = { ...runtimeEnv, ...directDatabaseEnv };

  await run("npm", ["run", "db:push"], childEnv, cwd);
  await run("npm", ["run", "db:seed"], childEnv, cwd);
}

async function readDotEnv(envFilePath: string) {
  try {
    return parseDotEnv(await readFile(envFilePath, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) {
  const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;

  return new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(executable, args, { cwd, env, stdio: "inherit" });

    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(new Error(`${[command, ...args].join(" ")} failed with ${signal ?? `exit code ${code}`}.`));
    });
  });
}

function isDirectRun() {
  const currentPath = fileURLToPath(import.meta.url);
  const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";

  return currentPath === invokedPath;
}

if (isDirectRun()) {
  runLocalDbPrepare().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
