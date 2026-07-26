import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

const REHEARSAL_CONFIRMATION = "LOCAL_SYNTHETIC_DISPOSABLE_ONLY";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export type PopulatedRehearsalIdentity = {
  database: string;
  host: "loopback";
  port: string;
  schema: string;
};

type RehearsalGuardInput = {
  confirmation?: string;
  dataClass?: string;
  nodeEnv?: string;
  outputDirectory?: string;
  runtimeRoot?: string;
  restoreUrl?: string;
  sourceUrl?: string;
  workspaceRoot?: string;
};

type TableCount = {
  count: string;
  table: string;
};

type UserDatabaseState = {
  extensions: string[];
  globalObjects: string[];
  objects: Array<{
    identity: string;
    kind: string;
    schema: string;
  }>;
  schemas: string[];
};

type CommandResult = {
  output: string;
};

function isInside(parent: string, child: string) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export function parsePopulatedRehearsalIdentity(rawUrl: string): PopulatedRehearsalIdentity {
  const url = new URL(rawUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("database URL must use PostgreSQL");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error("database must use a loopback host");
  }
  if (url.searchParams.has("options")) {
    throw new Error("database URL must not set session options");
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database.startsWith("mcm_test_")) {
    throw new Error("database must use the disposable mcm_test_* namespace");
  }

  const schema = url.searchParams.get("schema") ?? "";
  if (!schema.startsWith("mcm_test_")) {
    throw new Error("schema must use the disposable mcm_test_* namespace");
  }

  return {
    database,
    host: "loopback",
    port: url.port || "5432",
    schema,
  };
}

export function populatedBackupRehearsalErrors(input: RehearsalGuardInput) {
  const errors: string[] = [];
  if (input.nodeEnv === "production") errors.push("NODE_ENV must not be production");
  if (input.confirmation !== REHEARSAL_CONFIRMATION) {
    errors.push(`MCM_POPULATED_REHEARSAL_CONFIRM must equal ${REHEARSAL_CONFIRMATION}`);
  }
  if (input.dataClass !== "synthetic") {
    errors.push("MCM_REHEARSAL_DATA_CLASS must equal synthetic");
  }

  let source: PopulatedRehearsalIdentity | undefined;
  let restore: PopulatedRehearsalIdentity | undefined;
  try {
    source = parsePopulatedRehearsalIdentity(input.sourceUrl ?? "");
  } catch (error) {
    errors.push(`source ${error instanceof Error ? error.message : "database URL is invalid"}`);
  }
  try {
    restore = parsePopulatedRehearsalIdentity(input.restoreUrl ?? "");
  } catch (error) {
    errors.push(`restore ${error instanceof Error ? error.message : "database URL is invalid"}`);
  }

  if (source && restore) {
    if (
      source.database === restore.database
      && source.port === restore.port
      && source.schema === restore.schema
    ) {
      errors.push("source and restore targets must be different databases");
    }
    if (source.port !== restore.port) {
      errors.push("source and restore targets must use the same local PostgreSQL server");
    }
    if (source.schema !== restore.schema) {
      errors.push("source and restore targets must use the same disposable schema name");
    }
  }

  const outputDirectory = input.outputDirectory ?? "";
  const runtimeRoot = input.runtimeRoot ?? "";
  const workspaceRoot = resolve(input.workspaceRoot ?? process.cwd());
  if (!isAbsolute(outputDirectory)) {
    errors.push("MCM_REHEARSAL_OUTPUT_DIR must be an absolute path");
  }
  if (!isAbsolute(runtimeRoot)) {
    errors.push("MCM_REHEARSAL_RUNTIME_ROOT must be an absolute path");
  }
  if (
    isAbsolute(outputDirectory)
    && isAbsolute(runtimeRoot)
    && !isInside(resolve(runtimeRoot), resolve(outputDirectory))
  ) {
    errors.push("backup artifacts must stay inside MCM_REHEARSAL_RUNTIME_ROOT");
  }
  if (
    isAbsolute(outputDirectory)
    && isInside(workspaceRoot, resolve(outputDirectory))
  ) {
    errors.push("backup artifacts must be stored outside the source worktree");
  }
  if (isAbsolute(runtimeRoot) && isInside(workspaceRoot, resolve(runtimeRoot))) {
    errors.push("MCM_REHEARSAL_RUNTIME_ROOT must be outside the source worktree");
  }

  return [...new Set(errors)];
}

