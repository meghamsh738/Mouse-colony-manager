# Mouse Colony Manager

Mouse Colony Manager is a Next.js + Prisma colony operations app for cage-first animal facility workflows and animal-first research workflows. The current runtime is PostgreSQL-backed with seeded dev data, Auth.js role-based login, Prisma transactions for active write flows, and Playwright coverage for the main end-to-end scenarios.

## Stack

- Next.js App Router
- TypeScript
- Prisma
- PostgreSQL
- Auth.js credentials auth for seeded dev users
- Tailwind CSS
- Vitest
- Playwright

## Local Setup

1. Start a local Postgres endpoint. In this repo the simplest path is Prisma's local dev server:

```bash
npx prisma dev -d -n colony-maintenance
```

2. Copy `.env.example` to `.env` and point both database URLs at that Postgres instance.

3. Apply checked-in migrations without changing retained records:

```bash
npm run db:prepare
```

4. For a new empty instance, bootstrap configuration and the five development profiles:

```bash
npm run db:prepare:empty
```

The destructive demo seed is intentionally separate. It requires a loopback database whose database name or schema contains `test`, `e2e`, or `disposable`:

```bash
npm run db:prepare:demo
```

5. Start the app:

```bash
npm run dev
```

The app runs on `http://localhost:3000`.

Notification email delivery uses durable, exact-recipient outbox jobs. Provider location, sender, allowlist, and bearer token are deployment-controlled environment values; recipients always come from current users and notification audiences.

## Production Notification Email

The notification delivery endpoint is provider-neutral. Configure the facility delivery toggle in `/settings`:

- `notify_email_enabled`: set to `true` when production email should be sent.
- `NOTIFICATION_EMAIL_PROVIDER_URL`: mail relay or provider adapter endpoint.
- `NOTIFICATION_EMAIL_PROVIDER_HOSTS`: comma-separated deployment allowlist; required in production.
- `NOTIFICATION_EMAIL_FROM`: sender address approved by the provider.
- `NOTIFICATION_EMAIL_API_TOKEN`: optional provider bearer token.
- `NOTIFICATION_EMAIL_PROVIDER_SUPPORTS_IDEMPOTENCY`: set to `true` only after verifying that the adapter deduplicates the supplied key for the full retry window; delivery stays disabled otherwise.
- `OUTBOX_WORKER_TOKEN_NOTIFICATION_DELIVERY`: at least 32 characters for the bounded delivery worker.

Set `NOTIFICATION_EMAIL_API_TOKEN` in the runtime environment if the provider endpoint expects bearer auth. The adapter must honor the `Idempotency-Key` header (also supplied as `idempotencyKey` in the body) for at least the outbox retry window. Confirm that provider contract with `NOTIFICATION_EMAIL_PROVIDER_SUPPORTS_IDEMPOTENCY=true`; without it the app reports the provider as unconfigured and sends nothing. Redirects are rejected, and production hostnames must resolve only to public addresses. The app sends this JSON payload:

```json
{
  "from": "mouse-colony@colony.local",
  "to": "manager@colony.local",
  "subject": "Mouse Colony Manager notification",
  "text": "Notification body",
  "idempotencyKey": "durable-notification-delivery-id"
}
```

For Resend, Mailgun, SES, or an institutional SMTP bridge, put a small HTTPS adapter in front of the provider if its native API shape differs from the payload above. That keeps provider-specific credentials and transforms outside the app database.

## Seeded Accounts

All seeded dev users use the password `colony123`.

- `admin@colony.local`
- `manager@colony.local`
- `staff@colony.local`
- `researcher@colony.local`
- `readonly@colony.local`

