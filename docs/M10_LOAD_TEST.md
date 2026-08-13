# M10 local load test

This harness creates and exercises a dedicated local dataset without changing the product's identifier contract. The current canonical animal identifier is exactly four digits (`0001`–`9999`), so this precursor targets **9,999 animals**, not the tracker’s exact 10,000. Reaching 10,000 requires a separately reviewed product/data migration that widens the identifier contract. The other targets are **2,000 cages** and **50 distinct synthetic authenticated users**.

## Safety boundary

Use a fresh PostgreSQL database or schema whose database name or schema name contains `mcm_test_m10_load`. Both database URLs must identify the same loopback-hosted database and schema. The seed refuses to run unless all of these are true:

- `NODE_ENV` is not `production`.
- `M10_LOAD_SEED=true` and `ALLOW_DESTRUCTIVE_SEED=true` are both explicit.
- `DATABASE_URL` and `DIRECT_DATABASE_URL` are present, match, use `localhost`, `127.0.0.1`, or `::1`, and contain the dedicated marker.
- The live PostgreSQL database/schema and server address match the guarded target.
- Every application table is empty and the only baseline rows are the two pristine identity sequences created by migrations (`animal` next value 1 and `cage` next value 1000).

The command does not create, drop, or reset a database/schema and never runs migrations. After proving the migrated target is fresh, it runs the existing deterministic base seed and adds deterministic load rows in batches. It preserves the populated load database after completion for the runner and investigation, and a rerun refuses to overwrite it. Never point these variables at retained, shared, staging, or production data.

## Prepare and seed

Create the dedicated database/schema yourself, apply migrations, then seed. One example using a dedicated schema is:

```sh
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/colony?schema=mcm_test_m10_load_local'
export DIRECT_DATABASE_URL="$DATABASE_URL"
npm run db:migrate
NODE_ENV=test M10_LOAD_SEED=true ALLOW_DESTRUCTIVE_SEED=true npm run db:seed:m10-load
```

The seed fails unless the base and final counts are exact. It also verifies one immutable facility-identity assignment per animal/cage, checks maximum cage occupancy against the facility limit, and runs PostgreSQL `ANALYZE` so query-planner statistics reflect the load dataset. A successful final count is 9,999 animals, 2,000 cages, 9,999 animal identity assignments, 2,000 cage identity assignments, and 55 users (five base users plus 50 synthetic users).

The base seed and additive transaction cannot be one database transaction because the established base seed owns multiple transactions. If the additive transaction fails, it rolls back all additive rows but leaves a valid base fixture. The harness reports the failure and will then refuse to reseed that non-fresh schema; it never guesses at cleanup. Recovery is to discard that dedicated disposable schema and create a fresh migrated one. This is fail-closed and preserves evidence for diagnosis.

## Build and run

The runner starts its own `next start` child process with `NODE_ENV=production`; it does not use the development server. Build first and choose an absolute artifact directory under the project’s `.runtime-data/m10-load` area but outside this worktree:

```sh
npm run build
export M10_LOAD_BASE_URL='http://127.0.0.1:3310'
export M10_LOAD_ARTIFACT_DIR='/absolute/path/to/project/.runtime-data/m10-load/local-run'
M10_LOAD_PROFILE=quick npm run load:m10
```

The quick profile is a bounded smoke run (3-second warmup, 5-second ramp, and 10-second steady phase). The default profile is 30/60/300 seconds. Each phase can be adjusted within safety caps:

- `M10_LOAD_<PHASE>_SECONDS`: 1–900
- `M10_LOAD_<PHASE>_CONCURRENCY`: 1–100
- `M10_LOAD_<PHASE>_RPS`: 1–200 requests per second
- `M10_LOAD_STARTUP_TIMEOUT_MS`: 45000–180000 ms (default 120000; startup is excluded from load metrics)