export function minimalCommandEnvironment(baseEnv: NodeJS.ProcessEnv = process.env) {
  const env = {} as NodeJS.ProcessEnv;
  for (const key of ["LANG", "LC_ALL", "PATH", "TMPDIR"] as const) {
    if (baseEnv[key]) env[key] = baseEnv[key];
  }
  return env;
}

export function postgresToolEnvironment(rawUrl: string, baseEnv: NodeJS.ProcessEnv = process.env) {
  const url = new URL(rawUrl);
  const env: NodeJS.ProcessEnv = {
    ...minimalCommandEnvironment(baseEnv),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
    PGHOST: url.hostname.replace(/^\[(.*)\]$/, "$1"),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
  };
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const sslMode = url.searchParams.get("sslmode");
  if (sslMode) env.PGSSLMODE = sslMode;
  return env;
}

export function compareTableCounts(source: TableCount[], restore: TableCount[]) {
  return JSON.stringify(source) === JSON.stringify(restore);
}

export function postgresMajor(version: string) {
  const match = version.match(/(?:PostgreSQL\)\s+)?(\d+)(?:\.|$)/);
  return match ? Number(match[1]) : null;
}

export function sourceDatabaseStateErrors(
  state: UserDatabaseState,
  applicationSchema: string,
) {
  const errors: string[] = [];
  const unexpectedSchemas = state.schemas.filter(
    (schema) => !["public", applicationSchema].includes(schema),
  );
  if (unexpectedSchemas.length > 0) {
    errors.push(`unexpected user schemas: ${unexpectedSchemas.join(", ")}`);
  }
  const unexpectedExtensions = state.extensions.filter((extension) => extension !== "pgcrypto@public");
  if (unexpectedExtensions.length > 0 || !state.extensions.includes("pgcrypto@public")) {
    errors.push(`extensions must contain only pgcrypto@public; found: ${state.extensions.join(", ") || "none"}`);
  }
  const outsideObjects = state.objects.filter((object) => object.schema !== applicationSchema);
  if (outsideObjects.length > 0) {
    errors.push(
      `non-extension-owned objects outside ${applicationSchema}: ${outsideObjects
        .map((object) => `${object.kind}:${object.schema}.${object.identity}`)
        .join(", ")}`,
    );
  }
  if (state.globalObjects.length > 0) {
    errors.push(`unsupported database-wide objects: ${state.globalObjects.join(", ")}`);
  }
  return errors;
}

export function emptyRestoreStateErrors(
  state: UserDatabaseState,
  applicationSchema: string,
) {
  const errors: string[] = [];
  const unexpectedSchemas = state.schemas.filter((schema) => schema !== "public");
  if (unexpectedSchemas.length > 0 || state.schemas.includes(applicationSchema)) {
    errors.push(`restore schemas must contain only public; found: ${state.schemas.join(", ")}`);
  }
  if (state.extensions.length > 0) {
    errors.push(`restore has extensions: ${state.extensions.join(", ")}`);
  }
  if (state.objects.length > 0) {
    errors.push(
      `restore has user objects: ${state.objects
        .map((object) => `${object.kind}:${object.schema}.${object.identity}`)
        .join(", ")}`,
    );
  }
  if (state.globalObjects.length > 0) {
    errors.push(`restore has database-wide objects: ${state.globalObjects.join(", ")}`);
  }
  return errors;
}