## Useful Commands

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
npm run test:unit
npm run test:db
npm run e2e:install
npm run e2e:install:wsl
npm run e2e:server
npm run test:e2e
npm run test:e2e:smoke
npm run test:e2e:wsl
npm run test:e2e:smoke:wsl
npm run verify
npm run verify:e2e
npm run verify:e2e:reuse
npm run verify:e2e:wsl
npm run verify:e2e:reuse:wsl
npm run verify:all
npm run verify:all:wsl
npm run db:doctor
ALLOW_DESTRUCTIVE_SEED=true npm run db:seed
npm run db:migrate
ALLOW_DISPOSABLE_DB_PUSH=true npm run db:push:disposable
npm run db:prepare
npm run db:prepare:demo
npm run db:prepare:local
npm run db:prepare:ci
```

`npm run test:unit` is the safe, database-free test suite. `npm run test:db` runs the
database integration project and is intentionally destructive only within its target
schema. Both `DATABASE_URL` and `DIRECT_DATABASE_URL` must use a loopback PostgreSQL
endpoint, point to the same database and schema, and use a schema name containing
`test`, `e2e`, or `disposable`. The command fails before connecting when that contract
is not satisfied. `npm test` runs the pure suite first and then the guarded database
suite.

## What Is Persisted

- Auth users and roles are stored in PostgreSQL.
- Colony reads come directly from Prisma-backed read modules for animals, cages, scan, breeding, experiments, dashboard, exports, samples, cryostorage, forecast, and settings.
- Active write flows are Prisma-backed:
  - animal creation
  - cage health notes
  - cage moves
  - experiment reservation
  - planned experiment cohorts and assignment edits
  - breeding setup creation
  - litter recording and weaning
  - genotype recording and CSV genotype import
  - sample inventory
  - cryostorage inventory
  - lifecycle transitions
  - rules updates
- Genotype records and cage health notes can include attachment uploads. Metadata is stored in PostgreSQL, and uploaded files are stored locally under `public/uploads/attachments` for the MVP runtime.
- Audit logs, status events, project allocations, and experiment assignments are written transactionally.
- An authenticated integration API is available under `/api/v1` for animals, cages, breeding setup intake, litter intake, weaning sync, experiments, projects, rule settings, sample inventory, cryostorage inventory, genotype intake, genotype CSV import, experiment assignment sync, direct experiment reservation sync, cage welfare event intake, and export discovery. `/api/v1/animals` supports filtered `GET` reads, audited `POST` animal intake using `animalCode`, `labId`, `strainId`/`strainName`, and cage ids or barcodes, plus audited `PATCH` terminal lifecycle sync using `animalCode`/`animalId`; euthanasia requests also require a timezone-qualified `happenedAt` timestamp and the exact current approved `sopAssignmentId` assigned to the animal's lab. `/api/v1/cages` supports filtered `GET` reads plus audited `PATCH` cage move sync using `cageBarcode`/`cageId` with destination `roomNumber`/`rackNumber` or ids; `/api/v1/breeding-setups` supports audited `POST` setup intake using `sireCode`/`sireId` plus `damCode`/`damId`, including duplicate-safe repeated submission handling and optional admin override of duplicate-breeder safeguards; `/api/v1/litters` supports audited `POST` litter intake for active breeding setups using `breedingSetupId`, with duplicate-safe repeated submission handling for external breeding-room logs; `/api/v1/weanings` supports audited `POST` weaning sync using `litterId`, `strainId`/`strainName`, and holding-cage ids or barcodes, with duplicate-safe repeated submission handling for external breeding-room weaning logs; `/api/v1/rules` supports filtered `GET` reads of admin rule settings plus audited `PATCH` updates using `ruleId`/`ruleKey`, so external admin tooling can maintain threshold and toggle policies with the same validated rule parser as the app UI; `/api/v1/samples` supports filtered `GET` reads, audited `POST` sample intake for external LIMS-style systems using `animalCode`/`animalId` and optional `projectCode`/`projectId`, and audited `PATCH` sample lifecycle updates for status, storage location, quantity, and notes; `/api/v1/cryostorage` supports filtered `GET` reads, audited `POST` backup inventory intake using `strainName`/`strainId` and optional `projectCode`/`projectId`, and audited `PATCH` lifecycle updates for status, storage location, quantity, recovery notes, and notes; `/api/v1/genotypes` supports audited `POST` genotype result intake using `animalCode`/`animalId` plus `marker`/`alleleId`, with optional multipart attachment handoff for vendor reports, and `/api/v1/genotypes/import` supports audited bulk CSV import using pasted `csvText` or multipart file upload with the same parser and row-level recording workflow as the app UI; `/api/v1/experiments/assignments` supports audited `POST` planned assignment sync, `PATCH` promote/rollback status sync on the collection route, and `GET`/`PATCH`/`DELETE` detail maintenance of individual planned assignments; `/api/v1/experiments/reservations` supports audited `POST` direct reservation sync using `experimentCode`/`experimentId` plus `animalCode`/`animalId`, with duplicate-safe repeated submission handling for external schedulers; `/api/v1/cages/health-notes` supports audited external cage welfare or equipment event intake using `cageBarcode`/`cageId`, including optional multipart attachment handoff for welfare photos or documents.
- An in-app notification inbox is available under `/notifications`, with admin-editable rule toggles for overdue genotypes, weaning, breeder age, welfare follow-up, and reservation drift.
- Outbound notification delivery is available at `/api/v1/notifications/delivery` for dry-run payload preview, configured webhook delivery, and configured HTTP email-provider delivery.
- Quarantine and sentinel tracking is available under `/quarantine`, using quarantine cage status, welfare notes, cage flags, and rule-configured review thresholds.
- Experiment planning includes exclusion examples, seeded randomization, cage/sibling/age-band balancing, same-cage treatment-arm limits, overlap checks, and project-allocation risk for unallocated or multi-project animals.
- Breeding suggestions evaluate allele metadata, active breeding workload, admin-configured fertility scoring, line-specific fertility profiles, litter history, expected usable yield, and surplus risk.
- Forecasting compares planned experiment demand against available and projected usable supply, then surfaces 45-day supply gaps, configurable long-range runway, and avoidable surplus.

## Current Scope

The runtime app path is fully Postgres-backed through Prisma. The remaining seed fixtures now live under [`prisma/seed-data.ts`](./prisma/seed-data.ts), and runtime application code no longer imports the full colony seed dataset.

The legacy runtime history remains in [`TODO.md`](./TODO.md). The role-scoped redesign is tracked in [`IMPLEMENTATION_TRACKER.md`](./IMPLEMENTATION_TRACKER.md), with server entry points inventoried in [`AUTHORIZATION_MANIFEST.md`](./AUTHORIZATION_MANIFEST.md).

## Verification

Current repo checks:

```bash
npm run verify
npm run verify:e2e
```

GitHub Actions mirrors this verification flow in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) with a fresh PostgreSQL service, a separate Playwright job, and artifact upload on e2e failures.

For a full local gate in one command:

```bash
npm run verify:all
```

If you want to debug the production-like e2e server outside Playwright, you can start the same seeded test server directly:

```bash
npm run e2e:server
```

That server bootstrap reseeds the database but does not rerun migrations. It refuses non-loopback and non-test-marked database targets. Run `npm run db:prepare:local` after first setup or schema changes; it applies checked-in migrations through the direct database URL and never reseeds retained records. `ALLOW_DISPOSABLE_DB_PUSH=true npm run db:push:disposable` is reserved for empty throwaway local schema prototyping, is blocked in production, and must not be used with retained data.

For repeated local browser checks, keep that server running in one terminal and reuse it from another:

```bash
npm run e2e:server
npm run verify:e2e:reuse -- --grep 'seeded user can log in and reach the dashboard' --project=chromium
npm run verify:e2e:reuse:wsl -- --grep 'seeded user can log in and reach the dashboard' --project=chromium
```

Use the normal `verify:e2e` or `verify:e2e:wsl` path when you need Playwright to own server startup. Restart the reusable server after code, environment, schema, or seed changes.

For the fastest meaningful browser check, use the seeded-login smoke:

```bash
npm run test:e2e:smoke
npm run test:e2e:smoke:wsl
```

If local Prisma-backed tests fail before the app starts, run the read-only DB doctor first:

```bash
npm run db:doctor
```

If the configured endpoint is down, start it with `npx prisma dev -d -n colony-maintenance`, then run `npm run db:prepare:local` and retry `npm run db:doctor`.

On Ubuntu/Debian WSL without `sudo`, Playwright can fail to launch Chromium because shared libraries such as `libnspr4.so` are not present. Use the rootless wrapper scripts below to download and extract the required packages into `~/.cache/colony-maintenance/playwright-libs` and rerun Playwright with the correct `LD_LIBRARY_PATH`:

```bash
npm run e2e:install:wsl
npm run test:e2e:wsl
npm run verify:e2e:wsl
npm run verify:all:wsl
```

Clean-checkout verification was also run from a disposable clone with:

```bash
npm ci
cp .env.example .env
npm run db:prepare:empty
npm run verify
```