`<PHASE>` is `WARMUP`, `RAMP`, or `STEADY`. The default steady phase uses exactly 50 concurrent authenticated sessions; the ramp progresses from 8 to 30 to 50 concurrent requests. The runner authenticates all 50 synthetic users directly through the normal credentials flow and reuses their cookies, so it does not need 50 browser processes. Ten deterministic users have manager memberships for the approvals and transfer-workspace routes; all 50 remain distinct sessions. The route mix covers the dashboard, animal and cage lists, searches and details, bounded server-searched cage/scan transfer workspaces, samples, cryostorage, approvals, a valid synthetic barcode scan, and workbook. Requests require a successful, authorized React Server Component (RSC) response with the expected content type; redirects to login, HTTP errors, wrong content types, or any route/resource with no samples fail the acceptance gate.

## Results and privacy

Each run creates a permission-restricted timestamp directory (`0700`) containing `summary.json`, `routes.csv`, and `summary.md` (`0600`). Reports include route/phase/overall request count, errors, throughput measured over actual elapsed time, p50/p95 latency, RSC response bytes, and client schedule delay (the time a request waited for its planned load-generator slot). Each phase also records its configured scheduling window, actual elapsed time, and observed peak in-flight concurrency so a nominal 50-user profile cannot be mistaken for evidence that 50 requests were actually simultaneous. Application resident memory (RSS) and PostgreSQL connections include p50/p95/maximum, with explicit Prisma pool-timeout, connection-limit, connection, and other monitoring failures.

If `pg_stat_statements` is installed, the report records its database-wide call-count delta without reading or storing query text. Otherwise it explicitly marks database-call measurement unavailable and the database-query gate remains incomplete until the extension is enabled locally. Durable outbox measurements use delivery-attempt timestamps: message available-to-attempt-start queue wait, attempt start-to-completion service time, and message created-to-delivered end-to-end time, each with p50/p95/maximum and sample count. Empty samples are explicitly `available: false`. The read harness does not manufacture a delivery probe or start a provider worker, so an unavailable timing result is not evidence that the M10 queue milestone is complete.

Application server output is discarded rather than persisted because logs can contain sensitive operational context. Prisma pool/connection failures from the separate monitor client are categorized explicitly; application-side Prisma failure counting is honestly marked unavailable unless a future bounded, sanitized in-memory parser is reviewed and added.

The environment section records the Git commit, whether the worktree had uncommitted changes, Node/PostgreSQL versions, coarse machine platform/architecture/CPU count/memory, non-secret `connection_limit` and `pool_timeout`, and configured outbox worker cadence/batch/concurrency. Treat a dirty-worktree run as diagnostic evidence only; the final reproducible acceptance run must name a clean commit. After the run, exact dataset/identity/occupancy invariants are rechecked and every application-table row count is compared with its post-login baseline; any write during the read workload fails the run.

Artifacts intentionally exclude animal/cage/user identifiers, cookies, credentials, database URLs, SQL text and parameters, lab names, response bodies, and server logs. The runner parses application standard error only in memory for fixed Prisma connection/pool failure signals and never stores the underlying lines. Do not attach ad hoc debug logs to this artifact directory without reviewing them for sensitive data.

The read-only profile does not run the outbox worker. Queue wait, service, and end-to-end distributions therefore use only delivery attempts started during the load window and report `available: false` when there are none; this harness does not claim queue-delay evidence without a separate loopback-provider worker probe. When `pg_stat_statements` is available, database-call evidence contains only aggregate counts and subtracts the known connection-sampler calls for an estimated application total. SQL text and parameters are never selected.

## Hosting decision record (draft, vendor-neutral)

This local harness is an engineering precursor, not evidence for a hosting vendor choice. A future hosting decision should compare production-shaped candidates using the same workload and separately record: deployment topology, PostgreSQL connection limits and pooling, horizontal scaling behavior, cold starts, regional latency, backup/restore objectives, observability, security controls, operational ownership, and total cost. The decision gate should require repeatable p95/error/queue-delay results plus restore and failure-mode evidence; no vendor is selected by this document.