async function run(
  command: string,
  args: string[],
  options: { capture?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const child = spawn(command, args, {
      env: options.env ?? minimalCommandEnvironment(),
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise({ output: Buffer.concat(stdout).toString("utf8").trim() });
        return;
      }
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(
        new Error(
          `${command} failed with ${signal ?? `exit code ${code}`}${detail ? `: ${detail}` : ""}.`,
        ),
      );
    });
  });
}

async function tableCounts(client: PrismaClient): Promise<TableCount[]> {
  const tables = await client.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename
     FROM pg_catalog.pg_tables
     WHERE schemaname = current_schema()
     ORDER BY tablename`,
  );
  const counts: TableCount[] = [];
  for (const { tablename } of tables) {
    const safeTable = tablename.replaceAll('"', '""');
    const rows = await client.$queryRawUnsafe<Array<{ count: string }>>(
      `SELECT COUNT(*)::text AS count FROM "${safeTable}"`,
    );
    counts.push({ table: tablename, count: rows[0]?.count ?? "0" });
  }
  return counts;
}

async function liveIdentity(client: PrismaClient) {
  const rows = await client.$queryRawUnsafe<Array<{
    database: string;
    databaseReadOnly: boolean;
    defaultReadOnly: string;
    conflictingReadOnlySetting: boolean;
    otherClientSessions: string;
    schema: string | null;
    serverSystemIdentifier: string;
    serverVersion: string;
    serverVersionNumber: string;
  }>>(
    `SELECT
       current_database() AS database,
       current_schema() AS schema,
       current_setting('default_transaction_read_only') AS "defaultReadOnly",
       current_setting('server_version') AS "serverVersion",
       current_setting('server_version_num') AS "serverVersionNumber",
       system_identifier::text AS "serverSystemIdentifier",
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_db_role_setting setting_row
         JOIN pg_catalog.pg_database database_row
           ON database_row.oid = setting_row.setdatabase
         CROSS JOIN LATERAL unnest(setting_row.setconfig) setting
         WHERE database_row.datname = current_database()
           AND setting_row.setrole = 0
           AND setting = 'default_transaction_read_only=on'
       ) AS "databaseReadOnly",
       EXISTS (
         SELECT 1
         FROM pg_catalog.pg_db_role_setting setting_row
         CROSS JOIN LATERAL unnest(setting_row.setconfig) setting
         WHERE setting_row.setdatabase IN (
             0,
             (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database())
           )
           AND setting LIKE 'default_transaction_read_only=%'
           AND setting <> 'default_transaction_read_only=on'
       ) AS "conflictingReadOnlySetting",
       (
         SELECT COUNT(*)::text
         FROM pg_catalog.pg_stat_activity activity
         WHERE activity.datname = current_database()
           AND activity.pid <> pg_backend_pid()
           AND activity.backend_type = 'client backend'
       ) AS "otherClientSessions"
     FROM pg_catalog.pg_control_system()`,
  );
  return rows[0];
}

function assertLiveDatabase(
  label: string,
  expected: PopulatedRehearsalIdentity,
  actual: Awaited<ReturnType<typeof liveIdentity>>,
  requireSchema: boolean,
) {
  if (
    !actual
    || actual.database !== expected.database
    || (requireSchema && actual.schema !== expected.schema)
  ) {
    throw new Error(
      `${label} connected to ${actual?.database ?? "unknown"}/${actual?.schema ?? "unknown"} instead of ${expected.database}/${expected.schema}.`,
    );
  }
}

async function userDatabaseState(client: PrismaClient) {
  const [schemas, objects, extensions, globalObjects] = await Promise.all([
    client.$queryRawUnsafe<Array<{ schema: string }>>(
      `SELECT nspname AS schema
       FROM pg_catalog.pg_namespace
       WHERE nspname <> 'information_schema'
         AND nspname !~ '^pg_'
       ORDER BY nspname`,
    ),
    client.$queryRawUnsafe<Array<{ identity: string; kind: string; schema: string }>>(
      `WITH extension_members AS (
         SELECT classid, objid
         FROM pg_catalog.pg_depend
         WHERE deptype = 'e'
       )
       SELECT namespace.nspname AS schema, 'relation' AS kind, object.relname AS identity
       FROM pg_catalog.pg_class object
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace
       LEFT JOIN extension_members member
         ON member.classid = 'pg_class'::regclass
        AND member.objid = object.oid
       WHERE namespace.nspname <> 'information_schema'
         AND namespace.nspname !~ '^pg_'
         AND member.objid IS NULL
       UNION ALL
       SELECT namespace.nspname, 'routine', object.oid::regprocedure::text
       FROM pg_catalog.pg_proc object
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.pronamespace
       LEFT JOIN extension_members member
         ON member.classid = 'pg_proc'::regclass
        AND member.objid = object.oid
       WHERE namespace.nspname <> 'information_schema'
         AND namespace.nspname !~ '^pg_'
         AND member.objid IS NULL
       UNION ALL
       SELECT namespace.nspname, 'type', object.typname
       FROM pg_catalog.pg_type object
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.typnamespace
       LEFT JOIN extension_members member
         ON member.classid = 'pg_type'::regclass
        AND member.objid = object.oid
       WHERE namespace.nspname <> 'information_schema'
         AND namespace.nspname !~ '^pg_'
         AND member.objid IS NULL
       UNION ALL
       SELECT namespace.nspname, 'operator', object.oid::regoperator::text
       FROM pg_catalog.pg_operator object
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.oprnamespace
       LEFT JOIN extension_members member
         ON member.classid = 'pg_operator'::regclass
        AND member.objid = object.oid
       WHERE namespace.nspname <> 'information_schema'
         AND namespace.nspname !~ '^pg_'
         AND member.objid IS NULL
       UNION ALL
       SELECT namespace.nspname, 'collation', object.collname
       FROM pg_catalog.pg_collation object
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.collnamespace
       LEFT JOIN extension_members member
         ON member.classid = 'pg_collation'::regclass
        AND member.objid = object.oid
       WHERE namespace.nspname <> 'information_schema'
         AND namespace.nspname !~ '^pg_'
         AND member.objid IS NULL
       UNION ALL
       SELECT namespace.nspname, 'conversion', object.conname
       FROM pg_catalog.pg_conversion object
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.connamespace
       LEFT JOIN extension_members member
         ON member.classid = 'pg_conversion'::regclass
        AND member.objid = object.oid
       WHERE namespace.nspname <> 'information_schema'
         AND namespace.nspname !~ '^pg_'
         AND member.objid IS NULL
       UNION ALL
       SELECT namespace.nspname, 'text-search-configuration', object.cfgname
       FROM pg_catalog.pg_ts_config object
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.cfgnamespace
       LEFT JOIN extension_members member
         ON member.classid = 'pg_ts_config'::regclass
        AND member.objid = object.oid
       WHERE namespace.nspname <> 'information_schema'
         AND namespace.nspname !~ '^pg_'
         AND member.objid IS NULL
       UNION ALL
       SELECT namespace.nspname, 'text-search-dictionary', object.dictname
       FROM pg_catalog.pg_ts_dict object
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.dictnamespace
       LEFT JOIN extension_members member
         ON member.classid = 'pg_ts_dict'::regclass
        AND member.objid = object.oid
       WHERE namespace.nspname <> 'information_schema'
         AND namespace.nspname !~ '^pg_'
         AND member.objid IS NULL
       UNION ALL
       SELECT namespace.nspname, 'text-search-parser', object.prsname
       FROM pg_catalog.pg_ts_parser object
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.prsnamespace
       LEFT JOIN extension_members member
         ON member.classid = 'pg_ts_parser'::regclass
        AND member.objid = object.oid
       WHERE namespace.nspname <> 'information_schema'
         AND namespace.nspname !~ '^pg_'
         AND member.objid IS NULL
       UNION ALL
       SELECT namespace.nspname, 'text-search-template', object.tmplname
       FROM pg_catalog.pg_ts_template object
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.tmplnamespace
       LEFT JOIN extension_members member
         ON member.classid = 'pg_ts_template'::regclass
        AND member.objid = object.oid
       WHERE namespace.nspname <> 'information_schema'
         AND namespace.nspname !~ '^pg_'
         AND member.objid IS NULL
       ORDER BY schema, kind, identity`,
    ),
    client.$queryRawUnsafe<Array<{ extension: string }>>(
      `SELECT extension.extname || '@' || namespace.nspname AS extension
       FROM pg_catalog.pg_extension extension
       JOIN pg_catalog.pg_namespace namespace ON namespace.oid = extension.extnamespace
       WHERE extension.extname <> 'plpgsql'
       ORDER BY extension.extname`,
    ),
    client.$queryRawUnsafe<Array<{ object: string }>>(
      `SELECT 'large-object:' || oid::text AS object
       FROM pg_catalog.pg_largeobject_metadata
       UNION ALL
       SELECT 'event-trigger:' || evtname
       FROM pg_catalog.pg_event_trigger
       UNION ALL
       SELECT 'foreign-data-wrapper:' || fdwname
       FROM pg_catalog.pg_foreign_data_wrapper
       WHERE oid >= 16384
       UNION ALL
       SELECT 'foreign-server:' || srvname
       FROM pg_catalog.pg_foreign_server
       UNION ALL
       SELECT 'publication:' || pubname
       FROM pg_catalog.pg_publication
       UNION ALL
       SELECT 'subscription:' || subname
       FROM pg_catalog.pg_subscription
       UNION ALL
       SELECT 'access-method:' || amname
       FROM pg_catalog.pg_am
       WHERE oid >= 16384
       UNION ALL
       SELECT 'cast:' || oid::text
       FROM pg_catalog.pg_cast
       WHERE oid >= 16384
       ORDER BY object`,
    ),
  ]);
  return {
    schemas: schemas.map(({ schema }) => schema),
    objects,
    extensions: extensions.map(({ extension }) => extension),
    globalObjects: globalObjects.map(({ object }) => object),
  };
}

async function sha256(file: string) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function migrationChecksums(workspaceRoot: string) {
  const migrationsRoot = join(workspaceRoot, "prisma", "migrations");
  const migrations = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(migrations.map(async (migration) => ({
    migration,
    sha256: await sha256(join(migrationsRoot, migration, "migration.sql")),
  })));
}

function commandPath(binDirectory: string | undefined, command: string) {
  return binDirectory ? join(binDirectory, command) : command;
}

async function main() {
  const workspaceRoot = resolve(process.cwd());
  const sourceUrl = process.env.MCM_REHEARSAL_SOURCE_URL ?? "";
  const restoreUrl = process.env.MCM_REHEARSAL_RESTORE_URL ?? "";
  const outputDirectory = process.env.MCM_REHEARSAL_OUTPUT_DIR ?? "";
  const runtimeRoot = process.env.MCM_REHEARSAL_RUNTIME_ROOT ?? "";
  const errors = populatedBackupRehearsalErrors({
    confirmation: process.env.MCM_POPULATED_REHEARSAL_CONFIRM,
    dataClass: process.env.MCM_REHEARSAL_DATA_CLASS,
    nodeEnv: process.env.NODE_ENV,
    outputDirectory,
    runtimeRoot,
    restoreUrl,
    sourceUrl,
    workspaceRoot,
  });
  if (errors.length > 0) {
    throw new Error(`Populated backup rehearsal refused: ${errors.join("; ")}.`);
  }

  const sourceIdentity = parsePopulatedRehearsalIdentity(sourceUrl);
  const restoreIdentity = parsePopulatedRehearsalIdentity(restoreUrl);
  const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  const restoreClient = new PrismaClient({ datasources: { db: { url: restoreUrl } } });
  const startedAt = new Date();
  const runId = `m9-backup-${startedAt.toISOString().replaceAll(/[:.]/g, "-")}-${process.pid}`;
  const runDirectory = join(resolve(outputDirectory), runId);
  const customDump = join(runDirectory, "populated.dump");
  const schemaDump = join(runDirectory, "schema.sql");
  const reportFile = join(runDirectory, "manifest.json");
  const pgDump = commandPath(process.env.PG_BIN_DIR, "pg_dump");
  const pgRestore = commandPath(process.env.PG_BIN_DIR, "pg_restore");

  const [canonicalWorkspace, canonicalRuntimeRoot, canonicalOutputDirectory] = await Promise.all([
    realpath(workspaceRoot),
    realpath(runtimeRoot),
    realpath(outputDirectory),
  ]);
  if (
    isInside(canonicalWorkspace, canonicalRuntimeRoot)
    || isInside(canonicalWorkspace, canonicalOutputDirectory)
    || !isInside(canonicalRuntimeRoot, canonicalOutputDirectory)
  ) {
    throw new Error("Canonical rehearsal paths violate the approved runtime boundary.");
  }

  await mkdir(runDirectory, { recursive: false, mode: 0o700 });

  try {
    const sourceLive = await liveIdentity(source);
    const restoreLiveBefore = await liveIdentity(restoreClient);
    assertLiveDatabase("source", sourceIdentity, sourceLive, true);
    assertLiveDatabase("restore", restoreIdentity, restoreLiveBefore, false);
    if (
      sourceLive.defaultReadOnly !== "on"
      || !sourceLive.databaseReadOnly
      || sourceLive.conflictingReadOnlySetting
    ) {
      throw new Error(
        "Source database must enforce an unconflicted database-level default_transaction_read_only=on setting.",
      );
    }
    if (Number(sourceLive.otherClientSessions) > 0) {
      throw new Error(
        `Source database still has ${sourceLive.otherClientSessions} other client session(s); drain writers before rehearsal.`,
      );
    }
    if (sourceLive.serverSystemIdentifier !== restoreLiveBefore.serverSystemIdentifier) {
      throw new Error("Source and restore databases are not on the same PostgreSQL cluster.");
    }
    if (sourceLive.serverVersionNumber !== restoreLiveBefore.serverVersionNumber) {
      throw new Error("Source and restore PostgreSQL server versions differ.");
    }

    const sourceCountsBefore = await tableCounts(source);
    const operationalRows = sourceCountsBefore
      .filter(({ table }) => table !== "_prisma_migrations")
      .reduce((total, { count }) => total + BigInt(count), BigInt(0));
    if (sourceCountsBefore.length === 0 || operationalRows === BigInt(0)) {
      throw new Error("Source must contain populated synthetic application tables.");
    }

    const sourceState = await userDatabaseState(source);
    const sourceStateErrors = sourceDatabaseStateErrors(sourceState, sourceIdentity.schema);
    if (sourceStateErrors.length > 0) {
      throw new Error(`Source database boundary check failed: ${sourceStateErrors.join("; ")}.`);
    }

    const restoreStateBefore = await userDatabaseState(restoreClient);
    const restoreStateErrors = emptyRestoreStateErrors(restoreStateBefore, restoreIdentity.schema);
    if (restoreStateErrors.length > 0) {
      throw new Error(`Restore database boundary check failed: ${restoreStateErrors.join("; ")}.`);
    }

    const pgDumpVersion = (await run(pgDump, ["--version"], { capture: true })).output;
    const pgRestoreVersion = (await run(pgRestore, ["--version"], { capture: true })).output;
    const commit = (await run("git", ["rev-parse", "HEAD"], { capture: true })).output;
    const workingTreeStatus = (await run("git", ["status", "--porcelain"], { capture: true })).output;
    const serverMajor = Math.floor(Number(sourceLive.serverVersionNumber) / 10_000);
    if (
      postgresMajor(pgDumpVersion) !== serverMajor
      || postgresMajor(pgRestoreVersion) !== serverMajor
    ) {
      throw new Error("pg_dump, pg_restore, and PostgreSQL server major versions must match.");
    }

    const backupStarted = performance.now();
    await run(pgDump, [
      "--format=custom",
      "--serializable-deferrable",
      "--no-large-objects",
      "--no-publications",
      "--no-subscriptions",
      "--no-security-labels",
      `--schema=${sourceIdentity.schema}`,
      "--extension=pgcrypto",
      "--strict-names",
      "--no-owner",
      "--no-acl",
      `--file=${customDump}`,
    ], { env: postgresToolEnvironment(sourceUrl) });
    await chmod(customDump, 0o600);
    await run(pgRestore, [
      "--schema-only",
      "--no-owner",
      "--no-acl",
      `--file=${schemaDump}`,
      customDump,
    ], { env: postgresToolEnvironment(sourceUrl) });
    await chmod(schemaDump, 0o600);
    const backupDurationMs = Math.round(performance.now() - backupStarted);

    const sourceCountsAfter = await tableCounts(source);
    if (!compareTableCounts(sourceCountsBefore, sourceCountsAfter)) {
      throw new Error("Source row counts changed despite the required write freeze.");
    }

    const restoreStarted = performance.now();
    await run(pgRestore, [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-acl",
      `--dbname=${restoreIdentity.database}`,
      customDump,
    ], { env: postgresToolEnvironment(restoreUrl) });
    const restoreDurationMs = Math.round(performance.now() - restoreStarted);

    const restoreLiveAfter = await liveIdentity(restoreClient);
    assertLiveDatabase("restore", restoreIdentity, restoreLiveAfter, true);
    const restoreCountsAfter = await tableCounts(restoreClient);
    if (!compareTableCounts(sourceCountsBefore, restoreCountsAfter)) {
      throw new Error("Restored table row counts do not match the source snapshot.");
    }

    const [customDumpStat, schemaDumpStat] = await Promise.all([
      stat(customDump),
      stat(schemaDump),
    ]);
    const finishedAt = new Date();
    const report = {
      runId,
      status: "verified_synthetic_restore",
      dataClass: "synthetic",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      backupDurationMs,
      restoreDurationMs,
      application: {
        commit,
        dirty: Boolean(workingTreeStatus),
        prismaVersion: (
          JSON.parse(await readFile(join(workspaceRoot, "node_modules", "@prisma", "client", "package.json"), "utf8")) as {
            version: string;
          }
        ).version,
        rehearsalScriptSha256: await sha256(join(workspaceRoot, "scripts", "rehearse-populated-backup.ts")),
      },
      postgres: {
        serverVersion: sourceLive.serverVersion,
        pgDumpVersion,
        pgRestoreVersion,
      },
      source: sourceIdentity,
      restore: restoreIdentity,
      writeFreeze: {
        databaseLevelSetting: sourceLive.databaseReadOnly,
        conflictingSetting: sourceLive.conflictingReadOnlySetting,
        otherClientSessions: sourceLive.otherClientSessions,
        sourceDefaultTransactionReadOnly: sourceLive.defaultReadOnly,
      },
      artifacts: [
        {
          file: "populated.dump",
          bytes: customDumpStat.size,
          sha256: await sha256(customDump),
        },
        {
          file: "schema.sql",
          bytes: schemaDumpStat.size,
          sha256: await sha256(schemaDump),
        },
      ],
      migrationChecksums: await migrationChecksums(workspaceRoot),
      rowCounts: sourceCountsBefore,
    };
    await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log(`Synthetic populated backup/restore verified. Evidence: ${reportFile}`);
  } catch (error) {
    const failureFile = join(runDirectory, "manifest.failed.json");
    await writeFile(failureFile, `${JSON.stringify({
      runId,
      status: "failed",
      dataClass: "synthetic",
      startedAt: startedAt.toISOString(),
      failedAt: new Date().toISOString(),
      source: sourceIdentity,
      restore: restoreIdentity,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    throw error;
  } finally {
    await Promise.allSettled([source.$disconnect(), restoreClient.$disconnect()]);
  }
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectExecution) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
